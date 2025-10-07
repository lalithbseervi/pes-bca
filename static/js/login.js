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

    // Generate session token (simple random string)
    function generateSessionToken() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

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

    // Handle login form submission
    async function handleLogin(event) {
        event.preventDefault();
        
        const srn = srnInput.value.trim();
        const password = passwordInput.value.trim();

        if (!srn || !password) {
            showError('Please fill in all fields');
            return;
        }

        // Hide modal and show loading
        loginModal.style.display = 'none';
        loadingOverlay.style.display = 'flex';

        try {
            const res = await fetch('https://cors-proxy.devpages.workers.dev/?url=' + encodeURIComponent('https://pesu-auth-z18n.onrender.com/authenticate'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: srn,
                    password: password,
                    profile: true,
                    fields: ['branch', 'semester', 'name']
                })
            });

            loadingOverlay.style.display = 'none';

            if (res.ok) {
                const data = await res.json();

                if (data.profile.branch == 'Bachelor of Computer Applications' && data.profile.semester == 'Sem-1') {
                    // Generate and store session token
                    const sessionToken = generateSessionToken();
                    const sessionData = {
                        token: sessionToken,
                        srn: srn,
                        profile: data.profile,
                        loginTime: new Date().toISOString(),
                        // Set session expiry (72 hours)
                        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
                    };
                    
                    // Store in sessionStorage only
                    storeSession(sessionData);

                    // Broadcast to other tabs (they will request session data via BroadcastChannel)
                    if (loginChannel) {
                        loginChannel.postMessage({
                            type: 'login_success',
                            timestamp: Date.now()
                        });
                    }

                    // Enhanced PostHog user profiling
                    if (window.posthog) {
                        posthog.identify(srn, {
                            srn: srn,
                            name: data.profile.name || 'Unknown',
                            branch: data.profile.branch,
                            semester: data.profile.semester,
                            login_date: new Date().toISOString(),
                        });

                        posthog.capture('user_login', {
                            srn: srn,
                            name: data.profile.name || 'Unknown',
                            branch: data.profile.branch,
                            semester: data.profile.semester,
                            timestamp: new Date().toISOString()
                        });
                    }

                    content.style.display = 'block';
                } else {
                    content.remove();
                    showError("You cannot access this content. Only BCA Sem-1 students are allowed.");
                    loginModal.style.display = 'block';
                }
            } else if (res.status == 500 || res.status == 502 || res.status == 503) {
                const errMessage = document.createElement('div');
                errMessage.innerHTML = `<h1 style="color: red; font-family: Helvetica, sans-serif;">A 3rd party service is currently down. Please try again later.<br>Status Code: ${res.status}</h1>`;
                content.replaceWith(errMessage);
                return;
            } else {
                showError("Invalid SRN/PRN or password. Please try again.");
                loginModal.style.display = 'block';
            }
        } catch (error) {
            loadingOverlay.style.display = 'none';
            console.error('Authentication error:', error);
            showError('Network error. Please check your connection and try again.');
            loginModal.style.display = 'block';
        }
    }

    // Check if session is still valid
    function isSessionValid() {
        const sessionData = sessionStorage.getItem('user_session');
        if (!sessionData) return false;
        
        try {
            const session = JSON.parse(sessionData);
            const now = new Date();
            const expiresAt = new Date(session.expiresAt);
            
            if (now < expiresAt) {
                // Update the session expiry time if valid
                session.expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
                sessionStorage.setItem('user_session', JSON.stringify(session));
                return true;
            } else {
                return false;
            }
        } catch (error) {
            return false;
        }
    }

    // Handle logout
    function handleLogout() {
        clearSession();
        
        // Broadcast logout event to other tabs
        if (loginChannel) {
            loginChannel.postMessage({
                type: 'logout'
            });
        }

        window.location.reload();
    }

    // Listen for messages from other tabs
    if (loginChannel) {
        loginChannel.onmessage = function(event) {
            const { type, sessionData } = event.data;
            
            if (type === 'login_success') {
                // Another tab logged in - ask for session data
                // This tab doesn't have session, so request it
                if (!sessionStorage.getItem('logged_in')) {
                    loginChannel.postMessage({
                        type: 'request_session',
                        requestId: Date.now()
                    });
                }
            } else if (type === 'request_session') {
                // Another tab is requesting session data
                const mySession = sessionStorage.getItem('user_session');
                if (mySession) {
                    // Share session data ONLY via BroadcastChannel (in-memory, not persisted)
                    loginChannel.postMessage({
                        type: 'session_response',
                        sessionData: JSON.parse(mySession)
                    });
                }
            } else if (type === 'session_response') {
                // Received session data from another tab
                if (sessionData) {
                    sessionStorage.setItem('user_session', JSON.stringify(sessionData));
                    sessionStorage.setItem('logged_in', 'true');
                    
                    if (loginModal && loginModal.style.display === 'block') {
                        loginModal.style.display = 'none';
                        content.style.display = 'block';
                    }
                    
                    // Re-identify with PostHog
                    if (window.posthog) {
                        posthog.identify(sessionData.srn, {
                            srn: sessionData.srn,
                            name: sessionData.profile?.name || 'Unknown',
                            branch: sessionData.profile?.branch,
                            semester: sessionData.profile?.semester,
                            session_synced: true,
                        });
                    }
                }
            } else if (type === 'logout') {
                // Another tab logged out
                clearSession();
                window.location.reload();
            }
        };
    }

    // Monitor localStorage for session flag changes (fallback)
    window.addEventListener('storage', function(event) {
        if (event.key === 'has_active_session') {
            if (event.newValue && !sessionStorage.getItem('logged_in')) {
                // A session exists in another tab, request it
                if (loginChannel) {
                    loginChannel.postMessage({
                        type: 'request_session',
                        requestId: Date.now()
                    });
                }
            } else if (!event.newValue) {
                // Session cleared in another tab
                clearSession();
                window.location.reload();
            }
        }
    });

    // For new tabs: Check if there's an active session in another tab
    if (!sessionStorage.getItem('logged_in') && localStorage.getItem('has_active_session')) {
        // Request session data from other tabs
        if (loginChannel) {
            loginChannel.postMessage({
                type: 'request_session',
                requestId: Date.now()
            });
            
            // Wait a moment for response
            setTimeout(() => {
                if (!sessionStorage.getItem('logged_in')) {
                    // No response, show login modal
                    loginModal.style.display = 'block';
                }
            }, 500);
        } else {
            // BroadcastChannel not supported, show login modal
            loginModal.style.display = 'block';
        }
    } else if (!sessionStorage.getItem('logged_in') || !isSessionValid()) {
        // No active session at all
        clearSession();
        loginModal.style.display = 'block';
    } else {
        // Valid session exists
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
        content.style.display = 'block';
    }

    // Event listeners
    loginForm.addEventListener('submit', handleLogin);
    
    cancelButton.addEventListener('click', function() {
        content.remove();
        loginModal.style.display = 'none';
    });

    // Close modal when clicking outside
    loginModal.addEventListener('click', function(event) {
        if (event.target === loginModal) {
            loginModal.style.display = 'none';
        }
    });

    // Expose logout function
    window.logout = handleLogout;
});