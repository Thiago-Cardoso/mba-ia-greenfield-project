import { Inject, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import Ffmpeg from 'fluent-ffmpeg';
import {
  createReadStream,
  createWriteStream,
  promises as fsPromises,
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { VideosService } from '../videos/videos.service';
import { VideoStatus } from '../videos/entities/video.entity';

const VIDEO_JOB_NAME = 'video.process';

export interface VideoJobPayload {
  videoId: string;
  storageKey: string;
}

@Processor('video-processing')
export class VideoProcessorConsumer extends WorkerHost {
  private readonly logger = new Logger(VideoProcessorConsumer.name);

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    private readonly storageService: StorageService,
    private readonly videosService: VideosService,
  ) {
    super();
  }

  async process(job: Job<VideoJobPayload>): Promise<void> {
    if (job.name !== VIDEO_JOB_NAME) return;

    let workDir: string | undefined;

    try {
      const { videoId, storageKey } = job.data;
      workDir = path.join(os.tmpdir(), videoId);
      await fsPromises.mkdir(workDir, { recursive: true });

      const localPath = path.join(workDir, 'original.mp4');
      const processedPath = path.join(workDir, 'processed.mp4');
      const thumbnailPath = path.join(workDir, 'thumbnail.jpg');

      await job.updateProgress(10);
      await this.downloadToFile(this.config.videoBucket, storageKey, localPath);

      await job.updateProgress(20);
      const meta = await this.ffprobe(localPath);

      await job.updateProgress(40);
      await this.applyFaststart(localPath, processedPath);

      await job.updateProgress(60);
      await this.generateThumbnail(localPath, workDir);
      await fsPromises.access(thumbnailPath);

      await job.updateProgress(70);
      await this.storageService.putObject(
        this.config.videoBucket,
        storageKey,
        createReadStream(processedPath),
        'video/mp4',
      );

      await job.updateProgress(85);
      const thumbnailKey = `${videoId}/thumbnail.jpg`;
      await this.storageService.putObject(
        this.config.thumbnailBucket,
        thumbnailKey,
        createReadStream(thumbnailPath),
        'image/jpeg',
      );

      await job.updateProgress(95);
      await this.videosService.updateAfterProcessing(videoId, {
        storageKey,
        thumbnailKey,
        durationSeconds: meta.duration,
        metadata: { codec: meta.codec, width: meta.width, height: meta.height },
      });

      await job.updateProgress(100);
    } finally {
      if (workDir) {
        await fsPromises.rm(workDir, { recursive: true, force: true });
      }
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<VideoJobPayload>, error: Error): Promise<void> {
    if (job.name !== VIDEO_JOB_NAME) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      this.logger.error(
        `Job ${job.id} permanently failed for video ${job.data.videoId}: ${error.message}`,
      );
      try {
        await this.videosService.updateStatus(
          job.data.videoId,
          VideoStatus.ERROR,
        );
      } catch (err) {
        this.logger.error(
          `Could not mark video ${job.data.videoId} as error: ${String(err)}`,
        );
      }
    }
  }

  private async downloadToFile(
    bucket: string,
    key: string,
    dest: string,
  ): Promise<void> {
    const { body } = await this.storageService.getObjectStream(bucket, key);
    await pipeline(body, createWriteStream(dest));
  }

  private ffprobe(localPath: string): Promise<{
    duration: number;
    codec: string;
    width: number;
    height: number;
  }> {
    return new Promise((resolve, reject) => {
      Ffmpeg.ffprobe(localPath, (err, data) => {
        if (err)
          return reject(err instanceof Error ? err : new Error(String(err)));
        const vs = data.streams.find((s) => s.codec_type === 'video');
        resolve({
          duration: data.format.duration ?? 0,
          codec: vs?.codec_name ?? 'unknown',
          width: vs?.width ?? 0,
          height: vs?.height ?? 0,
        });
      });
    });
  }

  private applyFaststart(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      Ffmpeg(input)
        .outputOptions(['-movflags +faststart', '-c copy'])
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  private generateThumbnail(input: string, dir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      Ffmpeg(input)
        .screenshots({
          timestamps: ['50%'],
          filename: 'thumbnail.jpg',
          folder: dir,
          size: '1280x720',
        })
        .on('end', () => resolve())
        .on('error', reject);
    });
  }
}
