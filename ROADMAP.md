# ROADMAP.md — Ruta de trabajo

> Plan de ejecución derivado de [`SPECS.md`](./SPECS.md).
> Cada tarea es una unidad de trabajo con salida verificable.
>
> **Duración estimada:** 18 semanas hasta producto completo (fases 0–3).
> **Equipo asumido:** 3–4 personas (2 backend, 1–2 frontend, infra compartida).

---

## Cómo leer este documento

- `[ ]` tarea pendiente · `[x]` completada
- **🔴 Bloqueante** — nada avanza hasta que esté hecho
- **🟡 Paralelizable** — puede ejecutarse a la vez que otras tareas de su fase
- **⚪ Diferible** — puede moverse a la fase siguiente sin romper nada
- Cada fase cierra con un **criterio de aceptación** binario: se cumple o no se cumple

---

## Índice de fases

| Fase | Nombre | Duración | Resultado |
|---|---|---|---|
| 0 | Cimientos | 2 semanas | Login funcional, CI verde, despliegue automático |
| 1 | MVP funcional | 4 semanas | Publicar, seguir, timeline, interactuar |
| 2 | Producto completo | 6 semanas | Hilos, búsqueda, DMs, tiempo real, multimedia |
| 3 | Escala e inteligencia | 6 semanas | Algoritmo, moderación, analítica, SLOs cumplidos |
| 4 | Extensión | Continuo | Móvil, API pública, monetización |

---

## Fase 0 — Cimientos (semanas 1–2)

> Objetivo: que exista un esqueleto desplegable sobre el que construir sin fricción.
> Todo lo que se salte aquí se paga multiplicado más adelante.

### 0.1 Repositorio y tooling 🔴

- [x] Inicializar monorepo con **pnpm workspaces + Turborepo** (`turbo.json` con pipeline `build → test → lint`)
- [x] Crear estructura de carpetas de la sección 18 de SPECS (`apps/`, `packages/`, `infra/`, `docs/`)
- [x] Configurar **TypeScript** compartido en `packages/config` con `strict: true`, `noUncheckedIndexedAccess`
- [x] Configurar **ESLint + Biome** (formateo) con reglas compartidas; prohibir `any` implícito y `dangerouslySetInnerHTML`
- [x] Añadir **Husky + lint-staged**: typecheck y lint sobre el diff en pre-commit
- [x] Definir **CODEOWNERS** y plantilla de PR
- [x] Escribir el primer **ADR** (`docs/adr/0001-monolito-modular.md`) documentando la decisión de arranque

### 0.2 Entorno local 🔴

- [x] `docker-compose.yml` con PostgreSQL 17, Redis 7, MinIO (S3 local), Mailpit (emails)
- [x] ⚪ Añadir OpenSearch y Kafka al compose (no se usan hasta fase 2 — dejar comentados para no consumir RAM)
- [x] Script `pnpm setup`: instala dependencias, levanta servicios, aplica migraciones, siembra datos
- [x] `.env.example` documentado con **todas** las variables y sus valores por defecto de desarrollo
- [x] Validación de entorno con Zod al arrancar: si falta una variable, el proceso muere con un mensaje claro

### 0.3 Base de datos 🔴

- [x] Configurar **Drizzle ORM** + Drizzle Kit en `packages/db`
- [x] Implementar **generador de Snowflake IDs** en `packages/utils` (worker_id por variable de entorno)
  - [x] Test: 1 M de IDs sin colisión, monótonos crecientes, extracción correcta del timestamp
  - [x] Test: comportamiento ante reloj hacia atrás (esperar, no generar duplicados)
- [x] Migración inicial: `users`, `user_counters`, `follows`, `posts` (particionada), `post_counters`, `post_entities`
- [x] Configurar **pg_partman** o job propio para crear particiones mensuales con 3 meses de antelación
- [x] Seeds: 50 usuarios, 500 posts, grafo social realista para desarrollo
- [x] Documentar la regla de migraciones **expand-contract** en `docs/adr/0002-migraciones.md`

### 0.4 Autenticación 🔴

