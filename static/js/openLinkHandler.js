document.addEventListener('click', function(event) {
    const link = event.target.closest('a');
    if (link && link.href.includes('/static/')) {
        event.preventDefault();

        // Session validation (custom logic from subject.html)
        const sessionData = sessionStorage.getItem('user_session');
        if (!sessionData) {
            window.location.href = '/';
            return;
        }
        try {
            const session = JSON.parse(sessionData);
            const now = new Date();
            const expiresAt = new Date(session.expiresAt);
            if (now >= expiresAt) {
                window.location.href = '/';
                return;
            }
        } catch (error) {
            window.location.href = '/';
            return;
        }

        // replace '/static/...' with '/pdf-viewer/?file=/...'
        const url = new URL(link.href);
        const filePath = url.pathname.replace('/static/', '/');
        const pdfUrl = new URL(url.origin + '/pdf-viewer/');
        pdfUrl.searchParams.set('file', filePath);
        pdfUrl.searchParams.set('title', link.innerText);
        window.open(pdfUrl.href, '_blank');
    }
});