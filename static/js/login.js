// Import utilities (auth will be dynamically imported with version)
import { API_BASE_URL } from './utils.js';

// Get the version parameter from the script tag that loaded this module
const currentScript = document.currentScript || document.querySelector('script[src*="/js/login.js"]');
const scriptSrc = currentScript?.src || '';
const versionMatch = scriptSrc.match(/[?&]v=([^&]+)/);
const swVersion = versionMatch ? versionMatch[1] : '';

// Dynamically import auth with the same version parameter
const auth = await import(`./auth.js${swVersion ? `?v=${swVersion}` : ''}`).then(m => m.default);

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

    // Listen for auth state changes
    if (auth.on) {
        auth.on('login', (sessionData) => {
            if (loginModal) loginModal.style.display = 'none';
            if (content) content.style.display = 'block';
            if (typeof window.loadPdfViewer === 'function') window.loadPdfViewer();
        });

        auth.on('logout', () => {
            if (content) content.style.display = 'none';
            if (loginModal) loginModal.style.display = 'block';
        });

        auth.on('session-expired', () => {
            if (content) content.style.display = 'none';
            if (loginModal) loginModal.style.display = 'block';
        });
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





    async function handleLogin(event) {
        event.preventDefault();
        
        const srn = srnInput.value.trim();
        const password = passwordInput.value.trim();

        if (!srn || !password) {
            showError('Please fill in all fields');
            return;
        }

        loginModal.style.display = 'none';
        loadingOverlay.style.display = 'flex';

        try {
            const payload = {
                srn,
                password
            };

            // Always request login redirect to root. Server may use Referer for context.
            const loginUrl = `${API_BASE_URL}/api/login?redirect=${encodeURIComponent('/')}`;
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
                auth.storeSession(sessionData);

                if (window.posthog) {
                    if (window.isPIITrackingAllowed && window.isPIITrackingAllowed()) {
                        posthog.identify(sessionData.srn, {
                            srn: sessionData.srn,
                            name: sessionData.profile?.name || 'Unknown',
                            branch: sessionData.profile?.branch,
                            semester: sessionData.profile?.semester,
                            login_cached: data.cached || false,  // Track if login used cache
                            guest_mode: data.guest_mode || false  // Track if guest login
                        });
                        posthog.capture('user_login', { 
                            srn: sessionData.srn,
                            cached: data.cached || false,
                            guest_mode: data.guest_mode || false,
                        });
                    } else {
                        // Track login event without PII when opted out
                        posthog.capture('user_login', { 
                            cached: data.cached || false,
                            guest_mode: data.guest_mode || false,
                        });
                    }
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
                // Guest fallback enabled path
                if (res.status === 503 && data.guest_fallback_enabled) {
                    const guestInfo = document.getElementById('guest-info-message');
                    if (guestInfo) guestInfo.style.display = 'block';
                }
                // Explicit guest fallback not enabled response
                if (data.message === 'Guest auth not enabled') {
                    const guestInfo = document.getElementById('guest-info-message');
                    if (guestInfo) guestInfo.style.display = 'none';
                    showError('Guest login currently disabled. Use regular credentials.');
                } else {
                    showError(data.message || 'Invalid SRN/PRN or password. Please try again.');
                }
                loginModal.style.display = 'block';
            }
        } catch (error) {
            console.error(error)
            loadingOverlay.style.display = 'none';
            showError('Network error. Please check your connection and try again.');
            loginModal.style.display = 'block';
        }
    }

    // Initialize session on load
    (async function initSessionOnLoad() {
        const authenticated = await auth.ensureAuthenticated();
        if (authenticated) {
            if (content) content.style.display = 'block';
            if (typeof window.loadPdfViewer === 'function') window.loadPdfViewer();
        } else {
            loginModal.style.display = 'block';
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