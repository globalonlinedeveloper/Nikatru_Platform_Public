/* FullShot frame-expansion helper — injected into EVERY frame of the tab
   (requires the optional <all_urls> permission, opt-in in Options).

   Each frame, on FS_FRAMES_EXPAND:
     1. hides its scrollbars and pauses animations (shadow roots included),
     2. grows its own scrollable panels to full content height,
     3. grows its child <iframe>s as they report their heights (bottom-up),
     4. repeatedly posts its full document height to its parent frame.
   The top frame is driven by content/capture.js, which receives the reports
   and resizes the top-level iframes. FS_FRAMES_RESTORE puts everything back. */

(function () {
  'use strict';
  if (window === window.top) return;      // top frame is handled by capture.js
  if (window.__fullshotFrameExpand) return;
  window.__fullshotFrameExpand = true;

  const SLACK = 24;        // ignore sub-24px hidden content
  const CAP = 40000;       // hard height cap (px)
  const TICK_MS = 160;     // report cadence
  const TICKS = 8;         // ~1.3s of reports, matches capture.js settle time
  const MAX_WALK = 40000;
  const MAX_WALK_MS = 350;

  let active = false;
  let expanded = [];       // { el, css, top, left } | { styleEl }
  let expandedSet = new Set();
  let timer = null;

  /* ---------- composed-tree (shadow DOM) helpers, same as capture.js ------ */

  function forEachDeep(start, fn) {
    // Depth-first so early-in-DOM shadow trees are reached within budget.
    let seen = 0;
    let stopped = false;
    const deadline = performance.now() + MAX_WALK_MS;
    (function walk(root) {
      if (stopped) return;
      let els;
      try { els = root.querySelectorAll('*'); } catch (_) { return; }
      for (let i = 0; i < els.length; i++) {
        if (stopped) return;
        const el = els[i];
        if (++seen > MAX_WALK ||
            ((seen & 511) === 0 && performance.now() > deadline)) {
          stopped = true; return;
        }
        if (fn(el)) { stopped = true; return; }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    })(start);
  }

  function composedParent(el) {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const p = el.parentNode;
    return p && p.host ? p.host : null;
  }

  function hasAncestorIn(el, set) {
    for (let n = composedParent(el); n; n = composedParent(n)) {
      if (set.has(n)) return true;
    }
    return false;
  }

  function domDepth(el) {
    let d = 0;
    for (let n = el; n; n = composedParent(n)) d++;
    return d;
  }

  function collectFrames(scope) {
    const out = [];
    forEachDeep(scope, el => {
      const t = el.tagName;
      if (t === 'IFRAME' || t === 'FRAME') out.push(el);
    });
    return out;
  }

  /* ---------- local panel expansion (same rules as capture.js) ---------- */

  function growPanel(el) {
    const target = Math.min(el.scrollHeight, CAP);
    if (target <= el.clientHeight + SLACK) return;
    let pos = '';
    try { pos = getComputedStyle(el).position; } catch (_) {}
    if (pos === 'fixed') return; // viewport-clipped; growing reveals nothing
    if (!expandedSet.has(el)) {
      expanded.push({ el, css: el.getAttribute('style'), top: el.scrollTop, left: el.scrollLeft });
      expandedSet.add(el);
    }
    if (pos === 'sticky') el.style.setProperty('position', 'static', 'important');
    el.style.setProperty('height', target + 'px', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('overflow-y', 'hidden', 'important');
    el.scrollTop = 0;
  }

  function expandLocalPanels() {
    if (!document.body) return;

    const fixedEls = new Set(), stickyEls = new Set();
    forEachDeep(document.body, el => {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return; // cheap pre-filter, saves a style computation
      let pos;
      try { pos = getComputedStyle(el).position; } catch (_) { return; }
      if (pos === 'fixed') fixedEls.add(el);
      else if (pos === 'sticky') stickyEls.add(el);
    });

    const candidates = [];
    forEachDeep(document.body, el => {
      const tag = el.tagName;
      if (tag === 'IFRAME' || tag === 'FRAME' || tag === 'SELECT') return;
      if (el.clientHeight < 40 || el.clientWidth < 40) return;
      if (el.scrollHeight <= el.clientHeight + SLACK) return;
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { return; }
      if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return;
      if (hasAncestorIn(el, fixedEls)) return;
      candidates.push(el);
    });
    candidates.sort((a, b) => domDepth(b) - domDepth(a)); // innermost first

    for (const el of candidates) {
      growPanel(el);
      for (let a = composedParent(el); a && a !== document.body; a = composedParent(a)) {
        if (expandedSet.has(a)) continue;
        // sticky wrapper around a scroller: un-stick and size to content
        if (stickyEls.has(a)) {
          expanded.push({ el: a, css: a.getAttribute('style'), top: a.scrollTop, left: a.scrollLeft });
          expandedSet.add(a);
          a.style.setProperty('position', 'static', 'important');
          a.style.setProperty('height', 'auto', 'important');
          a.style.setProperty('max-height', 'none', 'important');
          continue;
        }
        let cs;
        try { cs = getComputedStyle(a); } catch (_) { break; }
        if (/(hidden|clip)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + SLACK) {
          growPanel(a);
        }
      }
    }
  }

  function injectQuietCss() {
    const cssText = '::-webkit-scrollbar{display:none!important}' +
      '*{scrollbar-width:none!important;animation-play-state:paused!important;transition-duration:0s!important}';
    const st = document.createElement('style');
    st.id = '__fullshot-frame-css';
    st.textContent = cssText;
    document.documentElement.appendChild(st);
    expanded.push({ styleEl: st });
    // Shadow roots need their own copy — page selectors don't cross in.
    forEachDeep(document.body || document, el => {
      if (!el.shadowRoot) return;
      try {
        const s = document.createElement('style');
        s.textContent = cssText;
        el.shadowRoot.appendChild(s);
        expanded.push({ styleEl: s });
      } catch (_) {}
    });
  }

  /* ---------- bottom-up height reporting ---------- */

  function docHeight() {
    const docEl = document.scrollingElement || document.documentElement;
    return Math.min(Math.max(
      docEl ? docEl.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0
    ), CAP);
  }

  function reportUp() {
    try {
      window.parent.postMessage({ __fullshot: 'fs-frame-size', h: docHeight() }, '*');
    } catch (_) {}
  }

  /* Grow own child iframes as they report (makes nesting converge upward). */
  window.addEventListener('message', (e) => {
    if (!active) return;
    const d = e.data;
    if (!d || d.__fullshot !== 'fs-frame-size' || typeof d.h !== 'number') return;
    const frames = collectFrames(document.body || document);
    for (let i = 0; i < frames.length; i++) {
      const fr = frames[i];
      let win = null;
      try { win = fr.contentWindow; } catch (_) {}
      if (win !== e.source) continue;
      if (!fr.offsetWidth) return;
      const target = Math.min(Math.ceil(d.h), CAP);
      if (target <= fr.clientHeight + SLACK) return; // never shrink
      if (!expandedSet.has(fr)) {
        expanded.push({ el: fr, css: fr.getAttribute('style'), top: 0, left: 0 });
        expandedSet.add(fr);
      }
      fr.style.setProperty('height', target + 'px', 'important');
      fr.style.setProperty('max-height', 'none', 'important');
      return;
    }
  });

  /* ---------- lifecycle ---------- */

  function begin() {
    if (active) return;
    active = true;
    try { injectQuietCss(); } catch (_) {}
    try { expandLocalPanels(); } catch (_) {}
    let n = 0;
    reportUp();
    timer = setInterval(() => {
      reportUp();
      if (++n >= TICKS) { clearInterval(timer); timer = null; }
    }, TICK_MS);
  }

  function restore() {
    if (timer) { clearInterval(timer); timer = null; }
    for (let i = expanded.length - 1; i >= 0; i--) {
      const r = expanded[i];
      try {
        if (r.styleEl) { r.styleEl.remove(); continue; }
        if (r.css == null) r.el.removeAttribute('style');
        else r.el.setAttribute('style', r.css);
        if (r.top) r.el.scrollTop = r.top;
        if (r.left) r.el.scrollLeft = r.left;
      } catch (_) {}
    }
    expanded = [];
    expandedSet = new Set();
    active = false;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'FS_FRAMES_EXPAND') {
      begin();
      sendResponse({ ok: true });
    } else if (msg.type === 'FS_FRAMES_RESTORE') {
      restore();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
/* build 1.2.4 */
