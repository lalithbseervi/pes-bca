// Minimal search suggestion module (portal overlay)
// Usage:
//   const sug = createSearchSuggest(inputEl, {getCandidates, onSelect})
//   getCandidates(prefix) -> array of {text, meta}
// Renders a fixed-position overlay in <body> so it appears above all content.

export function createSearchSuggest(inputEl, options = {}) {
  const { getCandidates, onSelect } = options;

  // Create a portal container at body level to avoid stacking issues
  const portal = document.createElement('div');
  portal.style.position = 'fixed';
  portal.style.left = '0px';
  portal.style.top = '0px';
  portal.style.width = 'auto';
  portal.style.zIndex = '2147483647'; // very high
  portal.style.display = 'none';
  portal.style.pointerEvents = 'none'; // allow clicks to pass except on the list itself

  const list = document.createElement('ul');
  list.style.position = 'absolute';
  list.style.margin = '0';
  list.style.padding = '0.25rem 0';
  list.style.listStyle = 'none';
  list.style.background = '#0b1220';
  list.style.border = '1px solid rgba(255,255,255,0.08)';
  list.style.borderRadius = '6px';
  list.style.maxHeight = '260px';
  list.style.overflow = 'auto';
  list.style.minWidth = '180px';
  list.style.boxShadow = '0 10px 24px rgba(0,0,0,0.45)';
  list.style.pointerEvents = 'auto';

  portal.appendChild(list);
  document.body.appendChild(portal);

  let candidates = [];
  let selectedIndex = -1;

  function positionOverlay() {
    const r = inputEl.getBoundingClientRect();
    const top = Math.round(r.bottom + 4); // 4px gap below input
    list.style.left = `${Math.round(r.left)}px`;
    list.style.top = `${top}px`;
    list.style.width = `${Math.round(r.width)}px`;
  }

  function render(items) {
    list.innerHTML = '';
    if (!items || items.length === 0) {
      portal.style.display = 'none';
      return;
    }
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.style.padding = '8px 10px';
      li.style.cursor = 'pointer';
      li.style.color = '#e6eef8';
      li.style.background = '#0b1220';
      li.dataset.index = i;
      li.innerHTML = `<div style=\"font-weight:600\">${escapeHtml(it.text)}</div><div style=\"font-size:0.85em; color:#9aa6b4;\">${escapeHtml(it.meta||'')}\</div>`;
      // When user clicks with mouse/touch, choose this item. Use mousedown
      // to prevent the input from blurring before the click handler runs.
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); // prevent input blur before click
        choose(i);
      });

      // Show hover/active effect when pointer is over an item. We set
      // selectedIndex so keyboard navigation and visual highlight logic
      // remain unified. Clear the selection on pointer leave.
      li.addEventListener('pointerenter', () => {
        selectedIndex = i;
        updateHighlight();
      });
      li.addEventListener('pointerleave', () => {
        // Only clear hover highlight if the pointer leaves this item and
        // the current selectedIndex still points to it.
        if (selectedIndex === i) {
          selectedIndex = -1;
          updateHighlight();
        }
      });
      list.appendChild(li);
    });
    selectedIndex = -1;
    updateHighlight();
    positionOverlay();
    portal.style.display = 'block';
  }

  function updateHighlight() {
    Array.from(list.children).forEach((li, idx) => {
      li.style.background = idx === selectedIndex ? 'rgba(59,130,246,0.35)' : '#0b1220';
    });
  }

  function choose(idx) {
    const it = candidates[idx];
    if (!it) return;
    inputEl.value = it.text;
    hide();
    if (onSelect) onSelect(it);
  }

  function hide() {
    portal.style.display = 'none';
  }

  function show(items) {
    candidates = items;
    render(items);
  }

  async function onInput() {
    const v = inputEl.value.trim().toLowerCase();
    if (!v) {
      hide();
      return;
    }
    const items = await getCandidates(v);
    show(items.slice(0, 20));
  }

  inputEl.addEventListener('input', debounce(onInput, 150));
  inputEl.addEventListener('focus', () => {
    // Reposition and maybe show if there's text
    if (inputEl.value.trim()) onInput();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (portal.style.display === 'none') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, list.children.length - 1);
      updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateHighlight();
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0) {
        e.preventDefault();
        choose(selectedIndex);
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  // Reposition on scroll/resize to keep aligned with the input
  function onWinChange() {
    if (portal.style.display !== 'none') positionOverlay();
  }
  window.addEventListener('scroll', onWinChange, true);
  window.addEventListener('resize', onWinChange);

  document.addEventListener('click', (ev) => {
    if (ev.target === inputEl || list.contains(ev.target)) return;
    hide();
  });

  return { show, hide };
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);
}