- [x] `POST /auth/register` — validación Zod, Argon2id, comprobación HIBP por k-anonymity
- [x] `POST /auth/login` — access JWT ES256 (15 min) + refresh opaco en cookie httpOnly
- [x] `POST /auth/refresh` — **con rotación y detección de reuso** (revoca familia completa)
- [x] `POST /auth/logout` y `/auth/logout-all`
- [x] Verificación de email con token de un solo uso (TTL 24 h)
- [x] Middleware de autenticación en Fastify + decorador `request.user`
- [x] Rate limit de login: 10/15 min por IP + backoff exponencial por cuenta
- [x] Tests de integración de **todo el ciclo**: registro → verificación → login → refresh → reuso detectado → logout

### 0.5 Contratos compartidos 🔴

- [x] `packages/contracts`: esquemas Zod de todas las entidades (User, Post, Media…)
- [x] Generación automática de **OpenAPI 3.1** desde los esquemas Fastify
- [ ] `packages/sdk`: cliente tipado generado desde OpenAPI, consumido por web y móvil
- [ ] Test de contrato en CI: si el schema cambia de forma incompatible, el build falla

### 0.6 Frontend base 🟡

- [ ] Next.js 15 con App Router, React 19, TypeScript
- [ ] Tailwind CSS 4 + tokens de diseño (colores, espaciado, tipografía) como CSS variables
- [ ] Tema claro/oscuro con `prefers-color-scheme` + override manual persistido
- [ ] shadcn/ui inicializado con los componentes base (Button, Input, Dialog, Avatar, Toast)
- [ ] TanStack Query configurado con `staleTime: 30s`, retry con backoff
- [ ] Rutas `(marketing)`: landing, `/login`, `/signup` conectadas a la API real
- [ ] Layout `(app)` autenticado con sidebar y protección de ruta
- [ ] Manejo global de errores: `error.tsx`, `not-found.tsx`, toasts para errores de API

### 0.7 CI/CD e infraestructura 🟡

- [ ] GitHub Actions: `quality` (lint + typecheck), `test`, `build`, `security`
- [ ] **Testcontainers** para los tests de integración (Postgres + Redis reales, no mocks)
- [ ] Escaneo de seguridad: `npm audit`, Semgrep, gitleaks, Trivy sobre la imagen
- [ ] Dockerfile multi-stage por app (build → runtime distroless, non-root)
- [ ] Terraform base: VPC, RDS, ElastiCache, S3, registro de contenedores
- [ ] Despliegue automático a **staging** desde `main`
- [ ] Job de migraciones previo al despliegue, con verificación de compatibilidad hacia atrás

### ✅ Criterio de aceptación de la fase 0

> Un usuario nuevo puede registrarse, verificar su email, iniciar sesión y ver una
> pantalla autenticada vacía en el entorno de **staging**, desplegado automáticamente
> desde `main`, con CI verde en lint, typecheck, tests y escaneo de seguridad.

---

## Fase 1 — MVP funcional (semanas 3–6)

> Objetivo: el bucle central del producto funciona extremo a extremo.
> Si esto no engancha, nada de la fase 2 lo arreglará.

### 1.1 Posts — núcleo 🔴

- [ ] `POST /posts` con soporte de `Idempotency-Key` (dedupe en Redis, TTL 24 h)
- [ ] **Parser de entidades** en `packages/utils`: menciones, hashtags, URLs, cashtags
  - [ ] Offsets en **code points**, no bytes ni unidades UTF-16
  - [ ] Test: emoji compuesto (ZWJ), texto RTL, caracteres CJK
- [ ] **Contador de caracteres** con `Intl.Segmenter` (grafemas); URLs cuentan siempre 23
  - [ ] La misma función se usa en cliente y servidor — un solo módulo compartido
- [ ] `GET /posts/:id`, `DELETE /posts/:id` (soft delete)
- [ ] `GET /users/:username/posts` con paginación por cursor
- [ ] Resolución de `conversation_id` (raíz del hilo == su propio id)
- [ ] Validaciones: máx. 10 menciones, máx. 5 hashtags, texto o media obligatorio

### 1.2 Grafo social 🔴

