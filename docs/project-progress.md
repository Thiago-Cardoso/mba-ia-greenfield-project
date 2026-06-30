# StreamTube — O que foi desenvolvido até agora

> Gerado em: 2026-06-30

---

## Fases Concluídas

### Fase 01 — Configuração Base do Projeto ✅

Fundação completa do monorepo e ambiente de desenvolvimento.

**Monorepo e ambiente:**
- Estrutura de monorepo com `nestjs-project/` e `next-frontend/`
- Docker Compose para backend (NestJS + PostgreSQL + Mailpit)
- Docker Compose para frontend (Next.js)
- Dockerfiles de desenvolvimento para ambos os projetos

**Backend (nestjs-project):**
- NestJS 11 inicializado com TypeScript
- Configuração de variáveis de ambiente com validação via `class-validator` (`src/config/env.validation.ts`)
- Configuração modularizada: `app.config.ts`, `auth.config.ts`, `database.config.ts`, `mail.config.ts`, `swagger.config.ts`
- TypeORM configurado com PostgreSQL (`src/database/data-source.ts`)
- Migration inicial: `CreateUsersAndChannels` (tabelas `users` e `channels`)
- Seed de dados de desenvolvimento (`src/database/seeds/seed.ts`)
- Documentação OpenAPI/Swagger auto-gerada e exportada para `openapi.json`
- Fundação de IA: `CLAUDE.md`, regras de testes, skills (NestJS best practices, TypeORM, testing guide)

**Frontend (next-frontend):**
- Next.js inicializado com App Router e TypeScript
- Configuração de variáveis de ambiente (`lib/env.ts`)
- Fundação de IA: `CLAUDE.md`, skills (Next best practices, Vercel React best practices, Playwright, testing guide)
- Vitest + MSW (Mock Service Worker) configurados para testes unitários/integração
- Playwright configurado para testes e2e
- shadcn/ui instalado e configurado com design system customizado
- Tipagem TypeScript gerada a partir do OpenAPI do backend (`lib/api/types.gen.ts`)
- Instrumentation file para MSW no servidor (`instrumentation.ts`)

---

### Fase 02 — Cadastro, Login e Gerenciamento de Conta ✅

Fluxo completo de autenticação implementado no backend e frontend.

#### Backend (nestjs-project)

**Módulo Users (`src/users/`):**
- Entidade `User` (TypeORM) com campos: id, email, password hash, confirmação de conta, timestamps
- `UsersService`: criação de usuário, busca por email, confirmação de conta, reset de senha
- Migration: `CreateUsersAndChannels`

**Módulo Channels (`src/channels/`):**
- Entidade `Channel` com relação 1:1 com `User`
- Criação automática do canal ao registrar usuário (nickname derivado do prefixo do e-mail)
- `ChannelsService`: criação de canal, utilidade de normalização de nickname (`nickname.util.ts`)

**Módulo Auth (`src/auth/`):**
- `AuthService`: register, login, logout, refresh token, confirmação de e-mail, forgot password, reset password
- Entidade `RefreshToken` — armazenamento no banco com controle de expiração e rotação
- Entidade `VerificationToken` — tokens de confirmação de e-mail e reset de senha
- JWT stateless para access token + refresh token no banco (rotação a cada refresh)
- Guards: `JwtAuthGuard` (global, com suporte a `@Public()`)
- Decoradores: `@CurrentUser()`, `@Public()`
- DTOs: `RegisterDto`, `LoginDto`, `RefreshTokenDto`, `ConfirmEmailDto`, `ForgotPasswordDto`, `ResetPasswordDto`, `ResendConfirmationDto`
- Controller REST com endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `POST /auth/confirm-email`, `POST /auth/resend-confirmation`, `POST /auth/forgot-password`, `POST /auth/reset-password`

**Módulo Mail (`src/mail/`):**
- `MailService` com Nodemailer + templates Handlebars
- E-mails transacionais: confirmação de conta e recuperação de senha
- Configurado para Mailpit (dev) via Docker Compose

**Infraestrutura comum (`src/common/`):**
- `DomainException` — exceção de domínio tipada
- `DomainExceptionFilter` — converte exceções de domínio em respostas HTTP estruturadas
- `ValidationExceptionFilter` — trata erros de validação (class-validator)
- `ApiErrorEnvelopeDto` — envelope padrão de erro para documentação OpenAPI

#### Frontend (next-frontend)

**Design System (componentes UI base):**
- `Button`, `Input`, `Label`, `Card`, `Checkbox` — primitivos shadcn/ui customizados
- `IconButton` — botão de ícone acessível
- Ícones SVG: `ArrowBackIcon`, `CheckIcon`, `EyeIcon`, `EyeOffIcon`, `StreamtubeIcon`

