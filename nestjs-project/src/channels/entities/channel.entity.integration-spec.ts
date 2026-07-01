import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from './channel.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken];

describe('Channel entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
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
        email: `ch_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  it('should enforce unique slug constraint', async () => {
    const user1 = await createUser();
    const user2 = await createUser();

    await channelRepository.save(
      channelRepository.create({
        name: 'Channel One',
        slug: 'chan',
        user_id: user1.id,
      }),
    );

    await expect(
      channelRepository.save(
        channelRepository.create({
          name: 'Channel Two',
          slug: 'chan',
          user_id: user2.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should allow multiple channels per user (ManyToOne)', async () => {
    const user = await createUser();

    await channelRepository.save(
      channelRepository.create({
        name: 'Channel One',
        slug: 'chan-one',
        user_id: user.id,
      }),
    );
    await channelRepository.save(
      channelRepository.create({
        name: 'Channel Two',
        slug: 'chan-two',
        user_id: user.id,
      }),
    );

    const channels = await channelRepository.find({
      where: { user_id: user.id },
    });
    expect(channels).toHaveLength(2);
  });

  it('should load the related user via the ManyToOne relation', async () => {
    const user = await createUser();
    await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        slug: 'relchan',
        user_id: user.id,
      }),
    );

    const found = await channelRepository.findOne({
      where: { slug: 'relchan' },
      relations: ['user'],
    });

    expect(found?.user.email).toBe(user.email);
  });

  it('should enforce slug max length of 255 characters', async () => {
    const user = await createUser();
    const longSlug = 'a'.repeat(256);

    await expect(
      channelRepository.save(
        channelRepository.create({
          name: 'Chan',
          slug: longSlug,
          user_id: user.id,
        }),
      ),
    ).rejects.toThrow();
  });
});
