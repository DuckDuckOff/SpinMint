/**
 * Run once: node scripts/generate-keys.mjs
 * Copy the output into Vercel env vars.
 */
import { generateKeyPairSync, createPublicKey } from 'crypto'

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const jwk = createPublicKey(publicKey).export({ format: 'jwk' })
jwk.kid = 'spinmint-1'
jwk.alg = 'ES256'
jwk.use = 'sig'

console.log('=== JWT_PRIVATE_KEY (add to Vercel env vars) ===')
console.log(privateKey.replace(/\n/g, '\\n'))
console.log()
console.log('=== JWT_PUBLIC_JWK (add to Vercel env vars) ===')
console.log(JSON.stringify(jwk))
