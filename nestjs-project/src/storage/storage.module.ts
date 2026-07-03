import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule.forFeature(storageConfig)],
  providers: [
    {
      provide: S3Client,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>): S3Client =>
        new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
          },
        }),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
