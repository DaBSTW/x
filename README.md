<div align="center">

# X

**Una plataforma de microblogging en tiempo real, abierta y a escala.**

[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](#)
[![Coverage](https://img.shields.io/badge/coverage-84%25-brightgreen)](#)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](#)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933)](#)

[Demo](https://demo.example.com) · [Documentación](./docs) · [Especificación técnica](./SPECS.md) · [Ruta de trabajo](./ROADMAP.md)

</div>

---

> [!IMPORTANT]
> **Estado del proyecto: fase de diseño.**
> Este README describe el proyecto **una vez terminado** — es el objetivo, no el
> estado actual. Ahora mismo el repositorio contiene la especificación técnica
> ([`SPECS.md`](./SPECS.md)) y el plan de ejecución ([`ROADMAP.md`](./ROADMAP.md)).
> Los comandos, rutas y badges de abajo son el contrato al que debe llegar la
> implementación. Consulta el ROADMAP para ver la fase en curso.

---

## Qué es

X es una red social de microblogging construida desde cero: publicaciones cortas,
un grafo social, timelines en tiempo real y todo lo que hace falta para operar eso
a escala real — fan-out híbrido, moderación por capas, búsqueda full-text y
observabilidad basada en SLOs.

No es una demo. Está diseñado con los números de un producto real en mente:
**10 M de usuarios registrados, 1 M diarios y picos de 5 000 publicaciones por
segundo**, con lecturas de timeline por debajo de 200 ms en el percentil 95.

### Por qué existe

La mayoría de los clones de Twitter se detienen en el CRUD. Lo interesante —y lo
difícil— empieza después: cómo se entrega un timeline a alguien que sigue a 2 000
cuentas sin hacer 2 000 consultas, qué pasa cuando una cuenta con 10 millones de
seguidores publica, y cómo se modera contenido sin un ejército de revisores.
Este proyecto trata esas preguntas como el producto, no como un detalle de
implementación.

---

## Características

### Núcleo social

- **Publicaciones** de hasta 280 caracteres — contados por grafemas, así que los
  emoji compuestos y el texto RTL se comportan como el usuario espera
- **Hilos y conversaciones** con respuestas anidadas y política de quién puede responder
- **Reposts y citas**, con el post citado embebido
- **Grafo social** completo: seguir, bloquear, silenciar, silenciar palabras clave
- **Cuentas protegidas** con solicitudes de seguimiento
- **Listas** públicas y privadas, cada una con su propio timeline

### Timeline

- **Cronológico** ("Siguiendo") con fan-out híbrido: precomputado en Redis para
  cuentas normales, resuelto en lectura para cuentas grandes
- **Algorítmico** ("Para ti") en tres etapas — generación de candidatos, ranking
  con un modelo GBDT, y heurísticas de diversidad y deduplicación
- **Degradación garantizada**: si el ranking falla o tarda más de 100 ms, se sirve
  el cronológico. El usuario nunca ve un error donde debería haber un feed

### Tiempo real

- Notificaciones, mensajes y contadores por **WebSocket**, con recuperación de
  eventos perdidos tras una reconexión
- Indicadores de escritura y recibos de lectura en mensajes directos
- Badge de "posts nuevos" sin recargar

### Contenido

- **Imágenes** (hasta 4 por post) servidas en WebP y AVIF, con blurhash como
  placeholder y alt-text
- **Vídeo** transcodificado a HLS multi-bitrate; **GIF** convertido a MP4
- **EXIF eliminado por completo** en la subida — incluida la geolocalización
- **Búsqueda** full-text con operadores (`from:`, `filter:media`, `min_faves:`,
  `since:`…) y tendencias segmentadas por región e idioma

### Confianza y seguridad

- **2FA TOTP**, rotación de refresh tokens con detección de reuso, gestión de sesiones
- **Moderación en tres capas**: preventiva (síncrona), automática (clasificadores)
  y reactiva (reportes), con acciones graduadas y derecho de apelación
- **Antispam** por score de confianza, límites para cuentas nuevas y detección de
  campañas coordinadas
- **GDPR**: exportación de datos, borrado con periodo de gracia, retención automatizada

### Accesibilidad

- **WCAG 2.2 AA verificado en CI** — una violación de axe-core bloquea el merge
- Navegación completa por teclado (`j`/`k` para moverse, `l` like, `r` responder…)
- Soporte RTL, tema claro y oscuro, y `prefers-reduced-motion` respetado

---

## Capturas

<div align="center">

| Timeline | Hilo | Mensajes |
|---|---|---|
| ![Timeline](./docs/assets/timeline.png) | ![Hilo](./docs/assets/thread.png) | ![Mensajes](./docs/assets/messages.png) |

*Tema claro y oscuro · escritorio y móvil*

</div>

---

## Stack

<table>
<tr><td><b>Frontend</b></td><td>

Next.js 15 (App Router, RSC) · React 19 · TypeScript · Tailwind CSS 4 ·
shadcn/ui (Radix) · TanStack Query · TanStack Virtual · Zustand

</td></tr>
<tr><td><b>Backend</b></td><td>

Node.js 22 · Fastify 5 · Drizzle ORM · Zod · BullMQ · µWebSockets.js

</td></tr>
<tr><td><b>Datos</b></td><td>

PostgreSQL 17 (particionado) · Redis 7 (Cluster) · OpenSearch 2 ·
ClickHouse · Kafka · S3/R2

</td></tr>
<tr><td><b>Infra</b></td><td>

Docker · Kubernetes · Terraform · Helm · Cloudflare ·
OpenTelemetry + Grafana · GitHub Actions

</td></tr>
</table>

Las razones detrás de cada elección —y las alternativas descartadas— están en
[SPECS.md §20](./SPECS.md#20-anexo-decisiones-y-trade-offs).

---

## Arquitectura

```
   Web · Móvil · API ──▶ CDN + WAF ──▶ API Gateway ──▶ Servicios
                                                          │
                    ┌─────────────────────────────────────┤
                    ▼                                     ▼
              Kafka (eventos)                    PostgreSQL · Redis
                    │                            OpenSearch · S3
        ┌───────────┴───────────┐
        ▼                       ▼
   Fan-out workers      Notification workers
        │                       │
        ▼                       ▼
   Redis (timelines)      WS Gateway ──▶ clientes
```

**La decisión que define el sistema** es el fan-out híbrido: las cuentas con menos
de 10 000 seguidores empujan sus posts a los timelines precomputados de Redis en
el momento de publicar; las cuentas grandes no hacen fan-out y sus posts se
mezclan en el momento de la lectura. Ni el modelo puro de escritura ni el de
lectura funcionan solos a esta escala — el detalle completo está en
[SPECS.md §6](./SPECS.md#6-timeline-el-problema-central).

---

## Puesta en marcha

### Requisitos

- Node.js ≥ 22 · pnpm ≥ 9 · Docker y Docker Compose
- 8 GB de RAM libres (los servicios de datos son los que mandan)

### Instalación

```bash
git clone https://github.com/DaBSTW/x.git
cd x

cp .env.example .env      # los valores por defecto sirven para desarrollo
pnpm setup                # instala, levanta servicios, migra y siembra datos
pnpm dev                  # arranca web + api + workers
```

| Servicio | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Documentación de la API (Scalar) | http://localhost:3001/docs |
| Mailpit (emails de desarrollo) | http://localhost:8025 |
| MinIO (S3 local) | http://localhost:9001 |

La semilla crea 50 usuarios y 500 posts. Puedes entrar con
`ana@example.com` / `password123`.

### Comandos

```bash
pnpm dev              # todo el stack en modo desarrollo
pnpm build            # build de producción de todas las apps
pnpm test             # unitarios + integración (Testcontainers)
pnpm test:e2e         # Playwright contra un entorno efímero
pnpm lint             # ESLint + Biome
pnpm typecheck        # tsc --noEmit en todo el monorepo
pnpm db:generate      # genera una migración desde el esquema Drizzle
pnpm db:migrate       # aplica migraciones pendientes
pnpm db:studio        # explorador visual de la base de datos
pnpm db:seed          # repuebla con datos de desarrollo
```

---

## Estructura

```
.
├── apps/
│   ├── web/           # Next.js — la aplicación web
│   ├── mobile/        # React Native (Expo)
│   ├── api/           # Fastify — API REST
│   ├── ws-gateway/    # servidor WebSocket
│   ├── workers/       # fan-out, media, notificaciones, moderación
│   └── admin/         # panel de moderación
├── packages/
│   ├── db/            # esquema Drizzle, migraciones y seeds
│   ├── contracts/     # esquemas Zod + tipos + spec OpenAPI
│   ├── sdk/           # cliente de API tipado, generado
│   ├── ui/            # componentes compartidos
│   ├── config/        # eslint, tsconfig y tailwind compartidos
│   └── utils/         # snowflake, parseo de texto, rate limiting
├── infra/             # Terraform, Helm, Dockerfiles
└── docs/
    ├── adr/           # decisiones de arquitectura
    └── runbooks/      # procedimientos de incidencia
```

**Regla de dependencias:** `apps/*` puede depender de `packages/*`;
`packages/*` nunca depende de `apps/*`; `packages/contracts` no depende de nada.
Esto es lo que permite que el móvil y la web compartan tipos sin acoplarse.

---

## API

REST con OpenAPI 3.1, paginación por cursor y errores tipados.

```bash
curl -X POST https://api.example.com/v1/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hola mundo 👋 #dev"}'
```

```json
{
  "data": {
    "id": "1823456789012349999",
    "text": "Hola mundo 👋 #dev",
    "created_at": "2026-08-11T14:32:00Z",
    "author": { "username": "ana", "display_name": "Ana", "is_verified": true },
    "counters": { "likes": 0, "reposts": 0, "replies": 0, "views": 0 },
    "viewer": { "liked": false, "reposted": false, "bookmarked": false }
  }
}
```

Referencia completa en `/docs` con el servidor levantado, o en
[SPECS.md §5](./SPECS.md#5-api).

---

## Rendimiento

Objetivos verificados en cada despliegue, no aspiraciones:

| Métrica | Objetivo |
|---|---|
| Lectura de timeline (p95) | < 200 ms |
| Publicación de post (p95) | < 300 ms |
| Fan-out a seguidores (p99) | < 5 s |
| Disponibilidad | 99.9 % |
| LCP / INP / CLS | < 2.5 s / < 200 ms / < 0.1 |
| Bundle inicial | < 180 KB gzip |

El CI falla si el bundle crece por encima del presupuesto, y las alertas de
producción se basan en burn rate de SLO, no en umbrales fijos.

---

## Testing

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitario | Vitest | Lógica pura — parseo de entidades, ranking, validadores |
| Integración | Vitest + Testcontainers | Handlers contra Postgres y Redis reales |
| Contrato | OpenAPI diff | Compatibilidad cliente ↔ servidor |
| E2E | Playwright | Registro, publicar, seguir, DM, notificaciones |
| Carga | k6 | 50 k QPS de timeline, fan-out de cuenta grande |
| Accesibilidad | axe-core | WCAG 2.2 AA — bloquea el merge |

Cobertura mínima: **80 %**. Los casos límite de obligada cobertura (emoji ZWJ,
bloqueo mutuo, borrado de hilos masivos, reconexión con eventos perdidos) están
listados en [SPECS.md §17.2](./SPECS.md#172-casos-límite-de-obligada-cobertura).

---

## Despliegue

```bash
# staging: automático desde main
git push origin main

# producción: despliegue canario 5% → 25% → 100%
gh workflow run deploy.yml -f environment=production
```

Rollback automático si el error rate supera el 2 % o la latencia p95 duplica la
línea base durante 3 minutos en el canary.

Backups de PostgreSQL con **PITR (RPO 5 min, RTO 1 h)**, restaurados y verificados
mensualmente — un backup no probado no cuenta como backup.

---

## Contribuir

1. Abre un issue describiendo el problema antes de escribir código
2. Rama desde `main`: `feat/descripcion-corta` o `fix/descripcion-corta`
3. Toda PR necesita tests de lo que añade y CI en verde
4. Las decisiones arquitectónicas no triviales requieren un ADR en `docs/adr/`
5. Los endpoints nuevos se añaden a `packages/contracts` **antes** de implementarse

Commits en formato [Conventional Commits](https://www.conventionalcommits.org/).
El detalle está en [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Documentación

| Documento | Contenido |
|---|---|
| [SPECS.md](./SPECS.md) | Especificación técnica completa — modelo de datos, API, arquitectura, seguridad |
| [ROADMAP.md](./ROADMAP.md) | Plan de ejecución por fases con criterios de aceptación |
| [docs/adr/](./docs/adr/) | Registro de decisiones arquitectónicas |
| [docs/runbooks/](./docs/runbooks/) | Qué hacer cuando algo se rompe en producción |

---

## Licencia

[AGPL-3.0](./LICENSE)

---

<div align="center">
<sub>No afiliado con X Corp. ni con Twitter. Proyecto independiente con fines educativos y de investigación.</sub>
</div>
