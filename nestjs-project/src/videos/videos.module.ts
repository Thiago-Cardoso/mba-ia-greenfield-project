import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [TypeOrmModule.forFeature([Video]), QueueModule],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