- [ ] `POST/DELETE /users/:id/follow` con actualización de contadores
- [ ] `GET /users/:username/followers` y `/following` paginados
- [ ] Caché en Redis de la lista de seguidos (`SET`, TTL 1 h) para el timeline
- [ ] Validación: no auto-seguirse, no seguir a quien te bloqueó
- [ ] ⚪ `blocks` y `mutes` (tablas + endpoints; la aplicación en filtros va en fase 2)

### 1.3 Timeline cronológico 🔴

> La pieza de mayor riesgo técnico de esta fase. Empezar por aquí.

- [ ] Publicar evento `post.created` en **BullMQ** (Kafka se introduce en fase 3)
- [ ] **Worker de fan-out**:
  - [ ] Lote de 1000 seguidores por pipeline de Redis
  - [ ] `ZADD timeline:{uid}` + `ZREMRANGEBYRANK` (retener 800) + `EXPIRE` 7 días
  - [ ] Idempotencia por `event_id`
- [ ] Umbral de **cuenta grande** (≥10 000 seguidores): marcar y excluir del fan-out
- [ ] `GET /timeline/home`: merge de Redis + posts recientes de cuentas grandes seguidas
- [ ] **Reconstrucción perezosa** del timeline frío desde PostgreSQL
- [ ] **Hidratación en lote**: un solo `WHERE id = ANY($1)` + caché de objeto en Redis
- [ ] Test de carga (k6): 1000 timelines concurrentes, verificar p95 < 200 ms
- [ ] Test: fan-out de cuenta con 100 k seguidores completa en < 5 s

### 1.4 Interacciones 🟡

- [ ] `POST/DELETE /posts/:id/like` — contador en Redis primero
- [ ] `POST/DELETE /posts/:id/repost` — crea post de tipo `repost`, entra en el fan-out
- [ ] `POST/DELETE /posts/:id/bookmark`
- [ ] **Worker de agregación de contadores**: lote cada 5 s agrupado por `post_id`
- [ ] Job nocturno de **reconciliación** de contadores desde las tablas fuente
- [ ] Test de concurrencia: 100 likes simultáneos → contador exacto al final

### 1.5 Multimedia — imágenes 🟡

- [ ] `POST /media/upload-url` → URL prefirmada de S3/MinIO + `media_id`
- [ ] `POST /media/:id/finalize` → valida y encola procesamiento
- [ ] **Validación por magic bytes**, nunca por `Content-Type` del cliente
- [ ] Protección contra bomba de descompresión (límite de píxeles totales)
- [ ] **Strip completo de EXIF** (crítico: elimina geolocalización), aplicando orientación al píxel
- [ ] Worker con `sharp`: variantes WebP + AVIF en 4 anchos (340/600/1200/orig)
- [ ] Generación de **blurhash** para placeholder
- [ ] Adjuntar hasta 4 imágenes a un post; `alt_text` editable
- [ ] Límite: 5 MB, 8192×8192 máx.

### 1.6 Perfiles 🟡

- [ ] `GET /users/:username` — perfil público
- [ ] `PATCH /users/me` — display name, bio, ubicación, web, avatar, banner
- [ ] Página de perfil con **SSR** (React Server Component) para SEO
- [ ] Metadatos Open Graph y Twitter Card por perfil y por post
- [ ] Pestañas: Posts / Respuestas / Media / Me gusta

### 1.7 Notificaciones básicas 🟡

- [ ] Tabla `notifications` + worker que consume eventos de interacción
- [ ] Agrupación por `group_key` en ventana de 1 h
- [ ] `GET /notifications` paginado + `GET /notifications/unread-count` (Redis)
- [ ] `POST /notifications/read` hasta un cursor
- [ ] Filtrado por bloqueos/silencios y preferencias del receptor
- [ ] Polling cada 60 s en el cliente (WebSocket llega en fase 2)

### 1.8 Frontend del MVP 🟡

