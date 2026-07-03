---
scope_type: phase
related_phases: [3]
status: resolved
date: 2026-06-30
scope_description: "Message queue choice, large-file upload strategy, video worker deployment, object storage SDK, bucket/key organization, video streaming & download, unique slug generation, and video status lifecycle for Phase 03 — Upload e Processamento de Vídeos."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend API (upload initiation, video registration, streaming endpoint, download endpoint) + video worker (FFmpeg processing, metadata extraction, thumbnail generation); todos os entregáveis da Fase 03 são backend-only.
- `next-frontend/` — explicitamente fora do escopo desta fase: per `prompt-requirement.md`, "a interface de vídeo não faz parte do escopo desta fase." Nenhuma decisão técnica aberta neste documento.

---

## TD-01: Tecnologia de fila de mensagens

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O plano do projeto define "Message Queue (TBD)" como componente de infraestrutura. O processamento de vídeo (FFmpeg) é CPU-intensivo e deve ocorrer em segundo plano, desacoplado da API. A escolha define a dependência de infraestrutura (novo container no Compose), a biblioteca NestJS para produzir e consumir jobs, e o modelo de retry/falha no worker.

**Options:**

### Option A: BullMQ + Redis
- BullMQ é uma biblioteca Node.js de filas de jobs construída sobre Redis. O NestJS tem suporte oficial via `@nestjs/bullmq`. Cada job de processamento é enfileirado no Redis; o worker consome com retry automático configurável, delayed jobs e concorrência por fila.
- **Pros:** Integração nativa com NestJS (`@nestjs/bullmq`); Redis é leve e fácil de adicionar ao Compose; suporte a retry automático, prioridades, rate limiting e concorrência configurável; amplamente usado para processamento de mídia em Node.js; UI de monitoramento via Bull Board.
- **Cons:** Adiciona Redis como nova dependência de infraestrutura; BullMQ requer Redis — não funciona com outro broker sem substituir a lib.

### Option B: RabbitMQ (AMQP)
- RabbitMQ é um message broker AMQP independente de linguagem. O NestJS suporta via `@nestjs/microservices` com transportador AMQP.
- **Pros:** Agnóstico de linguagem — útil se o worker migrar para outra linguagem; routing avançado com exchanges; robusto e battle-tested.
- **Cons:** Mais complexo de configurar e operar; menor integração nativa com NestJS/Node.js; sem retry automático out-of-the-box (requer dead-letter exchanges manuais); overhead de protocolo AMQP para um caso de uso de job queue simples.

### Option C: Kafka
- Plataforma de streaming de eventos distribuída. Suportada no NestJS via `@nestjs/microservices` com transportador Kafka.
- **Pros:** Alta throughput para streaming de eventos; log durável com retenção configurável; consumer groups com balanceamento de carga.
- **Cons:** Overkill para processamento de vídeo em lote; exige Zookeeper (ou KRaft) no Compose, consumo de memória elevado; sem mecanismo de job retry nativo comparável ao BullMQ; curva de aprendizado alta.

**Recommendation:** Option A (BullMQ + Redis) — o stack é inteiramente Node.js/NestJS, o suporte oficial `@nestjs/bullmq` reduz boilerplate, e Redis é uma dependência leve. RabbitMQ agrega valor quando há workers em múltiplas linguagens — não é o caso desta fase. Kafka é excessivo para processamento de jobs sequenciais de vídeo.

**Decision:** Option A (BullMQ + Redis)

**Libraries:** `@nestjs/bullmq`, `bullmq`, `ioredis`

---

## TD-02: Estratégia de upload de arquivos grandes (até 10GB)

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O upload de até 10GB não pode passar integralmente pelo processo NestJS (alto consumo de memória, bloqueio do servidor API). O MinIO (API S3-compatible) é o storage definido. A estratégia define o handshake entre cliente, API e MinIO — quem recebe o binário e como o arquivo chega ao storage sem travar a API.

**Options:**

### Option A: Multipart presigned URL (S3 multipart upload)
- O backend inicia um multipart upload no MinIO e devolve ao cliente uma lista de presigned URLs (uma por parte, ex: 100MB cada). O cliente faz upload de cada parte diretamente para o MinIO (bypassing a API) e ao final chama a API para completar o multipart, informando a lista de ETags.
- **Pros:** Nenhum binário trafega pelo NestJS (zero carga de memória na API); suporta arquivos de qualquer tamanho; permite upload paralelo de partes; cliente pode retomar partes individuais em caso de falha parcial; arquitetura de produção recomendada pela AWS/MinIO.
- **Cons:** O frontend precisa orquestrar as partes (dividir o arquivo, fazer upload de cada parte, coletar ETags); maior complexidade no cliente; a notificação de conclusão requer uma chamada de volta à API com os ETags.

