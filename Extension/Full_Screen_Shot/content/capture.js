/* FullShot content script — full-page scroll & capture driver.
   Scrolls the page (or the dominant scroll container), asks the background
   worker to grab each viewport, handles fixed/sticky elements, scrollbars,
   smooth-scroll and lazy-loading, then restores everything. */

(function () {
  'use strict';
  if (window.__fullshotLoaded) return;
  window.__fullshotLoaded = true;

  let capturing = false;
  let aborted = false;
  let fsVirtualCount = 0;   // render-window scrollers detected this run (v1.6.0)

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'FS_START' && !capturing) {
      capturing = true;
      aborted = false;
      run(msg.settings).catch(err => {
        chrome.runtime.sendMessage({ type: 'FS_ERROR', error: String(err && err.message || err) });
      }).finally(() => { capturing = false; });
      sendResponse({ ok: true });
    } else if (msg.type === 'FS_ABORT') {
      aborted = true;
      sendResponse({ ok: true });
    }
    return false;
  });

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  /* ---------- composed-tree (shadow DOM) helpers ----------
     App shells built from web components — Reddit, YouTube, most design-
     system UIs — put their scrollers, sticky bars, and panels inside open
     shadow roots, where querySelectorAll('body *') can't see them. Every
     walker below traverses the composed tree instead: light DOM plus every
     open shadow root, up to a safety cap. (Closed roots are unreachable by
     any extension.) */

  const MAX_WALK = 40000;    // element budget — Reddit-scale threads included
  const MAX_WALK_MS = 350;   // time budget — degrade gracefully, never hang

  /* Returns { seen, stop } — v1.10.3, and it is a safety change, not a
     convenience. `stop` is null for a walk that reached the end of the tree, or
     'walk' (element budget), 'time' (ms budget), 'error' (a subtree refused to
     enumerate) or 'fn' (the caller asked to stop).

     Until now this stopped silently at 40,000 elements or 350 ms and returned
     `undefined`, so no caller could tell a complete walk from a truncated one.
     For most callers that is fine — a missed sticky header is a cosmetic
     defect. For the redaction pass it is not: a protection pass that runs out
     of time on a heavy page reported the same thing as one that read every
     word. That is a fact about the protection, not an implementation detail,
     and REDACTION-CLAIM-SPEC.md §2.1 requires it in the ledger.

     Additive: every existing caller ignores the return value. `budgetMs` lets a
     caller bring its own clock — the redaction walk carries a style and a rect
     read per leaf and the user opted into paying for it, so it must not be
     rationed by a budget sized for a layout hint (§2.2). */
  function forEachDeep(start, fn, budgetMs) {
    // start: Document | ShadowRoot | Element. fn(el) returning true stops.
    // Depth-first: each host's shadow tree is visited the moment the host is
    // encountered, so early-in-DOM components (left navs) are always reached
    // even when a long thread would exhaust the budget later.
    let seen = 0;
    let stopped = false;
    let stop = null;
    let errored = false;
    const deadline = performance.now() + (budgetMs > 0 ? budgetMs : MAX_WALK_MS);
    (function walk(root) {
      if (stopped) return;
      let els;
      try { els = root.querySelectorAll('*'); } catch (_) { errored = true; return; }
      for (let i = 0; i < els.length; i++) {
        if (stopped) return;
        const el = els[i];
        if (++seen > MAX_WALK) { stopped = true; stop = 'walk'; return; }
        if ((seen & 511) === 0 && performance.now() > deadline) { stopped = true; stop = 'time'; return; }
        if (fn(el)) { stopped = true; stop = 'fn'; return; }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    })(start);
    return { seen, stop: stop || (errored ? 'error' : null) };
  }

  /* Parent in the flat (rendered) tree: slot → shadow host → light parent. */
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

  /* Find what actually scrolls. Most pages: documentElement. App-style pages
     (Gmail, ChatGPT, dashboards): a large inner container with overflow:auto —
     possibly inside a shadow root. The document must not win just because it
     scrolls a token amount (cookie banner, tiny footer overflow) while the
     real content lives in an inner pane — compare scrollable RANGES and pick
     the dominant one. */
  function candidateScore(el, winW, winH) {
    // scrollable range is what matters: how much content is hidden. Both
    // axes count (v1.4.0): a board/spreadsheet pane that scrolls only
    // sideways is just as much "the story" as a vertical feed.
    if (el.clientHeight < winH * 0.45 || el.clientWidth < winW * 0.3) return 0;
    const rawV = el.scrollHeight - el.clientHeight;
    const rawH = el.scrollWidth - el.clientWidth;
    if (rawV < 120 && rawH < 160) return 0;
    let cs;
    try { cs = getComputedStyle(el); } catch (_) { return 0; }
    const vOk = /(auto|scroll|overlay)/.test(cs.overflowY) && rawV >= 120;
    const hOk = /(auto|scroll|overlay)/.test(String(cs.overflowX)) && rawH >= 160;
    if (!vOk && !hOk) return 0;
    const range = (vOk ? rawV : 0) + (hOk ? rawH : 0);
    let r;
    try { r = el.getBoundingClientRect(); } catch (_) { return 0; }
    // must actually be on screen — hidden/off-screen panes can't be the main pane
    if (r.width < 1 || r.height < 1) return 0;
    if (r.bottom <= 0 || r.top >= winH || r.right <= 0 || r.left >= winW) return 0;
    return range;
  }

  function findScrollRoot() {
    const docEl = document.scrollingElement || document.documentElement;
    const winH = window.innerHeight;
    const winW = document.documentElement.clientWidth || window.innerWidth;

    let docRange = Math.max(0, docEl.scrollHeight - winH);
    let docRangeX = Math.max(0, docEl.scrollWidth - winW);
    try {
      // overflow hidden/clip on <html> locks window scrolling on that axis.
      const hcs = getComputedStyle(document.documentElement);
      if (/(hidden|clip)/.test(hcs.overflowY)) docRange = 0;
      if (/(hidden|clip)/.test(String(hcs.overflowX))) docRangeX = 0;
    } catch (_) {}
    docRange += docRangeX;

    let best = null, bestRange = 0;
    if (document.body) {
      // body itself can be the scroller (html { overflow:hidden } + body { overflow:auto })
      const r = candidateScore(document.body, winW, winH);
      if (r > 0) { best = document.body; bestRange = r; }
    }
    forEachDeep(document.body || document, el => {
      const range = candidateScore(el, winW, winH);
      if (range > bestRange) { best = el; bestRange = range; }
    });

    // The document wins when its own range is meaningful and not dwarfed by
    // an inner pane holding the real content.
    if (docRange > 10 && docRange >= bestRange * 0.5) return { el: docEl, isDoc: true };
    if (best) return { el: best, isDoc: false };
    return { el: docEl, isDoc: true };
  }

  function injectCaptureCss() {
    const style = document.createElement('style');
    style.id = '__fullshot-css';
    style.textContent = [
      '::-webkit-scrollbar { display: none !important; }',
      '* { scrollbar-width: none !important; scroll-behavior: auto !important; scroll-snap-type: none !important; }',
      'html { scroll-behavior: auto !important; }',
      // Freeze motion so every frame stitches consistently, and disable
      // scroll anchoring (chat-style UIs re-position on programmatic scroll).
      '*, *::before, *::after { animation-play-state: paused !important; transition-duration: 0s !important; }',
      // Only the main scroller loses anchoring — a global rule would let
      // page hydration shift content inside inner scrollable panels.
      'html, body, [data-fullshot-root] { overflow-anchor: none !important; }'
    ].join('\n');
    document.documentElement.appendChild(style);

    // Page-level selectors don't cross shadow boundaries — without this,
    // scrollbars and animations inside web-component UIs survive the capture.
    const shadowCss = '::-webkit-scrollbar{display:none!important}' +
      '*{scrollbar-width:none!important;scroll-behavior:auto!important;scroll-snap-type:none!important;' +
      'animation-play-state:paused!important;transition-duration:0s!important}';
    const shadowStyles = [];
    forEachDeep(document.body || document, el => {
      if (!el.shadowRoot) return;
      try {
        const st = document.createElement('style');
        st.textContent = shadowCss;
        el.shadowRoot.appendChild(st);
        shadowStyles.push(st);
      } catch (_) {}
    });
    return { style, shadowStyles };
  }

  function removeCaptureCss(css) {
    for (const st of css.shadowStyles) { try { st.remove(); } catch (_) {} }
    try { css.style.remove(); } catch (_) {}
  }

  /* After the first frame: FIXED elements are viewport-anchored — they would
     repeat in every frame, so hide them (they stay visible once, in frame 0).
     STICKY elements are normal-flow content that merely rides along while
     scrolled — hiding them would leave a BLANK BAND at their layout slot
     (mid-page section headers!). Neutralize them to position:static instead:
     they render exactly once, at their natural place in the page.
     Both kinds are collected from open shadow roots too (Reddit-style UIs). */
  function hideFixedElements(expandedSet) {
    const hidden = [];
    forEachDeep(document.body || document, el => {
      if (el.id === '__fullshot-css') return;
      // 0×0 elements (display:none subtrees, collapsed nodes) can't be visible
      // fixed furniture — skip BEFORE getComputedStyle so huge hidden DOMs
      // (Reddit-scale threads) stay well inside the walk time budget.
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
      let pos;
      try { pos = getComputedStyle(el).position; } catch (_) { return; }
      if (pos === 'fixed') {
        hidden.push({ el, css: el.getAttribute('style') });
        // visibility alone is not enough: a descendant with an explicit
        // visibility:visible re-appears. opacity can't be overridden below.
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('opacity', '0', 'important');
      } else if (pos === 'sticky') {
        // Already static (e.g. unstuck by panel expansion)? computed style
        // said sticky, so no. Skip ones we already restyled during expansion.
        if (expandedSet.size && hasAncestorIn(el, expandedSet)) return;
        hidden.push({ el, css: el.getAttribute('style') });
        el.style.setProperty('position', 'static', 'important');
      }
    });
    return hidden;
  }

  function restoreFixedElements(hidden) {
    for (const h of hidden) {
      try {
        if (h.css == null) h.el.removeAttribute('style');
        else h.el.setAttribute('style', h.css);
      } catch (_) {}
    }
  }

  /* Inner scrollable regions (nav drawers, chat lists, embedded panes) must
     appear in the capture exactly as the user left them. Page scripts can
     move them while we jump the main scroller around, so snapshot them up
     front and re-assert just before the first frame. */
  function snapshotInnerScrolls(rootEl) {
    const saved = [];
    forEachDeep(document.body || document, el => {
      if (el === rootEl) return;
      if (el.scrollTop || el.scrollLeft) {
        saved.push({ el, top: el.scrollTop, left: el.scrollLeft });
      }
    });
    return saved;
  }

  function assertInnerScrolls(saved) {
    for (const s of saved) {
      try {
        // Sub-pixel tolerance: at fractional zoom/DPR (Windows 125%) scroll
        // offsets quantize to device pixels — 150 css px can only be stored
        // as 149.6 or 150.4. Never fight the quantizer.
        if (Math.abs(s.el.scrollTop - s.top) > 0.6) s.el.scrollTop = s.top;
        if (Math.abs(s.el.scrollLeft - s.left) > 0.6) s.el.scrollLeft = s.left;
      } catch (_) {}
    }
  }

  /* ---------- Expand-inner-content mode (opt-in) ----------
     Instead of pinning inner scrollable panels to their as-seen state, grow
     them (and iframes) to their full content height so nothing is hidden
     below an inner fold. Everything is restored after the capture. */

  const EXPAND_SLACK = 24;      // ignore sub-24px hidden content
  const FRAME_CAP = 40000;      // hard per-frame/panel height cap (px)
  const VLIST_MIN_RANGE = 1200; // min hidden px before a scroller can be a render-window
  const VLIST_NODE_CAP = 400;   // render-windows keep node count tiny — above this, not one

  function domDepth(el) {
    let d = 0;
    for (let n = el; n; n = composedParent(n)) d++;
    return d;
  }

  function collectPositioned(doc) {
    // fixed: viewport-anchored — growing content inside reveals nothing.
    // sticky: in normal flow — content inside CAN grow; the sticky wrapper
    // just needs to be neutralized so the grown column doesn't travel.
    const fixed = new Set(), sticky = new Set();
    const win = doc.defaultView || window;
    forEachDeep(doc.body || doc, el => {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return; // cheap pre-filter, saves a style computation
      let pos;
      try { pos = win.getComputedStyle(el).position; } catch (_) { return; }
      if (pos === 'fixed') fixed.add(el);
      else if (pos === 'sticky') sticky.add(el);
    });
    return { fixed, sticky };
  }

  function collectFrames(scope) {
    const out = [];
    forEachDeep(scope, el => {
      const t = el.tagName;
      if (t === 'IFRAME' || t === 'FRAME') out.push(el);
    });
    return out;
  }

  /* v1.6.0 — render-window (virtualized) scroller detection. react-window /
     TanStack / react-virtualized give the scrollbar its full range with a tall
     "sizer" spacer while realizing only a small WINDOW of absolutely-positioned
     rows near the current scroll offset (the rest of the list is not in the DOM).
     Growing such a panel to its scrollHeight reveals nothing — the app still
     renders only its window — so it just balloons the page and leaves a blank
     spacer band. Detect these so expansion skips them: the dominant one is
     captured by the stepped grid, fixed rails by the side pass, embedded ones
     as-rendered. Node-count capped (a true window is tiny) so the walk is cheap. */
  function isVirtualized(el) {
    const range = el.scrollHeight - el.clientHeight;
    if (range < VLIST_MIN_RANGE) return false;
    let nodes = 0, absRows = 0, absCover = 0, spacer = 0, tooMany = false;
    forEachDeep(el, d => {
      if (d === el || tooMany) return;
      if (++nodes > VLIST_NODE_CAP) { tooMany = true; return; }
      let cs; try { cs = getComputedStyle(d); } catch (_) { return; }
      const h = d.offsetHeight || 0;
      if (h >= el.scrollHeight * 0.7) spacer = Math.max(spacer, h);
      if (cs.position === 'absolute') { absRows++; absCover += h; }
    });
    if (tooMany) return false;
    // a near-full-height spacer + a handful of absolutely-positioned rows that
    // together cover only a fraction of the range = a recycled render window.
    return spacer >= el.scrollHeight * 0.7 && absRows >= 2 && absCover < el.scrollHeight * 0.5;
  }

  function growPanel(el, cap, out, outSet) {
    const target = Math.min(el.scrollHeight, cap, FRAME_CAP);
    if (target <= el.clientHeight + EXPAND_SLACK) return;
    let pos = '';
    try {
      const w = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      pos = w.getComputedStyle(el).position;
    } catch (_) {}
    if (pos === 'fixed') return; // viewport-clipped; growing reveals nothing
    if (!outSet.has(el)) {
      out.push({ el, css: el.getAttribute('style'), top: el.scrollTop, left: el.scrollLeft });
      outSet.add(el);
    }
    // A sticky panel taller than the viewport would ride along with the
    // scroll (and drag its sticky-bottom children through every frame) —
    // once expanded it belongs in normal flow.
    if (pos === 'sticky') el.style.setProperty('position', 'static', 'important');
    el.style.setProperty('height', target + 'px', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('overflow-y', 'hidden', 'important');
    el.scrollTop = 0;
  }

  /* Horizontal mirror of growPanel (v1.4.0): widen a sideways scroller (wide
     table, code block, board) to its full content width so the hidden columns
     are laid out — the page grows to the right and the capture grid's column
     stops stitch them in ("merged right"). */
  const WIDTH_CAP = 20000; // matches the totalW capture cap

  function growPanelX(el, out, outSet) {
    const target = Math.min(el.scrollWidth, WIDTH_CAP);
    if (target <= el.clientWidth + EXPAND_SLACK) return;
    let pos = '';
    try {
      const w = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      pos = w.getComputedStyle(el).position;
    } catch (_) {}
    if (pos === 'fixed') return; // viewport-clipped; growing reveals nothing
    if (!outSet.has(el)) {
      out.push({ el, css: el.getAttribute('style'), top: el.scrollTop, left: el.scrollLeft });
      outSet.add(el);
    }
    el.style.setProperty('width', target + 'px', 'important');
    el.style.setProperty('max-width', 'none', 'important');
    el.style.setProperty('overflow-x', 'hidden', 'important');
    el.scrollLeft = 0;
  }

  /* v1.6.15 — decorative-carousel detection for the horizontal "merged right" gate.
     A lone sideways scroller that is a short strip of >=3 similar-width cards (Reddit
     "Suggested communities", media/recommendation rails) is decorative — widening it
     balloons the page sideways for no benefit. Distinguish it from a genuine wide-content
     block (wide table/board/code = tall, or one wide child spanning the scroll width):
     only the latter still merges right. */
  function carouselCards(el) {
    // Composed children: a shadow host renders its shadow root's children (light
    // children are slotted in), so a carousel whose cards live in a shadow root
    // (Reddit's web components) is still seen. Walks light OR shadow at each level.
    const kidsOf = (node) => {
      let src = node;
      try { if (node.shadowRoot) src = node.shadowRoot; } catch (_) {}
      let ks;
      try { ks = Array.prototype.slice.call(src.children); } catch (_) { return []; }
      return ks.filter(c => (c.offsetWidth || 0) > 20 && (c.offsetHeight || 0) > 0);
    };
    let kids = kidsOf(el);
    let guard = 0;
    while (kids.length === 1 && guard++ < 3) {          // descend through a single "track" wrapper (light or shadow)
      const inner = kidsOf(kids[0]);
      if (inner.length < 2) break;
      kids = inner;
    }
    return kids;
  }
  function isDecorativeCarousel(el, win) {
    const winH = (win && win.innerHeight) || 0;
    if (winH && el.clientHeight >= winH * 0.5) return false;   // a tall content block, not a strip
    const sw = el.scrollWidth;
    const cards = carouselCards(el);
    if (cards.length < 3) return false;                        // wide table/code = one (or no) wide child
    let min = Infinity, max = 0;
    for (const c of cards) { const w = c.offsetWidth || 0; if (w < min) min = w; if (w > max) max = w; }
    if (max <= 0 || max > min * 1.6) return false;             // not a row of equal-width cards
    if (max >= sw * 0.5) return false;                         // a single child dominates the width → not a carousel
    return true;
  }

  /* Put every sticky ancestor of a grown element into normal flow, sized to
     its content, so the grown column neither travels with the scroll nor
     stays clipped to 100vh — recorded in `out` for restore afterwards. */
  function unstickAncestors(el, stopEl, protectedEls, stickySet, out, outSet) {
    for (let a = composedParent(el); a && a !== stopEl; a = composedParent(a)) {
      if (!stickySet.has(a) || protectedEls.has(a) || outSet.has(a)) continue;
      out.push({ el: a, css: a.getAttribute('style'), top: a.scrollTop, left: a.scrollLeft });
      outSet.add(a);
      a.style.setProperty('position', 'static', 'important');
      a.style.setProperty('height', 'auto', 'important');
      a.style.setProperty('max-height', 'none', 'important');
    }
  }

  /* Grow every scrollable panel in `doc` so its full content is laid out.
     protectedEls: elements whose geometry must not change (the scroll root
     and its ancestors). Panels inside position:FIXED elements are skipped —
     fixed boxes are viewport-clipped, so growing inside reveals nothing.
     Panels inside position:STICKY wrappers DO grow (sticky is normal flow —
     Reddit's left rail is exactly this): the wrapper is un-stuck and sized
     to content so the column really grows. */
  function expandScrollablePanels(doc, scope, protectedEls, cap, out, outSet) {
    const win = doc.defaultView || window;
    const positioned = collectPositioned(doc);

    const candidates = [];
    forEachDeep(scope, el => {
      if (protectedEls.has(el)) return;
      const tag = el.tagName;
      if (tag === 'IFRAME' || tag === 'FRAME' || tag === 'SELECT') return;
      if (el.clientHeight < 40 || el.clientWidth < 40) return;
      if (el.scrollHeight <= el.clientHeight + EXPAND_SLACK) return;
      let cs;
      try { cs = win.getComputedStyle(el); } catch (_) { return; }
      if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return;
      if (isVirtualized(el)) { fsVirtualCount++; return; } // render-window: never grow (v1.6.0)
      if (hasAncestorIn(el, positioned.fixed)) return;
      candidates.push(el);
    });
    // Innermost first: nested panels grow before their parents are measured.
    candidates.sort((a, b) => domDepth(b) - domDepth(a));

    for (const el of candidates) {
      growPanel(el, cap, out, outSet);
      // Walk up from the grown panel: sticky wrappers join normal flow and
      // size to content; overflow:hidden/clip ancestors that would swallow
      // the growth are opened up. Never past the scroll root.
      for (let a = composedParent(el); a && a !== scope && a !== doc.body; a = composedParent(a)) {
        if (protectedEls.has(a) || outSet.has(a)) continue;
        if (positioned.sticky.has(a)) {
          out.push({ el: a, css: a.getAttribute('style'), top: a.scrollTop, left: a.scrollLeft });
          outSet.add(a);
          a.style.setProperty('position', 'static', 'important');
          a.style.setProperty('height', 'auto', 'important');
          a.style.setProperty('max-height', 'none', 'important');
          continue;
        }
        let cs;
        try { cs = win.getComputedStyle(a); } catch (_) { break; }
        if (/(hidden|clip)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + EXPAND_SLACK) {
          growPanel(a, cap, out, outSet);
        }
      }
    }

    // Horizontal pass (v1.4.0): widen sideways scrollers (wide tables, code
    // blocks) to full content width, then open ancestors that clip on the x
    // axis — the page grows rightward and the capture grid's extra columns
    // stitch the revealed content in. The scroll root itself is never widened
    // (protected): its hidden columns are captured by scrolling instead.
    const xCandidates = [];
    forEachDeep(scope, el => {
      if (protectedEls.has(el)) return;
      const tag = el.tagName;
      if (tag === 'IFRAME' || tag === 'FRAME' || tag === 'SELECT') return;
      if (el.clientHeight < 40 || el.clientWidth < 40) return;
      if (el.scrollWidth <= el.clientWidth + EXPAND_SLACK) return;
      let cs;
      try { cs = win.getComputedStyle(el); } catch (_) { return; }
      if (!/(auto|scroll|overlay)/.test(String(cs.overflowX))) return;
      if (hasAncestorIn(el, positioned.fixed)) return;
      xCandidates.push(el);
    });
    // v1.6.3 — merged-right is for a SINGLE dominant sideways scroller (a wide
    // table / board / code block). A page with MULTIPLE independent sideways
    // scrollers is a carousel wall (Amazon-style homepage): widening them all
    // balloons the page sideways into a broken horizontal grid (repeated nav
    // furniture, misplaced columns). Count independent (non-nested) candidates;
    // if 2+, skip the horizontal pass and capture the carousels as-seen.
    const xTop = new Set(xCandidates);
    const xIndependent = xCandidates.filter(el => !hasAncestorIn(el, xTop));
    if (xIndependent.length >= 2) return positioned;
    // v1.6.15: a SINGLE sideways scroller that is a decorative carousel (short strip, a row
    // of >=3 similar-width cards — Reddit "Suggested communities", media rails) is left
    // as-seen too; only a genuine wide-content block (wide table/board/code) merges right.
    if (xIndependent.length === 1 && isDecorativeCarousel(xIndependent[0], win)) return positioned;
    xCandidates.sort((a, b) => domDepth(b) - domDepth(a));
    for (const el of xCandidates) {
      growPanelX(el, out, outSet);
      for (let a = composedParent(el); a && a !== scope && a !== doc.body; a = composedParent(a)) {
        if (protectedEls.has(a)) continue;
        let cs;
        try { cs = win.getComputedStyle(a); } catch (_) { break; }
        if (/(hidden|clip)/.test(String(cs.overflowX)) && a.scrollWidth > a.clientWidth + EXPAND_SLACK) {
          growPanelX(a, out, outSet);
        }
      }
    }
    return positioned;
  }

  /* Same-origin iframes: reachable directly via contentDocument — no extra
     permission needed. Nested frames are expanded innermost-first. */
  function expandSameOriginIframes(doc, cap, out, outSet, positioned, protectedEls) {
    let frames;
    try { frames = collectFrames(doc.body || doc); } catch (_) { return; }
    if (!frames.length) return;
    const pos = positioned || collectPositioned(doc);
    const prot = protectedEls || new Set();
    for (let i = 0; i < frames.length; i++) {
      const fr = frames[i];
      let idoc = null;
      try { idoc = fr.contentDocument; } catch (_) {}
      if (!idoc || !idoc.documentElement) continue;
      if (fr.clientWidth < 40 || !fr.offsetWidth) continue;
      if (hasAncestorIn(fr, pos.fixed)) continue; // viewport-clipped, reveals nothing
      try {
        expandSameOriginIframes(idoc, cap, out, outSet); // depth first
        const st = idoc.createElement('style');
        st.textContent = '::-webkit-scrollbar{display:none!important}' +
          '*{scrollbar-width:none!important;animation-play-state:paused!important;transition-duration:0s!important}';
        idoc.documentElement.appendChild(st);
        out.push({ styleEl: st });
        if (idoc.body) {
          expandScrollablePanels(idoc, idoc.body, new Set(), cap, out, outSet);
        }
        const docEl = idoc.scrollingElement || idoc.documentElement;
        const need = Math.min(
          Math.max(docEl.scrollHeight, idoc.body ? idoc.body.scrollHeight : 0),
          cap, FRAME_CAP
        );
        if (need > fr.clientHeight + EXPAND_SLACK && !outSet.has(fr)) {
          out.push({ el: fr, css: fr.getAttribute('style'), top: 0, left: 0 });
          outSet.add(fr);
          fr.style.setProperty('height', need + 'px', 'important');
          fr.style.setProperty('max-height', 'none', 'important');
          unstickAncestors(fr, doc.body, prot, pos.sticky, out, outSet);
        }
      } catch (_) {}
    }
  }

  /* Cross-origin frames (optional <all_urls> permission): frame-expand.js is
     injected into every frame and posts its full content height up to us.
     Match the reporting window to its <iframe> element and grow it. */
  function makeFrameReportHandler(positioned, protectedEls, out, outSet) {
    return function (e) {
      const d = e.data;
      if (!d || d.__fullshot !== 'fs-frame-size' || typeof d.h !== 'number') return;
      const frames = collectFrames(document.body || document);
      for (let i = 0; i < frames.length; i++) {
        const fr = frames[i];
        let win = null;
        try { win = fr.contentWindow; } catch (_) {}
        if (win !== e.source) continue;
        if (!fr.offsetWidth || hasAncestorIn(fr, positioned.fixed)) return;
        const target = Math.min(Math.ceil(d.h), FRAME_CAP);
        if (target <= fr.clientHeight + EXPAND_SLACK) return; // never shrink
        if (!outSet.has(fr)) {
          out.push({ el: fr, css: fr.getAttribute('style'), top: 0, left: 0 });
          outSet.add(fr);
        }
        fr.style.setProperty('height', target + 'px', 'important');
        fr.style.setProperty('max-height', 'none', 'important');
        unstickAncestors(fr, document.body, protectedEls, positioned.sticky, out, outSet);
        return;
      }
    };
  }

  function restoreExpanded(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      try {
        if (r.styleEl) { r.styleEl.remove(); continue; }
        if (r.css == null) r.el.removeAttribute('style');
        else r.el.setAttribute('style', r.css);
        if (r.top) r.el.scrollTop = r.top;
        if (r.left) r.el.scrollLeft = r.left;
      } catch (_) {}
    }
  }

  /* v1.6.2 — interaction-gated content reveal (opt-in "expand everything").
     Screenshot tools miss anything hidden behind a click: collapsed <details>,
     inactive tab panels, [hidden]/aria-hidden accordions. Open/reveal them so
     their content is laid out and captured. Only elements carrying an explicit
     interaction affordance are touched (never arbitrary display:none menus or
     modals), and every mutation is recorded for a byte-identical restore. */
  function revealInteractive(doc) {
    const out = [];
    const recAttr = (el, name) => out.push({ el, name, prev: el.getAttribute(name) });
    const recStyle = (el) => out.push({ el, styleCss: el.getAttribute('style') });
    forEachDeep(doc.body || doc, el => {
      // 1) collapsed <details> → open it
      if (el.tagName === 'DETAILS') {
        if (el.getAttribute('open') == null) { recAttr(el, 'open'); el.setAttribute('open', ''); }
        return;
      }
      // 2) panels gated by an interaction affordance (tab / accordion / disclosure)
      const ariaHidden = el.getAttribute('aria-hidden') === 'true';
      const hasHidden = el.getAttribute('hidden') != null;
      const role = el.getAttribute('role');
      const collapsed = el.getAttribute('aria-expanded') === 'false';
      if (!(ariaHidden || hasHidden || role === 'tabpanel' || collapsed)) return;
      if (hasHidden) { recAttr(el, 'hidden'); el.removeAttribute('hidden'); }
      if (ariaHidden) { recAttr(el, 'aria-hidden'); el.setAttribute('aria-hidden', 'false'); }
      if (collapsed) { recAttr(el, 'aria-expanded'); el.setAttribute('aria-expanded', 'true'); }
      // still hidden by display:none? force it into flow so it lays out.
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { cs = null; }
      if (cs && cs.display === 'none') { recStyle(el); el.style.setProperty('display', 'block', 'important'); }
    });
    return out;
  }

  function restoreInteractive(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      try {
        if ('styleCss' in r) {
          if (r.styleCss == null) r.el.removeAttribute('style');
          else r.el.setAttribute('style', r.styleCss);
        } else if (r.prev == null) {
          r.el.removeAttribute(r.name);
        } else {
          r.el.setAttribute(r.name, r.prev);
        }
      } catch (_) {}
    }
  }

  /* v1.6.11 — network "load more" / "show more" loop (opt-in `loadMore`).
     revealInteractive only uncovers content already in the DOM. A "load more"
     button instead APPENDS content via app JS (usually a network fetch) — content
     that isn't in the DOM at all until the click, so a normal capture (and even
     the declarative reveal above) misses it. This loop finds such a button, clicks
     it, waits for the page to grow, and repeats until nothing new appears, the
     button is gone, or a hard cap is hit (so an infinite feed can't be chased).
     Honest boundary: the appended content is the desired capture and is LEFT in
     place — it can't be un-fetched, and a real user click reveals it identically.
     The loop sets no styles/attributes itself, so leave-no-trace holds: there is
     nothing to restore, and the every-run byte-identical style assertion still
     passes. The target is kept tight so we never trip a destructive control:
     <button> / [role=button] and non-navigating <a> only, matched by a load /
     show / view / see-more label, visible, enabled, and not oversized. */
  const LOADMORE_RE = /\b(load|show|view|see|display|reveal)\s+(?:\d[\d,]*\s+)?(more|older|newer|earlier|additional|previous|remaining)\b|\b(more|older)\s+(comments|replies|posts|results|items|reviews|answers)\b|^\s*(more|load more|show more|view more|see more)\s*$/i;
  const LOADMORE_MAX = 20;      // hard cap on total clicks — an infinite-feed guard
  const LOADMORE_SETTLE = 350;  // ms to wait for the append to land after each click

  function findLoadMoreButton(dead) {
    let found = null;
    forEachDeep(document.body || document, el => {
      if (found) return true;
      if (dead && dead.has(el)) return;
      const tag = el.tagName;
      const isButton = tag === 'BUTTON' || el.getAttribute('role') === 'button';
      let isSafeAnchor = false;
      if (tag === 'A') {
        const href = el.getAttribute('href');
        isSafeAnchor = href == null || href === '' || href === '#' ||
                       href.charAt(0) === '#' || /^javascript:/i.test(href);
      }
      if (!isButton && !isSafeAnchor) return;
      if (el.getAttribute('disabled') != null || el.getAttribute('aria-disabled') === 'true') return;
      // a hidden / exhausted button reads 0x0 — treat it as gone
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
      if (el.offsetHeight > 200) return;   // a real control is small, not a whole section
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { return; }
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const op = parseFloat(cs.opacity); if (isFinite(op) && op === 0) return;
      let txt = '', label = '';
      try { txt = (el.textContent || '').trim(); } catch (_) {}
      try { label = el.getAttribute('aria-label') || ''; } catch (_) {}
      if (!LOADMORE_RE.test((txt + ' ' + label).slice(0, 100))) return;
      found = el;
      return true;
    });
    return found;
  }

  async function clickLoadMore(root, cap) {
    const heightOf = () => {
      try {
        return root.isDoc
          ? (document.scrollingElement || document.documentElement).scrollHeight
          : root.el.scrollHeight;
      } catch (_) { return 0; }
    };
    const dead = new Set();   // buttons that produced no growth — never retried
    let clicks = 0;
    for (let round = 0; round < LOADMORE_MAX; round++) {
      if (aborted) break;
      if (heightOf() >= cap) break;          // already at the height cap — stop chasing
      const btn = findLoadMoreButton(dead);
      if (!btn) break;
      const before = heightOf();
      try { btn.click(); } catch (_) { dead.add(btn); continue; }
      clicks++;
      await nextFrame();
      await sleep(LOADMORE_SETTLE);
      if (heightOf() <= before + 4) dead.add(btn);   // click did nothing -> don't retry it
    }
    return clicks;
  }

  /* v1.6.12 — infinite-scroll feeds with NO "load more" button (opt-in
     `infiniteScroll`). Many feeds (search results, social, news) append the next
     page automatically when you scroll near the bottom (IntersectionObserver /
     scroll handler). totalH is measured before the feed grows, so the capture
     truncates; the adaptive bottom re-measure (v1.6.5) only catches ~one extra
     batch (bounded to 2vh). This pass, run BEFORE measuring, repeatedly scrolls to
     the bottom and waits for the append, until the feed stops growing, the height
     cap is reached, or a hard round cap — so a truly endless feed can't be chased.
     Honest boundary (same as loadMore): the loaded content is the desired capture
     and is LEFT in place; the pass sets no styles/attributes (it only scrolls, then
     restores scroll), so leave-no-trace holds and the byte-identical restore passes. */
  const INFINITE_MAX = 30;      // hard cap on scroll-append rounds — endless-feed guard
  const INFINITE_SETTLE = 400;  // ms to wait for the append after each bottom scroll

  async function infiniteScrollPass(root, cap) {
    const heightOf = () => {
      try {
        return root.isDoc
          ? (document.scrollingElement || document.documentElement).scrollHeight
          : root.el.scrollHeight;
      } catch (_) { return 0; }
    };
    const start = getScroll(root);
    let rounds = 0, stable = 0;
    for (let i = 0; i < INFINITE_MAX; i++) {
      if (aborted) break;
      const before = heightOf();
      if (before >= cap) break;                 // already at the height cap — stop chasing
      setScroll(root, start.x, before);         // clamps to the bottom → trips the near-bottom loader
      await nextFrame();
      await sleep(INFINITE_SETTLE);
      rounds++;
      if (heightOf() <= before + 4) { if (++stable >= 2) break; }   // two dead rounds → feed is done
      else stable = 0;
    }
    setScroll(root, start.x, start.y);          // restore (also re-done in the finally)
    await nextFrame();
    return rounds;
  }

  /* v1.6.13 — DOM-stability settle (opt-in `waitStable`). Skeleton/placeholder loaders
     render immediately and are swapped for real (often taller) content when a network
     fetch lands. Measuring before the swap captures grey placeholders and truncates the
     real content below them. This pass, run BEFORE measuring, polls the page and waits
     WHILE loading markers are present (`aria-busy="true"`, or a skeleton/shimmer/ghost-
     loader class/id) and until the height stops changing for a couple of quiet rounds,
     bounded by a hard time cap so a perpetual spinner can't hang the capture. Pure
     read-only: it sets no styles/attributes and does not scroll, so leave-no-trace holds
     trivially (nothing to restore). Honest boundary (like loadMore/infiniteScroll): the
     settled content is the desired capture and is left in place — the app's own fetch
     resolved it; the pass mutated nothing. */
  const STABLE_MAX_MS = 3000;    // hard cap on the whole wait — perpetual-spinner guard
  const STABLE_INTERVAL = 120;   // ms between polls
  const STABLE_ROUNDS = 2;       // consecutive quiet rounds required to declare "settled"
  const SKELETON_RE = /(^|[-_ ])(skeleton|shimmer|ghost[-_]?loader|content[-_]?loader|placeholder[-_]?(box|block|card|line|text|shimmer))([-_ ]|$)/i;

  function hasLoadingMarkers(doc) {
    let found = false;
    forEachDeep(doc.body || doc, el => {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return; // resolved/hidden markers don't count
      let busy = '';
      try { busy = el.getAttribute('aria-busy') || ''; } catch (_) {}
      if (busy === 'true') { found = true; return true; }
      let cls = '', id = '';
      try { cls = (el.className && el.className.toString) ? el.className.toString() : ''; } catch (_) {}
      try { id = el.id || ''; } catch (_) {}
      if (SKELETON_RE.test(cls) || SKELETON_RE.test(id)) { found = true; return true; }
      return false;
    });
    return found;
  }

  async function settleDomStability(root) {
    const heightOf = () => {
      try {
        return root.isDoc
          ? (document.scrollingElement || document.documentElement).scrollHeight
          : root.el.scrollHeight;
      } catch (_) { return 0; }
    };
    const deadline = performance.now() + STABLE_MAX_MS;
    let last = heightOf(), stable = 0;
    while (performance.now() < deadline) {
      if (aborted) break;
      const loading = hasLoadingMarkers(document);
      const h = heightOf();
      if (!loading && h === last) {
        if (++stable >= STABLE_ROUNDS) break;
      } else {
        stable = 0;
      }
      last = h;
      await nextFrame();
      await sleep(STABLE_INTERVAL);
    }
  }

  /* v1.5.0 — semantic break hints. Pixel-quiet rows can't tell the gap
     BETWEEN two posts from the gap between a post's title and its media
     inside one card. So the capture reports the content-space Y of section
     tops: children of feed-like containers (≥3 siblings ≥120px tall — the
     Reddit/Twitter/news-feed rhythm) plus explicit landmarks (article,
     section, h1-h3, tall li). The stitcher snaps part boundaries and PDF
     page breaks to these, so the next section starts the next page. */
  function collectBreakHints(root, rootRect, totalH) {
    const winW = document.documentElement.clientWidth || window.innerWidth;
    const storyX = root.isDoc ? 0 : rootRect.x;
    const storyW = root.isDoc ? winW : rootRect.w;
    const hintTags = /^(ARTICLE|SECTION|H1|H2|H3|LI)$/;
    // Taller than any output part — that's a feed CONTAINER, not a unit that
    // could ever be kept whole on one page. Containers must not be candidates:
    // they'd swallow their children in the nesting filter below (v1.5.1).
    const MAX_UNIT = 4000;
    const cands = [];
    const candSet = new Set();
    forEachDeep(document.body || document, el => {
      const h = el.offsetHeight;
      if (h < 120 || h > MAX_UNIT) return;
      if (el.clientWidth < storyW * 0.3) return;
      // feed rhythm: this element is one of ≥3 sizable siblings
      let rhythm = false;
      const p = composedParent(el);
      if (p && p.children && p.children.length >= 3) {
        let big = 0;
        const lim = Math.min(p.children.length, 60);
        for (let i = 0; i < lim && big < 3; i++) {
          if (p.children[i].offsetHeight >= 120) big++;
        }
        rhythm = big >= 3;
      }
      if (!rhythm && !(hintTags.test(el.tagName) && h >= 150)) return;
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { return; }
      if (cs.position === 'fixed' || cs.position === 'sticky') return;
      if (cs.visibility === 'hidden') return;
      let r;
      try { r = el.getBoundingClientRect(); } catch (_) { return; }
      if (r.width < storyW * 0.3) return;
      const cx = (r.left + r.right) / 2;
      if (cx < storyX || cx > storyX + storyW) return;
      cands.push({ el, top: r.top });
      candSet.add(el);
    });
    // Previous sibling in the composed tree (fake-DOM safe: no
    // previousElementSibling there — resolve through the parent's children).
    const prevOf = el => {
      const p = composedParent(el);
      if (!p || !p.children) return null;
      const i = Array.prototype.indexOf.call(p.children, el);
      return i > 0 ? p.children[i - 1] : null;
    };
    const ys = [];
    for (const c of cands) {
      // v1.5.1 — units, not their innards: an element nested inside another
      // candidate is content OF a card (gallery image, title wrapper) and a
      // cut there splits the card mid-post. Only the outermost card hints.
      if (hasAncestorIn(c.el, candSet)) continue;
      // v1.5.1 — a card's attached lead-ins (recommendation context bars,
      // "suggested for you" eyebrows, thin dividers) belong WITH the card
      // below them: merge immediately-preceding short siblings so the cut
      // carries them onto the next part instead of orphaning them.
      let top = c.top;
      let prev = prevOf(c.el);
      for (let m = 0; m < 3 && prev; m++) {
        if (candSet.has(prev)) break;
        let pr, pcs;
        try {
          pr = prev.getBoundingClientRect();
          pcs = getComputedStyle(prev);
        } catch (_) { break; }
        if (!(pr.height > 0 && pr.height <= 120)) break;
        if (pr.bottom > top + 1 || top - pr.bottom > 40) break;
        if (pcs.position === 'fixed' || pcs.position === 'sticky') break;
        if (pcs.visibility === 'hidden' || pcs.display === 'none') break;
        top = pr.top;
        prev = prevOf(prev);
      }
      const y = root.isDoc
        ? top + window.scrollY
        : top - rootRect.y + root.el.scrollTop;
      if (y < 200 || y > totalH - 200) continue;
      ys.push(Math.round(y));
    }
    ys.sort((a, b) => a - b);
    const out = [];
    for (const y of ys) {
      if (!out.length || y - out[out.length - 1] >= 8) out.push(y);
      if (out.length >= 3000) break;
    }
    return out;
  }

  /* v1.7.0 -- auto-redact PII (opt-in `redactPII`, default off). A pure,
     READ-ONLY scan of the composed tree: for every LEAF text element whose own
     text matches an email / phone / Luhn-valid card / US SSN / API token,
     record the matched TOKEN's rect(s) -- v1.9.6: Range.getClientRects over the
     [start,end) char span so ONLY the token is covered (per wrapped line),
     falling back to the whole-leaf rect when Range is unavailable/empty; EVERY
     token in the leaf, not just the first kind. result.js bakes an OPAQUE block
     over each (solid, not blur -- so it cannot be reversed). Leaf-only, so a
     container's concatenated descendant text can't over-redact, and so detection
     behaves identically in the fake-DOM pixel sim and a real browser. Coordinate
     frames: doc-scroll (page space), app-shell PANES (v1.9.4, pane-content space)
     and side RAILS (v1.9.5, each rail's content space, pane-tagged) -- all
     covered. Pure read => leave-no-trace holds. */
  function fsLuhnOk(num) {
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = num.charCodeAt(i) - 48;
      if (d < 0 || d > 9) return false;
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d; alt = !alt;
    }
    return num.length > 0 && sum % 10 === 0;
  }
  function fsHasCard(s) {
    const re = /\d(?:[ -]?\d){12,18}/g; let m;
    while ((m = re.exec(s))) {
      const d = m[0].replace(/[ -]/g, '');
      if (d.length >= 13 && d.length <= 19 && fsLuhnOk(d)) return true;
    }
    return false;
  }
  function fsHasPhone(s) {
    const re = /\+?\d[\d().\-\s]{5,}\d/g; let m;
    while ((m = re.exec(s))) {
      const raw = m[0], d = raw.replace(/\D/g, '');
      if (d.length >= 7 && d.length <= 15 && /[+().\-\s]/.test(raw)) return true;
    }
    return false;
  }
  const FS_PII = [
    ['email', s => /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(s)],
    ['ssn',   s => /\b\d{3}-\d{2}-\d{4}\b/.test(s)],
    ['token', s => /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(s)],
    ['card',  fsHasCard],
    ['phone', fsHasPhone]
  ];
  function fsPiiKind(s) {
    if (!s) return null;
    for (const pair of FS_PII) { try { if (pair[1](s)) return pair[0]; } catch (_) {} }
    return null;
  }
  function fsOwnLeafText(el) {
    if (el.children && el.children.length) return '';
    return el.textContent || '';
  }
  /* Leaf elements whose textContent is SOURCE, not the page's words: an inline
     script's code, a stylesheet's rules, the raw markup inside <noscript>.

     v1.10.3 — THIS IS NOW AN OPTIMISATION AND NOTHING ELSE, and the comment has
     to say so because the previous version of it was a safety mechanism and the
     two were confused (REDACTION-CLAIM-SPEC.md §4.3). What decides whether a
     string counts is the placement measurement below: a <script> or <style> is
     display:none with a 0x0 rect, so it fails clause 2 and clause 3 without any
     tag being consulted. Delete this table tomorrow and the CLAIM does not
     change — only the runtime, because five regexes would then run over a
     200 KB bundle, and the per-leaf 4,000-character cap would refuse it and
     book a `declined.tooLong` against every single-page app on the web.

     That is the whole difference between an optimisation and a safety
     mechanism: removing this one costs milliseconds and a noisier ledger. The
     count it skips is reported as `nonText` so the saving stays auditable, and
     no predicate anywhere reads that number. */
  const FS_NON_TEXT_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TITLE: 1 };

  /* The redaction walk's own time budget (REDACTION-CLAIM-SPEC.md §2.2). It is
     separate from MAX_WALK_MS because the user opted into this pass and it does
     strictly more work per leaf — a rect read, a style read and a bounded
     ancestor walk — where the layout-hint walk reads almost nothing. It is a
     named constant and its value is RECORDED IN THE LEDGER, because a state
     that depends on how fast the user's machine is must at least say what it
     was racing. */
  const FS_PII_WALK_MS = 1200;
  const FS_PII_MAX_BOXES = 2000;     // the box ceiling, named so the ledger can cite it
  const FS_PII_MAX_LEAF = 4000;      // per-leaf character cap
  const FS_PII_MAX_DEFER = 4000;     // spans held for the §2.3 re-measure

  /* ---- clauses 5 and 6: what the ancestors do to a box ----------------------
     A leaf's own getBoundingClientRect IGNORES ancestor clipping, and its own
     computed `visibility` IGNORES ancestor opacity. So a paragraph inside a
     collapsed accordion (`height:0; overflow:hidden`) reports a full-size rect
     with a font-size that agrees with it perfectly, and a paragraph inside an
     `opacity: 0` subtree reports `visibility: visible`. Both are invisible in
     the picture and both passed every self-consistency test.

     This returns the accumulated clip rectangle and opacity product imposed on
     a node BY ITS ANCESTORS, memoised per element — the chain is ten to twenty
     deep and it repeats for every sibling, so without the cache this is
     quadratic in a wide list.

     WHERE THE WALK STOPS is load-bearing and is the one judgement in here.
     `scope` is the container THIS PASS SCROLLS THROUGH — the document, the
     app-shell pane, a side rail, an inline-unrolled list. Everything at or
     above it is excluded, because a scroll container that FullShot steps
     through its whole content is not hiding that content from the image; it is
     the surface being unrolled. Everything below it is included, because a
     scroller FullShot does NOT unroll genuinely cuts its overflow out of the
     picture. That is a fact about this pass's own behaviour, not a guess about
     the page. (Panels grown by expandScrollablePanels need no special case:
     they are already their full size by the time this runs.) */
  function fsIsect(a, b) {
    if (!a) return { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
    return {
      left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.left + b.width), bottom: Math.min(a.bottom, b.top + b.height)
    };
  }
  function fsChainInfo(node, scope, cache) {
    if (!node || node === scope) return { clip: null, op: 1, ok: true };
    const hit = cache.get(node);
    if (hit) return hit;
    const up = fsChainInfo(composedParent(node), scope, cache);
    let out;
    if (!up.ok) {
      out = up;
    } else {
      let cs;
      try { cs = getComputedStyle(node); } catch (_) { cs = null; }
      if (!cs) {
        out = { clip: up.clip, op: up.op, ok: false };
      } else {
        const o = parseFloat(cs.opacity);
        if (!isFinite(o)) {
          /* An unreadable style is a FAILURE TO MEASURE, never a measurement.
             Routing it to `ok:false` — and from there to declined.unmeasurable —
             is what stops an engine that answers nothing from producing a
             confident negative that looks exactly like a reading. */
          out = { clip: up.clip, op: up.op, ok: false };
        } else {
          let clip = up.clip;
          let bad = false;
          if (String(cs.overflowX || 'visible') !== 'visible' ||
              String(cs.overflowY || 'visible') !== 'visible') {
            let r;
            try { r = node.getBoundingClientRect(); } catch (_) { r = null; }
            if (!r) bad = true; else clip = fsIsect(clip, r);
          }
          out = { clip, op: up.op * o, ok: !bad };
        }
      }
    }
    cache.set(node, out);
    return out;
  }
  /* v1.9.6 -- all PII matches in a string as {start,end,kind} char spans, so
     result.js can cover the token itself, not the whole leaf. Overlapping spans
     (e.g. an SSN that also matches the phone shape) are merged to one box. */
  function fsPiiMatches(s) {
    const raw = [];
    if (!s) return raw;
    const push = (re, kind, ok) => {
      re.lastIndex = 0; let m;
      while ((m = re.exec(s))) {
        if (!ok || ok(m[0])) raw.push({ start: m.index, end: m.index + m[0].length, kind });
        if (m.index === re.lastIndex) re.lastIndex++;   // zero-width safety
      }
    };
    push(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'email');
    push(/\b\d{3}-\d{2}-\d{4}\b/g, 'ssn');
    push(/\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, 'token');
    push(/\d(?:[ -]?\d){12,18}/g, 'card', t => { const d = t.replace(/[ -]/g, ''); return d.length >= 13 && d.length <= 19 && fsLuhnOk(d); });
    push(/\+?\d[\d().\-\s]{5,}\d/g, 'phone', t => { const d = t.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 && /[+().\-\s]/.test(t); });
    raw.sort((a, b) => a.start - b.start || b.end - a.end);   // earliest, longest first
    const out = [];
    let lastEnd = -1;
    for (const m of raw) { if (m.start >= lastEnd) { out.push(m); lastEnd = m.end; } }   // merge overlaps
    return out;
  }
  /* v1.9.6 -- the client rect(s) of a [start,end) token inside a leaf's text
     node (one per wrapped line). null => caller falls back to the whole leaf. */
  function fsTokenRects(el, start, end) {
    try {
      const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!doc || typeof doc.createRange !== 'function') return null;
      const node = el.firstChild;
      if (!node || node.nodeType !== 3) return null;
      const len = (node.nodeValue != null ? node.nodeValue : (node.textContent || '')).length;
      if (start < 0 || end > len || end <= start) return null;
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const list = range.getClientRects();
      const rects = list && list.length ? Array.prototype.slice.call(list) : null;
      if (typeof range.detach === 'function') { try { range.detach(); } catch (_) {} }
      return rects && rects.length ? rects : null;
    } catch (_) { return null; }
  }
  /* Returns { boxes, scan, remeasure } — a LEDGER, not a list, and every number
     in it is written by the line of code that performed the act it counts
     (REDACTION-CLAIM-SPEC.md §1, §2.1).

     WHY THE SHAPE CHANGED AGAIN. Five fixes have now tried to INFER whether the
     protection happened, each from a proxy: the setting, then a count of text
     leaves, then a filtered count of text leaves. Each proxy was defeated by a
     page shape nobody had enumerated — inline <script> text, screen-reader-only
     text, a text/plain document — and each was found in a real browser, never
     by a fixture written by someone who already knew the answer. Enumerating
     harder is the trap. So this function no longer produces anything that has
     to be INTERPRETED. It produces a record of what it did:

       fed / chars            strings actually handed to the detector
       placed / unplaced{}    for each of those, whether a match in it WOULD
                              have been covered by a block in this image, and
                              when not, which clause said so
       matched / boxes        what the detector found and what was emitted
       boxesFromUnplaced      a match inside text FullShot cannot see — the
                              1x1 sr-only email that used to reach the
                              STRONGEST state in the product (§7.3)
       declined{} / truncated{}  every refusal and every budget, at the refusal
       frames{}               the doors, counted, including the ones not opened
       walks / walksCompleted a rail walk that threw is a walk that did not
                              complete
       sealed                 set in the return statement, never in a finally

     `sealed` is a seal in the literal sense. A throw anywhere leaves it false,
     and false is `unknown`. Nothing downstream may infer it.

     WHAT THIS FUNCTION STILL CANNOT SEE, stated here because the next reader
     will look for it here: text inside a same-origin <iframe> (counted as a
     door, never walked — §5.4), text in an attribute or a ::before, and the own
     text of any element that has an element child, because fsOwnLeafText reads
     childless elements only. The last of those is not a page shape; it is the
     most common markup on the web, and it is why the sentence built from
     `chars` says "of this page's text" and never "of the text on this page". */
  function collectPIIBoxes(root, rootRect, totalH, totalW, sideJobs, inlineJobs) {
    const out = [];
    const L = {
      v: 2,
      fed: 0, chars: 0,
      placed: 0,
      unplaced: { offRegion: 0, degenerate: 0, hidden: 0, fontMismatch: 0, clipped: 0, faded: 0, total: 0 },
      unplacedChars: 0,
      inkPx: 0,
      nonText: 0,
      frames: { sameOrigin: 0, scanned: 0, crossOrigin: 0 },
      matched: 0, boxes: 0, boxesFromUnplaced: 0, matchedNoBox: 0,
      /* WHAT THE PASS PRODUCED AND COULD NOT KEEP. `blocksLost` counts BLOCKS —
         rectangles a match really did produce and the box ceiling refused to
         emit — and `matchesTruncated` counts the MATCHES that happened to.
         Both are written at the `break` that drops them, because a number
         computed at the refusal is the only kind that cannot be re-derived
         wrongly later. The names carry their units for the reason §2.1 gives:
         a block count is never subtracted from a match count. */
      blocksLost: 0, matchesTruncated: 0,
      /* The two `continue`s in the emit loop, which used to be silent. A rect
         narrower than a pixel and a rect outside the captured region both
         produce no block, and that is a legitimate no-block — but "we looked
         and there was nothing to draw" and "we drew nothing" are different
         facts, and only a counter can tell them apart afterwards. */
      rectsSkipped: { degenerate: 0, offRegion: 0 },
      lateTextPlaced: 0, lateChars: 0, lateMatched: 0,
      declined: { tooLong: 0, ceiling: 0, unmeasurable: 0, other: 0, total: 0 },
      declinedChars: 0,
      /* `error` is NOT a budget, and folding it into `walk` said the element
         budget stopped a walk that a subtree's refusal to enumerate stopped.
         Two different facts, and a reader can act on them differently: one says
         the page is enormous, the other says part of it would not answer. */
      truncated: { walk: false, time: false, ceiling: false, error: false },
      walks: 0, walksCompleted: 0,
      remeasured: 0, movedUncovered: 0,
      budgetMs: FS_PII_WALK_MS,
      /* THE COMPLETENESS THAT TRAVELS WITH `matched`, written at the seal from
         the facts recorded above. A COUNT WITHOUT ITS COMPLETENESS IS NOT A
         COUNT: `matched` is the number of matches in the text the detector was
         HANDED, and every budget, cap and refusal above changes how much of the
         page that is. Downstream may subtract `matched` from another counter
         (AI-HANDOFF-ENVELOPE.md §5 says so in as many words), so it must not be
         possible to read it as whole when it is not. */
      matchedComplete: false,
      sealed: false
    };
    const decline = (why, n) => { L.declined[why]++; L.declined.total++; L.declinedChars += n; };
    const unplace = (why, n) => { L.unplaced[why]++; L.unplaced.total++; L.unplacedChars += n; };
    /* Element references for the §2.3 re-measure. They NEVER leave this
       function's return value into a message or a record — §3.9.1 is absolute
       that the rectangles must not travel, and an element reference is a
       rectangle with a name on it. */
    const later = { matched: [], deferred: [] };
    const chainCache = new Map();

    // Doc captures: page space (r + window scroll). App-shell PANE captures
    // (v1.9.4): PANE-CONTENT space (r - rootRect + pane scroll). Side RAILS
    // (v1.9.5): each rail's OWN content space (r - railRect + rail scroll),
    // tagged with the rail index so result.js bakes at sideDraw[i].dx/dy + box*k.
    // All three mirror collectBreakHints' coordinate frames. Rail leaves are
    // scanned separately (below) and EXCLUDED from the doc/main walk, so a rail
    // element can't be mis-placed into doc/pane space (or double-baked).
    const isDoc = root.isDoc;
    const railSet = (sideJobs && sideJobs.length) ? new Set(sideJobs.map(j => j.el)) : null;
    const inlineSet = (inlineJobs && inlineJobs.length) ? new Set(inlineJobs.map(j => j.el)) : null;

    /* ---- the placement measurement (§2.2) ----------------------------------
       For every span fed to the detector, would a match in it have been painted
       over in THIS image? Clauses 1-3 are the tests the box path already
       performed; 4-6 are new, and because they are new they are applied to the
       box path too — a precondition that gates only the negative claim is two
       different preconditions wearing one name.

       None of the six is a tuned constant and none names a technique. Each
       compares facts THE PAGE ITSELF SUPPLIES — its text, the box its own
       layout gave that text, the clip its own ancestors impose — and asks
       whether they agree. When a 16px font is reported inside a 1x1 box the DOM
       is describing text that is not in the picture, and it does not matter
       which of `clip:rect(0,0,0,0)`, `width:1px;overflow:hidden`,
       `clip-path:inset(50%)`, `transform:scale(0)` or the seventh technique
       nobody has published yet produced the disagreement.

       Returns null when an input could not be READ — which is a failure to
       measure and is booked as declined.unmeasurable, never as a quiet "no".

       NO DOM WRITES HAPPEN IN HERE, and that is not a nicety: layout is flushed
       once and every subsequent getBoundingClientRect reads a clean tree, so
       the per-leaf cost is microseconds. Any future edit that writes to the DOM
       inside this walk turns it quadratic. */
    const measure = (el, cs, ox, oy, sx, sy, maxY, scope) => {
      let r;
      try { r = el.getBoundingClientRect(); } catch (_) { return null; }
      if (!r) return null;
      const x = r.left - ox + sx, y = r.top - oy + sy;
      const lim = maxY != null ? maxY : totalH;
      /* `rect` travels on EVERY answer, including the refusals. Over-masking is
         safe and over-claiming is not, so a match inside a span this
         measurement refused still gets its block painted — it just does not get
         to carry a claim. Withholding the rect here would silently drop the
         box, which is the safe direction for the image and the WRONG direction
         for the ledger: the counter that stops `blocks-painted` is
         boxesFromUnplaced, and a box that is never emitted cannot increment it. */
      // 1 — does the rect intersect the region this capture will actually show?
      if (y + r.height < 0 || y > lim || x > totalW || x + r.width < 0) return { why: 'offRegion', rect: r };
      // 2 — is there a box at all?
      if (r.width < 1 || r.height < 1) return { why: 'degenerate', rect: r, deferrable: true };
      // 3 — did the page take it out of what is drawn?
      if (cs.visibility === 'hidden' || cs.display === 'none') return { why: 'hidden', rect: r };
      // 4 — is the box consistent with the text the DOM says is inside it?
      const fsz = parseFloat(cs.fontSize);
      if (!isFinite(fsz) || fsz <= 0) return null;
      if (r.height < fsz) return { why: 'fontMismatch', rect: r };
      // 5 — does the box survive its ancestors' clipping?
      const chain = fsChainInfo(composedParent(el), scope, chainCache);
      if (!chain.ok) return null;
      if (chain.clip) {
        const c = fsIsect(chain.clip, r);
        if (c.right - c.left < 1 || c.bottom - c.top < fsz) return { why: 'clipped', rect: r };
      }
      // 6 — is it painted out?
      const selfOp = parseFloat(cs.opacity);
      if (!isFinite(selfOp)) return null;
      if (chain.op * selfOp <= 0) return { why: 'faded', rect: r };
      const cx0 = Math.max(0, x), cx1 = Math.min(totalW, x + r.width);
      const cy0 = Math.max(0, y), cy1 = Math.min(lim, y + r.height);
      return { why: null, rect: r,
               ink: Math.max(0, cx1 - cx0) * Math.max(0, cy1 - cy0) };
    };

    // Record each matched TOKEN's rect(s) into `out`, in the (ox,oy,sx,sy)
    // coordinate frame (v1.9.6: token-precise, per match, per wrapped line;
    // falls back to the whole leaf when Range is unavailable).
    const scan = (el, ox, oy, sx, sy, tag, maxY, scope) => {
      const tn = String(el.tagName).toUpperCase();
      /* §5.4 — count the doors. You cannot count the text behind a door you did
         not open; you can always count the doors, and whether contentDocument
         was readable is a fact this code learns at the moment it tries. Only
         frames that occupy space are counted: a 0x0 iframe puts nothing in the
         picture, and booking it would manufacture a warning about nothing.
         `scanned` stays 0 until the walk descends, which is why an unscanned
         same-origin frame breaks scanOk rather than being quietly tolerated —
         the capture pipeline GROWS these frames to full content height, so
         their pixels are the one thing about them that is certain. */
      if (tn === 'IFRAME' || tn === 'FRAME') {
        if (el.offsetWidth || el.offsetHeight) {
          let idoc = null;
          try { idoc = el.contentDocument; } catch (_) {}
          if (idoc && idoc.documentElement) L.frames.sameOrigin++; else L.frames.crossOrigin++;
        }
        return;
      }
      if (FS_NON_TEXT_TAGS[tn] === 1) { L.nonText++; return; }
      const txt = fsOwnLeafText(el);
      /* Whitespace between elements is not a text layer, and no PII pattern can
         match a run of spaces, so excluding it changes no box. */
      if (!txt || !/\S/.test(txt)) return;
      const n = txt.length;
      if (out.length >= FS_PII_MAX_BOXES) { decline('ceiling', n); L.truncated.ceiling = true; return; }
      if (n > FS_PII_MAX_LEAF) { decline('tooLong', n); return; }
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { decline('unmeasurable', n); return; }
      if (!cs) { decline('unmeasurable', n); return; }
      const pl = measure(el, cs, ox, oy, sx, sy, maxY, scope);
      if (!pl) { decline('unmeasurable', n); return; }

      L.fed++; L.chars += n;                 // the line before the detector call
      if (pl.why) {
        unplace(pl.why, n);
        /* §2.3(b) — a 0x0 rect at scan time is the signature of deferred
           rendering (content-visibility:auto, an unsized lazy image's caption,
           a virtualised row). Those sections are painted into the picture
           during the scroll loop, so "not in the picture" is a statement this
           pass is not yet entitled to make about them. Held for the re-measure. */
        if (pl.deferrable && later.deferred.length < FS_PII_MAX_DEFER) {
          later.deferred.push({ el, tag, maxY });
        } else if (pl.deferrable) {
          decline('other', 0);
        }
      } else {
        L.placed++; L.inkPx += pl.ink;
      }

      const matches = fsPiiMatches(txt);
      if (!matches.length) return;
      /* THE LINE AFTER THE DETECTOR RETURNS, AND IT COUNTS MATCHES, NOT LEAVES.
         It used to be `L.matched++` — one per element — which made the number
         incomparable with anything: a paragraph holding an email and a card
         counted as one, and `matched` could be smaller than `painted` on a page
         where nothing at all went wrong. REDACTION-CLAIM-SPEC.md §2.1 asks for
         the count "once per match", because that is what makes
         `painted < matched` arithmetic that a reader can act on rather than a
         comparison between two different units. */
      /* THE ORDINAL EACH BOX BELONGS TO, taken BEFORE the counter moves, so
         `match.id` is this capture's index of the match — 0-based, unique across
         every walk, because `L` is one ledger for the whole pass. It never
         travels alone: see the box literal below, where it is paired with the
         number of blocks that match produced.

         IT IS NOT DECORATION AND IT IS NOT GEOMETRY. One match emits ONE BOX PER
         CLIENT RECT, so a token that wraps across a line emits two, and without
         this integer the compositor can count blocks and nothing else. Counting
         blocks and subtracting them from `matched` is what let a wrapped card
         number pay for an entirely different uncovered email — the one case the
         whole design exists to surface, silenced by a line break. A match that
         produced three boxes because it wrapped is ONE match covered, not three,
         and this is the only thing that can say which three.

         It carries no text, no kind beyond the one already here, and no more
         information about the page than the rect it sits on; it dies with
         cap.meta at the end of the stitch, exactly as the rects do. */
      const matchBase = L.matched;
      L.matched += matches.length;
      const mine = [];
      for (let mx = 0; mx < matches.length; mx++) {
        const mt = matches[mx];
        const matchId = matchBase + mx;
        /* The ceiling was already full when this match came up: it produced
           nothing THIS PASS COULD KEEP, and nothing is drawn over it. Counted
           here rather than `break`ing out of the loop, so a leaf holding six
           matches past the ceiling books six uncovered matches and not one. */
        if (out.length >= FS_PII_MAX_BOXES) {
          L.matchedNoBox++; L.truncated.ceiling = true; continue;
        }
        const rects = fsTokenRects(el, mt.start, mt.end) || (pl.rect ? [pl.rect] : []);
        /* THE BLOCKS THIS MATCH PRODUCES, SETTLED BEFORE THE CEILING IS ASKED.
           This is the whole of the ninth round's defect. The emit loop used to
           test the ceiling as it pushed and `break` when it filled, so a match
           whose rectangles straddled the cap arrived downstream as the SUBSET
           that fitted — and the roll-up, grading a match against the blocks it
           was handed, found every one of them painted and read back opaque and
           called the match covered. The rule was right; its input was silently
           partial. Counting the production first is what makes the loss a
           number instead of an absence. */
        const kept = [];
        for (const r of rects) {
          if (!r || r.width < 1 || r.height < 1) { L.rectsSkipped.degenerate++; continue; }
          const x = r.left - ox + sx, y = r.top - oy + sy;
          if (y + r.height < 0 || y > (maxY != null ? maxY : totalH) || x > totalW) {
            L.rectsSkipped.offRegion++; continue;
          }
          kept.push({ x, y, r });
        }
        const produced = kept.length;
        /* A match that produced no rectangle at all. FullShot positively knows
           there is PII here and positively knows nothing was drawn over it —
           the same news as bake.unplaced, arriving from the other end. Counted
           PER MATCH: it used to be one per leaf, which made it the one counter
           in this ledger that could not be compared with `matched`. */
        if (!produced) { L.matchedNoBox++; continue; }
        let emitted = 0;
        for (const k of kept) {
          if (out.length >= FS_PII_MAX_BOXES) break;
          /* THE MATCH IDENTITY AND ITS BLOCK PRODUCTION, AS ONE VALUE.
             It used to be a bare `matchId` integer, and a bare id is exactly
             enough to group the blocks that ARRIVED — which is the read that
             graded a truncated match as covered. Carrying `blocks` inside the
             same object means the consumer cannot ask which match a block
             belongs to without also being told how many blocks that match
             produced: the wrong read is not discouraged, it is unavailable,
             because there is no other shape of this value to read.
             It carries no text and no more information about the page than the
             rect it sits on, and it dies with cap.meta exactly as the rects do. */
          const box = { x: Math.round(k.x), y: Math.round(k.y),
                        w: Math.round(k.r.width), h: Math.round(k.r.height),
                        kind: mt.kind, match: { id: matchId, blocks: produced } };
          if (tag) Object.assign(box, tag);
          out.push(box); L.boxes++; mine.push(box); emitted++;
          /* OVER-MASKING IS SAFE; OVER-CLAIMING IS NOT. The box is still emitted
             and still painted — covering a 1x1 rect costs nothing. What must not
             happen is the claim, so the fact that this match came from a span
             the placement measurement refused is recorded here, at the push,
             and §2.6 refuses `blocks-painted` while it is non-zero. */
          if (pl.why) L.boxesFromUnplaced++;
        }
        /* THE GIVING-UP, RECORDED AT THE GIVING-UP. Half a card number is a
           card number, so these blocks are the reason the match cannot be
           called covered — and the number of them is what tells a reader how
           much of the page the cap cost them. */
        if (emitted < produced) {
          L.blocksLost += produced - emitted;
          L.matchesTruncated++;
          L.truncated.ceiling = true;
        }
      }
      if (mine.length) later.matched.push({ el, tag, boxes: mine });
    };

    /* One walk per surface, each with its own scope for clauses 5-6 and each
       accounted for: `walks` is incremented before, `walksCompleted` after, so
       a rail walk that threw is visibly a walk that did not complete. */
    const runWalk = (start, fn) => {
      L.walks++;
      let res = null;
      try { res = forEachDeep(start, fn, FS_PII_WALK_MS); } catch (_) { return; }
      L.walksCompleted++;
      if (!res) return;
      /* ONE FLAG PER REASON. `error` used to be reported as `walk`, which told
         the reader the element budget had stopped a walk that a subtree's
         refusal to enumerate stopped — a true "we did not finish" wrapped
         around a false "because the page was too big". */
      if (res.stop === 'walk') L.truncated.walk = true;
      if (res.stop === 'time') L.truncated.time = true;
      if (res.stop === 'error') L.truncated.error = true;
    };

    const sx = isDoc ? (window.scrollX || 0) : (root.el.scrollLeft || 0);
    const sy = isDoc ? (window.scrollY || 0) : (root.el.scrollTop || 0);
    const ox = isDoc ? 0 : (rootRect ? rootRect.x : 0);
    const oy = isDoc ? 0 : (rootRect ? rootRect.y : 0);
    const start = isDoc ? (document.body || document) : root.el;
    runWalk(start, el => {
      if (railSet && (railSet.has(el) || hasAncestorIn(el, railSet))) return;      // rail -> handled below
      if (inlineSet && (inlineSet.has(el) || hasAncestorIn(el, inlineSet))) return; // inline list -> handled below
      scan(el, ox, oy, sx, sy, null, null, start);
    });
    // v1.9.5 side-rail pass: each rail's leaves in that rail's content space,
    // tagged with the rail index (matches the FS_FRAME `pane:` tags + sidePanes).
    if (railSet) {
      for (let i = 0; i < sideJobs.length; i++) {
        const job = sideJobs[i];
        const rox = job.rect.x, roy = job.rect.y;
        const rsx = job.el.scrollLeft || 0, rsy = job.el.scrollTop || 0;
        runWalk(job.el, el => scan(el, rox, roy, rsx, rsy, { pane: i }, null, job.el));
      }
    }
    // v1.9.8 inline-unrolled virtual-list pass: each embedded list's leaves in
    // that list's CONTENT space (r - listRect + list scroll), tagged inline:i so
    // result.js bakes them at inlineDraw[i].finalTop + box*k. Excluded from the doc
    // walk above (like rails), so a list leaf can't be mis-placed into doc space.
    // Bound by the list's fullH (its content can run past the document totalH).
    if (inlineSet) {
      for (let i = 0; i < inlineJobs.length; i++) {
        const job = inlineJobs[i];
        let lr;
        try { lr = job.el.getBoundingClientRect(); } catch (_) { L.walks++; continue; }
        const iox = lr.x != null ? lr.x : lr.left, ioy = lr.y != null ? lr.y : lr.top;
        const isx = job.el.scrollLeft || 0, isy = job.el.scrollTop || 0;
        runWalk(job.el, el => scan(el, iox, ioy, isx, isy, { inline: i }, job.fullH, job.el));
      }
    }

    /* ---- the second measurement (§2.3) -------------------------------------
       This pass runs BEFORE the scroll loop. Between it and the last frame the
       page lazy-loads, reflows and realises deferred sections. A block painted
       at a rect the text has since left is a block over nothing, next to
       visible PII, in an image the record calls redacted.

       The caller invokes this after the last frame and BEFORE FS_DONE — and
       therefore before the `finally` that restores every scroll position and
       every style. Measure after the restore and everything has moved by
       definition, the number reads ~100%, and the feature looks permanently
       broken. Two bounded sets, both act-derived: a second reading, not a model
       of what might have happened. */
    const remeasure = () => {
      const frameOf = (tag) => {
        if (tag && tag.pane != null && sideJobs && sideJobs[tag.pane]) {
          const j = sideJobs[tag.pane];
          return { ox: j.rect.x, oy: j.rect.y, sx: j.el.scrollLeft || 0, sy: j.el.scrollTop || 0, scope: j.el };
        }
        if (tag && tag.inline != null && inlineJobs && inlineJobs[tag.inline]) {
          const j = inlineJobs[tag.inline];
          let r;
          try { r = j.el.getBoundingClientRect(); } catch (_) { return null; }
          return { ox: r.x != null ? r.x : r.left, oy: r.y != null ? r.y : r.top,
                   sx: j.el.scrollLeft || 0, sy: j.el.scrollTop || 0, scope: j.el };
        }
        if (isDoc) return { ox: 0, oy: 0, sx: window.scrollX || 0, sy: window.scrollY || 0, scope: start };
        let rr;
        try { rr = root.el.getBoundingClientRect(); } catch (_) { return null; }
        return { ox: rr.x != null ? rr.x : rr.left, oy: rr.y != null ? rr.y : rr.top,
                 sx: root.el.scrollLeft || 0, sy: root.el.scrollTop || 0, scope: root.el };
      };
      /* (a) DRIFT. The test is CONTAINMENT, not equality, and against the rect
         that was actually PAINTED — the emitted box grown by the bake's own
         padding. Exact equality would fire on a web font swapping in, on a
         sub-pixel line-height change, on a scrollbar appearing: on essentially
         every page. A check that fires on everything is a check nobody reads,
         and a warning nobody reads protects nobody. */
      for (const ent of later.matched) {
        const f = frameOf(ent.tag);
        if (!f) continue;
        L.remeasured++;
        let txt = '';
        try { txt = fsOwnLeafText(ent.el); } catch (_) {}
        const now = fsPiiMatches(txt);
        if (!now.length) continue;             // the PII left; the block covers whatever is there
        let escaped = false;
        for (const mt of now) {
          const rects = fsTokenRects(ent.el, mt.start, mt.end);
          if (!rects) continue;
          for (const r of rects) {
            if (!r || r.width < 1 || r.height < 1) continue;
            const x = r.left - f.ox + f.sx, y = r.top - f.oy + f.sy;
            let covered = false;
            for (const b of ent.boxes) {
              if (x >= b.x - 2 && y >= b.y - 2 &&
                  x + r.width <= b.x + b.w + 2 && y + r.height <= b.y + b.h + 2) { covered = true; break; }
            }
            if (!covered) escaped = true;
          }
        }
        if (escaped) L.movedUncovered++;
      }
      /* (b) DEFERRED RENDERING. 0x0 when it was measured, painted into the
         picture by the last frame. If such a span is placed now, run the
         detector on it: a match here is PII that is in the image and was never
         covered, which is the same loud outcome as an unplaced box. This is the
         clause that closes content-visibility:auto — a page shape discovered
         after the design was written, landing correctly without being named. */
      for (const ent of later.deferred) {
        const f = frameOf(ent.tag);
        if (!f) continue;
        let cs;
        try { cs = getComputedStyle(ent.el); } catch (_) { continue; }
        if (!cs) continue;
        const pl = measure(ent.el, cs, f.ox, f.oy, f.sx, f.sy, ent.maxY, f.scope);
        if (!pl || pl.why) continue;
        let txt = '';
        try { txt = fsOwnLeafText(ent.el); } catch (_) {}
        if (!txt || !/\S/.test(txt)) continue;
        if (fsPiiMatches(txt).length) L.lateMatched++;
        else { L.lateTextPlaced++; L.lateChars += txt.length; }
      }
    };

    /* THE COMPLETENESS OF `matched`, WRITTEN WHERE THE COUNT IS FINISHED.
       Every clause is a place this pass GAVE UP, and each of them means the
       detector was handed less than the walk could have reached:

         truncated.walk / .time      the walk's own budgets — we stopped early
         truncated.ceiling           the box cap — we stopped emitting, and
                                     past it whole leaves went unread
         truncated.error             a subtree refused to enumerate
         walksCompleted < walks      a walk threw, or a rail's rect could not
                                     be read, so that surface was never entered
         declined.total              a leaf we refused item by item: its text
                                     was over the per-leaf cap, or its style or
                                     rect could not be read at all. `other` — a
                                     span the SECOND measurement had no room to
                                     hold — is in this total too, and that is
                                     over-cautious rather than exact: that leaf's
                                     text WAS read. Over-claiming coverage is the
                                     failure this design exists to remove, so
                                     where the two directions differ this takes
                                     the one that claims less. `textRefused`
                                     stays exact, and leaves `other` out.
         frames.scanned < .sameOrigin  a door we counted, could have opened,
                                     and did not walk through — §5.4. The
                                     counter above is written at the moment
                                     `scan()` meets an IFRAME whose
                                     contentDocument is readable and returns
                                     without descending, and until this clause
                                     existed it was WRITTEN AND NEVER READ: the
                                     pass positively observed itself declining
                                     to read a document, counted the refusal,
                                     and then sealed the count as whole. That is
                                     the exact shape §2.1.1 forbids, and it
                                     failed toward the reader believing more was
                                     covered than was. Written as
                                     `scanned === sameOrigin` and not
                                     `sameOrigin === 0` so that the day the walk
                                     DOES descend, this clause stops being a
                                     permanent false instead of having to be
                                     found and deleted. Cross-origin doors are
                                     not in it: nothing in this pass could have
                                     read them, so there is no act here that was
                                     given up on — the standing limits the
                                     payload carries say that separately.

       It is a conjunction rather than a count because it answers ONE question —
       is this number the whole number — and the reasons stay separately
       counted above so a reader can still see WHICH giving-up cost them what. */
    L.matchedComplete = !L.truncated.walk && !L.truncated.time &&
                        !L.truncated.ceiling && !L.truncated.error &&
                        L.walksCompleted === L.walks && L.declined.total === 0 &&
                        L.frames.scanned === L.frames.sameOrigin;
    /* THE SEAL, in the return statement. Not in a `finally`, not by the caller:
       a throw anywhere above must leave this false, because "the pass reached
       its own last line" is the one thing a `finally` cannot honestly say. */
    L.sealed = true;
    return { boxes: out, scan: L, remeasure };
  }

  function getScroll(root) {
    return root.isDoc
      ? { x: window.scrollX, y: window.scrollY }
      : { x: root.el.scrollLeft, y: root.el.scrollTop };
  }

  function setScroll(root, x, y) {
    if (root.isDoc) window.scrollTo(x, y);
    else { root.el.scrollLeft = x; root.el.scrollTop = y; }
  }

  async function preScrollPass(root, totalH, vh) {
    // Quick pass down the page to trigger lazy-loaded content.
    for (let y = 0; y < totalH; y += vh * 2) {
      if (aborted) return;
      setScroll(root, 0, y);
      await sleep(60);
    }
    setScroll(root, 0, totalH);
    await sleep(350);
    setScroll(root, 0, 0);
    await sleep(250);
  }

  /* v1.6.4 — decode not-yet-ready images so a frame isn't grabbed while they're
     still blank/black (late-paint / lazy-image / skeleton black tiles). Bounded:
     at most `maxN` pending images per call, and the whole wait is raced against
     `capMs` so a slow or broken decode can never stall the capture. A no-op once
     everything is decoded. (A truly hardware-composited <video>/WebGL surface is
     still unreadable by captureVisibleTab — that needs the CDP path.) */
  async function settleImages(imgs, capMs, maxN) {
    const pending = [];
    for (let i = 0; i < imgs.length && pending.length < maxN; i++) {
      try { if (!imgs[i].complete) pending.push(imgs[i]); } catch (_) {}
    }
    if (!pending.length) return;
    const jobs = pending.map(im => {
      try { return im.decode ? im.decode().catch(() => {}) : Promise.resolve(); }
      catch (_) { return Promise.resolve(); }
    });
    await Promise.race([Promise.all(jobs), sleep(capMs)]);
  }

  /* v1.6.6 — opt-in "hide distractions" pass. Consent/GDPR banners, newsletter
     modals and "get the app" interstitials sit in the shot (usually unwanted) and
     often scroll-lock the page (a modal sets html/body overflow:hidden), so the
     capture is stuck on the top view. Before choosing the scroll root we neutralize
     the lock and hide the overlays; everything is recorded and restored afterwards.
     Targeted so it doesn't remove real furniture: known consent-framework selectors,
     role=dialog / aria-modal overlays, and fixed high-z elements that cover most of
     the viewport (backdrops/interstitials). Opt-in. */
  const CONSENT_RE = /(cookie|consent|gdpr|ccpa|onetrust|ot-sdk|usercentrics|cookiebot|cookieyes|cc-window|didomi|truste|trustarc|osano|klaro|termly|complianz|borlabs|quantcast|qc-cmp|sourcepoint|sp[-_]message|iubenda|privacy[-_ ]?(banner|bar|notice|prompt))/i;
  const MODAL_RE = /(newsletter|subscribe|sign[-_ ]?up|paywall|interstitial|modal[-_]?(overlay|backdrop|dialog)|popup[-_]?(overlay|modal)|get[-_]?the[-_]?app|app[-_]?(banner|download[-_]?prompt)|promo[-_]?modal|cmpbox|moove_gdpr|cookie[-_]?(notice|law)|evidon|ensighten|catapult[-_]?cookie|intercom|drift[-_]?(widget|frame)|crisp[-_]?(client|chatbox)|zendesk|zopim|ze[-_]widget|tawk|livechat(inc|[-_]widget)|freshchat|fc[-_]widget|hubspot[-_]?messages|helpscout|hs[-_]beacon|olark|chat[-_]?(widget|bubble|launcher))/i;

  function hideOverlays(doc) {
    const out = [];
    const win = doc.defaultView || window;
    const winW = doc.documentElement.clientWidth || win.innerWidth;
    const winH = win.innerHeight;
    // 1) unlock scroll — a modal commonly pins the page via overflow:hidden/fixed
    for (const el of [doc.documentElement, doc.body]) {
      if (!el) continue;
      let cs; try { cs = win.getComputedStyle(el); } catch (_) { continue; }
      if (/(hidden|clip)/.test(cs.overflowY) || /(hidden|clip)/.test(String(cs.overflowX)) || cs.position === 'fixed') {
        out.push({ el, css: el.getAttribute('style') });
        el.style.setProperty('overflow', 'visible', 'important');
        if (cs.position === 'fixed') el.style.setProperty('position', 'static', 'important');
      }
    }
    // 2) hide consent banners, modal dialogs, fixed full-cover interstitials
    forEachDeep(doc.body || doc, el => {
      if (el === doc.body || el === doc.documentElement) return;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
      let cs; try { cs = win.getComputedStyle(el); } catch (_) { return; }
      let id = '', cls = '', label = '', role = '', ariaModal = '';
      try { id = el.id || ''; } catch (_) {}
      try { cls = (el.className && el.className.toString) ? el.className.toString() : ''; } catch (_) {}
      try { label = el.getAttribute('aria-label') || ''; } catch (_) {}
      try { role = el.getAttribute('role') || ''; } catch (_) {}
      try { ariaModal = el.getAttribute('aria-modal') || ''; } catch (_) {}
      const isConsent = CONSENT_RE.test(id) || CONSENT_RE.test(cls) || CONSENT_RE.test(label);
      const isDialog = role === 'dialog' || role === 'alertdialog' || ariaModal === 'true';
      const fixedOrSticky = cs.position === 'fixed' || cs.position === 'sticky';
      let z = parseInt(cs.zIndex, 10); if (!isFinite(z)) z = 0;
      let r; try { r = el.getBoundingClientRect(); } catch (_) { return; }
      const coversMost = r.width >= winW * 0.6 && r.height >= winH * 0.6;
      const isModalKw = fixedOrSticky && (MODAL_RE.test(id) || MODAL_RE.test(cls) || MODAL_RE.test(label));
      const hide = isConsent ||
                   (isDialog && fixedOrSticky) ||
                   el.tagName === 'DIALOG' ||          // native <dialog open> modal (v1.6.8)
                   isModalKw ||                        // newsletter/signup/paywall/get-the-app (v1.6.9)
                   (cs.position === 'fixed' && z >= 1000 && coversMost);
      if (!hide) return;
      out.push({ el, css: el.getAttribute('style') });
      el.style.setProperty('display', 'none', 'important');
    });
    return out;
  }

  function restoreOverlays(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      try {
        const r = list[i];
        if (r.css == null) r.el.removeAttribute('style');
        else r.el.setAttribute('style', r.css);
      } catch (_) {}
    }
  }

  async function run(settings) {
    fsVirtualCount = 0;
    // Hide distractions BEFORE choosing the scroll root, so an unlocked page is
    // measured and a modal's own scroller can't win the root vote (opt-in).
    let overlayRestores = [];
    if (settings.hideOverlays) { try { overlayRestores = hideOverlays(document); } catch (_) {} }
    const root = findScrollRoot();
    const original = getScroll(root);
    // Inner-pane captures pin the window at the top so the shell chrome sits
    // exactly where the stitcher expects it — remember where the user was.
    const originalWin = { x: window.scrollX, y: window.scrollY };
    // Snapshot BEFORE any of our own mutations touch the page.
    const innerScrolls = snapshotInnerScrolls(root.el);
    let rootCss = null;
    if (!root.isDoc) {
      root.el.setAttribute('data-fullshot-root', '');
      // The [data-fullshot-root] page rule can't reach a root inside a
      // shadow tree — disable scroll anchoring inline instead.
      rootCss = root.el.getAttribute('style');
      root.el.style.setProperty('overflow-anchor', 'none', 'important');
    }
    const css = injectCaptureCss();
    let hiddenEls = [];

    // Expand-inner-content mode (opt-in).
    const expanded = [];
    const expandedSet = new Set();
    let frameReportHandler = null;
    let interactiveRestores = [];

    try {
      await nextFrame(); // let scrollbar-hiding css apply
      // v1.5.2: late-loading web fonts reflow text between frames (seam risk).
      // Wait for fonts to settle before measuring heights and stepping; timeout-
      // guarded so a never-resolving fonts.ready can never hang the capture.
      if (document.fonts && document.fonts.ready) {
        try { await Promise.race([document.fonts.ready, sleep(1500)]); } catch (_) {}
      }

      // v1.6.11 — network "load more" loop (opt-in): click "load more"/"show
      // more" buttons and wait for the app to append content, repeatedly, until
      // exhausted or the height cap is hit — BEFORE measuring, so the fuller page
      // is captured. The appended content is the desired capture and is left in
      // place (a real user click reveals it the same way); the loop sets no
      // styles/attributes itself, so there is nothing to restore.
      if (settings.loadMore) {
        try { await clickLoadMore(root, settings.maxPageHeight || 50000); } catch (_) {}
      }

      // v1.6.12 — infinite-scroll feeds with no "load more" button (opt-in):
      // repeatedly scroll to the bottom and wait for the app to append the next
      // page, until the feed stops growing or a hard cap — BEFORE measuring, so the
      // fuller page is captured. Bounded so an endless feed can't be chased. Loaded
      // content is left in place (like a real user scrolling); the pass sets no
      // styles/attributes, only scroll (restored), so leave-no-trace holds.
      if (settings.infiniteScroll) {
        try { await infiniteScrollPass(root, settings.maxPageHeight || 50000); } catch (_) {}
      }

      // v1.6.13 — DOM-stability settle (opt-in): wait for skeleton/placeholder loaders to
      // resolve to real content BEFORE measuring, so a mid-page skeleton->data swap isn't
      // captured as grey placeholders (or truncated when the real content is taller).
      // Bounded and pure read-only (no mutations, no scroll), so leave-no-trace holds.
      if (settings.waitStable) {
        try { await settleDomStability(root); } catch (_) {}
      }

      // v1.6.2 — interaction-gated content (opt-in): reveal collapsed <details>,
      // hidden tab panels and accordions BEFORE measuring/expanding, so their
      // content is laid out and captured. Restored byte-identically afterwards.
      if (settings.expandInteractive) {
        interactiveRestores = revealInteractive(document);
        if (interactiveRestores.length) await nextFrame();
      }

      if (settings.expandInner) {
        // Panels in the main document. On app-shell pages (inner scroll root)
        // only panels inside the root are grown — everything outside it is
        // viewport furniture that can't get taller than the shell anyway.
        const protectedEls = new Set();
        for (let n = root.el; n; n = composedParent(n)) protectedEls.add(n);
        const scope = root.isDoc ? (document.body || document.documentElement) : root.el;
        const positioned = expandScrollablePanels(
          document, scope, protectedEls, settings.maxPageHeight, expanded, expandedSet);

        if (settings.expandFrames) {
          // Same-origin frames first, synchronously — also covers frames the
          // scripting API can't reach (srcdoc/about: edge cases). Overlap with
          // the helper protocol is safe: re-growth no-ops once a frame is sized.
          expandSameOriginIframes(document, settings.maxPageHeight, expanded, expandedSet, positioned, protectedEls);
          // All frames (incl. cross-origin): helper script reports heights up.
          frameReportHandler = makeFrameReportHandler(positioned, protectedEls, expanded, expandedSet);
          window.addEventListener('message', frameReportHandler);
          await chrome.runtime.sendMessage({ type: 'FS_EXPAND_FRAMES' });
          await sleep(1300); // let nested frames converge bottom-up
          // Freeze layout: late reports must not reflow the page mid-capture.
          window.removeEventListener('message', frameReportHandler);
          frameReportHandler = null;
        } else {
          // No extra permission: same-origin iframes only.
          expandSameOriginIframes(document, settings.maxPageHeight, expanded, expandedSet, positioned, protectedEls);
        }
        // Panels sized before the iframes inside them grew may now clip
        // them — re-grow. Two passes cover panel-in-panel nesting.
        for (let pass = 0; pass < 2; pass++) {
          for (const r of expanded) {
            if (r.el && r.el.tagName !== 'IFRAME' && r.el.tagName !== 'FRAME') {
              growPanel(r.el, settings.maxPageHeight, expanded, expandedSet);
            }
          }
        }
        await nextFrame(); // settle layout before measuring
      }

      const winW = document.documentElement.clientWidth || window.innerWidth;
      const winH = window.innerHeight;

      /* Inner-pane root: the visible tab shows the pane PLUS the app shell
         around it (header, rails, footer). Measure the pane's viewport rect
         so the stitcher can crop each frame to the pane and keep the shell
         chrome where it belongs. Scroll steps must use the VISIBLE part of
         the pane — its clientHeight can exceed what's on screen. */
      let rootRect = null;
      if (!root.isDoc) {
        window.scrollTo(0, 0);
        await nextFrame();
        let r;
        try { r = root.el.getBoundingClientRect(); } catch (_) { r = { left: 0, top: 0 }; }
        const rx = Math.max(0, r.left + (root.el.clientLeft || 0));
        const ry = Math.max(0, r.top + (root.el.clientTop || 0));
        rootRect = {
          x: rx, y: ry,
          w: Math.max(1, Math.min(root.el.clientWidth, winW - rx)),
          h: Math.max(1, Math.min(root.el.clientHeight, winH - ry))
        };
      }

      const vw = root.isDoc ? winW : rootRect.w;
      const vh = root.isDoc ? winH : rootRect.h;

      // Content that can actually pass through the visible band. When the
      // pane's bottom is cut off by the viewport, the difference between its
      // clientHeight and visible height can never be shown — exclude it.
      const reachableH = root.isDoc
        ? root.el.scrollHeight
        : root.el.scrollHeight - (root.el.clientHeight - rootRect.h);
      const reachableW = root.isDoc
        ? root.el.scrollWidth
        : root.el.scrollWidth - (root.el.clientWidth - rootRect.w);

      let totalW = Math.max(reachableW, vw);
      let totalH = Math.max(reachableH, vh);
      totalH = Math.min(totalH, settings.maxPageHeight || 50000);
      // Horizontal capture is capped too (rare, but supported).
      totalW = Math.min(totalW, 20000);

      if (settings.preScroll) {
        await preScrollPass(root, totalH, vh);
        const reH = root.isDoc
          ? root.el.scrollHeight
          : root.el.scrollHeight - (root.el.clientHeight - rootRect.h);
        totalH = Math.min(Math.max(reH, vh), settings.maxPageHeight || 50000);
      }

      // v1.6.5 — late-growing bottom content (lazy "mega-footers", e.g. Amazon's
      // AbeBooks/AWS/… grid only renders when scrolled near the bottom). We
      // measured totalH before scrolling down, so it can be short and the capture
      // stops above the true bottom. Jump once past the bottom to trigger the
      // lazy render, re-measure, and extend — bounded to footer-sized growth
      // (<= 2 viewports) so infinite feeds aren't chased. Doc captures; skipped
      // when preScroll already did a full pass. Gated by adaptiveWait.
      if (settings.adaptiveWait && !settings.preScroll) {
        const prev = getScroll(root);
        setScroll(root, prev.x, totalH + vh * 4);
        await nextFrame();
        await sleep(250);
        let reH = root.isDoc
          ? root.el.scrollHeight
          : root.el.scrollHeight - (root.el.clientHeight - rootRect.h);   // v1.6.9: panes too
        reH = Math.min(reH, settings.maxPageHeight || 50000);
        if (reH > totalH && reH <= totalH + vh * 2) totalH = reH;
        setScroll(root, prev.x, prev.y);
        await nextFrame();
      }

      /* v1.4.0 — secondary side panes. On app-shell pages the shell's own
         rails (left nav, chat list) have hidden content of their own. The
         main grid can't reach it (scrolling the rail would move it in every
         frame), so qualifying rails get a dedicated scroll pass after the
         grid; the stitcher unrolls each into its column, from its top,
         never growing the canvas past the main story. */
      const sideJobs = [];
      if (settings.expandInner) {
        const rootChain = new Set();
        for (let n = root.el; n; n = composedParent(n)) rootChain.add(n);
        const rootSet = new Set([root.el]);
        const cands = [];
        forEachDeep(document.body || document, el => {
          if (rootChain.has(el)) return;                    // root or shell ancestor
          if (el.clientWidth < 100 || el.clientHeight < winH * 0.3) return;
          const range = el.scrollHeight - el.clientHeight;
          if (range < 120) return;
          // inside the main pane → the grid already captures it (app-shell
          // roots only: on doc roots EVERYTHING descends from the root)
          if (!root.isDoc && hasAncestorIn(el, rootSet)) return;
          let cs;
          try { cs = getComputedStyle(el); } catch (_) { return; }
          if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return;
          if (cs.visibility === 'hidden') return;
          // v1.5.0: fixed rails (Reddit-style left nav) are ALLOWED — they get
          // un-hidden for their own pass. Track whether this scroller lives in
          // a fixed chain; reject hidden ancestry outright.
          let fixedChain = cs.position === 'fixed';
          let hiddenAnc = false;
          for (let n = composedParent(el); n; n = composedParent(n)) {
            let pcs;
            try { pcs = getComputedStyle(n); } catch (_) { break; }
            if (pcs.position === 'fixed') fixedChain = true;
            if (pcs.visibility === 'hidden') { hiddenAnc = true; break; }
          }
          if (hiddenAnc) return;
          let r;
          try { r = el.getBoundingClientRect(); } catch (_) { return; }
          if (r.width < 1 || r.height < 1) return;
          if (r.bottom <= 0 || r.top >= winH || r.right <= 0 || r.left >= winW) return;
          if (fixedChain) {
            // Rail-shaped and edge-anchored only — never a centered overlay.
            if (r.width > Math.max(440, winW * 0.35)) return;
            if (r.left > 32 && r.right < winW - 32) return;
          } else {
            // In-flow rails: app-shell captures only (on document-scrolling
            // pages expansion already unrolls in-flow panels; anything still
            // scrollable there is virtualized and can't be helped by a pass
            // that leaves it in place). Must sit BESIDE the pane's column.
            if (root.isDoc || !rootRect) return;
            const rx = Math.max(0, r.left), rw = Math.min(el.clientWidth, winW - rx);
            const overlap = Math.max(0, Math.min(rx + rw, rootRect.x + rootRect.w) - Math.max(rx, rootRect.x));
            if (overlap > Math.min(12, rw * 0.2)) return; // rounding slivers only
          }
          cands.push({ el, range, fixedChain });
        });
        cands.sort((a, b) => b.range - a.range);
        // Rows below this can never be drawn — the output ends there.
        const outHcss = root.isDoc
          ? totalH
          : rootRect.y + totalH + Math.max(0, winH - rootRect.y - rootRect.h);
        for (const c of cands.slice(0, 2)) {
          let r;
          try { r = c.el.getBoundingClientRect(); } catch (_) { continue; }
          const sx = Math.max(0, r.left + (c.el.clientLeft || 0));
          const sy = Math.max(0, r.top + (c.el.clientTop || 0));
          const sw = Math.max(1, Math.min(c.el.clientWidth, winW - sx));
          const sh = Math.max(1, Math.min(c.el.clientHeight, winH - sy));
          if (sw < 40 || sh < 40) continue;
          // rows that can pass through the visible band, capped at what the
          // output can actually show below the rail's top edge
          const reach = c.el.scrollHeight - (c.el.clientHeight - sh);
          const useful = Math.min(reach, outHcss - sy, settings.maxPageHeight || 50000);
          if (useful <= sh + 1) continue;
          const sys = [];
          for (let y = 0; y + sh < useful; y += sh) sys.push(y);
          sys.push(Math.max(0, useful - sh));
          sideJobs.push({ el: c.el, top: c.el.scrollTop, ys: sys, fixedChain: c.fixedChain,
                          rect: { x: sx, y: sy, w: sw, h: sh } });
        }
      }
      const sideFrameCount = sideJobs.reduce((a, j) => a + j.ys.length, 0);

      // v1.6.1 — embedded virtualized (render-window) lists: opt-in inline
      // unroll. Such a list is NOT the scroll root and NOT a fixed rail — it
      // sits in document flow, so the main grid captures only its current
      // window. When settings.unrollVirtual is on, plan a stepped pass over its
      // full content; the stitcher injects the windows at the list's slot,
      // growing the page there (mid-page vertical injection). Document scroll only.
      const inlineJobs = [];
      if (settings.expandInner && settings.unrollVirtual) {
        const rootChain = new Set();
        for (let n = root.el; n; n = composedParent(n)) rootChain.add(n);
        const inlineRootSet = new Set([root.el]);
        forEachDeep(document.body || document, el => {
          if (rootChain.has(el)) return;
          // v1.9.10 pane root: only lists INSIDE the pane compose with the
          // pane's own unroll; a virtualized list in the shell chrome is a
          // side-rail's job (or left as-seen). Doc root: any embedded list.
          if (!root.isDoc && !hasAncestorIn(el, inlineRootSet)) return;
          if (el.clientWidth < 80 || el.clientHeight < 80) return;
          if (el.scrollHeight - el.clientHeight < VLIST_MIN_RANGE) return;
          let cs;
          try { cs = getComputedStyle(el); } catch (_) { return; }
          if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return;
          if (cs.visibility === 'hidden' || cs.position === 'fixed') return;
          // fixed/hidden ancestry → a fixed rail (the side pass's job) or off-screen
          let bad = false;
          for (let n = composedParent(el); n; n = composedParent(n)) {
            let pcs;
            try { pcs = getComputedStyle(n); } catch (_) { break; }
            if (pcs.position === 'fixed' || pcs.visibility === 'hidden') { bad = true; break; }
          }
          if (bad) return;
          if (!isVirtualized(el)) return;
          let r;
          try { r = el.getBoundingClientRect(); } catch (_) { return; }
          if (r.width < 40 || r.height < 40) return;
          // Slot top in the SCROLL ROOT's content space (v1.9.10): doc = page
          // space (r + window scroll); pane = pane-content space
          // (r - rootRect + pane scroll), mirroring collectBreakHints/collectPIIBoxes.
          const docY = root.isDoc
            ? Math.round(r.top + window.scrollY)
            : Math.round(r.top - rootRect.y + root.el.scrollTop);
          const clientH = el.clientHeight;
          const fullH = Math.min(el.scrollHeight, settings.maxPageHeight || 50000);
          const winY = Math.min(docY, Math.max(0, totalH - vh));   // scroll that reveals it
          const planTop = Math.max(0, docY - winY);
          const visH = Math.max(1, Math.min(clientH, vh - planTop));
          if (visH < 40) return;
          const ys = [];
          for (let y = 0; y + visH < fullH; y += visH) ys.push(y);
          ys.push(Math.max(0, fullH - visH));
          inlineJobs.push({ el, docY, clientH, fullH, winY, visH, top0: el.scrollTop, ys });
        });
        if (inlineJobs.length > 2) inlineJobs.length = 2;   // cap the work
      }
      const inlineFrameCount = inlineJobs.reduce((a, j) => a + j.ys.length, 0);

      // v1.5.0: section tops for part/PDF boundary snapping (budgeted walk).
      const breakHints = collectBreakHints(root, rootRect, totalH);
      /* THE INVOCATION SITE, and `piiPass` is written HERE by the branch that
         decides (REDACTION-CLAIM-SPEC.md §3.6a). "This code path did not run
         the pass" is a fact about FullShot's own execution, which is exactly
         the kind of fact the whole record is built on — and it is why a region
         capture says "redaction runs on full-page captures" instead of the
         permanent "treat the image as unredacted" that turns a warning into
         wallpaper. It must be an explicit false; an ABSENT piiPass is `unknown`,
         because "we do not know whether the pass ran" is precisely unknown.

         null means the pass never ran, and nothing downstream may read it as
         anything else. A pass that ran reports its own arithmetic even when it
         found nothing — that is the difference the record is built on. */
      const piiPass = !!settings.redactPII;
      const piiScan = piiPass
        ? collectPIIBoxes(root, rootRect, totalH, totalW, sideJobs, inlineJobs) : null;
      const piiBoxes = piiScan ? piiScan.boxes : null;

      // Build scroll positions: rows top→bottom, columns left→right.
      const ys = [];
      for (let y = 0; y + vh < totalH; y += vh) ys.push(y);
      ys.push(Math.max(0, totalH - vh));
      const xs = [];
      for (let x = 0; x + vw < totalW; x += vw) xs.push(x);
      xs.push(Math.max(0, totalW - vw));

      const positions = [];
      for (const y of ys) for (const x of xs) positions.push({ x, y });
      const total = positions.length + sideFrameCount + inlineFrameCount;

      const baseDelay = 150 + (settings.captureDelay || 0);

      // v1.6.4 — adaptive image settle: collect in-page images so each frame can
      // decode any that aren't ready yet before it's grabbed (kills late-paint /
      // lazy-image black tiles). Collected once; per-frame it only touches images
      // still not complete, bounded by count + a short time race.
      let captureImgs = null;
      if (settings.adaptiveWait) {
        captureImgs = [];
        forEachDeep(document.body || document, el => {
          if (el.tagName === 'IMG') captureImgs.push(el);
        });
        if (!captureImgs.length) captureImgs = null;
      }

      for (let i = 0; i < positions.length; i++) {
        if (aborted) throw new Error('Capture aborted');
        const p = positions[i];
        setScroll(root, p.x, p.y);
        await nextFrame();
        await sleep(baseDelay);
        if (captureImgs) await settleImages(captureImgs, 250, 40);

        // First frame: pin inner scrollers (nav drawers etc.) back to the
        // exact state the user saw before capture started — except panels we
        // deliberately expanded, which now show everything from the top.
        if (i === 0 && innerScrolls.length) {
          assertInnerScrolls(innerScrolls.filter(s => !expandedSet.has(s.el)));
          await nextFrame();
        }

        // After the first frame, freeze fixed/sticky headers & footers.
        if (i === 1 && settings.hideFixed && total > 1) {
          hiddenEls = hideFixedElements(expandedSet);
          await nextFrame();
        }

        const actual = getScroll(root);
        const resp = await chrome.runtime.sendMessage({
          type: 'FS_FRAME',
          index: i,
          total,
          x: actual.x,
          y: actual.y
        });
        if (!resp || !resp.ok) {
          throw new Error((resp && resp.error) || 'Frame capture failed');
        }
      }

      // v1.4.0 side-pane pass: scroll each qualifying rail through its own
      // content while the shell stands still; frames are tagged with the
      // pane index so the stitcher can unroll each rail into its column.
      if (sideJobs.length) {
        // Overlays are normally frozen at main-grid frame 1; a single-frame
        // main grid never got there — freeze them now so rail frames are
        // clean of fixed/sticky furniture.
        if (settings.hideFixed && !hiddenEls.length && total > 1) {
          hiddenEls = hideFixedElements(expandedSet);
          await nextFrame();
        }
        let frameIdx = positions.length;
        for (let j = 0; j < sideJobs.length; j++) {
          const job = sideJobs[j];
          // Fixed rails were frozen (hidden) after frame 1 — bring THIS rail
          // back for its own pass, keep every other overlay frozen (v1.5.0).
          const unhidden = [];
          if (job.fixedChain && hiddenEls.length) {
            for (const h of hiddenEls) {
              if (h.el === job.el || hasAncestorIn(job.el, new Set([h.el]))) {
                unhidden.push(h.el);
                h.el.style.setProperty('visibility', 'visible', 'important');
                h.el.style.setProperty('opacity', '1', 'important');
              }
            }
            if (unhidden.length) await nextFrame();
          }
          for (let k = 0; k < job.ys.length; k++) {
            if (aborted) throw new Error('Capture aborted');
            try { job.el.scrollTop = job.ys[k]; } catch (_) {}
            await nextFrame();
            await sleep(baseDelay);
            if (captureImgs) await settleImages(captureImgs, 250, 40);   // v1.6.7: rails too
            const actual = job.el.scrollTop;
            const resp = await chrome.runtime.sendMessage({
              type: 'FS_FRAME', index: frameIdx, total, x: 0, y: actual, pane: j
            });
            frameIdx++;
            if (!resp || !resp.ok) {
              throw new Error((resp && resp.error) || 'Frame capture failed');
            }
            // v1.5.1: viewport-anchored furniture inside the revealed wrapper
            // (collapse toggles, edge buttons) doesn't scroll with the rail's
            // content, so it would repeat once per unrolled band. Freeze it
            // after the rail's FIRST frame — it appears exactly once, like
            // all fixed furniture. Entries join hiddenEls so the finally-
            // restore stays byte-identical even on abort.
            if (k === 0 && unhidden.length && job.ys.length > 1) {
              const jobChain = new Set([job.el]);
              for (let n = composedParent(job.el); n; n = composedParent(n)) {
                jobChain.add(n);
              }
              const inJob = new Set([job.el]);
              let froze = 0;
              for (const w of unhidden) {
                forEachDeep(w, el => {
                  if (el === w || jobChain.has(el)) return;   // path to scroller
                  if (hasAncestorIn(el, inJob)) return;       // scrolls with rail
                  if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
                  hiddenEls.push({ el, css: el.getAttribute('style') });
                  el.style.setProperty('visibility', 'hidden', 'important');
                  el.style.setProperty('opacity', '0', 'important');
                  froze++;
                });
              }
              if (froze) await nextFrame();
            }
          }
          try { job.el.scrollTop = job.top; } catch (_) {}
          for (const el of unhidden) {
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('opacity', '0', 'important');
          }
        }
      }

      // v1.6.1 inline unroll pass: step each embedded virtualized list through
      // its full content; frames tagged inline:<j> for mid-page slot injection.
      const inlinePanes = [];
      if (inlineJobs.length) {
        // A single-frame main grid never froze overlays — do it now so inline
        // frames are clean of fixed/sticky furniture.
        if (settings.hideFixed && !hiddenEls.length && total > 1) {
          hiddenEls = hideFixedElements(expandedSet);
          await nextFrame();
        }
        let inlineIdx = positions.length + sideFrameCount;
        for (let j = 0; j < inlineJobs.length; j++) {
          const job = inlineJobs[j];
          // Bring the list fully into view (its top to the viewport top, clamped
          // to the page's scroll range), then step its scrollTop window by window.
          setScroll(root, 0, job.winY);
          await nextFrame();
          let r;
          try { r = job.el.getBoundingClientRect(); } catch (_) { r = { left: 0, top: job.docY - job.winY }; }
          const rx = Math.max(0, r.left + (job.el.clientLeft || 0));
          const ry = Math.max(0, r.top + (job.el.clientTop || 0));
          const rw = Math.max(1, Math.min(job.el.clientWidth, winW - rx));
          // v1.9.10: for a pane root, clamp the captured window to the pane's
          // visible bottom so shell chrome below the pane can't bleed into the band.
          const visBottom = root.isDoc ? winH : Math.min(winH, rootRect.y + rootRect.h);
          const visH = Math.max(1, Math.min(job.visH, visBottom - ry));
          for (let k = 0; k < job.ys.length; k++) {
            if (aborted) throw new Error('Capture aborted');
            try { job.el.scrollTop = job.ys[k]; } catch (_) {}
            await nextFrame();
            await sleep(baseDelay);   // adaptive wait: let the render window realize its rows
            if (captureImgs) await settleImages(captureImgs, 250, 40);   // v1.6.7: virtual lists too
            const actual = job.el.scrollTop;
            const resp = await chrome.runtime.sendMessage({
              type: 'FS_FRAME', index: inlineIdx, total, x: 0, y: actual, inline: j
            });
            inlineIdx++;
            if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Frame capture failed');
          }
          try { job.el.scrollTop = job.top0; } catch (_) {}
          inlinePanes.push({ x: rx, y: ry, w: rw, h: visH,
                             docY: job.docY, clientH: job.clientH, fullH: job.fullH });
        }
      }

      /* THE SECOND MEASUREMENT, and its position in this function is the whole
         of it (REDACTION-CLAIM-SPEC.md §2.3, §7.5.2). It must run after the
         last frame — so lazy-load, reflow and deferred rendering have all
         happened — and BEFORE the FS_DONE post below, which means before the
         `finally` that restores every scroll position, every style and every
         hidden overlay. Move it one line later and it measures a DOM that has
         been put back, reports ~100% movement on every capture, and the feature
         reads as permanently broken. Wrapped because a re-measure that throws
         must not lose the capture: the ledger then carries zero remeasured
         spans, which is visible and is not a claim. */
      /* …and the throw is RECORDED rather than merely survived. Nothing
         downstream reads the second measurement — §2.2 deleted `moved` from the
         evidence and nothing consumes a grade any more — so this reaches no
         counter in `acts` and is not allowed to: it is a fact about a pass
         whose findings are not in the claim. It is in the ledger because a
         swallowed exception that leaves no trace at all is how the last four
         rounds of this feature began. */
      if (piiScan) {
        try { piiScan.remeasure(); }
        catch (_) { try { piiScan.scan.remeasureThrew = true; } catch (_e) {} }
      }

      const dpr = window.devicePixelRatio || 1;
      await chrome.runtime.sendMessage({
        type: 'FS_DONE',
        meta: { totalW, totalH, vw, vh, dpr, winW, winH, rootRect, virtualScrollers: fsVirtualCount,
                sidePanes: sideJobs.length ? sideJobs.map(j => j.rect) : null,
                inlinePanes: inlinePanes.length ? inlinePanes : null,
                breakHints: breakHints.length ? breakHints : null,
                piiBoxes: piiBoxes && piiBoxes.length ? piiBoxes : null,
                /* The boxes are dropped when empty because an empty list is
                   nothing; the LEDGER is sent whenever the pass ran, precisely
                   because it is the thing an empty list cannot say. Its absence
                   is a fact too: no pass, or an engine older than this one, and
                   both of those are `unknown` rather than anything better.
                   Sent whole — every counter travels, because a counter nobody
                   can see is a counter nobody can check, and the last attempt
                   failed by computing one and dropping it on the floor. */
                piiPass,
                piiScan: piiScan ? piiScan.scan : null }
      });
    } finally {
      restoreFixedElements(hiddenEls);
      if (frameReportHandler) window.removeEventListener('message', frameReportHandler);
      restoreExpanded(expanded);
      restoreInteractive(interactiveRestores);
      restoreOverlays(overlayRestores);
      if (settings.expandFrames) {
        chrome.runtime.sendMessage({ type: 'FS_RESTORE_FRAMES' }).catch(() => {});
      }
      if (!root.isDoc) {
        root.el.removeAttribute('data-fullshot-root');
        try {
          if (rootCss == null) root.el.removeAttribute('style');
          else root.el.setAttribute('style', rootCss);
        } catch (_) {}
      }
      setScroll(root, original.x, original.y);
      if (!root.isDoc) window.scrollTo(originalWin.x, originalWin.y);
      assertInnerScrolls(innerScrolls);
      removeCaptureCss(css);
    }
  }
})();
/* build 1.9.10 */
