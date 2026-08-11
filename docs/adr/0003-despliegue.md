# 0003 — Despliegue: Fly.io para staging, Terraform/AWS como base futura

## Estado

Aceptado

## Contexto

ROADMAP.md 0.7 pide despliegue automático a staging, Dockerfiles multi-stage
por app, y una base de Terraform (VPC, RDS, ElastiCache, S3, registro de
contenedores). SPECS.md §2.4 ya señala la tensión: Kubernetes es el objetivo
a escala, pero su coste operativo sin tráfico real es puro lastre — la misma
lógica que llevó a 0001 a elegir monolito modular sobre microservicios desde
el día 1.

## Decisión

**Staging ahora: Fly.io.** `infra/docker/fly.api.toml` y `fly.web.toml` +
`.github/workflows/deploy.yml` despliegan `apps/api` y `apps/web` a Fly en
cada push a `main` que pasa CI. Un job de migraciones corre antes que el
deploy (mismo principio de expand-contract de 0002: si la migración no es
compatible hacia atrás, el deploy no debería necesitar coordinarse con ella).

**Producción futura: Terraform + AWS**, en `infra/terraform/` — VPC de dos
niveles, RDS Postgres 17, ElastiCache Redis 7, S3 para media, ECR por app.
Validado (`terraform validate`, `terraform fmt`) pero **no aplicado**: no
existe todavía una cuenta AWS ni el tráfico que justifique su coste
operativo. Es la base sobre la que migrar cuando Fly.io deje de alcanzar,
no un plan activo.

**Dockerfiles multi-stage**, uno por app, usando `turbo prune --docker` para
que la imagen de `apps/api` no cargue con `apps/web` ni viceversa:

- `apps/web`: Next.js `output: 'standalone'` — webpack ya resuelve y
  transpila los paquetes del workspace (`@x/sdk`, `@x/contracts`) en el
  build, así que la imagen final es un `node server.js` sin más.
- `apps/api`: **no** puede hacer lo mismo. `packages/db`, `packages/utils` y
  `packages/contracts` exportan TypeScript crudo (`"./src/index.ts"` — ver
  CODESTYLE.md §4: el dev loop transpila al vuelo, sin dist que quede
  desactualizado). Sin bundler de por medio, un `node dist/server.js` normal
  no sabe resolver esos imports `.ts`. La imagen de runtime carga el
  servidor compilado a través del hook de `tsx` (`node --import tsx/esm
  dist/server.js`) en vez de `node` a secas — `tsx` pasa a ser una
  dependencia de producción de `apps/api`, no sólo de desarrollo.
- **`pnpm prune --prod` no se usa** en `apps/api/Dockerfile`: verificado que,
  contra un workspace podado con `turbo prune`, borra por completo los
  symlinks de `node_modules` de cada paquete (no sólo las devDependencies) —
  probablemente una interacción rara entre `turbo prune` y `pnpm prune`, no
  documentada. La imagen resultante es más grande de lo ideal; queda como
  mejora futura si el tamaño de imagen se vuelve un problema real.

**Escaneo:** Trivy corre en CI sobre cada imagen construida
(`.github/workflows/ci.yml`, job `docker`), bloqueando en cualquier hallazgo
CRITICAL/HIGH sin parche disponible.

## Alternativas descartadas

- **Kubernetes desde ya**: coste operativo (cluster, ingress, cert-manager,
  autoscaling) sin tráfico que lo justifique — mismo argumento que 0001.
- **Bundlear `apps/api` con esbuild/webpack** para evitar el hack de `tsx`:
  más correcto a largo plazo, pero un cambio de mayor alcance (bundler
  propio para un backend Fastify, no sólo para Next.js) que no se justifica
  en fase 0. Revisar si el arranque con `tsx` demuestra ser un problema de
  rendimiento real.

## Consecuencias

- Un desarrollador que añade una dependencia de producción a `apps/api`
  también debe verificar que sobrevive el filtro `turbo prune @x/api
  --docker` (i.e., que está declarada en `apps/api/package.json`, no sólo
  heredada de otro paquete).
- `FLY_API_TOKEN` y `STAGING_DATABASE_URL` son secretos de repositorio que
  alguien con acceso a Fly.io/RDS debe configurar antes de que
  `deploy.yml` pueda ejecutarse con éxito — hasta entonces, el job falla de
  forma visible en vez de desplegar silenciosamente a ningún sitio.
