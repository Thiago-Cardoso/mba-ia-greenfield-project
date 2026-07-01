---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-06-30T22:50:49-0300"
  docs/phases/phase-03-videos/library-refs.md: "2026-06-30T22:50:25-0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-30T22:45:44-0300"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Implementar a infraestrutura de upload multipart (até 10 GB), fila de processamento (BullMQ + Redis), worker de vídeo (NestJS standalone + FFmpeg) e streaming/download (HTTP Range Requests 206), entregando: upload funcional, processamento automático com extração de metadados e thumbnail, streaming sem download completo e URLs únicas por vídeo.

---

## Step Implementations

### SI-03.1 — ChannelsModule (entity + service + controller)

**Description:** Cria a entidade Channel mínima (DG-1) com migration, service e o endpoint POST /channels — pré-requisito obrigatório para o FK channel_id da entidade Video.

**Route:** POST /channels
**Test Specs:** see `nestjs-project/specs/channels.plan.md`
**Authorization:** Authenticated

**Technical actions:**

1. Criar `src/channels/channel.entity.ts` com campos do Data Model (id uuid PK, user_id FK → users.id, name varchar(255), slug varchar(255) unique, created_at timestamptz) usando TypeORM decorators
2. Criar migration `CreateChannels` em `src/database/migrations/` — tabela `channels` com constraints, índice unique em slug e índice em user_id
3. Criar `src/channels/channels.service.ts` — métodos `createChannel` (auto-deriva slug do name se não fornecido via slugify, lança CHANNEL_SLUG_TAKEN em conflito de unique), `findByIdAndOwnerOrFail`
4. Criar `src/channels/channels.controller.ts` — `POST /channels` com JwtAuthGuard (global) + extrair user_id do JWT; retorna 201 com entidade criada (per `### API Contracts → POST /channels SI-03.1`)
5. Criar `src/channels/channels.module.ts` com TypeOrmModule.forFeature([Channel]); registrar ChannelsModule em AppModule

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Channel` entity | Integration: unique constraint em slug, user_id FK, defaults de created_at | `src/channels/channel.entity.integration-spec.ts` |
| `ChannelsService.createChannel` | Unit: slug duplicado lança DomainException CHANNEL_SLUG_TAKEN; slug auto-derivado quando omitido | `src/channels/channels.service.spec.ts` |

**Dependencies:** none _(depende de User entity e JwtAuthGuard de Phase 02 — já entregues)_

**Acceptance criteria:**

- `POST /channels` com body `{ name: "Meu Canal" }` retorna `201` com `id`, `user_id`, `name`, `slug`, `created_at`
- `POST /channels` com `slug` duplicado retorna `409` com `errorCode: "CHANNEL_SLUG_TAKEN"`
- `POST /channels` sem `Authorization` header retorna `401`
- Migration `CreateChannels` cria tabela `channels` sem erro no banco real

---

### SI-03.2 — Infra Docker Compose (MinIO + Redis + worker)

**Description:** Adiciona ao `compose.yaml` os serviços de object storage, fila e worker — base de infra para todos os SIs subsequentes que dependem de MinIO ou Redis reais.

**Technical actions:**

1. Adicionar serviço `minio` ao `compose.yaml` (image: `minio/minio`, command: `server /data --console-address ":9001"`, volumes, env MINIO_ROOT_USER/MINIO_ROOT_PASSWORD, healthcheck via `mc ready local`, porta 9000/9001)
2. Adicionar serviço `redis` ao `compose.yaml` (image: `redis:7-alpine`, healthcheck via `redis-cli ping`, porta 6379) com REDIS_HOST=redis no `.env`
3. Criar `nestjs-project/Dockerfile.worker` — FROM `node:22-alpine`, `apk add ffmpeg`, WORKDIR `/app`, COPY, `npm ci --omit=dev`, CMD `node dist/worker/main.js`
4. Adicionar serviço `nestjs-worker` ao `compose.yaml` (build: `./nestjs-project` + `dockerfile: Dockerfile.worker`, depends_on: [db, minio, redis, nestjs-api para migrations], env_file)
5. Adicionar ao `nestjs-project/.env` e `.env.example` as variáveis `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_REGION`, `REDIS_HOST`, `REDIS_PORT`, `VIDEO_BUCKET`, `THUMBNAIL_BUCKET`

**Tests:** _(empty — Infra; MinIO e Redis são exercitados pelos integration tests de SI-03.3 e SI-03.4)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d minio redis` inicia ambos os serviços com status `healthy`
- `docker compose exec redis redis-cli ping` retorna `PONG`
- MinIO health endpoint (`http://localhost:9000/minio/health/live`) retorna `200`

