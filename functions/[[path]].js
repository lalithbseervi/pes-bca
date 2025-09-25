export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // PDF Protection Logic
  if (url.pathname.includes('.pdf')) {
    const referer = request.headers.get('referer') || request.headers.get('Referer');
    
    // Check if the request comes from the pdf-viewer page
    if (!referer || !referer.includes('/pdf-viewer/')) {
      // Redirect direct PDF access to home page
      return Response.redirect('https://pes-bca.pages.dev/', 302);
    }
  }
  
  // For all other requests, serve the static content
  return context.env.ASSETS.fetch(request);
}
