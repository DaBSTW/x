import { UnauthenticatedError } from '@x/utils'
import {
  type JWTPayload,
  type KeyLike,
  SignJWT,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  errors as joseErrors,
  jwtVerify,
} from 'jose'

export type AccessTokenClaims = {
  sub: string
  sid: string
}

export type TokenService = {
  signAccessToken: (claims: AccessTokenClaims) => Promise<string>
  verifyAccessToken: (token: string) => Promise<AccessTokenClaims>
}

type CreateTokenServiceOptions = {
  privateKeyPem?: string | undefined
  publicKeyPem?: string | undefined
  accessTtlMinutes: number
}

/**
 * Builds the ES256 access-token signer/verifier.
 *
 * With no PEM keys configured, generates an ephemeral in-memory keypair —
 * fine for local development (tokens just stop verifying across restarts),
 * refused outside development by env.ts's schema.
 */
export async function createTokenService(
  options: CreateTokenServiceOptions,
): Promise<TokenService> {
  const { privateKey, publicKey } = await loadOrGenerateKeys(options)

  return {
    async signAccessToken(claims: AccessTokenClaims): Promise<string> {
      return new SignJWT({ sid: claims.sid })
        .setProtectedHeader({ alg: 'ES256' })
        .setSubject(claims.sub)
        .setIssuedAt()
        .setExpirationTime(`${options.accessTtlMinutes}m`)
        .sign(privateKey)
    },

    async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
      try {
        const { payload } = await jwtVerify(token, publicKey)
        return parseClaims(payload)
      } catch (error) {
        if (error instanceof joseErrors.JWTExpired) {
          throw new UnauthenticatedError('access token expired', {}, { cause: error })
        }
        throw new UnauthenticatedError('invalid access token', {}, { cause: error })
      }
    },
  }
}

async function loadOrGenerateKeys(
  options: CreateTokenServiceOptions,
): Promise<{ privateKey: KeyLike; publicKey: KeyLike }> {
  if (options.privateKeyPem && options.publicKeyPem) {
    const [privateKey, publicKey] = await Promise.all([
      importPKCS8(options.privateKeyPem, 'ES256'),
      importSPKI(options.publicKeyPem, 'ES256'),
    ])
    return { privateKey, publicKey }
  }

  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  return { privateKey, publicKey }
}

function parseClaims(payload: JWTPayload): AccessTokenClaims {
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new UnauthenticatedError('access token is missing required claims')
  }
  return { sub: payload.sub, sid: payload.sid }
}
