// Referenced by .env.example — generates the VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
// pair Web Push (ROADMAP.md 2.9) needs. Both apps/api (serves the public
// half to browsers) and apps/workers (signs outgoing pushes with both) must
// be configured with the *same* pair, generated once here.
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.info('# Paste into .env for both apps/api and apps/workers, or store as deploy secrets.')
console.info(`VAPID_PUBLIC_KEY="${publicKey}"`)
console.info(`VAPID_PRIVATE_KEY="${privateKey}"`)