**Componentes de autenticação (`components/auth/`):**
- `LoginForm` — formulário de login com validação client-side
- `SignupForm` — formulário de cadastro com indicador de força de senha
- `ForgotPasswordForm` — formulário de recuperação de senha
- `PasswordStrengthMeter` — medidor visual de força de senha
- `PasswordVisibilityToggle` — botão de mostrar/ocultar senha
- `TermsCheckbox` — checkbox de aceite dos termos
- `BackLink` — link de retorno com ícone
- `BrandLogo` — logotipo do StreamTube
- `AuthFooter` — rodapé de navegação entre login/cadastro
- `FieldError` — exibição de erro por campo
- `SessionProvider` — provider de contexto de sessão (React Context)

**Páginas (`app/`):**
- `/(auth)/login/page.tsx` — página de login
- `/(auth)/signup/page.tsx` — página de cadastro
- `/(auth)/forgot-password/page.tsx` — página de recuperação de senha
- `layout.tsx` — layout raiz com providers globais
- `page.tsx` — home page (placeholder)

**Route Handlers (BFF — `app/api/auth/`):**
- `POST /api/auth/login` — proxy para backend + set de cookie httpOnly com access/refresh token
- `POST /api/auth/signup` — proxy para registro no backend
- `POST /api/auth/logout` — limpa cookies de sessão
- `POST /api/auth/forgot-password` — proxy para forgot password no backend

**Biblioteca de auth (`lib/auth/`):**
- `session.ts` — leitura/escrita de cookies de sessão (server-only)
- `refresh.ts` — lógica de refresh silencioso do access token
- `error-mapping.ts` — mapeamento de erros da API para mensagens de usuário

**Biblioteca de API (`lib/api/`):**
- `types.gen.ts` — tipos TypeScript gerados do OpenAPI do backend
- `contracts.ts` — contratos de request/response tipados
- `upstream.ts` — cliente HTTP para chamar o backend (server-side)

**Hooks (`hooks/`):**
- `use-session.ts` — hook para leitura da sessão no cliente

**MSW (mocks para testes):**
- `mocks/handlers/auth.ts` — handlers de mock para endpoints de auth
- `mocks/handlers/_seed.ts` — dados de seed para os mocks
- `mocks/server.ts` / `mocks/setup.ts` — configuração do servidor MSW

---

## Testes Implementados

### Backend (nestjs-project) — Jest

| Arquivo | Tipo | Cobertura |
|---------|------|-----------|
| `app.controller.spec.ts` | Unit | AppController |
| `auth/auth.service.spec.ts` | Unit | AuthService (lógica, sem DB) |
| `auth/auth.service.integration-spec.ts` | Integration | AuthService com banco real |
| `auth/auth.module.spec.ts` | Unit | Wiring do AuthModule |
| `auth/guards/jwt-auth.guard.spec.ts` | Unit | JwtAuthGuard |
| `auth/entities/refresh-token.entity.integration-spec.ts` | Integration | RefreshToken no banco |
| `auth/entities/verification-token.entity.integration-spec.ts` | Integration | VerificationToken no banco |
| `channels/channels.service.spec.ts` | Unit | ChannelsService |
| `channels/channels.service.integration-spec.ts` | Integration | ChannelsService com banco |
| `channels/channels.module.spec.ts` | Unit | Wiring do ChannelsModule |
| `channels/nickname.util.spec.ts` | Unit | Utilitário de nickname |
| `channels/entities/channel.entity.integration-spec.ts` | Integration | Channel no banco |
| `common/filters/domain-exception.filter.spec.ts` | Unit | DomainExceptionFilter |
| `common/filters/validation-exception.filter.spec.ts` | Unit | ValidationExceptionFilter |
| `config/env.validation.integration-spec.ts` | Integration | Validação de env vars |
| `config/swagger.config.spec.ts` | Unit | SwaggerConfig |
| `database/migrations.integration-spec.ts` | Integration | Migrations no banco |
| `mail/mail.service.integration-spec.ts` | Integration | MailService com Mailpit |
| `mail/mail.module.spec.ts` | Unit | Wiring do MailModule |
| `openapi-export.integration-spec.ts` | Integration | Exportação do openapi.json |
| `users/entities/user.entity.integration-spec.ts` | Integration | User no banco |
| `users/users.service.integration-spec.ts` | Integration | UsersService com banco |
| `users/users.module.spec.ts` | Unit | Wiring do UsersModule |
| `test/*.e2e-spec.ts` | E2E | Fluxo HTTP completo via Supertest |

