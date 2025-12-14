/**
 * Serve dynamic subject pages without Zola/markdown dependency
 * GET /sem-{semester}/{subject}
 */
import { createLogger } from '../utils/logger.js';
import { getAuthenticatedUser } from '../utils/auth-helpers.js';

const log = createLogger('SubjectPage');

export async function  serveSubjectPage(request, env, semester, subjectCode) {
    try {
        // Authenticate user
        const auth = await getAuthenticatedUser(request, env);
        
        // Allow unauthenticated access - login modal will handle it
        // But we can check if they're authenticated to customize the experience
        
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
    // Get SW version from environment or use timestamp as fallback
    const swVersion = env.SW_VERSION || Date.now().toString();
    
    return `<!DOCTYPE html>
<html lang="en" class="dark light">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="base" content="/">
    <meta name="asset-version" content="${swVersion}">
    <meta name="theme-color" content="#4a90e2">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="PESU BCA">
    <meta name="mobile-web-app-capable" content="yes">

    <title>${subjectCode} | PES-BCA</title>
    
    <!-- Manifest & Icons -->
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
    <link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">
    <meta name="msapplication-TileColor" content="#4a90e2">
    
    <!-- Analytics -->
    <link rel="preconnect" href="https://us.i.posthog.com" crossorigin>
    <script defer src="/js/analytics-preferences.js?v=${swVersion}"></script>
    
    <!-- Fonts -->
    <link href="/fonts.css" rel="stylesheet">
    
    <!-- Syntax Theme -->
    <link rel="stylesheet" type="text/css" href="/syntax-theme-dark.css" media="(prefers-color-scheme: dark)">
    <link rel="stylesheet" type="text/css" href="/syntax-theme-light.css" media="(prefers-color-scheme: light)">
    
    <!-- Theme Toggle Script -->
    <script src="/js/themetoggle.js?v=${swVersion}"></script>
    <script>setTheme(getSavedTheme());</script>
    
    <!-- Theme CSS -->
    <link rel="stylesheet" type="text/css" href="/theme/light.css">
    <link id="darkModeStyle" rel="stylesheet" type="text/css" href="/theme/dark.css">
    
    <!-- Main Stylesheet (preload for performance) -->
    <link rel="preload" href="/main.css" as="style" onload="this.rel='stylesheet'">
    <noscript>
        <link rel="stylesheet" href="/main.css">
    </noscript>
    
    <!-- Subject-specific styles -->
    <link rel="stylesheet" href="/css/index.css?v=${swVersion}">
    <link rel="stylesheet" href="/css/alerts.css?v=${swVersion}">
    
    <!-- System Notifications & Auth -->
    <script type="module" src="/js/system-notifications.js?v=${swVersion}"></script>
    <script type="module" src="/js/auth.js?v=${swVersion}"></script>
    
    <style>
        /* Loading spinner - only custom override needed */
        .loading-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
        .spinner { border: 4px solid #374151; border-top: 4px solid #10b981; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .loading-text { margin-top: 1rem; color: #9ca3af; font-size: 1.1rem; }
        
        /* Search filters styling from subject.html */
        .search-filters {
            background: rgba(31, 41, 55, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid #374151;
            border-radius: 8px;
            padding: 1rem;
            margin: 1.5rem 0;
        }
        
        .filter-row {
            display: flex;
            gap: 1.5rem;
            align-items: end;
        }
        
        .filter-field {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .filter-field label {
            color: #9ca3af;
            font-size: 0.875rem;
            font-weight: 500;
        }
        
        .filter-field input {
            background: rgba(17, 24, 39, 0.9);
            border: 1px solid #374151;
            border-radius: 6px;
            padding: 0.625rem 0.875rem;
            color: #f3f4f6;
            font-size: 0.95rem;
            transition: border-color 0.3s ease, box-shadow 0.2s ease, background 0.2s ease;
        }

        .filter-field input:focus {
            outline: none;
            border-color: #10b981;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
        }
        
        .filter-field input::placeholder {
            color: #6b7280;
        }
        
        .filter-btn, .clear-btn {
            padding: 0.625rem 1.25rem;
            border-radius: 6px;
            border: none;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.95rem;
        }
        
        .filter-btn {
            background: #10b981;
            color: white;
        }
        
        .filter-btn:hover {
            background: #059669;
        }
        
        .clear-btn {
            background: #374151;
            color: #f3f4f6;
        }
        
        .clear-btn:hover {
            background: #4b5563;
        }
        
        .no-results {
            display: none;
            text-align: center;
            padding: 3rem;
            color: #9ca3af;
            font-size: 1.1rem;
        }
        
        .loading {
            text-align: center;
            padding: 3rem;
            color: #9ca3af;
            font-size: 1.1rem;
        }
        
        .error {
            text-align: center;
            padding: 3rem;
            color: #ef4444;
            font-size: 1.1rem;
        }
    </style>
</head>
<body>
    <div class="left-content"></div>
    <div class="content">
        <nav>
            <div class="left-nav">
                <a href="/">BCA | Study Materials</a>
                <div class="socials">
                    <a rel="me" href="https://github.com/" class="social">
                        <img alt="github" src="/icons/social/github.svg">
                    </a>
                </div>
            </div>
            <button class="menu-toggle" aria-label="Toggle menu" id="menu-toggle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="24" height="24">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            </button>
            <div class="right-nav" id="right-nav">
                <a class="nav-link" data-path="/" href="/">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                    </svg>
                    <span>Home</span>
                </a>
                <a class="nav-link" data-path="/posts" href="/posts">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" x2="8" y1="13" y2="13"></line>
                        <line x1="16" x2="8" y1="17" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <span>Posts</span>
                </a>
                <a class="nav-link" data-path="/download" href="/download">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" x2="12" y1="15" y2="3"></line>
                    </svg>
                    <span>Download PDFs</span>
                </a>
                <a class="nav-link" data-path="/upload" href="/upload">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" x2="12" y1="3" y2="15"></line>
                    </svg>
                    <span>Upload PDFs</span>
                </a>
                <a class="nav-link" data-path="/status" href="/status">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                    </svg>
                    <span>Status</span>
                </a>
                <a class="nav-link" data-path="/contribute" href="/contribute">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                    </svg>
                    <span>Feedback</span>
                </a>
                <a class="nav-link" data-path="/terms-of-service" href="/terms-of-service">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" x2="8" y1="13" y2="13"></line>
                        <line x1="16" x2="8" y1="17" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <span>Terms of Use</span>
                </a>
                <a class="nav-link" data-path="/privacy-policy" href="/privacy-policy">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                    <span>Privacy Policy</span>
                </a>
                <button class="nav-link" id="privacy-settings-button" style="cursor:pointer;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" width="16" height="16">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <span>Privacy Settings</span>
                </button>
            </div>
        </nav>

        <div class="loading-container" id="loading-container">
            <div class="spinner"></div>
            <div class="loading-text">Loading subject page...</div>
        </div>

        <main id="main-content" style="display: none;">
            <article>
                <section class="body">
                    <br>
                    <div class="alerts">
                        <div class="alert alert-info">
                            <div class="alert-type">
                                <strong>Disclaimer</strong>
                            </div>
                            <div class="alert-content">
                                This site is in no way affiliated to PESU Academy or pes.edu. All content is borrowed from PESU Academy unless explicitly stated.
                            </div>
                        </div>
                    </div>

                    <!-- Search and Filter Section -->
                    <div class="search-filters">
                        <div class="filter-row">
                            <div class="filter-field">
                                <input 
                                    type="text" 
                                    id="search-input" 
                                    placeholder="Search by title, link, or file name..."
                                >
                            </div>
                            <button class="clear-btn" onclick="window.clearFilters && window.clearFilters()">Clear</button>
                        </div>
                    </div>

                    <div id="loading" class="loading">
                        Loading resources...
                    </div>

                    <div id="error" class="error" style="display: none;">
                        Failed to load resources. Please try again later.
                    </div>

                    <div id="no-results" class="no-results">
                        No resources found matching your search.
                    </div>

                    <div class="parent-parent" id="content-area" style="display: none;">
                        <ul class="parent" style="list-style-type: none;">
                            <li id="subject-content">
                                <!-- Content will be dynamically loaded here -->
                            </li>
                        </ul>
                    </div>
                </section>
            </article>
        </main>

        <footer>
            <div style="margin-bottom: 10px;">
                <a href="javascript:void(0)" onclick="showAnalyticsSettings()" style="text-decoration: underline;">Privacy Settings</a> |
                <a href="/privacy-policy" style="text-decoration: underline;">Privacy Policy</a> |
                <a href="/terms-of-service" style="text-decoration: underline;">Terms of Service</a>
            </div>
            <p>Built with ❤️ using <a href="https://getzola.org/" style="text-decoration: underline;">Zola</a> and <a href="https://www.getzola.org/themes/apollo/" style="text-decoration: underline;">Apollo</a></p>
            <span>&COPY; 2025 Anon</span>
        </footer>
    </div>
    <div class="right-content"></div>

    <script type="module">
        const SUBJECT_CODE = '${subjectCode}';
        const SEMESTER = '${semester}';
        const API_BASE = window.location.origin;

        // Initialize page
        async function init() {
            try {
                // Wait for auth check to complete if available
                if (window.auth && typeof window.auth.waitForAuthReady === 'function') {
                    await window.auth.waitForAuthReady();
                }

                // Hide loading, show content
                document.getElementById('loading-container').style.display = 'none';
                document.getElementById('main-content').style.display = 'block';

                // Load and initialize subject page module
                const { initSubjectPage } = await import('/js/init/subject.js?v=${swVersion}');
                await initSubjectPage(SUBJECT_CODE, SEMESTER, {
                    contentSelector: 'main, #main, .main-content',
                    loadingSelector: '#loading',
                    contentAreaSelector: '#content-area',
                    errorSelector: '#error',
                    subjectContentSelector: '#subject-content',
                    searchInputSelector: '#search-input',
                    noResultsSelector: '#no-results'
                });

            } catch (error) {
                console.error('Failed to initialize subject page:', error);
                document.getElementById('loading-container').innerHTML = 
                    '<div style="color: #ef4444;">Failed to load page. Please try again.</div>';
            }
        }

        init();
    </script>

    <script>
        // Privacy settings button handler
        (function() {
            const privacySettingsBtn = document.getElementById('privacy-settings-button');
            if (privacySettingsBtn) {
                privacySettingsBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    // Trigger PostHog opt-in/out banner or settings
                    showAnalyticsSettings()
                });
            }
        })();

        // Mobile menu toggle
        (function() {
            const menuToggle = document.getElementById('menu-toggle');
            const rightNav = document.getElementById('right-nav');
            const nav = document.querySelector('nav');
            
            if (menuToggle && rightNav) {
                menuToggle.addEventListener('click', function(e) {
                    e.stopPropagation();
                    menuToggle.classList.toggle('active');
                    rightNav.classList.toggle('active');
                    nav.classList.toggle('menu-open');
                });

                // Close menu when clicking outside
                document.addEventListener('click', function(e) {
                    if (!rightNav.contains(e.target) && !menuToggle.contains(e.target)) {
                        menuToggle.classList.remove('active');
                        rightNav.classList.remove('active');
                        nav.classList.remove('menu-open');
                    }
                });

                // Close menu when clicking a nav link
                rightNav.querySelectorAll('.nav-link').forEach(link => {
                    link.addEventListener('click', function() {
                        menuToggle.classList.remove('active');
                        rightNav.classList.remove('active');
                        nav.classList.remove('menu-open');
                    });
                });

                // Close menu on window resize to desktop size
                window.addEventListener('resize', function() {
                    if (window.innerWidth > 768) {
                        menuToggle.classList.remove('active');
                        rightNav.classList.remove('active');
                        nav.classList.remove('menu-open');
                    }
                });
            }
        })();

        // Highlight active navigation link based on current path
        (function() {
            const currentPath = window.location.pathname;
            document.querySelectorAll('.nav-link').forEach((link) => {
                const linkPath = link.getAttribute('data-path');
                if (linkPath) {
                    // Exact match for home page, startsWith for others
                    if (linkPath === '/' && currentPath === '/') {
                        link.classList.add('active');
                    } else if (linkPath !== '/' && currentPath.startsWith(linkPath)) {
                        link.classList.add('active');
                    }
                }
            });
        })();
    </script>

    <script defer src="/js/openLinkHandler.js?v=${swVersion}"></script>
    <script type="module" src="/js/router/init.js?v=${swVersion}"></script>
</body>
</html>`;
}
