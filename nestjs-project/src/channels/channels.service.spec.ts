import { QueryFailedError, Repository } from 'typeorm';
import {
  ChannelSlugInvalidException,
  ChannelSlugTakenException,
} from './exceptions/channels.exceptions';
import { ChannelsService } from './channels.service';
import { Channel } from './entities/channel.entity';

function makeChannel(slug: string, name: string): Channel {
  const c = new Channel();
  c.id = 'uuid';
  c.slug = slug;
  c.name = name;
  c.user_id = 'user-id';
  c.created_at = new Date();
  return c;
}

function makeUniqueError(): QueryFailedError & {
  code: string;
  detail: string;
} {
  const err = new QueryFailedError('INSERT', [], new Error());
  return Object.assign(err, {
    code: '23505',
    detail: 'Key (slug)=(my-channel) already exists.',
  });
}

function makeRepo(
  overrides: Partial<jest.Mocked<Repository<Channel>>> = {},
): jest.Mocked<Repository<Channel>> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<Repository<Channel>>;
}

describe('ChannelsService', () => {
  describe('createChannel', () => {
    it('creates a channel with auto-generated slug when slug is not provided', async () => {
      const channel = makeChannel('meu-canal', 'Meu Canal');
      const repo = makeRepo({
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(repo);

      const result = await service.createChannel('user-id', 'Meu Canal');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-id',
          name: 'Meu Canal',
          slug: 'meu-canal',
        }),
      );
      expect(result.slug).toBe('meu-canal');
    });

    it('uses the provided slug when explicitly given', async () => {
      const channel = makeChannel('custom-slug', 'My Channel');
      const repo = makeRepo({
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(repo);

      const result = await service.createChannel(
        'user-id',
        'My Channel',
        'custom-slug',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'custom-slug' }),
      );
      expect(result.slug).toBe('custom-slug');
    });

    it('throws ChannelSlugInvalidException when name produces an empty slug', async () => {
      const repo = makeRepo();
      const service = new ChannelsService(repo);

      await expect(service.createChannel('user-id', '!!!')).rejects.toThrow(
        ChannelSlugInvalidException,
      );
    });

    it('throws ChannelSlugInvalidException when emoji-only name produces an empty slug', async () => {
      const repo = makeRepo();
      const service = new ChannelsService(repo);

      await expect(service.createChannel('user-id', '🎥')).rejects.toThrow(
        ChannelSlugInvalidException,
      );
    });

    it('throws ChannelSlugTakenException on unique constraint violation', async () => {
      const channel = makeChannel('taken-slug', 'My Channel');
      const repo = makeRepo({
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockRejectedValue(makeUniqueError()),
      });
      const service = new ChannelsService(repo);

      await expect(
        service.createChannel('user-id', 'My Channel', 'taken-slug'),
      ).rejects.toThrow(ChannelSlugTakenException);
    });

    it('re-throws non-unique errors immediately', async () => {
      const channel = makeChannel('my-channel', 'My Channel');
      const repo = makeRepo({
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockRejectedValue(new Error('Connection lost')),
      });
      const service = new ChannelsService(repo);

      await expect(
        service.createChannel('user-id', 'My Channel'),
      ).rejects.toThrow('Connection lost');
    });
  });
});