### Option B: Streaming direto pelo NestJS → MinIO (`putObject` via pipe)
- O NestJS recebe o arquivo via `multipart/form-data` e faz pipe do stream diretamente para o MinIO usando `putObject` (sem buffer em memória). O arquivo nunca é armazenado em disco no API server.
- **Pros:** Implementação mais simples — sem orquestração do cliente; stream passa pelo NestJS sem acumular em memória; compatível com minio-js sem AWS SDK; adequado para ambiente de desenvolvimento local.
- **Cons:** O socket da requisição HTTP fica aberto durante todo o upload (minutos para 10GB em rede lenta); uploads simultâneos saturem a rede/CPU da API; sem suporte a retomada nativa; em produção, throughput da API é limitado pela largura de banda do servidor.

### Option C: Protocolo tus (`@tus/server` + MinIO store)
- tus é um protocolo padronizado de upload resumável via HTTP PATCH. O backend instala `@tus/server` com `@tus/s3-store` apontando para o MinIO. O cliente usa `tus-js-client`. Uploads interrompidos são retomados automaticamente.
- **Pros:** Retomada nativa em caso de falha de conexão; upload não passa pelo processo NestJS (o store lida com o stream diretamente); protocolo padronizado (RFC em progresso no IETF).
- **Cons:** Adiciona `@tus/server` e `@tus/s3-store` (que depende do AWS SDK v3); o servidor tus precisa ser montado como middleware raw no NestJS (fora do ciclo de controllers e guards); mais complexo de integrar com o padrão de módulos NestJS.

**Recommendation:** Option A (Multipart presigned URL) — elimina carga na API sem a complexidade do protocolo tus. Para o MVP desta fase, a falta de retomada automática é aceitável; o cliente pode exibir progresso e pedir reenvio em caso de falha. Produz a arquitetura mais próxima de produção com S3 real. Option B é aceitável apenas para desenvolvimento local quando simplicidade é prioridade. Option C é a melhor escolha se retomada nativa for requisito prioritário.

**Decision:** Option A (Multipart presigned URL)

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage`

---

## TD-03: Localização e estrutura do worker de vídeo

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** O processamento FFmpeg (extração de metadados, geração de thumbnail, aplicação de faststart) é CPU-intensivo. O project-plan descreve "Video Worker (FFmpeg)" como container separado na arquitetura C4. Esta decisão define onde o worker vive no repositório, como é estruturado e como acessa o banco e o storage.

**Options:**

### Option A: Container separado — aplicação NestJS standalone
- Um segundo container Node.js (com FFmpeg instalado) executa uma aplicação NestJS mínima contendo apenas o módulo de consumer BullMQ. Consome jobs da fila, processa com FFmpeg via `fluent-ffmpeg`, salva resultados no MinIO e atualiza o banco via TypeORM.
- **Pros:** Isola carga de CPU — o API server não é impactado por transcodings simultâneos; escala independentemente (múltiplas réplicas do worker); alinhado com a arquitetura do project-plan; compartilha entidades TypeORM do monorepo por referência direta; padrão NestJS mantém consistência de config e DI.
- **Cons:** Adiciona um container e Dockerfile ao Compose; acesso direto ao banco compartilhado com a API (cuidado com migrações rodando apenas via API).

### Option B: Container separado — script Node.js simples (sem NestJS)
- O worker é um script Node.js puro (sem NestJS) que consome jobs do BullMQ diretamente via classe `Worker` do `bullmq`, processa com `fluent-ffmpeg` e usa TypeORM standalone para atualizar o banco.
- **Pros:** Menor overhead de inicialização; sem DI container; mais simples para uma tarefa única e bem definida.
- **Cons:** Perde o padrão do projeto (DI, módulos, `@nestjs/config`); duplica setup de TypeORM fora do padrão; dificulta reuso de utilitários e entidades do projeto.

### Option C: Consumer inline no processo da API (sem container separado)
- Um módulo NestJS dentro da própria API registra um consumer BullMQ que processa jobs no mesmo processo.
- **Pros:** Sem container adicional; implementação mais simples; compartilha tudo com a API sem overhead de rede.
- **Cons:** Processamento FFmpeg compete com requests HTTP pelo CPU e event loop; não escala independentemente; contradiz a arquitetura do project-plan; FFmpeg precisa estar instalado no container da API.

**Recommendation:** Option A (NestJS standalone em container separado) — alinhado com o project-plan e com a separação de responsabilidades. O custo de setup adicional (um Dockerfile com FFmpeg + um service no Compose) é baixo comparado ao isolamento de CPU. Usar NestJS no worker mantém consistência de padrão (config, TypeORM, BullMQ) e facilita reuso de entidades do monorepo.

**Decision:** Option A (NestJS standalone em container separado)

**Libraries:** `fluent-ffmpeg`, `@types/fluent-ffmpeg`

---

## TD-04: SDK de integração com MinIO

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** MinIO ainda não está no stack do projeto. Precisa-se de um SDK Node.js para fazer upload de objetos, gerar presigned URLs para upload/download e baixar objetos para processamento. Dois SDKs são compatíveis com MinIO (S3-compatible API). A escolha impacta diretamente TD-02 (estratégia de upload), pois o suporte a multipart upload presigned varia entre os SDKs.

**Options:**

### Option A: minio-js (SDK oficial MinIO)
- SDK oficial do MinIO para Node.js. API específica para MinIO: `presignedPutObject`, `presignedGetObject`, `putObject`, `getObject`.
- **Pros:** API direta para MinIO; sem dependência do AWS SDK; documentação oficial do MinIO; mais leve.
- **Cons:** API proprietária (não padrão S3); migrar para S3 real no futuro exige mudar o SDK; suporte a multipart presigned URLs menos robusto e menos documentado que o AWS SDK; menos exemplos de integração com NestJS disponíveis.

### Option B: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- O AWS SDK v3 funciona com qualquer storage S3-compatible configurando o `endpoint` para apontar ao MinIO. Usa `S3Client`, `PutObjectCommand`, `GetObjectCommand`, `CreateMultipartUploadCommand` e `getSignedUrl`. `@aws-sdk/lib-storage` simplifica uploads multipart grandes.
- **Pros:** API S3 padrão de mercado — migrar de MinIO para S3 real é só mudar variáveis de ambiente; suporte nativo e robusto a multipart upload com presigned URLs; TypeScript types completos; vasta documentação e exemplos; funciona com qualquer S3-compatible (MinIO, GCS, Cloudflare R2).
- **Cons:** Dois pacotes (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`); pode parecer "overengineered" para um setup local com MinIO.

