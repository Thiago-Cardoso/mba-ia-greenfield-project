import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.MINIO_ENDPOINT ?? 'http://minio:9000',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'streamtube',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'streamtube',
  region: process.env.MINIO_REGION ?? 'us-east-1',
  videoBucket: process.env.VIDEO_BUCKET ?? 'streamtube-videos',
  thumbnailBucket: process.env.THUMBNAIL_BUCKET ?? 'streamtube-thumbnails',
}));
