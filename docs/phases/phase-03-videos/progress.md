# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 4/8 completed

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
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.6 — UploadController (fluxo multipart)
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.7 — VideoController (metadata + streaming + download)
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.8 — Video worker (NestJS standalone + FFmpeg)
- **Status:** pending
- **Tests:** pending
- **Observations:** none
