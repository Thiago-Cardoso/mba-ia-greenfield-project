import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule.forFeature(queueConfig)],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: { host: config.host, port: config.port },
      }),
    }),
    BullModule.registerQueue({ name: 'video-processing' }),
    BullBoardModule.forFeature({
      name: 'video-processing',
      adapter: BullMQAdapter,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
