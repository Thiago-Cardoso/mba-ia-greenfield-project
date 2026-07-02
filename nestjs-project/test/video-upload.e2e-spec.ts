import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';

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

describe('Video Upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let accessTokenA: string;
  let channelId: string;

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

    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "refresh_tokens"');
    await dataSource.query('DELETE FROM "verification_tokens"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');

    accessTokenA = await registerAndLogin(app, 'upload_user_a@example.com');

    const channelRes = await request(app.getHttpServer())
      .post('/channels')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ name: 'Upload Test Channel' });

    channelId = (channelRes.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    throttlerStorage.storage.clear();
  });

  describe('1. Upload initiation', () => {
    it('1.1. initiate-returns-201-with-upload-info', async () => {
      const res = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({
          channelId,
          title: 'Meu Vídeo',
          fileSize: 10_485_760,
          contentType: 'video/mp4',
        });

      expect(res.status).toBe(201);
      const body = res.body as {
        videoId: string;
        uploadId: string;
        partSize: number;
        totalParts: number;
      };
      expect(body.videoId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(body.uploadId).toBeTruthy();
      expect(body.partSize).toBe(8_388_608);
      expect(body.totalParts).toBe(2);
    });

    it('1.2. initiate-rejects-oversized-file', async () => {
      const res = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({
          channelId,
          title: 'Grande',
          fileSize: 10_737_418_241,
          contentType: 'video/mp4',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('2. Ownership and status enforcement', () => {
    it('2.1. presigned-parts-cross-owner-returns-403', async () => {
      const accessTokenB = await registerAndLogin(
        app,
        'upload_user_b@example.com',
      );

      const initiateRes = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({
          channelId,
          title: 'Cross Owner Test',
          fileSize: 8_388_608,
          contentType: 'video/mp4',
        });

      expect(initiateRes.status).toBe(201);
      const { videoId, uploadId } = initiateRes.body as {
        videoId: string;
        uploadId: string;
      };

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/presigned-parts`)
        .set('Authorization', `Bearer ${accessTokenB}`)
        .send({ uploadId, partNumbers: [1] });

      expect(res.status).toBe(403);
      expect((res.body as { error: string }).error).toBe('VIDEO_ACCESS_DENIED');
    });

    it('2.2. complete-non-draft-video-returns-409', async () => {
      const initiateRes = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({
          channelId,
          title: 'Non Draft Test',
          fileSize: 8_388_608,
          contentType: 'video/mp4',
        });

      expect(initiateRes.status).toBe(201);
      const { videoId, uploadId } = initiateRes.body as {
        videoId: string;
        uploadId: string;
      };

      await dataSource.query(
        `UPDATE "videos" SET "status" = 'processing' WHERE "id" = $1`,
        [videoId],
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/complete`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({
          uploadId,
          parts: [{ partNumber: 1, etag: '"abc"' }],
        });

      expect(res.status).toBe(409);
      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_IN_DRAFT');
    });
  });

  describe('3. Upload completion', () => {
    it('3.1. complete-with-valid-parts-returns-processing', async () => {
      const initiateRes = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({
          channelId,
          title: 'Complete Upload Test',
          fileSize: 5_242_880,
          contentType: 'video/mp4',
        });

      expect(initiateRes.status).toBe(201);
      const { videoId, uploadId } = initiateRes.body as {
        videoId: string;
        uploadId: string;
      };

      const partsRes = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/presigned-parts`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({ uploadId, partNumbers: [1] });

      expect(partsRes.status).toBe(200);
      const { parts } = partsRes.body as {
        parts: { partNumber: number; url: string }[];
      };
      expect(parts).toHaveLength(1);
      expect(parts[0].url).toBeTruthy();

      const payload = Buffer.alloc(5_242_880, 0);
      const putRes = await fetch(parts[0].url, {
        method: 'PUT',
        body: payload,
        headers: { 'Content-Length': String(payload.length) },
      });

      expect(putRes.status).toBe(200);
      const etag = putRes.headers.get('etag') ?? '';
      expect(etag).toBeTruthy();

      const completeRes = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/complete`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({
          uploadId,
          parts: [{ partNumber: 1, etag }],
        });

      expect(completeRes.status).toBe(200);
      const completeBody = completeRes.body as {
        videoId: string;
        status: string;
      };
      expect(completeBody.videoId).toBe(videoId);
      expect(completeBody.status).toBe('processing');
    });
  });
});
