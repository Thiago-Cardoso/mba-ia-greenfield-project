import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Res,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideoController {
  constructor(
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
  ) {}

  @Public()
  @Get(':slug')
  @ApiOperation({
    summary: 'Get video metadata',
    description:
      'Returns metadata for a video. Ready videos are public; non-ready videos are owner-only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
        title: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'processing', 'ready', 'error'],
        },
        channel: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
          },
        },
        thumbnailUrl: { type: 'string', nullable: true },
        durationSeconds: { type: 'number', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Access denied',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getMetadata(
    @Param('slug') slug: string,
    @Req() req: Request & { user?: JwtPayload },
  ) {
    const video = await this.videosService.getPublicVideoBySlug(
      slug,
      req.user?.sub,
    );

    const thumbnailUrl = video.thumbnail_key
      ? await this.storageService.generatePresignedGetUrl(
          this.storageCfg.thumbnailBucket,
          video.thumbnail_key,
        )
      : null;

    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      channel: {
        id: video.channel.id,
        name: video.channel.name,
        slug: video.channel.slug,
      },
      thumbnailUrl,
      durationSeconds: video.duration_seconds,
      createdAt: video.created_at,
    };
  }

  @Public()
  @Get(':slug/stream')
  @ApiOperation({
    summary: 'Stream video',
    description:
      'Streams the video file. Supports HTTP Range Requests (returns 206 Partial Content). Video must have status "ready".',
  })
  @ApiResponse({ status: 200, description: 'Full video stream' })
  @ApiResponse({
    status: 206,
    description: 'Partial video stream (Range request)',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @Param('slug') slug: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const video = await this.videosService.getReadyVideoBySlug(slug);
    const { body, contentLength, contentRange } =
      await this.storageService.getObjectStream(
        this.storageCfg.videoBucket,
        video.storage_key!, // guarded by getReadyVideoBySlug
        range,
      );

    res.set('Accept-Ranges', 'bytes');

    if (range && contentRange) {
      res.status(206);
      res.set('Content-Range', contentRange);
    }

    if (contentLength !== undefined) {
      res.set('Content-Length', String(contentLength));
    }

    return new StreamableFile(body, { type: 'video/mp4' });
  }

  @Public()
  @Get(':slug/download')
  @ApiOperation({
    summary: 'Download video',
    description:
      'Returns the full video file as a downloadable attachment. Video must have status "ready".',
  })
  @ApiResponse({ status: 200, description: 'Video file download' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const video = await this.videosService.getReadyVideoBySlug(slug);
    const { body, contentLength } = await this.storageService.getObjectStream(
      this.storageCfg.videoBucket,
      video.storage_key!, // guarded by getReadyVideoBySlug
    );

    const asciiName = `${video.title}.mp4`
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/"/g, "'");
    const encodedName = encodeURIComponent(`${video.title}.mp4`);
    res.set(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    );

    if (contentLength !== undefined) {
      res.set('Content-Length', String(contentLength));
    }

    return new StreamableFile(body, { type: 'video/mp4' });
  }
}
