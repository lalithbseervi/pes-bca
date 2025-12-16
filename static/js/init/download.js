/**
 * Download Manager Module
 * Handles batch file downloads with queue management, progress tracking, retries, and rate limiting
 * Reusable for both SSR and CSR contexts
 */

import { API_BASE_URL } from '/js/utils.js';

const CACHE_KEY = 'all_resources_snapshot_v2';
const CONCURRENT_DOWNLOADS = 2;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY = 1000;

/**
 * Initialize download manager for a page
 * @param {Object} options - Configuration options
 * @param {string} options.cacheKey - LocalStorage cache key for resources
 * @param {number} options.concurrentDownloads - Max concurrent downloads
 * @param {number} options.retryAttempts - Max retry attempts
 * @returns {Promise<Object>} Download manager instance
 */
export async function initDownloadManager(options = {}) {
  const opts = {
    cacheKey: CACHE_KEY,
    concurrentDownloads: CONCURRENT_DOWNLOADS,
    retryAttempts: RETRY_ATTEMPTS,
    ...options
  };

  // State management
  let allResources = [];
  let downloadQueue = [];
  let activeDownloads = 0;
  let cancelled = false;
  let stats = { total: 0, downloading: 0, completed: 0, failed: 0 };

  /**
   * Load cached resources from localStorage
   */
  function loadCachedResources() {
    try {
      const raw = localStorage.getItem(opts.cacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Failed to load cached resources', e);
      return [];
    }
  }

  /**
   * Build download URL for a resource
   */
  function buildDownloadUrl(resource) {
    // Use storage_key from the resource metadata if available (includes course prefix)
    // This ensures the path matches exactly what's stored in Supabase
    if (resource.storage_key) {
      console.log('Using storage_key:', resource.storage_key, 'for', resource.filename);
      return `${API_BASE_URL}/api/file/${resource.storage_key}`;
    }
    
    // Fallback: reconstruct path (legacy support, may be missing course prefix)
    const semester = resource.semester || 'sem-1';
    const subject = resource.subject;
    const type = resource.resource_type || 'Miscellaneous';
    const filename = resource.filename;
    const unit = resource.unit;

    let unitSegment;
    if (unit === 'all') {
      unitSegment = 'unit-all';
    } else if (unit !== null && !isNaN(Number(unit))) {
      unitSegment = `unit-${Number(unit)}`;
    } else {
      unitSegment = 'unit-1';
    }
    
    const path = `${semester}/${subject}/${type}/${unitSegment}/${filename}`;
    console.warn('Reconstructing path (missing storage_key):', path, 'for', resource.filename);
    return `${API_BASE_URL}/api/file/${path}`;
  }

  /**
   * Populate semester dropdown
   */
  function populateSemesters() {
    const semesters = [...new Set(allResources.map(r => r.semester).filter(Boolean))].sort();
    const select = document.getElementById('semester-select');
    
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Semester</option>' +
      semesters.map(s => `<option value="${s}">${s}</option>`).join('');
  }

  /**
   * Populate subjects based on selected semester
   */
  function populateSubjects(semester) {
    const subjects = [...new Set(
      allResources
        .filter(r => r.semester === semester)
        .map(r => r.subject)
        .filter(Boolean)
    )].sort();
    
    const select = document.getElementById('subject-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Subject</option>' +
      subjects.map(s => `<option value="${s}">${s.toUpperCase()}</option>`).join('');
    select.disabled = false;
  }

  /**
   * Populate units based on semester and subject
   */
  function populateUnits(semester, subject) {
    const units = [...new Set(
      allResources
        .filter(r => r.semester === semester && r.subject === subject)
        .map(r => r.unit)
        .filter(u => u !== null && u !== undefined)
    )].sort((a, b) => {
      if (a === 'all') return 1;
      if (b === 'all') return -1;
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a).localeCompare(String(b));
    });
    
    const select = document.getElementById('unit-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Unit</option>' +
      units.map(u => {
        const label = u === 'all' ? 'All Units' : `Unit ${u}`;
        return `<option value="${u}">${label}</option>`;
      }).join('');
    select.disabled = false;
  }

  /**
   * Populate resource types based on filters
   */
  function populateTypes(semester, subject, unit) {
    const types = [...new Set(
      allResources
        .filter(r => r.semester === semester && r.subject === subject && r.unit == unit)
        .map(r => r.resource_type)
        .filter(Boolean)
    )].sort();
    
    const select = document.getElementById('type-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">All Types</option>' +
      types.map(t => `<option value="${t}">${t}</option>`).join('');
    select.disabled = false;
  }

  /**
   * Get filtered resources based on current selections
   */
  function getFilteredResources() {
    const semesterSelect = document.getElementById('semester-select');
    const subjectSelect = document.getElementById('subject-select');
    const unitSelect = document.getElementById('unit-select');
    const typeSelect = document.getElementById('type-select');

    if (!semesterSelect || !subjectSelect || !unitSelect) return [];

    const semester = semesterSelect.value;
    const subject = subjectSelect.value;
    const unit = unitSelect.value;
    const type = typeSelect ? typeSelect.value : '';

    return allResources.filter(r => {
      if (r.semester !== semester) return false;
      if (r.subject !== subject) return false;
      if (r.unit != unit) return false;
      if (type && r.resource_type !== type) return false;
      return true;
    });
  }

  /**
   * Format bytes to human-readable format
   */
  function formatBytes(bytes) {
    if (!bytes) return 'Unknown';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Update stats display
   */
  function updateStats() {
    const totalEl = document.getElementById('stat-total');
    const downloadingEl = document.getElementById('stat-downloading');
    const completedEl = document.getElementById('stat-completed');
    const failedEl = document.getElementById('stat-failed');

    if (totalEl) totalEl.textContent = stats.total;
    if (downloadingEl) downloadingEl.textContent = stats.downloading;
    if (completedEl) completedEl.textContent = stats.completed;
    if (failedEl) failedEl.textContent = stats.failed;
  }

  /**
   * Download a single file with retry logic
   */
  async function downloadFile(item, retries = opts.retryAttempts) {
    const { resource, element } = item;
    
    try {
      const url = buildDownloadUrl(resource);
      console.log('Downloading:', resource.filename, 'from', url);
      
      const statusIcon = element.querySelector('.file-status');
      const fileName = element.querySelector('.file-name');
      
      if (statusIcon) {
        statusIcon.textContent = '⬇️';
      }
      if (fileName) {
        fileName.classList.remove('status-pending', 'status-failed');
        fileName.classList.add('status-downloading');
      }
      
      stats.downloading++;
      updateStats();
      
      const response = await fetch(url);
      console.log('Response status:', response.status, 'for', resource.filename);
      
      if (!response.ok) {
        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After') || '60';
          const violationCount = response.headers.get('X-RateLimit-Violation-Count') || '1';
          const errorData = await response.json().catch(() => ({}));
          const resetTime = errorData.resetAt ? new Date(errorData.resetAt).toLocaleTimeString() : 'soon';
          
          cancelled = true;
          downloadQueue = [];
          
          const minutes = Math.ceil(retryAfter / 60);
          const timeStr = minutes >= 1 ? `${minutes} minute${minutes !== 1 ? 's' : ''}` : `${retryAfter} seconds`;
          
          let message = `⚠️ Rate Limit Exceeded\n\n${errorData.message || 'Too many download requests.'}\n\nPlease wait ${timeStr} before trying again.\nLimit resets at: ${resetTime}`;
          
          if (errorData.penaltyActive && errorData.violationCount > 1) {
            message += `\n\n⚠️ Warning: Repeated violations increase timeout duration exponentially.\nThis is violation #${violationCount}.`;
          } else {
            message += `\n\nTip: The download page automatically limits concurrent downloads to stay within limits.`;
          }
          
          alert(message);
          throw new Error(`Rate limit exceeded. Retry after ${timeStr}`);
        }
        
        const errorText = await response.text().catch(() => 'No error details');
        console.error('Download failed:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
      }
      
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = resource.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
      
      if (statusIcon) statusIcon.textContent = '✅';
      if (fileName) {
        fileName.classList.remove('status-downloading');
        fileName.classList.add('status-completed');
      }
      stats.downloading--;
      stats.completed++;
      updateStats();
      
      if (stats.completed + stats.failed === stats.total) {
        const cancelBtn = document.getElementById('cancel-btn');
        const startBtn = document.getElementById('start-download-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (startBtn) startBtn.disabled = false;
      }
      
      return true;
    } catch (error) {
      console.error('Download failed for', resource.filename, '- Error:', error.message);
      
      if (retries > 0 && !cancelled) {
        console.log(`Retrying ${resource.filename} (${retries} attempts left)...`);
        stats.downloading--;
        updateStats();
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return downloadFile(item, retries - 1);
      }
      
      const statusIcon = element.querySelector('.file-status');
      const fileName = element.querySelector('.file-name');
      
      if (statusIcon) statusIcon.textContent = '❌';
      if (fileName) {
        fileName.classList.remove('status-downloading', 'status-pending');
        fileName.classList.add('status-failed');
      }
      
      if (!element.querySelector('.retry-btn')) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'retry-btn';
        retryBtn.textContent = '↻ Retry';
        retryBtn.onclick = () => retryDownload(item);
        element.appendChild(retryBtn);
      }
      
      if (stats.downloading > 0) {
        stats.downloading--;
      }
      stats.failed++;
      updateStats();
      
      if (stats.completed + stats.failed === stats.total) {
        const cancelBtn = document.getElementById('cancel-btn');
        const startBtn = document.getElementById('start-download-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (startBtn) startBtn.disabled = false;
      }
      
      console.error(`Final failure for ${resource.filename} after all retries`);
      return false;
    }
  }

  /**
   * Process download queue with concurrent limits
   */
  async function processQueue() {
    while (downloadQueue.length > 0 && !cancelled) {
      if (activeDownloads < opts.concurrentDownloads) {
        const item = downloadQueue.shift();
        activeDownloads++;
        
        downloadFile(item).finally(() => {
          activeDownloads--;
          processQueue();
        });
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Start batch download
   */
  async function startDownload() {
    const resources = getFilteredResources();
    
    if (resources.length === 0) {
      alert('No files found for the selected criteria.');
      return;
    }

    // Pre-check rate limit status
    try {
      const rlRes = await fetch(`${API_BASE_URL}/api/rate-limit/status`);
      if (rlRes.ok) {
        const info = await rlRes.json();
        if (!info.allowed) {
          const minutes = info.retryAfter ? Math.ceil(info.retryAfter / 60) : null;
          const timeStr = minutes && minutes >= 1 ? `${minutes} minute${minutes !== 1 ? 's' : ''}` : `${info.retryAfter || 60} seconds`;
          const resetStr = info.resetAt ? new Date(info.resetAt).toLocaleTimeString() : 'soon';
          
          alert(`⚠️ Rate Limit Active\n\nDownloads are temporarily blocked due to recent activity.\nPlease wait ${timeStr} and try again.\nLimit resets at: ${resetStr}`);
          return;
        }
      }
    } catch (e) {
      console.warn('Rate limit status check failed:', e);
    }
    
    cancelled = false;
    downloadQueue = [];
    stats = { total: resources.length, downloading: 0, completed: 0, failed: 0 };
    
    const fileList = document.getElementById('file-list');
    if (fileList) {
      fileList.innerHTML = '';
      
      resources.forEach(resource => {
        const element = document.createElement('div');
        element.className = 'file-item';
        element.innerHTML = `
          <div class="file-status status-pending">⏳</div>
          <div class="file-name status-pending">${resource.link_title || resource.filename}</div>
        `;
        fileList.appendChild(element);
        
        downloadQueue.push({ resource, element });
      });
    }
    
    updateStats();
    
    const progressSection = document.getElementById('progress-section');
    const startBtn = document.getElementById('start-download-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    
    if (progressSection) progressSection.classList.add('active');
    if (startBtn) startBtn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
    
    processQueue();
  }

  /**
   * Retry a failed download
   */
  async function retryDownload(item) {
    const { element } = item;
    const retryBtn = element.querySelector('.retry-btn');
    
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying...';
    }
    
    stats.failed--;
    updateStats();
    
    const success = await downloadFile(item, 0);
    
    if (success && retryBtn) {
      retryBtn.remove();
    } else if (retryBtn) {
      retryBtn.disabled = false;
      retryBtn.textContent = '↻ Retry';
    }
  }

  /**
   * Cancel all pending downloads
   */
  function cancelDownloads() {
    cancelled = true;
    downloadQueue = [];
    const startBtn = document.getElementById('start-download-btn');
    if (startBtn) startBtn.disabled = false;
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    const semesterSelect = document.getElementById('semester-select');
    const subjectSelect = document.getElementById('subject-select');
    const unitSelect = document.getElementById('unit-select');
    const startBtn = document.getElementById('start-download-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    if (semesterSelect) {
      semesterSelect.addEventListener('change', (e) => {
        const semester = e.target.value;
        if (subjectSelect) {
          subjectSelect.innerHTML = '<option value="">Select Semester First</option>';
          subjectSelect.disabled = true;
        }
        if (unitSelect) {
          unitSelect.innerHTML = '<option value="">Select Subject First</option>';
          unitSelect.disabled = true;
        }
        if (startBtn) startBtn.disabled = true;
        
        if (semester) {
          populateSubjects(semester);
        }
      });
    }

    if (subjectSelect) {
      subjectSelect.addEventListener('change', (e) => {
        const semester = semesterSelect ? semesterSelect.value : '';
        const subject = e.target.value;
        if (unitSelect) {
          unitSelect.innerHTML = '<option value="">Select Subject First</option>';
          unitSelect.disabled = true;
        }
        if (startBtn) startBtn.disabled = true;
        
        if (semester && subject) {
          populateUnits(semester, subject);
        }
      });
    }

    if (unitSelect) {
      unitSelect.addEventListener('change', (e) => {
        const semester = semesterSelect ? semesterSelect.value : '';
        const subject = subjectSelect ? subjectSelect.value : '';
        const unit = e.target.value;
        if (startBtn) startBtn.disabled = true;
        
        if (semester && subject && unit) {
          populateTypes(semester, subject, unit);
          if (startBtn) startBtn.disabled = false;
        }
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', startDownload);
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', cancelDownloads);
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      allResources = loadCachedResources();
      
      if (allResources.length === 0) {
        alert('No resources cached. Please visit the homepage first to load resources.');
        return;
      }
      
      populateSemesters();
      setupEventListeners();
    });
  } else {
    allResources = loadCachedResources();
    
    if (allResources.length > 0) {
      populateSemesters();
    }
    
    setupEventListeners();
  }

  return {
    stats: () => stats,
    isActive: () => !cancelled && activeDownloads > 0,
    cancel: cancelDownloads
  };
}
