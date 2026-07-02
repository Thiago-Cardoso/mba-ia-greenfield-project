import { Queue } from 'bullmq';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../../config/storage.config';
import type { StorageService } from '../../storage/storage.service';
import type { ChannelsService } from '../../channels/channels.service';
import type { VideosService } from '../videos.service';
import { VideoStatus } from '../entities/video.entity';
import {
  VideoAccessDeniedException,
  VideoNotInDraftException,
} from '../exceptions/videos.exceptions';
import { ChannelNotFoundException } from '../../channels/exceptions/channels.exceptions';
import { UploadService } from './upload.service';

function makeStorageCfg(
  overrides: Partial<ConfigType<typeof storageConfig>> = {},
): ConfigType<typeof storageConfig> {
  return {
    endpoint: 'http://minio:9000',
    accessKey: 'key',
    secretKey: 'secret',
    region: 'us-east-1',
    videoBucket: 'streamtube-videos',
    thumbnailBucket: 'streamtube-thumbnails',
    ...overrides,
  } as ConfigType<typeof storageConfig>;
}

function makeStorage(
  overrides: Record<string, jest.Mock> = {},
): StorageService {
  return {
    initiateMultipartUpload: jest.fn(),
    generatePresignedPartUrl: jest.fn(),
    completeMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    ...overrides,
  } as unknown as StorageService;
}

function makeChannels(
  overrides: Record<string, jest.Mock> = {},
): ChannelsService {
  return {
    findChannelForUser: jest.fn(),
    createChannel: jest.fn(),
    ...overrides,
  } as unknown as ChannelsService;
}

function makeVideos(overrides: Record<string, jest.Mock> = {}): VideosService {
  return {
    createDraftVideo: jest.fn(),
    setUploadId: jest.fn(),
    findByIdOrFail: jest.fn(),
    updateStatus: jest.fn(),
    deleteVideo: jest.fn(),
    findBySlugOrFail: jest.fn(),
    updateAfterProcessing: jest.fn(),
    ...overrides,
  } as unknown as VideosService;
}

function makeQueue(overrides: Record<string, jest.Mock> = {}): Queue {
  return {
    add: jest.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as Queue;
}

function makeVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'video-uuid',
    channel_id: 'channel-uuid',
    status: VideoStatus.DRAFT,
    upload_id: 'upload-id',
    slug: 'abc12345678',
    title: 'Test',
    ...overrides,
  };
}

function makeService(deps: {
  storage?: StorageService;
  channels?: ChannelsService;
  videos?: VideosService;
  queue?: Queue;
}) {
  const cfg = makeStorageCfg();
  const storage = deps.storage ?? makeStorage();
  const channels = deps.channels ?? makeChannels();
  const videos = deps.videos ?? makeVideos();
  const queue = deps.queue ?? makeQueue();
  const service = new UploadService(cfg, storage, channels, videos, queue);
  return { service, cfg, storage, channels, videos, queue };
}

