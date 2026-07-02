import { Repository } from 'typeorm';
import { Video, VideoStatus } from './entities/video.entity';
import {
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoStorageCorruptException,
} from './exceptions/videos.exceptions';
import { VideosService } from './videos.service';

function makeVideo(overrides: Partial<Video> = {}): Video {
  const v = new Video();
  v.id = 'video-uuid';
  v.channel_id = 'channel-uuid';
  v.slug = 'abc12345678';
  v.title = 'Test Video';
  v.status = VideoStatus.DRAFT;
  v.upload_id = 'upload-1';
  v.storage_key = null;
  v.thumbnail_key = null;
  v.duration_seconds = null;
  v.metadata = null;
  v.channel = { user_id: 'owner-id' } as Video['channel'];
  v.created_at = new Date();
  v.updated_at = new Date();
  return Object.assign(v, overrides);
}

function makeRepo(
  overrides: Partial<jest.Mocked<Repository<Video>>> = {},
): jest.Mocked<Repository<Video>> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<Repository<Video>>;
}

describe('VideosService', () => {
  describe('createDraftVideo', () => {
    it('generates a slug of exactly 11 URL-safe characters', async () => {
      const video = makeVideo();
      const repo = makeRepo({
        create: jest.fn().mockReturnValue(video),
        save: jest.fn().mockResolvedValue(video),
      });
      const service = new VideosService(repo);

      const result = await service.createDraftVideo(
        'channel-uuid',
        'My Video',
        'upload-1',
      );

      expect(result).toBe(video);
      const [[createdWith]] = (repo.create as jest.Mock).mock.calls as [
        Partial<Video>,
      ][];
      expect(createdWith.slug).toHaveLength(11);
      expect(createdWith.slug).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('sets status to DRAFT', async () => {
      const video = makeVideo();
      const repo = makeRepo({
        create: jest.fn().mockReturnValue(video),
        save: jest.fn().mockResolvedValue(video),
      });
      const service = new VideosService(repo);

      await service.createDraftVideo('channel-uuid', 'My Video', 'upload-1');

      const [[createdWith]] = (repo.create as jest.Mock).mock.calls as [
        Partial<Video>,
      ][];
      expect(createdWith.status).toBe(VideoStatus.DRAFT);
    });

    it('generates distinct slugs on consecutive calls', async () => {
      const slugs = new Set<string>();
      const repo = makeRepo({
        create: jest.fn().mockImplementation((data: Partial<Video>) => {
          slugs.add(data.slug!);
          return makeVideo({ slug: data.slug });
        }),
        save: jest.fn().mockImplementation((v: Video) => Promise.resolve(v)),
      });
      const service = new VideosService(repo);

      for (let i = 0; i < 10; i++) {
        await service.createDraftVideo(
          'channel-uuid',
          `Video ${i}`,
          `upload-${i}`,
        );
      }

      expect(slugs.size).toBe(10);
    });
  });

  describe('findBySlugOrFail', () => {
    it('throws VideoNotFoundException when slug is not found', async () => {
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new VideosService(repo);

      await expect(service.findBySlugOrFail('not-found-slug')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('returns the video when slug matches', async () => {
      const video = makeVideo();
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      const result = await service.findBySlugOrFail('abc12345678');

      expect(result).toBe(video);
    });
  });

  describe('findByIdOrFail', () => {
    it('throws VideoNotFoundException when id is not found', async () => {
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new VideosService(repo);

      await expect(service.findByIdOrFail('unknown-id')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  describe('getPublicVideoBySlug', () => {
    it('returns a ready video to anonymous callers', async () => {
      const video = makeVideo({ status: VideoStatus.READY });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      const result = await service.getPublicVideoBySlug('abc12345678');

      expect(result).toBe(video);
    });

    it('throws VideoNotFoundException when slug does not match any video', async () => {
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new VideosService(repo);

      await expect(service.getPublicVideoBySlug('notfound')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotFoundException when video has no channel (orphaned FK)', async () => {
      const video = makeVideo({
        status: VideoStatus.READY,
        channel: null as unknown as Video['channel'],
      });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      await expect(service.getPublicVideoBySlug('abc12345678')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoAccessDeniedException for non-ready video with no userId', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSING });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      await expect(service.getPublicVideoBySlug('abc12345678')).rejects.toThrow(
        VideoAccessDeniedException,
      );
    });

    it('throws VideoAccessDeniedException for non-ready video when userId does not match owner', async () => {
      const video = makeVideo({
        status: VideoStatus.PROCESSING,
        channel: { user_id: 'owner-id' } as Video['channel'],
      });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      await expect(
        service.getPublicVideoBySlug('abc12345678', 'other-user'),
      ).rejects.toThrow(VideoAccessDeniedException);
    });

    it('returns non-ready video when userId matches the channel owner', async () => {
      const video = makeVideo({
        status: VideoStatus.PROCESSING,
        channel: { user_id: 'owner-id' } as Video['channel'],
      });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      const result = await service.getPublicVideoBySlug(
        'abc12345678',
        'owner-id',
      );

      expect(result).toBe(video);
    });
  });

  describe('getReadyVideoBySlug', () => {
    it('returns the video when status is ready and storage_key is set', async () => {
      const video = makeVideo({
        status: VideoStatus.READY,
        storage_key: 'uuid/original.mp4',
      });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      const result = await service.getReadyVideoBySlug('abc12345678');

      expect(result).toBe(video);
    });

    it('throws VideoNotFoundException when slug does not match any video', async () => {
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new VideosService(repo);

      await expect(service.getReadyVideoBySlug('notfound')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotReadyException when video status is not ready', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSING });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      await expect(service.getReadyVideoBySlug('abc12345678')).rejects.toThrow(
        VideoNotReadyException,
      );
    });

    it('throws VideoStorageCorruptException when video is READY but storage_key is null', async () => {
      const video = makeVideo({ status: VideoStatus.READY, storage_key: null });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const service = new VideosService(repo);

      await expect(service.getReadyVideoBySlug('abc12345678')).rejects.toThrow(
        VideoStorageCorruptException,
      );
    });
  });

  describe('updateStatus', () => {
    it('calls repository.update with the given status', async () => {
      const repo = makeRepo({
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      const service = new VideosService(repo);

      await service.updateStatus('video-uuid', VideoStatus.PROCESSING);

      const [[calledId, calledData]] = (repo.update as jest.Mock).mock
        .calls as [string, Partial<Video>][];
      expect(calledId).toBe('video-uuid');
      expect(calledData.status).toBe(VideoStatus.PROCESSING);
    });

    it('throws VideoNotFoundException when video does not exist', async () => {
      const repo = makeRepo({
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      });
      const service = new VideosService(repo);

      await expect(
        service.updateStatus('unknown-id', VideoStatus.PROCESSING),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });
});