- [ ] `<Composer>`: texto, contador visual, adjuntar imágenes, preview, envío
- [ ] `<PostCard>`: autor, texto con entidades enlazadas, media, acciones, timestamp relativo
- [ ] `<RichText>`: renderizado por offsets de `entities` — **nunca** HTML crudo
- [ ] `<Timeline>`: `useInfiniteQuery` + `useVirtualizer`, altura estable (sin CLS)
- [ ] `<MediaGrid>`: layouts para 1, 2, 3 y 4 imágenes con `aspect-ratio`
- [ ] **Actualizaciones optimistas** en like, repost y bookmark con rollback ante error
- [ ] Skeletons de carga en timeline, perfil y notificaciones
- [ ] Estados vacíos con acción sugerida (timeline sin seguidos → sugerencias)

### ✅ Criterio de aceptación de la fase 1

> Dos usuarios pueden seguirse, publicar un post con imagen y alt-text, dar like y
> repostear, y ver el resultado en su timeline en menos de 5 segundos. El p95 de
> lectura de timeline es < 200 ms con 1000 usuarios concurrentes en staging.

---

## Fase 2 — Producto completo (semanas 7–12)

> Objetivo: paridad funcional con el producto de referencia.

### 2.1 Conversaciones e hilos 🔴

- [ ] `POST /posts` con `in_reply_to_id` — herencia de `conversation_id`
- [ ] `GET /posts/:id/thread` — ancestros (recursivo hacia arriba) + descendientes
- [ ] `GET /posts/:id/replies` ordenadas por relevancia (autor del hilo primero, luego engagement)
- [ ] **Citas**: `quoted_post_id` + render embebido del post citado
- [ ] `POST /posts/batch` — hilo completo en una transacción
- [ ] `reply_policy`: todos / sólo seguidos / sólo mencionados — aplicado en el servidor
- [ ] `<ThreadView>` con líneas de conexión visuales y carga progresiva
- [ ] Test: borrar un post con 50 000 respuestas no deja huérfanos ni contadores inconsistentes

### 2.2 Tiempo real 🔴

- [ ] Servicio `ws-gateway` independiente
- [ ] `POST /realtime/ticket` — ticket de un solo uso, TTL 60 s (el JWT **nunca** en la query string)
- [ ] Suscripción por canales: `user:{id}`, `conv:{id}`, `post:{id}`, `timeline:{id}`
- [ ] Redis Pub/Sub para fan-out entre instancias del gateway
- [ ] Heartbeat 30 s / timeout 60 s
- [ ] Reconexión con backoff exponencial + jitter (1 s → 30 s)
- [ ] **Recuperación de eventos perdidos** vía Redis Streams (`last_event_id`, retención 5 min)
- [ ] Backpressure: cerrar conexión si la cola de escritura supera 1 MB
- [ ] Fallback a SSE y, en último caso, polling adaptativo
- [ ] Badge "N posts nuevos" en el timeline vía canal `timeline:{id}`
- [ ] Test: reconexión recuperando 500 eventos sin duplicados ni huecos

### 2.3 Búsqueda 🟡

- [ ] Levantar OpenSearch; índices `posts` y `users` con los mappings de SPECS §10.1
- [ ] **CDC con Debezium** → Kafka → indexer (bulk cada 500 docs o 1 s)
- [ ] `GET /search` con modos `top` / `latest` / `people` / `media`
- [ ] `function_score` para `top`: BM25 + engagement + decaimiento gaussiano 7 d + afinidad social
- [ ] Parser de **operadores**: `from:`, `to:`, `#`, `@`, `"frase"`, `-excluir`, `filter:`, `min_faves:`, `since:`, `until:`, `lang:`
- [ ] `GET /search/typeahead` con `edge_ngram` para usuarios y hashtags
- [ ] Reindexado blue-green mediante alias
- [ ] Verificar latencia de indexación < 3 s desde la publicación

### 2.4 Tendencias 🟡

- [ ] Ingesta de eventos a ClickHouse (impresiones, interacciones)
- [ ] Job cada 5 min: `score = (count_1h / baseline_hourly) · log(1 + autores_únicos)`
- [ ] Filtros antispam: mínimo 50 autores únicos, ratio autores/posts ≥ 0.3, lista negra
- [ ] Segmentación por región (WOEID) e idioma
- [ ] `GET /trends` + página `/explore`

### 2.5 Mensajes directos 🟡

