/**
 * PDF Viewer Initialization Module
 * Handles PDF loading, path parsing, and navigation
 * Reusable for both SSR (initial load) and CSR (router navigation)
 */

import { API_BASE_URL } from '/js/utils.js';

/**
 * Initialize PDF viewer for a given document
 * @param {string} pdfPath - PDF file path (semantic or full URL)
 * @param {string} title - Optional document title
 * @param {Object} options - Configuration options
 * @param {boolean} options.loadViewer - Whether to immediately load the viewer (default: true)
 * @param {boolean} options.buildNavigation - Whether to build next/prev navigation (default: true)
 * @returns {Promise<Object>} Initialization state with parsed paths and viewer loaded flag
 */
export async function initPDFViewer(pdfPath, title, options = {}) {
  const opts = { loadViewer: true, buildNavigation: true, ...options };
  
  // Global variables for navigation
  let semester, subjectCode, unit, filename, displayTitle = title;
  let normalizedPdfPath = pdfPath;

  // Helper: extract resource id from a /api/resources/<id>/stream style path
  function extractResourceId(path) {
    if (!path) return null;
    try {
      const u = new URL(path, window.location.href);
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('resources');
      if (idx !== -1 && parts.length > idx + 1) return parts[idx + 1];
    } catch (e) {
      const m = String(path).match(/api\/resources\/([-a-f0-9]{8,})/i);
      if (m) return m[1];
    }
    return null;
  }

  // Helper: extract subject from file path
  function extractSubjectFromPath(path) {
    const match = path.match(/\/(wd|cfp|mp|mfca|pce|ciep)\//i);
    return match ? match[1].toUpperCase() : 'Unknown';
  }

  // Helper: extract unit from file path
  function extractUnitFromPath(path) {
    const match = path.match(/unit[-_]?(\d+)/i);
    return match ? `Unit ${match[1]}` : 'Unknown';
  }

  /**
   * Show PDF error message in container
   */
  function showPdfError(message, details) {
    const container = document.getElementById('pdf-container');
    container.innerHTML = `
      <div class="loading-message" role="alert">
        <h2>Unable to load document</h2>
        <p>${message}</p>
        <p style="color:#aaa;font-size:0.9rem">${details || ''}</p>
      </div>
    `;
    if (window.posthog) {
      posthog.capture('pdf_view_error', {
        pdf_path: pdfPath,
        error_message: message,
        details: details || null,
        url: window.location.href
      });
    }
  }

  /**
   * Check if PDF is available and accessible
   */
  async function checkPdfAvailable(path) {
    try {
      if (typeof path === 'string' && path.startsWith('blob:')) {
        return { ok: true, status: 200, contentType: 'application/pdf' };
      }
      const absUrl = new URL(path, window.location.href).href;
      let r = await fetch(absUrl, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) {
        return { ok: true, status: r.status, contentType: r.headers.get('content-type') };
      }
      r = await fetch(absUrl, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-0' },
        cache: 'no-store',
        credentials: 'include'
      });
      if (r.ok || r.status === 206) {
        return { ok: true, status: r.status, contentType: r.headers.get('content-type') };
      }
      return { ok: false, status: r.status, statusText: r.statusText };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  /**
   * Load and display PDF viewer
   */
  async function loadPdfViewer() {
    let fileToUse = normalizedPdfPath || pdfPath;

    try {
      const fileUrl = new URL(fileToUse, window.location.href);
      const isCrossOrigin = fileUrl.origin !== window.location.origin;
      
      if (fileToUse && (fileToUse.startsWith('http://') || fileToUse.startsWith('https://'))) {
        if (isCrossOrigin) {
          try {
            const resp = await fetch(fileToUse, { 
              cache: 'no-store', 
              credentials: 'include' 
            });
            
            if (resp.ok) {
              const ab = await resp.arrayBuffer();
              if (ab.byteLength < 8) {
                console.warn('PDF fetch returned too few bytes');
                showPdfError('Invalid PDF file.', 'File too small.');
                return;
              }
              
              const headerBytes = new Uint8Array(ab.slice(0, 8));
              const isPdf = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && 
                            headerBytes[2] === 0x44 && headerBytes[3] === 0x46 && 
                            headerBytes[4] === 0x2D;
              
              if (!isPdf) {
                console.error('File does not appear to be a PDF (missing %PDF- signature).');
                showPdfError('File is not a valid PDF.', 'Missing %PDF- header.');
                return;
              }
              
              const blob = new Blob([ab], { type: 'application/pdf' });
              fileToUse = URL.createObjectURL(blob);
              console.log('Cross-origin PDF: using blob URL (full download)');
            } else {
              console.warn('PDF fetch failed', resp.status);
              showPdfError('Cannot access PDF file.', `HTTP ${resp.status}`);
              return;
            }
          } catch (e) {
            console.warn('PDF fetch failed:', e);
            showPdfError('Failed to load PDF.', e.message);
            return;
          }
        } else {
          try {
            const headResp = await fetch(fileToUse, { 
              method: 'HEAD',
              cache: 'no-store', 
              credentials: 'include' 
            });
            
            if (!headResp.ok) {
              const rangeResp = await fetch(fileToUse, {
                headers: { 'Range': 'bytes=0-7' },
                cache: 'no-store',
                credentials: 'include'
              });
              
              if (rangeResp.ok || rangeResp.status === 206) {
                const headerBytes = new Uint8Array(await rangeResp.arrayBuffer());
                const isPdf = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && 
                              headerBytes[2] === 0x44 && headerBytes[3] === 0x46 && 
                              headerBytes[4] === 0x2D;
                
                if (!isPdf) {
                  showPdfError('File is not a valid PDF.', 'Missing %PDF- header.');
                  return;
                }
                console.log('Same-origin PDF: using direct URL (lazy range requests)');
              } else {
                showPdfError('Cannot access PDF file.', `HTTP ${rangeResp.status}`);
                return;
              }
            } else {
              console.log('Same-origin PDF: using direct URL (lazy range requests)');
            }
          } catch (e) {
            console.warn('Pre-flight check failed:', e);
          }
        }
      }
    } catch (e) {
      console.warn('PDF preparation error:', e);
    }

    const info = await checkPdfAvailable(fileToUse);
    if (!info.ok) {
      const msg = info.status ? `HTTP ${info.status} ${info.statusText || ''}` : (info.error || 'File not found or network error');
      showPdfError('The requested PDF could not be found or accessed.', `${msg}`);
      console.warn('PDF check failed', info);
      return;
    }

    let pdfViewerUrl = `/pdfjs/web/viewer.html?file=${(fileToUse)}`;
    try {
      const orig = (displayTitle && displayTitle.trim()) ? displayTitle.trim() : null;
      if (orig) pdfViewerUrl += `&origFilename=${(orig)}`;
    } catch (e) { }
    
    document.getElementById('pdf-container').innerHTML = `
      <div style="width: 100%; height: 90vh;">
        <iframe src="${pdfViewerUrl}" 
            style="width: 100%; height: 100%; border: none;"
            allow="fullscreen"
            loading="lazy">
          <p>Loading PDF viewer...</p>
        </iframe>
      </div>
    `;

    // Track PDF view with PostHog
    const sessionData = sessionStorage.getItem('user_session');
    if (window.posthog && sessionData) {
      try {
        const session = JSON.parse(sessionData);

        if (window.isPIITrackingAllowed && window.isPIITrackingAllowed()) {
          posthog.identify(session.srn, {
            srn: session.srn,
            name: session.profile.name || session.srn,
            branch: session.profile?.branch,
            semester: session.profile?.semester,
            is_pwa: window.matchMedia('(display-mode: standalone)').matches
          });
          posthog.capture('pdf_viewed', {
            pdf_path: pdfPath,
            pdf_title: displayTitle || 'Unknown',
            file_name: pdfPath.split('/').pop(),
            subject: extractSubjectFromPath(pdfPath),
            unit: extractUnitFromPath(pdfPath),
            view_timestamp: new Date().toISOString(),
            referrer: document.referrer,
            is_pwa: window.matchMedia('(display-mode: standalone)').matches
          });
        } else {
          posthog.capture('pdf_viewed', {
            pdf_title: displayTitle || 'Unknown',
            subject: extractSubjectFromPath(pdfPath),
            unit: extractUnitFromPath(pdfPath),
            view_timestamp: new Date().toISOString(),
            is_pwa: window.matchMedia('(display-mode: standalone)').matches
          });
        }
      } catch (error) {
        console.error('PostHog tracking error:', error);
      }
    }
  }

  /**
   * Build next/previous PDF navigation
   */
  async function buildNav() {
    try {
      const prevBtn = document.getElementById('pdf-prev');
      const nextBtn = document.getElementById('pdf-next');

      console.debug('buildNav (API-driven): start', { subjectCode, filename, semester });

      if (!subjectCode || !filename) {
        console.debug('buildNav: missing subjectCode or filename for navigation');
        return;
      }

      const apiUrl = `${API_BASE_URL}/api/subject/resources?subject=${(subjectCode)}&_t=${Date.now()}`;
      const resp = await fetch(apiUrl, { cache: 'no-store' });

      if (!resp.ok) {
        console.warn('buildNav: API fetch failed', resp.status);
        return;
      }

      const data = await resp.json();
      if (!data.resources) {
        console.warn('buildNav: no resources in API response');
        return;
      }

      const files = [];
      for (const [unitNum, types] of Object.entries(data.resources)) {
        for (const [type, resources] of Object.entries(types)) {
          for (const resource of resources) {
            files.push(resource);
          }
        }
      }

      if (!files.length) {
        console.debug('buildNav: no files found for subject', subjectCode);
        return;
      }

      if (files.length > 0) {
        console.debug('buildNav: sample resource fields:', Object.keys(files[0]));
        console.debug('buildNav: sample resource:', files[0]);
      }

      files.sort((a, b) => {
        const unitA = parseInt(a.unit) || 999;
        const unitB = parseInt(b.unit) || 999;
        if (unitA !== unitB) return unitA - unitB;

        const aFilename = a.filename || '';
        const bFilename = b.filename || '';
        const aMatch = aFilename.match(/^(\d+)/);
        const bMatch = bFilename.match(/^(\d+)/);
        const aNum = aMatch ? parseInt(aMatch[1]) : 999999;
        const bNum = bMatch ? parseInt(bMatch[1]) : 999999;

        return aNum - bNum;
      });

      const idx = files.findIndex(f => f.filename === filename);
      if (idx === -1) {
        console.debug('buildNav: current file not found in resources', filename);
        return;
      }

      if (prevBtn && idx > 0) {
        const prev = files[idx - 1];
        let prevPath;
        if (!prev.url) {
          if (String(prev.unit) === 'all') {
            const typeSeg = prev.resource_type || prev.type || 'Other';
            prevPath = `sem-${semester}/${subjectCode}/${typeSeg}/unit-all/${(prev.filename || '')}`;
          } else {
            prevPath = `sem-${semester}/${subjectCode}/unit-${prev.unit}/${(prev.filename || '')}`;
          }
        } else {
          prevPath = null;
        }
        prevBtn.href = prev.url || `/pdf-viewer?file=${(prevPath)}&title=${((prev.title || prev.filename || '').toString())}`;
        prevBtn.innerText = '← ' + (prev.title || prev.filename || 'Prev');
        prevBtn.title = (prev.title || prev.filename || 'Previous document');
        prevBtn.style.display = 'inline-block';
        prevBtn.setAttribute('aria-hidden', 'false');
      }
      if (nextBtn && idx < files.length - 1) {
        const next = files[idx + 1];
        let nextPath;
        if (!next.url) {
          if (String(next.unit) === 'all') {
            const typeSeg = next.resource_type || next.type || 'Other';
            nextPath = `sem-${semester}/${subjectCode}/${typeSeg}/unit-all/${(next.filename || '')}`;
          } else {
            nextPath = `sem-${semester}/${subjectCode}/unit-${next.unit}/${(next.filename || '')}`;
          }
        } else {
          nextPath = null;
        }
        nextBtn.href = next.url || `/pdf-viewer?file=${(nextPath)}&title=${((next.title || next.filename || '').toString())}`;
        nextBtn.innerText = (next.title || next.filename || 'Next') + ' →';
        nextBtn.title = (next.title || next.filename || 'Next document');
        nextBtn.style.display = 'inline-block';
        nextBtn.setAttribute('aria-hidden', 'false');
      }
    } catch (err) {
      console.warn('buildNav (API-driven) failed', err);
    }
  }

  // Parse URL parameters to extract PDF path and metadata
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  
  if (!pdfPath) {
    pdfPath = urlParams.get('file');
  }
  if (!displayTitle) {
    displayTitle = urlParams.get('title');
  }

  // Check if file param is a semantic path
  if (pdfPath && !pdfPath.startsWith('http') && !pdfPath.startsWith('/api/')) {
    const pathParts = pdfPath.split('/').filter(Boolean);

    // Pattern A: sem-N/<subject>/unit-N/<filename>
    if (pathParts.length === 4) {
      const semMatch = pathParts[0].match(/^sem-(\d+)$/);
      const unitMatch = pathParts[2].match(/^unit-(\d+)$/);
      if (semMatch && unitMatch) {
        semester = semMatch[1];
        subjectCode = pathParts[1];
        unit = unitMatch[1];
        filename = decodeURIComponent(pathParts[3]);
        if (!displayTitle) displayTitle = filename.replace(/^\d+_/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        pdfPath = `${API_BASE_URL}/api/resources/sem-${semester}/${subjectCode}/unit-${unit}/${(filename)}`;
      }
    }
    // Pattern B (all-units): sem-N/<subject>/<type>/unit-all/<filename>
    else if (pathParts.length === 5) {
      const semMatch = pathParts[0].match(/^sem-(\d+)$/);
      const typeSegment = pathParts[2];
      const isAllUnit = pathParts[3] === 'unit-all';
      if (semMatch && isAllUnit) {
        semester = semMatch[1];
        subjectCode = pathParts[1];
        unit = 'all';
        filename = decodeURIComponent(pathParts[4]);
        if (!displayTitle) displayTitle = filename.replace(/^\d+_/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        pdfPath = `${API_BASE_URL}/api/resources/sem-${semester}/${subjectCode}/${typeSegment}/unit-all/${(filename)}`;
      }
    }
  }

  // If pdfPath is a relative /api/ path, make it absolute
  if (pdfPath && pdfPath.startsWith('/api/') && !pdfPath.startsWith('http')) {
    pdfPath = API_BASE_URL + pdfPath;
  }

  // Fallback: check for legacy query parameters
  if (!subjectCode) subjectCode = urlParams.get('subjectCode');
  if (!unit) unit = urlParams.get('unit');
  if (!semester) {
    semester = urlParams.get('semester');
    if (!semester && pdfPath) {
      const semMatch = pdfPath.match(/sem-(\d+)/i);
      if (semMatch) semester = semMatch[1];
    }
  }

  normalizedPdfPath = pdfPath;

  // Update page title and header
  if (displayTitle) {
    document.title = displayTitle;
    const pdfTitleEl = document.getElementById('pdf-title');
    if (pdfTitleEl) pdfTitleEl.textContent = displayTitle;
  }

  // Update breadcrumb navigation
  const breadcrumbContentEl = document.getElementById('breadcrumb-content');
  if (breadcrumbContentEl) {
    let displaySubject = null;
    let displaySubjectCode = subjectCode;

    if (!displaySubjectCode && pdfPath) {
      const extractedSubject = extractSubjectFromPath(pdfPath);
      if (extractedSubject && extractedSubject !== 'Unknown') {
        displaySubjectCode = extractedSubject.toLowerCase();
      }
    }

    if (displaySubjectCode) {
      try {
        const apiUrl = `${API_BASE_URL}/api/subject/resources?subject=${(displaySubjectCode)}`;
        const resp = await fetch(apiUrl, { cache: 'no-store' });
        if (resp.ok) {
          const data = await resp.json();
          displaySubject = data.subjectName || displaySubjectCode.toUpperCase();
        } else {
          displaySubject = displaySubjectCode.toUpperCase();
        }
      } catch (e) {
        console.warn('Failed to fetch subject name from API, using fallback', e);
        displaySubject = displaySubjectCode.toUpperCase();
      }
    }

    let breadcrumbHTML = '';
    if (displaySubject && displaySubjectCode) {
      const semesterPath = semester ? `/sem-${semester}/${displaySubjectCode}/` : `/#subject-${displaySubjectCode}`;
      breadcrumbHTML += `<a href="${semesterPath}">${displaySubject}</a>`;

      if (unit) {
        breadcrumbHTML += `<span class="separator" style="margin: 0 0.5rem;">/</span>`;
        breadcrumbHTML += `<a href="${semesterPath}">Unit ${unit}</a>`;
      }

      if (displayTitle) {
        breadcrumbHTML += `<span class="separator" style="margin: 0 0.5rem;">/</span>`;
        breadcrumbHTML += `<span class="current">${displayTitle}</span>`;
      }
    } else if (displayTitle) {
      breadcrumbHTML = `<span class="current">${displayTitle}</span>`;
    }

    if (breadcrumbHTML) {
      breadcrumbContentEl.innerHTML = breadcrumbHTML;
    }

    const pdfHeaderEl = document.getElementById('pdf-header');
    if (pdfHeaderEl && displayTitle) {
      pdfHeaderEl.style.display = 'block';
    }
  }

  if (!pdfPath) {
    document.getElementById('pdf-container').innerHTML = '<h2>Error: No file specified</h2>';
    if (window.posthog) {
      posthog.capture('pdf_viewer_error', {
        error: 'No file specified',
        url: window.location.href
      });
    }
    return { pdfPath: null, title: displayTitle, loaded: false };
  }

  // Load PDF viewer if requested and session is valid
  if (opts.loadViewer && sessionStorage.getItem('user_session')) {
    await loadPdfViewer();
  }

  // Build navigation if requested
  if (opts.buildNavigation) {
    await buildNav();
  }

  // Expose loadPdfViewer globally for delayed calls
  window.loadPdfViewer = loadPdfViewer;

  return {
    pdfPath: normalizedPdfPath,
    title: displayTitle,
    semester,
    subjectCode,
    unit,
    filename,
    loaded: opts.loadViewer
  };
}
