import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/auth.types';
import { UploadService } from './upload.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PresignedPartsDto } from './dto/presigned-parts.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { AbortUploadDto } from './dto/abort-upload.dto';

@ApiTags('upload')
@ApiBearerAuth('access-token')
@Controller('videos')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('upload/initiate')
  @HttpCode(HttpStatus.CREATED)
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.uploadService.initiateUpload(user.sub, dto);
  }

  @Post(':videoId/upload/presigned-parts')
  @HttpCode(HttpStatus.OK)
  async getPresignedParts(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: PresignedPartsDto,
  ) {
    return this.uploadService.getPresignedParts(user.sub, videoId, dto);
  }

  @Post(':videoId/upload/complete')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.uploadService.completeUpload(user.sub, videoId, dto);
  }

  @Delete(':videoId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: AbortUploadDto,
  ) {
    await this.uploadService.abortUpload(user.sub, videoId, dto.uploadId);
  }
}
