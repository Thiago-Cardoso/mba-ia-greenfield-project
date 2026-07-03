import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import {
  S3Client,
  CreateBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { Job } from 'bullmq';
import Ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'node:child_process';
import { createReadStream, promises as fsPromises } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { QueueModule } from '../queue/queue.module';
import { VideosModule } from '../videos/videos.module';
import { Video } from '../videos/entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { VideosService } from '../videos/videos.service';
import { VideoStatus } from '../videos/entities/video.entity';
import {
  VideoProcessorConsumer,
  type VideoJobPayload,
} from './video.processor';
import {
  createTestDataSource,
  cleanAllTables,
} from '../test/create-test-data-source';
import type { DataSource } from 'typeorm';

const execFileAsync = promisify(execFile);

const VIDEO_BUCKET = 'streamtube-videos';
const THUMBNAIL_BUCKET = 'streamtube-thumbnails';

function makeJob(
  data: VideoJobPayload,
  attemptsMade = 1,
  attempts = 3,
): Job<VideoJobPayload> {
  return {
    id: 'test-job',
    name: 'video.process',
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<VideoJobPayload>;
}

describe('VideoProcessorConsumer (integration)', () => {
  let module: TestingModule;
  let processor: VideoProcessorConsumer;
  let videosService: VideosService;
  let s3: S3Client;
  let dataSource: DataSource;
  let testVideoPath: string;

  beforeAll(async () => {
    Ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg');
    Ffmpeg.setFfprobePath(process.env.FFPROBE_PATH ?? '/usr/bin/ffprobe');

    // Generate a small 2-second test video using ffmpeg
    testVideoPath = path.join(os.tmpdir(), 'test-worker-input.mp4');
    const ffmpegBin = process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg';
    await execFileAsync(ffmpegBin, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:size=320x240:rate=25',
      '-t',
      '2',
      '-an',
      testVideoPath,
    ]);

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BullBoardModule.forRoot({ route: '/queues', adapter: ExpressAdapter }),
        ConfigModule.forFeature(storageConfig),
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule.forFeature(databaseConfig)],
          inject: [databaseConfig.KEY],
          useFactory: (config: ConfigType<typeof databaseConfig>) => ({
            type: 'postgres',
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            database: config.name,
            entities: [Video, Channel, User],
            synchronize: false,
          }),
        }),
        StorageModule,
        QueueModule,
        VideosModule,
      ],
      providers: [VideoProcessorConsumer],
    }).compile();

    processor = module.get(VideoProcessorConsumer);
    videosService = module.get(VideosService);
    s3 = module.get(S3Client);

    dataSource = createTestDataSource([Video, Channel, User], {
      synchronize: false,
    });
    await dataSource.initialize();

    // Ensure buckets exist
    for (const bucket of [VIDEO_BUCKET, THUMBNAIL_BUCKET]) {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch {
        // bucket already exists — ignore
      }
    }
  }, 120000);

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await module?.close();
    await fsPromises.unlink(testVideoPath).catch(() => undefined);
  }, 30000);

  async function seedVideo(id: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO users (id, email, password) VALUES ($1, $2, $3)`,
      [id, `worker-test-${id}@example.com`, 'hash'],
    );
    await dataSource.query(
      `INSERT INTO channels (id, name, slug, user_id) VALUES ($1, $2, $3, $4)`,
      [id, 'Worker Test Channel', `worker-ch-${id}`, id],
    );
    await dataSource.query(
      `INSERT INTO videos (id, channel_id, title, slug, status) VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        id,
        'Worker Test Video',
        `wkr${id.slice(0, 8)}`,
        VideoStatus.PROCESSING,
      ],
    );
  }

  async function uploadToMinio(
    bucket: string,
    key: string,
    filePath: string,
    contentType: string,
  ): Promise<void> {
    const storageService = module.get(StorageService);
    await storageService.putObject(
      bucket,
      key,
      createReadStream(filePath),
      contentType,
    );
  }

  describe('process — happy path', () => {
    it('processes a valid video: sets status READY, fills metadata, uploads thumbnail', async () => {
      const videoId = '00000000-0000-0000-0000-000000000001';
      const storageKey = `${videoId}/original.mp4`;

      await seedVideo(videoId);
      await uploadToMinio(VIDEO_BUCKET, storageKey, testVideoPath, 'video/mp4');

      const job = makeJob({ videoId, storageKey });
      await processor.process(job);

      const video = await videosService.findByIdOrFail(videoId);
      expect(video.status).toBe(VideoStatus.READY);
      expect(video.duration_seconds).toBeGreaterThan(0);
      expect(video.metadata).toMatchObject({
        codec: expect.any(String) as unknown,
        width: expect.any(Number) as unknown,
        height: expect.any(Number) as unknown,
      });
      expect(video.thumbnail_key).toBe(`${videoId}/thumbnail.jpg`);

      // Verify thumbnail exists in MinIO
      await expect(
        s3.send(
          new HeadObjectCommand({
            Bucket: THUMBNAIL_BUCKET,
            Key: `${videoId}/thumbnail.jpg`,
          }),
        ),
      ).resolves.toBeDefined();
    }, 120000);
  });

  describe('onFailed — permanent failure', () => {
    it('marks video as ERROR after all attempts exhausted with an invalid file', async () => {
      const videoId = '00000000-0000-0000-0000-000000000002';
      const storageKey = `${videoId}/original.mp4`;

      await seedVideo(videoId);

      // Upload an invalid "video" (plain text)
      const invalidPath = path.join(os.tmpdir(), 'invalid.mp4');
      await fsPromises.writeFile(invalidPath, 'this is not a video file');
      await uploadToMinio(VIDEO_BUCKET, storageKey, invalidPath, 'video/mp4');
      await fsPromises.unlink(invalidPath);

      const job = makeJob({ videoId, storageKey }, 3, 3);
      let caught: Error | undefined;
      try {
        await processor.process(job);
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).toBeDefined();

      // Simulate BullMQ calling onFailed after all attempts
      await processor.onFailed(job, caught!);

      const video = await videosService.findByIdOrFail(videoId);
      expect(video.status).toBe(VideoStatus.ERROR);
    });
  });
});
