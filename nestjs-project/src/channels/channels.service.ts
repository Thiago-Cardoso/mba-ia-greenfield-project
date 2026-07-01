import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ChannelSlugTakenException } from './exceptions/channels.exceptions';
import { Channel } from './entities/channel.entity';
import { slugify } from './slug.util';

function isPgUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const pgErr = err as QueryFailedError & { code: string };
  return pgErr.code === '23505';
}

@Injectable()
export class ChannelsService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {}

  async createChannel(
    userId: string,
    name: string,
    slug?: string,
  ): Promise<Channel> {
    const channelSlug = slug ?? slugify(name);

    try {
      const channel = this.channelRepository.create({
        user_id: userId,
        name,
        slug: channelSlug,
      });
      return await this.channelRepository.save(channel);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new ChannelSlugTakenException();
      }
      throw err;
    }
  }
}
