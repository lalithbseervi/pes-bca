/**
 * Get nesting level of a details element
 * @param {HTMLElement} element - The details element to check
 * @returns {number} The nesting level
 */
export function getDetailsLevel(element) {
    let level = 0;
    let parent = element.parentElement;
    while (parent) {
        if (parent.tagName === 'DETAILS') {
            level++;
        }
        parent = parent.parentElement;
    }
    return level;
}

/**
 * Apply search filters to resource list
 * @param {string} searchInputId - ID of the search input element
 * @param {string} contentAreaId - ID of the content area container
 * @param {string} noResultsId - ID of the no results message element
 */
export function applyFilters(searchInputId = 'search-input', contentAreaId = 'content-area', noResultsId = 'no-results') {
    const searchTerm = document.getElementById(searchInputId)?.value.toLowerCase().trim();
    const contentArea = document.getElementById(contentAreaId);
    const noResults = document.getElementById(noResultsId);
    
    if (!searchTerm || !contentArea || !noResults) {
        if (!searchTerm) {
            clearFilters(searchInputId, contentAreaId, noResultsId);
        }
        return;
    }
    
    let foundAny = false;
    
    // Search through all links
    const allLinks = contentArea.querySelectorAll('a');
    allLinks.forEach(link => {
        const text = link.textContent.toLowerCase();
        const href = link.getAttribute('href')?.toLowerCase() || '';
        const matches = text.includes(searchTerm) || href.includes(searchTerm);
        
        // Find the closest parent li
        let listItem = link.closest('li');
        if (listItem) {
            if (matches) {
                listItem.style.display = '';
                foundAny = true;
                
                // Show all parent details elements
                let parent = listItem.parentElement;
                while (parent) {
                    if (parent.tagName === 'DETAILS') {
                        parent.open = true;
                        parent.style.display = '';
                    }
                    if (parent.tagName === 'LI') {
                        parent.style.display = '';
                    }
                    parent = parent.parentElement;
                }
            } else {
                // Only hide leaf items (items without nested details)
                const hasNestedDetails = listItem.querySelector('details');
                if (!hasNestedDetails) {
                    listItem.style.display = 'none';
                }
            }
        }
    });
    
    // Hide empty details sections
    contentArea.querySelectorAll('details').forEach(details => {
        const visibleItems = Array.from(details.querySelectorAll(':scope > ul > li')).filter(li => {
            return li.style.display !== 'none';
        });
        
        if (visibleItems.length === 0) {
            details.style.display = 'none';
        } else {
            details.style.display = '';
        }
    });
    
    noResults.style.display = foundAny ? 'none' : 'block';
    contentArea.style.display = foundAny ? 'block' : 'none';
}

/**
 * Clear all search filters and reset view
 * @param {string} searchInputId - ID of the search input element
 * @param {string} contentAreaId - ID of the content area container
 * @param {string} noResultsId - ID of the no results message element
 * @param {number} defaultOpenLevels - Number of detail levels to open by default (default: 2)
 */
export function clearFilters(searchInputId = 'search-input', contentAreaId = 'content-area', noResultsId = 'no-results', defaultOpenLevels = 2) {
    const searchInput = document.getElementById(searchInputId);
    const contentArea = document.getElementById(contentAreaId);
    const noResults = document.getElementById(noResultsId);
    
    if (searchInput) searchInput.value = '';
    if (!contentArea || !noResults) return;
    
    // Show all items
    contentArea.querySelectorAll('li, details').forEach(el => {
        el.style.display = '';
    });
    
    // Reset details to initial state (first N levels open)
    contentArea.querySelectorAll('details').forEach(details => {
        const level = getDetailsLevel(details);
        details.open = level < defaultOpenLevels;
    });
    
    noResults.style.display = 'none';
    contentArea.style.display = 'block';
}

/**
 * Initialize search on Enter key
 * @param {string} searchInputId - ID of the search input element
 * @param {string} contentAreaId - ID of the content area container
 * @param {string} noResultsId - ID of the no results message element
 */
export function initializeSearchOnEnter(searchInputId = 'search-input', contentAreaId = 'content-area', noResultsId = 'no-results') {
    const searchInput = document.getElementById(searchInputId);
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                applyFilters(searchInputId, contentAreaId, noResultsId);
            }
        });
    }
}

/**
 * Initialize details toggle behavior
 * @param {string} contentAreaId - ID of the content area container (optional, defaults to entire document)
 * @param {number} defaultOpenLevels - Number of detail levels to open by default (default: 2)
 */
export function initializeDetailsToggle(contentAreaId = null, defaultOpenLevels = 2) {
    const container = contentAreaId ? document.getElementById(contentAreaId) : document;
    if (!container) return;
    
    // Open first N levels
    container.querySelectorAll('details').forEach(function (details) {
        const level = getDetailsLevel(details);
        if (level < defaultOpenLevels) {
            details.open = true;
        }
    });

    // Close all child <details> when a parent <details> is closed
    container.querySelectorAll('details').forEach(function (details) {
        details.addEventListener('toggle', function () {
            if (!details.open) {
                details.querySelectorAll('details').forEach(function (child) {
                    child.open = false;
                });
            }
        });
    });
}
