import { connect } from 'node:net'

export type ClamAvConfig = {
  host: string
  port: number
}

export type ClamAvScanResult = { infected: false } | { infected: true; signature: string }

// clamd itself has no hard chunk-size ceiling for INSTREAM beyond its own
// configured StreamMaxLength, but writing a 512 MB video as a single Buffer
// chunk still means a single enormous `write()` — breaking it up keeps
// backpressure meaningful instead of one huge in-flight write.
const INSTREAM_CHUNK_SIZE = 4 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 10_000

/**
 * Hand-rolled clamd INSTREAM client, not a third-party npm wrapper — the
 * protocol (documented in clamd's own man page) is small and stable: a
 * `zINSTREAM\0` command, then the payload as one or more 4-byte
 * big-endian-length-prefixed chunks, then a zero-length chunk to signal EOF,
 * then a single-line response (`stream: OK` or `stream: <Signature> FOUND`).
 * One TCP connection per scan — INSTREAM doesn't reliably support
 * pipelining multiple scans over one connection across clamd versions.
 */
export function scanWithClamAv(buffer: Buffer, config: ClamAvConfig): Promise<ClamAvScanResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.host, port: config.port, timeout: CONNECT_TIMEOUT_MS })
    let response = ''
    let settled = false

    function fail(error: Error): void {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }

    socket.on('timeout', () =>
      fail(new Error(`clamd connection to ${config.host}:${config.port} timed out`)),
    )
    socket.on('error', fail)

    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      for (let offset = 0; offset < buffer.length; offset += INSTREAM_CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + INSTREAM_CHUNK_SIZE)
        const lengthPrefix = Buffer.alloc(4)
        lengthPrefix.writeUInt32BE(chunk.length, 0)
        socket.write(lengthPrefix)
        socket.write(chunk)
      }
      socket.write(Buffer.alloc(4)) // zero-length chunk — end of stream.
    })

    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8')
    })

    socket.on('end', () => {
      if (settled) return
      settled = true
      resolve(parseInstreamResponse(response))
    })
  })
}

function parseInstreamResponse(response: string): ClamAvScanResult {
  const body = response
    .replace(/\0+$/, '')
    .trim()
    .replace(/^stream:\s*/, '')
  if (body === 'OK') return { infected: false }
  const found = body.match(/^(.*)\s+FOUND$/)
  return { infected: true, signature: found?.[1] ?? body }
}
