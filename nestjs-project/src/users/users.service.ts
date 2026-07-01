import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelSlugTakenException } from '../channels/exceptions/channels.exceptions';
import { slugify } from '../channels/slug.util';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly channelsService: ChannelsService,
  ) {}

  async createUserWithChannel(
    email: string,
    hashedPassword: string,
  ): Promise<User> {
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
    });
    const savedUser = await this.userRepository.save(user);

    try {
      const emailPrefix = email.split('@')[0];
      const name = emailPrefix;
      const baseSlug = slugify(emailPrefix) || 'channel';

      let channel: Channel | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
        const slug = `${baseSlug}-${suffix}`;
        try {
          channel = await this.channelsService.createChannel(
            savedUser.id,
            name,
            slug,
          );
          break;
        } catch (err) {
          if (err instanceof ChannelSlugTakenException && attempt < 2) continue;
          throw err;
        }
      }

      savedUser.channels = [channel!];
      return savedUser;
    } catch (err) {
      await this.userRepository.delete(savedUser.id);
      throw err;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByEmailWithChannel(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: ['channels'],
    });
  }

  async save(user: User): Promise<User> {
    return this.userRepository.save(user);
  }
}
