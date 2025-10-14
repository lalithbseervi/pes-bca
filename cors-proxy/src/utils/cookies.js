export function parseCookies(header) {
  const cookies = {}
  if (!header) return cookies
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=')
    if (idx < 0) return
    const k = pair.slice(0, idx).trim()
    const v = pair.slice(idx + 1).trim()
    cookies[k] = decodeURIComponent(v || '')
  })
  return cookies
}

export function makeCookieHeader(token, maxAgeSec) {
  return `session_token=${token}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned`
}