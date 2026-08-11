# 0001 — Arrancar como monolito modular

## Estado

Aceptado

## Contexto

SPECS.md §3.3 exige decidir cómo se despliega el sistema al inicio del proyecto:
como un conjunto de microservicios independientes desde el día 1, o como un único
despliegue con límites de módulo internos. El equipo asumido es de 3-4 personas
(ROADMAP.md) y no hay tráfico de producción todavía.

## Decisión

Arrancamos con un único servicio Fastify (`apps/api`) con módulos delimitados por
feature (`auth`, `users`, `posts`, `social-graph`, `timeline`, …), cada uno
siguiendo la separación `routes → service → repository` de CODESTYLE.md §7.
`ws-gateway`, `fanout` y `media` viven en procesos separados desde el principio
porque su perfil de carga (conexiones persistentes, trabajo en lote) es distinto
al de una API request/response.

## Alternativas descartadas

- **Microservicios completos desde el día 1**: el coste operativo (N despliegues,
  N pipelines de CI, tracing distribuido, descubrimiento de servicios) no se
  justifica sin tráfico real que lo exija. Ralentiza cada cambio que cruza un
  límite de servicio, que al principio es casi todos.
- **Monolito sin límites internos**: más rápido al principio, pero hace que
  extraer un servicio más adelante (cuando una métrica lo justifique) sea una
  reescritura en vez de un `apps/` nuevo que importa el mismo `packages/*`.

## Consecuencias

- La regla de dependencias de CODESTYLE.md §7 (`apps/* → packages/*`, nunca al
  revés) es lo que permite extraer un módulo a su propio `apps/*` sin tocar su
  lógica interna — sólo el transporte.
- `eslint-plugin-boundaries` hace cumplir esa regla en CI; una violación rompe
  el build en vez de detectarse en review.
- Los primeros candidatos a extracción son los que ya viven separados:
  `fanout` (throughput de escritura) y `ws-gateway` (conexiones persistentes),
  documentado en SPECS.md §2.2.
