export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // PDF Protection Logic
  if (url.pathname.includes('.pdf')) {
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