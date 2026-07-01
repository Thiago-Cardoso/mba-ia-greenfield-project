---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-06-30T14:06:26-0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-30T22:45:44-0300"
  docs/phases/phase-02-auth/context.md: "2026-06-30T14:06:26-0300"
  docs/phases/phase-01-configuracao-base/context.md: "2026-06-30T14:06:26-0300"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-06-30T14:06:26-0300"
  docs/phases/phase-03-videos/library-refs.md: "2026-06-30T22:50:25-0300"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Interface de vídeo no frontend (`next-frontend/`) — per `prompt-requirement.md`, "a interface de vídeo não faz parte do escopo desta fase." Múltiplas qualidades de vídeo (HLS adaptativo), gerenciamento de vídeos publicados (Fase 04), interações sociais (Fase 06).

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/` (API + worker)

**Deferred subprojects:** `next-frontend/` — interface de vídeo e upload deferred para fase posterior.

**Sequencing notes:** Depends on Fase 01 — Configuração Base do Projeto e Fase 02 — Cadastro, Login e Gerenciamento de Conta (auth guards aplicam-se ao módulo de vídeos). Phase 03 creates a minimal `Channel` entity (id, user_id FK, name, slug, created_at) as a prerequisite for the `Video` entity FK — Channel management (publish, edit, stats) is Phase 04 scope; this phase only creates the base record. _(DG-1 resolution — 2026-06-30)_

**Neighbors (for boundary detection only):**

- **Fase 02:** Cadastro, Login e Gerenciamento de Conta (prior)
- **Fase 04:** Gerenciamento de Vídeos e Canal (next)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Tecnologia de fila de mensagens | decided | A (BullMQ + Redis) | `@nestjs/bullmq`, `bullmq`, `ioredis` |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Estratégia de upload de arquivos grandes | decided | A (Multipart presigned URL) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage` |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Repo-wide | Localização e estrutura do worker de vídeo | decided | A (NestJS standalone, container separado) | `fluent-ffmpeg`, `@types/fluent-ffmpeg` |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | SDK de integração com MinIO | decided | B (AWS SDK v3) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Organização de buckets e chaves no MinIO | decided | B (Dois buckets: streamtube-videos + streamtube-thumbnails) | — |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Streaming e download de vídeo | decided | A (HTTP Range Requests via NestJS, 206 Partial Content) | — |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Geração de slug único de vídeo | decided | A (nanoid@3.x, 11 chars) | `nanoid` |
| phase-03-videos/TD-08 | technical-decisions-phase-03-videos.md | Backend | Ciclo de status do vídeo e política de falha | decided | A (4 estados: draft → processing → ready \| error) | — |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-04, phase-03-videos/TD-05 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-03 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-08 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-08 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-03, phase-03-videos/TD-08 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-07 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ + Redis — o stack é inteiramente Node.js/NestJS, o suporte oficial `@nestjs/bullmq` reduz boilerplate, e Redis é uma dependência leve. RabbitMQ agrega valor quando há workers em múltiplas linguagens — não é o caso desta fase. Kafka é excessivo para processamento de jobs sequenciais de vídeo.

**Libraries:** `@nestjs/bullmq`, `bullmq`, `ioredis`

### phase-03-videos/TD-02

