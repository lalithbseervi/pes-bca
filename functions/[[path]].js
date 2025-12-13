export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // PDF Protection Logic
  if (url.pathname.includes('.pdf')) {
      // Redirect /static/ URLs to PDF viewer
    if (url.pathname.startsWith('/static/')) {
      const filePath = url.pathname.replace('/static/', '/');
      const pdfUrl = new URL(url.origin + '/pdf-viewer/');
      pdfUrl.searchParams.set('file', filePath);
      const filename = filePath.split('/').pop().replace(/\.[^/.]+$/, '');
      pdfUrl.searchParams.set('title', filename);
      return Response.redirect(pdfUrl.toString(), 302);
    }

    const referer = request.headers.get('referer') || request.headers.get('Referer');
  
    // Temporary debug logging
    console.log('PDF Request:', {
      url: url.pathname,
      referer: referer,
      userAgent: request.headers.get('User-Agent')
    });
    
    const isFromViewer = referer && (
      referer.includes('/pdf-viewer/') || 
      referer.includes('/pdfjs/')
    );
    
    if (!isFromViewer) {
      console.log('Blocking PDF request - invalid referer');
      return Response.redirect('https://pes-bca.pages.dev/', 302);
    }
  }
  
  // Only use ASSETS if available (Cloudflare Pages integration)
  if (context.env && context.env.ASSETS) {
    return context.env.ASSETS.fetch(request);
  }
  
  // Fallback: return 404 if no static assets available
  return new Response('Not Found', { status: 404 });
}