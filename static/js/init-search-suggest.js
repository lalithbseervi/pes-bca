// Shared initialization for search suggestions
// Provides factory functions to create suggestions for homepage and subject pages

import { createSearchSuggest } from '/js/search-suggest.js';

/**
 * Initialize search suggestions for the homepage
 * @param {HTMLInputElement} inputEl - The search input element
 * @param {Array} allResources - Array of resource objects from API
 * @param {Function} applyFilters - Function to run if fallback filtering is needed
 */
export function initHomeSearchSuggest(inputEl, allResources, applyFilters) {
  if (!inputEl) return;

  createSearchSuggest(inputEl, {
    getCandidates: async (prefix) => {
      const q = prefix.toLowerCase();
      const seen = new Set();
      const items = [];
      
      allResources.forEach(r => {
        const title = (r.link_title || r.filename || '').trim();
        const filename = (r.filename || '').trim();
        if (!title && !filename) return;
        
        if ((title && title.toLowerCase().includes(q)) || (filename && filename.toLowerCase().includes(q))) {
          const semNum = (r.semester || '').match(/\d+/)?.[0] || '1';
          const subject = r.subject;
          const unit = r.unit;
          const type = r.resource_type;
          
          let filePath;
          if (unit === 'all') {
            filePath = `sem-${semNum}/${subject}/${type}/unit-all/${encodeURIComponent(filename)}`;
          } else {
            filePath = `sem-${semNum}/${subject}/unit-${unit}/${encodeURIComponent(filename)}`;
          }
          
          const url = `/pdf-viewer?file=${encodeURIComponent(filePath)}&title=${encodeURIComponent(title || filename)}`;
          const key = `${title}|${filename}`;
          
          if (seen.has(key)) return;
          seen.add(key);
          items.push({ text: title || filename, meta: filename, url });
        }
      });
      
      return items;
    },
    onSelect: (item) => {
      if (item?.url) {
        window.open(item.url, '_blank', 'noopener');
      } else {
        inputEl.value = item.text;
        applyFilters();
      }
    }
  });
}

/**
 * Initialize search suggestions for a subject page
 * @param {HTMLInputElement} inputEl - The search input element
 * @param {Function} applyFilters - Function to run if fallback filtering is needed
 */
export function initSubjectSearchSuggest(inputEl, applyFilters) {
  if (!inputEl) return;

  createSearchSuggest(inputEl, {
    getCandidates: async (prefix) => {
      const q = prefix.toLowerCase();
      const seen = new Set();
      const items = [];
      const contentArea = document.getElementById('content-area');
      if (!contentArea) return items;
      
      const links = contentArea.querySelectorAll('a');
      links.forEach(a => {
        const text = (a.textContent || '').trim();
        const href = (a.getAttribute('href') || '').trim();
        if (!text && !href) return;
        
        const key = `${text}|${href}`;
        if (seen.has(key)) return;
        
        if ((text && text.toLowerCase().includes(q)) || (href && href.toLowerCase().includes(q))) {
          seen.add(key);
          items.push({ text: text || href, meta: href, url: href });
        }
      });
      
      return items;
    },
    onSelect: (item) => {
      if (item?.url) {
        window.open(item.url, '_blank', 'noopener');
      } else {
        inputEl.value = item.text;
        applyFilters();
      }
    }
  });
}
