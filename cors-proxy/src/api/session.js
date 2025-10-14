import { parseCookies } from "../utils/cookies"
import { getCorsHeaders } from "../utils/cors"

export async function getSession(request, env) {
    const JSON_HEADERS = { 'Content-Type': 'application/json' }
    
    const cookies = parseCookies(request.headers.get('cookie'))
    const token = cookies['session_token']

    if (!token) {
      return new Response(JSON.stringify({ success:false }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }

    const stored = await env.SESSIONS.get(token)
    if (!stored) {
      return new Response(JSON.stringify({ success:false }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }

    const session = JSON.parse(stored)
    return new Response(JSON.stringify({ success:true, session }), { status:200, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
}
