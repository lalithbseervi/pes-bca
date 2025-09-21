addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      }
    })
  }

  const url = new URL(request.url)
  // Extract target URL from query parameter
  const targetUrl = url.searchParams.get('url')
  
  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400 })
  }

  // Forward the request to the target URL
  const modifiedRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
  })

  try {
    const response = await fetch(modifiedRequest)
    
    // Create new response with CORS headers
    const modifiedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    })

    return modifiedResponse
  } catch (error) {
    return new Response(`Proxy error: ${error.message}`, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    })
  }
}