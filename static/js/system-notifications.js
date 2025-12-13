import { API_BASE_URL } from './utils.js';

// System Status and Error Notification Manager
// Handles maintenance mode, announcements, and 5XX error notifications
class SystemNotificationManager {
    constructor() {
        this.checkInterval = null;
        this.lastCheck = 0;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;

        // Check immediately on load
        await this.checkSystemStatus();

        // Check every 60 seconds
        this.checkInterval = setInterval(() => {
            this.checkSystemStatus();
        }, 60000);

        // Set up global fetch interceptor for 5XX errors
        this.interceptFetch();
    }

    async checkSystemStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/system/status`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                return;
            }

            const status = await response.json();
            this.lastCheck = Date.now();

            // Handle maintenance mode
            if (status.maintenance_mode) {
                this.showMaintenanceBanner(status.maintenance_message);
            } else {
                this.hideMaintenanceBanner();
            }
        } catch (error) {
            // Silently fail - system status check is non-critical
        }
    }

    showMaintenanceBanner(message) {
        let banner = document.getElementById('maintenance-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'maintenance-banner';
            banner.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
                color: white;
                padding: 16px 20px;
                text-align: center;
                font-size: 15px;
                font-weight: 500;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 9999;
                animation: slideDown 0.3s ease-out;
                border-bottom: 2px solid rgba(255, 255, 255, 0.2);
            `;
            document.body.prepend(banner);

            // Add padding to body to prevent content overlap
            document.body.style.paddingTop = (banner.offsetHeight || 60) + 'px';
        }
        banner.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>${this.escapeHtml(message)}</span>
            </div>
        `;
    }

    hideMaintenanceBanner() {
        const banner = document.getElementById('maintenance-banner');
        if (banner) {
            banner.style.animation = 'slideUp 0.3s ease-out';
            setTimeout(() => {
                banner.remove();
                document.body.style.paddingTop = '';
            }, 300);
        }
    }

    show5xxErrorNotification(statusCode, url) {
        // Don't show duplicate errors
        if (document.getElementById('error-5xx-notification')) {
            return;
        }

        const notification = document.createElement('div');
        notification.id = 'error-5xx-notification';
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            z-index: 9999;
            max-width: 400px;
            animation: slideInRight 0.3s ease-out;
            border: 1px solid rgba(255, 255, 255, 0.2);
        `;

        notification.innerHTML = `
            <div style="display: flex; align-items: start; gap: 12px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 4px;">Server Error (${statusCode})</div>
                    <div style="font-size: 13px; opacity: 0.9;">We're experiencing technical difficulties. The issue has been logged and will be investigated.</div>
                </div>
                <button id="close-error-notification" 
                    style="background: none; border: none; color: white; cursor: pointer; font-size: 20px; padding: 0; line-height: 1; margin-left: 8px;"
                    title="Dismiss">×</button>
            </div>
        `;

        document.body.appendChild(notification);

        // Auto-dismiss after 10 seconds
        const timeout = setTimeout(() => {
            this.hideErrorNotification();
        }, 10000);

        // Handle close button
        const closeBtn = document.getElementById('close-error-notification');
        if (closeBtn) {
            closeBtn.onclick = () => {
                clearTimeout(timeout);
                this.hideErrorNotification();
            };
        }

        // Report error to backend
        this.reportError(statusCode, url);
    }

    hideErrorNotification() {
        const notification = document.getElementById('error-5xx-notification');
        if (notification) {
            notification.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }
    }

    async reportError(statusCode, url) {
        try {
            await fetch(`${API_BASE_URL}/api/system/report-error`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    statusCode,
                    url,
                    error: `HTTP ${statusCode} error`,
                    timestamp: Date.now(),
                    userAgent: navigator.userAgent
                })
            });
        } catch (error) {
            // Silently fail - error reporting is non-critical
        }
    }

    interceptFetch() {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            try {
                const response = await originalFetch(...args);
                
                // Check for 5XX errors
                if (response.status >= 500 && response.status < 600) {
                    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
                    this.show5xxErrorNotification(response.status, url);
                }
                
                return response;
            } catch (error) {
                // Network errors - silently fail, don't spam logs
                throw error;
            }
        };
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        this.hideMaintenanceBanner();
        this.hideErrorNotification();
    }
}

// Add animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from {
            transform: translateY(-100%);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }
    
    @keyframes slideUp {
        from {
            transform: translateY(0);
            opacity: 1;
        }
        to {
            transform: translateY(-100%);
            opacity: 0;
        }
    }
    
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize the notification manager
const systemNotificationManager = new SystemNotificationManager();

// Start checking on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        systemNotificationManager.init();
    });
} else {
    systemNotificationManager.init();
}

// Export for use in other scripts if needed
window.systemNotificationManager = systemNotificationManager;
