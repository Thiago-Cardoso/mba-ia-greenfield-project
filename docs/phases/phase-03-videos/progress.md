# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 0/8 completed

### SI-03.1 — ChannelsModule (entity + service + controller)
- **Status:** completed
- **Tests:** 133 unit/integration + 55 e2e — todos passando
- **Observations:**
  - Channel entity migrada de OneToOne/nickname (Phase 02) para ManyToOne/slug (Phase 03) via psql ALTER TABLE manual (TypeORM CLI não compilava ESM).
  - E2e de channels usava endpoint errado (`POST /auth/confirm`) — corrigido para `GET /auth/confirm-email?token=`.
  - migrations.integration-spec.ts não dropava o tipo enum antes de re-executar as migrations — adicionado `DROP TYPE IF EXISTS "public"."verification_tokens_type_enum"` no beforeAll.

### SI-03.2 — Infra Docker Compose (MinIO + Redis + worker)
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.3 — StorageModule (S3Client + StorageService)
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.4 — QueueModule (BullMQ + Redis)
- **Status:** pending
- **Tests:** pending
- **Observations:** none

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