### Frontend (next-frontend) — Vitest + Playwright

| Arquivo | Tipo | Cobertura |
|---------|------|-----------|
| `components/auth/__tests__/login-form.wiring.test.tsx` | Unit/Wiring | LoginForm |
| `components/auth/__tests__/signup-form.wiring.test.tsx` | Unit/Wiring | SignupForm |
| `components/auth/__tests__/forgot-password-form.wiring.test.tsx` | Unit/Wiring | ForgotPasswordForm |
| `components/auth/__tests__/password-strength-meter.test.tsx` | Unit | PasswordStrengthMeter |
| `components/auth/__tests__/password-visibility-toggle.test.tsx` | Unit | PasswordVisibilityToggle |
| `components/auth/__tests__/terms-checkbox.test.tsx` | Unit | TermsCheckbox |
| `components/auth/__tests__/back-link.test.tsx` | Unit | BackLink |
| `components/auth/__tests__/session-provider.test.tsx` | Unit | SessionProvider |
| `components/ui/__tests__/checkbox.test.tsx` | Unit | Checkbox |
| `components/ui/__tests__/icon-button.test.tsx` | Unit | IconButton |
| `hooks/__tests__/use-session.test.tsx` | Unit | useSession hook |
| `lib/auth/__tests__/session.test.ts` | Unit | session.ts |
| `lib/auth/__tests__/refresh.integration.test.ts` | Integration | refresh.ts |
| `app/api/auth/login/__tests__/route.integration.test.ts` | Integration | Route handler de login |
| `app/api/auth/signup/__tests__/route.integration.test.ts` | Integration | Route handler de signup |
| `app/api/auth/logout/__tests__/route.integration.test.ts` | Integration | Route handler de logout |
| `app/api/auth/forgot-password/__tests__/route.integration.test.ts` | Integration | Route handler forgot-password |
| `tests/auth-login.e2e-spec.ts` | E2E (Playwright) | Fluxo de login end-to-end |
| `tests/auth-signup.e2e-spec.ts` | E2E (Playwright) | Fluxo de cadastro end-to-end |
| `tests/auth-forgot-password.e2e-spec.ts` | E2E (Playwright) | Fluxo de forgot password e2e |

---

## Documentação e Decisões Técnicas

### Documentos de decisões (`docs/decisions/`)

| Arquivo | Descrição |
|---------|-----------|
| `technical-decisions-phase-01-configuracao-base.md` | Decisões da Fase 01 (stack base, Docker, DB) |
| `technical-decisions-phase-02-auth.md` | Decisões da Fase 02 backend (JWT, refresh tokens, hashing) |
| `technical-decisions-phase-02-auth-frontend.md` | Decisões da Fase 02 frontend (token transport, session, BFF) |
| `technical-decisions-openapi-docs-nestjs.md` | Decisões de documentação OpenAPI no NestJS |
| `technical-decisions-next-frontend-config-base.md` | Decisões de configuração base do Next.js |
| `technical-decisions-next-frontend-msw-foundation.md` | Decisões de fundação de MSW e testes no Next.js |
| `technical-decisions-next-frontend-openapi-typing.md` | Decisões de tipagem OpenAPI no frontend |

### Documentos de fase (`docs/phases/`)

- `phase-01-configuracao-base/` — contexto, plano e validação da Fase 01
- `phase-02-auth/` — contexto, plano e validação da Fase 02 (backend)
- `phase-02-auth-frontend/` — contexto, plano e validação da Fase 02 (frontend)

---

## Infraestrutura e Tooling

| Item | Detalhe |
|------|---------|
| Runtime | Node.js 25.6.0 (via Docker) |
| Backend | NestJS 11, TypeScript, Express |
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Banco de dados | PostgreSQL 17 |
| E-mail dev | Mailpit (SMTP local com interface web em :8025) |
| Contêineres | Docker Compose (backend: porta 3000; frontend: porta 3001) |
| ORM | TypeORM com migrations |
| Auth | JWT (access token) + Refresh Token no banco (rotação) |
| Testes backend | Jest, Supertest |
| Testes frontend | Vitest, React Testing Library, MSW, Playwright |
| API Docs | Swagger/OpenAPI (disponível em `/api-docs`) |
| Linting | ESLint + Prettier |

---

## Próximas Fases (não iniciadas)

- **Fase 03** — Upload e Processamento de Vídeos (MinIO/S3, FFmpeg, filas)
- **Fase 04** — Gerenciamento de Vídeos e Canal
- **Fase 05** — Feed, Reprodução e Interações Sociais
