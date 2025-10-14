import { getCorsHeaders } from "../utils/cors"
import { parseCookies } from "../utils/cookies"

export async function logoutHandler(request, env) {    
    const JSON_HEADERS = { 'Content-Type': 'application/json' }

    const cookies = parseCookies(request.headers.get('cookie'))
    const token = cookies['session_token']
    if (token) {
      await env.SESSIONS.delete(token)
    }
    const expiredCookie = 'session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=None; Secure; Partitioned'
    return new Response(JSON.stringify({ success:true }), { 
      status:200, 
      headers: { 
        ...JSON_HEADERS, 
        ...getCorsHeaders(request),
        'Set-Cookie': expiredCookie 
      } 
    })
}