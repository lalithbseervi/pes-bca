(function(){
  const DB_NAME = 'pes_res_index';
  const DB_VERSION = 1.1;

  function openDB() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('resources')) {
            const os = db.createObjectStore('resources', { keyPath: 'path' });
            os.createIndex('by-added', 'addedAt');
          }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
      } catch (ex) { reject(ex); }
    });
  }

  async function putResource(r) {
    try {
      const db = await openDB();
      return new Promise((res, rej) => {
        const tx = db.transaction('resources', 'readwrite');
        const store = tx.objectStore('resources');
        store.put({ path: r.path, title: r.title || '', addedAt: r.addedAt || Date.now() });
        tx.oncomplete = () => res();
        tx.onerror = ev => rej(ev.target.error);
      });
    } catch (e) { console.warn('pdf-nav: putResource error', e); }
  }

  async function getResourcesWithPrefix(prefix) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('resources', 'readonly');
      const store = tx.objectStore('resources');
      const out = [];
      const req = store.openCursor();
      req.onsuccess = evt => {
        const cur = evt.target.result;
        if (!cur) return resolve(out);
        const p = cur.value.path;
        if (p.startsWith(prefix)) out.push(cur.value);
        cur.continue();
      };
      req.onerror = ev => reject(ev.target.error);
    });
  }

  async function buildPdfNav(pdfPath, prevSelector, nextSelector, opts = {}) {
    try {
      if (!pdfPath) return;
      const prevBtn = document.querySelector(prevSelector);
      const nextBtn = document.querySelector(nextSelector);

      const folder = (pdfPath && pdfPath.lastIndexOf('/') > -1) ? pdfPath.slice(0, pdfPath.lastIndexOf('/') + 1) : '/';
      const folderPrefix = folder.endsWith('/') ? folder : folder + '/';

      // 1) Try DB
      let dbEntries = await getResourcesWithPrefix(folderPrefix).catch(e => { console.warn('pdf-nav: DB read failed', e); return []; });
      let candidates = dbEntries.map(x => x.path);

      // 2) Sitemap fallback
      if (candidates.length < 2) {
        try {
          const res = await fetch('/sitemap.xml', { cache: 'no-store' });
          if (res.ok) {
            const text = await res.text();
            const xml = new DOMParser().parseFromString(text, 'application/xml');
            const locs = Array.from(xml.getElementsByTagName('loc')).map(n => n.textContent).filter(Boolean);
            const files = locs.map(loc => {
              try {
                const u = new URL(loc, window.location.origin);
                if (u.pathname.startsWith('/pdf-viewer')) {
                  const p = u.searchParams.get('file') || '';
                  const dp = decodeURIComponent(p);
                  return dp.startsWith('/') ? dp.replace(/\/+$/,'') : '/' + dp.replace(/\/+$/,'');
                }
                if (u.pathname.includes('/static/')) {
                  const p = u.pathname.replace('/static/', '/');
                  return decodeURIComponent(p).replace(/\/+$/,'') || null;
                }
                return null;
              } catch (e) { return null; }
            }).filter(Boolean);
            for (const fp of files) putResource({ path: fp, title: fp.split('/').pop(), addedAt: Date.now() }).catch(()=>{});
            candidates = files.filter(p => p.startsWith(folderPrefix));
          }
        } catch (e) { console.warn('pdf-nav: sitemap fetch failed', e); }
      }

      // 3) Page-scan fallback
      if (candidates.length < 2) {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const found = [];
        for (const a of anchors) {
          try {
            const u = new URL(a.href, window.location.origin);
            let p = null;
            if (u.pathname.startsWith('/pdf-viewer')) {
              const fp = u.searchParams.get('file'); if (fp) p = decodeURIComponent(fp).replace(/\/+$/,'');
            } else if (u.pathname.includes('/static/')) {
              p = decodeURIComponent(u.pathname.replace('/static/','')).replace(/\/+$/,'');
            }
            if (p && p.startsWith(folderPrefix)) found.push(p);
          } catch (e) { /* ignore */ }
        }
        candidates = Array.from(new Set(found));
        for (const fp of candidates) putResource({ path: fp, title: fp.split('/').pop(), addedAt: Date.now() }).catch(()=>{});
      }

      if (candidates.length < 2) return;
      candidates.sort((a,b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      const normalizedRequested = (pdfPath ? (pdfPath.startsWith('/') ? decodeURIComponent(pdfPath).replace(/\/+$/,'') : '/' + decodeURIComponent(pdfPath).replace(/\/+$/,'')) : '').replace(/\/+$/,'');
      let idx = candidates.indexOf(normalizedRequested);
      if (idx === -1) {
        const requestedName = normalizedRequested.split('/').pop();
        idx = candidates.findIndex(p => p.split('/').pop() === requestedName);
      }
      if (idx === -1) return;

      if (prevBtn && idx > 0) {
        const prevPath = candidates[idx-1];
        prevBtn.href = `/pdf-viewer/?file=${(prevPath)}&title=${(prevPath.split('/').pop())}`;
        prevBtn.style.display = 'inline-block'; prevBtn.setAttribute('aria-hidden','false');
      }
      if (nextBtn && idx < candidates.length-1) {
        const nextPath = candidates[idx+1];
        nextBtn.href = `/pdf-viewer/?file=${(nextPath)}&title=${(nextPath.split('/').pop())}`;
        nextBtn.style.display = 'inline-block'; nextBtn.setAttribute('aria-hidden','false');
      }
    } catch (err) { console.warn('pdf-nav build failed', err); }
  }

  window.buildPdfNav = buildPdfNav;
})();
