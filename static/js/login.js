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
                    
                    sessionStorage.setItem('user_session', JSON.stringify(sessionData));
                    sessionStorage.setItem('logged_in', 'true');

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
                sessionStorage.setItem('user_session', JSON.stringify(session)); // Save the updated session
                return true;
            } else {
                return false;
            }
        } catch (error) {
            return false;
        }
    }

    // Clear expired session
    function clearSession() {
        sessionStorage.removeItem('user_session');
        sessionStorage.removeItem('logged_in');
    }

    // Event listeners
    loginForm.addEventListener('submit', handleLogin);
    
    cancelButton.addEventListener('click', function() {
        // guests users only have access to posts and other material
        content.remove();
        loginModal.style.display = 'none';
    });

    // Close modal when clicking outside
    loginModal.addEventListener('click', function(event) {
        if (event.target === loginModal) {
            loginModal.style.display = 'none';
        }
    });

    // Check if user is already logged in and session is valid
    if (!sessionStorage.getItem('logged_in') || !isSessionValid()) {
        // Clear any expired session
        clearSession();
        loginModal.style.display = 'block';
    } else {
        // Re-identify user from stored session data
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
});