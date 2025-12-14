/**
 * Subject Page Initialization Module
 * Reusable logic for both SSR and CSR rendering
 * Extracted from subject.html to reduce template bloat
 */

import { API_BASE_URL } from '../utils.js';
// Lazy-load resource search helpers with versioned path to avoid cached/404 HTML responses
async function loadResourceSearch() {
  const mod = await import('/js/init/resource-search.js');
  return mod;
}

/**
 * Initialize subject page
 * @param {string} subjectCode - Subject code (e.g., 'cfp', 'dsa')
 * @param {string} semester - Semester number (default: '1')
 * @param {Object} options - Additional options
 */
export async function initSubjectPage(subjectCode, semester = '1', options = {}) {  
  const {
    contentSelector = 'main, #main, .main-content',
    loadingSelector = '#loading',
    contentAreaSelector = '#content-area',
    errorSelector = '#error',
    subjectContentSelector = '#subject-content',
    searchInputSelector = '#search-input',
    noResultsSelector = '#no-results'
  } = options;

  const {
    applyFilters,
    clearFilters,
    initializeSearchOnEnter,
    initializeDetailsToggle
  } = await loadResourceSearch();

  const SHARED_CACHE_KEY = 'all_resources_snapshot_v2';
  const SUBJECT_CACHE_HASH_KEY = `subject_etag_v2_${subjectCode}`;
  
  let cachedData = null;

  /**
   * Load cached subject from localStorage
   */
  function loadCachedSubject() {
    try {
      const raw = localStorage.getItem(SHARED_CACHE_KEY);
      if (!raw) return false;
      
      const allResources = JSON.parse(raw);
      if (!Array.isArray(allResources)) return false;
      
      const subjectResources = allResources.filter(r => r.subject === subjectCode);
      if (subjectResources.length === 0) return false;
      
      const organized = organizeResourcesClientSide(subjectResources);
      cachedData = { subject: subjectCode, resources: organized };
      
      renderSubjectContent(cachedData, subjectContentSelector);
      hideElement(loadingSelector);
      showElement(contentAreaSelector);
      initializeDetailsToggle();
      
      initSubjectSuggest();
      return true;
    } catch (e) {
      console.warn('Failed to load cached subject:', e);
      return false;
    }
  }

  /**
   * Organize resources hierarchically (client-side)
   */
  function organizeResourcesClientSide(resources) {
    const organized = {};
    
    for (const resource of resources) {
      const unit = resource.unit || 'General';
      const type = resource.resource_type || 'Other';
      
      if (!organized[unit]) organized[unit] = {};
      if (!organized[unit][type]) organized[unit][type] = [];
      
      organized[unit][type].push({
        id: resource.id,
        title: resource.link_title,
        link_title: resource.link_title,
        filename: resource.filename,
        semester: resource.semester,
        unit: unit,
        resource_type: type
      });
    }
    
    // Sort units
    const sortedUnits = {};
    const unitKeys = Object.keys(organized).sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      if (a === 'all') return isNaN(numB) && b !== 'General' ? 1 : -1;
      if (b === 'all') return isNaN(numA) && a !== 'General' ? -1 : 1;
      if (a === 'General') return 1;
      if (b === 'General') return -1;
      return a.localeCompare(b);
    });
    
    for (const key of unitKeys) {
      sortedUnits[key] = organized[key];
    }
    
    return sortedUnits;
  }

  /**
   * Build resource URL
   */
  function buildResourceUrl(resource, unit) {
    const semNum = resource.semester?.match(/\d+/)?.[0] || '1';
    const actualUnit = unit || resource.unit || 'General';
    const type = resource.resource_type || 'Other';
    const filename = resource.filename;
    const rawTitle = resource.title || resource.link_title || resource.filename;

    let filePath;
    if (actualUnit === 'all') {
      filePath = `sem-${semNum}/${subjectCode}/${type}/unit-all/${filename}`;
    } else {
      filePath = `sem-${semNum}/${subjectCode}/unit-${actualUnit}/${filename}`;
    }

    return `/pdf-viewer?file=${encodeURIComponent(filePath)}&title=${encodeURIComponent(rawTitle)}`;
  }

  /**
   * Render subject content
   */
  function renderSubjectContent(data, selector) {
    const container = document.querySelector(selector);
    if (!container) return;

    const subjectName = data.subjectName || (data.subject && data.subject.toUpperCase()) || subjectCode.toUpperCase();
    
    let html = `
      <details>
        <summary>
          ${subjectName}
        </summary>
        <ul>
    `;

    for (const [unit, types] of Object.entries(data.resources)) {
      const unitLabel = (unit === 'all') ? 'Applicable to all Units' : `Unit-${unit}`;
      html += `
        <li>
          <details>
            <summary>${unitLabel}</summary>
            <ul>
              <li>
      `;

      for (const [type, resources] of Object.entries(types)) {
        html += `
          <details>
            <summary>${type}</summary>
            <ul>
        `;

        const sortedResources = resources.sort((a, b) => {
          const aMatch = (a.filename || '').match(/^(\d+)/);
          const bMatch = (b.filename || '').match(/^(\d+)/);
          const aNum = aMatch ? parseInt(aMatch[1]) : 999999;
          const bNum = bMatch ? parseInt(bMatch[1]) : 999999;
          return aNum - bNum;
        });

        for (const resource of sortedResources) {
          const resourceWithType = { ...resource, resource_type: resource.resource_type || type };
          const url = buildResourceUrl(resourceWithType, unit);
          const title = resource.title || resource.filename;
          const filename = resource.filename || '';
          html += `<li><a href="${url}" data-filename="${filename}" data-title="${resource.title || ''}">${title}</a></li>\n`;
        }

        html += `
            </ul>
          </details>
        `;
      }

      html += `
              </li>
            </ul>
          </details>
        </li>
      `;
    }

    html += `
        </ul>
      </details>
    `;

    container.innerHTML = html;
  }

  /**
   * Fetch resources from API with ETag caching
   */
  async function loadSubjectResources() {
    try {
      const etag = localStorage.getItem(SUBJECT_CACHE_HASH_KEY);
      const url = `${API_BASE_URL}/api/subject/resources?subject=${encodeURIComponent(subjectCode)}&_t=${Date.now()}`;
      
      const response = await fetch(url, {
        headers: etag ? { 'If-None-Match': etag } : {},
        credentials: 'include'
      });

      if (response.status === 304) {
        hideElement(loadingSelector);
        showElement(contentAreaSelector);
        return;
      }

      // Handle 401 Unauthorized - trigger auth flow and show modal
      if (response.status === 401) {
        hideElement(loadingSelector);
        hideElement(contentAreaSelector);
        const bodyEl = document.querySelector('.body');
        if (bodyEl) bodyEl.style.display = 'none';
        if (window.auth && typeof window.auth.ensureAuthenticated === 'function') {
          await window.auth.ensureAuthenticated();
        } else {
          const loginModal = document.getElementById('login-modal');
          if (loginModal) loginModal.style.display = 'block';
        }
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch resources: ${response.status}`);
      }

      const data = await response.json();

      // Handle delta updates
      if (data.delta && cachedData) {
        const merged = JSON.parse(JSON.stringify(cachedData.resources || {}));
        
        if (data.resources) {
          for (const [unit, types] of Object.entries(data.resources)) {
            if (!merged[unit]) merged[unit] = {};
            for (const [type, resources] of Object.entries(types)) {
              if (!merged[unit][type]) {
                merged[unit][type] = resources;
              } else {
                const resourceMap = new Map(merged[unit][type].map(r => [r.id, r]));
                resources.forEach(r => resourceMap.set(r.id, r));
                merged[unit][type] = Array.from(resourceMap.values());
              }
            }
          }
        }

        if (data.deleted && data.deleted.length > 0) {
          for (const [unit, types] of Object.entries(merged)) {
            for (const [type, resources] of Object.entries(types)) {
              merged[unit][type] = resources.filter(r => !data.deleted.includes(r.id));
            }
          }
        }

        cachedData = { ...data, resources: merged };
      } else {
        cachedData = data;
      }

      renderSubjectContent(cachedData, subjectContentSelector);

      if (cachedData.hash) {
        localStorage.setItem(SUBJECT_CACHE_HASH_KEY, cachedData.hash);
      }

      hideElement(loadingSelector);
      showElement(contentAreaSelector);
      initializeDetailsToggle();

      initSubjectSuggest();
    } catch (error) {
      console.error('Error loading subject resources:', error);
      hideElement(loadingSelector);
      showElement(errorSelector);
    }
  }

  /**
   * Initialize search suggestions for subject page
   */
  async function initSubjectSuggest() {
    try {
      const mod = await import('./search-suggest.js');
      const initSubjectSearchSuggest = mod.initSubjectSearchSuggest;
      const inputEl = document.querySelector(searchInputSelector);
      if (inputEl) {
        initSubjectSearchSuggest(inputEl, () => {
          applyFilters(searchInputSelector, contentAreaSelector, noResultsSelector);
        });
      }
    } catch (err) {
      console.warn('Failed to init subject search suggest', err);
    }
  }

  /**
   * Helper functions
   */
  function hideElement(selector) {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'none';
  }

  function showElement(selector) {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'block';
  }

  /**
   * Initialize
   */
  async function init() {
    initializeSearchOnEnter(searchInputSelector);
    initializeDetailsToggle(contentAreaSelector, 2);

    // Expose to window for onclick handlers
    window.applyFilters = () => applyFilters(searchInputSelector, contentAreaSelector, noResultsSelector);
    window.clearFilters = () => clearFilters(searchInputSelector, contentAreaSelector, noResultsSelector);

    // Wait for auth check before loading content; use ensureAuthenticated to trigger modal
    if (window.auth && typeof window.auth.ensureAuthenticated === 'function') {
      const isAuthenticated = await window.auth.ensureAuthenticated();

      if (!isAuthenticated) {
        // Not authenticated - hide content and wait for user to login
        hideElement(loadingSelector);
        hideElement(contentAreaSelector);
        const bodyEl = document.querySelector('.body');
        if (bodyEl) bodyEl.style.display = 'none';
        return;
      }
    } else {
      // Auth not available; show modal if present
      hideElement(loadingSelector);
      hideElement(contentAreaSelector);
      const bodyEl = document.querySelector('.body');
      if (bodyEl) bodyEl.style.display = 'none';
      const loginModal = document.getElementById('login-modal');
      if (loginModal) {
        loginModal.style.display = 'block';
      }
      return;
    }

    // Authenticated - reveal body container
    const bodyEl = document.querySelector('.body');
    if (bodyEl) bodyEl.style.display = 'block';

    // User is authenticated, proceed with loading content
    loadCachedSubject();
    loadSubjectResources();

    // Refresh on visibility change
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        loadSubjectResources();
      }
    });
  }

  // Run on ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
