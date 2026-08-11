# SPECS.md — Especificación Técnica de "X" (clon de Twitter)

> Documento técnico de referencia para construir una plataforma de microblogging
> funcionalmente equivalente a Twitter/X.
>
> **Versión:** 1.0 · **Fecha:** 2026-08-11 · **Estado:** Borrador de arquitectura

---

## Índice

1. [Resumen y alcance](#1-resumen-y-alcance)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura general](#3-arquitectura-general)
4. [Modelo de datos](#4-modelo-de-datos)
5. [API](#5-api)
6. [Timeline: el problema central](#6-timeline-el-problema-central)
7. [Frontend](#7-frontend)
8. [Tiempo real](#8-tiempo-real)
9. [Multimedia](#9-multimedia)
10. [Búsqueda](#10-búsqueda)
11. [Autenticación y seguridad](#11-autenticación-y-seguridad)
12. [Moderación](#12-moderación)
13. [Notificaciones](#13-notificaciones)
14. [Rendimiento y escalabilidad](#14-rendimiento-y-escalabilidad)
15. [Observabilidad](#15-observabilidad)
16. [Infraestructura y despliegue](#16-infraestructura-y-despliegue)
17. [Testing](#17-testing)
18. [Estructura del repositorio](#18-estructura-del-repositorio)
19. [Roadmap por fases](#19-roadmap-por-fases)
20. [Anexo: decisiones y trade-offs](#20-anexo-decisiones-y-trade-offs)

---

## 1. Resumen y alcance

### 1.1 Descripción

Red social de microblogging: los usuarios publican mensajes cortos ("posts"),
siguen a otros usuarios, y consumen un timeline personalizado. Incluye
interacciones (like, repost, respuesta, cita), mensajería directa, notificaciones
en tiempo real, búsqueda y multimedia.

### 1.2 Alcance funcional (MVP → v1)

| Área | Funcionalidad | Fase |
|---|---|---|
| Cuentas | Registro, login, verificación email, recuperación de contraseña, 2FA | MVP |
| Perfil | Avatar, banner, bio, ubicación, web, fecha de alta, contadores | MVP |
| Posts | Crear (≤280 chars), borrar, responder, repost, cita, hilos | MVP |
| Interacción | Like, bookmark, compartir, ver métricas | MVP |
| Grafo social | Seguir/dejar de seguir, seguidores/siguiendo, bloquear, silenciar | MVP |
| Timeline | Cronológico (following) + algorítmico ("Para ti") | MVP / v1 |
| Multimedia | Imágenes (≤4), GIF, vídeo, alt-text | MVP |
| Búsqueda | Full-text de posts, usuarios, hashtags; filtros avanzados | v1 |
| Tendencias | Hashtags y temas en tendencia, con geolocalización | v1 |
| Notificaciones | In-app, push (web/móvil), email digest | MVP / v1 |
| Mensajes | DM 1:1 y grupos, indicadores de lectura y escritura | v1 |
| Listas | Listas públicas/privadas de usuarios | v1 |
| Moderación | Reportes, filtros automáticos, panel de administración | v1 |
| Cuentas privadas | Protección de posts, solicitudes de seguimiento | v1 |
| Espacios/Audio | Salas de audio en directo | v2 |
| Monetización | Suscripciones, verificación de pago, anuncios | v2 |

### 1.3 Fuera de alcance (explícito)

Anuncios programáticos, marketplace de API de pago, streaming de vídeo en directo,
y federación (ActivityPub) quedan fuera de v1.

### 1.4 Objetivos no funcionales

| Métrica | Objetivo |
|---|---|
| Latencia lectura timeline (p95) | < 200 ms |
| Latencia publicación de post (p95) | < 300 ms |
| Fan-out a seguidores (p99) | < 5 s |
| Disponibilidad | 99.9 % (≈43 min/mes) |
| Time-to-Interactive (TTI) web, 4G | < 2.5 s |
| Core Web Vitals | LCP < 2.5 s · INP < 200 ms · CLS < 0.1 |
| Escala de diseño | 10 M usuarios registrados, 1 M DAU, 5 k posts/s pico |

---

## 2. Stack tecnológico

### 2.1 Frontend

| Componente | Elección | Justificación |
|---|---|---|
| Framework | **Next.js 15** (App Router, React 19) | SSR/RSC para SEO de perfiles y posts públicos, streaming de UI |
| Lenguaje | **TypeScript 5.x** (`strict: true`) | Seguridad de tipos extremo a extremo |
| Estilos | **Tailwind CSS 4** + CSS variables | Velocidad de desarrollo, tematización clara/oscura |
| Componentes | **shadcn/ui** (Radix UI) | Accesibles (WAI-ARIA), sin lock-in, personalizables |
| Estado servidor | **TanStack Query v5** | Caché, invalidación, actualizaciones optimistas, paginación infinita |
| Estado cliente | **Zustand** | Estado UI ligero (modales, composer, tema) |
| Formularios | **React Hook Form + Zod** | Validación compartida con backend |
| Virtualización | **TanStack Virtual** | Timelines de miles de elementos sin degradar |
| Tiempo real | **WebSocket nativo** + reconexión exponencial | Notificaciones, DMs, contadores |
| Móvil | **React Native (Expo)** | Reutiliza tipos y lógica de dominio |

### 2.2 Backend

| Componente | Elección | Justificación |
|---|---|---|
| Runtime | **Node.js 22 LTS** (TypeScript) | Ecosistema, tipos compartidos con el frontend |
| Framework | **Fastify 5** | ~2× throughput vs Express, validación JSON Schema nativa |
| API | **REST + OpenAPI 3.1**, GraphQL opcional en BFF | Simplicidad, caché HTTP, tooling maduro |
| ORM | **Drizzle ORM** | SQL-first, tipado, migraciones versionadas, sin sobrecarga |
| Validación | **Zod** (compartido con frontend vía paquete común) | Una sola fuente de verdad para contratos |
| Auth | **JWT (ES256) + refresh rotativo**, OAuth 2.0 / OIDC | Stateless para lectura, revocable vía Redis |
| Jobs | **BullMQ** sobre Redis | Fan-out, emails, transcodificación, moderación |
| Tiempo real | **µWebSockets.js** o servicio Go dedicado | Cientos de miles de conexiones concurrentes |

> **Alternativa considerada:** Go (fan-out, WebSocket gateway) para servicios de
> alto throughput. Recomendado migrar el *fan-out service* y el *WS gateway* a Go
> a partir de ~100 k conexiones concurrentes.

### 2.3 Datos

| Sistema | Uso | Notas |
|---|---|---|
| **PostgreSQL 17** | Fuente de verdad: usuarios, posts, grafo social, DMs | Particionado por rango de fecha en `posts`; réplicas de lectura |
| **Redis 7** (Cluster) | Caché, timelines precomputados, rate limiting, sesiones, colas | Estructuras: `LIST`/`ZSET` para timelines, `HASH` para contadores |
| **OpenSearch 2.x** | Búsqueda full-text de posts y usuarios | Índices separados con analizadores por idioma |
| **ClickHouse** | Analítica: impresiones, eventos, métricas de posts | Ingesta vía Kafka; agregaciones materializadas |
| **S3 / R2** | Almacenamiento de objetos: imágenes, vídeos, avatares | R2 preferido por egreso gratuito |
| **Kafka** (o Redpanda) | Bus de eventos entre servicios | Topics: `post.created`, `follow.created`, `interaction.*` |

### 2.4 Infraestructura

| Componente | Elección |
|---|---|
| Contenedores | Docker + Kubernetes (EKS/GKE) o Fly.io en fases tempranas |
| CDN | Cloudflare (assets, imágenes, caché de perfiles públicos) |
| IaC | Terraform + Helm |
| CI/CD | GitHub Actions → build, test, escaneo, despliegue canario |
| Secretos | AWS Secrets Manager / Doppler |
| Observabilidad | OpenTelemetry → Grafana (Loki, Tempo, Mimir) + Sentry |

---

## 3. Arquitectura general

### 3.1 Vista de alto nivel

```
                         ┌──────────────┐
   Web (Next.js) ────┐   │  Cloudflare  │
   iOS / Android ────┼──▶│  CDN + WAF   │
   API pública   ────┘   └──────┬───────┘
                                │
                        ┌───────▼────────┐
                        │  API Gateway   │  rate limit · authN · routing
                        └───────┬────────┘
        ┌──────────────┬────────┼─────────┬──────────────┐
        ▼              ▼        ▼         ▼              ▼
   ┌─────────┐   ┌──────────┐ ┌──────┐ ┌────────┐  ┌──────────┐
   │  Auth   │   │  Posts   │ │Social│ │Timeline│  │  Search  │
   │ Service │   │ Service  │ │Graph │ │Service │  │ Service  │
   └────┬────┘   └────┬─────┘ └──┬───┘ └───┬────┘  └────┬─────┘
        │             │          │         │            │
        └─────────────┴────┬─────┴─────────┴────────────┘
                           ▼
              ┌────────────────────────────┐
              │  Kafka (bus de eventos)    │
              └─────┬──────────────┬───────┘
                    ▼              ▼
            ┌──────────────┐  ┌──────────────┐
            │  Fan-out     │  │ Notification │
            │  Workers     │  │   Workers    │
            └──────┬───────┘  └──────┬───────┘
                   ▼                 ▼
        ┌──────────────────┐  ┌─────────────┐
        │ Redis (timelines)│  │ WS Gateway  │──▶ clientes
        └──────────────────┘  └─────────────┘

   Persistencia: PostgreSQL (primaria + réplicas) · OpenSearch · S3 · ClickHouse
```

### 3.2 Servicios

| Servicio | Responsabilidad | Almacén principal |
|---|---|---|
| `auth` | Registro, login, tokens, 2FA, OAuth, sesiones | Postgres + Redis |
| `users` | Perfiles, configuración, verificación | Postgres |
| `posts` | CRUD de posts, hilos, citas, entidades (menciones/hashtags/URLs) | Postgres |
| `social-graph` | Follow, block, mute, listas | Postgres + Redis |
| `timeline` | Lectura de home/user timeline, mezcla de fuentes | Redis + Postgres |
| `fanout` | Distribución de posts a timelines de seguidores | Redis |
| `search` | Indexación y consulta | OpenSearch |
| `media` | Subida, validación, transcodificación, variantes | S3 + workers |
| `notifications` | Generación, agregación y entrega | Postgres + Redis |
| `messaging` | DMs, conversaciones, recibos de lectura | Postgres |
| `moderation` | Reportes, clasificación automática, acciones | Postgres |
| `ws-gateway` | Conexiones WebSocket, suscripciones por canal | Redis Pub/Sub |

### 3.3 Principios

- **Monolito modular primero.** Arrancar con un único despliegue de Fastify con
  módulos claramente delimitados y un esquema de base de datos por módulo.
  Extraer a servicios independientes solo cuando una métrica lo justifique
  (`fanout`, `ws-gateway` y `media` son los primeros candidatos).
- **Comunicación asíncrona por defecto.** Todo lo que no bloquee la respuesta al
  usuario va a Kafka/BullMQ.
- **Idempotencia obligatoria** en todos los consumidores de eventos (clave
  `event_id` deduplicada en Redis con TTL de 24 h).
- **Lectura optimizada sobre escritura.** Ratio real de la plataforma ≈ 100:1.

---

## 4. Modelo de datos

### 4.1 Convenciones

- IDs: **Snowflake de 64 bits** (`timestamp_ms << 22 | worker_id << 12 | seq`),
  ordenables temporalmente, expuestos como string en la API para evitar pérdida de
  precisión en JavaScript.
- Todas las tablas: `created_at timestamptz NOT NULL DEFAULT now()`.
- Borrados: **soft delete** (`deleted_at`) para posts y usuarios; purga física
  a los 30 días vía job.
- Timestamps siempre en UTC.

### 4.2 Esquema principal (PostgreSQL)

```sql
-- ─────────────────────────── Usuarios ───────────────────────────
CREATE TABLE users (
  id              BIGINT PRIMARY KEY,
  username        VARCHAR(15)  NOT NULL,
  username_lower  VARCHAR(15)  NOT NULL UNIQUE,   -- búsqueda case-insensitive
  email           CITEXT       NOT NULL UNIQUE,
  email_verified  BOOLEAN      NOT NULL DEFAULT false,
  password_hash   TEXT,                            -- NULL si sólo OAuth
  display_name    VARCHAR(50)  NOT NULL,
  bio             VARCHAR(160),
  location        VARCHAR(30),
  website_url     TEXT,
  avatar_url      TEXT,
  banner_url      TEXT,
  birth_date      DATE,
  is_protected    BOOLEAN      NOT NULL DEFAULT false,
  is_verified     BOOLEAN      NOT NULL DEFAULT false,
  is_suspended    BOOLEAN      NOT NULL DEFAULT false,
  lang            VARCHAR(8)   NOT NULL DEFAULT 'es',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT username_format CHECK (username ~ '^[A-Za-z0-9_]{1,15}$')
);

-- Contadores desnormalizados (tabla aparte para reducir contención de escritura)
CREATE TABLE user_counters (
  user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  followers_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  posts_count     INTEGER NOT NULL DEFAULT 0,
  likes_count     INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────── Posts ───────────────────────────
CREATE TYPE post_kind AS ENUM ('original', 'reply', 'repost', 'quote');

CREATE TABLE posts (
  id                BIGINT       NOT NULL,
  author_id         BIGINT       NOT NULL REFERENCES users(id),
  kind              post_kind    NOT NULL DEFAULT 'original',
  text              VARCHAR(280),
  lang              VARCHAR(8),
  -- Relaciones
  in_reply_to_id    BIGINT,        -- post al que responde
  conversation_id   BIGINT,        -- raíz del hilo (== id si es raíz)
  repost_of_id      BIGINT,        -- post reposteado
  quoted_post_id    BIGINT,        -- post citado
  -- Metadatos
  reply_policy      SMALLINT     NOT NULL DEFAULT 0, -- 0 todos, 1 seguidos, 2 mencionados
  is_sensitive      BOOLEAN      NOT NULL DEFAULT false,
  client_name       VARCHAR(50),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Particiones mensuales creadas automáticamente por pg_partman
CREATE TABLE posts_2026_08 PARTITION OF posts
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX idx_posts_author       ON posts (author_id, created_at DESC);
CREATE INDEX idx_posts_conversation ON posts (conversation_id, created_at)
  WHERE kind = 'reply';
CREATE INDEX idx_posts_quoted       ON posts (quoted_post_id) WHERE quoted_post_id IS NOT NULL;

CREATE TABLE post_counters (
  post_id        BIGINT PRIMARY KEY,
  likes_count    INTEGER NOT NULL DEFAULT 0,
  reposts_count  INTEGER NOT NULL DEFAULT 0,
  replies_count  INTEGER NOT NULL DEFAULT 0,
  quotes_count   INTEGER NOT NULL DEFAULT 0,
  bookmark_count INTEGER NOT NULL DEFAULT 0,
  views_count    BIGINT  NOT NULL DEFAULT 0   -- sincronizado desde ClickHouse
);

-- Entidades extraídas del texto en el momento de la escritura
CREATE TABLE post_entities (
  post_id     BIGINT      NOT NULL,
  kind        SMALLINT    NOT NULL,  -- 0 mención, 1 hashtag, 2 url, 3 cashtag
  value       TEXT        NOT NULL,  -- normalizado (lowercase para hashtags)
  start_index SMALLINT    NOT NULL,  -- offsets en code points UTF-8
  end_index   SMALLINT    NOT NULL,
  ref_id      BIGINT,                -- user_id si es mención
  PRIMARY KEY (post_id, start_index)
);
CREATE INDEX idx_entities_value ON post_entities (kind, value, post_id DESC);

-- ─────────────────────────── Multimedia ───────────────────────────
CREATE TYPE media_kind AS ENUM ('image', 'gif', 'video');

CREATE TABLE media (
  id            BIGINT PRIMARY KEY,
  owner_id      BIGINT NOT NULL REFERENCES users(id),
  post_id       BIGINT,              -- NULL hasta que se adjunta
  kind          media_kind NOT NULL,
  storage_key   TEXT   NOT NULL,     -- clave en S3
  mime_type     TEXT   NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,             -- vídeo/GIF
  size_bytes    BIGINT NOT NULL,
  blurhash      TEXT,                -- placeholder durante la carga
  alt_text      VARCHAR(1000),
  variants      JSONB  NOT NULL DEFAULT '[]',  -- [{w,h,url,format,bitrate}]
  status        SMALLINT NOT NULL DEFAULT 0,   -- 0 pendiente, 1 listo, 2 fallido
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_post ON media (post_id) WHERE post_id IS NOT NULL;

-- ─────────────────────────── Grafo social ───────────────────────────
CREATE TABLE follows (
  follower_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT no_self_follow CHECK (follower_id <> followee_id)
);
-- Índice inverso: "¿quién me sigue?" y fan-out
CREATE INDEX idx_follows_followee ON follows (followee_id, created_at DESC);

CREATE TABLE follow_requests (   -- cuentas protegidas
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id)
);

CREATE TABLE blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE mutes (
  muter_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (muter_id, muted_id)
);

CREATE TABLE muted_keywords (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyword    VARCHAR(100) NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, keyword)
);

-- ─────────────────────────── Interacciones ───────────────────────────
CREATE TABLE likes (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX idx_likes_post ON likes (post_id, created_at DESC);

CREATE TABLE bookmarks (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- ─────────────────────────── Listas ───────────────────────────
CREATE TABLE lists (
  id          BIGINT PRIMARY KEY,
  owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(25) NOT NULL,
  description VARCHAR(100),
  is_private  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE list_members (
  list_id BIGINT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, user_id)
);

-- ─────────────────────────── Mensajes directos ───────────────────────────
CREATE TABLE conversations (
  id           BIGINT PRIMARY KEY,
  is_group     BOOLEAN NOT NULL DEFAULT false,
  name         VARCHAR(50),
  created_by   BIGINT NOT NULL REFERENCES users(id),
  last_message_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id    BIGINT,          -- último mensaje leído
  muted           BOOLEAN NOT NULL DEFAULT false,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id              BIGINT PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT NOT NULL REFERENCES users(id),
  text            VARCHAR(10000),
  media_id        BIGINT,
  shared_post_id  BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_messages_conv ON messages (conversation_id, id DESC);

-- ─────────────────────────── Notificaciones ───────────────────────────
CREATE TYPE notification_kind AS ENUM
  ('like','repost','reply','quote','follow','mention','follow_request','system');

CREATE TABLE notifications (
  id           BIGINT PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         notification_kind NOT NULL,
  actor_id     BIGINT REFERENCES users(id),
  post_id      BIGINT,
  group_key    TEXT,        -- agrupa "A y 12 más dieron me gusta a tu post"
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, id DESC);

-- ─────────────────────────── Moderación ───────────────────────────
CREATE TABLE reports (
  id          BIGINT PRIMARY KEY,
  reporter_id BIGINT NOT NULL REFERENCES users(id),
  target_kind SMALLINT NOT NULL,  -- 0 post, 1 usuario, 2 mensaje
  target_id   BIGINT   NOT NULL,
  reason      SMALLINT NOT NULL,
  details     VARCHAR(1000),
  status      SMALLINT NOT NULL DEFAULT 0, -- 0 abierto, 1 revisado, 2 accionado, 3 descartado
  reviewed_by BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moderation_actions (
  id          BIGINT PRIMARY KEY,
  moderator_id BIGINT REFERENCES users(id),   -- NULL si automática
  target_kind SMALLINT NOT NULL,
  target_id   BIGINT NOT NULL,
  action      SMALLINT NOT NULL,  -- 0 aviso, 1 ocultar, 2 borrar, 3 suspender, 4 banear
  reason      TEXT,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.3 Reglas de integridad

- `conversation_id` de un post raíz es igual a su propio `id`.
- Un repost (`kind = 'repost'`) tiene `text IS NULL` y `repost_of_id NOT NULL`.
- Una cita tiene `text NOT NULL` y `quoted_post_id NOT NULL`.
- Un usuario no puede seguir, ni ver posts de, un usuario que le ha bloqueado —
  aplicado a nivel de servicio, no de base de datos (rendimiento).
- Máximo 4 elementos en `media` por post; un vídeo o un GIF excluyen otros medios.

### 4.4 Estrategia de contadores

Los contadores (`likes_count`, etc.) se actualizan en dos niveles:

1. **Redis (autoritativo para lectura):** `HINCRBY post:{id}:counters likes 1`.
   Respuesta inmediata al usuario.
2. **PostgreSQL (autoritativo para persistencia):** un worker consume el evento y
   aplica el incremento en lote cada 5 s (agrupando por `post_id`), evitando
   contención de fila en posts virales.
3. **Reconciliación:** job nocturno que recalcula desde las tablas fuente los
   posts con actividad en las últimas 24 h.

---

## 5. API

### 5.1 Convenciones

- Base: `https://api.example.com/v1`
- Contenido: `application/json; charset=utf-8`
- Autenticación: `Authorization: Bearer <access_token>`
- IDs numéricos siempre serializados como **string**.
- Fechas en **ISO 8601 UTC** (`2026-08-11T14:32:00Z`).
- Idempotencia en escrituras: cabecera `Idempotency-Key: <uuid>` (retenida 24 h).
- Versionado por path (`/v1`). Cambios incompatibles → `/v2` con 6 meses de solape.

### 5.2 Paginación por cursor

Nunca `OFFSET`. Cursor opaco (base64 del Snowflake ID + dirección):

```http
GET /v1/timeline/home?limit=20&cursor=eyJpZCI6IjE4MjM0NSIsImRpciI6ImIifQ
```

```json
{
  "data": [ /* … */ ],
  "meta": {
    "next_cursor": "eyJpZCI6IjE4MjMyMCIsImRpciI6ImIifQ",
    "prev_cursor": "eyJpZCI6IjE4MjM3MCIsImRpciI6ImYifQ",
    "has_more": true
  }
}
```

### 5.3 Formato de error

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Has superado el límite de publicaciones.",
    "details": { "retry_after": 300 },
    "request_id": "01J8XQ2K9M3NPT4V6WZ"
  }
}
```

| Código HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Payload inválido (incluye `details.fields`) |
| 401 | `UNAUTHENTICATED` | Token ausente, inválido o expirado |
| 403 | `FORBIDDEN` / `BLOCKED_BY_USER` | Sin permiso sobre el recurso |
| 404 | `NOT_FOUND` | Recurso inexistente o borrado |
| 409 | `CONFLICT` | Estado duplicado (p. ej. ya sigues al usuario) |
| 422 | `UNPROCESSABLE` | Semánticamente inválido (respuesta a post borrado) |
| 429 | `RATE_LIMIT_EXCEEDED` | Ver cabeceras `X-RateLimit-*` |
| 500 | `INTERNAL_ERROR` | Fallo del servidor (siempre con `request_id`) |
| 503 | `SERVICE_UNAVAILABLE` | Degradación controlada |

### 5.4 Endpoints

#### Autenticación

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/auth/register` | Crea cuenta; envía email de verificación |
| `POST` | `/auth/login` | Devuelve `access_token` (15 min) + `refresh_token` (cookie httpOnly, 30 d) |
| `POST` | `/auth/refresh` | Rota el refresh token, emite nuevo access token |
| `POST` | `/auth/logout` | Revoca el refresh token actual |
| `POST` | `/auth/logout-all` | Revoca todas las sesiones |
| `POST` | `/auth/verify-email` | Confirma el email con token de un solo uso |
| `POST` | `/auth/password/forgot` | Envía enlace de restablecimiento |
| `POST` | `/auth/password/reset` | Cambia la contraseña con el token |
| `POST` | `/auth/2fa/setup` | Genera secreto TOTP + QR |
| `POST` | `/auth/2fa/verify` | Activa 2FA y devuelve códigos de recuperación |
| `GET` | `/auth/oauth/:provider` | Inicia OAuth (Google, Apple, GitHub) |
| `GET` | `/auth/oauth/:provider/callback` | Callback OAuth |
| `GET` | `/auth/sessions` | Lista sesiones activas (dispositivo, IP, última actividad) |

#### Usuarios

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/users/me` | Perfil propio (incluye ajustes privados) |
| `PATCH` | `/users/me` | Actualiza perfil |
| `GET` | `/users/:username` | Perfil público |
| `GET` | `/users/:username/posts` | Posts y reposts del usuario |
| `GET` | `/users/:username/replies` | Posts + respuestas |
| `GET` | `/users/:username/media` | Solo posts con multimedia |
| `GET` | `/users/:username/likes` | Posts que le gustan (si es público) |
| `GET` | `/users/:username/followers` | Seguidores (paginado) |
| `GET` | `/users/:username/following` | Siguiendo (paginado) |
| `POST` | `/users/:id/follow` | Seguir (o crear solicitud si es protegida) |
| `DELETE` | `/users/:id/follow` | Dejar de seguir |
| `POST` | `/users/:id/block` · `DELETE` | Bloquear / desbloquear |
| `POST` | `/users/:id/mute` · `DELETE` | Silenciar / dejar de silenciar |
| `GET` | `/users/me/follow-requests` | Solicitudes pendientes |
| `POST` | `/users/me/follow-requests/:id/accept` | Aceptar solicitud |
| `GET` | `/users/suggestions` | A quién seguir |

#### Posts

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/posts` | Crear post (original, respuesta, cita) |
| `GET` | `/posts/:id` | Detalle del post |
| `DELETE` | `/posts/:id` | Borrar (soft delete) |
| `GET` | `/posts/:id/thread` | Conversación completa (ancestros + descendientes) |
| `GET` | `/posts/:id/replies` | Respuestas directas, ordenadas por relevancia |
| `GET` | `/posts/:id/likes` | Usuarios que dieron like |
| `GET` | `/posts/:id/reposts` | Usuarios que repostearon |
| `GET` | `/posts/:id/quotes` | Citas del post |
| `POST` | `/posts/:id/like` · `DELETE` | Like / unlike |
| `POST` | `/posts/:id/repost` · `DELETE` | Repost / deshacer |
| `POST` | `/posts/:id/bookmark` · `DELETE` | Guardar / quitar |
| `POST` | `/posts/:id/pin` · `DELETE` | Fijar en el perfil |
| `POST` | `/posts/batch` | Hilo completo en una transacción |

**Ejemplo — crear post:**

```http
POST /v1/posts
Authorization: Bearer eyJ…
Idempotency-Key: 8f14e45f-ea5d-4b3a-9f2e-1c7d8b0a3e11
Content-Type: application/json

{
  "text": "Hola mundo desde la nueva API 👋 #dev",
  "media_ids": ["1823456789012345678"],
  "in_reply_to_id": null,
  "quoted_post_id": null,
  "reply_policy": "everyone",
  "is_sensitive": false
}
```

```json
{
  "data": {
    "id": "1823456789012349999",
    "text": "Hola mundo desde la nueva API 👋 #dev",
    "created_at": "2026-08-11T14:32:00Z",
    "author": {
      "id": "1000000000000000001",
      "username": "ana",
      "display_name": "Ana",
      "avatar_url": "https://cdn.example.com/a/1000_normal.webp",
      "is_verified": true
    },
    "entities": {
      "hashtags": [{ "text": "dev", "start": 33, "end": 37 }],
      "mentions": [],
      "urls": []
    },
    "media": [{
      "id": "1823456789012345678",
      "kind": "image",
      "url": "https://cdn.example.com/m/1823_large.webp",
      "width": 1200, "height": 800,
      "blurhash": "LEHV6nWB2yk8pyo0adR*",
      "alt_text": "Captura de la terminal"
    }],
    "counters": { "likes": 0, "reposts": 0, "replies": 0, "quotes": 0, "views": 0 },
    "viewer": { "liked": false, "reposted": false, "bookmarked": false }
  }
}
```

#### Timelines

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/timeline/home` | "Siguiendo" — cronológico inverso |
| `GET` | `/timeline/for-you` | Algorítmico |
| `GET` | `/timeline/list/:id` | Timeline de una lista |
| `GET` | `/timeline/bookmarks` | Guardados |

#### Búsqueda y tendencias

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/search?q=&type=top\|latest\|people\|media` | Búsqueda unificada |
| `GET` | `/search/typeahead?q=` | Autocompletado de usuarios/hashtags |
| `GET` | `/trends?woeid=` | Tendencias por región |

#### Multimedia

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/media/upload-url` | Devuelve URL prefirmada de S3 + `media_id` |
| `POST` | `/media/:id/finalize` | Confirma subida, dispara procesamiento |
| `GET` | `/media/:id` | Estado y variantes |
| `PATCH` | `/media/:id` | Actualiza `alt_text` |

#### Notificaciones y mensajes

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/notifications?filter=all\|mentions` | Lista agrupada |
| `POST` | `/notifications/read` | Marca hasta un cursor como leídas |
| `GET` | `/notifications/unread-count` | Contador (cacheado en Redis) |
| `GET` | `/conversations` | Lista de conversaciones |
| `POST` | `/conversations` | Crear (1:1 o grupo) |
| `GET` | `/conversations/:id/messages` | Historial paginado |
| `POST` | `/conversations/:id/messages` | Enviar |
| `POST` | `/conversations/:id/read` | Recibo de lectura |

### 5.5 Rate limiting

Algoritmo: **token bucket** en Redis (script Lua atómico), por `user_id` y por IP.

| Recurso | Límite | Ventana |
|---|---|---|
| `POST /posts` | 300 | 3 h |
| `POST /posts/:id/like` | 1000 | 24 h |
| `POST /users/:id/follow` | 400 | 24 h |
| `POST /conversations/*/messages` | 500 | 24 h |
| Lecturas autenticadas | 900 | 15 min |
| Lecturas anónimas (por IP) | 100 | 15 min |
| `POST /auth/login` | 10 | 15 min por IP + backoff exponencial por cuenta |

Cabeceras de respuesta: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset`, y `Retry-After` en 429.

---

## 6. Timeline: el problema central

Es la decisión de arquitectura más determinante del sistema.

### 6.1 Estrategia híbrida (fan-out on write + on read)

**Escritura (fan-out on write) — usuarios normales (<10 000 seguidores):**

1. El post se persiste en PostgreSQL.
2. Se publica el evento `post.created` en Kafka.
3. Los workers de fan-out leen la lista de seguidores y hacen push del `post_id`
   en el timeline Redis de cada uno:
   ```
   ZADD timeline:{user_id} {snowflake_id} {post_id}
   ZREMRANGEBYRANK timeline:{user_id} 0 -801   # se retienen 800 entradas
   EXPIRE timeline:{user_id} 604800            # 7 días de inactividad
   ```
4. Se procesa en lotes de 1000 seguidores por pipeline de Redis.

**Lectura (fan-out on read) — cuentas grandes (≥10 000 seguidores):**

Las cuentas marcadas como "celebridad" **no** hacen fan-out. Al leer el timeline:

1. Se obtiene el timeline precomputado de Redis (`ZREVRANGEBYSCORE`).
2. En paralelo, se consultan los últimos posts de las cuentas grandes que el
   usuario sigue (lista cacheada en Redis, típicamente < 50 cuentas).
3. Se hace **merge ordenado por Snowflake ID**, se aplican filtros (bloqueos,
   silencios, palabras silenciadas) y se hidratan los posts en un solo
   `WHERE id = ANY($1)`.

```
timeline_final = merge_by_id(
    redis_zrange(timeline:{uid}, cursor, 20),
    fetch_recent_from_celebrities(uid, cursor, 20)
)[:20]
```

**Timelines fríos:** si `timeline:{uid}` no existe (usuario inactivo > 7 días),
se reconstruye desde PostgreSQL de forma perezosa:

```sql
SELECT p.id FROM posts p
JOIN follows f ON f.followee_id = p.author_id
WHERE f.follower_id = $1 AND p.created_at > now() - interval '7 days'
  AND p.deleted_at IS NULL
ORDER BY p.id DESC LIMIT 800;
```

### 6.2 Timeline algorítmico ("Para ti")

Pipeline de tres etapas:

**1. Candidate generation** (~1500 candidatos, presupuesto 50 ms)

| Fuente | Peso | Descripción |
|---|---|---|
| In-network | 50 % | Posts de cuentas seguidas (últimas 48 h) |
| Out-of-network — grafo | 25 % | Posts con engagement de tus seguidos (2.º grado) |
| Out-of-network — embeddings | 15 % | Vecinos en espacio vectorial de intereses (pgvector / Qdrant) |
| Tendencias / temas | 10 % | Posts populares en tus temas y región |

**2. Ranking** (modelo ligero, presupuesto 30 ms)

Modelo GBDT (LightGBM) o red neuronal pequeña, servido vía ONNX Runtime,
que predice `P(engagement)` con features:

- *Del post:* antigüedad (decaimiento exponencial, vida media 6 h), ratio de
  engagement, tiene multimedia, longitud, idioma, es respuesta.
- *Del autor:* reputación, ratio seguidores/seguidos, tasa histórica de engagement.
- *De la relación:* ¿le sigues?, interacciones previas con el autor, afinidad
  del grafo, solapamiento de intereses.
- *Del espectador:* hora del día, dispositivo, sesión actual.

**3. Heurísticas y filtros** (presupuesto 10 ms)

- Diversidad de autores: máximo 2 posts consecutivos del mismo autor.
- Deduplicación de contenido (SimHash del texto).
- Deduplicación de vistas: se descartan posts ya impresos (Bloom filter por
  usuario en Redis, 10 000 entradas, FP < 1 %).
- Filtros de seguridad: NSFW no marcado, spam, cuentas suspendidas.
- Inyección de contenido social ("A a quien sigues le gustó esto"), máx. 15 %.

**Degradación:** si el servicio de ranking supera 100 ms o falla, se sirve el
timeline cronológico. El fallback es siempre correcto, nunca un error.

### 6.3 Coste estimado de Redis

- 800 posts × 8 bytes (ID) × ~1.5 (overhead ZSET) ≈ **10 KB/usuario activo**.
- 1 M DAU ≈ **10 GB**, más contadores y caché de hidratación ≈ **30–40 GB**.
- Cluster de 3 shards × 32 GB con réplica.

---

## 7. Frontend

### 7.1 Estructura de rutas (Next.js App Router)

```
app/
├── (marketing)/
│   ├── page.tsx                    # landing para anónimos
│   └── login/ · signup/
├── (app)/
│   ├── layout.tsx                  # shell: sidebar + columna derecha
│   ├── home/page.tsx               # timelines (tabs: Siguiendo / Para ti)
│   ├── explore/page.tsx            # tendencias
│   ├── search/page.tsx
│   ├── notifications/page.tsx
│   ├── messages/
│   │   ├── page.tsx
│   │   └── [conversationId]/page.tsx
│   ├── bookmarks/page.tsx
│   ├── lists/[id]/page.tsx
│   ├── settings/[...section]/page.tsx
│   └── [username]/
│       ├── page.tsx                # perfil (RSC, SSR para SEO)
│       ├── with_replies/page.tsx
│       ├── media/ · likes/
│       └── status/[postId]/page.tsx  # detalle del post (SSR + JSON-LD)
├── api/                            # BFF: sólo proxy y auth de cookies
└── globals.css
```

### 7.2 Componentes clave

| Componente | Responsabilidad | Notas técnicas |
|---|---|---|
| `<Composer>` | Redacción, contador, adjuntos, hilos | Contador con `Intl.Segmenter` (grafemas, no `length`); URLs cuentan como 23 |
| `<PostCard>` | Renderizado de un post | `React.memo`, altura estable para evitar CLS |
| `<Timeline>` | Lista virtualizada infinita | `useInfiniteQuery` + `useVirtualizer`, `overscan: 5` |
| `<ThreadView>` | Conversación con líneas de conexión | Ancestros SSR, descendientes en cliente |
| `<MediaGrid>` | 1–4 imágenes con layouts distintos | `aspect-ratio` CSS + blurhash como placeholder |
| `<RichText>` | Enlaza menciones, hashtags, URLs | Parseo por offsets de `entities`, **nunca** `dangerouslySetInnerHTML` |
| `<NotificationBell>` | Contador en vivo | Suscripción WS + fallback a polling 60 s |

### 7.3 Actualizaciones optimistas

Likes, reposts y bookmarks se aplican en la caché antes de la respuesta:

```ts
const useLike = (postId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/posts/${postId}/like`),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['post', postId] });
      const prev = qc.getQueryData(['post', postId]);
      qc.setQueryData(['post', postId], (p: Post) => ({
        ...p,
        viewer:   { ...p.viewer,   liked: true },
        counters: { ...p.counters, likes: p.counters.likes + 1 },
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(['post', postId], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['post', postId] }),
  });
};
```

### 7.4 Rendimiento

- **Presupuesto de bundle:** < 180 KB gzip en la ruta inicial.
- Server Components por defecto; `'use client'` sólo en hojas interactivas.
- `next/image` con AVIF/WebP, `sizes` explícito y `priority` sólo en LCP.
- Fuentes vía `next/font` (self-hosted, `display: swap`, subset latino).
- Prefetch de rutas en hover con `<Link prefetch>`.
- Code splitting: composer, reproductor de vídeo y emoji picker en `dynamic()`.
- Service Worker: caché de shell y assets; cola offline de posts pendientes.

### 7.5 Accesibilidad (WCAG 2.2 AA)

- Navegación completa por teclado (`j`/`k` navegar, `l` like, `r` responder,
  `t` repostear, `n` nuevo post, `/` buscar, `?` ayuda).
- Roles ARIA: timeline como `feed` con `aria-posinset`/`aria-setsize`.
- `aria-live="polite"` para nuevos posts y notificaciones.
- Contraste mínimo 4.5:1 en ambos temas; foco visible siempre.
- Alt-text obligatorio-por-defecto configurable; recordatorio al publicar.
- `prefers-reduced-motion` respetado (GIFs no auto-reproducen).

### 7.6 Internacionalización

`next-intl`, catálogos ICU MessageFormat, soporte RTL (`dir="rtl"` para árabe y
hebreo) con propiedades lógicas de CSS (`margin-inline-start`). Fechas relativas
con `Intl.RelativeTimeFormat`. Números con `Intl.NumberFormat` (`notation: 'compact'`).

---

## 8. Tiempo real

### 8.1 Protocolo

WebSocket con autenticación mediante ticket de un solo uso (el JWT nunca viaja en
la query string):

```
1. POST /v1/realtime/ticket  →  { "ticket": "…", "expires_in": 60 }
2. wss://ws.example.com/v1?ticket=…
3. Cliente envía: { "op": "subscribe", "channels": ["user:123", "conv:456"] }
```

### 8.2 Canales

| Canal | Eventos |
|---|---|
| `user:{id}` | `notification.new`, `follow.new`, `dm.unread` |
| `conv:{id}` | `message.new`, `message.read`, `typing.start` |
| `post:{id}` | `counter.update` (sólo si el post está en pantalla) |
| `timeline:{id}` | `post.available` (badge de "N posts nuevos") |

### 8.3 Mecánica

- **Heartbeat:** ping cada 30 s; el servidor cierra a los 60 s sin pong.
- **Reconexión:** backoff exponencial con jitter (1 s → 30 s máx.).
- **Recuperación:** al reconectar, el cliente envía `last_event_id`; el servidor
  reenvía lo perdido desde un buffer Redis Stream (retención 5 min).
- **Fan-out interno:** Redis Pub/Sub entre instancias del gateway; cada instancia
  mantiene un mapa `channel → Set<connection>`.
- **Backpressure:** si la cola de escritura de un socket supera 1 MB, se cierra la
  conexión y el cliente reconecta con estado fresco.
- **Fallback:** SSE en redes que bloquean WebSocket; polling adaptativo (30–120 s)
  como último recurso.

---

## 9. Multimedia

### 9.1 Flujo de subida

```
Cliente                    API                     S3              Workers
   │                        │                       │                  │
   ├─ POST /media/upload-url┤                       │                  │
   │◀── {media_id, url, fields} ──                  │                  │
   ├─────── PUT (directo, presigned) ──────────────▶│                  │
   ├─ POST /media/:id/finalize ─▶ valida ──────────▶│                  │
   │                        └─ encola job ──────────┼─────────────────▶│
   │◀── { status: "processing" }                    │      transcodifica
   │                                                 │◀── variantes ────┤
   │◀── WS media.ready ──────────────────────────────┴──────────────────┘
```

### 9.2 Restricciones y procesamiento

| Tipo | Límite | Formatos entrada | Salida |
|---|---|---|---|
| Imagen | 5 MB, 8192×8192 | JPEG, PNG, WebP, AVIF, HEIC | WebP + AVIF en 4 anchos (small 340, medium 600, large 1200, orig) |
| GIF | 15 MB | GIF | MP4 (H.264) con loop, + poster WebP |
| Vídeo | 512 MB, 140 s (2 h para verificados) | MP4, MOV, WebM | HLS multi-bitrate (240p/360p/480p/720p/1080p), H.264 + AAC |

**Pipeline:**

1. **Validación:** magic bytes (no confiar en `Content-Type`), dimensiones,
   duración, bomba de descompresión.
2. **Sanitización:** eliminación completa de EXIF (incluida geolocalización);
   sólo se conserva la orientación, aplicada al píxel.
3. **Escaneo:** ClamAV + hash contra base de contenido conocido (PhotoDNA/CSAM).
4. **Transcodificación:** `sharp` (imagen) y `ffmpeg` (vídeo) en workers aislados
   con límites de CPU/memoria y timeout de 10 min.
5. **Blurhash** generado para placeholder progresivo.
6. **Publicación:** subida de variantes a S3, `status = 1`, evento `media.ready`.

**Entrega:** CDN con `Cache-Control: public, max-age=31536000, immutable` (las
URLs incluyen hash de contenido). Negociación de formato por `Accept`.

---

## 10. Búsqueda

### 10.1 Índices OpenSearch

```json
// índice: posts
{
  "settings": { "number_of_shards": 6, "number_of_replicas": 1 },
  "mappings": {
    "properties": {
      "id":            { "type": "keyword" },
      "author_id":     { "type": "keyword" },
      "author_handle": { "type": "keyword" },
      "text":          { "type": "text", "analyzer": "multilang",
                         "fields": { "exact": { "type": "keyword", "ignore_above": 300 } } },
      "hashtags":      { "type": "keyword" },
      "mentions":      { "type": "keyword" },
      "lang":          { "type": "keyword" },
      "has_media":     { "type": "boolean" },
      "is_sensitive":  { "type": "boolean" },
      "engagement":    { "type": "float" },
      "created_at":    { "type": "date" }
    }
  }
}
```

Índice `users`: `username` y `display_name` con `edge_ngram` (2–15) para
typeahead, más `followers_count` como señal de ranking.

### 10.2 Indexación

Change Data Capture desde PostgreSQL vía **Debezium → Kafka → indexer**, con
`bulk` cada 500 documentos o 1 s (lo que ocurra antes). Latencia objetivo: < 3 s
desde la publicación. Reindexado completo mediante alias con blue-green.

### 10.3 Consultas

- **Latest:** filtro + orden por `created_at desc`.
- **Top:** `function_score` combinando relevancia BM25, `engagement`, decaimiento
  temporal (`gauss` sobre `created_at`, escala 7 d) y afinidad social.
- **Operadores soportados:** `from:usuario`, `to:usuario`, `#hashtag`, `@mención`,
  `"frase exacta"`, `-excluir`, `filter:media`, `filter:links`, `min_faves:N`,
  `since:YYYY-MM-DD`, `until:YYYY-MM-DD`, `lang:es`.

### 10.4 Tendencias

Job cada 5 minutos sobre ClickHouse: cuenta apariciones de hashtags y n-gramas en
ventanas de 1 h, y las compara con la línea base de 7 días.

```
score = (count_1h / max(baseline_hourly, 1)) · log(1 + unique_authors)
```

Filtros: mínimo 50 autores únicos, exclusión de spam (ratio autores/posts < 0.3),
lista negra, y segmentación por región (WOEID) e idioma.

---

## 11. Autenticación y seguridad

### 11.1 Tokens

| Token | Formato | TTL | Almacenamiento |
|---|---|---|---|
| Access | JWT ES256 (`sub`, `sid`, `iat`, `exp`, `scope`) | 15 min | Memoria del cliente |
| Refresh | Opaco (32 bytes aleatorios, hash SHA-256 en BD) | 30 d | Cookie `httpOnly; Secure; SameSite=Lax` |

- **Rotación:** cada `refresh` emite un token nuevo e invalida el anterior.
- **Detección de reuso:** si llega un refresh ya usado, se revoca toda la familia
  de tokens de esa sesión y se notifica al usuario (indicio de robo).
- **Revocación de access tokens:** lista de `sid` revocados en Redis, consultada
  por el gateway (TTL igual al del access token, coste O(1)).

### 11.2 Contraseñas

- **Argon2id** (`m=64 MiB, t=3, p=4`).
- Mínimo 10 caracteres; comprobación contra HIBP mediante *k-anonymity*
  (prefijo SHA-1 de 5 caracteres, nunca se envía la contraseña).
- Rehash automático al iniciar sesión si cambian los parámetros.

### 11.3 Controles de aplicación

| Amenaza | Mitigación |
|---|---|
| XSS | React escapa por defecto; CSP estricta con nonce; prohibido `dangerouslySetInnerHTML`; sanitización de URLs (`javascript:` bloqueado) |
| CSRF | `SameSite=Lax` + token double-submit en mutaciones desde cookie |
| SQL Injection | Consultas parametrizadas vía Drizzle; prohibido SQL concatenado |
| SSRF | Fetch de metadatos de URL (previews) sólo a través de proxy con allowlist DNS y bloqueo de rangos privados |
| IDOR | Autorización a nivel de recurso en cada handler; nunca confiar en el ID del path |
| Enumeración de cuentas | Respuestas indistinguibles en login/registro/recuperación |
| Fuerza bruta | Rate limit por IP + backoff por cuenta + CAPTCHA (Turnstile) tras 3 fallos |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| Fuga de datos | PII cifrada en reposo, logs con redacción automática de tokens/emails |

**Cabeceras obligatorias:**

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{random}';
  img-src 'self' https://cdn.example.com data: blob:; connect-src 'self' wss://ws.example.com;
  frame-ancestors 'none'; base-uri 'self'; object-src 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

### 11.4 Privacidad y cumplimiento

- **GDPR/CCPA:** exportación de datos (`GET /users/me/export`, ZIP generado
  asíncronamente), borrado de cuenta con periodo de gracia de 30 días,
  registro de consentimiento.
- **Retención:** logs de acceso 90 días, IPs de sesión 12 meses, contenido borrado
  purgado a los 30 días.
- **Menores:** verificación de edad en el registro (13+); cuentas de menores con
  DMs restringidos por defecto.
- **Auditoría:** log inmutable de acciones administrativas y de moderación.

---

## 12. Moderación

### 12.1 Capas

1. **Preventiva (síncrona, < 100 ms):** al publicar se ejecutan filtros baratos —
   listas de bloqueo, detección de URLs maliciosas (Safe Browsing), límites de
   menciones (máx. 10) y de hashtags (máx. 5).
2. **Automática (asíncrona):** clasificadores de toxicidad, spam y NSFW sobre
   texto e imagen. Umbrales:
   - `score > 0.95` → acción automática (ocultar + notificar al autor).
   - `0.70 – 0.95` → cola de revisión humana priorizada.
   - `< 0.70` → sin acción, sólo registro.
3. **Reactiva:** reportes de usuarios, priorizados por reputación del reportante,
   alcance del contenido y gravedad de la categoría.

### 12.2 Acciones graduadas

| Acción | Efecto | Apelable |
|---|---|---|
| Etiqueta | Aviso de contenido sensible / contexto añadido | Sí |
| Reducción de alcance | Excluido de búsqueda, tendencias y "Para ti" | Sí |
| Ocultación | Visible sólo para el autor y sus seguidores | Sí |
| Eliminación | Post borrado | Sí |
| Modo lectura | Cuenta no puede publicar (12 h – 7 d) | Sí |
| Suspensión | Cuenta inaccesible | Sí |
| Baneo permanente | Cuenta cerrada; hash de dispositivo/email bloqueado | Sí, una vez |

Toda acción genera una entrada en `moderation_actions` con motivo, política
aplicada y actor. El usuario recibe notificación con el fragmento infractor y un
enlace para apelar.

### 12.3 Antispam

- Score de confianza por cuenta: antigüedad, verificación de email/teléfono,
  ratio seguidores/seguidos, tasa de reportes, patrones de comportamiento.
- Cuentas nuevas: límites reducidos (10 posts/día, sin enlaces las primeras 24 h).
- Detección de coordinación: clustering de cuentas por similitud de contenido
  (SimHash), timing y huella de red.

---

## 13. Notificaciones

### 13.1 Generación y agrupación

Los eventos de Kafka (`interaction.like`, `follow.created`, etc.) alimentan al
worker de notificaciones, que:

1. Comprueba preferencias del receptor y relaciones (bloqueo/silencio).
2. Calcula `group_key` (p. ej. `like:{post_id}`) y agrupa dentro de una ventana
   de 1 hora → "Ana y 12 personas más indicaron que les gusta tu post".
3. Persiste, incrementa el contador en Redis y emite por WebSocket.
4. Encola push si el usuario no tiene sesión activa (heurística: sin WS conectado
   ni actividad en los últimos 5 min).

### 13.2 Canales

| Canal | Tecnología | Uso |
|---|---|---|
| In-app | WebSocket + persistencia | Todo |
| Push web | Web Push API (VAPID) | Menciones, DMs, follows |
| Push móvil | FCM (Android) / APNs (iOS) | Igual, configurable |
| Email | Resend / SES con plantillas React Email | Seguridad (siempre), digest semanal (opt-in) |

Preferencias granulares por tipo × canal. Emails transaccionales de seguridad
(login desde nuevo dispositivo, cambio de contraseña) no son desactivables.

---

## 14. Rendimiento y escalabilidad

### 14.1 Estrategia de caché

| Nivel | Contenido | TTL | Invalidación |
|---|---|---|---|
| CDN | Assets, media, perfiles públicos (HTML) | 1 año / 60 s | Purga por tag |
| Redis — objetos | Post hidratado, perfil de usuario | 5 min | Escritura → `DEL` |
| Redis — timelines | ZSET de IDs | 7 días | Append incremental |
| Redis — contadores | Hash por post/usuario | ∞ | Incremental |
| Aplicación (LRU) | Configuración, feature flags | 30 s | Pub/Sub |
| Cliente | TanStack Query | 30 s stale / 5 min gc | Optimista + refetch |

**Anti-estampida:** locks de reconstrucción (`SET NX PX 5000`) y *jitter* en TTLs
(±10 %). Caché negativa (60 s) para IDs inexistentes.

### 14.2 Base de datos

- **Réplicas de lectura:** todas las consultas de lectura van a réplicas, salvo
  *read-your-writes* (durante 5 s tras una escritura, el usuario lee de la
  primaria — señalizado por cookie de sesión).
- **Pooling:** PgBouncer en modo `transaction`, 100 conexiones por instancia.
- **Particionado:** `posts`, `notifications` y `messages` particionados por mes;
  particiones antiguas movidas a almacenamiento frío tras 12 meses.
- **Sharding futuro (>50 M usuarios):** por `user_id` con Citus o partición
  lógica en la capa de aplicación. `posts` se coloca con su autor.
- **Migraciones:** siempre expand-contract, nunca bloqueantes.
  `CREATE INDEX CONCURRENTLY`, `ALTER TABLE ... ADD COLUMN` con default en dos pasos.

### 14.3 Cargas típicas y capacidad

| Operación | QPS pico estimado | Estrategia |
|---|---|---|
| Lectura de timeline | 50 000 | Redis + réplicas, escalado horizontal de API |
| Lectura de post individual | 30 000 | Caché de objeto, CDN para anónimos |
| Publicación de post | 5 000 | Escritura primaria + Kafka |
| Like / repost | 15 000 | Redis primero, Postgres en lote |
| Fan-out | 5 000 × avg 200 seguidores = 1 M ops/s | Pipeline Redis, workers autoescalados |

### 14.4 Resiliencia

- **Circuit breakers** en toda llamada entre servicios (5 fallos / 10 s → abierto
  30 s), con respuesta degradada definida por servicio.
- **Timeouts explícitos:** BD 2 s, Redis 200 ms, servicios internos 1 s,
  externos 5 s. Nunca timeout infinito.
- **Bulkheads:** pools de conexión separados por criticidad; el fallo del servicio
  de búsqueda no puede agotar el pool del timeline.
- **Graceful degradation:** sin ranking → cronológico; sin búsqueda → mensaje
  claro; sin media → texto; sin WS → polling.
- **Load shedding:** ante saturación, se rechazan primero peticiones de baja
  prioridad (analítica, sugerencias) preservando lectura y publicación.

---

## 15. Observabilidad

### 15.1 Métricas (RED + USE)

Por servicio y endpoint: **Rate** (req/s), **Errors** (% 5xx), **Duration**
(p50/p95/p99). Por recurso: utilización, saturación, errores.

**Métricas de negocio:** posts/min, DAU/MAU, tasa de engagement, latencia de
fan-out, profundidad de colas, ratio de acierto de caché.

### 15.2 Trazas

OpenTelemetry extremo a extremo. Cada petición recibe un `trace_id` propagado por
HTTP, Kafka (headers) y jobs. Muestreo: 100 % de errores y peticiones lentas
(> 1 s), 1 % del resto.

### 15.3 Logs

JSON estructurado, con `trace_id`, `user_id` (hasheado), `request_id`. Niveles:
`error` (acción requerida), `warn` (anomalía recuperada), `info` (eventos de
negocio), `debug` (sólo en desarrollo). **Prohibido loguear** tokens, contraseñas,
contenido de DMs o emails completos.

### 15.4 Alertas (SLO-based)

| SLO | Objetivo | Alerta |
|---|---|---|
| Disponibilidad de API | 99.9 % | Burn rate 14.4× en 1 h (página) |
| Latencia p95 timeline | < 200 ms | > 400 ms durante 5 min |
| Latencia de fan-out p99 | < 5 s | > 30 s durante 5 min |
| Error rate de publicación | < 0.1 % | > 1 % durante 5 min |
| Lag de consumidores Kafka | < 10 s | > 60 s durante 10 min |

---

## 16. Infraestructura y despliegue

### 16.1 Entornos

| Entorno | Propósito | Datos |
|---|---|---|
| `local` | Docker Compose (Postgres, Redis, OpenSearch, MinIO, Kafka) | Semilla sintética |
| `preview` | Un entorno efímero por PR | Snapshot anonimizado |
| `staging` | Réplica de producción a escala reducida | Anonimizados |
| `production` | — | Reales |

### 16.2 Pipeline CI/CD

```yaml
# .github/workflows/ci.yml (esquema)
on: [push, pull_request]
jobs:
  quality:      # lint (ESLint + Biome), typecheck (tsc --noEmit), format
  test:         # unit (Vitest) + integration (Testcontainers) + coverage ≥ 80%
  security:     # npm audit, Semgrep, Trivy (imagen), gitleaks
  build:        # docker build multi-stage, push a GHCR con tag = sha
  e2e:          # Playwright contra entorno preview
  deploy:       # sólo en main: canary 5% → 25% → 100%, rollback automático
```

**Criterios de rollback automático:** error rate > 2 % o latencia p95 > 2× la
línea base durante 3 minutos en el canary.

### 16.3 Migraciones de base de datos

Drizzle Kit, versionadas en `packages/db/migrations`, aplicadas en un job previo
al despliegue. **Regla:** toda migración debe ser compatible con la versión
anterior del código (expand-contract), permitiendo rollback del código sin
rollback del esquema.

### 16.4 Backups y recuperación

- PostgreSQL: snapshot diario + WAL continuo (PITR con granularidad de 5 min).
- Retención: 7 diarios, 4 semanales, 12 mensuales.
- **RPO: 5 min · RTO: 1 h.**
- Restauración probada mensualmente en un entorno aislado (el backup no verificado
  no es un backup).
- S3 con versionado y replicación cross-region.

---

## 17. Testing

### 17.1 Pirámide

| Nivel | Herramienta | Cobertura objetivo | Qué prueba |
|---|---|---|---|
| Unitario | Vitest | ≥ 80 % | Lógica pura: parseo de entidades, cálculo de rankings, validadores |
| Integración | Vitest + Testcontainers | Rutas críticas | Handlers contra Postgres y Redis reales |
| Contrato | Pact / OpenAPI diff | 100 % de endpoints | Compatibilidad cliente ↔ servidor |
| E2E | Playwright | Flujos principales | Registro, publicar, seguir, DM, notificaciones |
| Carga | k6 | Escenarios de pico | Timeline a 50 k QPS, fan-out de cuenta grande |
| Accesibilidad | axe-core en CI | Todas las páginas | Violaciones WCAG bloquean el merge |
| Visual | Playwright snapshots | Componentes clave | Regresiones de layout |

### 17.2 Casos límite de obligada cobertura

- Post de exactamente 280 grafemas con emoji compuesto (ZWJ) y texto RTL.
- Contador de caracteres con URL (cuenta 23 sea cual sea su longitud).
- Fan-out de una cuenta con 10 M de seguidores (debe usar la ruta on-read).
- Borrado de un post con 50 000 respuestas (huérfanos, contadores del hilo).
- Bloqueo mutuo: ninguno de los dos ve al otro en ningún contexto.
- Reconexión de WebSocket con recuperación de 500 eventos perdidos.
- Timeline de un usuario que sigue a 0 cuentas (onboarding).
- Publicación simultánea del mismo `Idempotency-Key` (debe crear un solo post).
- Like concurrente desde 3 dispositivos (contador consistente al final).
- Usuario suspendido: sus posts desaparecen de timelines ajenos.

---

## 18. Estructura del repositorio

Monorepo con **pnpm workspaces + Turborepo**.

```
.
├── apps/
│   ├── web/                  # Next.js
│   ├── mobile/               # React Native (Expo)
│   ├── api/                  # Fastify
│   ├── ws-gateway/           # servidor WebSocket
│   ├── workers/              # fan-out, media, notificaciones, moderación
│   └── admin/                # panel de moderación
├── packages/
│   ├── db/                   # esquema Drizzle + migraciones + seeds
│   ├── contracts/            # esquemas Zod + tipos + spec OpenAPI
│   ├── ui/                   # componentes compartidos
│   ├── sdk/                  # cliente de API tipado (generado)
│   ├── config/               # eslint, tsconfig, tailwind compartidos
│   └── utils/                # snowflake, parseo de texto, rate limit
├── infra/
│   ├── terraform/
│   ├── helm/
│   └── docker/
├── docs/
│   ├── adr/                  # Architecture Decision Records
│   └── runbooks/             # procedimientos de incidencia
├── SPECS.md
└── turbo.json
```

**Reglas de dependencia:** `apps/*` puede depender de `packages/*`;
`packages/*` nunca depende de `apps/*`; `packages/contracts` no depende de nada.

---

## 19. Roadmap por fases

### Fase 0 — Cimientos (2 semanas)

Monorepo, CI, Docker Compose local, esquema base y migraciones, generador de
Snowflake, autenticación (registro, login, refresh), esqueleto de la web.

**Hecho cuando:** un usuario puede registrarse, iniciar sesión y ver una página
vacía autenticada, con CI verde y despliegue automático a staging.

### Fase 1 — MVP funcional (4 semanas)

CRUD de posts, entidades, follow/unfollow, timeline cronológico con fan-out,
likes y reposts, perfiles, subida de imágenes, notificaciones in-app básicas.

**Hecho cuando:** dos usuarios pueden seguirse, publicar con imagen, interactuar,
y ver el resultado reflejado en su timeline en < 5 s.

### Fase 2 — Producto completo (6 semanas)

Hilos y conversaciones, citas, búsqueda, tendencias, DMs, bookmarks, listas,
cuentas protegidas, bloqueos/silencios, vídeo, WebSocket en tiempo real,
push notifications, ajustes completos.

### Fase 3 — Escala e inteligencia (6 semanas)

Timeline algorítmico, ranking de respuestas, sugerencias de a quién seguir,
moderación automatizada, panel de administración, ClickHouse y analítica,
optimización de rendimiento contra los SLO definidos.

### Fase 4 — Extensión (continuo)

Apps móviles nativas, API pública con OAuth de terceros, espacios de audio,
monetización, verificación, herramientas para creadores.

---

## 20. Anexo: decisiones y trade-offs

| Decisión | Alternativas | Razón |
|---|---|---|
| PostgreSQL como fuente de verdad | Cassandra, DynamoDB | Consistencia fuerte, joins, madurez operativa; escala suficiente hasta decenas de millones de usuarios. NoSQL sólo si el sharding relacional se vuelve el cuello de botella real |
| Fan-out híbrido | Sólo on-read (simple) / sólo on-write (rápido) | On-read no cumple 200 ms p95 con miles de seguidos; on-write puro colapsa con cuentas de millones de seguidores |
| REST sobre GraphQL | GraphQL federado | Caché HTTP trivial, menor superficie de ataque (sin consultas costosas arbitrarias), tooling y depuración más simples. GraphQL sólo en el BFF móvil si se demuestra el ahorro de round-trips |
| Monolito modular inicial | Microservicios desde el día 1 | El coste operativo de microservicios sin tráfico real es puro lastre; los límites de módulo permiten extraer después sin reescribir |
| Snowflake IDs | UUIDv7, autoincremento | Ordenación temporal (paginación por cursor gratuita), sin coordinación entre nodos, 64 bits (mitad que UUID en índices). UUIDv7 es la alternativa razonable si se prefiere estándar |
| Drizzle sobre Prisma | Prisma, TypeORM, SQL crudo | SQL explícito y predecible, sin motor de consultas opaco, arranque más rápido, mejor control de índices |
| Redis para timelines | Base de datos dedicada | Latencia sub-milisegundo, ZSET encaja exactamente con el modelo; el coste de RAM es asumible (~10 KB/usuario activo) |
| Soft delete | Borrado físico | Permite restauración, cumple requisitos de moderación y auditoría; se purga a los 30 días para cumplir GDPR |

### Riesgos identificados

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fan-out de cuenta viral satura Redis | Timelines desactualizados | Umbral de celebridad + rate limit de fan-out + colas prioritarias |
| Contención de escritura en contadores de post viral | Latencia de likes | Contadores en Redis + agregación en lote, nunca `UPDATE` directo por like |
| Coste de almacenamiento de vídeo | Presupuesto | Límites por nivel de cuenta, transcodificación bajo demanda, ciclo de vida a almacenamiento frío |
| Abuso y spam en fase temprana | Reputación del producto | Verificación de email obligatoria, límites estrictos para cuentas nuevas, moderación desde la fase 1 |
| Deuda del ranking algorítmico | "Para ti" irrelevante | Empezar cronológico; introducir el modelo sólo con datos de entrenamiento suficientes y A/B testing |

---

*Fin del documento.*
