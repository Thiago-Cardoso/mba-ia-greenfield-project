import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { ChannelsModule } from '../channels/channels.module';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';
import { VideoController } from './video.controller';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ConfigModule.forFeature(storageConfig),
    StorageModule,
    QueueModule,
    ChannelsModule,
  ],
  controllers: [UploadController, VideoController],
  providers: [VideosService, UploadService],
  exports: [VideosService],
})
export class VideosModule {}