---

### SI-03.3 — StorageModule (S3Client + StorageService)

**Description:** Encapsula toda a comunicação com MinIO/S3 via AWS SDK v3 — presigned URLs para upload multipart, streaming com Range e download — conforme phase-03-videos/TD-04 e TD-02.

**Technical actions:**

1. Instalar `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage` em `nestjs-project/` (per `phase-03-videos/TD-04`)
2. Criar `src/config/storage.config.ts` com `registerAs('storage', ...)` — MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_REGION, VIDEO_BUCKET, THUMBNAIL_BUCKET; atualizar `env.validation.ts` com schema Joi (per `phase-01-configuracao-base/TD-03`)
3. Criar `src/storage/storage.service.ts` — `initiateMultipartUpload`, `generatePresignedPartUrl` (expiresIn: 3600 s), `completeMultipartUpload`, `abortMultipartUpload` via AWS SDK v3 com `forcePathStyle: true` para MinIO (per `phase-03-videos/TD-02`, `library-refs.md § @aws-sdk/client-s3`)
4. Adicionar `getObjectStream(bucket, key, range?)` ao StorageService — `GetObjectCommand` com header `Range` opcional; retorna `{ body: Readable, contentLength, contentRange? }` para suporte a 206 (per `phase-03-videos/TD-06`)
5. Criar `src/storage/storage.module.ts` — providers: S3Client via `useFactory` injetando storage.config; exporta StorageService; registrar StorageModule em AppModule

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: MinIO real via Compose — initiateMultipartUpload, completeMultipartUpload, abortMultipartUpload, getObjectStream com e sem Range | `src/storage/storage.service.integration-spec.ts` |

**Dependencies:** SI-03.2 _(MinIO deve estar rodando no Compose)_

**Acceptance criteria:**

- `StorageService.initiateMultipartUpload` retorna `UploadId` não-vazio para bucket `streamtube-videos`
- `StorageService.generatePresignedPartUrl` retorna URL que aceita `PUT` direto no MinIO (validado via HTTP 200 na parte)
- `StorageService.completeMultipartUpload` finaliza upload e torna o objeto acessível via `getObjectStream`
- `StorageService.abortMultipartUpload` cancela o upload; objeto não aparece listado no bucket
- `StorageService.getObjectStream` com `range: "bytes=0-99"` retorna chunk de 100 bytes com contentRange preenchido

---

### SI-03.4 — QueueModule (BullMQ + Redis)

**Description:** Registra o BullMQ com Redis no contexto NestJS e expõe a fila `video-processing` para injeção — base para enfileiramento de jobs pelo UploadService e consumo pelo worker.

**Technical actions:**

1. Instalar `@nestjs/bullmq`, `bullmq`, `ioredis` em `nestjs-project/` (per `phase-03-videos/TD-01`)
2. Criar `src/config/queue.config.ts` com `registerAs('queue', ...)` — REDIS_HOST, REDIS_PORT; atualizar `env.validation.ts` com schema Joi para as variáveis Redis (per `phase-01-configuracao-base/TD-03`)
3. Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync` injetando queue.config com `{ host, port }`; `BullModule.registerQueue({ name: 'video-processing' })`; exporta ambos
4. Registrar QueueModule em AppModule (global: false — importado pelos módulos que precisam enfileirar)
5. Validar configuração: `connection.maxRetriesPerRequest: null` presente no config do ioredis quando instância explícita (per `library-refs.md § ioredis`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `QueueModule` | Unit: compilation test — módulo cria sem erro com providers corretos | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.2 _(Redis deve estar no Compose)_

**Acceptance criteria:**

- `QueueModule` compila sem erro de TypeScript
- `BullModule.forRootAsync` conecta ao Redis de teste sem timeout (integration verificado implicitamente por SI-03.6)
- Fila `video-processing` está disponível para injeção via `@InjectQueue('video-processing')` em qualquer módulo que importe QueueModule

---

### SI-03.5 — VideoModule (entity + service)

**Description:** Cria a entidade Video com migration, o módulo NestJS e o serviço de ciclo de vida (draft → processing → ready | error) — inclui geração de slug único via nanoid(11).

**Technical actions:**

1. Criar `src/videos/video.entity.ts` com todos os campos do Data Model: id, channel_id FK, slug varchar(11) unique, title, status enum ('draft','processing','ready','error'), upload_id, storage_key, thumbnail_key, duration_seconds, metadata jsonb, created_at, updated_at (per `phase-03-videos/TD-07`, `TD-08`)
2. Criar migration `CreateVideos` em `src/database/migrations/` — tabela `videos`, FK → channels, unique index em slug, index em channel_id e status
3. Criar `src/videos/videos.service.ts` — `createDraftVideo(channelId, title, uploadId)` com `slug = nanoid(11)` (per `phase-03-videos/TD-07`); `findByIdOrFail`; `findBySlugOrFail`; `updateStatus`; `updateAfterProcessing(id, { storageKey, thumbnailKey, durationSeconds, metadata })` (per `phase-03-videos/TD-08`)
4. Criar `src/videos/videos.module.ts` — TypeOrmModule.forFeature([Video]), importa QueueModule; exporta VideosService
5. Registrar VideosModule em AppModule

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` entity | Integration: unique slug constraint, not-null channel_id FK, status default 'draft', updated_at auto-update | `src/videos/video.entity.integration-spec.ts` |
| `VideosService` | Unit: `createDraftVideo` gera slug de 11 chars; `findBySlugOrFail` lança VIDEO_NOT_FOUND; transições de status persistidas | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.1 _(Channel FK)_, SI-03.4 _(QueueModule)_

