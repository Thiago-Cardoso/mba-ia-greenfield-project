# phase-03-videos — Progress

**Status:** completed
**SIs:** 8/8 completed

### SI-03.1 — ChannelsModule (entity + service + controller)
- **Status:** completed
- **Tests:** 135 unit/integration + 55 e2e — todos passando
- **Observations:**
  - Channel entity migrada de OneToOne/nickname (Phase 02) para ManyToOne/slug (Phase 03) via psql ALTER TABLE manual (TypeORM CLI não compilava ESM).
  - E2e de channels usava endpoint errado (`POST /auth/confirm`) — corrigido para `GET /auth/confirm-email?token=`.
  - migrations.integration-spec.ts não dropava o tipo enum antes de re-executar as migrations — adicionado `DROP TYPE IF EXISTS "public"."verification_tokens_type_enum"` no beforeAll.
  - **Fix pós-review:** `slugify()` retornava string vazia para inputs emoji/símbolo — adicionada `ChannelSlugInvalidException` (422) com guard em `ChannelsService.createChannel`.
  - **Fix pós-review:** colisão de slug aleatório durante registro propagava 409 ao usuário — `UsersService` faz retry até 3x em `ChannelSlugTakenException` com fallback de base slug `'channel'` e sufixo padded.

### SI-03.2 — Infra Docker Compose (MinIO + Redis + worker)
- **Status:** completed
- **Tests:** no tests (infra SI)
- **Observations:**
  - MinIO, Redis e nestjs-worker adicionados ao compose.yaml; Dockerfile.worker criado e PR #4 mergeado em dev.
  - Melhorias pós-merge não commitadas (Dockerfile multi-stage, profiles: worker, CLAUDE.md) estão na branch feature/SI-03.3.

### SI-03.3 — StorageModule (S3Client + StorageService)
- **Status:** completed
- **Tests:** 6 passing (integration — MinIO real)
- **Observations:**
  - Buckets `streamtube-videos` e `streamtube-thumbnails` criados no MinIO via `mc mb` antes dos testes.
  - Presigned PUT usa chave provisória de `MINIO_ENDPOINT`; funciona com `fetch()` nativo (Node 18+) sem cliente S3 extra no teste.
  - Arquivo de 500 bytes no teste de Range usa multipart (mínimo 5 MB por parte); MinIO aceita partes menores neste contexto de teste.

### SI-03.4 — QueueModule (BullMQ + Redis)
- **Status:** completed
- **Tests:** 2 passing (unit — compilação do módulo + fila `video-processing` disponível para injeção)
- **Observations:**
  - Pacotes instalados: `@nestjs/bullmq`, `bullmq`, `ioredis`.
  - `QueueModule` usa `BullModule.forRootAsync` com `ConfigModule.forFeature(queueConfig)` — auto-suficiente em contexto standalone (worker).
  - `REDIS_HOST` e `REDIS_PORT` adicionados ao `env.validation.ts` com defaults `'redis'` e `6379`.

### SI-03.5 — VideoModule (entity + service)
- **Status:** completed
- **Tests:** 11 passing (7 unit — VideosService; 4 integration — Video entity)
- **Observations:**
  - `nanoid` v5 é ESM-only e o projeto compila para CJS — implementado utilitário local `slug.util.ts` com `crypto.randomBytes` e mesmo alfabeto URL-safe do nanoid.
  - Migration gerada via CLI como ALTER (tabela `videos` já existia de sessão anterior); migration `AlterChannelsForPhase03` foi marcada como executada manualmente no DB (já havia sido aplicada via psql em SI-03.1).
  - `updateAfterProcessing` usa `findByIdOrFail` + `save` em vez de `update()` — evita problema de typing do TypeORM com `_QueryDeepPartialEntity<Record<string, unknown> | null>` em coluna jsonb.
  - Limpeza de tabelas no `afterAll` do integration spec precisa seguir ordem de FK: `videos → refresh_tokens → verification_tokens → channels → users`.

### SI-03.6 — UploadController (fluxo multipart)
- **Status:** completed
- **Tests:** 178 unit passing + 66 e2e passing (pós code-review)
- **Observations:**
  - `assertOwnership` narrowed to catch only `ChannelNotFoundException` (not all errors).
  - `completeUpload` ordering fixed: `queue.add` before `updateStatus`.
  - `initiateUpload` gained compensation logic (S3 abort + video delete on failure).
  - `abortUpload` now swallows S3 failures and always deletes the video.
  - `storageKeyFor()` private method extracted as single source of truth for storage key pattern.
  - `VideoNotInProcessingException` and related state guard moved to SI-03.8 (out of scope).

### SI-03.7 — VideoController (metadata + streaming + download)
- **Status:** completed
- **Tests:** 178 unit passing + 66 e2e passing
- **Observations:**
  - `JwtAuthGuard` extended to attach `request.user` on `@Public()` routes when a valid Bearer token is present — enables owner-only access to non-ready videos on the metadata endpoint without requiring auth for anonymous callers.
  - `VideosService` gained `getPublicVideoBySlug` (status-gate with optional ownership check) and `getReadyVideoBySlug` (throws `VideoNotReadyException` for non-ready videos).
  - `StorageService` gained `generatePresignedGetUrl` for thumbnail URL generation.
  - `VideoController` uses `@Res({ passthrough: true })` to set 206 status and `Content-Range` header conditionally on Range requests, while still returning a `StreamableFile`.
  - E2E test uploads a 2 KB buffer to MinIO via raw `S3Client.send(PutObjectCommand)` obtained from the test module fixture.

### SI-03.8 — Video worker (NestJS standalone + FFmpeg)
- **Status:** completed
- **Tests:** 2 passing (integration — happy path + falha permanente com arquivo inválido)
- **Observations:**
  - `WorkerModule` usa `NestFactory.createApplicationContext` (sem servidor HTTP); `VideoProcessorConsumer extends WorkerHost` registrado com `@Processor('video-processing')`.
  - Fluxo do job: download do MinIO → ffprobe (duração, codec, dimensões) → faststart remux com `-c copy` (sem re-encode) → thumbnail a 50% via `.screenshots()` → upload de processed + thumbnail → `updateAfterProcessing`.
  - `applyFaststart` usa `.outputOptions(['-movflags +faststart', '-c copy'])` — sem re-encode; happy path caiu de ~120s (re-encode) para ~286ms (remux) após correção no code review.
  - `downloadToFile` usa `stream.pipeline()` em vez de `.pipe()` para cleanup bidirecional automático (fix de vazamento de fd).
  - `fsPromises.access(thumbnailPath)` adicionado após `generateThumbnail` para detectar caso raro em que FFmpeg sai com código 0 mas não escreve o JPEG.
  - Bucket names lidos via `storageConfig` injetado (`@Inject(storageConfig.KEY)`) — não mais `process.env` direto no módulo-level.
  - `WorkerModule` importa `VideosModule` (que já exporta `VideosService`) em vez de redeclarar `VideosService` e `TypeOrmModule.forFeature([Video])` — SRP respeitado.
  - Guard de `job.name !== 'video.process'` em `process()` e `onFailed` evita processar jobs de outros produtores da mesma fila.
  - `afterAll` no integration spec tem timeout de 30 000 ms para cobrir o `BullMQ Worker.close()` (polling cycle de até 10 s).
  - `tsconfig.worker.json` adicionado para compilação standalone com `moduleResolution: node` (evita requisito de extensão `.js` do `nodenext` principal).
