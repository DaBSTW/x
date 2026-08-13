import { createHash } from 'node:crypto'
import { type ClamAvConfig, scanWithClamAv } from './clamav-client.js'

export type ContentScanResult = { clean: true } | { clean: false; reason: string }

export type ContentScanRepository = {
  isKnownBadHash: (sha256: string) => Promise<boolean>
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * SPECS.md §9.2 pipeline step 3: "Escaneo: ClamAV + hash contra base de
 * contenido conocido". Runs for every kind (image/gif/video) — the step is
 * listed as applying to the whole pipeline, not just video, so
 * media.processor.ts calls this before dispatching to any format-specific
 * transcoder. Hash check first (one indexed Postgres lookup, cheaper than a
 * network round trip to clamd) — if either flags the content this is a
 * *definitive* verdict, since the same bytes always hash and scan the same
 * way, which is why the caller marks the job failed outright instead of
 * retrying it. ClamAV being unreachable is a different kind of failure —
 * that's infrastructure, not a verdict about the content — so this lets
 * scanWithClamAv's own rejection propagate uncaught instead of resolving
 * "clean", letting the caller's normal retry-on-throw path apply; treating
 * "the scanner was down" as "the file passed" would be a real security
 * regression, unlike the best-effort posture non-critical infra
 * (ClickHouse/OpenSearch) gets elsewhere in this codebase.
 */
export async function scanContent(
  buffer: Buffer,
  repository: ContentScanRepository,
  clamAv: ClamAvConfig,
): Promise<ContentScanResult> {
  const hash = sha256Hex(buffer)
  if (await repository.isKnownBadHash(hash)) {
    return { clean: false, reason: `matches known-content hash ${hash}` }
  }

  const result = await scanWithClamAv(buffer, clamAv)
  if (result.infected) {
    return { clean: false, reason: `ClamAV: ${result.signature}` }
  }

  return { clean: true }
}
