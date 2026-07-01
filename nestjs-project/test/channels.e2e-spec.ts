import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';

const TEST_EMAIL = 'channels_tester@example.com';
const TEST_PASSWORD = 'password123';

describe('POST /channels (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let accessToken: string;
  let throttlerStorage: ThrottlerStorageService;

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

    // Clean state before setting up test user
    await dataSource.query('DELETE FROM "refresh_tokens"');
    await dataSource.query('DELETE FROM "verification_tokens"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');

    // Register + confirm + login to get a valid JWT
    const mailService = app.get(MailService);
    let capturedToken = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(
        (_email: string, _name: string, token: string) => {
          capturedToken = token;
          return Promise.resolve();
        },
      );

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const loginBody = loginRes.body as { access_token: string };
    accessToken = loginBody.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "channels"');
    throttlerStorage.storage.clear();
  });

  describe('1. Canal creation', () => {
    it('1.1. successful-channel-creation — returns 201 with channel data', async () => {
      const res = await request(app.getHttpServer())
        .post('/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Meu Canal' });

      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        user_id: string;
        name: string;
        slug: string;
        created_at: string;
      };
      expect(body).toMatchObject({
        id: expect.any(String) as unknown as string,
        user_id: expect.any(String) as unknown as string,
        name: 'Meu Canal',
        slug: expect.stringMatching(/^[a-z0-9-]+$/) as unknown as string,
        created_at: expect.any(String) as unknown as string,
      });
      expect(body.slug).toContain('meu-canal');
    });

    it('1.2. duplicate-slug-returns-409 — second request with same slug returns CHANNEL_SLUG_TAKEN', async () => {
      await request(app.getHttpServer())
        .post('/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Canal Teste', slug: 'canal-teste' });

      const res = await request(app.getHttpServer())
        .post('/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Outro Canal', slug: 'canal-teste' });

      expect(res.status).toBe(409);
      const body = res.body as { error: string };
      expect(body.error).toBe('CHANNEL_SLUG_TAKEN');
    });

    it('1.3. unauthenticated-returns-401 — request without Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/channels')
        .send({ name: 'Canal' });

      expect(res.status).toBe(401);
    });
  });
});
