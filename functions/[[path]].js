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
  
  return context.env.ASSETS.fetch(request);
}