import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { ChannelSlugTakenException } from './exceptions/channels.exceptions';
import { ChannelsService } from './channels.service';
import { Channel } from './entities/channel.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('ChannelsService (integration)', () => {
  let dataSource: DataSource;
  let channelsService: ChannelsService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    channelsService = new ChannelsService(channelRepository);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function createUser(): Promise<User> {
    return userRepository.save(
      userRepository.create({
        email: `ch_svc_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  describe('createChannel', () => {
    it('persists a channel with auto-generated slug from name', async () => {
      const user = await createUser();

      const channel = await channelsService.createChannel(user.id, 'Meu Canal');

      expect(channel.id).toBeDefined();
      expect(channel.slug).toBe('meu-canal');
      expect(channel.name).toBe('Meu Canal');
      expect(channel.user_id).toBe(user.id);

      const persisted = await channelRepository.findOneBy({ user_id: user.id });
      expect(persisted).not.toBeNull();
      expect(persisted!.slug).toBe('meu-canal');
    });

    it('persists a channel with the provided slug', async () => {
      const user = await createUser();

      const channel = await channelsService.createChannel(
        user.id,
        'My Channel',
        'my-custom-slug',
      );

      expect(channel.slug).toBe('my-custom-slug');
    });

    it('allows multiple channels per user', async () => {
      const user = await createUser();

      await channelsService.createChannel(
        user.id,
        'Channel One',
        'channel-one',
      );
      await channelsService.createChannel(
        user.id,
        'Channel Two',
        'channel-two',
      );

      const channels = await channelRepository.find({
        where: { user_id: user.id },
      });
      expect(channels).toHaveLength(2);
    });

    it('throws ChannelSlugTakenException when slug is already taken', async () => {
      const user1 = await createUser();
      const user2 = await createUser();

      await channelsService.createChannel(user1.id, 'Channel', 'shared-slug');

      await expect(
        channelsService.createChannel(user2.id, 'Other Channel', 'shared-slug'),
      ).rejects.toThrow(ChannelSlugTakenException);
    });
  });
});
