import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { VideosModule } from '../videos/videos.module';
import { Video } from '../videos/entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { VideoProcessorConsumer } from './video.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ConfigModule.forFeature(storageConfig),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule.forFeature(databaseConfig)],
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.name,
        entities: [Video, Channel, User],
        synchronize: false,
      }),
    }),
    StorageModule,
    QueueModule,
    VideosModule,
  ],
  providers: [VideoProcessorConsumer],
})
export class WorkerModule {}
