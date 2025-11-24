export function getCorsHeaders(request) {
  const origin = request.headers.get('Origin')
  const allowedOrigin = origin || 'https://pes-bca.pages.dev'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    // Security headers
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), fullscreen=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    // Expose streaming token & length to clients
    'Access-Control-Expose-Headers': 'X-Stream-Token, Content-Length, Content-Type, ETag'
  }
}