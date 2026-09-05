/* FullShot editor — crop, draw, annotate, blur, emoji, undo/redo, export.
   All object coordinates live in ORIGINAL image space; the current crop is
   applied at render time, so undoing a crop is lossless. */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const shotId = params.get('shot');
  const segIndex = Number(params.get('seg') || 0);

  const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#111111', '#ffffff'];
  const EMOJIS = ['😀', '😂', '😍', '🤔', '😎', '😱', '🥳', '😭', '👍', '👎', '👏', '🙏',
                  '💪', '👀', '🔥', '⭐', '❤️', '✅', '❌', '⚠️', '❗', '❓', '💡', '🎯'];

  let shot = null, base = null;              // shot record, base ImageBitmap
  let crop = null;                           // {x,y,w,h} in original coords
  let objects = [];                          // committed annotation objects
  let draft = null;                          // object being drawn
  let selected = -1;                         // index into objects (select tool)
  let tool = 'pen';
  let color = COLORS[0];
  let stroke = 4;
  let fontSize = 28;
  let emojiChar = '😀';
  let zoom = 'fit';                          // 'fit' or a number (1 = 100%)
  let settings = null;
  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  let undoStack = [], redoStack = [];
  let cropDraft = null;                      // pending crop rect (original coords)
  let dragging = null;                       // pointer-drag state

  /* ---- the keyboard's side of the canvas ----------------------------------
     This surface answered only to a pointer, which made the editor unusable
     without one. A keyboard gets its own insertion point — kbCursor, in the
     same ORIGINAL-IMAGE coordinates every object uses — plus the two steps a
     drawing tool is expected to offer.

     NUDGE_FINE / NUDGE_COARSE, and Shift as the modifier between them, is the
     convention every design tool already teaches: 1px normally, 10px with
     Shift. The step is a SIGNED number of image pixels and nothing else. It is
     never derived from the writing direction, and this file asks no question of
     the document's direction anywhere: ArrowRight is +x in Arabic exactly as it
     is in English, because the crop it produces has to be the same rectangle
     either way — it is the same saved shot. (pages/editor.html pins the surface
     itself; test/editor-sim.node.js measures both halves.) */
  const NUDGE_FINE = 1, NUDGE_COARSE = 10;
  const PLACE_HALF = 30;                     // half-length of a keyboard-placed stroke
  const PLACE_W = 80, PLACE_H = 50;          // default box for a keyboard-placed shape
  let kbCursor = null;                       // {x,y} insertion point, image coords
  let kbCursorShown = false;                 // painted only after a key moved it
  let kbFocus = false;                       // the canvas holds focus
  let nudgeOpen = false;                     // an arrow run still coalescing into one undo step
  let menuReturn = null;                     // control to hand focus back to when a menu closes

  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  /* ================= strings =================
     pages/editor.html loads pages/common.js BEFORE this file, so the whole
     toolbar, both menus and the shortcut sheet are already translated by the
     [data-i18n] pass before boot() runs — nothing below has to touch them.
     What is below is the text this file BUILDS at runtime: two zoom tooltips,
     five toasts and the not-found panel. Each is resolved from its key with the
     English passed alongside as the fallback, exactly as popup/popup.js does
     it, and nothing is concatenated: "Copy failed — $REASON$" is one message
     because several of the 55 put the reason before the verb.

     The guard is load-bearing. test/editor-sim.node.js boots this file alone
     against a fake window that provides the fs* helpers the editor uses and
     nothing else, so pages/common.js is not there; a bare fsMessage() call
     would be a ReferenceError that takes that tier down instead of degrading to
     English. `typeof` on an undeclared name is the one form that cannot throw.
     Same reason, and same shape, as the copy popup.js keeps. */

  /* Fills $TOKEN$ in the English fallback in order of first appearance, which
     is the order the message file declares them ($1, $2, $3). Chrome does this
     itself whenever the key resolved; this is only the path where it did not. */
  function subst(text, subs) {
    if (!subs || !subs.length) return String(text);
    const seen = new Map();
    return String(text).replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name) => {
      const n = name.toLowerCase();
      if (!seen.has(n)) seen.set(n, seen.size);
      const v = subs[seen.get(n)];
      return v == null ? whole : String(v);
    });
  }

  function msg(key, subs, english) {
    return typeof fsMessage === 'function'
      ? fsMessage(key, subs, english)
      : subst(english, subs);
  }

  /* ================= what the editor says out loud =================
     A canvas is one opaque bitmap to the accessibility tree: which tool is
     live, what was just placed, where a selection moved to and what the pending
     crop measures have nowhere else to go. #a11yStatus is the only channel, and
     everything written to it is a whole placeholdered SENTENCE resolved through
     msg() — never "Rectangle" + " selected", which fixes English word order
     into the product for the same reason the toast strings avoid it.

     The NOUN inside those sentences is not written here at all. It is read back
     off the toolbar button that makes that kind of object, which pages/
     common.js has already translated by the time boot() runs: one string, one
     key, spent three times (tooltip, accessible name, announcement) and
     impossible to let drift. objects[].type IS the tool name, which is what
     makes the lookup a direct one — and those names are internal enum values
     that must never be translated, so the enum is used as a KEY into the
     markup, never shown.

     THE SENTENCE FRAMES BELOW HAVE NO KEY IN _locales YET. Each is spelled
     msg(key, subs, english) exactly like every other runtime string on this
     page, so it renders the English fallback until the key lands and translates
     itself the moment it does — no code change. This pass does not edit the
     message files; the list is in the handoff. */
  const toolBtns = {};

  function toolLabel(type) {
    const b = toolBtns[type];
    if (!b) return String(type);
    const named = typeof b.getAttribute === 'function' ? b.getAttribute('aria-label') : null;
    return named || b.title || String(type);
  }

  function announce(text) {
    const n = $('a11yStatus');
    if (n && text) n.textContent = text;
  }

  /* ================= boot ================= */

  document.addEventListener('DOMContentLoaded', async () => {
    $('themeBtn').addEventListener('click', fsToggleTheme);
    settings = await fsGetSettings();
    buildColorBar();
    buildEmojiPop();
    bindToolbar();
    bindCanvas();
    bindKeys();

    shot = shotId ? await FSDB.get('shots', shotId) : null;
    if (!shot || !shot.segments[segIndex]) {
      /* A fixed literal, with no interpolated value anywhere in it — the two
         sentences are then written back through textContent, which is where a
         message file's text is allowed to land. The English stays in the markup
         as the fallback, same rule as every data-i18n element on this page. */
      const box = $('loading');
      box.innerHTML = '<div style="text-align:center"><h2>Screenshot not found</h2>' +
        '<a class="btn primary" href="history.html">Open history</a></div>';
      const heading = box.querySelector('h2'), link = box.querySelector('a');
      if (heading) heading.textContent = msg('editorNotFound', null, 'Screenshot not found');
      if (link) link.textContent = msg('resultOpenHistory', null, 'Open history');
      return;
    }
    $('backBtn').href = 'result.html?shot=' + encodeURIComponent(shot.id);

    base = await createImageBitmap(shot.segments[segIndex].blob);
    crop = { x: 0, y: 0, w: base.width, h: base.height };
    pushState();

    $('loading').hidden = true;
    $('stage').hidden = false;
    layout();
    render();
  });

  /* ================= toolbar ================= */

  /* The eight swatches are one control, not eight: a radiogroup with a roving
     tabindex, which is what an exclusive choice is in ARIA and what keeps the
     palette from putting eight tab stops between the tools and the export
     button. The swatch's accessible name is its own hex — a colour literal, the
     same class of thing as a keyboard chord, and never translated. */
  function buildColorBar() {
    const bar = $('colors');
    const swatches = [];

    function pick(b, focusIt) {
      color = b.dataset.color;
      swatches.forEach(x => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-checked', on ? 'true' : 'false');
        x.tabIndex = on ? 0 : -1;
      });
      if (focusIt) b.focus();
    }

    COLORS.forEach(c => {
      const b = document.createElement('button');
      b.className = 'swatch' + (c === color ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.dataset.color = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', c === color ? 'true' : 'false');
      b.setAttribute('aria-label', c);
      b.tabIndex = c === color ? 0 : -1;
      b.addEventListener('click', () => pick(b, false));
      swatches.push(b);
      bar.appendChild(b);
    });

    /* Arrows/Home/End inside the group. The keys are consumed here so they can
       never reach the canvas handler and nudge an annotation the user cannot
       see from the toolbar. Left/Right walk the LIST, not the screen — a list
       has a first and a last whichever way it is painted. */
    bar.addEventListener('keydown', (e) => {
      const i = swatches.indexOf(e.target);
      if (i < 0) return;
      const k = String(e.key || '');
      let next = -1;
      if (k === 'ArrowRight' || k === 'ArrowDown') next = (i + 1) % swatches.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') next = (i - 1 + swatches.length) % swatches.length;
      else if (k === 'Home') next = 0;
      else if (k === 'End') next = swatches.length - 1;
      if (next < 0) return;
      e.preventDefault();
      e.stopPropagation();
      pick(swatches[next], true);
    });

    $('customColor').addEventListener('input', e => {
      color = e.target.value;
      swatches.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
    });
  }

  function buildEmojiPop() {
    const pop = $('emojiPop');
    EMOJIS.forEach(ch => {
      const b = document.createElement('button');
      b.textContent = ch;
      b.addEventListener('click', () => {
        emojiChar = ch;
        $('emojiToolBtn').textContent = ch;
        closeEmojiPop(false);
        setTool('emoji');
      });
      pop.appendChild(b);
    });
  }

  function openEmojiPop() {
    const pop = $('emojiPop');
    pop.classList.add('show');
    pop.style.left = '10px'; pop.style.top = '10px';
    $('emojiToolBtn').setAttribute('aria-expanded', 'true');
    if (pop.children[0]) pop.children[0].focus();
  }

  function closeEmojiPop(restoreFocus) {
    const pop = $('emojiPop');
    if (!pop.classList.contains('show')) return;
    pop.classList.remove('show');
    $('emojiToolBtn').setAttribute('aria-expanded', 'false');
    if (restoreFocus) $('emojiToolBtn').focus();
  }

  /* The visible state (.active) and the announced one (aria-pressed) are set
     from the same line, so they cannot disagree — a chip that looks selected
     and reads "not pressed" is the bug this shape exists to prevent. */
  function syncToolPressed() {
    document.querySelectorAll('.tool[data-tool]').forEach(b => {
      const on = b.dataset.tool === tool;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setTool(t, silent) {
    tool = t;
    selected = -1;
    nudgeOpen = false;
    syncToolPressed();
    canvas.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    if (t !== 'crop') { cropDraft = null; $('cropBar').classList.remove('show'); }
    /* Picking a tool with a letter key leaves focus wherever it was, so the
       pressed-state change is never spoken on its own. This is the only thing
       that tells a screen-reader user the letter did anything. */
    if (!silent) announce(msg('editorA11yToolSelected', [toolLabel(t)], '$TOOL$ selected'));
    render();
  }

  /* ---- the two drop-down sheets ------------------------------------------
     Both were mouse-only: a div of buttons that opened on click, said nothing
     when it did, and left focus behind on the trigger. openMenu() makes them a
     real menu — the state is mirrored onto aria-expanded, focus goes INTO the
     first item, and closing hands focus back to the control that opened it, so
     a keyboard user is never dropped at the top of the page. */
  function menuEls() { return [['exportBtn', 'exportMenu'], ['moreBtn', 'moreMenu']]; }

  function openMenuEl() {
    for (const [, id] of menuEls()) {
      const m = $(id);
      if (m && m.classList.contains('show')) return m;
    }
    return null;
  }

  function closeMenus(restoreFocus) {
    let had = false;
    for (const [btn, id] of menuEls()) {
      const m = $(id);
      if (m && m.classList.contains('show')) { m.classList.remove('show'); had = true; }
      if ($(btn)) $(btn).setAttribute('aria-expanded', 'false');
    }
    if (had && restoreFocus && menuReturn) menuReturn.focus();
    menuReturn = null;
  }

  function openMenu(btnId, menuId) {
    closeMenus(false);
    const m = $(menuId);
    m.classList.add('show');
    $(btnId).setAttribute('aria-expanded', 'true');
    menuReturn = $(btnId);
    if (m.children[0]) m.children[0].focus();
  }

  function toggleMenu(btnId, menuId) {
    if ($(menuId).classList.contains('show')) closeMenus(true);
    else openMenu(btnId, menuId);
  }

  function bindToolbar() {
    document.querySelectorAll('.tool[data-tool]').forEach(b => {
      toolBtns[b.dataset.tool] = b;
      b.addEventListener('click', (e) => {
        if (b.dataset.tool === 'emoji') {
          const pop = $('emojiPop');
          if (tool === 'emoji' && !pop.classList.contains('show')) {
            openEmojiPop();
            e.stopPropagation();
            return;
          }
        }
        setTool(b.dataset.tool);
      });
    });
    syncToolPressed();
    canvas.setAttribute('aria-label', msg('editorCanvasLabel', null, 'Annotation canvas'));
    addKeyboardShortcutRows();
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#emojiPop') && !e.target.closest('#emojiToolBtn')) {
        closeEmojiPop(false);
      }
    });

    $('strokeSel').addEventListener('change', e => { stroke = Number(e.target.value); });
    $('sizeSel').addEventListener('change', e => { fontSize = Number(e.target.value); });
    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('zoomBtn').addEventListener('click', () => { zoom = zoom === 'fit' ? 1 : 'fit'; layout(); });
    $('zoomInBtn').addEventListener('click', () => zoomStep(1));
    $('zoomOutBtn').addEventListener('click', () => zoomStep(-1));

    $('cropApply').addEventListener('click', applyCrop);
    $('cropCancel').addEventListener('click', cancelCrop);

    $('copyBtn').addEventListener('click', copyImage);
    $('pngBtn').addEventListener('click', () => downloadAs('png'));
    $('jpgBtn').addEventListener('click', () => downloadAs('jpeg'));
    $('webpBtn').addEventListener('click', () => downloadAs('webp'));
    $('pdfBtn').addEventListener('click', downloadPdf);
    $('saveBtn').addEventListener('click', save);

    // "Export" menu
    $('exportBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu('exportBtn', 'exportMenu');
    });
    $('exportMenu').addEventListener('click', () => closeMenus(true));

    // "More" menu
    $('moreBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu('moreBtn', 'moreMenu');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#moreMenu') && !e.target.closest('#exportMenu')) closeMenus(false);
    });
    /* The More sheet used to stay open behind whatever its item did — the
       document-level closer skips clicks inside the sheet, and nothing else
       closed it. Same one-line contract as the Export sheet. */
    $('moreMenu').addEventListener('click', () => closeMenus(true));
    $('mFiles').addEventListener('click', () => { location.href = 'history.html'; });
    $('mOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('mShortcuts').addEventListener('click', openShortcuts);
    $('shortcutsClose').addEventListener('click', () => closeShortcuts());
    $('shortcutsPop').addEventListener('click', (e) => {
      if (e.target === $('shortcutsPop')) closeShortcuts();
    });
  }

  /* ---- the shortcut sheet is a modal, and now behaves like one -------------
     It opened with focus still behind it on the "More" button, so a keyboard
     user could Tab straight through the dimmed page underneath and never find
     the Close control. Focus goes in, Tab is held inside (there is exactly one
     control, so "held inside" is one line), Escape closes, and focus lands back
     where it started. */
  let shortcutsReturn = null;

  function openShortcuts() {
    shortcutsReturn = menuReturn || $('moreBtn');
    closeMenus(false);
    $('shortcutsPop').classList.add('show');
    $('shortcutsClose').focus();
  }

  function closeShortcuts() {
    if (!$('shortcutsPop').classList.contains('show')) return;
    $('shortcutsPop').classList.remove('show');
    if (shortcutsReturn) shortcutsReturn.focus();
    shortcutsReturn = null;
  }

  /* The three keyboard behaviours this pass added, written into the sheet that
     documents them — a shortcut nobody can discover is a shortcut nobody has.
     Built here rather than in pages/editor.html because their descriptions have
     no key in _locales/en/messages.json yet and a data-i18n naming a key that
     does not exist renders English in all 55 without saying so. The <kbd> cells
     are keyboard literals and are not translated in either place. */
  function addKeyboardShortcutRows() {
    const table = $('shortcutsTable');
    if (!table) return;
    const ROWS = [
      ['Enter', 'editorShortcutPlace', 'Place the selected tool at the keyboard cursor'],
      ['↑ ↓ ← →', 'editorShortcutNudge', 'Move the cursor, or nudge the selection (Shift = 10 px)'],
      ['Ctrl+↑ ↓ ← →', 'editorShortcutCropResize', 'Resize the pending crop']
    ];
    for (const [chord, key, english] of ROWS) {
      const tr = document.createElement('tr');
      const keys = document.createElement('td');
      const kbd = document.createElement('kbd');
      kbd.textContent = chord;
      keys.appendChild(kbd);
      const desc = document.createElement('td');
      desc.textContent = msg(key, null, english);
      tr.appendChild(keys);
      tr.appendChild(desc);
      table.appendChild(tr);
    }
  }

  function currentScale() {
    if (zoom !== 'fit') return zoom;
    const stage = $('stage');
    return Math.min(1, (stage.clientWidth - 60) / crop.w, (stage.clientHeight - 60) / crop.h);
  }

  function zoomStep(dir) {
    const cur = currentScale();
    let next;
    if (dir > 0) next = ZOOMS.find(z => z > cur + 0.01) || ZOOMS[ZOOMS.length - 1];
    else next = [...ZOOMS].reverse().find(z => z < cur - 0.01) || ZOOMS[0];
    zoom = next;
    layout();
  }

  /* ================= keyboard =================
     Read top to bottom: the innermost surface that owns a key gets it first,
     and each branch returns rather than falling through, so a chord can never
     be handled twice. The order is modal sheet -> open menu -> chords ->
     canvas -> global.

     ARROW DIRECTIONS ARE SIGNS, NOT EDGES. The table below is the only place
     the four arrows are turned into numbers, and it is a constant: nothing here
     consults the document's writing direction, and nothing should. See the note
     on kbCursor above. */
  const ARROWS = {
    arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1]
  };
  const TOOL_KEYS = {
    v: 'select', c: 'crop', p: 'pen', h: 'hl', l: 'line', a: 'arrow',
    r: 'rect', o: 'ellipse', t: 'text', b: 'blur', n: 'num', e: 'emoji'
  };

  function isTypingTarget(t) {
    const tag = String((t && t.tagName) || '').toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea';
  }

  /* Up/Down/Home/End inside an open sheet, Escape out of it. Tab closes rather
     than walking off into the page behind — the sheet is transient chrome, and
     leaving it open while focus is elsewhere is how a menu becomes a ghost. */
  function menuKey(menu, e, k) {
    const items = Array.prototype.slice.call(menu.children);
    if (!items.length) return false;
    const i = items.indexOf(e.target);
    let next = -1;
    if (k === 'arrowdown') next = i < 0 ? 0 : (i + 1) % items.length;
    else if (k === 'arrowup') next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
    else if (k === 'home') next = 0;
    else if (k === 'end') next = items.length - 1;
    else if (k === 'escape') { e.preventDefault(); closeMenus(true); return true; }
    else if (k === 'tab') { closeMenus(false); return false; }
    else return false;
    e.preventDefault();
    items[next].focus();
    return true;
  }

  /* Everything the drawing surface itself answers to. Only ever reached while
     the canvas holds focus, so arrow keys still scroll the page and still walk
     a <select> everywhere else on the toolbar. */
  function canvasKey(e, k) {
    const step = e.shiftKey ? NUDGE_COARSE : NUDGE_FINE;
    const arrow = ARROWS[k];

    if (arrow) {
      const dx = arrow[0] * step, dy = arrow[1] * step;
      if (selected >= 0 && objects[selected]) { e.preventDefault(); nudgeSelection(dx, dy); return true; }
      if (tool === 'crop' && cropDraft) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) resizeCropDraft(dx, dy); else moveCropDraft(dx, dy);
        return true;
      }
      if (e.ctrlKey || e.metaKey) return false;   // nothing to resize; leave the chord alone
      e.preventDefault();
      moveCursor(dx, dy);
      return true;
    }

    if (k === 'enter' || k === ' ' || k === 'spacebar') {
      e.preventDefault();
      if (tool === 'crop') { cropDraft ? applyCrop() : startCropDraft(); return true; }
      placeAtCursor();
      return true;
    }
    return false;
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target === $('textInput')) return;
      const k = String(e.key || '').toLowerCase();

      // 1 · the modal owns every key while it is up, Tab included
      if ($('shortcutsPop').classList.contains('show')) {
        if (k === 'escape' || k === 'tab') { e.preventDefault(); }
        if (k === 'escape') closeShortcuts();
        else if (k === 'tab') $('shortcutsClose').focus();
        return;
      }

      // 2 · an open sheet owns the arrows
      const menu = openMenuEl();
      if (menu && menuKey(menu, e, k)) return;

      // 3 · chords
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); return; }

      // 4 · the drawing surface, while it holds focus
      if (kbFocus && canvasKey(e, k)) return;

      if (k === 'delete' || k === 'backspace') {
        /* Was gated on the select tool, which meant an object placed from the
           keyboard — selected, visibly boxed, nudgeable — could not be deleted
           without first pressing V. The selection is the thing being deleted;
           which tool drew it is not the question. */
        if (selected >= 0 && objects[selected]) {
          const label = toolLabel(objects[selected].type);
          objects.splice(selected, 1); selected = -1; nudgeOpen = false;
          pushState(); render();
          announce(msg('editorA11yObjectDeleted', [label], '$OBJECT$ deleted'));
        }
        return;
      }
      if (k === 'escape') {
        const had = selected >= 0;
        selected = -1; cropDraft = null; nudgeOpen = false;
        kbCursorShown = false;
        $('cropBar').classList.remove('show');
        closeShortcuts();
        /* Escape is a keyboard gesture, so the emoji sheet hands focus BACK to
           the button that opened it rather than dropping it at the top of the
           page; the pointer paths that also close it pass false. The two
           drop-down menus never reach this line — while one of them is open,
           step 2 above has already given Escape to menuKey, which closes with
           the same hand-back — so this call is only ever the tidy-up. */
        closeEmojiPop(true);
        closeMenus(false);
        render();
        if (had) announce(msg('editorA11ySelectionCleared', null, 'Selection cleared'));
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        if (k === '+' || k === '=') { zoomStep(1); return; }
        if (k === '-') { zoomStep(-1); return; }
        if (k === '?') { openShortcuts(); return; }
        if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
      }
    });
  }

  /* ================= geometry ================= */

  function layout() {
    canvas.width = crop.w;
    canvas.height = crop.h;
    const s = currentScale();
    canvas.style.width = Math.round(crop.w * s) + 'px';
    $('zoomBtn').textContent = Math.round(s * 100) + '%';
    $('zoomBtn').title = zoom === 'fit'
      ? msg('editorZoomTipToHundred', null, 'Fit to window — click for 100%')
      : msg('editorZoomTipToFit', null, 'Click to fit window');
    canvas.style.height = 'auto';
    render();
  }
  window.addEventListener('resize', () => { if (base) layout(); });

  // Pointer event -> original-image coordinates.
  function toImg(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width) + crop.x,
      y: (e.clientY - r.top) * (canvas.height / r.height) + crop.y
    };
  }

  /* ================= the keyboard's insertion point =================
     Everything below works in ORIGINAL-IMAGE coordinates, the same space
     objects and the crop live in, so a keyboard placement under a 50% view
     lands on the same pixel as the pointer would. Nothing here reads a display
     scale, and nothing reads a direction. */

  /* clampToImage() is the pointer path's own clamp, reused rather than copied:
     the keyboard and the pointer have to agree on where the surface ends, and
     two copies of that rule is one copy too many. */
  function ensureCursor() {
    if (!kbCursor) kbCursor = { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 };
    kbCursor = clampToImage(kbCursor);
    return kbCursor;
  }

  /* Coordinates are announced RELATIVE TO THE VISIBLE IMAGE, not to the
     original: after a crop the user is looking at a picture whose top-left is
     0,0, and "at 812, 430" inside a 400px-wide crop is a number that helps
     nobody. */
  function sayAt(key, english, p, extra) {
    const x = Math.round(p.x - crop.x), y = Math.round(p.y - crop.y);
    announce(msg(key, (extra || []).concat([x, y]), english));
  }

  function moveCursor(dx, dy) {
    ensureCursor();
    kbCursor = clampToImage({ x: kbCursor.x + dx, y: kbCursor.y + dy });
    kbCursorShown = true;
    render();
    sayAt('editorA11yCursor', 'Cursor at $X$, $Y$', kbCursor);
  }

  /* One arrow run is ONE undo step. Pushing a snapshot per keypress would spend
     the whole 60-deep stack on a single 40px move and throw away the history
     the user actually wants back; the first press of a run pushes, the rest
     rewrite that same top entry. Any other action calls pushState(), which
     closes the run. */
  function nudgePush() {
    if (nudgeOpen) { undoStack[undoStack.length - 1] = snapshot(); updateUndoButtons(); }
    else { pushState(); nudgeOpen = true; }
  }

  function nudgeSelection(dx, dy) {
    const o = objects[selected];
    if (!o) return;
    shiftObject(o, dx, dy);
    nudgePush();
    render();
    const b = bounds(o);
    sayAt('editorA11yObjectMoved', '$OBJECT$ moved to $X$, $Y$', { x: b.x, y: b.y }, [toolLabel(o.type)]);
  }

  /* Shared by the pointer and the keyboard, so both say the same sentence about
     the same state — "1 of 3" is the only thing on this page that tells anyone
     how many annotations there are. */
  function announceSelection() {
    if (selected >= 0 && objects[selected]) {
      announce(msg('editorA11yObjectSelected',
        [toolLabel(objects[selected].type), selected + 1, objects.length],
        '$OBJECT$ selected, $INDEX$ of $TOTAL$'));
    } else {
      announce(msg('editorA11ySelectionCleared', null, 'Selection cleared'));
    }
  }

  function selectIndex(i) {
    selected = i;
    nudgeOpen = false;
    kbCursorShown = false;
    render();
    announceSelection();
  }

  /* Enter on the surface. Every tool that a pointer DRAGS gets a default extent
     centred on the cursor; every tool that a pointer CLICKS gets a point. The
     text tool opens the same overlay the pointer opens, because a keyboard user
     needs the textarea, not a canned string. */
  function placeAtCursor() {
    const p = ensureCursor();
    if (tool === 'select') { selectIndex(hitTest(p)); return; }
    if (tool === 'text') { kbCursorShown = false; openTextInput(p); return; }

    let o = null;
    if (tool === 'pen' || tool === 'hl') {
      o = { type: tool, points: [{ x: p.x - PLACE_HALF, y: p.y }, { x: p.x + PLACE_HALF, y: p.y }],
            color, width: tool === 'hl' ? Math.max(14, stroke * 4) : stroke };
    } else if (tool === 'line' || tool === 'arrow') {
      o = { type: tool, x1: p.x - PLACE_HALF, y1: p.y, x2: p.x + PLACE_HALF, y2: p.y, color, width: stroke };
    } else if (tool === 'rect' || tool === 'ellipse' || tool === 'blur') {
      o = { type: tool, x: p.x - PLACE_W / 2, y: p.y - PLACE_H / 2, w: PLACE_W, h: PLACE_H, color, width: stroke };
    } else if (tool === 'emoji') {
      o = { type: 'emoji', x: p.x, y: p.y, char: emojiChar, size: fontSize * 1.6 };
    } else if (tool === 'num') {
      const n = objects.reduce((m, x) => x.type === 'num' ? Math.max(m, x.n) : m, 0) + 1;
      o = { type: 'num', x: p.x, y: p.y, n, color, size: fontSize };
    }
    if (!o) return;

    objects.push(o);
    selected = objects.length - 1;
    kbCursorShown = false;
    nudgeOpen = false;
    pushState();
    render();
    const b = bounds(o);
    sayAt('editorA11yObjectPlaced', '$OBJECT$ placed at $X$, $Y$', { x: b.x, y: b.y }, [toolLabel(o.type)]);
  }

  /* ---- crop, without a mouse ---------------------------------------------
     Enter with the crop tool and no pending rectangle proposes one — the middle
     60% of what is on screen — which gives the arrows something to push around.
     Enter again confirms it, Escape drops it. Ctrl+arrow resizes, so the two
     jobs a crop drag does with one gesture each have a chord. */
  function sayCrop(key, english) {
    const c = cropDraft || crop;
    announce(msg(key, [Math.round(c.w), Math.round(c.h), Math.round(c.x - crop.x), Math.round(c.y - crop.y)],
      english));
  }

  function startCropDraft() {
    cropDraft = {
      x: crop.x + crop.w * 0.2, y: crop.y + crop.h * 0.2,
      w: crop.w * 0.6, h: crop.h * 0.6
    };
    $('cropBar').classList.add('show');
    render();
    sayCrop('editorA11yCropArea', 'Crop area $WIDTH$ by $HEIGHT$ at $X$, $Y$');
  }

  function moveCropDraft(dx, dy) {
    const c = cropDraft;
    c.x = Math.min(Math.max(c.x + dx, crop.x), crop.x + crop.w - c.w);
    c.y = Math.min(Math.max(c.y + dy, crop.y), crop.y + crop.h - c.h);
    render();
    sayCrop('editorA11yCropArea', 'Crop area $WIDTH$ by $HEIGHT$ at $X$, $Y$');
  }

  function resizeCropDraft(dx, dy) {
    const c = cropDraft;
    c.w = Math.min(Math.max(c.w + dx, 10), crop.x + crop.w - c.x);
    c.h = Math.min(Math.max(c.h + dy, 10), crop.y + crop.h - c.y);
    render();
    sayCrop('editorA11yCropArea', 'Crop area $WIDTH$ by $HEIGHT$ at $X$, $Y$');
  }

  function cancelCrop() {
    cropDraft = null;
    $('cropBar').classList.remove('show');
    render();
    canvas.focus();
  }

  /* ================= rendering ================= */

  function render() {
    if (!base) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    ctx.save();
    ctx.translate(-crop.x, -crop.y);
    for (const o of objects) drawObject(o, ctx);
    if (draft) drawObject(draft, ctx);

    /* No longer gated on the select tool. An object placed with Enter is
       selected the moment it exists, whatever tool drew it, and the box is the
       ONLY thing on screen that says which object the arrow keys are about to
       move — hiding it until the user thinks to press V is hiding the answer to
       the question they are asking. */
    if (selected >= 0 && objects[selected]) {
      const b = bounds(objects[selected]);
      ctx.save();
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      ctx.restore();
    }

    /* THE KEYBOARD CURSOR. The screen-reader half of "what is selected" is the
       live region; this is the half for everyone who can see the screen but
       cannot use a mouse — without it, Enter places an annotation at a point
       the user has no way to know. Painted only after a key moved it (a pointer
       user never sees it) and only while the surface holds focus and nothing is
       selected, because a selection box already answers the same question.

       Two passes, white under accent: the crosshair sits on top of an arbitrary
       screenshot and a single-colour mark can always land on its own colour.
       The radius grows as the view shrinks so the mark stays about the same
       size on screen at any zoom. */
    if (kbFocus && kbCursorShown && kbCursor && selected < 0 && !cropDraft) {
      const r = Math.max(6, Math.round(10 / Math.min(2, Math.max(0.25, currentScale()))));
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      for (const pass of [['#ffffff', 4], ['#4f46e5', 1.5]]) {
        ctx.strokeStyle = pass[0];
        ctx.lineWidth = pass[1];
        ctx.beginPath();
        ctx.moveTo(kbCursor.x - r, kbCursor.y); ctx.lineTo(kbCursor.x + r, kbCursor.y);
        ctx.moveTo(kbCursor.x, kbCursor.y - r); ctx.lineTo(kbCursor.x, kbCursor.y + r);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(kbCursor.x, kbCursor.y, r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (cropDraft) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      const c = cropDraft;
      // Dim everything outside the pending crop.
      ctx.beginPath();
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawObject(o, ctx) {
    ctx.save();
    switch (o.type) {
      case 'pen':
      case 'hl': {
        ctx.strokeStyle = o.color;
        ctx.lineWidth = o.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (o.type === 'hl') { ctx.globalAlpha = 0.35; ctx.lineCap = 'butt'; }
        ctx.beginPath();
        o.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
        break;
      }
      case 'line':
      case 'arrow': {
        ctx.strokeStyle = o.color;
        ctx.fillStyle = o.color;
        ctx.lineWidth = o.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        ctx.stroke();
        if (o.type === 'arrow') {
          const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
          const len = Math.max(12, o.width * 4);
          ctx.beginPath();
          ctx.moveTo(o.x2, o.y2);
          ctx.lineTo(o.x2 - len * Math.cos(ang - 0.45), o.y2 - len * Math.sin(ang - 0.45));
          ctx.lineTo(o.x2 - len * Math.cos(ang + 0.45), o.y2 - len * Math.sin(ang + 0.45));
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'rect':
        ctx.strokeStyle = o.color;
        ctx.lineWidth = o.width;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        break;
      case 'ellipse':
        ctx.strokeStyle = o.color;
        ctx.lineWidth = o.width;
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'text': {
        ctx.fillStyle = o.color;
        ctx.font = '600 ' + o.size + 'px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        o.text.split('\n').forEach((line, i) =>
          ctx.fillText(line, o.x, o.y + i * o.size * 1.25));
        break;
      }
      case 'blur': {
        const px = Math.max(6, Math.round(Math.min(Math.abs(o.w), Math.abs(o.h)) / 10));
        const sw = Math.max(1, Math.round(o.w / px));
        const sh = Math.max(1, Math.round(o.h / px));
        const tmp = document.createElement('canvas');
        tmp.width = sw; tmp.height = sh;
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(base, o.x, o.y, o.w, o.h, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, sw, sh, o.x, o.y, o.w, o.h);
        ctx.imageSmoothingEnabled = true;
        break;
      }
      case 'emoji':
        ctx.font = o.size + 'px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(o.char, o.x, o.y);
        break;
      case 'num': {
        const r = o.size * 0.8;
        ctx.fillStyle = o.color;
        ctx.beginPath();
        ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.stroke();
        ctx.fillStyle = o.color === '#ffffff' ? '#111111' : '#ffffff';
        ctx.font = '700 ' + Math.round(r * (String(o.n).length > 1 ? 0.95 : 1.15)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(o.n), o.x, o.y + r * 0.05);
        break;
      }
    }
    ctx.restore();
  }

  function bounds(o) {
    switch (o.type) {
      case 'pen': case 'hl': {
        const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      }
      case 'line': case 'arrow': {
        const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2);
        return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
      }
      case 'rect': case 'ellipse': case 'blur':
        return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
      case 'text': {
        const lines = o.text.split('\n');
        const w = Math.max(...lines.map(l => l.length)) * o.size * 0.6;
        return { x: o.x, y: o.y, w, h: lines.length * o.size * 1.25 };
      }
      case 'emoji':
        return { x: o.x - o.size / 2, y: o.y - o.size / 2, w: o.size, h: o.size };
      case 'num': {
        const r = o.size * 0.8;
        return { x: o.x - r, y: o.y - r, w: r * 2, h: r * 2 };
      }
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  /* ================= pointer interactions ================= */

  function bindCanvas() {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    /* The arrow keys, Enter and Delete only mean anything while this surface
       holds focus — everywhere else on the page they still scroll, still walk a
       <select>, still do what the browser does. One boolean, kept by the DOM's
       own events rather than by asking for activeElement on every keystroke. */
    canvas.addEventListener('focus', () => { kbFocus = true; render(); });
    canvas.addEventListener('blur', () => { kbFocus = false; kbCursorShown = false; render(); });
  }

  function normRect(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const p = toImg(e);
    canvas.setPointerCapture(e.pointerId);
    /* A click is also how a keyboard user arrives: focus the surface so the
       keys work afterwards, and park the insertion point where they clicked so
       Enter continues from there. The crosshair stays HIDDEN — a pointer user
       did not ask for it and it would paint over the shot they are annotating.
       The first arrow press reveals it, already in the right place. */
    canvas.focus();
    kbCursor = clampToImage(p);
    kbCursorShown = false;
    nudgeOpen = false;

    if (tool === 'select') {
      selected = hitTest(p);
      dragging = selected >= 0 ? { kind: 'move', start: p, moved: false } : null;
      render();
      announceSelection();
      return;
    }
    if (tool === 'crop') {
      dragging = { kind: 'crop', start: p };
      cropDraft = { x: p.x, y: p.y, w: 0, h: 0 };
      $('cropBar').classList.remove('show');
      return;
    }
    if (tool === 'text') {
      openTextInput(p);
      return;
    }
    if (tool === 'emoji') {
      objects.push({ type: 'emoji', x: p.x, y: p.y, char: emojiChar, size: fontSize * 1.6 });
      pushState(); render();
      return;
    }
    if (tool === 'num') {
      const n = objects.reduce((m, o) => o.type === 'num' ? Math.max(m, o.n) : m, 0) + 1;
      objects.push({ type: 'num', x: p.x, y: p.y, n, color, size: fontSize });
      pushState(); render();
      return;
    }
    if (tool === 'pen' || tool === 'hl') {
      draft = { type: tool, points: [p], color, width: tool === 'hl' ? Math.max(14, stroke * 4) : stroke };
    } else if (tool === 'line' || tool === 'arrow') {
      draft = { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width: stroke };
    } else if (tool === 'rect' || tool === 'ellipse' || tool === 'blur') {
      draft = { type: tool, x: p.x, y: p.y, w: 0, h: 0, color, width: stroke, _start: p };
    }
    dragging = { kind: 'draw' };
    render();
  }

  function onMove(e) {
    if (!dragging) return;
    const p = toImg(e);

    if (dragging.kind === 'move' && selected >= 0) {
      const dx = p.x - dragging.start.x, dy = p.y - dragging.start.y;
      if (dx || dy) {
        shiftObject(objects[selected], dx, dy);
        dragging.start = p;
        dragging.moved = true;
        render();
      }
      return;
    }
    if (dragging.kind === 'crop') {
      cropDraft = normRect(dragging.start, clampToImage(p));
      render();
      return;
    }
    if (dragging.kind === 'draw' && draft) {
      if (draft.points) draft.points.push(p);
      else if (draft.type === 'line' || draft.type === 'arrow') { draft.x2 = p.x; draft.y2 = p.y; }
      else { const r = normRect(draft._start, p); Object.assign(draft, r); }
      render();
    }
  }

  function onUp() {
    if (!dragging) return;
    const d = dragging;
    dragging = null;

    if (d.kind === 'move') {
      if (d.moved) pushState();
      return;
    }
    if (d.kind === 'crop') {
      if (cropDraft && cropDraft.w > 8 && cropDraft.h > 8) {
        $('cropBar').classList.add('show');
      } else {
        cropDraft = null; render();
      }
      return;
    }
    if (d.kind === 'draw' && draft) {
      const b = bounds(draft);
      const tiny = b.w < 3 && b.h < 3;
      if (!tiny) {
        delete draft._start;
        objects.push(draft);
        pushState();
      }
      draft = null;
      render();
    }
  }

  function clampToImage(p) {
    return {
      x: Math.min(Math.max(p.x, crop.x), crop.x + crop.w),
      y: Math.min(Math.max(p.y, crop.y), crop.y + crop.h)
    };
  }

  function hitTest(p) {
    for (let i = objects.length - 1; i >= 0; i--) {
      const b = bounds(objects[i]);
      if (p.x >= b.x - 8 && p.x <= b.x + b.w + 8 && p.y >= b.y - 8 && p.y <= b.y + b.h + 8) return i;
    }
    return -1;
  }

  function shiftObject(o, dx, dy) {
    if (o.points) o.points.forEach(pt => { pt.x += dx; pt.y += dy; });
    else if (o.type === 'line' || o.type === 'arrow') { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    else { o.x += dx; o.y += dy; }
  }

  /* ================= text input ================= */

  function openTextInput(p) {
    const input = $('textInput');
    const r = canvas.getBoundingClientRect();
    const viewScale = r.width / canvas.width;
    input.style.left = ((p.x - crop.x) * viewScale) + 'px';
    input.style.top = ((p.y - crop.y) * viewScale) + 'px';
    input.style.fontSize = (fontSize * viewScale) + 'px';
    input.style.color = color;
    input.style.display = 'block';
    input.value = '';
    input.focus();
    input.__pos = p;

    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(false); }
      /* Escape abandons the overlay AND hands focus back to the surface it
         covered. Without that hand-back a keyboard user who changed their mind
         is left with focus on a display:none textarea — which the browser drops
         to <body>, i.e. back to the top of the page. Same for the commit path.
         Kept out of commit() so the blur path (which IS a focus change already
         on its way somewhere) does not fight it. */
      if (e.key === 'Escape') { input.style.display = 'none'; input.onblur = null; canvas.focus(); }
      e.stopPropagation();
    };
    /* The blur path is a focus change already on its way somewhere else, so it
       must NOT pull focus back to the canvas; only the Enter path does. */
    input.onblur = () => commit(true);

    function commit(fromBlur) {
      input.onblur = null;
      const text = input.value.trim();
      input.style.display = 'none';
      if (text) {
        objects.push({ type: 'text', x: input.__pos.x, y: input.__pos.y, text, color, size: fontSize });
        pushState(); render();
        announce(msg('editorA11yObjectPlaced',
          [toolLabel('text'), Math.round(input.__pos.x - crop.x), Math.round(input.__pos.y - crop.y)],
          '$OBJECT$ placed at $X$, $Y$'));
      }
      if (!fromBlur) canvas.focus();
    }
  }

  /* ================= crop / undo ================= */

  function applyCrop() {
    if (!cropDraft) return;
    crop = {
      x: Math.round(cropDraft.x),
      y: Math.round(cropDraft.y),
      w: Math.max(10, Math.round(cropDraft.w)),
      h: Math.max(10, Math.round(cropDraft.h))
    };
    cropDraft = null;
    $('cropBar').classList.remove('show');
    pushState();
    layout();
    /* silent: the crop's own sentence says everything the tool change would,
       and two announcements for one keypress is one too many. The insertion
       point is dropped so the next Enter starts from the middle of what is now
       on screen rather than from a point that may be outside it. */
    kbCursor = null;
    kbCursorShown = false;
    setTool('select', true);
    canvas.focus();
    announce(msg('editorA11yCropApplied', [crop.w, crop.h], 'Crop applied, $WIDTH$ by $HEIGHT$'));
  }

  function snapshot() {
    return JSON.stringify({ crop, objects });
  }

  function pushState() {
    undoStack.push(snapshot());
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    /* Any state pushed by something other than an arrow run ENDS that run, so
       the next nudge starts a fresh undo step instead of rewriting whatever was
       pushed last. nudgePush() sets the flag back after calling in. */
    nudgeOpen = false;
    updateUndoButtons();
  }

  function restore(json) {
    const s = JSON.parse(json);
    crop = s.crop;
    objects = s.objects;
    selected = -1;
    cropDraft = null;
    nudgeOpen = false;
    $('cropBar').classList.remove('show');
    layout();
  }

  function undo() {
    if (undoStack.length < 2) return;
    redoStack.push(undoStack.pop());
    restore(undoStack[undoStack.length - 1]);
    updateUndoButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    const s = redoStack.pop();
    undoStack.push(s);
    restore(s);
    updateUndoButtons();
  }

  function updateUndoButtons() {
    $('undoBtn').disabled = undoStack.length < 2;
    $('redoBtn').disabled = !redoStack.length;
    $('undoBtn').textContent = '↶ (' + Math.max(0, undoStack.length - 1) + ')';
    $('redoBtn').textContent = '↷ (' + redoStack.length + ')';
  }

  /* ================= export ================= */

  function renderExport() {
    const c = document.createElement('canvas');
    c.width = crop.w; c.height = crop.h;
    const xctx = c.getContext('2d');
    xctx.fillStyle = '#fff';
    xctx.fillRect(0, 0, c.width, c.height);
    xctx.drawImage(base, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    xctx.save();
    xctx.translate(-crop.x, -crop.y);
    for (const o of objects) drawObject(o, xctx);
    xctx.restore();
    return c;
  }

  function filename() {
    return fsBuildFilename(null, { title: shot.title, url: shot.url, width: crop.w, height: crop.h }) + '-edited';
  }

  async function downloadAs(fmt) {
    const c = renderExport();
    const blob = await fsCanvasToBlob(c, fsMime(fmt), fmt === 'png' ? undefined : 0.92);
    await fsDownloadBlob(blob, filename() + fsExt(fmt));
    fsToast(msg('editorToastDownloaded', null, 'Downloaded'));
  }

  async function copyImage() {
    try {
      const c = renderExport();
      const png = await fsCanvasToBlob(c, 'image/png');
      await fsCopyBlobToClipboard(png, settings && settings.clipboardFit);
      fsToast(msg('toastCopiedClipboard', null, 'Copied to clipboard'));
    } catch (e) {
      /* One placeholdered sentence, not "Copy failed — " + clause: a sentence
         built with + fixes English word order into the product. The clause is
         still the shared allowlist's, never the engine's own words. */
      fsToast(msg('toastCopyFailed', [fsHumanReason(e)], 'Copy failed — $REASON$'));
    }
  }

  async function downloadPdf() {
    const c = renderExport();
    const jpegBytes = (function (dataUrl) {
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    })(c.toDataURL('image/jpeg', 0.9));
    let wPt = c.width * 0.75, hPt = c.height * 0.75;
    const fit = Math.min(1, 14400 / wPt, 14400 / hPt);
    wPt *= fit; hPt *= fit;
    /* NOT translated, deliberately: this is the PDF's /Title, metadata sealed
       into a file the user keeps and moves between machines. The slot normally
       holds the CAPTURED PAGE's own title — the user's data — and its fallback
       belongs to the same slot, the same rule that keeps the filename and the
       /Producer string in English. */
    const blob = FSPDF.build(
      [{ jpeg: jpegBytes, imgW: c.width, imgH: c.height, pageW: wPt, pageH: hPt, x: 0, y: 0, w: wPt, h: hPt, stamp: null }],
      { title: shot.title || 'Screenshot' });
    await fsDownloadBlob(blob, filename() + '.pdf');
    fsToast(msg('editorToastPdfDownloaded', null, 'PDF downloaded'));
  }

  async function save() {
    const c = renderExport();
    const type = fsMime(shot.format);
    const blob = await fsCanvasToBlob(c, type, shot.format === 'png' ? undefined : 0.92);
    shot.segments[segIndex] = { blob, w: c.width, h: c.height };
    if (shot.segments.length === 1) { shot.w = c.width; shot.h = c.height; }

    if (segIndex === 0) {
      const tw = 480;
      const th = Math.max(1, Math.min(600, Math.round(c.height * tw / c.width)));
      const sh = Math.min(c.height, Math.round(th * c.width / tw));
      const tc = document.createElement('canvas');
      tc.width = tw; tc.height = th;
      const tctx = tc.getContext('2d');
      tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, tw, th);
      tctx.drawImage(c, 0, 0, c.width, sh, 0, 0, tw, th);
      shot.thumb = await fsCanvasToBlob(tc, 'image/jpeg', 0.8);
    }

    /* AN ACT LEDGER DOES NOT SURVIVE A TRANSFORMATION (REDACTION-CLAIM-SPEC.md
       §3.3). This save overwrites the shot's pixels in place, so the counts
       describe an image nobody measured — a drawn rectangle can uncover as
       easily as cover, and the blocks were read back out of a canvas that no
       longer exists. THE MARKS GO WITH THEM, and that is the part that matters:
       a mark drawn at a stale coordinate is worse than no mark, because it
       actively points at the wrong place.

       `requested: null` rather than `false`: "we cannot say whether this image
       was redacted" is the truth about a derivation, and it is the value that
       still shows the person the picture before a bundle leaves. Provenance may
       name the parent; it may not restate the parent's numbers. */
    if (shot.redaction && !shot.redaction.derivedFrom) {
      shot.redaction = { v: 3, requested: null,
                         acts: { v: 3, matched: null, painted: null, verifiedOpaque: null,
                                 walkComplete: null, truncatedBy: null, ledger: 'absent' },
                         kinds: shot.redaction.kinds || {}, marks: [],
                         derivedFrom: shot.id };
    }
    await FSDB.put('shots', shot);
    fsToast(msg('editorToastSaved', null, 'Saved to history'));
  }
})();
