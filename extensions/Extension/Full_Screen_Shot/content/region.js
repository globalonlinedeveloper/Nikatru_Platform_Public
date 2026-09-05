/* FullShot content script — region / element selection overlay.
   Region: drag a rectangle. Element: hover highlights the DOM element under
   the cursor, click captures its bounding box. Either way the overlay hides
   itself and reports the rect (CSS px, viewport-relative) to the background
   worker for capture. */

(function () {
  'use strict';
  if (window.__fullshotRegionLoaded) return;
  window.__fullshotRegionLoaded = true;

  let overlay = null;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'FS_REGION_START') {
      if (!overlay) show(msg.pick === 'element');
      sendResponse({ ok: true });
    }
    return false;
  });

  /* This overlay is FullShot's chrome living inside SOMEBODY ELSE'S page, and
     the page may be Arabic, Hebrew or Persian. Two different directions meet
     here and neither is the host page's:
       · the HINT is FullShot's own sentence, so it reads in FullShot's UI
         direction — the one the loaded message file declares.
       · the LABEL is a measurement and a CSS-ish element description. Both are
         data. Pinned LTR, because "1280 × 4096" rendered in an RTL paragraph
         comes out "4096 × 1280" — the user's own numbers, reversed by us.
     Everything else here is a COORDINATE SYSTEM: sel/label are placed with
     explicit style.left from viewport geometry, which is direction-agnostic and
     must stay physical. Do not "logicalise" those. */
  function fsUiDir() {
    try {
      const d = chrome.i18n && chrome.i18n.getMessage && chrome.i18n.getMessage('@@bidi_dir');
      return d === 'rtl' ? 'rtl' : 'ltr';
    } catch (_) { return 'ltr'; }
  }

  /* The hint is the only sentence this file writes, so it comes out of the
     loaded message file. Deliberately a small COPY of msg() in popup/popup.js
     rather than a call into pages/common.js, for a reason stronger than the
     popup's: this runs as a content script inside somebody else's document,
     where common.js is not loaded and cannot be — a cross-file reference would
     throw into the host page instead of degrading to English.
     $ESC$ inside regionHint* is a FIXED placeholder (content "Esc"), so
     chrome.i18n fills it itself and there is nothing to substitute here; the
     key name is not concatenated on, because several of the 55 put it before
     the verb. The English is passed alongside as the fallback for a chrome
     with no i18n at all, so a miss degrades to English, never to a blank pill. */
  function fsI18nOk() {
    try { return !!(typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage); }
    catch (_) { return false; }
  }

  function fsMessage(key, english) {
    let text = '';
    try { if (fsI18nOk()) text = chrome.i18n.getMessage(key) || ''; }
    catch (_) { text = ''; }
    if (text) return text;
    if (fsI18nOk()) console.warn('i18n: no message for "' + key + '"');
    return english;
  }

  function show(elementMode) {
    overlay = document.createElement('div');
    overlay.id = '__fullshot-region';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      cursor: 'crosshair', background: 'transparent',
      direction: fsUiDir(), unicodeBidi: 'isolate'
    });

    const sel = document.createElement('div');
    Object.assign(sel.style, {
      position: 'fixed', display: 'none',
      border: '2px solid #4f46e5', borderRadius: '2px',
      background: 'rgba(79,70,229,0.08)',
      boxShadow: '0 0 0 100000px rgba(0,0,0,0.35)',
      pointerEvents: 'none'
    });

    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'fixed', display: 'none',
      background: '#1c1c28', color: '#fff',
      font: '12px/1 system-ui, sans-serif',
      padding: '4px 8px', borderRadius: '6px',
      pointerEvents: 'none', zIndex: '1',
      direction: 'ltr', unicodeBidi: 'isolate'   // a measurement, not a sentence
    });

    const hint = document.createElement('div');
    hint.textContent = elementMode
      ? fsMessage('regionHintElement', 'Click an element to capture it — Esc to cancel')
      : fsMessage('regionHintDrag', 'Drag to select a region — Esc to cancel');
    Object.assign(hint.style, {
      position: 'fixed', top: '16px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(28,28,40,0.92)', color: '#fff',
      font: '13px/1 system-ui, sans-serif',
      padding: '8px 14px', borderRadius: '999px',
      pointerEvents: 'none'
    });

    overlay.append(sel, label, hint);
    document.documentElement.appendChild(overlay);

    let startX = 0, startY = 0, dragging = false;
    let hoverRect = null;

    function rectFrom(e) {
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      return { x, y, w, h };
    }

    // Element mode: find the page element under the cursor (skipping the overlay).
    function pickAt(e) {
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      for (const el of els) {
        if (el !== overlay && !overlay.contains(el) &&
            el !== document.documentElement && el !== document.body) return el;
      }
      return null;
    }

    function clampToViewport(r) {
      const x = Math.max(0, r.left);
      const y = Math.max(0, r.top);
      return {
        x, y,
        w: Math.min(r.right, window.innerWidth) - x,
        h: Math.min(r.bottom, window.innerHeight) - y
      };
    }

    function describe(el) {
      let s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      else if (el.classList.length) s += '.' + el.classList[0];
      return s;
    }

    if (elementMode) {
      overlay.addEventListener('mousemove', (e) => {
        const el = pickAt(e);
        if (!el) { hoverRect = null; sel.style.display = 'none'; label.style.display = 'none'; return; }
        const r = clampToViewport(el.getBoundingClientRect());
        if (r.w < 3 || r.h < 3) return;
        hoverRect = r;
        update(r);
        sel.style.display = 'block';
        label.textContent = describe(el) + '  ' + Math.round(r.w) + ' × ' + Math.round(r.h);
      });
      overlay.addEventListener('mousedown', (e) => { if (e.button === 0) e.preventDefault(); });
      overlay.addEventListener('mouseup', async (e) => {
        if (e.button !== 0 || !hoverRect) return;
        e.preventDefault();
        if (hoverRect.w < 5 || hoverRect.h < 5) return;
        await finish(hoverRect);
      });
    } else {
      overlay.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        hint.style.display = 'none';
        sel.style.display = 'block';
        update(rectFrom(e));
      });

      overlay.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        update(rectFrom(e));
      });

      overlay.addEventListener('mouseup', async (e) => {
        if (!dragging) return;
        dragging = false;
        const r = rectFrom(e);
        if (r.w < 5 || r.h < 5) { // too small — treat as a mis-click
          sel.style.display = 'none';
          label.style.display = 'none';
          hint.style.display = 'block';
          return;
        }
        await finish(r);
      });
    }

    function update(r) {
      sel.style.left = r.x + 'px';
      sel.style.top = r.y + 'px';
      sel.style.width = r.w + 'px';
      sel.style.height = r.h + 'px';
      label.textContent = Math.round(r.w) + ' × ' + Math.round(r.h);
      label.style.display = 'block';
      const ly = r.y > 30 ? r.y - 26 : r.y + r.h + 8;
      label.style.left = r.x + 'px';
      label.style.top = ly + 'px';
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        chrome.runtime.sendMessage({ type: 'FS_REGION_CANCEL' });
      }
    }
    window.addEventListener('keydown', onKey, true);

    function cleanup() {
      window.removeEventListener('keydown', onKey, true);
      if (overlay) { overlay.remove(); overlay = null; }
    }

    async function finish(r) {
      // Hide the overlay completely before the screenshot is taken.
      overlay.style.display = 'none';
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const resp = await chrome.runtime.sendMessage({
        type: 'FS_REGION_SELECTED',
        rect: r,
        dpr: window.devicePixelRatio || 1
      }).catch(() => null);
      cleanup();
      if (!resp || !resp.ok) {
        // Background lost the session; nothing else to do.
      }
    }
  }
})();
