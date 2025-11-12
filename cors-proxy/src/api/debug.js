import { parseCookies } from '../utils/cookies.js'

export async function handleDebugCookies(request, env) {
  const JSON_HEADERS = { 'Content-Type': 'application/json' }

  try {
    const cookieHeader = request.headers.get('cookie') || ''
    const cookies = parseCookies(cookieHeader)
    const hasAccess = !!cookies['access_token']
    const hasRefresh = !!cookies['refresh_token']

    const body = {
      ok: true,
      cookieHeader: cookieHeader,
      parsedCookies: Object.keys(cookies),
      hasAccessToken: hasAccess,
      hasRefreshToken: hasRefresh,
      note: 'This endpoint is for debugging only. Remove in production.'
    }

    return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: JSON_HEADERS })
  }
}

export default handleDebugCookies
