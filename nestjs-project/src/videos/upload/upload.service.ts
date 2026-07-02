import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import storageConfig from '../../config/storage.config';
import { StorageService } from '../../storage/storage.service';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelNotFoundException } from '../../channels/exceptions/channels.exceptions';
import { VideosService } from '../videos.service';
import { VideoStatus } from '../entities/video.entity';
import {
  VideoAccessDeniedException,
  VideoNotInDraftException,
} from '../exceptions/videos.exceptions';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { PresignedPartsDto } from './dto/presigned-parts.dto';
import type { CompleteUploadDto } from './dto/complete-upload.dto';

const PART_SIZE = 8_388_608;

@Injectable()
export class UploadService {
  constructor(
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
    private readonly videosService: VideosService,
    @InjectQueue('video-processing') private readonly queue: Queue,
  ) {}

  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<{
    videoId: string;
    uploadId: string;
    partSize: number;
    totalParts: number;
  }> {
    await this.assertOwnership(dto.channelId, userId);

    const video = await this.videosService.createDraftVideo(
      dto.channelId,
      dto.title,
    );

    let uploadId: string | undefined;
    try {
      uploadId = await this.storageService.initiateMultipartUpload(
        this.storageCfg.videoBucket,
        this.storageKeyFor(video.id),
        dto.contentType,
      );
      await this.videosService.setUploadId(video.id, uploadId);
    } catch (error) {
      if (uploadId) {
        await this.storageService
          .abortMultipartUpload(
            this.storageCfg.videoBucket,
            this.storageKeyFor(video.id),
            uploadId,
          )
          .catch(() => {});
      }
      await this.videosService.deleteVideo(video.id);
      throw error;
    }

    const totalParts = Math.ceil(dto.fileSize / PART_SIZE);
    return { videoId: video.id, uploadId, partSize: PART_SIZE, totalParts };
  }

  async getPresignedParts(
    userId: string,
    videoId: string,
    dto: PresignedPartsDto,
  ): Promise<{ parts: { partNumber: number; url: string }[] }> {
    const video = await this.videosService.findByIdOrFail(videoId);
    await this.assertOwnership(video.channel_id, userId);
    this.assertDraftStatus(video.status);

    const parts = await Promise.all(
      dto.partNumbers.map(async (partNumber) => {
        const url = await this.storageService.generatePresignedPartUrl(
          this.storageCfg.videoBucket,
          this.storageKeyFor(videoId),
          dto.uploadId,
          partNumber,
        );
        return { partNumber, url };
      }),
    );

    return { parts };
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteUploadDto,
  ): Promise<{ videoId: string; status: string }> {
    const video = await this.videosService.findByIdOrFail(videoId);
    await this.assertOwnership(video.channel_id, userId);
    this.assertDraftStatus(video.status);

    await this.storageService.completeMultipartUpload(
      this.storageCfg.videoBucket,
      this.storageKeyFor(videoId),
      dto.uploadId,
      dto.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    );

    await this.queue.add(
      'video.process',
      { videoId, storageKey: this.storageKeyFor(videoId) },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    await this.videosService.updateStatus(videoId, VideoStatus.PROCESSING);

    return { videoId, status: VideoStatus.PROCESSING };
  }

  async abortUpload(
    userId: string,
    videoId: string,
    uploadId: string,
  ): Promise<void> {
    const video = await this.videosService.findByIdOrFail(videoId);
    await this.assertOwnership(video.channel_id, userId);
    this.assertDraftStatus(video.status);

    await this.storageService
      .abortMultipartUpload(
        this.storageCfg.videoBucket,
        this.storageKeyFor(videoId),
        uploadId,
      )
      .catch(() => {});

    await this.videosService.deleteVideo(videoId);
  }

  private async assertOwnership(
    channelId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.channelsService.findChannelForUser(channelId, userId);
    } catch (error) {
      if (error instanceof ChannelNotFoundException) {
        throw new VideoAccessDeniedException();
      }
      throw error;
    }
  }

  private assertDraftStatus(status: VideoStatus): void {
    if (status !== VideoStatus.DRAFT) {
      throw new VideoNotInDraftException();
    }
  }

  private storageKeyFor(videoId: string): string {
    return `${videoId}/original.mp4`;
  }
}
