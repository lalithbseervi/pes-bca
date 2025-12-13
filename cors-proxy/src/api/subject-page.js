/**
 * Serve dynamic subject pages without Zola/markdown dependency
 * GET /sem-{semester}/{subject}
 */
import { createLogger } from '../utils/logger.js';
import { getAuthenticatedUser } from '../utils/auth-helpers.js';

const log = createLogger('SubjectPage');

export async function serveSubjectPage(request, env, semester, subjectCode) {
    try {
        // Authenticate user
        const auth = await getAuthenticatedUser(request, env);
        
        // Allow unauthenticated access - login modal will handle it
        // But we can check if they're authenticated to customize the experience
        
        log.info('Serving subject page', { semester, subjectCode, authenticated: auth.valid });

        const html = generateSubjectHTML(semester, subjectCode, env);

        return new Response(html, {
            status: 200,
            headers: {
                'Content-Type': 'text/html;charset=UTF-8',
                'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
            }
        });

    } catch (error) {
        log.error('Failed to serve subject page', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

function generateSubjectHTML(semester, subjectCode, env) {
    // Get SW version from env or use timestamp
    const swVersion = env.SW_VERSION || Date.now();
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading... | PES-BCA</title>
    <link rel="stylesheet" href="/main.css?v=${swVersion}">
    <link rel="stylesheet" href="/css/index.css?v=${swVersion}">
    <link rel="stylesheet" href="/css/alerts.css?v=${swVersion}">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#1f2937">
    <style>
        body { margin: 0; background: #111827; color: #f3f4f6; font-family: system-ui, -apple-system, sans-serif; }
        .loading-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
        .spinner { border: 4px solid #374151; border-top: 4px solid #10b981; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .loading-text { margin-top: 1rem; color: #9ca3af; font-size: 1.1rem; }
        
        /* Subject page styles */
        main { max-width: 1200px; margin: 0 auto; padding: 2rem; display: none; }
        .alerts { margin: 1rem 0; }
        .alert { padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid; }
        .alert-info { background: rgba(59, 130, 246, 0.1); border-color: #3b82f6; }
        .search-filters { background: rgba(31, 41, 55, 0.95); border: 1px solid #374151; border-radius: 8px; padding: 1rem; margin: 1.5rem 0; }
        .filter-field input { background: rgba(17, 24, 39, 0.9); border: 1px solid #374151; border-radius: 6px; padding: 0.625rem 0.875rem; color: #f3f4f6; width: 100%; }
        .filter-field input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1); }
        .clear-btn { padding: 0.625rem 1.25rem; border-radius: 6px; border: none; background: #374151; color: #f3f4f6; cursor: pointer; }
        .clear-btn:hover { background: #4b5563; }
        .parent-parent { margin-top: 2rem; }
        .parent { list-style: none; padding: 0; }
        #error { text-align: center; padding: 3rem; color: #ef4444; display: none; }
        #no-results { text-align: center; padding: 3rem; color: #9ca3af; display: none; }
    </style>
</head>
<body>
    <div class="loading-container" id="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">Loading subject page...</div>
    </div>

    <main id="main-content">
        <h1 id="subject-title">Loading...</h1>
        
        <div class="alerts">
            <div class="alert alert-info">
                <strong>Disclaimer:</strong> This site is in no way affiliated to PESU Academy or pes.edu. All content is borrowed from PESU Academy unless explicitly stated.
            </div>
        </div>

        <div class="search-filters">
            <div class="filter-field">
                <input 
                    type="text" 
                    id="search-input" 
                    placeholder="Search by title, link, or file name..."
                >
            </div>
            <button class="clear-btn" onclick="window.clearFilters && window.clearFilters()">Clear</button>
        </div>

        <div id="error">Failed to load resources. Please try again later.</div>
        <div id="no-results">No resources found matching your search.</div>

        <div class="parent-parent" id="content-area" style="display: none;">
            <ul class="parent">
                <li id="subject-content"></li>
            </ul>
        </div>
    </main>

    <script type="module">
        const SUBJECT_CODE = '${subjectCode}';
        const SEMESTER = '${semester}';
        const API_BASE = window.location.origin;

        // Fetch subject metadata
        async function loadSubjectMeta() {
            const res = await fetch(\`\${API_BASE}/api/subjects/\${SUBJECT_CODE}/meta\`);
            if (!res.ok) throw new Error('Failed to load subject metadata');
            return res.json();
        }

        // Initialize page
        async function init() {
            try {
                // Load subject metadata
                const meta = await loadSubjectMeta();
                document.title = \`\${meta.name} | PES-BCA\`;
                document.getElementById('subject-title').textContent = meta.name;

                // Hide loading, show content
                document.getElementById('loading-container').style.display = 'none';
                document.getElementById('main-content').style.display = 'block';

                // Load and initialize subject page module
                const { initSubjectPage } = await import('/js/init/subject.js?v=${swVersion}');
                await initSubjectPage(SUBJECT_CODE, SEMESTER);

            } catch (error) {
                console.error('Failed to initialize subject page:', error);
                document.getElementById('loading-container').innerHTML = 
                    '<div style="color: #ef4444;">Failed to load page. Please try again.</div>';
            }
        }

        init();
    </script>

    <script defer src="/js/openLinkHandler.js?v=${swVersion}"></script>
</body>
</html>`;
}
