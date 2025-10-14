export function getCorsHeaders(request) {
  const origin = request.headers.get('Origin')
  const allowedOrigin = origin || 'https://pes-bca.pages.dev'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  }
}