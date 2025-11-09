// Import session sync module and utilities
import sessionSync from './session-sync.js';
import { API_BASE_URL } from './utils.js';

document.addEventListener('DOMContentLoaded', async function() {
    const content = document.getElementsByClassName('body')[0];
    const loginModal = document.getElementById('login-modal');
    const loginForm = document.getElementById('login-form');
    const srnInput = document.getElementById('srn-input');
    const passwordInput = document.getElementById('password-input');
    const passwordToggle = document.getElementById('password-toggle');
    const errorMessage = document.getElementById('error-message');
    const cancelButton = document.getElementById('cancel-login');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Listen for session changes from other tabs/PWA
    sessionSync.addListener((event, data) => {
        console.log('[Login] Session event:', event);
        
        switch (event) {
            case 'login':
            case 'refresh':
                // Another tab logged in or refreshed, show content
                if (loginModal) loginModal.style.display = 'none';
                if (content) content.style.display = 'block';
                if (typeof window.loadPdfViewer === 'function') window.loadPdfViewer();
                
                // Update PostHog if available
                if (window.posthog && data) {
                    posthog.identify(data.srn, {
                        srn: data.srn,
                        name: data.profile?.name || 'Unknown',
                        branch: data.profile?.branch,
                        semester: data.profile?.semester,
                        synced_from_tab: true
                    });
                }
                break;
                
            case 'logout':
            case 'expired':
                // Another tab logged out or session expired, show login
                if (content) content.style.display = 'none';
                if (loginModal) loginModal.style.display = 'block';
                
                // Track logout
                if (window.posthog) {
                    posthog.capture('user_logout', { reason: event });
                    posthog.reset();
                }
                break;
        }
    });

    // Password visibility toggle
    passwordToggle.addEventListener('click', function() {        
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            passwordToggle.textContent = '🙈';
            passwordToggle.title = 'Hide Password';
        } else {
            passwordInput.type = 'password';
            passwordToggle.textContent = '👁️';
            passwordToggle.title = 'Show Password';
        }
    });

    // Show error message
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }

    // Store session using sessionSync module
    function storeSession(sessionData) {
        sessionSync.storeSession(sessionData);
    }

    // Clear session using sessionSync module
    function clearSession() {
        sessionSync.clearSession();
    }

    function isSessionValid() {
        return sessionSync.isLoggedIn();
    }

    async function tryServerSession() {
        try {
            const res = await fetch(API_BASE_URL + '/api/session', { 
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!res.ok) return false;
            const j = await res.json();
            if (j.success && j.session) {
                storeSession(j.session);
                return true;
            }
        } catch (e) { 
            console.error('Session check failed:', e);
        }
        return false;
    }

    async function handleLogin(event) {
        event.preventDefault();
        
        const srn = srnInput.value.trim();
        const password = passwordInput.value.trim();

        if (!srn || !password) {
            showError('Please fill in all fields');
            return;
        }

        // Check Turnstile BEFORE showing loading screen
        const turnstileResponse = window.turnstile?.getResponse?.() || window._turnstileToken;
        
        if (!turnstileResponse) {
            showError('Please complete the verification challenge first');
            return;
        }

        loginModal.style.display = 'none';
        loadingOverlay.style.display = 'flex';

        try {
            const payload = {
                srn,
                password,
                turnstileToken: turnstileResponse,
            };

            // Use postLoginRedirect from localStorage if available
            let redirectPath = '/';
            if (localStorage.getItem('postLoginRedirect')) {
                redirectPath = localStorage.getItem('postLoginRedirect');
                localStorage.removeItem('postLoginRedirect');
            }
            const loginUrl = `${API_BASE_URL}/api/login?redirect=${encodeURIComponent(redirectPath)}`;
            const res = await fetch(loginUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            loadingOverlay.style.display = 'none';

            const data = await res.json().catch(() => ({}));

            if (res.ok && data.success) {
                const sessionData = data.session || { srn: srn, profile: data.profile || {}, expiresAt: data.expiresAt };
                storeSession(sessionData); // This now broadcasts automatically via sessionSync

                if (window.posthog) {
                    posthog.identify(sessionData.srn, {
                        srn: sessionData.srn,
                        name: sessionData.profile?.name || 'Unknown',
                        branch: sessionData.profile?.branch,
                        semester: sessionData.profile?.semester,
                        login_cached: data.cached || false  // Track if login used cache
                    });
                    posthog.capture('user_login', { 
                        srn: sessionData.srn,
                        cached: data.cached || false,
                    });
                }

                // Show a brief message if login was cached (fast)
                if (data.cached) {
                    console.log('Fast login using cached credentials');
                }

                try {
                    if (content) {
                        content.style.display = 'block';
                        if (typeof window.loadPdfViewer === 'function') window.loadPdfViewer()
                    }
                    if (typeof window.loadPdfViewer === 'function') {
                        window.loadPdfViewer();
                    }
                } catch (e) {
                    console.error(e);
                }

                if (data.redirect != '/') window.location.href = data.redirect
                return;
            } else {
                showError(data.message || 'Invalid SRN/PRN or password. Please try again.');
                loginModal.style.display = 'block';
                window.turnstile?.reset()
            }
        } catch (error) {
            console.error(error)
            loadingOverlay.style.display = 'none';
            showError('Network error. Please check your connection and try again.');
            loginModal.style.display = 'block';
            window.turnstile?.reset()
        }
    }

    // On load: try server session first, then check with sessionSync
    (async function initSessionOnLoad() {
        // First check if we already have a valid session
        if (sessionSync.isLoggedIn()) {
            const sessionData = sessionSync.getSession();
            if (window.posthog && sessionData) {
                posthog.identify(sessionData.srn, {
                    srn: sessionData.srn,
                    name: sessionData.profile?.name || 'Unknown',
                    branch: sessionData.profile?.branch,
                    semester: sessionData.profile?.semester,
                    session_restored: true,
                });
            }
            if (content) content.style.display = 'block';
            if (typeof window.loadPdfViewer === 'function') window.loadPdfViewer();
            return;
        }

        // No session, try to get from server
        const ok = await tryServerSession();
        if (ok) {
            const sessionData = sessionSync.getSession();
            if (window.posthog && sessionData) {
                posthog.identify(sessionData.srn, {
                    srn: sessionData.srn,
                    name: sessionData.profile?.name || 'Unknown',
                    branch: sessionData.profile?.branch,
                    semester: sessionData.profile?.semester,
                    session_restored: true,
                });
            }
            if (content) content.style.display = 'block';
            if (typeof window.loadPdfViewer === 'function') window.loadPdfViewer();
            return;
        }

        // No server session, request from other tabs
        sessionSync.requestSessionFromPeers();
        
        // Wait briefly for peer response
        setTimeout(() => {
            if (!sessionSync.isLoggedIn()) {
                loginModal.style.display = 'block';
            }
        }, 500);
    })();

    // Event listeners
    loginForm.addEventListener('submit', handleLogin);
    
    cancelButton.addEventListener('click', function() {
        if (content) content.remove();
        loginModal.style.display = 'none';
        return window.showAccessDenied();
    });

    // Close modal when clicking outside
    loginModal.addEventListener('click', function(event) {
        if (event.target === loginModal) {
            loginModal.style.display = 'none';
        }
    });
});

function showAccessDenied() {
    document.getElementsByClassName('content')[0].innerHTML = `
        <div class="loading-message">
            <h2>Access Denied</h2>
            <p>You must be logged in to view this document.<br>
            Redirecting to login...</p>
        </div>
    `;
    setTimeout(function() {
        window.location.href = '/';
    }, 3000);
}

// Expose globally for login.js to call
window.showAccessDenied = showAccessDenied;