**Recommendation:** Multipart presigned URL — elimina carga na API sem a complexidade do protocolo tus. Para o MVP desta fase, a falta de retomada automática é aceitável; o cliente pode exibir progresso e pedir reenvio em caso de falha. Produz a arquitetura mais próxima de produção com S3 real. Option B (streaming via NestJS) é aceitável apenas para desenvolvimento local quando simplicidade é prioridade.

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage`

### phase-03-videos/TD-03

**Recommendation:** NestJS standalone em container separado — alinhado com o project-plan e com a separação de responsabilidades. O custo de setup adicional (um Dockerfile com FFmpeg + um service no Compose) é baixo comparado ao isolamento de CPU. Usar NestJS no worker mantém consistência de padrão (config, TypeORM, BullMQ) e facilita reuso de entidades do monorepo.

**Libraries:** `fluent-ffmpeg`, `@types/fluent-ffmpeg`

### phase-03-videos/TD-04

**Recommendation:** AWS SDK v3 — a API S3 é o padrão de mercado. Migrar de MinIO local para S3 em produção é trivial (variáveis de ambiente). O suporte a multipart upload com presigned URLs é mais completo e documentado que o minio-js, crítico para TD-02. `@aws-sdk/lib-storage` abstrai a orquestração de partes automaticamente.

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

### phase-03-videos/TD-05

**Recommendation:** Dois buckets (`streamtube-videos` + `streamtube-thumbnails`) — a separação semântica entre vídeos (acesso controlado via presigned URL ou streaming pela API) e thumbnails (potencialmente públicos para listagens) justifica buckets distintos. O custo de configuração extra é mínimo e a separação de políticas é importante desde o início para evitar refatoração futura.

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** HTTP Range Requests via NestJS (206 Partial Content) — range requests são suficientes para streaming funcional no escopo desta fase. O `faststart` (FFmpeg `mov_flags +faststart`) resolve o seeking. O controle de acesso centralizado na API é preferível à exposição do endpoint do MinIO (presigned redirect). HLS é a evolução natural se múltiplas qualidades forem requisito em fase futura. O download é trivial sobre a mesma infraestrutura (`Content-Disposition: attachment`).

**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** nanoid@3.x, 11 chars — equilibra URLs curtas (UX) com segurança suficiente para o volume esperado (~70 bits de entropia, 1 colisão em 1 bilhão com 2M vídeos). Fixar na versão 3.x (CommonJS) resolve o problema ESM/CommonJS sem wrappers. UUID v4 é aceitável se zero dependências for preferido; a URL mais longa (36 chars) é o único trade-off.

**Libraries:** `nanoid`

### phase-03-videos/TD-08

**Recommendation:** 4 estados simples (`draft | processing | ready | error`) — para o escopo desta fase, `draft` cobre tanto upload em progresso quanto aguardando processamento, simplificando o modelo e o enum. O BullMQ já lida com retry antes de marcar como erro; o estado `error` é suficiente para informar o usuário. 5 estados fazem sentido combinados com retomada de upload (tus) — não é o caso nesta fase.

**Libraries:** —

## Inherited Decisions Detail

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler — Native NestJS integration is decisive: the guard system allows scoping rate limiting to specific modules via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — [Note: decided as B — Custom guards with @nestjs/jwt only.] All video endpoints inherit the global `JwtAuthGuard`; use `@Public()` to exempt anonymous streaming/download endpoints.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-01-configuracao-base/TD-01

**Recommendation:** @nestjs/config — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Namespaced/grouped with registerAs — Clear file boundaries per domain, typed injection via `ConfigType<typeof xxxConfig>`, natural scalability. Phase 03 adds `storage.config.ts`, `queue.config.ts`.

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for TypeORM CLI. _(from phase 01)_
- `TypeOrmModule.forRootAsync` with `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_
- All domain exceptions extend `DomainException` and are handled by `DomainExceptionFilter` → `{ statusCode, error, message }`. _(from phase 02)_
- Auth guard is a custom `JwtAuthGuard` extending `CanActivate` (not `@nestjs/passport`). Routes are protected by default; use `@Public()` to exempt public endpoints (e.g., anonymous streaming). _(from phase 02)_
- DTO validation uses `class-validator` + `class-transformer` via global `ValidationPipe({ whitelist: true, transform: true })`. _(from phase 02)_
- Rate limiting via `@nestjs/throttler` applied at module level; `@SkipThrottle()` for exemptions. _(from phase 02)_
- Error response shape is `{ statusCode, error, message }` — the `error` field carries a machine-readable domain code (e.g., `VIDEO_NOT_FOUND`). _(from phase 02)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` não está inicializado nas fases de backend; telas de auth iniciam em fase posterior. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project/

| Artifact created | Required tests | Guide |
|---|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false`, relações com Channel | `artifacts/entities.md` |
| Service com branching + DB (VideosService) | Unit: branch logic (mock repo) + Integration: DB contract com banco real | `artifacts/services.md` |
| Service com side-effect dep (StorageService) | Integration: real MinIO via Docker Compose | `artifacts/services.md` |
| Service com side-effect dep (QueueService) | Integration: real Redis/BullMQ via Docker Compose | `artifacts/services.md` |
| Module com configured imports (BullModule, TypeOrmModule) | Unit: compilation test | `artifacts/modules.md` |
| Controller (VideosController) | E2E only via Supertest | `artifacts/controllers.md` |
| DTO (CreateVideoDto, etc.) | E2E: one validation wiring test per endpoint | `artifacts/dtos.md` |
| Worker consumer (VideoProcessorConsumer) | Integration: real Redis + MinIO + FFmpeg | `artifacts/services.md` |

**Regra de integração da fase:** integração com MinIO e Redis deve usar os serviços reais do Docker Compose — **nunca mockar storage ou fila quando a infra do Compose está disponível** (per `CLAUDE.md`: "Não mocke o que dá para testar de verdade com a infra do Compose"). Testes de integração do worker requerem FFmpeg instalado no container de teste.

### worker/ (container separado)

_Deferred subproject — testing requirements will be defined by the implement skill when the worker Dockerfile and entry point are established. The same testing-guide-nestjs-project conventions apply (BullMQ processor tests use real Redis; storage tests use real MinIO)._
