// Detect environment from hostname using a ternary; default to local-friendly when unknown
function isLocalFromRequest(request) {
  try {
    const { hostname, protocol } = new URL(request.url)
    // Treat plain HTTP and localhost/127.0.0.1 as local
    if (protocol === 'http:') return true
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    // If parsing fails (shouldn't in Workers), assume local to avoid Secure in dev
    return true
  }
}

export function makeCookie(name, value, maxAgeSec, request) {
  const isLocal = isLocalFromRequest(request)
  console.log(`isLocal: ${isLocal}`)
  const attrs = [
    `${name}=${value}`,
    `Max-Age=${maxAgeSec}`,
    'Path=/',
    'HttpOnly',
  ]
  if (!isLocal) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned')
  }
  return attrs.join('; ')
}

export function clearCookie(name, request) {
  const isLocal = isLocalFromRequest(request)
  const base = `${name}=; Max-Age=0; Path=/; HttpOnly`
  return isLocal ? base : `${base}; Secure; SameSite=None; Partitioned`
}

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  header.split(';').forEach(kv => {
    const i = kv.indexOf('=')
    if (i > -1) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim())
  })
  return out
}