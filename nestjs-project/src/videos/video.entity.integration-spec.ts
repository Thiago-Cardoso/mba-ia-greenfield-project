import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let channelRepo: Repository<Channel>;
  let videoRepo: Repository<Video>;

  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepo = dataSource.getRepository(User);
    channelRepo = dataSource.getRepository(Channel);
    videoRepo = dataSource.getRepository(Video);

    const user = await userRepo.save(
      userRepo.create({ email: 'video_test@example.com', password: 'hashed' }),
    );
    const channel = await channelRepo.save(
      channelRepo.create({
        user_id: user.id,
        name: 'Test Channel',
        slug: 'test-channel',
      }),
    );
    channelId = channel.id;
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "refresh_tokens"');
    await dataSource.query('DELETE FROM "verification_tokens"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
    await dataSource.destroy();
  });

  afterEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
  });

  it('persists a video with status default draft', async () => {
    const video = videoRepo.create({
      channel_id: channelId,
      title: 'My Video',
      slug: 'abc12345678',
      upload_id: 'upload-1',
    });
    const saved = await videoRepo.save(video);

    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.id).toBeDefined();
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
  });

  it('enforces unique slug constraint', async () => {
    const v1 = videoRepo.create({
      channel_id: channelId,
      title: 'Video 1',
      slug: 'uniqueslug1',
      upload_id: 'upload-2',
    });
    await videoRepo.save(v1);

    const v2 = videoRepo.create({
      channel_id: channelId,
      title: 'Video 2',
      slug: 'uniqueslug1',
      upload_id: 'upload-3',
    });
    await expect(videoRepo.save(v2)).rejects.toThrow();
  });

  it('enforces not-null channel_id FK', async () => {
    const video = videoRepo.create({
      title: 'No Channel',
      slug: 'nochannelslug',
      upload_id: 'upload-4',
    } as Partial<Video> as Video);
    await expect(videoRepo.save(video)).rejects.toThrow();
  });

  it('auto-updates updated_at on change', async () => {
    const video = videoRepo.create({
      channel_id: channelId,
      title: 'Original Title',
      slug: 'updatetest1',
      upload_id: 'upload-5',
    });
    const saved = await videoRepo.save(video);
    const originalUpdatedAt = saved.updated_at;

    await new Promise((r) => setTimeout(r, 10));
    saved.title = 'Updated Title';
    const updated = await videoRepo.save(saved);

    expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(
      originalUpdatedAt.getTime(),
    );
  });
});
