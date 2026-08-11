// Referenced by .env.example — generates the ES256 keypair JWT_ACCESS_*
// expects in staging/production (env.ts requires both outside development).
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
const [privatePem, publicPem] = await Promise.all([exportPKCS8(privateKey), exportSPKI(publicKey)])

console.info('# Paste into .env, or store as secrets in your deploy target.')
console.info(
  '# Real PEM newlines — most .env loaders (incl. Node --env-file) accept a quoted multi-line value as-is.',
)
console.info(`JWT_ACCESS_PRIVATE_KEY="${privatePem.trim()}"`)
console.info(`JWT_ACCESS_PUBLIC_KEY="${publicPem.trim()}"`)