**Recommendation:** Option B (AWS SDK v3) — a API S3 é o padrão de mercado. Migrar de MinIO local para S3 em produção é trivial (variáveis de ambiente). O suporte a multipart upload com presigned URLs é mais completo e documentado, o que é crítico caso TD-02 escolha Option A. `@aws-sdk/lib-storage` abstrai a orquestração de partes automaticamente.

**Decision:** Option B (AWS SDK v3)

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

---

## TD-05: Organização de buckets e padrão de chaves no MinIO

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O MinIO organiza objetos em buckets. A estrutura de buckets e o padrão de chaves são compartilhados entre a API (upload), o worker (download para processamento + upload de thumbnail) e o endpoint de streaming (leitura do objeto). Uma convenção explícita evita acoplamento implícito entre os dois serviços e é parte do contrato entre API e worker.

**Options:**

### Option A: Bucket único (`streamtube`) com prefixos de tipo
- Um único bucket para todo o conteúdo. Chaves com prefixo de tipo: `videos/{videoId}/original.mp4`, `videos/{videoId}/thumbnail.jpg`.
- **Pros:** Configuração mínima (um bucket, uma política); permissões unificadas; mais simples no Compose (uma variável `MINIO_BUCKET`).
- **Cons:** Permissões não granulares — impossível dar acesso público só a thumbnails sem expor os vídeos; sem separação lógica por tipo de conteúdo; lifecycle rules únicas para conteúdos com políticas diferentes.

### Option B: Dois buckets (`streamtube-videos` + `streamtube-thumbnails`)
- Vídeos e thumbnails em buckets separados. Chaves simples: `{videoId}/original.mp4` (bucket de vídeos) e `{videoId}/thumbnail.jpg` (bucket de thumbnails).
- **Pros:** Políticas de acesso granulares (thumbnails públicos, vídeos restritos a presigned URLs); separação semântica alinhada ao project-plan ("vídeos e thumbnails"); lifecycle rules independentes por bucket; mais fácil de expor thumbnails via CDN sem expor vídeos.
- **Cons:** Duas variáveis de ambiente para buckets; bootstrap cria dois buckets (custo mínimo).

**Recommendation:** Option B (dois buckets) — a separação semântica entre vídeos (acesso controlado via presigned URL ou streaming pela API) e thumbnails (potencialmente públicos para listagens) justifica buckets distintos. O custo de configuração extra é mínimo e a separação de políticas é importante desde o início para evitar refatoração futura.

