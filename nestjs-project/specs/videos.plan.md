---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos.e2e-spec.ts
---

# VideoController — Test Plan

## Application Overview

O VideoController expõe endpoints públicos e semi-públicos para metadados, streaming e download de vídeos. `GET /videos/:slug` retorna metadados (autenticado ou anônimo para vídeos 'ready'; dono vê qualquer status). `GET /videos/:slug/stream` e `GET /videos/:slug/download` são `@Public()` e servem apenas vídeos com status 'ready': stream usa HTTP Range Requests (206 Partial Content) e download usa Content-Disposition attachment.

## Test Scenarios

### 1. Video metadata

**Setup:** beforeAll → bootstrap AppModule completo + reproduce main.ts globals (ValidationPipe, DomainExceptionFilter, global prefix se houver); criar canal + usuário de teste; inserir vídeo com status 'ready' e vídeo com status 'processing' diretamente via dataSource para os cenários de metadata e status-gate; beforeEach → não limpa vídeos (setup compartilhado usa dados fixos por describe)

#### 1.1. ready-video-metadata-returns-200

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. GET /videos/{ready-video-slug} (sem Authorization ou com JWT válido)
    - expect: status 200
    - expect: response body contém `id` (string uuid), `slug` (string), `title` (string), `status: "ready"`, `channel` (objeto com `id`, `name`, `slug`), `durationSeconds` (number | null), `createdAt` (string ISO-8601)

#### 1.2. nonexistent-slug-returns-404

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. GET /videos/slug-que-nao-existe
    - expect: status 404
    - expect: response body contém `error: "VIDEO_NOT_FOUND"`

### 2. Video streaming (Range Requests)

**Setup:** compartilha setup do describe principal; requer arquivo de vídeo real no MinIO com storage_key registrado no banco para o vídeo 'ready' — upload de arquivo de teste pequeno (ex: arquivo mp4 válido de poucos KB) via StorageService ou diretamente via AWS SDK no beforeAll

#### 2.1. stream-with-range-header-returns-206

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. GET /videos/{ready-video-slug}/stream com header `Range: bytes=0-1023`
    - expect: status 206
    - expect: response header `Content-Range` no formato `bytes 0-1023/{total-size}`
    - expect: response header `Accept-Ranges: bytes`
    - expect: response body tem exatamente 1024 bytes (ou menos se arquivo menor)

#### 2.2. stream-without-range-returns-200

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. GET /videos/{ready-video-slug}/stream sem header Range
    - expect: status 200
    - expect: response header `Accept-Ranges: bytes`
    - expect: response body é o arquivo de vídeo completo (Content-Length presente)

#### 2.3. stream-processing-video-returns-403

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. GET /videos/{processing-video-slug}/stream
    - expect: status 403
    - expect: response body contém `error: "VIDEO_NOT_READY"`

### 3. Video download

**Setup:** compartilha setup do describe principal (mesmo arquivo de vídeo no MinIO)

#### 3.1. download-returns-200-with-attachment-header

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-06-30T21:00:00Z

**Steps:**
  1. GET /videos/{ready-video-slug}/download
    - expect: status 200
    - expect: response header `Content-Disposition` contém `attachment` e o nome do vídeo (ex: `attachment; filename="{video-title}.mp4"`)
    - expect: response body é o conteúdo binário do arquivo de vídeo
