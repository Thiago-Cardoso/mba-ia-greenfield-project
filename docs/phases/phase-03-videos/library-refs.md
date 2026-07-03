---
libs:
  "@nestjs/bullmq":
    version: "latest"
    fetched_at: "2026-07-01T01:49:35Z"
  "bullmq":
    version: "latest"
    fetched_at: "2026-07-01T01:49:35Z"
  "ioredis":
    version: "latest"
    fetched_at: "2026-07-01T01:49:35Z"
  "@aws-sdk/client-s3":
    version: "latest"
    fetched_at: "2026-07-01T01:49:35Z"
  "@aws-sdk/s3-request-presigner":
    version: "latest"
    fetched_at: "2026-07-01T01:49:35Z"
  "@aws-sdk/lib-storage":
    version: "latest"
    fetched_at: "2026-07-01T01:49:35Z"
  "fluent-ffmpeg":
    version: "^2.1.3"
    fetched_at: "2026-07-01T01:49:35Z"
  "nanoid":
    version: "^3.3.8"
    fetched_at: "2026-07-01T01:49:35Z"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-30T22:45:44-0300"
---

# library-refs — phase-03-videos

## @nestjs/bullmq + bullmq

**Source:** https://docs.nestjs.com/techniques/queues + https://docs.bullmq.io

### Registration (AppModule)

```typescript
import { BullModule } from '@nestjs/bullmq';

BullModule.forRoot({
  connection: {
    host: process.env.REDIS_HOST,   // Docker service name, e.g. 'redis'
    port: +process.env.REDIS_PORT,  // default 6379
  },
})

// Async variant with ConfigModule
BullModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (redisConfig: ConfigType<typeof redisConfig>) => ({
    connection: { host: redisConfig.host, port: redisConfig.port },
  }),
  inject: [redisConfig.KEY],
})
```

### Register Queue (feature module)

```typescript
BullModule.registerQueue({ name: 'video-processing' })
```

### Inject Queue to add jobs

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

constructor(@InjectQueue('video-processing') private queue: Queue) {}

await this.queue.add('process-video', { videoId }, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 50,
});
```

### Processor (WorkerHost pattern — @nestjs/bullmq ≥ 10)

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> {
    await job.updateProgress(0);
    // ... processing logic ...
    await job.updateProgress(100);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) { /* ... */ }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) { /* ... */ }
}
```

**Key JobsOptions:**

| Option | Type | Description |
|--------|------|-------------|
| `attempts` | number | Max retry attempts before `error` state |
| `backoff` | `{ type: 'exponential' \| 'fixed', delay: number }` | Retry delay strategy |
| `delay` | number | Initial delay in ms before first attempt |
| `removeOnComplete` | number \| boolean | Keep N completed jobs (or true to remove all) |
| `removeOnFail` | number \| boolean | Keep N failed jobs |

---

## ioredis

**Source:** https://github.com/redis/ioredis

```typescript
import Redis from 'ioredis';

// Used as BullMQ connection (pass instance or plain object)
const connection = { host: 'redis', port: 6379 };  // plain object (preferred with BullMQ)

// Or explicit instance
const redis = new Redis({ host: 'redis', port: 6379, maxRetriesPerRequest: null });
```

> **Note for BullMQ:** Pass `{ maxRetriesPerRequest: null }` when using ioredis instance directly with BullMQ — BullMQ requires this option for blocking commands.

---

## @aws-sdk/client-s3

**Source:** https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/

### S3Client (MinIO-compatible config)

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT,   // e.g. http://minio:9000
  region: process.env.MINIO_REGION ?? 'us-east-1',
  forcePathStyle: true,                   // REQUIRED for MinIO
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
});
```

### Multipart Upload flow (API → client → API)

```typescript
// 1. Initiate (API)
const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
  Bucket: 'streamtube-videos',
  Key: `${videoId}/original.mp4`,
  ContentType: 'video/mp4',
}));

// 2. Generate presigned URLs for N parts (API → returns to client)
// See @aws-sdk/s3-request-presigner below

// 3. Complete (API, after client uploads all parts)
await s3.send(new CompleteMultipartUploadCommand({
  Bucket: 'streamtube-videos',
  Key: `${videoId}/original.mp4`,
  UploadId,
  MultipartUpload: { Parts: [{ ETag: 'etag1', PartNumber: 1 }, ...] },
}));

