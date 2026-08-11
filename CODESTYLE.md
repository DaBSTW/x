# CODESTYLE.md — Guía de estilo de código

> Reglas de escritura de código para este repositorio.
> Aplican a todo el monorepo: `apps/*`, `packages/*` e `infra/*`.
>
> **Nota sobre el idioma de este documento:** la prosa está en español, igual que
> [`SPECS.md`](./SPECS.md) y [`ROADMAP.md`](./ROADMAP.md). **El código, sin
> excepción, va en inglés** (regla §2). Si prefieres el documento completo en
> inglés, es una traducción directa.

---

## Índice

1. [Principios](#1-principios)
2. [Idioma: inglés](#2-idioma-inglés)
3. [Comentarios](#3-comentarios)
4. [Formateo](#4-formateo)
5. [Nomenclatura](#5-nomenclatura)
6. [TypeScript](#6-typescript)
7. [Estructura de la codebase](#7-estructura-de-la-codebase)
8. [Depurabilidad](#8-depurabilidad)
9. [Errores](#9-errores)
10. [Asincronía](#10-asincronía)
11. [Frontend (React / Next.js)](#11-frontend-react--nextjs)
12. [Backend (Fastify / Drizzle)](#12-backend-fastify--drizzle)
13. [Base de datos y SQL](#13-base-de-datos-y-sql)
14. [Tests](#14-tests)
15. [Git](#15-git)
16. [Seguridad en el código](#16-seguridad-en-el-código)
17. [Checklist production-ready](#17-checklist-production-ready)
18. [Cómo se aplican estas reglas](#18-cómo-se-aplican-estas-reglas)

---

## 1. Principios

Cuando una regla concreta no cubra un caso, decide con estos principios en este orden:

1. **El código se lee muchas más veces de las que se escribe.** Optimiza para quien
   lo lea dentro de seis meses sin contexto — probablemente tú.
2. **Explícito antes que corto.** La brevedad no es un valor. La claridad sí.
3. **Fallar rápido y ruidosamente.** Un error visible en desarrollo cuesta minutos;
   uno silencioso en producción cuesta días.
4. **Todo lo que ocurre en producción debe poder observarse.** Si no puedes
   responder "¿qué pasó exactamente?" con los logs y las trazas, el código no
   está terminado.
5. **La consistencia gana a la preferencia personal.** Si el módulo ya hace algo
   de una manera razonable, síguela; no introduzcas un segundo patrón.
6. **Lo automatizable no se discute en review.** El formateo, el orden de imports
   y las reglas de lint las decide una herramienta, no una persona.

---

## 2. Idioma: inglés

**Todo el código va en inglés.** Sin excepciones, sin mezclas.

### Obligatorio en inglés

| Elemento | Ejemplo |
|---|---|
| Identificadores (variables, funciones, clases, tipos) | `followerCount`, `resolveThread()` |
| Nombres de archivos y carpetas | `post-repository.ts`, `use-timeline.ts` |
| Comentarios y JSDoc | `// Snowflake IDs are monotonic, so ORDER BY id is chronological.` |
| Mensajes de commit y títulos de PR | `feat(timeline): add celebrity fan-out threshold` |
| Nombres de rama | `feat/timeline-fanout` |
| Claves de logs y nombres de métricas | `timeline.fanout.duration_ms` |
| Mensajes de error internos y códigos de error | `RATE_LIMIT_EXCEEDED` |
| Columnas, tablas e índices de base de datos | `follower_id`, `idx_posts_author` |
| Documentación técnica dentro de `packages/*` | `README.md` de cada paquete |

### Única excepción

Los **textos visibles para el usuario final** viven en los catálogos de
internacionalización (`packages/i18n/messages/*.json`), nunca embebidos en el
código. La clave es inglés; el valor es el idioma que toque.

```ts
// ✅ Correcto — la clave es inglés, la traducción vive en el catálogo
t('composer.characterLimitExceeded')

// ❌ Incorrecto — texto en español embebido en el código
throw new Error('El texto supera el límite de caracteres')

// ❌ Incorrecto — identificador en español
const contadorSeguidores = user.followers_count
```

**Por qué:** el proyecto asume contribuidores de cualquier idioma, las
herramientas y librerías del stack están en inglés, y una codebase mezclada
obliga a cambiar de idioma mentalmente en cada archivo.

---

## 3. Comentarios

**Un comentario es una admisión de que el código no se explica solo.** A veces es
inevitable y entonces es valioso. La mayoría de las veces significa que el código
debería reescribirse.

### Reglas

1. **Comenta el porqué, nunca el qué.** El *qué* ya está en el código.
2. **Sé técnico y concreto.** Un comentario vago es peor que ninguno: ocupa
   espacio y no informa.
3. **Si no aporta información que el código no tiene, bórralo.**
4. **Un comentario desactualizado es un bug.** Si cambias el código, actualiza o
   elimina su comentario en la misma PR.

### Cuándo un comentario está justificado

- Una decisión no obvia con alternativas descartadas
- Una restricción externa (comportamiento de una librería, límite de una API, bug de un navegador)
- Una optimización que sacrifica legibilidad, con su medición
- Una invariante que el sistema de tipos no puede expresar
- Un enlace a un issue, RFC o ADR que da el contexto completo

```ts
// ✅ Explica una decisión que el código no puede expresar
// Accounts above this follower count skip write fan-out: pushing to 10M
// timelines blocks the queue for minutes. Their posts are merged at read
// time instead. See SPECS.md §6.1.
const CELEBRITY_FOLLOWER_THRESHOLD = 10_000

// ✅ Documenta una restricción externa
// Redis pipelines above ~1000 commands start hitting the 512MB reply buffer
// on our cluster config, so batches are capped here rather than by follower count.
const FANOUT_BATCH_SIZE = 1_000

// ✅ Justifica una optimización con su medición
// Manual loop instead of .filter().map(): this runs per post per timeline read
// (~50k/s at peak) and the intermediate array showed up in CPU profiles.
for (let i = 0; i < posts.length; i++) { /* … */ }

// ✅ Invariante que el tipo no captura
// `entities` offsets are code point indexes, not UTF-16 units. Slicing with
// String.prototype.slice here would corrupt emoji and CJK text.
```

```ts
// ❌ Repite lo que el código ya dice
// Increment the counter
counter++

// ❌ Vago — no dice nada accionable
// Handle the edge case
if (posts.length === 0) return []

// ❌ Ruido decorativo
// ============================
//        HELPERS
// ============================

// ❌ Historial — para eso está git
// Modified by Ana on 2026-08-11, previously used a Map

// ❌ Código comentado — bórralo, git lo recuerda
// const oldRanking = computeLegacyScore(post)

// ❌ TODO sin dueño ni ticket
// TODO: fix this later
```

### TODO y FIXME

Sólo se admiten con **issue asociado**. Sin issue, el lint los rechaza.

```ts
// TODO(#412): replace with the batched counter worker once Kafka lands in phase 3.
// FIXME(#380): reply ordering ignores muted keywords; needs the filter pipeline.
```

### JSDoc

Sólo en la **API pública de un paquete** (lo que se exporta desde `index.ts`).
No en funciones internas: ahí el nombre y los tipos deben bastar.

```ts
/**
 * Generates a 64-bit Snowflake ID: timestamp_ms << 22 | worker_id << 12 | sequence.
 *
 * IDs are monotonically increasing within a worker, which is what makes cursor
 * pagination possible without a secondary sort key.
 *
 * @throws {ClockDriftError} If the system clock moved backwards more than 100ms.
 */
export function generateId(): bigint
```

---

## 4. Formateo

**El formateo no se discute, no se revisa y no se negocia.** Lo decide la
herramienta y se aplica automáticamente.

### Configuración

- **Biome** para formateo y ordenación de imports
- **ESLint** para reglas semánticas que Biome no cubre
- Configuración única en `packages/config`, sin overrides por paquete salvo
  justificación en un ADR

```jsonc
// biome.json
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  }
}
```

### Aplicación

| Momento | Qué pasa |
|---|---|
| Al guardar en el editor | Formateo automático (`.vscode/settings.json` versionado) |
| Pre-commit | `lint-staged` formatea el diff; si algo cambia, el commit incluye el formato |
| CI | `biome ci` falla si algún archivo no está formateado |

**Nadie comenta formato en una code review.** Si aparece un problema de formato en
una PR, el fallo está en la configuración, no en el autor.

### Orden de imports

Automático, agrupado y separado por línea en blanco:

```ts
// 1. Node builtins
import { randomUUID } from 'node:crypto'

// 2. External
import { eq, and, desc } from 'drizzle-orm'
import Fastify from 'fastify'

// 3. Internal workspace packages
import { generateId } from '@x/utils'
import { postSchema } from '@x/contracts'

// 4. Relative
import { hydratePosts } from './hydration'
import type { TimelineCursor } from './types'
```

---

## 5. Nomenclatura

| Elemento | Convención | Ejemplo |
|---|---|---|
| Variables y funciones | `camelCase` | `followerCount`, `buildTimeline()` |
| Tipos, interfaces, clases | `PascalCase` | `TimelineCursor`, `PostRepository` |
| Constantes de módulo | `SCREAMING_SNAKE_CASE` | `MAX_POST_LENGTH` |
| Archivos | `kebab-case.ts` | `post-repository.ts` |
| Componentes React | `PascalCase.tsx` | `PostCard.tsx` |
| Hooks | `use-*.ts` → `useX()` | `use-timeline.ts` → `useTimeline()` |
| Tablas y columnas SQL | `snake_case` | `post_counters.likes_count` |
| Variables de entorno | `SCREAMING_SNAKE_CASE` | `DATABASE_URL` |
| Tipos de evento | `dot.case` | `post.created`, `interaction.like` |

### Reglas semánticas

```ts
// ✅ Booleanos: prefijo is/has/should/can
const isProtected = user.is_protected
const hasMedia = post.media.length > 0
const canReply = policy.allows(viewer)

// ✅ Funciones: verbo primero
function resolveConversationRoot(postId: bigint): bigint
function assertNotBlocked(viewerId: bigint, authorId: bigint): void

// ✅ Async que devuelve un valor: get/fetch/load según el origen
getCachedTimeline()   // memoria/Redis
fetchTimeline()       // red
loadTimelineFromDb()  // base de datos

// ✅ Unidades explícitas en el nombre
const timeoutMs = 2_000
const maxSizeBytes = 5 * 1024 * 1024
const durationSeconds = 140

// ❌ Abreviaturas que no son universales
const usrCnt = 10        // → userCount
const tl = await get()   // → timeline

// ❌ Nombres que mienten sobre el coste
const user = getUser(id)          // parece local, hace una query
const user = await fetchUser(id)  // ✅ el await y el nombre lo delatan
```

**Prohibido:** nombres de una letra salvo índices de bucle (`i`, `j`) y genéricos
convencionales (`T`, `K`, `V`).

---

## 6. TypeScript

### Configuración obligatoria

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

### Reglas

**`any` está prohibido.** Usa `unknown` y estrecha el tipo. Si necesitas `any`,
requiere `// eslint-disable-next-line` con una justificación técnica.

```ts
// ❌
function parse(data: any) { return data.items }

// ✅
function parse(data: unknown): Item[] {
  return itemsSchema.parse(data)
}
```

**Nada de `as` para silenciar al compilador.** Un cast es una afirmación de que
sabes más que el sistema de tipos; casi siempre es falso.

```ts
// ❌ Miente: si la query no devuelve nada, esto explota en runtime
const user = rows[0] as User

// ✅ Maneja el caso real
const user = rows[0]
if (!user) throw new NotFoundError('user', id)
```

**Nada de `!` (non-null assertion).** Misma razón. Si algo no puede ser nulo,
demuéstralo con una comprobación o con un tipo mejor.

**Uniones discriminadas antes que booleanos que se excluyen.**

```ts
// ❌ Permite estados imposibles: isLoading y error a la vez
type State = { isLoading: boolean; data?: Post[]; error?: Error }

// ✅ Los estados imposibles no se pueden representar
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Post[] }
  | { status: 'error'; error: Error }
```

**Valida en los límites, confía dentro.** Todo dato que entra al sistema —body
HTTP, query params, respuesta de API externa, payload de evento, variable de
entorno— pasa por Zod. Dentro del núcleo, los tipos ya son verdad.

```ts
// packages/contracts/src/post.ts — una sola fuente de verdad
export const createPostSchema = z.object({
  text: z.string().max(280).optional(),
  mediaIds: z.array(z.string()).max(4).default([]),
  inReplyToId: z.string().optional(),
})

export type CreatePostInput = z.infer<typeof createPostSchema>
```

**`type` por defecto, `interface` sólo si necesitas extensión declarativa.**

**Tipos derivados, no duplicados.** Si un tipo se puede inferir del esquema o del
modelo de datos, se infiere.

```ts
// ✅
type Post = typeof posts.$inferSelect
type NewPost = typeof posts.$inferInsert
```

---

## 7. Estructura de la codebase

### Dirección de dependencias

```
apps/*  ──▶  packages/*  ──▶  packages/contracts
                              packages/utils
```

- `apps/*` puede depender de `packages/*`
- `packages/*` **nunca** depende de `apps/*`
- `packages/contracts` y `packages/utils` no dependen de nada del workspace
- Dos `apps/*` nunca se importan entre sí — comparten a través de un paquete

Verificado con `eslint-plugin-boundaries`. Una violación rompe el build.

### Organización por feature, no por tipo de archivo

```
// ❌ Por tipo — para cambiar una feature tocas cinco carpetas lejanas
src/
├── controllers/
├── services/
├── repositories/
└── types/

// ✅ Por feature — un cambio vive en una carpeta
src/
├── timeline/
│   ├── timeline.routes.ts       # HTTP: validación y respuesta
│   ├── timeline.service.ts      # lógica de dominio
│   ├── timeline.repository.ts   # acceso a datos
│   ├── timeline.types.ts
│   └── timeline.test.ts
├── posts/
└── shared/                      # sólo lo que usan ≥3 features
```

### Capas dentro de una feature

| Capa | Responsabilidad | Prohibido |
|---|---|---|
| `*.routes.ts` | Parsear entrada, invocar servicio, formatear salida | Lógica de negocio, SQL |
| `*.service.ts` | Reglas de dominio, orquestación, autorización | Objetos de HTTP (`req`, `res`), SQL crudo |
| `*.repository.ts` | Consultas y mapeo de datos | Reglas de negocio |

El servicio no sabe que existe HTTP. Eso es lo que permite invocarlo desde un
worker, un job o un test sin montar un servidor.

### Límites de tamaño

Orientativos, no dogma — pero superarlos es señal de que algo hace demasiado:

| Unidad | Límite | Señal |
|---|---|---|
| Archivo | ~300 líneas | Probablemente son dos features |
| Función | ~50 líneas | Extrae pasos con nombre |
| Parámetros | 3 | A partir de ahí, un objeto con nombres |
| Anidamiento | 3 niveles | Usa early return o extrae |

```ts
// ✅ Early returns en lugar de anidamiento
function canViewPost(viewer: User | null, post: Post, author: User): boolean {
  if (post.deletedAt) return false
  if (author.isSuspended) return false
  if (!author.isProtected) return true
  if (!viewer) return false
  if (viewer.id === author.id) return true
  return isFollowing(viewer.id, author.id)
}
```

### Prohibido: barrel files internos

Un `index.ts` que reexporta todo un directorio rompe el tree-shaking, crea ciclos
de importación y hace ilegible de dónde viene cada cosa. Sólo se permite en la
raíz de un paquete, definiendo su API pública.

---

## 8. Depurabilidad

**Un incidente en producción se resuelve con lo que el código dejó escrito.**
Estas reglas existen para que ese momento no dependa de la suerte.

### 8.1 Logging estructurado

`console.log` está prohibido fuera de scripts. Se usa el logger inyectado (Pino),
que emite JSON con `trace_id`, `request_id` y `user_id` hasheado.

```ts
// ❌ Inútil en producción: no se puede filtrar, correlacionar ni alertar
console.log('fanout done', userId)

// ✅ Consultable, correlacionable y con contexto suficiente para actuar
logger.info({
  event: 'timeline.fanout.completed',
  authorId,
  followerCount,
  batchCount,
  durationMs,
}, 'fan-out completed')
```

**Niveles:**

| Nivel | Cuándo | Ejemplo |
|---|---|---|
| `error` | Requiere acción humana | Fan-out agotó reintentos |
| `warn` | Anomalía que el sistema absorbió | Circuit breaker abierto, fallback a cronológico |
| `info` | Evento de negocio relevante | Post publicado, cuenta suspendida |
| `debug` | Sólo desarrollo | Query generada, cache miss |

**Nunca se loguean:** contraseñas, tokens, cookies, contenido de mensajes
directos, emails completos, ni PII sin hashear. El logger tiene redacción
automática configurada, pero la primera línea de defensa es no pasarlos.

### 8.2 Contexto en todo

Un log o un error sin identificadores es un callejón sin salida. Incluye siempre
los IDs que permiten reconstruir el caso.

```ts
// ❌ ¿Qué post? ¿De quién? ¿En qué petición?
throw new Error('Post not found')

// ✅ Reproducible desde el log
throw new NotFoundError('post', postId, { viewerId, source: 'thread-resolution' })
```

### 8.3 Nunca tragarse un error

```ts
// ❌ El bug desaparece sin dejar rastro
try {
  await indexPost(post)
} catch {}

// ❌ Igual de malo: parece manejado, no lo está
try {
  await indexPost(post)
} catch (error) {
  // ignore
}

// ✅ Degradación deliberada, registrada y medible
try {
  await indexPost(post)
} catch (error) {
  // Search indexing is best-effort: a post that fails to index is still
  // published and gets picked up by the nightly reconciliation job.
  logger.warn({ error, postId: post.id }, 'search indexing failed, deferred to reconciliation')
  metrics.increment('search.index.failed')
}
```

Si un `catch` está vacío, o el error no se registra ni se relanza, la PR se rechaza.

### 8.4 Fallar rápido

Valida las precondiciones al principio de la función, no cuando ya se ha hecho
trabajo a medias.

```ts
// ✅ El error ocurre donde está la causa, no tres capas más abajo
function buildTimeline(userId: bigint, cursor: Cursor, limit: number): Promise<Post[]> {
  if (limit < 1 || limit > 100) {
    throw new ValidationError('limit must be between 1 and 100', { limit })
  }
  // …
}
```

La configuración se valida **al arrancar el proceso**, no en el primer uso. Un
servicio con `DATABASE_URL` ausente debe morir en el arranque con un mensaje
claro, no fallar en la primera petición de un usuario.

### 8.5 Trazabilidad

- Todo `trace_id` se propaga por HTTP, por headers de Kafka y por los jobs
- Toda operación que cruza un límite de servicio abre un span
- Todo span lleva los atributos que permiten filtrarlo (`user.id`, `post.id`, `route`)

### 8.6 Código observable por diseño

```ts
// ❌ Una caja negra: si tarda, no sabes en qué
async function publishPost(input: CreatePostInput): Promise<Post> {
  const post = await db.insert(posts).values(/* … */)
  await queue.add('fanout', { postId: post.id })
  await search.index(post)
  return post
}

// ✅ Cada paso es medible y atribuible
async function publishPost(input: CreatePostInput): Promise<Post> {
  return tracer.startActiveSpan('post.publish', async (span) => {
    span.setAttribute('author.id', String(input.authorId))

    const post = await timed('post.insert', () => postRepository.insert(input))
    span.setAttribute('post.id', String(post.id))

    await timed('post.enqueue_fanout', () => fanoutQueue.add({ postId: post.id }))

    logger.info({ event: 'post.published', postId: post.id, authorId: input.authorId })
    return post
  })
}
```

### 8.7 Feature flags

Todo comportamiento nuevo con riesgo operativo (ranking algorítmico, nuevo
pipeline de fan-out, cambio de proveedor) entra detrás de un flag evaluable en
caliente. Un rollback no debería requerir un despliegue.

---

## 9. Errores

### Jerarquía

```ts
// packages/utils/src/errors.ts
export abstract class AppError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number

  constructor(
    message: string,
    readonly context: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND'
  readonly httpStatus = 404
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMIT_EXCEEDED'
  readonly httpStatus = 429
}
```

### Reglas

- **Errores tipados, no strings.** `throw new NotFoundError(...)`, nunca `throw 'not found'`.
- **Preserva la causa** con `{ cause }` — la traza original es la información valiosa.
- **No captures lo que no puedas manejar.** Deja subir el error al handler global.
- **Distingue lo esperado de lo excepcional.** Que un post no exista es esperado
  (404, `info`); que PostgreSQL rechace la conexión no lo es (500, `error`).
- **Mensaje interno ≠ mensaje al usuario.** El interno es técnico y detallado; el
  del usuario es una clave de i18n sin detalles de implementación.

```ts
// ✅ Un solo handler traduce AppError → respuesta HTTP
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    request.log.info({ error, context: error.context }, error.message)
    return reply.status(error.httpStatus).send({
      error: { code: error.code, message: t(error.code), request_id: request.id },
    })
  }

  request.log.error({ error }, 'unhandled error')
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: t('errors.internal'), request_id: request.id },
  })
})
```

---

## 10. Asincronía

```ts
// ✅ Independientes → en paralelo
const [profile, counters, isFollowing] = await Promise.all([
  getProfile(userId),
  getCounters(userId),
  checkFollowing(viewerId, userId),
])

// ❌ Serializado sin motivo: triplica la latencia
const profile = await getProfile(userId)
const counters = await getCounters(userId)
const isFollowing = await checkFollowing(viewerId, userId)
```

- **`Promise.all` para lo independiente**, `Promise.allSettled` cuando un fallo
  parcial es aceptable.
- **Nunca `await` dentro de un bucle** sobre datos independientes. Usa `Promise.all`
  con lotes acotados (`p-limit`) para no saturar el pool de conexiones.
- **Nunca una promesa flotante.** Si no la esperas, es explícito: `void queue.add(...)`
  con un `.catch()` registrado. `no-floating-promises` está activo.
- **Timeout explícito en toda llamada externa.** Sin excepción. BD 2 s, Redis 200 ms,
  servicio interno 1 s, externo 5 s.
- **`AbortSignal` propagado** en toda operación cancelable.

---

## 11. Frontend (React / Next.js)

### Componentes

- **Server Components por defecto.** `'use client'` sólo en las hojas del árbol
  que realmente necesitan interactividad.
- **Un componente por archivo**, con el nombre del archivo.
- **Props tipadas explícitamente**, sin `React.FC`.
- **Sin lógica de negocio en el componente**: extráela a un hook o a `packages/utils`.

```tsx
// ✅
type PostCardProps = {
  post: Post
  viewerId: string | null
  onReply?: (postId: string) => void
}

export function PostCard({ post, viewerId, onReply }: PostCardProps) { /* … */ }
```

### Estado

| Tipo de estado | Herramienta |
|---|---|
| Datos del servidor | TanStack Query — **nunca** `useState` + `useEffect` |
| Estado de UI global | Zustand (modales, composer, tema) |
| Estado local | `useState` |
| Estado derivado | Cálculo directo, no un `useState` sincronizado |

```tsx
// ❌ Estado duplicado que se desincroniza
const [likeCount, setLikeCount] = useState(post.counters.likes)

// ✅ Derivado de la caché, siempre consistente
const likeCount = post.counters.likes
```

### Reglas duras

- **`dangerouslySetInnerHTML` está prohibido.** El texto enriquecido se renderiza
  por offsets de `entities` (§ SPECS 7.2). Sin excepciones.
- **Toda `key` de lista es un ID estable**, nunca el índice.
- **Ningún `useEffect` para obtener datos.** Es una fuente de race conditions.
- **Toda imagen usa `next/image`** con `sizes` explícito.
- **Todo elemento interactivo es accesible por teclado** y tiene nombre accesible.
- **Toda mutación que el usuario percibe como instantánea es optimista** con rollback.

---

## 12. Backend (Fastify / Drizzle)

### Rutas

Una ruta hace exactamente tres cosas: validar, delegar, responder.

```ts
// ✅
app.post('/posts', {
  schema: {
    body: createPostSchema,
    response: { 201: postResponseSchema },
  },
  preHandler: [requireAuth, rateLimit('post:create')],
}, async (request, reply) => {
  const post = await postService.create(request.user.id, request.body)
  return reply.status(201).send({ data: post })
})
```

- **Toda ruta declara su schema** de entrada y de salida. Sin schema, no se
  serializa correctamente ni se genera OpenAPI.
- **Toda ruta autenticada declara su `preHandler`.** La autorización no se hace
  a mano dentro del handler.
- **Toda escritura acepta `Idempotency-Key`.**
- **Ninguna ruta accede a la base de datos directamente.** Pasa por el servicio.

### Servicios

- Reciben y devuelven tipos de dominio, no objetos de Fastify
- Contienen la autorización de negocio (`assertCanView`, `assertNotBlocked`)
- Son invocables desde un worker o un test sin servidor HTTP

### Repositorios

- Única capa que conoce Drizzle
- Devuelven tipos de dominio, no filas crudas
- **Ninguna consulta sin índice.** Si el `EXPLAIN` hace seq scan sobre una tabla
  grande, la PR no entra.

---

## 13. Base de datos y SQL

- **Consultas parametrizadas siempre.** SQL concatenado con datos de usuario está
  prohibido y lo detecta el lint.
- **Nunca `SELECT *`** — enumera las columnas. Una columna nueva no debe cambiar
  el payload de una API existente.
- **Nunca `OFFSET` para paginar.** Cursor sobre Snowflake ID.
- **Toda migración es expand-contract** y compatible con la versión anterior del
  código, de modo que un rollback de código no exija rollback de esquema.
- **`CREATE INDEX CONCURRENTLY`** siempre en tablas con tráfico.
- **Toda columna nueva es nullable o tiene default** — nunca `NOT NULL` sin default
  en una tabla poblada.
- **Toda migración se prueba con el volumen de staging** antes de producción.

```ts
// ✅ Paginación por cursor, columnas explícitas, índice existente
const rows = await db
  .select({ id: posts.id, text: posts.text, authorId: posts.authorId })
  .from(posts)
  .where(and(eq(posts.authorId, authorId), lt(posts.id, cursor)))
  .orderBy(desc(posts.id))
  .limit(limit)
```

---

## 14. Tests

### Reglas

- **Toda PR incluye tests de lo que añade.** Cobertura mínima del repositorio: 80 %,
  y no puede bajar.
- **Un test prueba comportamiento, no implementación.** Si refactorizar sin cambiar
  el comportamiento rompe el test, el test estaba mal.
- **Nombres descriptivos en inglés**, describiendo el caso y el resultado esperado.
- **Sin mocks de la base de datos.** Testcontainers levanta Postgres y Redis reales.
- **Cada test es independiente** — sin orden implícito, sin estado compartido.
- **Todo bug corregido añade un test que falla sin el fix.**

```ts
// ✅
describe('buildTimeline', () => {
  it('merges celebrity posts with the precomputed timeline in id order', async () => { /* … */ })

  it('falls back to database reconstruction when the redis timeline is cold', async () => { /* … */ })

  it('excludes posts from blocked authors', async () => { /* … */ })
})

// ❌ No dice qué se espera
it('works', async () => { /* … */ })
it('test timeline 2', async () => { /* … */ })
```

---

## 15. Git

### Ramas

```
feat/timeline-fanout-threshold
fix/emoji-character-count
chore/upgrade-drizzle
docs/adr-kafka-migration
```

### Commits — Conventional Commits, en inglés

```
feat(timeline): add celebrity fan-out threshold

Accounts above 10k followers now skip write fan-out; their posts are
merged at read time. Write path latency for viral accounts drops from
~40s to under 300ms.

Refs #412
```

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva |
| `fix` | Corrección de bug |
| `refactor` | Cambio interno sin cambio de comportamiento |
| `perf` | Mejora de rendimiento (con medición en el cuerpo) |
| `test` | Sólo tests |
| `docs` | Sólo documentación |
| `chore` | Dependencias, tooling, CI |

**El asunto va en imperativo, en minúscula, sin punto final y con ≤72 caracteres.**
El cuerpo explica el porqué, no el qué.

### Pull requests

- **Una PR, un cambio.** Si el título necesita un "y", son dos PRs.
- Máximo orientativo: **400 líneas de diff**. Por encima, divídela.
- Refactor y cambio funcional **nunca en la misma PR** — hacen la review imposible.
- La descripción explica **qué problema resuelve**, no qué archivos toca.
- CI en verde es requisito, no objetivo.

---

## 16. Seguridad en el código

Reglas no negociables. Cada una tiene su contrapartida en SPECS §11.

- **Ningún secreto en el repositorio.** Ni en tests, ni en fixtures, ni en
  comentarios. `gitleaks` bloquea el push.
- **Toda entrada externa se valida con Zod** antes de tocar el dominio.
- **Toda salida a HTML pasa por React**, nunca por concatenación de strings.
- **Toda URL de usuario se sanea** antes de renderizarse (`javascript:` bloqueado).
- **Toda consulta a base de datos es parametrizada.**
- **Toda ruta comprueba autorización a nivel de recurso.** Nunca se confía en un
  ID del path sin verificar que el viewer puede acceder a él.
- **Todo fetch a una URL de usuario** (previews de enlaces) pasa por el proxy con
  allowlist — protección SSRF.
- **Toda dependencia nueva se justifica en la PR.** Una dependencia es superficie
  de ataque y peso de bundle permanentes.

---

## 17. Checklist production-ready

Ningún código llega a `main` sin cumplir esto. Es la definición de "terminado".

**Corrección**
- [ ] Los casos límite están cubiertos por tests, no sólo el camino feliz
- [ ] Los errores se manejan explícitamente; ningún `catch` vacío
- [ ] Las precondiciones se validan al entrar

**Observabilidad**
- [ ] Los eventos relevantes emiten logs estructurados con contexto
- [ ] Las operaciones que cruzan servicios abren un span
- [ ] Las métricas que permiten alertar existen y tienen nombre estable

**Resiliencia**
- [ ] Toda llamada externa tiene timeout explícito
- [ ] El fallo de una dependencia no crítica degrada, no derriba
- [ ] Las operaciones reintentables son idempotentes

**Rendimiento**
- [ ] Ninguna consulta N+1
- [ ] Toda consulta usa índice (verificado con `EXPLAIN`)
- [ ] Lo cacheable está cacheado con invalidación definida

**Seguridad**
- [ ] La entrada se valida; la autorización se comprueba por recurso
- [ ] No se registran datos sensibles
- [ ] No hay secretos en el código

**Operación**
- [ ] Las migraciones son compatibles hacia atrás
- [ ] El comportamiento arriesgado está detrás de un feature flag
- [ ] El rollback no requiere intervención manual
- [ ] Existe runbook si el cambio puede paginar a alguien

---

## 18. Cómo se aplican estas reglas

Una regla que depende de que alguien se acuerde no es una regla. Casi todo lo
anterior está automatizado:

| Regla | Herramienta | Momento |
|---|---|---|
| Formateo y orden de imports | Biome | Guardado, pre-commit, CI |
| `any`, `!`, promesas flotantes, `console.log` | ESLint | Pre-commit, CI |
| Tipos correctos | `tsc --noEmit` | Pre-commit, CI |
| Dirección de dependencias | `eslint-plugin-boundaries` | CI |
| TODO sin issue | Regla ESLint propia | CI |
| Cobertura ≥ 80 % | Vitest | CI |
| Accesibilidad WCAG 2.2 AA | axe-core | CI |
| Presupuesto de bundle | `size-limit` | CI |
| Secretos | gitleaks | Pre-push, CI |
| Vulnerabilidades | `npm audit`, Semgrep, Trivy | CI |
| Formato de commit | commitlint | Pre-commit |

**Lo que sigue siendo humano** —y por tanto lo único que debería discutirse en una
code review— es: si los nombres dicen la verdad, si los comentarios aportan algo,
si el código es depurable a las 3 de la mañana, y si la solución es la más simple
que resuelve el problema real.

---

## Cambiar estas reglas

Este documento no es intocable, pero tampoco se cambia por preferencia personal.
Para modificar una regla: abre un issue con el caso concreto que la hace fallar,
propón la alternativa, y si se acepta, documéntalo en un ADR y actualiza este
archivo y la herramienta que lo verifica en la misma PR.