- [ ] Tablas `conversations`, `conversation_members`, `messages`
- [ ] `POST /conversations` (1:1 y grupo), `GET /conversations`
- [ ] `GET/POST /conversations/:id/messages` con paginación por cursor
- [ ] Recibos de lectura (`last_read_id`) e indicador de escritura vía WS
- [ ] Ajustes de privacidad: quién puede escribirme (todos / sólo seguidos)
- [ ] Rate limit de mensajes: 500/24 h
- [ ] UI de mensajería con lista de conversaciones y vista de chat

### 2.6 Privacidad y seguridad del usuario 🟡

- [ ] **Cuentas protegidas**: `follow_requests` + aceptar/rechazar + posts ocultos a no seguidores
- [ ] Aplicación real de **bloqueos** en todas las lecturas (timeline, búsqueda, perfil, notificaciones, hilos)
- [ ] **Silencios** y `muted_keywords` aplicados en timelines y notificaciones
- [ ] **2FA TOTP**: setup con QR, verificación, códigos de recuperación de un solo uso
- [ ] `GET /auth/sessions` + revocación individual de sesiones
- [ ] Test crítico: bloqueo mutuo — ninguno de los dos ve al otro en **ningún** contexto

### 2.7 Vídeo y GIF 🟡

- [ ] Worker `ffmpeg` aislado con límites de CPU/memoria y timeout de 10 min
- [ ] GIF → MP4 (H.264) con loop + poster WebP
- [ ] Vídeo → **HLS multi-bitrate** (240p–1080p), H.264 + AAC
- [ ] Límites: 512 MB, 140 s (2 h para cuentas verificadas)
- [ ] Reproductor con carga diferida (`dynamic()`), respetando `prefers-reduced-motion`
- [ ] ClamAV + hash contra base de contenido conocido en el pipeline

### 2.8 Listas y guardados 🟡

- [ ] CRUD de `lists` (públicas y privadas) + `list_members`
- [ ] `GET /timeline/list/:id`
- [ ] `GET /timeline/bookmarks`

### 2.9 Notificaciones push 🟡

- [ ] Web Push (VAPID) con Service Worker
- [ ] FCM (Android) y APNs (iOS) — preparado aunque la app móvil llegue en fase 4
- [ ] Emails transaccionales con React Email + Resend/SES
- [ ] Preferencias granulares por tipo × canal
- [ ] Emails de seguridad **no desactivables** (nuevo dispositivo, cambio de contraseña)

### 2.10 Accesibilidad e i18n 🟡

- [ ] Atajos de teclado completos (`j`/`k`/`l`/`r`/`t`/`n`/`/`/`?`)
- [ ] Timeline con rol `feed` + `aria-posinset` / `aria-setsize`
- [ ] `aria-live="polite"` en nuevos posts y notificaciones
- [ ] **axe-core en CI**: cualquier violación WCAG 2.2 AA bloquea el merge
- [ ] `next-intl` con catálogos ICU; español e inglés al lanzamiento
- [ ] Soporte RTL con propiedades lógicas de CSS
- [ ] Auditoría de contraste 4.5:1 en ambos temas

### ✅ Criterio de aceptación de la fase 2

> Un usuario puede buscar contenido con operadores avanzados, participar en un hilo,
> enviar un DM con confirmación de lectura en tiempo real, subir un vídeo, proteger su
> cuenta y bloquear a alguien con efecto inmediato y total. La auditoría de
> accesibilidad pasa sin violaciones y la app está traducida a dos idiomas.

---

## Fase 3 — Escala e inteligencia (semanas 13–18)

> Objetivo: cumplir los SLOs de SPECS §1.4 bajo carga real y automatizar la moderación.

### 3.1 Migración a Kafka 🔴

- [ ] Sustituir BullMQ por Kafka en los flujos de alto volumen (`post.created`, `interaction.*`)
- [ ] Topics con particionado por `user_id` para preservar el orden por usuario
- [ ] Consumer groups con idempotencia y **dead letter queue**
- [ ] Monitorización de lag de consumidores con alerta a > 60 s
- [ ] Mantener BullMQ para jobs de baja frecuencia (emails, exportaciones)

### 3.2 Timeline algorítmico 🔴

