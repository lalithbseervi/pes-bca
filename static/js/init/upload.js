/**
 * Upload Manager Module
 * Handles file upload form validation, title formatting, subject/elective selection
 * Reusable for both SSR and CSR contexts
 */

import { API_BASE_URL, showAlert } from '/js/utils.js';

/**
 * Initialize upload manager for the upload form
 * @param {Object} options - Configuration options
 * @param {string} options.formSelector - CSS selector for form (default: #upload-form)
 * @returns {Promise<Object>} Upload manager instance
 */
export async function initUploadManager(options = {}) {
  const opts = {
    formSelector: '#upload-form',
    ...options
  };

  const form = document.querySelector(opts.formSelector);
  if (!form) {
    console.warn('Upload form not found:', opts.formSelector);
    return { init: () => {} };
  }

  const fileInput = document.getElementById('file');
  const fileList = document.getElementById('file-list');
  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit-btn');
  const courseSelect = document.getElementById('course');
  const semesterSelect = document.getElementById('semester');
  const subjectSelect = document.getElementById('subject');

  let selectedFiles = [];
  let originalSubmitHTML = submitBtn?.innerHTML || 'Upload';

  /**
   * Format default link title from filename
   */
  function formatDefaultTitle(filename) {
    if (!filename) return '';
    let name = String(filename).replace(/\.[^./\\]+$/i, '');
    name = name.replace(/_[A-Za-z0-9-]+$/i, '');
    name = name.replace(/^\s*0*\d+[\s._-]*/, '');
    name = name.replace(/[_.-]+/g, ' ');
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return '';
    
    const parts = name.split(' ');
    const titled = parts.map(p => {
      if (!p) return p;
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    }).join(' ');
    
    return titled.replace(/\b(To|Of|And|On)\b/g, (m) => m.toLowerCase());
  }

  /**
   * Set uploading UI state
   */
  function setUploading(on) {
    if (on) {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset._orig = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span class="spinner-inline"></span>Uploading...';
      }
      const controls = form.querySelectorAll('input,select,button,textarea');
      controls.forEach(el => { if (el !== submitBtn) el.disabled = true; });
    } else {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = submitBtn.dataset._orig || originalSubmitHTML;
      }
      const controls = form.querySelectorAll('input,select,button,textarea');
      controls.forEach(el => { if (el !== submitBtn) el.disabled = false; });
    }
  }

  /**
   * Update file input from selected files
   */
  function updateFileInputFromSelected() {
    try {
      const dt = new DataTransfer();
      selectedFiles.forEach(sf => dt.items.add(sf.file));
      if (fileInput) fileInput.files = dt.files;
    } catch (e) {
      console.warn('DataTransfer update failed', e);
    }
  }

  /**
   * Render selected files list
   */
  function renderSelectedFiles(list) {
    const arr = list || [];
    if (!fileList) return;
    
    if (!arr.length) {
      fileList.innerHTML = '<small>No files selected</small>';
      return;
    }
    
    fileList.innerHTML = '';
    arr.forEach((sf, idx) => {
      const item = document.createElement('div');
      item.className = 'file-item';

      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = sf.file.name + ' — ' + (Math.round(sf.file.size / 1024) + ' KB');
      item.appendChild(name);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'link-title';
      input.value = sf.title || sf.file.name;
      input.placeholder = 'Link title';
      input.dataset.index = idx;
      item.appendChild(input);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'remove-file';
      btn.setAttribute('aria-label', `Remove ${sf.file.name}`);
      btn.dataset.index = idx;
      btn.innerHTML = '&times;';
      item.appendChild(btn);

      fileList.appendChild(item);
    });
  }

  // Semester -> Subjects mapping
  const semesterSubjects = {
    'Semester-1': [
      { v: 'cfp', t: 'Computing Fundamentals with Python' },
      { v: 'wd', t: 'Web Design' },
      { v: 'mfca', t: 'Mathematical Foundation for Computer Applications' },
      { v: 'mp', t: 'Macro Programming' },
      { v: 'pce', t: 'Professional Communication and Ethics' },
      { v: 'ciep', t: 'CIEP (Constitutional of India, Cyber Law, and Professional Ethics)' }
    ],
    'Semester-2': [
      { v: 'c-programming', t: 'Programming with C' },
      { v: 'dbms', t: 'Database Systems' },
      { v: 'os', t: 'Platforms and Operating Systems' },
      { v: 'computer-org', t: 'Computer Organization and Architecture' },
      { v: 'pd', t: 'Personality Development' },
      { v: 'evs', t: 'Environmental Studies' }
    ],
    'Semester-3': [
      { v: 'dsa', t: 'Data Structures' },
      { v: 'oop', t: 'Object Oriented Programming' },
      { v: 'data-comm', t: 'Data Communication' },
      { v: 'elec1', t: 'Elective I' },
      { v: 'digital-marketing', t: 'Digital Marketing' }
    ],
    'Semester-4': [
      { v: 'algorithms', t: 'Design of Algorithms' },
      { v: 'web-app-design', t: 'Web Application Design' },
      { v: 'software-engg', t: 'Software Engineering' },
      { v: 'elec2', t: 'Elective II' },
      { v: 'cyber-law', t: 'Cyber Law' },
    ],
    'Semester-5': [
      { v: 'waf', t: 'Web Application Framework' },
      { v: 'stats', t: 'Statistics and R Programming' },
      { v: 'elec3', t: 'Elective III' },
      { v: 'elec4', t: 'Elective IV' },
      { v: 'entrepreneurship', t: 'Entrepreneurship' },
    ],
    'Semester-6': [
      { v: 'cloud', t: 'Cloud Technologies' },
      { v: 'intern', t: 'Internship/Swayam/MOOC*' },
    ]
  };

  /**
   * Populate subjects for selected semester
   */
  function populateSubjectsForSemester(sem) {
    const list = semesterSubjects[sem] || [];
    if (!subjectSelect) return;
    
    subjectSelect.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'Select subject';
    subjectSelect.appendChild(emptyOpt);
    
    for (const s of list) {
      const o = document.createElement('option');
      o.value = s.v;
      o.textContent = s.t;
      subjectSelect.appendChild(o);
    }
  }

  // Elective mapping
  const electiveOptions = {
    elec1: [
      { v: 'hci', t: 'Human Computer Interaction' },
      { v: 'wcm', t: 'Web Content Management' },
      { v: 'ecom', t: 'E-Commerce Application Development (Shopify)' },
      { v: 'afm', t: 'Accounting and Financial Management' },
      { v: 'dataviz', t: 'Data Visualization' }
    ],
    elec2: [
      { v: 'linux', t: 'Linux Administration' },
      { v: 'cgg', t: 'Computer Graphics' },
      { v: 'debug', t: 'Debugging and Testing' }
    ],
    elec3: [
      { v: 'dbadmin', t: 'Database Administration' },
      { v: 'anim', t: '2D/ 3D Animation' },
      { v: 'autotest', t: 'Automation Testing' }
    ],
    elec4: [
      { v: 'netadmin', t: 'Network Administration' },
      { v: 'gaming', t: 'Gaming (AR)' },
      { v: 'rpa', t: 'Robotic Process Automation' }
    ]
  };

  const electiveContainer = document.getElementById('elective-container');
  const electiveSelect = document.getElementById('elective_choice');

  /**
   * Populate elective options
   */
  function populateElectiveOptions(elecKey) {
    if (!electiveSelect) return;
    
    electiveSelect.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Select elective';
    electiveSelect.appendChild(empty);
    
    const list = electiveOptions[elecKey] || [];
    for (const it of list) {
      const o = document.createElement('option');
      o.value = it.v;
      o.textContent = it.t;
      electiveSelect.appendChild(o);
    }
  }

  /**
   * Check if file is PDF
   */
  function isPdfFile(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    if (file.type && file.type === 'application/pdf') return true;
    return name.endsWith('.pdf');
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    // Initialize subjects
    if (semesterSelect) {
      populateSubjectsForSemester(semesterSelect.value || 'Semester-1');
      
      semesterSelect.addEventListener('change', (e) => {
        const prev = subjectSelect ? subjectSelect.value : '';
        populateSubjectsForSemester(e.target.value);
        if (prev && subjectSelect) {
          const found = Array.from(subjectSelect.options).some(opt => opt.value === prev);
          if (found) subjectSelect.value = prev;
        }
      });
    }

    // Subject change listener
    if (subjectSelect) {
      subjectSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (['elec1', 'elec2', 'elec3', 'elec4'].includes(val)) {
          populateElectiveOptions(val);
          if (electiveContainer) electiveContainer.style.display = '';
          if (electiveSelect) electiveSelect.required = true;
        } else {
          if (electiveContainer) electiveContainer.style.display = 'none';
          if (electiveSelect) {
            electiveSelect.required = false;
            electiveSelect.value = '';
          }
        }
      });
    }

    // File input change listener
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        selectedFiles = Array.from(fileInput.files || []).map(f => ({
          file: f,
          title: formatDefaultTitle(f.name) || f.name
        }));
        renderSelectedFiles(selectedFiles);
      });
    }

    // File list input listener (title changes)
    if (fileList) {
      fileList.addEventListener('input', (e) => {
        const input = e.target.closest('.link-title');
        if (!input) return;
        const idx = Number(input.dataset.index);
        if (Number.isNaN(idx)) return;
        selectedFiles[idx].title = input.value;
      });

      // File removal listener
      fileList.addEventListener('click', (e) => {
        const btn = e.target.closest('.remove-file');
        if (!btn) return;
        const idx = Number(btn.dataset.index);
        if (Number.isNaN(idx)) return;
        selectedFiles.splice(idx, 1);
        renderSelectedFiles(selectedFiles);
        updateFileInputFromSelected();
      });
    }

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (alertBox) alertBox.innerHTML = '';

      const fd = new FormData();
      const subject = form.querySelector('[name=subject]')?.value;
      const resource_type = form.querySelector('[name=resource_type]')?.value;
      const unit = form.querySelector('[name=unit]')?.value;
      const course = form.querySelector('[name=course]')?.value;
      const semester = form.querySelector('[name=semester]')?.value;

      if (subject) fd.append('subject', subject);
      if (course) fd.append('course', course);
      if (semester) fd.append('semester', semester);
      if (resource_type) fd.append('resource_type', resource_type);
      if (unit) fd.append('unit', unit);

      // Attach performing user's identity
      try {
        const sessionData = sessionStorage.getItem('user_session');
        if (sessionData) {
          const sess = JSON.parse(sessionData);
          const performedBy = (sess && (sess.profile?.name || sess.srn)) || null;
          if (performedBy) fd.append('performed_by', performedBy);
        }
      } catch (e) {
        console.warn('failed to read user_session for performed_by', e);
      }

      const filesToSend = selectedFiles.length ? selectedFiles : 
        Array.from(fileInput?.files || []).map(f => ({
          file: f,
          title: formatDefaultTitle(f.name) || f.name
        }));

      if (!filesToSend.length) {
        showAlert('Please select at least one file', 'error');
        return;
      }

      // Validate PDF files
      for (const sf of filesToSend) {
        if (!isPdfFile(sf.file)) {
          showAlert('Only PDF files are allowed. Remove invalid files and try again.', 'error');
          return;
        }
      }

      // Append files
      for (const sf of filesToSend) {
        fd.append('file', sf.file, sf.file.name);
        fd.append('linkTitle', sf.title || sf.file.name);
      }

      // Append elective choice if present
      const electiveChoice = form.querySelector('[name=elective_choice]')?.value;
      if (electiveChoice) fd.append('elective_choice', electiveChoice);

      setUploading(true);

      try {
        const res = await fetch(`${API_BASE_URL}/api/resources/upload`, {
          method: 'POST',
          body: fd,
          credentials: 'include'
        });
        const j = await res.json().catch(() => ({ success: false, error: 'invalid_json' }));
        
        if (!res.ok || !j || !j.success) {
          const err = (j && (j.error || JSON.stringify(j))) || res.status;
          showAlert('Upload failed: ' + err, 'error');
        } else {
          if (Array.isArray(j.results)) {
            const lines = j.results.map(r => {
              if (r.error) return `${r.filename}: ERROR (${r.error})`;
              if (r.existing) return `${r.filename}: already exists (id=${r.id})`;
              return `${r.filename}: uploaded (id=${r.id})`;
            });
            showAlert(lines.join('<br/>'));
          } else if (j.id) {
            showAlert('Uploaded id: ' + j.id);
          } else {
            showAlert('Upload completed');
          }
          selectedFiles = [];
          if (fileInput) fileInput.value = '';
          renderSelectedFiles([]);
        }
      } catch (err) {
        console.error(err);
        showAlert('Upload failed: network or server error', 'error');
      } finally {
        setUploading(false);
      }
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      renderSelectedFiles([]);
      setupEventListeners();
    });
  } else {
    renderSelectedFiles([]);
    setupEventListeners();
  }

  return {
    selectedFiles: () => selectedFiles,
    setFiles: (files) => {
      selectedFiles = files;
      renderSelectedFiles(selectedFiles);
    }
  };
}
