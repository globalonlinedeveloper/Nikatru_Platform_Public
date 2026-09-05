/* FullShot history — browse, batch-download, and delete saved screenshots. */

/* ---- strings -------------------------------------------------------------
   Every string on this page is either in history.html carrying data-i18n /
   data-i18n-attr — where the English text stays put as the fallback — or
   resolved here through fsMessage()/fsPluralMessage() from pages/common.js,
   with the English passed alongside the key so a missing message degrades to
   the English this page shipped for a year rather than to a blank.

   Nothing is concatenated. "3 of 24 screenshots · 12.4 MB" was built with +,
   which fixes English word order into the product: ja puts the total first
   ("24 件中 3 件"), ru puts the noun after the number, and "screenshot" + "s"
   is not how any of ru's four plural forms work. Each of those is one
   placeholdered message per CLDR category instead, chosen by fsPluralMessage.

   What is NOT translated here, deliberately: the filename fsBuildFilename
   returns and its -partN suffix (a name the user keeps on disk), the store
   name 'shots', the page URLs, the class names and the glyphs. */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let shots = [];
  let query = '';
  const selected = new Set();
  let settings = null;

  document.addEventListener('DOMContentLoaded', async () => {
    settings = await fsGetSettings();
    $('themeBtn').addEventListener('click', fsToggleTheme);
    $('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('selectAllBtn').addEventListener('click', toggleSelectAll);
    $('dlSelBtn').addEventListener('click', downloadSelected);
    $('delSelBtn').addEventListener('click', deleteSelected);
    $('searchBox').addEventListener('input', () => {
      query = $('searchBox').value.trim().toLowerCase();
      selected.clear();
      renderGrid();
    });
    /* Escape, in the order a user expects it to undo things: the filter first
       (it is hiding most of the page), then the selection (it is arming two
       destructive buttons), then the toast. Each press undoes one, which is
       what makes the key predictable — a single handler that cleared all
       three at once would be one keystroke and three surprises. */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const box = $('searchBox');
      if (box.value) {
        box.value = '';
        query = '';
        selected.clear();
        renderGrid();
        box.focus();
      } else if (selected.size) {
        selected.clear();
        renderGrid();
      } else {
        const t = document.getElementById('fs-toast');
        if (t) t.classList.remove('show');
      }
    });
    await refresh();
  });

  /* `focusAfter` names where the keyboard should land once the grid has been
     rebuilt. Both callers that pass it got here by pressing a button that is
     about to stop existing — a card's own 🗑, or "Delete selected", which
     disables itself the instant the selection it counted is gone. Focus does
     not follow a removed or disabled element: it falls to <body>, silently,
     which for a screen-reader user is the entire page starting over with no
     word about what just happened.

     An id rather than an element, because the element a caller could hand over
     is one of the ones being thrown away. Two fallbacks, in the order a person
     would reach for them: the first control of the toolbar while there is
     still a grid to act on, and the empty-state panel once there is not — it
     carries tabindex="-1" for exactly this, and it is also the text that
     explains why the page is now blank. */
  async function refresh(focusAfter) {
    shots = await FSDB.getShotsNewestFirst();
    selected.clear();
    renderGrid();
    if (!focusAfter) return;
    const el = document.getElementById(focusAfter);
    const usable = el && !el.disabled && !el.hidden;
    (usable ? el : (visibleShots().length ? $('selectAllBtn') : $('emptyState'))).focus();
  }

  function visibleShots() {
    if (!query) return shots;
    return shots.filter(s =>
      (s.title || '').toLowerCase().includes(query) ||
      (s.url || '').toLowerCase().includes(query));
  }

  function renderGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    const vis = visibleShots();
    $('emptyState').hidden = vis.length > 0;
    if (!vis.length) {
      $('emptyState').querySelector('h2').textContent = query
        ? fsMessage('historyNoMatchesTitle', null, 'No matches')
        : fsMessage('historyEmptyTitle', null, 'No screenshots yet');
      /* What the user typed is a SUBSTITUTION, not a splice: the quoted term
         moves inside the sentence from language to language, and it lands in
         textContent either way, so it is text and never markup. */
      $('emptyState').querySelector('p').textContent = query
        ? fsMessage('historyNoMatchesBody', [query], 'No screenshots match "$QUERY$".')
        : fsMessage('historyEmptyBody', null,
            'Captures you take will appear here. Click the FullShot icon in your toolbar to get started.');
    }
    /* The plural agrees with the TOTAL — it is the noun the line counts, in
       both the plain and the filtered form ("3 of 24 screenshots"). */
    const bytes = shots.reduce((a, s) => a + s.segments.reduce((x, g) => x + g.blob.size, 0), 0);
    $('countText').textContent = shots.length
      ? (query
          ? fsPluralMessage('historyCountFiltered', shots.length,
              [fsNumber(vis.length), fsNumber(shots.length), fsFormatBytes(bytes)],
              '$SHOWN$ of $COUNT$ screenshots · $SIZE$')
          : fsPluralMessage('historyCount', shots.length,
              [fsNumber(shots.length), fsFormatBytes(bytes)],
              '$COUNT$ screenshots · $SIZE$'))
      : '';

    for (const s of vis) grid.appendChild(card(s));
    updateBar();
  }

  function card(s) {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('role', 'listitem');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    /* aria-label, not just title. A bare checkbox has no name at all, and
       title is only a fallback some readers announce and others do not — a
       row of 24 unnamed checkboxes is 24 identical "checkbox, unchecked". */
    cb.setAttribute('aria-label', fsMessage('historyCardSelect', null, 'Select'));
    cb.title = fsMessage('historyCardSelect', null, 'Select');
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(s.id) : selected.delete(s.id);
      el.classList.toggle('selected', cb.checked);
      updateBar();
    });

    /* The thumbnail is the biggest target on the card and it used to be an
       <img> with a click handler: no tab stop, no Enter, no Space, announced
       as "image". A real <button> gets all three for free.

       Its NAME is the captured page's own title, and its DESCRIPTION is the
       word "Open" — that way round on purpose. Twenty-four buttons all named
       "Open" are indistinguishable in a screen reader's element list, which is
       how a blind user navigates a grid; named by the page they show, the list
       becomes the history. The title belongs to the captured page and is never
       translated; only "Open" is a message. (aria-label overrides the
       content, so the <img> inside it takes alt="" and adds nothing.) */
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'thumb';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = URL.createObjectURL(s.thumb || s.segments[0].blob);
    open.appendChild(img);
    open.setAttribute('aria-label', s.title || s.url || fsMessage('historyUntitled', null, 'Screenshot'));
    open.title = fsMessage('historyCardOpen', null, 'Open');
    open.addEventListener('click', () => {
      location.href = 'result.html?shot=' + encodeURIComponent(s.id);
    });

    const info = document.createElement('div');
    info.className = 'info';
    const t = document.createElement('div');
    t.className = 'title';
    /* s.title and s.url belong to the CAPTURED PAGE and are never touched;
       only the stand-in for a page that had neither is ours to translate. */
    t.textContent = s.title || s.url || fsMessage('historyUntitled', null, 'Screenshot');
    t.title = t.textContent;
    const sub = document.createElement('div');
    sub.className = 'sub';
    /* The pair reverses inside an RTL card — "1280×4096" renders 4096 wide —
       and `unicode-bidi: plaintext` on .card .sub does not save it, because the
       date puts the line's base direction RTL and the reversal then happens
       inside. See the long note above fsDims() in pages/common.js.
       fsDims() itself cannot be the fix here: the MESSAGE owns the separator
       ($WIDTH$×$HEIGHT$, and ar/de/ru space it differently), so width and
       height go in as two substitutions. The isolate therefore goes around the
       pair rather than around one number — the same two characters fsDims is
       built from, opened before the width and popped after the height, so the
       separator the message supplies is inside it. */
    const wIso = FS_LRI + String(s.w), hIso = String(s.h) + FS_PDI;
    const when = new Date(s.createdAt).toLocaleString();
    sub.textContent = s.segments.length > 1
      ? fsMessage('historyCardSubtitleParts',
          [when, wIso, hIso, fsNumber(s.segments.length)],
          '$DATE$ · $WIDTH$×$HEIGHT$ · $COUNT$ parts')
      : fsMessage('historyCardSubtitle', [when, wIso, hIso], '$DATE$ · $WIDTH$×$HEIGHT$');
    info.append(t, sub);
    /* THE ACTS, WHEREVER THE RECORD IS LISTED (REDACTION-CLAIM-SPEC.md §2.2).
       There is no badge here any more — a badge is a verdict with the words
       taken out, and it was shown for exactly the states the old design graded
       as bad. What replaces it is the same sentence the result page shows, for
       every record where redaction was not positively off: no colour, no glyph,
       nothing that ranks one record above another.

       The class is the same name the result page puts on its permanent line. It
       is a HOOK, not a style — see the note beside .card .sub in history.html
       for why it must stay one. */
    const line = actsLine(redactionOf(s));
    if (line != null) {
      const acts = document.createElement('div');
      acts.className = 'sub redactline';
      acts.textContent = line;
      info.append(acts);
    }
    if (s.url && /^https?:/i.test(s.url)) {
      const link = document.createElement('a');
      link.className = 'sub';
      link.href = s.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = s.url;
      link.title = fsMessage('historyCardOpenOriginal', null, 'Open original page');
      /* --accent-text, not --accent. --accent is a SURFACE colour, graded at
         3:1 for a filled button or a ring; as 11.5px link text on a card it
         was 3.80:1 in the dark theme, which is under AA. See the palette note
         in pages/common.css. */
      link.style.cssText = 'display:block;color:var(--accent-text);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px';
      info.append(link);
    }

    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      btn(fsMessage('historyCardOpen', null, 'Open'),
        () => location.href = 'result.html?shot=' + encodeURIComponent(s.id)),
      btn(fsMessage('historyCardEdit', null, 'Edit'),
        () => location.href = 'editor.html?shot=' + encodeURIComponent(s.id) + '&seg=0'),
      btn('⬇', () => downloadShot(s), fsMessage('historyCardDownloadTip', null, 'Download')),
      btn('🗑', async () => {
        if (!confirm(fsMessage('historyConfirmDeleteSingle', null, 'Delete this screenshot?'))) return;
        await FSDB.delete('shots', s.id);
        /* This button is inside the card that is about to be rebuilt away. */
        await refresh('selectAllBtn');
      }, fsMessage('historyCardDeleteTip', null, 'Delete'), 'danger')
    );

    el.append(cb, open, info, row);
    return el;
  }

  /* ---- what this record says about the redaction pass ----------------------
     THE RECORD AS THIS PAGE IS ENTITLED TO READ IT. pages/db.js strips and
     translates the old block on the way out of the store (§4), so `s.redaction`
     here is either the v3 block or nothing at all — and NOTHING is one of §4's
     three populations rather than a reason to say nothing: an ancient record
     with no block is `requested: null` over an absent ledger, which is a
     sentence. The stored verdict is never read: not as an input, not as a
     fallback, not to seed a default.

     Same expression as currentRedaction() in pages/result.js, and it has to be:
     a card that fell silent on a record the result page speaks about is the
     shape this whole section exists to close. */
  function redactionOf(s) {
    const r = s && s.redaction;
    if (r && r.v === 3 && r.acts && typeof r.acts === 'object') return r;
    return { v: 3, requested: null,
             acts: { v: 3, matched: null, painted: null, verifiedOpaque: null,
                     walkComplete: null, truncatedBy: null, ledger: 'absent' } };
  }

  /* ALL FOUR VARIANTS, NOT ONE (§3.4). This page used to render the flat
     three-count line for every record it showed at all, so a capture with an
     uncovered match fired the alarm on the result page and read
     "Redaction on. 2 matched, 1 painted, 1 confirmed opaque in this image."
     here — the same three numbers, arranged so that nobody has to subtract
     them. That is worse on this page than on that one: history is where a
     person picks an OLD screenshot to share, days later, with no memory of what
     was on it, which is precisely when the shortfall line is most needed and
     least likely to be remembered. A user who checked history was handed
     reassurance the result page would not have given them.

     THE SUBTRACTION IS NOT REPEATED HERE. fsRedactShortfall in pages/common.js
     answers for the sentence on every surface that has one; two copies of a
     predicate is how the last round ended up with a review dialog bolding on
     one rule while the sentence chose on another. It is called UNGUARDED, on
     purpose — a `typeof` fallback here would degrade this page to the flat line
     on exactly the load where the predicate went missing, and the flat line is
     the reassurance. test/pixel-sim renders one seeded record through the real
     result.js and the real history.js and compares the strings, so a fifth
     variant added to one page and not the other is red.

     Every substitution is an integer this product computed; nothing from the
     captured page reaches this string, and it lands in textContent regardless. */
  function actsLine(r) {
    const a = (r && r.acts) || {};
    if (r && r.requested === false) return null;
    if (a.ledger === 'absent') {
      return fsMessage('redactActsNoLedger', null,
        'This record carries no account of a redaction pass on this capture.');
    }
    const num = v => typeof v === 'number';
    const n = v => (num(v) ? fsNumber(v)
      : fsMessage('redactActsUnknownCount', null, '—'));
    let text;
    const short = fsRedactShortfall(a);
    if (num(a.matched) && a.matched === 0) {
      text = fsMessage('redactActsNone', null,
        'Redaction matched nothing in the text it read and painted no blocks. ' +
        'Nothing is outlined below.');
    } else if (short != null && short > 0) {
      /* TWO SENTENCES, and the split is not cosmetic: the first states two
         counts and can agree with neither, the second states one and is a
         declared plural base. "1 matches are not covered" on the one line in
         this design that means something is where a reader stops believing the
         rest of it. */
      const covered = a.matched - short;
      text = fsMessage('redactActsShortfall', [n(a.matched), n(covered)],
        'Redaction matched $MATCHED$ and covered $COVERED$.');
      const rest = fsPluralMessage('redactActsUncovered', short, [n(short)],
        short === 1 ? '$COUNT$ match is not covered in this image.'
                    : '$COUNT$ matches are not covered in this image.');
      if (rest != null) text = (text == null ? '' : text + ' ') + rest;
    } else {
      text = fsMessage('redactActsLine', [n(a.matched), n(a.painted), n(a.verifiedOpaque)],
        'Redaction on. $MATCHED$ matched, $PAINTED$ painted, $VERIFIED$ confirmed opaque in this image.');
    }
    /* Appended to whichever arm rendered, never an arm of its own. */
    if (a.walkComplete === false) {
      const more = fsMessage('redactActsWalkTruncated', null,
        'FullShot did not finish walking this page.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    /* §2.1.1's completeness sentence, in the same position and the same wording
       as pages/result.js — a person picking an old screenshot to share is the
       reader least likely to remember that this capture's count was never whole.
       Appended, never an arm, and NOT gated on the four gap sentences below:
       every one of their counters can be zero while `matchedComplete` is false
       (an unwalked same-origin frame and a span the re-measure had no room for
       both reach the seal and neither reaches `textRefused`). The anti-drift
       check in test/pixel-sim compares this string against result.js's. */
    if (a.matchedComplete === false) {
      const more = fsMessage('redactActsCountPartial', null,
        'This count may be short: FullShot did not read some of the text in this capture.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    /* WHERE THE PASS GAVE UP, on the surface a person meets a week later —
       which is the surface that needs it most, for the same reason the
       shortfall sentence does. Four counts, two sentences, each rendered only
       when it has something to report; kept in the same order and the same
       wording as pages/result.js, and the string comparison in test/pixel-sim
       is what stops the two drifting. */
    const gap = v => (num(v) && v > 0);
    if (gap(a.textRefused) || gap(a.blocksLost)) {
      const more = fsMessage('redactActsScanLimits', [n(a.textRefused || 0), n(a.blocksLost || 0)],
        'Pieces of text it did not read: $REFUSED$. Blocks it found and did not draw: $LOST$.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    if (gap(a.blocksUnpainted) || gap(a.blocksUnread)) {
      const more = fsMessage('redactActsBakeLimits', [n(a.blocksUnpainted || 0), n(a.blocksUnread || 0)],
        'Blocks it could not place in this image: $UNPLACED$. Blocks it drew and did not read back: $UNREAD$.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    return text;
  }

  function btn(label, fn, title, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (extra ? ' ' + extra : '');
    b.textContent = label;
    /* A button whose whole label is ⬇ or 🗑 is announced as the name of that
       character — content beats title in the accessible-name calculation, so
       the tooltip below is never reached. aria-label replaces the content
       outright, which is the only way a glyph button gets a word. */
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', fn);
    return b;
  }

  function updateBar() {
    const n = selected.size;
    $('dlSelBtn').disabled = !n;
    $('delSelBtn').disabled = !n;
    /* The LABEL, not the button: the glyph is its own element in the markup so
       that writing the text cannot delete it, and so that no message file has
       to carry ⬇ or 🗑. */
    $('dlSelLabel').textContent = n
      ? fsMessage('historyDownloadSelectedCount', [fsNumber(n)], 'Download ($COUNT$)')
      : fsMessage('historyDownloadSelected', null, 'Download selected');
    $('delSelLabel').textContent = n
      ? fsMessage('historyDeleteSelectedCount', [fsNumber(n)], 'Delete ($COUNT$)')
      : fsMessage('historyDeleteSelected', null, 'Delete selected');
    $('selectAllBtn').textContent = n === visibleShots().length && n > 0
      ? fsMessage('historyClearSelection', null, 'Clear selection')
      : fsMessage('historySelectAll', null, 'Select all');
  }

  function toggleSelectAll() {
    const vis = visibleShots();
    const all = selected.size === vis.length && vis.length > 0;
    selected.clear();
    if (!all) vis.forEach(s => selected.add(s.id));
    document.querySelectorAll('.card').forEach((el, i) => {
      const on = vis[i] ? selected.has(vis[i].id) : false;
      el.classList.toggle('selected', on);
      el.querySelector('input[type="checkbox"]').checked = on;
    });
    updateBar();
  }

  async function downloadShot(s) {
    const base = fsBuildFilename(settings.filenameTemplate, {
      title: s.title, url: s.url, width: s.w, height: s.h
    });
    const ext = fsExt(s.format);
    for (let i = 0; i < s.segments.length; i++) {
      const suffix = s.segments.length > 1 ? '-part' + (i + 1) : '';
      await fsDownloadBlob(s.segments[i].blob, base + suffix + ext);
    }
  }

  async function downloadSelected() {
    const n = selected.size;
    for (const s of shots) {
      if (selected.has(s.id)) await downloadShot(s);
    }
    fsToast(fsPluralMessage('historyToastDownloading', n, [fsNumber(n)],
      'Downloading $COUNT$ screenshots'));
  }

  async function deleteSelected() {
    const n = selected.size;
    if (!confirm(fsPluralMessage('historyConfirmDeleteMany', n, [fsNumber(n)],
      'Delete $COUNT$ screenshots permanently?'))) return;
    for (const id of selected) await FSDB.delete('shots', id);
    /* #delSelBtn was the trigger and refresh() disables it — a disabled
       control cannot hold focus, so naming it here is deliberate: refresh()
       sees it is unusable and falls through to the toolbar (or, if the
       history is now empty, to the panel that says so). */
    await refresh('delSelBtn');
    fsToast(fsMessage('historyToastDeleted', null, 'Deleted'));
  }
})();
