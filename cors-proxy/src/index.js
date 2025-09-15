addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url') // e.g. https://example.com

  if (!targetUrl) {
    return new Response('Missing "url" parameter', { status: 400 })
  }

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body
    })

    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    return new Response(await response.text(), {
      status: response.status,
      headers: headers
    })
  } catch (error) {
    return new Response('Error with the proxy request: ' + error.toString(), { status: 500 })
  }
}