**Decision:** Option B (Dois buckets)

**Libraries:** —

---

## TD-06: Abordagem de streaming e download de vídeo

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** O endpoint de vídeo deve suportar dois modos: streaming progressivo (o player carrega partes conforme assiste) e download completo. A abordagem define como a API serve o conteúdo do MinIO para o cliente e como o worker deve preparar o arquivo para otimizar seeking.

**Options:**

### Option A: HTTP Range Requests via NestJS (206 Partial Content)
- O NestJS recebe a requisição de streaming/download, chama `getObject` no MinIO com os parâmetros de offset/length correspondentes ao header `Range` e faz pipe do resultado como resposta 206 Partial Content. O worker aplica `faststart` (FFmpeg `mov_flags +faststart`) durante o processamento para posicionar o moov atom no início do arquivo, otimizando seeking.
- **Pros:** Zero processamento adicional além do `faststart`; todos os browsers e players modernos suportam range requests nativamente; controle de acesso centralizado na API (autenticação/autorização antes de servir); implementação simples com pipe do stream; download via `Content-Disposition: attachment` é trivial na mesma infraestrutura.
- **Cons:** O NestJS fica no path de cada chunk de vídeo (consome banda do API server); múltiplos espectadores simultâneos aumentam a carga da API.

### Option B: Redirect para presigned URL do MinIO (302)
- O endpoint de streaming gera uma presigned URL do MinIO com TTL curto e retorna um redirect 302. O player busca o vídeo diretamente do MinIO (range requests vão direto para o MinIO, sem passar pela API).
- **Pros:** O NestJS sai do path de dados — toda a banda de vídeo vai direto do MinIO para o cliente; sem carga no API server durante streaming; mais eficiente para múltiplos espectadores simultâneos.
- **Cons:** A URL do MinIO fica exposta ao cliente (revela endpoint do storage interno); TTL precisa ser gerenciado cuidadosamente para evitar link sharing; controle de acesso pós-redirect é limitado (qualquer um com a URL pode acessar durante o TTL).

### Option C: HLS (HTTP Live Streaming com segmentação FFmpeg)
- O worker FFmpeg segmenta o vídeo em chunks `.ts` de 6-10 segundos e gera um manifesto `.m3u8`. O player (ex: `hls.js`) consome o manifesto e carrega segmentos sob demanda.
- **Pros:** Streaming adaptativo por qualidade (múltiplos bitrates); suporte nativo em Safari/iOS; latência menor em redes lentas.
- **Cons:** Requer múltiplos renditions e segmentação (mais tempo de processamento e espaço em storage); implementação significativamente mais complexa; `hls.js` no frontend está fora do escopo desta fase; para um MVP sem múltiplas qualidades o ganho é marginal.

**Recommendation:** Option A (HTTP Range Requests via NestJS) — range requests são suficientes para streaming funcional no escopo desta fase. O `faststart` resolve o seeking. O controle de acesso centralizado na API é preferível à exposição do endpoint do MinIO (Option B). Option C (HLS) é a evolução natural se múltiplas qualidades forem requisito em fase futura. O download é trivial sobre a mesma infraestrutura (`Content-Disposition: attachment`).

**Decision:** Option A (HTTP Range Requests via NestJS)

**Libraries:** —

---

## TD-07: Geração de identificador único de vídeo (slug)

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Cada vídeo precisa de uma URL curta e única (ex: `/watch/V1StGXR8_Z5`). O identificador é gerado no momento do pré-cadastro (rascunho), deve ser URL-safe e ter entropia suficiente para evitar colisão no volume esperado da plataforma. O slug também serve como chave de storage no MinIO (TD-05).

**Options:**

### Option A: nanoid (11 caracteres, URL-safe)
- Gera IDs curtos usando o alfabeto URL-safe (`A-Za-z0-9_-`). Com 11 caracteres e 64 símbolos, gera ~70 bits de entropia — probabilidade de colisão de 1 em 1 bilhão com até 2 milhões de vídeos. Problema conhecido com CommonJS: nanoid v3 é ESM-only; solução é fixar nanoid@3.x (CommonJS) ou usar wrapper assíncrono.
- **Pros:** URLs curtas e legíveis (estilo YouTube); criptograficamente seguro (usa `crypto`); pacote minúsculo; amplamente adotado para slugs de conteúdo.
- **Cons:** nanoid v4+ é ESM-only — projetos NestJS CommonJS precisam usar nanoid@3.x para evitar problema de `import()` dinâmico; nova dependência (pequena).

