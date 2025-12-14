/**
 * Service Worker Version Management
 * Stores and retrieves SW_VERSION in localStorage for cache busting
 */

const SW_VERSION_KEY = 'sw_version';
const SW_VERSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get the current SW version from localStorage
 * Falls back to timestamp if not set
 */
export function getSWVersion() {
    const stored = localStorage.getItem(SW_VERSION_KEY);
    if (stored) {
        const { version, timestamp } = JSON.parse(stored);
        // Check if cached version is still valid (24 hours)
        if (Date.now() - timestamp < SW_VERSION_TIMEOUT) {
            return version;
        }
    }
    // Return timestamp as fallback
    return Date.now().toString();
}

/**
 * Set the SW version in localStorage
 * Called by homepage/main pages when asset-version meta tag is available
 */
export function setSWVersion(version) {
    if (version) {
        localStorage.setItem(SW_VERSION_KEY, JSON.stringify({
            version: version.toString(),
            timestamp: Date.now()
        }));
    }
}

/**
 * Initialize SW version from page's meta tag
 * Should be called early in page load
 */
export function initSWVersion() {
    const metaVersion = document.querySelector('meta[name="asset-version"]');
    if (metaVersion) {
        setSWVersion(metaVersion.getAttribute('content'));
    }
}

// Auto-initialize on script load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSWVersion);
} else {
    initSWVersion();
}
