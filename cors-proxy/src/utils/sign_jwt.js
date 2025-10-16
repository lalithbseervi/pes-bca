// ...existing code...
const te = new TextEncoder()
const td = new TextDecoder()

function b64urlEncode(buf) {
  const bin = Array.isArray(buf) ? new Uint8Array(buf) : new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bin.length; i++) str += String.fromCharCode(bin[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = 4 - (str.length % 4 || 4)
  const s = atob(str + '='.repeat(pad))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function importKey(secret) {
  return crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signJWT(payload, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000)
  const claims = { iat: now, exp: now + ttlSec, ...payload }
  const header = { alg: 'HS256', typ: 'JWT' }

  const encHeader = b64urlEncode(te.encode(JSON.stringify(header)))
  const encPayload = b64urlEncode(te.encode(JSON.stringify(claims)))
  const signingInput = `${encHeader}.${encPayload}`

  const key = await importKey(secret)
  const sigBuf = await crypto.subtle.sign('HMAC', key, te.encode(signingInput))
  const signature = b64urlEncode(new Uint8Array(sigBuf))
  return `${signingInput}.${signature}`
}

export async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.')
    if (!h || !p || !s) return { valid: false, reason: 'format' }
    const key = await importKey(secret)
    const signingInput = `${h}.${p}`
    const sigOk = await crypto.subtle.verify('HMAC', key, b64urlDecode(s), te.encode(signingInput))
    if (!sigOk) return { valid: false, reason: 'sig' }
    const payload = JSON.parse(td.decode(b64urlDecode(p)))
    const now = Math.floor(Date.now() / 1000)
    if (payload.nbf && now < payload.nbf) return { valid: false, reason: 'nbf', payload }
    if (payload.exp && now >= payload.exp) return { valid: false, reason: 'exp', payload, expired: true }
    return { valid: true, payload }
  } catch (e) {
    return { valid: false, reason: 'error' }
  }
}