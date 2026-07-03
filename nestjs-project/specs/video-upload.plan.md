---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: test/video-upload.e2e-spec.ts
---

# Upload Multipart — Test Plan

## Application Overview

Os endpoints de upload multipart permitem que usuários autenticados iniciem, assinem partes e completem ou abortem um upload de vídeo de até 10 GB diretamente no MinIO via URLs presignadas. O fluxo é: initiate → presigned-parts → complete (ou DELETE abort). Apenas o dono do vídeo pode executar as etapas após initiate. O vídeo nasce com status 'draft' e passa para 'processing' ao completar o upload.

## Test Scenarios

### 1. Upload initiation

**Setup:** beforeAll → bootstrap AppModule completo + reproduce main.ts globals (ValidationPipe, DomainExceptionFilter); criar usuário + canal de teste, obter JWT; beforeEach → `dataSource.query('DELETE FROM videos')` + limpar uploads em progresso no MinIO se necessário

#### 1.1. initiate-returns-201-with-upload-info

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. POST /videos/upload/initiate com body `{ "channelId": "{valid-channel-id}", "title": "Meu Vídeo", "fileSize": 10485760, "contentType": "video/mp4" }` e JWT válido
    - expect: status 201
    - expect: response body contém `videoId` (string uuid), `uploadId` (string não vazio), `partSize` (number, 8388608), `totalParts` (number ≥ 1)
    - expect: `totalParts` = ceil(10485760 / 8388608) = 2

#### 1.2. initiate-rejects-oversized-file

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. POST /videos/upload/initiate com body `{ "channelId": "{valid-channel-id}", "title": "Grande", "fileSize": 10737418241, "contentType": "video/mp4" }` e JWT válido
    - expect: status 400
    - expect: response body indica validation error (fileSize excede limite de 10 GB)

### 2. Ownership and status enforcement

**Setup:** compartilha setup do describe principal; adicionalmente criar segundo usuário para testar cross-owner; usar initiate para criar vídeo draft antes de cada cenário de ownership

#### 2.1. presigned-parts-cross-owner-returns-403

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. Usuário A faz POST /videos/upload/initiate para criar vídeo (videoId, uploadId)
    - expect: status 201
  2. Usuário B (JWT diferente) faz POST /videos/{videoId}/upload/presigned-parts com body `{ "uploadId": "{uploadId}", "partNumbers": [1] }`
    - expect: status 403
    - expect: response body contém `error: "VIDEO_ACCESS_DENIED"`

#### 2.2. complete-non-draft-video-returns-409

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. Inserir diretamente no banco um vídeo com status 'processing' pertencente ao usuário de teste (via dataSource ou repository)
  2. POST /videos/{videoId}/upload/complete com body `{ "uploadId": "some-id", "parts": [{ "partNumber": 1, "etag": "abc" }] }` e JWT do dono
    - expect: status 409
    - expect: response body contém `error: "VIDEO_NOT_IN_DRAFT"`

### 3. Upload completion

**Setup:** compartilha setup do describe principal; fluxo completo requer upload real de pelo menos uma parte no MinIO

#### 3.1. complete-with-valid-parts-returns-processing

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. POST /videos/upload/initiate com fileSize pequeno (ex: 5 MB) → obtém videoId, uploadId, partSize=8388608, totalParts=1
    - expect: status 201
  2. POST /videos/{videoId}/upload/presigned-parts com body `{ "uploadId": "{uploadId}", "partNumbers": [1] }` → obtém presigned URL para part 1
    - expect: status 200, body.parts[0].url é string (URL presigned MinIO)
  3. PUT na presigned URL retornada com dados binários (ex: 1 byte payload + Content-Length) → S3 retorna ETag no response header
    - expect: resposta HTTP 200 da MinIO com header ETag
  4. POST /videos/{videoId}/upload/complete com body `{ "uploadId": "{uploadId}", "parts": [{ "partNumber": 1, "etag": "{etag}" }] }`
    - expect: status 200
    - expect: response body contém `videoId` (uuid) e `status: "processing"`
