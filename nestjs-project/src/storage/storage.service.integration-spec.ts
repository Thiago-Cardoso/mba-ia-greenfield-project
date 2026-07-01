import 'dotenv/config';
import { S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

const BUCKET = process.env.VIDEO_BUCKET ?? 'streamtube-videos';
const ENDPOINT = process.env.MINIO_ENDPOINT ?? 'http://minio:9000';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? 'streamtube';
const SECRET_KEY = process.env.MINIO_SECRET_KEY ?? 'streamtube';
const REGION = process.env.MINIO_REGION ?? 'us-east-1';

function makeS3Client(): S3Client {
  return new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
}

async function streamToBuffer(
  readable: NodeJS.ReadableStream,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('StorageService (integration)', () => {
  let service: StorageService;
  const ts = Date.now();

  beforeAll(() => {
    service = new StorageService(makeS3Client());
  });

  describe('multipart upload lifecycle', () => {
    it('initiateMultipartUpload returns a non-empty UploadId', async () => {
      const key = `integration-test/${ts}/initiate-only.bin`;
      const uploadId = await service.initiateMultipartUpload(
        BUCKET,
        key,
        'application/octet-stream',
      );
      expect(typeof uploadId).toBe('string');
      expect(uploadId.length).toBeGreaterThan(0);

      await service.abortMultipartUpload(BUCKET, key, uploadId);
    });

    it('generatePresignedPartUrl returns a URL that accepts PUT', async () => {
      const key = `integration-test/${ts}/presign-test.bin`;
      const uploadId = await service.initiateMultipartUpload(
        BUCKET,
        key,
        'application/octet-stream',
      );

      const url = await service.generatePresignedPartUrl(
        BUCKET,
        key,
        uploadId,
        1,
      );
      expect(url).toMatch(/^https?:\/\//);

      const body = Buffer.alloc(5 * 1024 * 1024, 'a');
      const res = await fetch(url, {
        method: 'PUT',
        body,
        headers: { 'Content-Length': String(body.byteLength) },
      });
      expect(res.status).toBe(200);
      const etag = res.headers.get('etag');
      expect(etag).toBeTruthy();

      await service.abortMultipartUpload(BUCKET, key, uploadId);
    });

    it('completeMultipartUpload makes object accessible via getObjectStream', async () => {
      const key = `integration-test/${ts}/complete-test.bin`;
      const content = Buffer.alloc(5 * 1024 * 1024, 'z');
      const uploadId = await service.initiateMultipartUpload(
        BUCKET,
        key,
        'application/octet-stream',
      );

      const url = await service.generatePresignedPartUrl(
        BUCKET,
        key,
        uploadId,
        1,
      );
      const putRes = await fetch(url, {
        method: 'PUT',
        body: content,
        headers: { 'Content-Length': String(content.byteLength) },
      });
      const etag = putRes.headers.get('etag') ?? '';

      await service.completeMultipartUpload(BUCKET, key, uploadId, [
        { PartNumber: 1, ETag: etag },
      ]);

      const { body, contentLength } = await service.getObjectStream(
        BUCKET,
        key,
      );
      const downloaded = await streamToBuffer(body);
      expect(downloaded.length).toBe(content.length);
      expect(contentLength).toBe(content.length);
    });

    it('abortMultipartUpload cancels upload; object not accessible afterwards', async () => {
      const key = `integration-test/${ts}/abort-only.bin`;
      const uploadId = await service.initiateMultipartUpload(
        BUCKET,
        key,
        'application/octet-stream',
      );
      await service.abortMultipartUpload(BUCKET, key, uploadId);

      await expect(service.getObjectStream(BUCKET, key)).rejects.toThrow();
    });
  });

  describe('getObjectStream', () => {
    const rangeKey = `integration-test/${Date.now()}/range-file.bin`;

    beforeAll(async () => {
      const content = Buffer.alloc(500, 'r');
      const uploadId = await service.initiateMultipartUpload(
        BUCKET,
        rangeKey,
        'application/octet-stream',
      );
      const url = await service.generatePresignedPartUrl(
        BUCKET,
        rangeKey,
        uploadId,
        1,
      );
      const putRes = await fetch(url, {
        method: 'PUT',
        body: content,
        headers: { 'Content-Length': String(content.byteLength) },
      });
      const etag = putRes.headers.get('etag') ?? '';
      await service.completeMultipartUpload(BUCKET, rangeKey, uploadId, [
        { PartNumber: 1, ETag: etag },
      ]);
    });

    it('returns full object without range header', async () => {
      const { body, contentLength } = await service.getObjectStream(
        BUCKET,
        rangeKey,
      );
      const buf = await streamToBuffer(body);
      expect(buf.length).toBe(500);
      expect(contentLength).toBe(500);
    });

    it('returns 100-byte chunk with contentRange when Range header is provided', async () => {
      const { body, contentLength, contentRange } =
        await service.getObjectStream(BUCKET, rangeKey, 'bytes=0-99');
      const buf = await streamToBuffer(body);
      expect(buf.length).toBe(100);
      expect(contentLength).toBe(100);
      expect(contentRange).toBeDefined();
      expect(contentRange).toMatch(/^bytes 0-99\/500$/);
    });
  });
});
