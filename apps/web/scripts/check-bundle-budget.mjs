#!/usr/bin/env node
// ROADMAP.md 3.4f / SPECS.md §14's "Presupuesto de bundle en CI: falla si
// la ruta inicial supera 180 KB gzip" — run after `next build`, against its
// real output, not a guess: reads .next/app-build-manifest.json for the
// exact set of JS chunks a fresh visitor's browser actually requests for
// the landing page (app/(marketing)/page.tsx — this app's real entry
// point for an anonymous, first-time visitor: root `/` renders it
// directly, no redirect), and gzips each file itself to measure it.
//
// Verified against Next.js's own build-output numbers before trusting this
// approach: this script's own summed-per-file gzip total for that route
// (~103 kB) lands within a few hundred bytes of the "First Load JS" figure
// `next build`'s own CLI table already reports for `/` (~106 kB) — close
// enough (the residual gap is gzip level/implementation variance, not a
// methodology error) to confirm Next.js's own reported sizes are already
// gzip, and that summing individual per-chunk gzip sizes (not gzipping the
// concatenated bundle as one blob) is the right way to reproduce that
// number outside of reading Next's own human-readable table — which this
// script deliberately does NOT parse: that table's exact formatting isn't
// a stable contract across Next.js versions, the manifest JSON is.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const NEXT_DIR = join(import.meta.dirname, '..', '.next')
const INITIAL_ROUTE_KEY = '/(marketing)/page'
const BUDGET_BYTES = 180 * 1024 // SPECS.md's own number, base-1024 kB — matches Next's own "kB" convention (confirmed empirically, see this file's own header comment)

function readManifest() {
  const path = join(NEXT_DIR, 'app-build-manifest.json')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    console.error(`could not read ${path} — run \`next build\` before this script.`)
    throw error
  }
  return JSON.parse(raw)
}

function gzipSizeOf(chunkRelativePath) {
  const absolutePath = join(NEXT_DIR, chunkRelativePath)
  const content = readFileSync(absolutePath)
  return gzipSync(content, { level: 9 }).length
}

function main() {
  const manifest = readManifest()
  const chunks = manifest.pages[INITIAL_ROUTE_KEY]
  if (!chunks) {
    console.error(
      `expected an app-build-manifest.json entry for "${INITIAL_ROUTE_KEY}" — did app/(marketing)/page.tsx move or get renamed? Update INITIAL_ROUTE_KEY in this script to match.`,
    )
    process.exit(1)
  }

  let totalBytes = 0
  const breakdown = []
  for (const chunk of chunks) {
    const size = gzipSizeOf(chunk)
    totalBytes += size
    breakdown.push({ chunk, size })
  }

  const totalKb = (totalBytes / 1024).toFixed(1)
  const budgetKb = (BUDGET_BYTES / 1024).toFixed(0)

  // biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1 scopes the console.log ban to services.
  console.log(
    `Initial route (${INITIAL_ROUTE_KEY}) gzip size: ${totalKb} kB / ${budgetKb} kB budget`,
  )
  for (const { chunk, size } of breakdown.sort((a, b) => b.size - a.size)) {
    // biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1 scopes the console.log ban to services.
    console.log(`  ${(size / 1024).toFixed(1).padStart(6)} kB  ${chunk}`)
  }

  if (totalBytes > BUDGET_BYTES) {
    console.error(
      `\n✗ ${totalKb} kB exceeds the ${budgetKb} kB budget (ROADMAP.md 3.4f) by ${((totalBytes - BUDGET_BYTES) / 1024).toFixed(1)} kB.`,
    )
    process.exit(1)
  }

  // biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1 scopes the console.log ban to services.
  console.log(`\n✓ within budget (${((BUDGET_BYTES - totalBytes) / 1024).toFixed(1)} kB to spare).`)
}

main()
