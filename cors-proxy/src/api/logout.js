import { clearCookie } from "../utils/cookies.js"

export async function logoutHandler(request, env) {    
  const JSON_HEADERS = { 'Content-Type': 'application/json' }
  const headers = new Headers(JSON_HEADERS)
  headers.append('Set-Cookie', clearCookie('access_token', request))
  headers.append('Set-Cookie', clearCookie('refresh_token', request))
  return new Response(JSON.stringify({ success: true }), { status: 200, headers })
}