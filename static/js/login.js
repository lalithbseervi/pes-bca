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

    // BroadcastChannel for cross-tab communication
    // solves the problem of session not being detected in new tabs
    let loginChannel;
    try {
        loginChannel = new BroadcastChannel('login_channel');
    } catch (e) {
        console.log('BroadcastChannel not supported');
    }

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

    // Store session only in sessionStorage
    function storeSession(sessionData) {
        sessionStorage.setItem('user_session', JSON.stringify(sessionData));
        sessionStorage.setItem('logged_in', 'true');
        
        // Only store a flag in localStorage to indicate an active session exists
        localStorage.setItem('has_active_session', Date.now().toString());
    }

    // Clear session
    function clearSession() {
        sessionStorage.removeItem('user_session');
        sessionStorage.removeItem('logged_in');
        localStorage.removeItem('has_active_session');
    }

    function isSessionValid() {
        const sessionData = sessionStorage.getItem('user_session');
        if (!sessionData) return false;
        
        try {
            const session = JSON.parse(sessionData);
            if (!session.expiresAt) return true; // No expiry set, assume valid
            
            const expiryTime = new Date(session.expiresAt).getTime();
            const now = Date.now();
            return now < expiryTime;
        } catch (e) {
            console.error('Error parsing session:', e);
            return false;
        }
    }

    // Determine API base URL based on environment
    function getApiBaseUrl() {
        if (window.location.hostname != 'pes-bca.pages.dev') {
            return 'http://localhost:8787';
        }
        return 'https://cors-proxy.devpages.workers.dev';
    }

    async function tryServerSession() {
        try {
            const res = await fetch(getApiBaseUrl() + '/api/session', { 
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
            const loginUrl = `${getApiBaseUrl()}/api/login?redirect=${encodeURIComponent(redirectPath)}`;
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
                storeSession(sessionData);

                // notify other tabs
                if (loginChannel) {
                    try {
                        loginChannel.postMessage({ type: 'login_success', sessionData });
                    } catch (e) {}
                }

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

                if (content) {
                    content.style.display = 'block';
                    if (typeof window.loadPdfViewer === 'function') window.loadPdfViewer()
                }
                if (typeof window.loadPdfViewer === 'function') {
                    window.loadPdfViewer();
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

    // On load: try server session first before requesting via BroadcastChannel
    (async function initSessionOnLoad() {
        if (!sessionStorage.getItem('logged_in')) {
            const ok = await tryServerSession();
            if (ok) {
                // re-identify and show content
                const sessionData = JSON.parse(sessionStorage.getItem('user_session'));
                if (window.posthog && sessionData) {
                    posthog.identify(sessionData.srn, {
                        srn: sessionData.srn,
                        name: sessionData.profile?.name || 'Unknown',
                        branch: sessionData.profile?.branch,
                        semester: sessionData.profile?.semester,
                        session_restored: true,
                    });
                }
                if (content) {
                    content.style.display = 'block';
                }
                return;
            } else {
                // fallback to existing BroadcastChannel flow (request other tabs for session)
                if (loginChannel) {
                    loginChannel.postMessage({ type: 'request_session', requestId: Date.now() });
                    return setTimeout(() => {
                        if (!sessionStorage.getItem('logged_in')) {
                            loginModal.style.display = 'block';
                        }
                    }, 500);
                } else {
                    return loginModal.style.display = 'block';
                }
            }
        } else if (!isSessionValid()) {
            clearSession();
            return loginModal.style.display = 'block';
        } else {
            const sessionData = JSON.parse(sessionStorage.getItem('user_session'));
            if (sessionData && window.posthog) {
                posthog.identify(sessionData.srn, {
                    srn: sessionData.srn,
                    name: sessionData.profile?.name || 'Unknown',
                    branch: sessionData.profile?.branch,
                    semester: sessionData.profile?.semester,
                    session_restored: true,
                });
            }
            if (content) {
                content.style.display = 'block';
            }
        }
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