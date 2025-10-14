import { getCorsHeaders } from "../utils/cors.js"
import { invalidateCachedAuth } from "../utils/auth-cache.js"

export async function invalidateCache(request, env) {    
    const url = new URL(request.url)
    const JSON_HEADERS = { 'Content-Type': 'application/json' }

    const srn = url.pathname.split('/').pop()
    
    if (!srn) {
      return new Response(JSON.stringify({ success: false, message: 'SRN required' }), { 
        status: 400, 
        headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } 
      })
    }

    await invalidateCachedAuth(env, srn)
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Cached credentials invalidated for ${srn}` 
    }), { 
      status: 200, 
      headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } 
    })
}