// Abort on failure
await s3.send(new AbortMultipartUploadCommand({
  Bucket: 'streamtube-videos',
  Key: `${videoId}/original.mp4`,
  UploadId,
}));
```

### GetObjectCommand (streaming/download)

```typescript
const { Body, ContentLength } = await s3.send(new GetObjectCommand({
  Bucket: 'streamtube-videos',
  Key: `${videoId}/original.mp4`,
  Range: `bytes=${start}-${end}`,  // for range requests
}));

// Body is a ReadableStream (Node.js) — pipe to response
(Body as Readable).pipe(res);
```

---

## @aws-sdk/s3-request-presigner

**Source:** https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadPartCommand } from '@aws-sdk/client-s3';

// Presigned URL for client → MinIO direct upload (part)
const url = await getSignedUrl(
  s3,
  new UploadPartCommand({
    Bucket: 'streamtube-videos',
    Key: `${videoId}/original.mp4`,
    PartNumber: partNumber,
    UploadId: uploadId,
  }),
  { expiresIn: 3600 },  // seconds; default 900
);
```

---

## @aws-sdk/lib-storage

**Source:** https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/

Used in the **video worker** to upload processed thumbnail (simple PUT) or re-upload processed video. For small files (thumbnails), prefer `PutObjectCommand` directly. `lib-storage` is useful when the worker streams the thumbnail directly from FFmpeg.

```typescript
import { Upload } from '@aws-sdk/lib-storage';

const upload = new Upload({
  client: s3,
  params: {
    Bucket: 'streamtube-thumbnails',
    Key: `${videoId}/thumbnail.jpg`,
    Body: thumbnailStream,  // Readable stream from FFmpeg
    ContentType: 'image/jpeg',
  },
  partSize: 5 * 1024 * 1024,  // 5 MB (minimum)
  queueSize: 1,               // serial upload for thumbnails
});

upload.on('httpUploadProgress', (progress) => { /* progress.loaded, progress.total */ });
const result = await upload.done();
```

---

## fluent-ffmpeg

**Source:** https://github.com/fluent-ffmpeg/node-fluent-ffmpeg

> ⚠️ **Archived May 2025.** fluent-ffmpeg is feature-complete and stable but no longer maintained. For Phase 03 implementation it remains the most ergonomic Node.js wrapper for FFmpeg CLI. Alternative: invoke `ffprobe`/`ffmpeg` directly via `child_process.execFile` or `execa` if maintenance concerns arise.

### ffprobe — extract metadata

```typescript
import Ffmpeg from 'fluent-ffmpeg';

const metadata = await new Promise<Ffmpeg.FfprobeData>((resolve, reject) => {
  Ffmpeg.ffprobe(localVideoPath, (err, data) => {
    if (err) reject(err);
    else resolve(data);
  });
});

const duration = metadata.format.duration;       // seconds (float)
const videoStream = metadata.streams.find(s => s.codec_type === 'video');
const { width, height, codec_name } = videoStream;
```

### Thumbnail generation

```typescript
await new Promise<void>((resolve, reject) => {
  Ffmpeg(localVideoPath)
    .screenshots({
      timestamps: ['50%'],          // at 50% of the video duration
      filename: 'thumbnail.jpg',
      folder: outputDir,
      size: '1280x720',
    })
    .on('end', () => resolve())
    .on('error', reject);
});
```

### Faststart (re-encode with moov atom at start)

```typescript
await new Promise<void>((resolve, reject) => {
  Ffmpeg(localVideoPath)
    .outputOptions('-movflags +faststart')
    .output(outputPath)
    .on('end', () => resolve())
    .on('error', reject);
});
```

### Binary paths (via environment variables — preferred in Docker)

```
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
```

Or programmatically:
```typescript
Ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg');
Ffmpeg.setFfprobePath(process.env.FFPROBE_PATH ?? '/usr/bin/ffprobe');
```

---

## nanoid (v3.x — CommonJS)

**Source:** https://github.com/ai/nanoid/tree/3.x

> nanoid v4+ is ESM-only. **Pin to `nanoid@^3.3.x`** for NestJS CommonJS projects.

### Usage

```typescript
// CommonJS import (NestJS default module system)
import { nanoid } = require('nanoid');         // TypeScript with esModuleInterop
// or
const { nanoid } = require('nanoid');

// Generate 11-char URL-safe slug
const slug = nanoid(11);  // e.g. "V1StGXR8_Z5"
```

**Alphabet:** `A-Za-z0-9_-` (64 chars, URL-safe, no encoding needed)
**Entropy at 11 chars:** ~70 bits — 1 collision in 1 billion at 2M videos
**Default length:** 21 chars — always pass `11` explicitly for video slugs

```typescript
// In Video entity / service
import { nanoid } from 'nanoid';

const slug = nanoid(11);  // called at video creation time
```
