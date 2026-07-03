# StreamTube — Plataforma de Compartilhamento de Vídeos

Projeto da disciplina **Desenvolvimento de Aplicações de IA** do MBA de Engenharia de Software com IA da [Full Cycle](https://fullcycle.com.br).

Este é um projeto greenfield desenvolvido para demonstrar como construir uma aplicação do zero utilizando IA de forma adequada no processo de desenvolvimento.

## Professor

<a href="https://github.com/argentinaluiz">
    <img src="https://avatars.githubusercontent.com/u/4926329?v=4?s=100" width="100px;" alt=""/>
    <br />
    <sub>
        <b>Luiz Carlos</b>
    </sub>
</a>

---

## Quadro Branco

- [Quadro Branco](./whiteboard.png)

---

## 🎨 Design System (Figma)

- [FC Tube.fig](./FC%20Tube.fig) — arquivo-fonte do **design system** do projeto no Figma.

Contém os fundamentos visuais do StreamTube — tokens (cores, tipografia, espaçamento, raios), componentes e as telas da plataforma. É a referência de design para a implementação do frontend: os componentes em `next-frontend/components/ui` (shadcn) e os tokens em `next-frontend/app/globals.css` derivam deste arquivo. Abra-o no Figma (`Arquivo → Importar`) para consultar especificações e estados visuais.

---

## 📋 Pré-requisitos

- Docker e Docker Compose
- Node.js v25+ (para rodar os testes E2E do Playwright no host)
- npm

## 🏗️ Arquitetura

O projeto é um monorepo baseado em containers Docker. Cada subprojeto sobe sua própria stack via `docker compose`.

- **Frontend** (Next.js 16, App Router + React Server Components) — interface da plataforma. Segue o **modelo BFF**: o navegador nunca chama a API NestJS diretamente; todo tráfego passa por Route Handlers same-origin em `app/api/**`, que fazem proxy server-side para a API.
- **API** (NestJS 11) — regras de negócio, autenticação (JWT + refresh token rotation), envio de e-mails e acesso ao banco.
- **Database** (PostgreSQL 17) — usuários, canais e tokens de autenticação.
- **Email Service** (Mailpit) — captura os e-mails transacionais (confirmação de conta e recuperação de senha) em uma UI local.
- **Object Storage** (MinIO/S3-compatible) — armazena arquivos de vídeo e thumbnails; upload multipart via presigned URLs.
- **Message Queue** (Redis + BullMQ) — fila `video-processing` para tarefas assíncronas de transcodagem.
- **Video Worker** (NestJS standalone + FFmpeg) — consome jobs da fila, executa ffprobe → faststart remux (`-c copy`) → thumbnail → upload para MinIO → atualiza status no banco.

O diagrama de arquitetura completo (C4) está em `docs/diagrams/software-arch.mermaid`.

## 🚀 Como rodar

Os dois subprojetos têm stacks Docker **separadas**. Suba primeiro o backend, rode as migrations e depois o frontend.

### 1. Backend (NestJS + PostgreSQL + MinIO + Redis + Mailpit)

```bash
cd nestjs-project

# Sobe API, banco, MinIO, Redis e Mailpit
docker compose up -d

# Instala dependências (apenas na primeira vez)
docker compose exec nestjs-api npm install

# Cria o schema do banco (obrigatório — synchronize está desabilitado)
docker compose exec nestjs-api npm run migration:run

# Sobe o servidor de desenvolvimento em watch mode
docker compose exec -d nestjs-api npm run start:dev

# (opcional) Sobe também o worker de vídeo
docker compose --profile worker up -d
```

Serviços disponíveis:

| Serviço | URL / Porta |
|---------|-------------|
| API NestJS | http://localhost:3000 |
| PostgreSQL | `localhost:5432` (db/user/senha: `streamtube`) |
| MinIO (Object Storage) | interno — sem porta exposta; healthcheck via `mc ready local` |
| Redis | interno — sem porta exposta; healthcheck via `redis-cli ping` |
| Mailpit (UI de e-mails) | http://localhost:8025 |
| Swagger (opcional) | http://localhost:3000/api/docs — habilite com `SWAGGER_ENABLED=true` |

> MinIO e Redis não expõem portas no host para evitar conflitos. Toda comunicação é interna via rede Docker.

### 2. Frontend (Next.js)

```bash
cd next-frontend

# Garanta que o .env.local existe (veja .env.example)
# API_URL aponta para o backend; SESSION_PASSWORD protege a sessão (iron-session)

docker compose up -d
docker compose exec next-frontend npm install        # apenas na primeira vez
docker compose exec -d next-frontend npm run dev
```

A aplicação ficará disponível em **http://localhost:3001**.

> As stacks são separadas, então o frontend acessa o backend via `host.docker.internal:3000` (configurado em `next-frontend/.env.local` e no `extra_hosts` do compose).

## 🧪 Testes

### Backend (Jest)

```bash
cd nestjs-project
docker compose exec nestjs-api npm test               # unitários + integração
docker compose exec nestjs-api npm run test:e2e       # end-to-end (HTTP via supertest)
docker compose exec nestjs-api npm run test:cov       # cobertura
```

Sufixos: `*.spec.ts` (unitário), `*.integration-spec.ts` (integração com banco real), `*.e2e-spec.ts` (end-to-end). Testes de integração/e2e rodam com `--runInBand`.

### Frontend (Vitest + Playwright)

```bash
cd next-frontend
docker compose exec next-frontend npm test            # unitários + integração (Vitest + MSW)
npx playwright test                                   # end-to-end (no host, com dev server em MSW_ENABLED=true)
```

Sufixos: `*.test.ts(x)` (unitário), `*.integration.test.ts(x)` (Route Handlers com MSW), `*.e2e-spec.ts` (Playwright). MSW intercepta as chamadas à API NestJS — os testes nunca batem no backend real.

## ✅ Funcionalidades implementadas

**Fase 01 — Configuração base**, **Fase 02 — Autenticação** e **Fase 03 — Upload e Processamento de Vídeos** estão concluídas (backend).

### Autenticação (Fase 02)

Fluxo completo de **cadastro → confirmação por e-mail → login → recuperação de senha**, com canal criado automaticamente para cada usuário (a partir do prefixo do e-mail).

Endpoints da API (`nestjs-project`):

| Método & Rota | Descrição |
|---------------|-----------|
| `POST /auth/register` | Cadastro de usuário (cria usuário + canal) |
| `GET /auth/confirm-email?token=` | Confirmação de conta via link do e-mail |
| `POST /auth/resend-confirmation` | Reenvio do e-mail de confirmação |
| `POST /auth/login` | Login (retorna access + refresh token) |
| `POST /auth/refresh` | Rotação de refresh token (com family + grace period) |
| `POST /auth/logout` | Revoga os refresh tokens da sessão |
| `POST /auth/forgot-password` | Solicita e-mail de recuperação de senha |
| `POST /auth/reset-password` | Redefine a senha via token |
| `GET /auth/me` | Dados do usuário autenticado (protegido por JWT) |

Telas e Route Handlers BFF (`next-frontend`):

- `/(auth)/signup`, `/(auth)/login`, `/(auth)/forgot-password` — formulários com React Hook Form + Zod e validação inline.
- `app/api/auth/{signup,login,logout,forgot-password}` — proxy same-origin para a API.

Segurança: senhas com **Argon2**, **JWT** com `JwtAuthGuard` global (opt-out via `@Public()`), **rotação de refresh token** com detecção de reuso, **rate limiting** (`ThrottlerGuard`) nos endpoints de auth, e sessão no navegador via **iron-session** (cookies HTTP-only).

### Canais e Vídeos (Fase 03 — concluída)

Fluxo completo de **upload multipart → processamento assíncrono → streaming**, do rascunho ao vídeo pronto para assistir.

#### Infra e domínio

| Componente | O que faz |
|------------|-----------|
| `POST /channels` | Cria canal para usuário autenticado com slug gerado automaticamente |
| Docker Compose (MinIO + Redis + worker) | Object storage, broker de filas e worker de vídeo no ambiente de desenvolvimento (worker via `--profile worker`) |
| `StorageModule` | `S3Client` configurado para MinIO com `forcePathStyle`; `StorageService` expõe upload multipart (initiate / presigned-part / complete / abort), `putObject` (streaming via `@aws-sdk/lib-storage`), `getObjectStream` com Range Requests e `generatePresignedGetUrl` |
| `QueueModule` | `BullModule` configurado com Redis via `forRootAsync`; fila `video-processing` disponível para injeção via `@InjectQueue('video-processing')` |
| `VideosModule` / `VideosService` | Entidade `Video` (status enum, slug URL-safe de 11 chars, FK para canal, coluna jsonb `metadata`, `duration_seconds`, `storage_key`, `thumbnail_key`); `VideosService` expõe criação de rascunho, busca por id/slug, atualização de status, `updateAfterProcessing`, `getPublicVideoBySlug` e `getReadyVideoBySlug` |

#### API de upload

| Método & Rota | Descrição |
|---------------|-----------|
| `POST /videos/upload/initiate` | Cria rascunho + inicia multipart no MinIO; retorna `videoId` e `uploadId` |
| `POST /videos/:id/upload/presigned-parts` | Gera URLs pré-assinadas para cada parte do upload |
| `POST /videos/:id/upload/complete` | Finaliza o multipart e enfileira job de processamento |
| `DELETE /videos/:id/upload/abort` | Aborta o multipart e remove o rascunho |

#### API de vídeos

| Método & Rota | Descrição |
|---------------|-----------|
| `GET /videos/:slug` | Metadados do vídeo (anônimo OK; não-prontos visíveis só para o dono) |
| `GET /videos/:slug/stream` | Streaming do vídeo com suporte a `Range` (206 Partial Content) |
| `GET /videos/:slug/download` | Download direto via presigned URL |

#### Worker de vídeo (NestJS standalone + FFmpeg)

Aplicação `NestFactory.createApplicationContext(WorkerModule)` que consome jobs `'video.process'` da fila:

1. Download do arquivo bruto do MinIO para disco temporário
2. `ffprobe` — extrai duração, codec, dimensões
3. Faststart remux com `-c copy` (sem re-encode — move átomos moov para o início)
4. `ffmpeg screenshots` — gera thumbnail a 50% do vídeo
5. Upload do vídeo processado e thumbnail para MinIO
6. `updateAfterProcessing` — grava status READY + metadados no banco

## ✔️ Validação da Fase 03 — Fluxo completo executado

O fluxo de upload → processamento → streaming foi executado e validado de ponta a ponta:

| Etapa | Endpoint / Componente | Resultado |
|-------|-----------------------|-----------|
| Login | `POST /auth/login` | ✅ Token JWT gerado |
| Iniciar upload | `POST /videos/upload/initiate` | ✅ `videoId` + `uploadId` criados; vídeo com `status: draft` |
| URL pré-assinada | `POST /videos/:id/upload/presigned-parts` | ✅ Presigned URL válida para PUT no MinIO |
| Upload para MinIO | PUT direto (presigned URL, sem passar pela API) | ✅ `HTTP 200`, ETag retornado |
| Completar upload | `POST /videos/:id/upload/complete` | ✅ Job enfileirado; `status: processing` |
| Worker processou | BullMQ → `VideoProcessorConsumer` | ✅ `status: ready`; `durationSeconds: 10` |
| Metadados | `GET /videos/:slug` | ✅ Slug único, thumbnail URL gerada |
| Streaming | `GET /videos/:slug/stream` + `Range: bytes=0-4095` | ✅ `HTTP 206 Partial Content` |
| Download | `GET /videos/:slug/download` | ✅ `HTTP 200`, arquivo completo |

### Thumbnail gerada automaticamente pelo worker (FFmpeg a 50% do vídeo)

![Thumbnail gerada automaticamente pelo worker](docs/assets/fase03-thumbnail-example.jpg)

### Suite de testes (rodado em 2026-07-03)

```
Unit + Integration:  179 tests — 28 suites — PASS
E2E (supertest):      68 tests —  6 suites — PASS
tsc --noEmit:        exit 0 (sem erros de compilação)
lint:                 0 errors (23 warnings pré-existentes)
```

### Documentação interativa (Swagger)

Com `SWAGGER_ENABLED=true` no `.env`, acesse **http://localhost:3000/api/docs** para explorar todos os endpoints. Clique em **Authorize** e informe o token JWT obtido em `POST /auth/login` para testar os endpoints protegidos diretamente no navegador.

---

## 🛠️ Estrutura do Projeto

```
green-field-ia-project/
├── docs/
│   ├── project-plan.md                  # Planejamento geral do projeto
│   ├── phases/                          # Planos e implementação por fase
│   │   ├── phase-01-configuracao-base/
│   │   ├── phase-02-auth/               # Auth (backend)
│   │   └── phase-02-auth-frontend/      # Auth (frontend)
│   └── diagrams/
│       └── software-arch.mermaid        # Diagrama de arquitetura (C4)
├── nestjs-project/                      # Backend API (NestJS 11)
│   ├── src/
│   │   ├── auth/                        # Cadastro, login, JWT, refresh, reset de senha
│   │   ├── users/                       # Entidade e serviço de usuários
│   │   ├── channels/                    # Canal por usuário (slug auto-gerado, many-to-one)
│   │   ├── storage/                     # S3Client (MinIO) + StorageService (multipart + streaming)
│   │   ├── mail/                        # Envio de e-mails (templates Handlebars)
│   │   ├── common/                      # Filtros, pipes e exceptions de domínio
│   │   ├── config/                      # Configs namespaced (Joi)
│   │   └── database/                    # data-source, migrations e seeds
│   ├── test/                            # Testes e2e
│   ├── compose.yaml                     # Docker Compose (API + PostgreSQL + MinIO + Redis + Mailpit)
│   ├── Dockerfile.dev
│   └── Dockerfile.worker               # Worker de vídeo (node:22-alpine + ffmpeg, multi-stage)
├── next-frontend/                       # Frontend (Next.js 16, App Router)
│   ├── app/                             # Rotas, layouts, páginas e Route Handlers BFF
│   ├── components/                      # Componentes de auth, UI (shadcn) e ícones
│   ├── lib/                             # env, api (openapi-fetch), auth/session
│   ├── mocks/                           # MSW (handlers + server)
│   ├── tests/                           # E2E (Playwright)
│   ├── compose.yaml                     # Docker Compose (dev server)
│   └── Dockerfile.dev
├── CLAUDE.md                            # Instruções para IA
├── FC Tube.fig                          # Design system do projeto (Figma)
├── whiteboard.png                       # Quadro branco do projeto
└── README.md
```

## 📚 Fases do Projeto

| Fase | Descrição | Status |
|------|-----------|--------|
| **01** | Configuração Base do Projeto | ✅ Concluída |
| **02** | Cadastro, Login e Gerenciamento de Conta | ✅ Concluída |
| **03** | Upload e Processamento de Vídeos | ✅ Concluída |
| **04** | Gerenciamento de Vídeos e Canal | ⏳ Planejada |
| **05** | Página de Visualização do Vídeo | ⏳ Planejada |
| **06** | Interações Sociais (Likes, Comentários, Inscrições) | ⏳ Planejada |
| **07** | Página Inicial, Busca e Finalização | ⏳ Planejada |

Detalhes completos em `docs/project-plan.md`.

## 📖 Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, React Hook Form + Zod, iron-session, openapi-fetch |
| Backend | NestJS 11, TypeScript, TypeORM, JWT, Argon2, Mailer (Handlebars), AWS SDK v3 |
| Banco de Dados | PostgreSQL 17 |
| Object Storage | MinIO (S3-compatible) |
| Message Queue | Redis 7 + BullMQ |
| E-mail (dev) | Mailpit |
| Containerização | Docker, Docker Compose |
| Testes | Jest, Supertest (backend); Vitest, MSW, Playwright (frontend) |
| Qualidade | ESLint, Prettier |
</content>
