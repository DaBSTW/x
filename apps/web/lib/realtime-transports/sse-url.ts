/**
 * Derives the SSE fallback's base URL (ROADMAP.md 2.2) from the same
 * `NEXT_PUBLIC_WS_GATEWAY_URL` the WebSocket transport already uses,
 * instead of requiring a second env var that points at the exact same
 * apps/ws-gateway service and could drift out of sync with the first —
 * both routes (`/v1` and `/v1/sse`) live on one process, one host:port.
 * `ws:`/`wss:` map to `http:`/`https:` (the scheme SSE, a plain HTTP
 * response, actually needs) and `/sse` is appended to whatever path the WS
 * URL used.
 */
export function deriveSseUrl(wsGatewayUrl: string): string {
  const url = new URL(wsGatewayUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/sse`
  return url.toString()
}
