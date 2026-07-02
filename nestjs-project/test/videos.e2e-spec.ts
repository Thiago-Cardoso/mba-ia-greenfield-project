import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

const READY_VIDEO_SLUG = 'testvideo01';
const PROCESSING_VIDEO_SLUG = 'testvideo02';
const VIDEO_BUCKET = process.env.VIDEO_BUCKET ?? 'streamtube-videos';

async function registerAndLogin(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<string> {
  const mailService = app.get(MailService);
  let capturedToken = '';
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_e: string, _n: string, t: string) => {
      capturedToken = t;
      return Promise.resolve();
    });

  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password });

  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token: capturedToken });

  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });

  return (loginRes.body as { access_token: string }).access_token;
}

describe('VideoController (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let s3: S3Client;
  let channelId: string;
  let readyVideoId: string;
  let processingVideoId: string;
  let ownerToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    s3 = moduleFixture.get(S3Client);

    await cleanAllTables(dataSource);

    ownerToken = await registerAndLogin(app, 'video_meta_user@example.com');

    const channelRes = await request(app.getHttpServer())
      .post('/channels')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Video Test Channel' });

    channelId = (channelRes.body as { id: string }).id;

    readyVideoId = crypto.randomUUID();
    processingVideoId = crypto.randomUUID();

    const storageKey = `${readyVideoId}/original.mp4`;
    const testContent = Buffer.alloc(2048, 0x55);

    await s3.send(
      new PutObjectCommand({
        Bucket: VIDEO_BUCKET,
        Key: storageKey,
        Body: testContent,
        ContentType: 'video/mp4',
      }),
    );

    await dataSource.query(
      `INSERT INTO videos (id, channel_id, slug, title, status, storage_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ready', $5, NOW(), NOW())`,
      [
        readyVideoId,
        channelId,
        READY_VIDEO_SLUG,
        'Ready Test Video',
        storageKey,
      ],
    );

    await dataSource.query(
      `INSERT INTO videos (id, channel_id, slug, title, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'processing', NOW(), NOW())`,
      [
        processingVideoId,
        channelId,
        PROCESSING_VIDEO_SLUG,
        'Processing Test Video',
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    throttlerStorage.storage.clear();
  });

  describe('1. Video metadata', () => {
    it('1.1. ready-video-metadata-returns-200', async () => {
      const res = await request(app.getHttpServer()).get(
        `/videos/${READY_VIDEO_SLUG}`,
      );

      expect(res.status).toBe(200);
      const body = res.body as {
        id: string;
        slug: string;
        title: string;
        status: string;
        channel: { id: string; name: string; slug: string };
        durationSeconds: number | null;
        createdAt: string;
      };
      expect(body.id).toBe(readyVideoId);
      expect(body.slug).toBe(READY_VIDEO_SLUG);
      expect(body.title).toBe('Ready Test Video');
      expect(body.status).toBe('ready');
      expect(body.channel).toMatchObject({ id: channelId });
      expect(body.channel.name).toBeTruthy();
      expect(body.channel.slug).toBeTruthy();
      expect(body.createdAt).toBeTruthy();
    });

    it('1.2. nonexistent-slug-returns-404', async () => {
      const res = await request(app.getHttpServer()).get('/videos/notfound001');

      expect(res.status).toBe(404);
      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
    });

    it('1.3. processing-video-returns-403-for-anonymous', async () => {
      const res = await request(app.getHttpServer()).get(
        `/videos/${PROCESSING_VIDEO_SLUG}`,
      );

      expect(res.status).toBe(403);
      expect((res.body as { error: string }).error).toBe('VIDEO_ACCESS_DENIED');
    });

    it('1.4. processing-video-returns-200-for-channel-owner', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${PROCESSING_VIDEO_SLUG}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      const body = res.body as { slug: string; status: string };
      expect(body.slug).toBe(PROCESSING_VIDEO_SLUG);
      expect(body.status).toBe('processing');
    });
  });

  describe('2. Video streaming (Range Requests)', () => {
    it('2.1. stream-with-range-header-returns-206', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${READY_VIDEO_SLUG}/stream`)
        .set('Range', 'bytes=0-1023');

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toMatch(/^bytes 0-\d+\/\d+$/);
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('2.2. stream-without-range-returns-200', async () => {
      const res = await request(app.getHttpServer()).get(
        `/videos/${READY_VIDEO_SLUG}/stream`,
      );

      expect(res.status).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('2.3. stream-processing-video-returns-403', async () => {
      const res = await request(app.getHttpServer()).get(
        `/videos/${PROCESSING_VIDEO_SLUG}/stream`,
      );

      expect(res.status).toBe(403);
      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
    });
  });

  describe('3. Video download', () => {
    it('3.1. download-returns-200-with-attachment-header', async () => {
      const res = await request(app.getHttpServer()).get(
        `/videos/${READY_VIDEO_SLUG}/download`,
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('Ready Test Video');
    });
  });
});