- [ ] **Etapa 1 — Candidate generation** (~1500 candidatos, 50 ms)
  - [ ] In-network 50 % — posts de seguidos en 48 h
  - [ ] Out-of-network por grafo 25 % — engagement de tus seguidos (2.º grado)
  - [ ] Out-of-network por embeddings 15 % — pgvector o Qdrant
  - [ ] Tendencias y temas 10 %
- [ ] **Etapa 2 — Ranking** (30 ms): LightGBM servido vía ONNX Runtime
  - [ ] Pipeline de features: post, autor, relación, espectador
  - [ ] Entrenamiento offline con datos de ClickHouse; reentrenamiento semanal
- [ ] **Etapa 3 — Heurísticas** (10 ms)
  - [ ] Máx. 2 posts consecutivos del mismo autor
  - [ ] Dedupe de contenido por SimHash
  - [ ] Dedupe de vistas con Bloom filter por usuario en Redis (10 k entradas, FP < 1 %)
  - [ ] Inyección de contexto social ≤ 15 %
- [ ] **Degradación obligatoria**: > 100 ms o error → timeline cronológico, nunca un 5xx
- [ ] A/B testing con métricas de engagement antes de activarlo por defecto

> ⚠️ **No adelantar esta sección.** Sin datos de entrenamiento suficientes, el
> ranking produce un feed peor que el cronológico. Requiere ≥ 4 semanas de datos
> de interacción reales en ClickHouse.

### 3.3 Moderación 🔴

- [ ] **Capa preventiva** (< 100 ms, síncrona): listas de bloqueo, Safe Browsing, límites de menciones
- [ ] **Capa automática** (asíncrona): clasificadores de toxicidad, spam y NSFW
  - [ ] `> 0.95` → acción automática · `0.70–0.95` → cola humana · `< 0.70` → sólo log
- [ ] **Capa reactiva**: `POST /reports` + priorización por reputación, alcance y gravedad
- [ ] Acciones graduadas: etiqueta → reducción de alcance → ocultación → eliminación → modo lectura → suspensión → baneo
- [ ] Registro inmutable en `moderation_actions` con motivo y política aplicada
- [ ] **Flujo de apelación** con notificación al usuario incluyendo el fragmento infractor
- [ ] Panel `apps/admin`: cola de revisión, historial de acciones, búsqueda de cuentas
- [ ] Antispam: score de confianza por cuenta, límites para cuentas nuevas (10 posts/día, sin enlaces 24 h)
- [ ] Detección de coordinación: clustering por SimHash, timing y huella de red

### 3.4 Rendimiento 🟡

- [ ] Réplicas de lectura + enrutamiento; **read-your-writes** durante 5 s tras escribir
- [ ] PgBouncer en modo `transaction`
- [ ] Anti-estampida: locks de reconstrucción (`SET NX PX 5000`) y jitter ±10 % en TTLs
- [ ] Caché negativa (60 s) para IDs inexistentes
- [ ] Auditoría de queries: cualquier consulta > 100 ms se indexa o se reescribe
- [ ] Presupuesto de bundle en CI: falla si la ruta inicial supera 180 KB gzip
- [ ] Core Web Vitals reales (RUM): LCP < 2.5 s, INP < 200 ms, CLS < 0.1
- [ ] Campaña de carga con k6: 50 k QPS de timeline, 5 k posts/s

### 3.5 Resiliencia 🟡

- [ ] Circuit breakers entre servicios (5 fallos / 10 s → abierto 30 s)
- [ ] **Timeouts explícitos en todo**: BD 2 s, Redis 200 ms, interno 1 s, externo 5 s
- [ ] Bulkheads: pools separados por criticidad
- [ ] Load shedding por prioridad ante saturación
- [ ] Rutas de degradación verificadas: sin ranking, sin búsqueda, sin media, sin WS
- [ ] **Game day**: simular caída de Redis, de una réplica y del servicio de búsqueda

### 3.6 Observabilidad 🟡

