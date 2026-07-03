---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.1
target_file: test/channels.e2e-spec.ts
---

# POST /channels — Test Plan

## Application Overview

O endpoint `POST /channels` permite que usuários autenticados criem um canal mínimo (Channel entity) que serve de pré-requisito para o FK `channel_id` da entidade Video. Um slug único é auto-derivado do nome se não fornecido. Em caso de slug duplicado, retorna 409 CHANNEL_SLUG_TAKEN. Endpoints protegidos pelo JwtAuthGuard global; sem JWT retorna 401.

## Test Scenarios

### 1. Canal creation

**Setup:** beforeAll → bootstrap AppModule completo + reproduce main.ts globals (ValidationPipe, DomainExceptionFilter); beforeEach → `dataSource.query('DELETE FROM channels')` para garantir estado limpo; criar e logar usuário de teste para obter JWT válido

#### 1.1. successful-channel-creation

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. POST /channels com body `{ "name": "Meu Canal" }` e header `Authorization: Bearer {valid-jwt}`
    - expect: status 201
    - expect: response body contém `id` (string uuid), `user_id` (string uuid), `name` igual a "Meu Canal", `slug` (string não vazio), `created_at` (string ISO-8601)
    - expect: `slug` é derivado de "Meu Canal" (ex: "meu-canal" ou similar kebab-case)

#### 1.2. duplicate-slug-returns-409

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. POST /channels com body `{ "name": "Canal Teste", "slug": "canal-teste" }` e JWT válido
    - expect: status 201
  2. POST /channels com body `{ "name": "Outro Canal", "slug": "canal-teste" }` e mesmo JWT
    - expect: status 409
    - expect: response body contém `error: "CHANNEL_SLUG_TAKEN"`

#### 1.3. unauthenticated-returns-401

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. POST /channels com body `{ "name": "Canal" }` sem header Authorization
    - expect: status 401
