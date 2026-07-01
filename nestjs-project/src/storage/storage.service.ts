import { Injectable } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

export interface ObjectStream {
  body: Readable;
  contentLength: number | undefined;
  contentRange?: string;
}

@Injectable()
export class StorageService {
  constructor(private readonly s3: S3Client) {}

  async initiateMultipartUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!UploadId) {
      throw new Error('MinIO did not return an UploadId');
    }
    return UploadId;
  }

  async generatePresignedPartUrl(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: 3600 },
    );
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<{ location?: string; etag?: string }> {
    const { Location, ETag } = await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    return { location: Location, etag: ETag };
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async getObjectStream(
    bucket: string,
    key: string,
    range?: string,
  ): Promise<ObjectStream> {
    const { Body, ContentLength, ContentRange } = await this.s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    );
    if (!Body) {
      throw new Error(`S3 returned empty body for key: ${key}`);
    }
    return {
      body: Body as Readable,
      contentLength: ContentLength,
      ...(ContentRange ? { contentRange: ContentRange } : {}),
    };
  }
}