- [ ] OpenTelemetry extremo a extremo, con `trace_id` propagado por HTTP, Kafka y jobs
- [ ] Muestreo: 100 % de errores y peticiones > 1 s, 1 % del resto
- [ ] Dashboards RED por servicio + métricas de negocio (posts/min, DAU, engagement)
- [ ] Logs JSON con **redacción automática** de tokens, emails y contenido de DMs
- [ ] Alertas basadas en SLO con burn rate (14.4× en 1 h → página)
- [ ] Runbooks en `docs/runbooks/` para cada alerta que pagina

### 3.7 Cumplimiento 🟡

- [ ] `GET /users/me/export` — ZIP generado asíncronamente y notificado por email
- [ ] Borrado de cuenta con periodo de gracia de 30 días + purga física posterior
- [ ] Registro de consentimiento y política de retención automatizada
- [ ] Verificación de edad (13+) y restricciones para cuentas de menores
- [ ] Backups: PITR con RPO 5 min / RTO 1 h
- [ ] **Restauración de backup probada mensualmente** en entorno aislado

### ✅ Criterio de aceptación de la fase 3

> El sistema sostiene 50 000 QPS de lectura de timeline con p95 < 200 ms, degrada
> correctamente ante la caída de Redis, OpenSearch o el servicio de ranking, y la
> moderación automática procesa contenido con revisión humana sólo en la banda de
> incertidumbre. Un backup restaurado desde cero pasa la suite de tests.

---

## Fase 4 — Extensión (continuo)

- [ ] **App móvil** React Native (Expo) reutilizando `packages/contracts` y `packages/sdk`
- [ ] **API pública** con OAuth 2.0 para terceros, scopes granulares y cuotas por app
- [ ] Espacios de audio en directo (WebRTC + SFU)
- [ ] Monetización: suscripciones, verificación de pago, herramientas para creadores
- [ ] Sharding de PostgreSQL con Citus (activar a partir de ~50 M usuarios)
- [ ] Migración de `fanout` y `ws-gateway` a Go (activar a partir de ~100 k conexiones)
- [ ] Analítica para autores: alcance, impresiones, demografía

---

## Dependencias críticas

```
0.1 Monorepo ──▶ 0.2 Entorno ──▶ 0.3 BD ──▶ 0.4 Auth ──▶ 1.1 Posts ──▶ 1.3 Timeline
                                     │                        │
                                     └──▶ 0.5 Contratos ──────┴──▶ 0.6 Frontend

1.3 Timeline ──▶ 2.1 Hilos ──▶ 3.2 Algoritmo
     │                              ▲
     └──▶ 2.2 Tiempo real           │
                                    │
2.4 ClickHouse ──▶ 4 semanas de datos
```

**Camino crítico:** `0.3 → 0.4 → 1.1 → 1.3 → 2.1 → 3.2`.
Todo lo demás puede paralelizarse alrededor de él.

---

## Reglas de trabajo permanentes

Aplican en **todas** las fases, no son tareas de una fase concreta:

- Ninguna PR entra sin tests de lo que añade — la cobertura no baja del 80 %
- Toda migración es compatible con la versión anterior del código (expand-contract)
- Todo endpoint nuevo se añade a `packages/contracts` **antes** de implementarse
- Toda decisión arquitectónica no trivial genera un ADR en `docs/adr/`
- Toda alerta que pagina tiene su runbook antes de activarse
- Ningún secreto en el repositorio — gitleaks bloquea el push
- Las escrituras que el usuario percibe como instantáneas se hacen optimistas en el cliente

---

## Señales de que hay que replanificar

| Señal | Acción |
|---|---|
| El fan-out no cumple p99 < 5 s con la carga real | Adelantar la extracción del servicio a Go (fase 4 → fase 3) |
| PostgreSQL supera el 70 % de CPU sostenido | Adelantar réplicas de lectura y evaluar sharding |
| Redis supera el 70 % de memoria | Reducir retención de timeline de 800 a 400 entradas antes de escalar el cluster |
| El spam supera el 5 % del contenido publicado | Adelantar la capa de moderación automática a la fase 2 |
| El ranking algorítmico no supera al cronológico en A/B | Mantener cronológico por defecto; no forzar el lanzamiento |
| El bundle inicial supera 180 KB gzip | Parar features de frontend hasta reducirlo |
