export async function getCacheStats(request, env) {   
  const JSON_HEADERS = { 'Content-Type': 'application/json' }

  // User is authenticated, return stats
  const list = await env.SESSIONS.list({ prefix: 'auth_cache:' })
    
  return new Response(JSON.stringify({ 
    success: true, 
    cached_profiles: list.keys.length,
    sample_keys: list.keys.slice(0, 5).map(k => {
      // Redact password hashes from keys for privacy
      const parts = k.name.split(':')
      return parts.length >= 3 ? `auth_cache:${parts[1]}:***` : k.name
    })
  }), { 
    status: 200, 
    headers: JSON_HEADERS
  })
}