describe('UploadService', () => {
  describe('initiateUpload', () => {
    it('creates a draft video and returns upload info', async () => {
      const video = makeVideo({ id: 'vid-1' });
      const { service } = makeService({
        videos: makeVideos({
          createDraftVideo: jest.fn().mockResolvedValue(video),
          setUploadId: jest.fn().mockResolvedValue(undefined),
        }),
        storage: makeStorage({
          initiateMultipartUpload: jest.fn().mockResolvedValue('s3-upload-id'),
        }),
        channels: makeChannels({
          findChannelForUser: jest
            .fn()
            .mockResolvedValue({ id: 'channel-uuid' }),
        }),
      });

      const result = await service.initiateUpload('user-1', {
        channelId: 'channel-uuid',
        title: 'My Video',
        fileSize: 10_485_760,
        contentType: 'video/mp4',
      });

      expect(result.videoId).toBe('vid-1');
      expect(result.uploadId).toBe('s3-upload-id');
      expect(result.partSize).toBe(8_388_608);
      expect(result.totalParts).toBe(2);
    });

    it('stores the uploadId on the video after S3 initiation', async () => {
      const video = makeVideo({ id: 'vid-1' });
      const setUploadId = jest.fn().mockResolvedValue(undefined);
      const { service } = makeService({
        videos: makeVideos({
          createDraftVideo: jest.fn().mockResolvedValue(video),
          setUploadId,
        }),
        storage: makeStorage({
          initiateMultipartUpload: jest.fn().mockResolvedValue('s3-upload-id'),
        }),
      });

      await service.initiateUpload('user-1', {
        channelId: 'channel-uuid',
        title: 'My Video',
        fileSize: 8_388_608,
        contentType: 'video/mp4',
      });

      expect(setUploadId).toHaveBeenCalledWith('vid-1', 's3-upload-id');
    });

    it('uses videoId as storage key prefix', async () => {
      const video = makeVideo({ id: 'vid-123' });
      const initiateMultipartUpload = jest.fn().mockResolvedValue('uid');
      const { service } = makeService({
        videos: makeVideos({
          createDraftVideo: jest.fn().mockResolvedValue(video),
          setUploadId: jest.fn().mockResolvedValue(undefined),
        }),
        storage: makeStorage({ initiateMultipartUpload }),
      });

      await service.initiateUpload('user-1', {
        channelId: 'channel-uuid',
        title: 'T',
        fileSize: 1,
        contentType: 'video/mp4',
      });

      expect(initiateMultipartUpload).toHaveBeenCalledWith(
        'streamtube-videos',
        'vid-123/original.mp4',
        'video/mp4',
      );
    });

    it('throws ChannelNotFoundException when channel does not belong to user', async () => {
      const { service } = makeService({
        channels: makeChannels({
          findChannelForUser: jest
            .fn()
            .mockRejectedValue(new ChannelNotFoundException()),
        }),
      });

      await expect(
        service.initiateUpload('wrong-user', {
          channelId: 'channel-uuid',
          title: 'T',
          fileSize: 1,
          contentType: 'video/mp4',
        }),
      ).rejects.toBeInstanceOf(ChannelNotFoundException);
    });
  });

  describe('completeUpload', () => {
    it('completes multipart upload and enqueues job', async () => {
      const add = jest.fn().mockResolvedValue({});
      const updateStatus = jest.fn().mockResolvedValue(undefined);
      const { service } = makeService({
        videos: makeVideos({
          findByIdOrFail: jest.fn().mockResolvedValue(makeVideo()),
          updateStatus,
        }),
        storage: makeStorage({
          completeMultipartUpload: jest.fn().mockResolvedValue({}),
        }),
        channels: makeChannels({
          findChannelForUser: jest
            .fn()
            .mockResolvedValue({ id: 'channel-uuid' }),
        }),
        queue: makeQueue({ add }),
      });

      const result = await service.completeUpload('user-1', 'video-uuid', {
        uploadId: 'uid',
        parts: [{ partNumber: 1, etag: '"abc"' }],
      });

      expect(result).toEqual({ videoId: 'video-uuid', status: 'processing' });
      expect(add).toHaveBeenCalledWith(
        'video.process',
        { videoId: 'video-uuid', storageKey: 'video-uuid/original.mp4' },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
      expect(updateStatus).toHaveBeenCalledWith(
        'video-uuid',
        VideoStatus.PROCESSING,
      );
    });

    it('throws VideoAccessDeniedException when user does not own the video', async () => {
      const { service } = makeService({
        videos: makeVideos({
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(makeVideo({ channel_id: 'channel-uuid' })),
        }),
        channels: makeChannels({
          findChannelForUser: jest
            .fn()
            .mockRejectedValue(new ChannelNotFoundException()),
        }),
      });

      await expect(
        service.completeUpload('other-user', 'video-uuid', {
          uploadId: 'uid',
          parts: [{ partNumber: 1, etag: '"abc"' }],
        }),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
    });

    it('throws VideoNotInDraftException when video is not draft', async () => {
      const { service } = makeService({
        videos: makeVideos({
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(makeVideo({ status: VideoStatus.PROCESSING })),
        }),
        channels: makeChannels({
          findChannelForUser: jest
            .fn()
            .mockResolvedValue({ id: 'channel-uuid' }),
        }),
      });

      await expect(
        service.completeUpload('user-1', 'video-uuid', {
          uploadId: 'uid',
          parts: [{ partNumber: 1, etag: '"abc"' }],
        }),
      ).rejects.toBeInstanceOf(VideoNotInDraftException);
    });
  });

  describe('abortUpload', () => {
    it('aborts S3 upload and deletes the video', async () => {
      const abortMultipartUpload = jest.fn().mockResolvedValue(undefined);
      const deleteVideo = jest.fn().mockResolvedValue(undefined);
      const { service } = makeService({
        videos: makeVideos({
          findByIdOrFail: jest.fn().mockResolvedValue(makeVideo()),
          deleteVideo,
        }),
        storage: makeStorage({ abortMultipartUpload }),
        channels: makeChannels({
          findChannelForUser: jest
            .fn()
            .mockResolvedValue({ id: 'channel-uuid' }),
        }),
      });

      await service.abortUpload('user-1', 'video-uuid', 'uid');

      expect(abortMultipartUpload).toHaveBeenCalledWith(
        'streamtube-videos',
        'video-uuid/original.mp4',
        'uid',
      );
      expect(deleteVideo).toHaveBeenCalledWith('video-uuid');
    });
  });
});