**Acceptance criteria:**

- Criar Video com `channelId` válido persiste registro com `status: 'draft'` e `slug` de exatamente 11 caracteres URL-safe
- Criar dois Videos sequencialmente nunca gera slugs idênticos (nanoid collision-proof na prática)
- `findBySlugOrFail` com slug inexistente lança DomainException `VIDEO_NOT_FOUND`
- Migration `CreateVideos` cria tabela `videos` com FK → channels sem erro no banco real

---

### SI-03.6 — UploadController (fluxo multipart)

**Description:** Implementa os 4 endpoints do fluxo de upload multipart — initiate, presigned-parts, complete e abort — orchestrados pelo UploadService que coordena S3 e fila.

**Route:** POST /videos/upload/initiate, POST /videos/:videoId/upload/presigned-parts, POST /videos/:videoId/upload/complete, DELETE /videos/:videoId/upload
**Test Specs:** see `nestjs-project/specs/video-upload.plan.md`
**Authorization:** Authenticated (initiate) / Owner (demais)

**Technical actions:**

1. Criar DTOs `src/videos/upload/dto/` — `InitiateUploadDto` (channelId uuid, title string, fileSize number, contentType string com validação `^video/`), `PresignedPartsDto` (uploadId, partNumbers number[] max 50), `CompleteUploadDto` (uploadId, parts [{partNumber, etag}]), `AbortUploadDto` (uploadId) (per `phase-02-auth/TD-06`)
2. Criar `src/videos/upload/upload.service.ts` — `initiateUpload` (valida channelId ownership, cria Video draft, chama StorageService.initiateMultipartUpload, armazena uploadId); `getPresignedParts` (verifica ownership + status 'draft', chama generatePresignedPartUrl por part); `completeUpload` (CompleteMultipartUpload + enfileira job 'video.process' + draft→processing); `abortUpload` (AbortMultipartUpload + deleta Video) (per `phase-03-videos/TD-02`)
3. Criar `src/videos/upload/upload.controller.ts` — 4 rotas, JwtAuthGuard (global), valida ownership lançando VIDEO_ACCESS_DENIED, valida status 'draft' lançando VIDEO_NOT_IN_DRAFT (per `### API Contracts → POST /videos/upload/* SI-03.6`, `### Authorization Matrix`)
4. Registrar UploadController e UploadService no VideosModule
5. Enfileirar job com `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 50 }` (per `phase-03-videos/TD-01`, `library-refs.md § @nestjs/bullmq`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `UploadService` | Unit: `initiateUpload` cria Video draft com uploadId; `completeUpload` enfileira job e atualiza status; `abortUpload` cancela S3 e deleta Video (mocks de StorageService e Queue) | `src/videos/upload/upload.service.spec.ts` |

**Dependencies:** SI-03.3 _(StorageService)_, SI-03.4 _(QueueModule)_, SI-03.5 _(VideosService)_

**Acceptance criteria:**

- `POST /videos/upload/initiate` com channelId válido retorna `201` com `videoId`, `uploadId`, `partSize`, `totalParts`
- `POST /videos/upload/initiate` com `fileSize > 10 737 418 240` retorna `400` (validation error)
- `POST /videos/:videoId/upload/presigned-parts` com video de outro usuário retorna `403` com `errorCode: "VIDEO_ACCESS_DENIED"`
- `POST /videos/:videoId/upload/complete` com video não em `'draft'` retorna `409` com `errorCode: "VIDEO_NOT_IN_DRAFT"`
- `POST /videos/:videoId/upload/complete` com partes válidas retorna `200` com `{ videoId, status: "processing" }`

---

### SI-03.7 — VideoController (metadata + streaming + download)

**Description:** Implementa GET /videos/:slug (metadata pública), GET /videos/:slug/stream (HTTP Range Requests 206) e GET /videos/:slug/download (attachment) — endpoints @Public() conforme Authorization Matrix.

**Route:** GET /videos/:slug, GET /videos/:slug/stream, GET /videos/:slug/download
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Anonymous (stream/download para 'ready'); Owner (metadata para qualquer status)

**Technical actions:**

1. Criar `src/videos/video.controller.ts` — `GET /videos/:slug` com status-gate (retorna VIDEO_ACCESS_DENIED se status != 'ready' e requester não é dono); `GET /videos/:slug/stream` e `GET /videos/:slug/download` com `@Public()` (per `phase-02-auth/TD-02`, `### Authorization Matrix`)
2. Implementar streaming: extrair header `Range`, chamar `StorageService.getObjectStream(VIDEO_BUCKET, video.storage_key, range)`; retornar `StreamableFile` com headers `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`, status 206; ausência de Range retorna 200 com arquivo completo (per `phase-03-videos/TD-06`)
3. Implementar download: `getObjectStream` sem range, `StreamableFile` com header `Content-Disposition: attachment; filename="${video.title}.mp4"` (per `### API Contracts → GET /videos/:slug/download SI-03.7`)
4. Lançar VIDEO_NOT_FOUND (404) quando slug não existe; VIDEO_NOT_READY (403) quando status != 'ready' em stream/download (per `### Error Catalog`)
5. Registrar VideoController no VideosModule

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoController` | Unit: `GET /videos/:slug/stream` seta headers 206 + Content-Range; `GET /videos/:slug/download` seta Content-Disposition attachment (mock StorageService) | `src/videos/video.controller.spec.ts` |

**Dependencies:** SI-03.3 _(StorageService)_, SI-03.5 _(VideosService)_

**Acceptance criteria:**

- `GET /videos/:slug` com slug de vídeo `'ready'` retorna `200` com `id`, `slug`, `title`, `status`, `channel`
- `GET /videos/:slug` com slug inexistente retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`
- `GET /videos/:slug/stream` com header `Range: bytes=0-1023` retorna `206` com `Content-Range` e chunk de 1024 bytes
- `GET /videos/:slug/stream` sem `Range` retorna `200` com `Accept-Ranges: bytes` e conteúdo completo
- `GET /videos/:slug/download` retorna `200` com `Content-Disposition: attachment` contendo o nome do vídeo
- `GET /videos/:slug/stream` em vídeo com status `'processing'` retorna `403` com `errorCode: "VIDEO_NOT_READY"`

---

### SI-03.8 — Video worker (NestJS standalone + FFmpeg)

**Description:** Cria a aplicação NestJS standalone que consome a fila `video-processing` via BullMQ — baixa o vídeo, extrai metadados (ffprobe), aplica faststart (ffmpeg), gera thumbnail e atualiza o status do Video para 'ready' ou 'error'.

**Technical actions:**

1. Criar `src/worker/worker.module.ts` — imports TypeOrmModule.forRootAsync (compartilhando database.config), StorageModule, QueueModule; providers: VideoProcessorConsumer
2. Criar `src/worker/video.processor.ts` — `@Processor('video-processing') class VideoProcessorConsumer extends WorkerHost`; `process(job)`: baixa objeto S3 para `/tmp/{videoId}/`, executa `ffprobe` (metadata), `ffmpeg -movflags +faststart` (reencoding), `ffmpeg screenshots timestamps=['50%']` (thumbnail), faz upload de ambos; `updateAfterProcessing`; em `@OnWorkerEvent('failed')`: `updateStatus(id, 'error')` (per `phase-03-videos/TD-01`, `TD-03`, `library-refs.md § fluent-ffmpeg`)
3. Criar `src/worker/main.ts` — `NestFactory.createApplicationContext(WorkerModule)`; configura `Ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg')` e `setFfprobePath` (per `library-refs.md § fluent-ffmpeg § Binary paths`)
4. Criar `nestjs-project/tsconfig.worker.json` — extends tsconfig.json, entrypoint `src/worker/main.ts`; adicionar script `build:worker` no package.json
5. Garantir que arquivos temporários em `/tmp/{videoId}/` sejam removidos após o processamento (success ou failure) para evitar leak de disco

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessorConsumer` | Integration: Redis + MinIO reais via Compose + FFmpeg — job completo atualiza Video para 'ready' com `duration_seconds`, `metadata`, thumbnail no bucket | `src/worker/video.processor.integration-spec.ts` |
| `VideoProcessorConsumer` | Integration: falha proposital no FFmpeg (arquivo inválido) → após 3 tentativas Video.status = 'error' | _(mesmo arquivo)_ |

**Dependencies:** SI-03.3 _(StorageService)_, SI-03.4 _(QueueModule)_, SI-03.5 _(VideosService/entity)_

**Acceptance criteria:**

- Enfileirar job `video.process` com `videoId` válido dispara `VideoProcessorConsumer.process`
- Após processamento completo: `Video.status = 'ready'`, `duration_seconds` preenchido, `metadata` com `codec`, `width`, `height`
- Thumbnail existe em `streamtube-thumbnails/{videoId}/thumbnail.jpg` no MinIO
- Arquivo `streamtube-videos/{videoId}/original.mp4` tem moov atom no início (validado via `ffprobe -v error -show_entries format_tags=major_brand`)
- Após falha em todas as 3 tentativas: `Video.status = 'error'`

---

## Technical Specifications

### Data Model

#### Channel

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| user_id | uuid | FK → users.id, not null |
| name | varchar(255) | not null |
| slug | varchar(255) | unique, not null |
| created_at | timestamptz | default now() |

**Relations:** `Channel` belongs to `User` (many-to-one); `Channel` has many `Video` (one-to-many)
**Indexes:** unique on `slug`; index on `user_id`

_Minimal entity per DG-1 resolution — full channel management (edit, stats, publish) is Phase 04 scope._

---

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| channel_id | uuid | FK → channels.id, not null |
| slug | varchar(11) | unique, not null — nanoid(11) per phase-03-videos/TD-07 |
| title | varchar(255) | not null |
| status | enum | not null, default 'draft' — values: draft \| processing \| ready \| error (per phase-03-videos/TD-08) |
| upload_id | varchar(255) | nullable — S3 multipart UploadId while upload is in-progress |
| storage_key | varchar(500) | nullable — S3 object key for the original/processed video file |
| thumbnail_key | varchar(500) | nullable — S3 object key for the generated thumbnail |
| duration_seconds | float | nullable — extracted by FFmpeg worker after processing |
| metadata | jsonb | nullable — { codec, width, height, bitrate, fps } extracted by ffprobe |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now(), auto-updated on every change |

**Relations:** `Video` belongs to `Channel` (many-to-one)
**Indexes:** unique on `slug`; index on `channel_id`; index on `status`

### API Contracts

#### POST /channels (SI-03.1)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- name: string, required — channel display name, max 255 chars
- slug: string, optional — URL-safe slug; auto-derived from name if omitted, max 255 chars

**Response 201:**
- id: string (uuid)
- user_id: string (uuid)
- name: string
- slug: string
- created_at: string (ISO-8601)

**Error responses:**
- 409 CHANNEL_SLUG_TAKEN: when the requested slug is already in use
- 400 validation error: when request body fails schema validation
- 401 when no valid JWT

---

#### POST /videos/upload/initiate (SI-03.6)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- channelId: string (uuid), required — must belong to the authenticated user
- title: string, required — max 255 chars
- fileSize: number, required — total file size in bytes (max 10 × 1024 × 1024 × 1024 = 10 737 418 240)
- contentType: string, required — MIME type (e.g. `video/mp4`)

**Response 201:**
- videoId: string (uuid)
- uploadId: string — S3 multipart UploadId
- partSize: number — bytes per part (8 388 608, i.e. 8 MB)
- totalParts: number — ceil(fileSize / partSize)

**Error responses:**
- 404 CHANNEL_NOT_FOUND: when channelId does not exist or does not belong to the user
- 400 validation error: when request body fails schema validation
- 401 when no valid JWT

---

#### POST /videos/:videoId/upload/presigned-parts (SI-03.6)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- uploadId: string, required — the UploadId returned by initiate
- partNumbers: number[], required — list of part numbers to sign (1-based, max 50 per request)

**Response 200:**
- parts: array of { partNumber: number, url: string } — presigned S3 URLs (expire in 3600 s); client uploads each part directly to MinIO via PUT

**Error responses:**
- 404 VIDEO_NOT_FOUND: when videoId does not exist
- 403 VIDEO_ACCESS_DENIED: when video does not belong to the authenticated user
- 409 VIDEO_NOT_IN_DRAFT: when video status is not 'draft'
- 400 validation error: when partNumbers is empty, exceeds 50, or contains values < 1
- 401 when no valid JWT

---

#### POST /videos/:videoId/upload/complete (SI-03.6)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- uploadId: string, required — the UploadId returned by initiate
- parts: array of { partNumber: number, etag: string }, required — ETags returned by S3 per uploaded part

**Response 200:**
- videoId: string (uuid)
- status: string — 'processing'

**Error responses:**
- 404 VIDEO_NOT_FOUND: when videoId does not exist
- 403 VIDEO_ACCESS_DENIED: when video does not belong to the authenticated user
- 409 VIDEO_NOT_IN_DRAFT: when video status is not 'draft'
- 400 validation error: when parts array is empty or malformed
- 401 when no valid JWT

---

#### DELETE /videos/:videoId/upload (SI-03.6)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- uploadId: string, required — the UploadId to abort

**Response 204:** No content.

**Error responses:**
- 404 VIDEO_NOT_FOUND: when videoId does not exist
- 403 VIDEO_ACCESS_DENIED: when video does not belong to the authenticated user
- 409 VIDEO_NOT_IN_DRAFT: when video status is not 'draft'
- 401 when no valid JWT

---

#### GET /videos/:slug (SI-03.5)

**Request headers:**
- Authorization: Bearer {token} (optional — anonymous access allowed for ready videos)

**Response 200:**
- id: string (uuid)
- slug: string
- title: string
- status: string — 'draft' | 'processing' | 'ready' | 'error'
- channel: { id, name, slug }
- thumbnailUrl: string | null — public presigned URL to the thumbnail (null when not yet processed)
- durationSeconds: number | null
- createdAt: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when slug does not match any video
- 403 VIDEO_ACCESS_DENIED: when video status != 'ready' and requester is not the owner

---

#### GET /videos/:slug/stream (SI-03.7)

**Request headers:**
- Range: bytes={start}-{end} (optional; omit for full file)

**Response 206 (partial):**
- Content-Type: video/mp4
- Content-Range: bytes {start}-{end}/{total}
- Content-Length: {chunk size}
- Accept-Ranges: bytes
- Body: binary chunk from S3 (via GetObjectCommand with Range header)

**Response 200 (no Range header):** full file with Content-Length.

**Error responses:**
- 404 VIDEO_NOT_FOUND: when slug does not match any ready video
- 403 VIDEO_NOT_READY: when video status != 'ready'
- 416 Range Not Satisfiable: when Range header exceeds Content-Length

---

#### GET /videos/:slug/download (SI-03.7)

**Request headers:** none required.

**Response 200:**
- Content-Type: video/mp4
- Content-Disposition: attachment; filename="{title}.mp4"
- Content-Length: total file size
- Body: full video binary from S3

**Error responses:**
- 404 VIDEO_NOT_FOUND: when slug does not match any ready video
- 403 VIDEO_NOT_READY: when video status != 'ready'

---

#### Validation Rules — uploads

- `fileSize`: required, integer, min 1, max 10 737 418 240 (10 GB)
- `contentType`: required, must match `^video/` prefix
- `partNumbers`: required array, each element integer ≥ 1, max 50 items per request
- `parts` (complete): required array, each element must have `partNumber` (integer ≥ 1) and `etag` (non-empty string)

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /channels | ✗ | ✓ | — |
| POST /videos/upload/initiate | ✗ | ✓ | — |
| POST /videos/:videoId/upload/presigned-parts | ✗ | ✗ | ✓ |
| POST /videos/:videoId/upload/complete | ✗ | ✗ | ✓ |
| DELETE /videos/:videoId/upload | ✗ | ✗ | ✓ |
| GET /videos/:slug | ✓ (ready only) | ✓ (ready only) | ✓ (any status) |
| GET /videos/:slug/stream | ✓ (ready only) | ✓ (ready only) | ✓ (ready only) |
| GET /videos/:slug/download | ✓ (ready only) | ✓ (ready only) | ✓ (ready only) |

_Owner = authenticated user whose JWT matches the `user_id` of the Channel the Video belongs to. `GET /videos/:slug` exposes any status to the owner for status polling; streaming/download require status 'ready' even for the owner (video must be processed)._

_Anonymous access for stream/download uses the `@Public()` decorator (inherited from phase-02-auth/TD-02)._

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| CHANNEL_NOT_FOUND | 404 | channelId não corresponde a nenhum canal do usuário autenticado |
| CHANNEL_SLUG_TAKEN | 409 | slug de canal já em uso por outro canal |
| VIDEO_NOT_FOUND | 404 | slug/videoId não corresponde a nenhum vídeo existente |
| VIDEO_ACCESS_DENIED | 403 | operação de dono em vídeo pertencente a outro usuário |
| VIDEO_NOT_READY | 403 | streaming/download de vídeo cujo status != 'ready' |
| VIDEO_NOT_IN_DRAFT | 409 | completar/abortar upload de vídeo que não está em status 'draft' |

### Events/Messages

#### video.process (BullMQ job — queue: video-processing)

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService.completeUpload()` (per phase-03-videos/TD-01)
**Consumer:** `VideoProcessorConsumer` no container worker (per phase-03-videos/TD-01, TD-03)
**Trigger:** endpoint `POST /videos/:videoId/upload/complete` após CompleteMultipartUploadCommand com sucesso
**Delivery semantics:** at-least-once; 3 tentativas com backoff exponencial (delay inicial: 5 000 ms) antes de marcar o job como falho (per phase-03-videos/TD-01)

**Worker processing flow:**
1. Baixa o arquivo original de `streamtube-videos/{videoId}/original.mp4` para `/tmp/{videoId}/`
2. Executa `ffprobe` → extrai `duration_seconds`, `metadata` (codec, width, height, bitrate, fps)
3. Executa `ffmpeg -movflags +faststart` → reescreve com moov atom no início (otimização de streaming)
4. Executa `ffmpeg screenshots timestamps=['50%']` → gera `thumbnail.jpg`
5. Faz upload do arquivo processado para `streamtube-videos/{videoId}/original.mp4` (sobrescreve)
6. Faz upload do thumbnail para `streamtube-thumbnails/{videoId}/thumbnail.jpg`
7. Atualiza Video: `status → 'ready'`, `storage_key`, `thumbnail_key`, `duration_seconds`, `metadata`
8. Em qualquer falha: atualiza Video `status → 'error'` (após esgotar as 3 tentativas do BullMQ)

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-03.1 (root — Channel entity + controller)
SI-03.2 (root — Infra Docker Compose)
├── SI-03.3 — depends on SI-03.2 (MinIO no Compose)
│   └── SI-03.6 — depends on SI-03.3 + SI-03.4 + SI-03.5
│   └── SI-03.7 — depends on SI-03.3 + SI-03.5
└── SI-03.4 — depends on SI-03.2 (Redis no Compose)
    └── SI-03.5 — depends on SI-03.1 (Channel FK) + SI-03.4
        ├── SI-03.6 (ver acima)
        ├── SI-03.7 (ver acima)
        └── SI-03.8 — depends on SI-03.3 + SI-03.4 + SI-03.5
```

---

## Deliverables

- [ ] SI-03.1 — ChannelsModule (entity + service + controller)
- [ ] SI-03.2 — Infra Docker Compose (MinIO + Redis + worker)
- [ ] SI-03.3 — StorageModule (S3Client + StorageService)
- [ ] SI-03.4 — QueueModule (BullMQ + Redis)
- [ ] SI-03.5 — VideoModule (entity + service)
- [ ] SI-03.6 — UploadController (fluxo multipart)
- [ ] SI-03.7 — VideoController (metadata + streaming + download)
- [ ] SI-03.8 — Video worker (NestJS standalone + FFmpeg)

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type-check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Worker integration tests pass (`docker compose exec nestjs-worker npm test -- --runInBand`) _(após configuração do worker em SI-03.8)_
