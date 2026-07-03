import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import type { Channel } from './entities/channel.entity';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateChannelDto,
  ): Promise<Channel> {
    return this.channelsService.createChannel(user.sub, dto.name, dto.slug);
  }
}