### Option B: UUID v4 (`crypto.randomUUID()`)
- Gera IDs de 36 caracteres. Disponível nativamente via `crypto.randomUUID()` no Node.js 19+ sem dependência extra.
- **Pros:** Zero dependência extra; 122 bits de entropia (virtualmente sem colisão); amplamente reconhecido.
- **Cons:** URLs longas (36 chars com hífens); hífens ocupam espaço sem adicionar entropia útil; menos amigável para URLs públicas de vídeo.

### Option C: CUID2
- IDs curtos e ordenados cronologicamente, projetados para uso em banco de dados. Comprimento configurável (24 chars padrão).
- **Pros:** Ordenável cronologicamente; baixíssima colisão; usa `crypto` nativamente.
- **Cons:** Dependência adicional; ordenabilidade não é um requisito para slugs de vídeo; 24 chars é maior que nanoid de 11.

**Recommendation:** Option A (nanoid@3.x, 11 chars) — equilibra URLs curtas (UX) com segurança suficiente para o volume esperado. Fixar na versão 3.x resolve o problema ESM/CommonJS sem wrappers. UUID v4 é aceitável se zero dependências for preferido; a URL mais longa é o único trade-off.

**Decision:** Option A (nanoid@3.x, 11 chars)

**Libraries:** `nanoid`

---

## TD-08: Ciclo de status do vídeo e política de falha no processamento

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** O vídeo passa por múltiplos estados desde o pré-cadastro até estar disponível para reprodução. A definição dos estados e da política de falha afeta o modelo de dados (enum `status` na tabela de vídeos), a lógica do worker (transições de estado) e a resposta da API quando o vídeo é acessado em estados intermediários. Depende de TD-01 (fila) pois o mecanismo de retry é fornecido pelo BullMQ.

**Options:**

### Option A: 4 estados simples — `draft | processing | ready | error`
- `draft` (pré-cadastrado, upload em progresso ou aguardando processamento), `processing` (worker consumiu o job e está processando), `ready` (processamento concluído com sucesso), `error` (falha irrecuperável após esgotar retries do BullMQ).
- **Pros:** Modelo simples — 4 estados mapeiam diretamente às etapas do workflow; sem distinção entre "upload em progresso" e "aguardando processamento" (aceitável para o escopo desta fase); BullMQ já faz retry automático antes de marcar como falha; fácil de exibir na UI (4 estados claros).
- **Cons:** Sem distinção entre upload em progresso e aguardando processamento (ambos são `draft`); sem estado `cancelled` para upload abortado; vídeos com status `error` permanecem no banco sem política de limpeza definida.

### Option B: 5 estados com `uploading` separado — `uploading | uploaded | processing | ready | error`
- `uploading` (criado, upload em progresso), `uploaded` (upload concluído, aguardando job de processamento), `processing` (worker consumiu e está processando), `ready` (pronto), `error` (falha).
- **Pros:** Distingue upload concluído de processamento iniciado — útil para diagnóstico e re-enfileiramento sem re-upload; `uploaded` permite retomar o job de processamento sem que o usuário refaça o upload.
- **Cons:** Um estado a mais no enum; a API precisa de lógica adicional para transição `uploading → uploaded` (webhook ou callback de conclusão); se o upload falhar, o vídeo fica `uploading` — requer cleanup job ou timeout.

**Recommendation:** Option A (4 estados) — para o escopo desta fase, `draft` cobre tanto upload em progresso quanto aguardando processamento, simplificando o modelo e o enum. O BullMQ já lida com retry antes de falhar; o estado `error` é suficiente para informar o usuário. Option B faz sentido combinado com retomada de upload (TD-02 Option C, tus) — que não é a recomendação atual para esta fase.

**Decision:** Option A (4 estados simples — `draft | processing | ready | error`)

**Libraries:** —

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Tecnologia de fila de mensagens | A (BullMQ + Redis) | Option A |
| TD-02 | Backend | Estratégia de upload de arquivos grandes | A (Multipart presigned URL) | Option A |
| TD-03 | Repo-wide | Localização e estrutura do worker de vídeo | A (NestJS standalone, container separado) | Option A |
| TD-04 | Backend | SDK de integração com MinIO | B (AWS SDK v3) | Option B |
| TD-05 | Backend | Organização de buckets e chaves no MinIO | B (Dois buckets) | Option B |
| TD-06 | Backend | Streaming e download de vídeo | A (HTTP Range Requests via NestJS) | Option A |
| TD-07 | Backend | Geração de slug único de vídeo | A (nanoid@3.x, 11 chars) | Option A |
| TD-08 | Backend | Ciclo de status do vídeo e política de falha | A (4 estados: draft → processing → ready \| error) | Option A |
