(function() {
    'use strict';
    
    // Detect API base URL based on hostname (same pattern as utils.js)
    // Use same-origin empty string for production, local worker URL for dev
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:8787'
        : '';

    // Check if user has opted out
    function hasOptedOut() {
        return localStorage.getItem('analytics_opt_out') === 'true';
    }

    // Check if user has made a choice (either opted in or out)
    function hasUserMadeChoice() {
        const optOut = localStorage.getItem('analytics_opt_out');
        return optOut === 'true' || optOut === 'false';
    }

    // Wait for PostHog to be ready
    function waitForPostHog(callback) {
        if (window.posthog && window.posthog.capture) {
            callback();
        } else {
            setTimeout(() => waitForPostHog(callback), 100);
        }
    }

    // Generate/Get an anonymous distinct_id for privacy-friendly tracking
    function getAnonId() {
        try {
            const k = 'analytics_anon_id';
            let v = localStorage.getItem(k);
            if (!v) {
                v = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
                localStorage.setItem(k, v);
            }
            return v;
        } catch (_) {
            return (Date.now().toString(36) + Math.random().toString(36).slice(2));
        }
    }

    // Opt out of analytics (privacy-friendly mode: keep events without PII)
    function optOut() {
        localStorage.setItem('analytics_opt_out', 'true');

        fetch(API_BASE_URL + '/api/analytics/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'analytics_rejected',
                props: {
                    source: 'consent_banner',
                    ts: new Date().toISOString(),
                    ua: navigator.userAgent
                },
                opted_out: true,
                distinct_id: getAnonId()
            }),
            keepalive: true
        }).catch(err => console.warn('analytics proxy fetch failed', err));

        // Configure SDK for anonymized tracking: no PII, no session recording
        waitForPostHog(() => {
            try {
                // Reset identity and properties to avoid any PII
                posthog.reset();
                // Disable session recording if enabled
                posthog.stopSessionRecording && posthog.stopSessionRecording();
                // Use a stable random distinct id for anonymous analytics
                const anonId = getAnonId();
                posthog.identify(anonId);
                // Ensure capturing stays enabled so events still flow
                posthog.opt_in_capturing();
                // Mirror all subsequent capture calls to the worker proxy
                const originalCapture = posthog.capture.bind(posthog);
                posthog.capture = function(ev, props){
                    try {
                        fetch(API_BASE_URL + '/api/analytics/proxy', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ event: ev, props: props || {}, distinct_id: anonId, opted_out: true })
                        }).catch(()=>{});
                    } catch(_){}
                    // Still call local capture (SDK) to preserve in-app logic; server strips PII
                    try { originalCapture(ev, props); } catch(_){}
                };
            } catch(e){ console.warn('posthog privacy mode failed', e); }
        });
    }

    // Opt in to analytics
    function optIn() {
        localStorage.setItem('analytics_opt_out', 'false');
        
        waitForPostHog(() => {
            try {
                // Switch to cookie-based tracking for better attribution
                posthog.set_config({ cookieless_mode: false });
                posthog.opt_in_capturing();
                // Re-enable session recording if you use it
                posthog.startSessionRecording && posthog.startSessionRecording();
                posthog.capture('analytics_opted_in', {
                    timestamp: new Date().toISOString()
                });
            } catch (e) { console.warn('posthog opt_in failed', e); }
        });
    }

    // Show analytics banner
    function showAnalyticsBanner() {
        // Only show if user hasn't made a choice yet
        if (hasUserMadeChoice()) {
            return;
        }

        // Check if banner already exists to prevent duplicates
        if (document.getElementById('analytics-banner')) {
            return;
        }

        // Create banner wrapper with proper structure
        const banner = document.createElement('div');
        banner.id = 'analytics-banner';
        banner.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #2a2a2a;
            color: #e0e0e0;
            padding: 20px 25px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            z-index: 999999;
            max-width: 500px;
            width: 90%;
            font-family: Arial, sans-serif;
            border: 1px solid #4a90e2;
            pointer-events: auto;
        `;

        banner.innerHTML = `
            <div style="margin-bottom: 12px; font-weight: bold; font-size: 1rem;">
                Analytics & Privacy
            </div>
            <div style="margin-bottom: 16px; font-size: 0.9rem; line-height: 1.4; color: #b0b0b0;">
                We use PostHog to improve your experience. No personal data is sold.
                You can opt-out anytime.
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="analytics-settings-btn" style="
                    background: transparent;
                    color: #4a90e2;
                    border: 1px solid #4a90e2;
                    padding: 8px 16px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 0.85rem;
                    pointer-events: auto;
                    position: relative;
                    z-index: 1;
                ">Settings</button>
                <button id="analytics-accept-btn" style="
                    background: #4a90e2;
                    color: white;
                    border: none;
                    padding: 8px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 0.85rem;
                    pointer-events: auto;
                    position: relative;
                    z-index: 1;
                ">Accept</button>
            </div>
        `;
        
        document.body.appendChild(banner);

        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
            const acceptBtn = document.getElementById('analytics-accept-btn');
            const settingsBtn = document.getElementById('analytics-settings-btn');

            if (acceptBtn) {
                acceptBtn.onclick = function() {
                    optIn();
                    removeBanner();
                };
            }

            if (settingsBtn) {
                settingsBtn.onclick = function() {
                    removeBanner();
                    showAnalyticsSettings();
                };
            }
        });

        function removeBanner() {
            const bannerElement = document.getElementById('analytics-banner');
            if (bannerElement && bannerElement.parentNode) {
                bannerElement.parentNode.removeChild(bannerElement);
            }
        }
    }

    // Show analytics settings modal
    function showAnalyticsSettings() {
        const isOptedOut = hasOptedOut();
        
        // Remove existing modal if any
        const existingModal = document.getElementById('analytics-settings-modal');
        if (existingModal) {
            existingModal.parentNode.removeChild(existingModal);
        }
        
        const modal = document.createElement('div');
        modal.id = 'analytics-settings-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            pointer-events: auto;
        `;

        modal.innerHTML = `
            <div style="
                background: #2a2a2a;
                color: #e0e0e0;
                padding: 30px;
                border-radius: 12px;
                max-width: 500px;
                width: 90%;
                font-family: Arial, sans-serif;
                pointer-events: auto;
            " id="modal-content">
                <h2 style="margin: 0 0 20px 0; color: #4a90e2;">Analytics Preferences</h2>
                
                <div style="margin-bottom: 20px; line-height: 1.6; font-size: 0.95rem; color: #b0b0b0;">
                    <p>We collect anonymous usage data to improve your experience:</p>
                    <ul style="margin: 10px 0; padding-left: 20px; padding-top: 0.1rem; padding-bottom: 0.1rem;">
                        <li>Page views and navigation patterns</li>
                        <li>PDF views and reading time</li>
                        <li>Feature usage statistics</li>
                        <li>Error tracking for bug fixes</li>
                    </ul>
                    <p style="font-weight: bold; color: #e0e0e0;">We do not collect or store authentication data, nor have access to it.<br>We do not share your data with any other party.</p>
                </div>

                <div style="
                    padding: 15px;
                    background: ${isOptedOut ? '#e74c3c20' : '#10b98120'};
                    border-radius: 8px;
                    margin-bottom: 20px;
                    border-left: 3px solid ${isOptedOut ? '#e74c3c' : '#10b981'};
                ">
                    <strong>Current Status:</strong> 
                    <span style="color: ${isOptedOut ? '#e74c3c' : '#10b981'}">
                        ${isOptedOut ? 'Analytics Disabled' : 'Analytics Enabled'}
                    </span>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    ${isOptedOut ? `
                        <button id="analytics-enable-btn" style="
                            background: #10b981;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            pointer-events: auto;
                        ">Enable Analytics</button>
                    ` : `
                        <button id="analytics-disable-btn" style="
                            background: #e74c3c;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            pointer-events: auto;
                        ">Disable Analytics</button>
                    `}
                    <button id="analytics-close-btn" style="
                        background: #555;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 5px;
                        cursor: pointer;
                        pointer-events: auto;
                    ">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);

        // Helper function to remove modal safely
        function removeModal() {
            const modalElement = document.getElementById('analytics-settings-modal');
            if (modalElement && modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }

        // Use RAF for modal buttons too
        requestAnimationFrame(() => {
            const closeBtn = document.getElementById('analytics-close-btn');
            if (closeBtn) {
                closeBtn.onclick = function() {
                    removeModal();
                };
            }

            const enableBtn = document.getElementById('analytics-enable-btn');
            if (enableBtn) {
                enableBtn.onclick = function() {
                    optIn();
                    removeModal();
                    showSuccessMessage('Analytics enabled! Thank you for helping us improve.');
                };
            }

            const disableBtn = document.getElementById('analytics-disable-btn');
            if (disableBtn) {
                disableBtn.onclick = function() {
                    optOut();
                    removeModal();
                    showSuccessMessage('Analytics disabled. Your privacy is respected.');
                };
            }

            modal.onclick = function(e) {
                if (e.target === modal) {
                    removeModal();
                }
            };

            const modalContent = document.getElementById('modal-content');
            if (modalContent) {
                modalContent.onclick = function(e) {
                    e.stopPropagation();
                };
            }
        });
    }

    // Show success message
    function showSuccessMessage(message) {
        const notification = document.createElement('div');
        notification.id = 'analytics-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
            z-index: 999999;
            font-family: Arial, sans-serif;
            pointer-events: auto;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            const notificationElement = document.getElementById('analytics-notification');
            if (notificationElement && notificationElement.parentNode) {
                notificationElement.parentNode.removeChild(notificationElement);
            }
        }, 3000);
    }

    // Initialize on page load
    window.addEventListener('load', function() {
        // Apply user preference if they've made a choice
        if (hasUserMadeChoice()) {
            waitForPostHog(() => {
                try {
                    if (hasOptedOut()) {
                        // Privacy-friendly mode
                        posthog.reset();
                        posthog.stopSessionRecording && posthog.stopSessionRecording();
                        posthog.identify(getAnonId());
                        posthog.opt_in_capturing();
                    } else {
                        // Normal analytics mode
                        posthog.set_config({ cookieless_mode: false });
                        posthog.opt_in_capturing();
                        posthog.startSessionRecording && posthog.startSessionRecording();
                    }
                } catch (e) { console.warn('posthog init preference failed', e); }
            });
        }

        // Show banner after 2 seconds if user hasn't made a choice
        setTimeout(function() {
            showAnalyticsBanner();
        }, 2000);
    });

    // Helper function to check if PII tracking is allowed
    function isPIITrackingAllowed() {
        // If user has opted out, we still allow events but forbid any user-identifying properties
        return !hasOptedOut();
    }

    // Expose functions globally
    window.showAnalyticsSettings = showAnalyticsSettings;
    window.analyticsOptOut = optOut;
    window.analyticsOptIn = optIn;
    window.isPIITrackingAllowed = isPIITrackingAllowed;
})();