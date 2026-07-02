import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoNotFoundException } from './exceptions/videos.exceptions';
import { generateVideoSlug } from './slug.util';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
  ) {}

  async createDraftVideo(
    channelId: string,
    title: string,
    uploadId: string | null = null,
  ): Promise<Video> {
    const slug = generateVideoSlug();
    const video = this.videoRepository.create({
      channel_id: channelId,
      title,
      upload_id: uploadId,
      slug,
      status: VideoStatus.DRAFT,
    });
    return this.videoRepository.save(video);
  }

  async setUploadId(id: string, uploadId: string): Promise<void> {
    const result = await this.videoRepository.update(id, {
      upload_id: uploadId,
    });
    if ((result.affected ?? 0) === 0) throw new VideoNotFoundException();
  }

  async deleteVideo(id: string): Promise<void> {
    await this.videoRepository.delete({ id });
  }

  async findByIdOrFail(id: string): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  async findBySlugOrFail(slug: string): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { slug } });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  async updateStatus(id: string, status: VideoStatus): Promise<void> {
    const result = await this.videoRepository.update(id, { status });
    if ((result.affected ?? 0) === 0) throw new VideoNotFoundException();
  }

  async updateAfterProcessing(
    id: string,
    data: {
      storageKey: string;
      thumbnailKey: string;
      durationSeconds: number;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const video = await this.findByIdOrFail(id);
    video.storage_key = data.storageKey;
    video.thumbnail_key = data.thumbnailKey;
    video.duration_seconds = data.durationSeconds;
    video.metadata = data.metadata;
    video.status = VideoStatus.READY;
    await this.videoRepository.save(video);
  }
}
