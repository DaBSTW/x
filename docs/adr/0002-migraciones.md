# 0002 — Migraciones expand-contract con Drizzle Kit

## Estado

Aceptado

## Contexto

SPECS.md §16.3 y CODESTYLE.md §13 exigen que toda migración sea compatible con
la versión anterior del código desplegado, para que un rollback de código nunca
necesite un rollback de esquema. Drizzle Kit genera SQL a partir de
`packages/db/src/schema/*.ts`, pero no tiene una construcción para
`PARTITION BY`, que `posts` necesita desde el día 1 (SPECS.md §4.2, §14.2).

## Decisión

**Regla expand-contract:**

1. Añadir una columna: siempre `NULL` o con `DEFAULT`, nunca `NOT NULL` a secas
   sobre una tabla poblada. El código viejo debe poder seguir escribiendo.
2. Borrar una columna: dos despliegues. Primero el código deja de leerla/
   escribirla (contract del lado aplicación); sólo en una migración posterior,
   cuando ya no quede código desplegado que la use, se hace el `DROP COLUMN`.
3. Renombrar es siempre "añadir + migrar datos + borrar", nunca `ALTER … RENAME`
   directo sobre una columna en uso.
4. Todo índice nuevo sobre una tabla con tráfico usa `CREATE INDEX CONCURRENTLY`
   fuera de una transacción (Drizzle Kit soporta `--concurrently` en migraciones
   individuales cuando aplica).

**Escape hatch para DDL que Drizzle Kit no expresa:** cuando el esquema
necesita algo fuera del DSL de Drizzle (particionado, funciones, extensiones),
se genera la migración base con `drizzle-kit generate` y se edita a mano el
`.sql` resultante antes de aplicarla — nunca se edita el snapshot JSON. El
primer caso es `posts`: la migración `0000_lethal_morbius.sql` fue editada para:

- Crear la extensión `citext` antes de que se use en `users.email`.
- Convertir `posts` en `PARTITION BY RANGE (created_at)`.
- Definir `ensure_posts_partition(date)`, una función idempotente que sustituye
  a pg_partman hasta que el volumen lo justifique (ROADMAP.md 0.2 lo marca
  ⚪ diferible). La migración la invoca para el mes actual + 3 meses de
  antelación, igual que exige ROADMAP.md 0.3.

`packages/db/src/schema/posts.ts` sigue siendo la fuente de verdad tipada para
consultas — el comentario en el archivo señala dónde vive la DDL real.

## Alternativas descartadas

- **pg_partman desde el día 1**: correcto a largo plazo, pero es una extensión
  adicional que operar (jobs de mantenimiento, permisos) sin que haya todavía
  volumen que lo justifique. `ensure_posts_partition` es el reemplazo mínimo;
  migrar a pg_partman es un ADR futuro cuando el volumen lo pida.
- **UUID en vez de particionado por rango**: no resuelve el problema real
  (tablas de cientos de millones de filas), sólo evita pensarlo ahora.

## Consecuencias

- Un job recurrente (cron/BullMQ) debe llamar a `ensure_posts_partition` con
  3 meses de antelación; si no corre, los `INSERT` fuera de rango fallan con
  "no partition found for row" — una alarma explícita, no datos corruptos.
- Cualquier futura columna en `posts` se añade a `schema/posts.ts` y se genera
  con `pnpm db:generate` normalmente: sólo el particionado inicial necesitó
  edición manual.
