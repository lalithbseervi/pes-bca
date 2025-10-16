import { parseCookies, makeCookie } from "../utils/cookies.js"
import { getCorsHeaders } from "../utils/cors.js"
import { verifyJWT, signJWT } from "../utils/sign_jwt.js"

export async function getSession(request, env) {
  const JSON_HEADERS = { 'Content-Type': 'application/json' }
  const cors = getCorsHeaders(request)

  const cookies = parseCookies(request.headers.get('cookie'))
  const access = cookies['access_token']
  if (access) {
    const v = await verifyJWT(access, env.JWT_SECRET)
    if (v.valid && v.payload?.type === 'access') {
      const exp = v.payload.exp ? new Date(v.payload.exp * 1000).toISOString() : undefined
      return new Response(JSON.stringify({ success: true, session: { srn: v.payload.sub, profile: v.payload.profile, expiresAt: exp } }), { status: 200, headers: { ...JSON_HEADERS, ...cors } })
    }
  }

  // If access missing/expired, try refresh
  const refresh = cookies['refresh_token']
  if (refresh) {
    const vr = await verifyJWT(refresh, env.JWT_SECRET)
    if (vr.valid && vr.payload?.type === 'refresh') {
      const accessTTL = 3 * 24 * 60 * 60
      // Optionally load lightweight profile here if you don't embed it in refresh
      const newAccess = await signJWT({ sub: vr.payload.sub, type: 'access' }, env.JWT_SECRET, accessTTL)
      const headers = new Headers({ ...JSON_HEADERS, ...cors })
      headers.append('Set-Cookie', makeCookie('access_token', newAccess, accessTTL, request))
      return new Response(JSON.stringify({ success: true, session: { srn: vr.payload.sub, expiresAt: new Date(Date.now() + accessTTL * 1000).toISOString() } }), { status: 200, headers })
    }
  }

  return new Response(JSON.stringify({ success: false }), { status: 401, headers: { ...JSON_HEADERS, ...cors } })
}
