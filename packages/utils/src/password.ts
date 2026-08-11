import { hash, verify } from '@node-rs/argon2'

// m=64MiB, t=3, p=4 — SPECS.md §11.2.
const ARGON2_OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 4 }

/** Hashes a plaintext password with Argon2id at the parameters from SPECS.md §11.2. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

/** Verifies `password` against a hash produced by {@link hashPassword}. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password)
}

/**
 * True when `passwordHash` was produced with different Argon2 parameters than
 * {@link ARGON2_OPTIONS} — the caller should rehash and store the result on
 * the next successful login (CODESTYLE.md §11.2 / SPECS.md §11.2).
 */
export function needsRehash(passwordHash: string): boolean {
  // PHC string format: $argon2id$v=19$m=65536,t=3,p=4$salt$hash
  const params = new Map(
    (passwordHash.split('$')[3] ?? '').split(',').map((pair) => {
      const [key, value] = pair.split('=')
      return [key, Number(value)]
    }),
  )

  return (
    params.get('m') !== ARGON2_OPTIONS.memoryCost ||
    params.get('t') !== ARGON2_OPTIONS.timeCost ||
    params.get('p') !== ARGON2_OPTIONS.parallelism
  )
}
