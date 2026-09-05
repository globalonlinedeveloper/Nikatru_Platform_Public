/* FullShot options — auto-saving settings page. */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const FIELDS = {
    imageFormat: 'value',
    jpegQuality: 'range100',   // stored 0..1, shown 50..100
    filenameTemplate: 'value',
    captureDelay: 'number',
    hideFixed: 'checked',
    preScroll: 'checked',
    adaptiveWait: 'checked',
    hideOverlays: 'checked',
    expandInner: 'checked',
    unrollVirtual: 'checked',
    expandInteractive: 'checked',
    loadMore: 'checked',
    infiniteScroll: 'checked',
    waitStable: 'checked',
    redactPII: 'checked',
    maxPageHeight: 'number',
    pdfPaper: 'value',
    pdfOrientation: 'value',
    pdfStamp: 'checked',
    pdfSmartSplit: 'checked',
    saveDirectory: 'value',
    saveAs: 'checked',
    clipboardFit: 'checked',
    autoDownload: 'checked',
    autoOpenEditor: 'checked',
    theme: 'value'
  };

  let saveTimer = null;

  document.addEventListener('DOMContentLoaded', async () => {
    $('themeBtn').addEventListener('click', fsToggleTheme);
    /* Escape hides the confirmation pill. It overlays the bottom corner of the
       page and it is the only thing here a reader might want out of the way
       before its timer runs out; nothing on this page traps focus, so this is
       the whole of what Escape has to answer for. */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') $('saveNote').classList.remove('show');
    });
    const s = await fsGetSettings();

    for (const [key, kind] of Object.entries(FIELDS)) {
      const el = $(key);
      if (!el) continue;
      if (kind === 'checked') el.checked = !!s[key];
      else if (kind === 'range100') el.value = Math.round((s[key] || 0.92) * 100);
      else el.value = s[key];

      el.addEventListener(el.type === 'text' || el.type === 'number' ? 'input' : 'change', () => queueSave());
    }
    $('jpegQuality').addEventListener('input', showQuality);
    showQuality();
    showPaperDesc();

    // "Expand scrollable content": cross-site frames need the optional
    // <all_urls> grant. Ask when the feature is switched on; without it the
    // feature still works for panels and same-site iframes.
    await refreshExpandPermRow();
    $('expandInner').addEventListener('change', async () => {
      if ($('expandInner').checked) {
        try { await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch (_) {}
      }
      await refreshExpandPermRow();
    });
    $('expandPermBtn').addEventListener('click', async () => {
      try { await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch (_) {}
      await refreshExpandPermRow();
    });

    /* ---- Your data ---- */
    $('exportImages').checked = true;   // page state, not a setting: see showExportSize()
    $('exportImages').addEventListener('change', showExportSize);
    $('persistBtn').addEventListener('click', keepMyData);
    $('exportBtn').addEventListener('click', exportEverything);
    $('sweepBtn').addEventListener('click', sweepLeftovers);
    $('resetBtn').addEventListener('click', resetSettings);
    $('deleteAllBtn').addEventListener('click', deleteEverything);
    await showStorage();
    await showExportSize();
  });

  /* ---- the three lines this page writes rather than declares ---------------
     Everything else on options.html carries its key in the markup and is
     substituted once by fsApplyI18n(). These three cannot be, because each
     needs a value that only exists at runtime, and each keeps its English here
     as the fallback for a browser with no chrome.i18n — fsMessage() fills the
     $TOKENS$ in that fallback itself, so the shape stays the same either way. */

  /* The percent sign is part of the message. Building it with + would fix the
     English order into the product: several locales write the sign before the
     number, and one writes it with a space in front. */
  function showQuality() {
    $('qualityVal').textContent =
      fsMessage('optionsQualityValue', [$('jpegQuality').value], '$PERCENT$%');
  }

  /* This sentence NAMES the first entry of the paper dropdown, so $IMAGESIZE$
     has to be that entry in the SAME language — a literal carried by
     data-i18n-args would be the English words in all 55. Resolved from
     optionsPaperAuto, which is the one string the dropdown itself shows, so
     the two can never disagree. */
  function showPaperDesc() {
    const auto = fsMessage('optionsPaperAuto', null, 'Image size');
    $('pdfPaperDesc').textContent = fsMessage('optionsPdfPaperDesc', [auto],
      '"$IMAGESIZE$" makes one page exactly the size of the screenshot.');
  }

  async function refreshExpandPermRow() {
    const row = $('expandPermRow');
    const btn = $('expandPermBtn');
    /* Where the keyboard was standing, BEFORE anything is hidden. This
       function is reached by pressing the Allow button, and granting the
       permission is what hides that button — focus then falls to <body>, i.e.
       the top of the document, silently. A sighted mouse user never notices;
       a screen-reader user is simply somewhere else with no announcement. */
    const cameFromButton = document.activeElement === btn;
    const on = $('expandInner').checked;
    row.hidden = !on;
    if (!on) {
      if (cameFromButton) $('expandInner').focus();
      return;
    }
    let granted = false;
    try { granted = await chrome.permissions.contains({ origins: ['<all_urls>'] }); } catch (_) {}
    /* PRIVACY STRINGS. Both are back-translation checked in all 55 locales and
       the negation in the second one is what is being checked, so neither may
       be assembled from parts here — the whole claim is one message. The
       permission's own name is a do-not-translate placeholder inside it. */
    $('expandPermNote').textContent = granted
      ? fsMessage('optionsExpandPermGranted', null,
          'Permission granted — frames from other sites are expanded too.')
      : fsMessage('optionsExpandPermMissing', null,
          'Without the "read all websites" permission, cross-site frames are captured as seen. Panels and same-site iframes always work.');
    btn.hidden = granted;
    /* Back to the toggle that owns this row — the nearest thing to a trigger
       once the button itself is gone, and the control the user would reach for
       next. Only when the button really had focus: moving it otherwise would
       yank a reader out of wherever they were reading. */
    if (granted && cameFromButton) $('expandInner').focus();
  }

  /* ---- Your data ------------------------------------------------------------
     publish/PRIVACY-POLICY.html §7 promises the reader can remove what FullShot
     keeps. Four doors, and the division of labour between this page and the
     worker is the same for all four: the WORKER decides anything that depends on
     which captures are running, this page owns the person — the sentence, the
     confirmation, and the file.

     The one thing that cannot be delegated either way is the export: a
     screenshot is a Blob, and a Blob cannot cross runtime.sendMessage. So the
     page reads the database itself for that, which is also why pages/db.js is
     loaded here now. */

  /* Asking the worker rather than the database: `leftovers` is a count of rows
     nothing can reach, and only the worker knows which captures are running and
     therefore which unreferenced-looking rows are about to be referenced. */
  function ask(type, extra) {
    return chrome.runtime.sendMessage(Object.assign({ type }, extra || {}))
      .catch(() => null);
  }

  /* SIZES, SPELT THE WAY THE READER SPELLS THEM.
     fsFormatBytes() in common.js stops at megabytes and hardcodes the English
     unit — which was fine while the largest number on any page was one
     screenshot, and is not fine here: a browser quota is routinely hundreds of
     gigabytes, and this page rendered "166545.46 MB", a number nobody can read.
     The message file has carried unitBytes / unitKilobytes / unitMegabytes in
     all 55 languages since the i18n phase and nothing had ever spent them; the
     gigabyte row was added for this. The number itself goes through fsNumber,
     because most of Europe writes 12,40 rather than 12.40.
     Same thresholds and the same rounding as fsFormatBytes below a gigabyte, so
     the two never disagree about the same file. common.js belongs to nobody in
     this phase, which is why the shared helper is not the one that grew. */
  function size(n) {
    const v = typeof n === 'number' && isFinite(n) && n > 0 ? n : 0;
    if (v < 1024) return fsMessage('unitBytes', [fsNumber(Math.round(v))], '$VALUE$ B');
    if (v < 1048576) return fsMessage('unitKilobytes', [fsNumber(Math.round(v / 1024 * 10) / 10)], '$VALUE$ KB');
    if (v < 1073741824) return fsMessage('unitMegabytes', [fsNumber(Math.round(v / 1048576 * 100) / 100)], '$VALUE$ MB');
    return fsMessage('unitGigabytes', [fsNumber(Math.round(v / 1073741824 * 100) / 100)], '$VALUE$ GB');
  }

  async function showStorage() {
    const est = await FSDB.estimate();
    /* THREE STATES, not two. A browser that does not answer is not a browser
       with nothing stored, and printing "0 B of 0 B" would be a confident lie
       about the one number this section exists to show. */
    $('storageUsage').textContent = (est.usage == null || est.quota == null)
      ? fsMessage('optionsStorageUnknown', null,
          'This browser does not report how much space FullShot is using.')
      : fsMessage('optionsStorageUsage', [size(est.usage), size(est.quota)],
          '$USED$ of $QUOTA$ used on this device.');
    await showPersistState();
  }

  /* WITHOUT THIS THE WHOLE HISTORY IS DISPOSABLE. An origin that has not been
     granted persistent storage sits in the browser's best-effort bucket, and
     Chrome clears best-effort storage under disk pressure — every screenshot the
     user kept, gone, with no prompt and no notification. `unlimitedStorage` does
     not change that: it lifts the quota, it does not change the bucket.

     The state is READ on every load and the request is left to the button. An
     automatic request would be one more thing happening to the user's browser
     without them asking, and the answer is the same either way — what matters is
     that the state is finally visible somewhere. */
  async function showPersistState() {
    const kept = await FSDB.persisted();
    $('storageState').textContent = kept
      ? fsMessage('optionsStorageKept', null,
          'Your screenshots are kept: the browser will not clear them to reclaim space.')
      : fsMessage('optionsStorageAtRisk', null,
          'Your screenshots are in the browser’s best-effort store, which it can clear to reclaim space.');
    // null means the browser has no persisted() at all: there is nothing to ask
    // for and no honest button to offer.
    $('persistBtn').hidden = kept !== false;
  }

  async function keepMyData() {
    /* Where the keyboard was standing, BEFORE the button can hide itself — the
       same hazard as the Allow button above, and the same answer. The outcome
       line is the natural landing place: it is a live region, so a screen reader
       reads the answer at the moment focus arrives on it. */
    const cameFromButton = document.activeElement === $('persistBtn');
    await FSDB.persist();
    await showPersistState();
    if (cameFromButton) $('storageState').focus();
  }

  /* THE SIZE IS SHOWN BEFORE THE FILE IS WRITTEN, and that is the feature rather
     than a courtesy: with the images this file is the user's entire screenshot
     library, and the two answers are three orders of magnitude apart. Recomputed
     whenever the toggle moves.
     `include images` is deliberately NOT a stored setting: it is a choice about
     one file, it lives as long as the page does, and FS_DEFAULTS is a table the
     worker's diagnostics and the install seed both walk. */
  async function exportRows() {
    const shots = await FSDB.getShotsNewestFirst();
    return shots.map(s => {
      const segments = s.segments || [];
      return {
        id: s.id, title: s.title || '', url: s.url || '',
        createdAt: s.createdAt || 0, mode: s.mode || '',
        w: s.w || 0, h: s.h || 0, format: s.format || '',
        parts: segments.length,
        bytes: segments.reduce((a, g) => a + ((g && g.blob && g.blob.size) || 0), 0),
        segments
      };
    });
  }

  async function showExportSize() {
    const rows = await exportRows();
    const withImages = $('exportImages').checked;
    // base64 is four characters for every three bytes, plus the data: prefix and
    // the JSON string quoting. Called "about" in the message for that reason.
    const pixels = withImages ? rows.reduce((a, r) => a + Math.ceil(r.bytes * 4 / 3) + 40, 0) : 0;
    const meta = 400 + rows.reduce((a, r) => a + 220 + r.title.length + r.url.length, 0);
    $('exportSize').textContent = fsMessage('optionsExportSize',
      [size(pixels + meta)], 'File size: about $SIZE$');
  }

  /* A Blob to base64 without FileReader: readAsDataURL is a browser-only,
     event-driven detour, and this shape runs unchanged wherever the page is
     graded. Chunked because String.fromCharCode.apply blows the argument limit —
     and therefore the stack — somewhere around a hundred thousand bytes, which
     is a small screenshot. */
  async function dataUrlOf(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(bin);
  }

  async function exportEverything() {
    try {
      const withImages = $('exportImages').checked;
      const settings = await fsGetSettings();
      const rows = await exportRows();
      /* EVERY setting, INCLUDING the free-text ones — the opposite of the
         diagnostic bundle, and deliberately so. That bundle is built to be sent
         to a stranger, so it names the fields that may travel; this file is the
         user's own data going to the user's own disk, and a redacted copy of
         your own filename template is not a backup. */
      const doc = {
        export: 'FullShot data export',
        version: chrome.runtime.getManifest().version,
        when: new Date().toISOString(),
        settings,
        screenshots: []
      };
      for (const r of rows) {
        const row = {
          id: r.id, title: r.title, url: r.url, createdAt: r.createdAt,
          mode: r.mode, w: r.w, h: r.h, format: r.format, parts: r.parts, bytes: r.bytes
        };
        if (withImages) {
          row.images = [];
          for (const seg of r.segments) if (seg && seg.blob) row.images.push(await dataUrlOf(seg.blob));
        }
        doc.screenshots.push(row);
      }
      const name = 'fullshot-export-' + new Date().toISOString().slice(0, 10) + '.json';
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      await fsDownloadBlob(blob, name);
      fsToast(fsMessage('toastSavedFileSize', [name, size(blob.size)],
        'Saved $FILENAME$  ·  $SIZE$'));
    } catch (e) {
      fsToast(fsMessage('toastExportFailed', [fsHumanReason(e)], 'Export failed — $REASON$'));
    }
  }

  /* THREE OUTCOMES, NOT TWO. The worker used to answer with successes only, so
     forty orphans that would not delete came back as `frames: 0` — the same
     value a genuinely clean database returns — and this page rendered "Nothing
     left over: everything stored belongs to a screenshot you can see." over
     forty full-resolution pictures the reader cannot see and cannot remove.
     `found` is what the sweep set out to delete and `failed` is what would not
     go, so the clean case is now "there was nothing to do" rather than "nothing
     happened", and those two stopped being the same sentence. */
  async function sweepLeftovers() {
    const res = await ask('DATA_SWEEP');
    if (!res || !res.ok) {
      $('sweepResult').textContent = fsMessage('errGeneric', null,
        'The capture stopped before it finished. Please try again.');
      return;
    }
    const removed = (res.frames || 0) + (res.captures || 0);
    const found = typeof res.found === 'number' ? res.found : removed;
    $('sweepResult').textContent = !found
      ? fsMessage('optionsSweepClean', null,
          'Nothing left over: everything stored belongs to a screenshot you can see.')
      : (res.failed
          ? fsMessage('optionsSweepPartial', [fsNumber(removed), fsNumber(found), size(res.freed || 0)],
              'Removed $COUNT$ of $FOUND$ · Space freed: $SIZE$ · The rest could not be removed. Try again, or restart your browser.')
          : fsMessage('optionsSweepResult', [fsNumber(removed), size(res.freed || 0)],
              'Removed. Captures cleaned up: $COUNT$ · Space freed: $SIZE$'));
    await showStorage();
  }

  async function resetSettings() {
    if (!confirm(fsMessage('optionsResetConfirm', null,
      'Put every FullShot setting back to its default? Your screenshots are not affected.'))) return;
    /* The declared table and nothing else. A storage.sync.clear() would also
       drop fsMigratedExpandDefault, and the next browser update would then run
       the 1.3.0 migration again over a choice the user had just made. */
    await chrome.storage.sync.set(FS_DEFAULTS);
    for (const [key, kind] of Object.entries(FIELDS)) {
      const el = $(key);
      if (!el) continue;
      if (kind === 'checked') el.checked = !!FS_DEFAULTS[key];
      else if (kind === 'range100') el.value = Math.round(FS_DEFAULTS[key] * 100);
      else el.value = FS_DEFAULTS[key];
    }
    showQuality();
    await fsApplyTheme();
    await refreshExpandPermRow();
    $('resetResult').textContent = fsMessage('optionsResetDone', null, 'Settings are back to their defaults.');
  }

  /* NOTHING HERE IS UNDOABLE, so the sentence in front of the reader is the
     whole truth: how many screenshots, how much is left over from captures they
     never saw fail, how much space it frees, and — the half a person forgets to
     write — what it will NOT touch. The numbers come from the worker, so the
     count includes rows no page can see. */
  async function deleteEverything() {
    const st = await ask('DATA_STATUS');
    if (!st || !st.ok) return;
    /* An estimate rather than a sum, and the only place in this section that
       is: it covers everything the origin holds, which is what "delete
       everything" is about to remove. A browser that will not answer says so
       rather than claiming a number. */
    const total = st.usage == null
      ? fsMessage('optionsStorageUnknown', null, 'This browser does not report how much space FullShot is using.')
      : size(st.usage);
    /* A COUNT THE WORKER COULD NOT READ IS NOT A ZERO. `st.shots || 0` turned an
       unreadable database into "Screenshots in your History: 0", which is the
       one sentence in this product where a confident zero costs the reader
       everything: they agree to destroy nothing and lose their whole library.
       Same rule as the size above — a browser that will not answer says so. */
    const count = n => (typeof n === 'number' && isFinite(n))
      ? fsNumber(n)
      : fsMessage('optionsCountUnknown', null, '—');
    const said = fsMessage('optionsDeleteAllConfirm',
      [count(st.shots), count(st.leftovers), total],
      'Delete everything FullShot has stored on this device?\n\n' +
      'Screenshots in your History: $COUNT$\n' +
      'Leftovers from interrupted captures: $LEFTOVER$\n' +
      'Space this frees: $SIZE$\n\n' +
      'Your settings are not affected. This cannot be undone.');
    if (!confirm(said)) return;
    const res = await ask('DATA_DELETE_ALL');
    if (!res || !res.ok) {
      $('deleteAllResult').textContent = fsMessage('errGeneric', null,
        'The capture stopped before it finished. Please try again.');
      return;
    }
    $('deleteAllResult').textContent = fsMessage('optionsDeleteAllDone', null,
      'Deleted. FullShot now stores no screenshots on this device.');
    await showStorage();
    await showExportSize();
  }

  /* NOTHING IS LISTENING TO THIS PROMISE, so save() has to catch its own
     failure. `setTimeout(save, 350)` with an async save is an unhandled
     rejection waiting to happen, and it happens for an ordinary reason:
     storage.sync caps at 120 writes a minute and a 350 ms debounce issues about
     170 under sustained typing. What the user saw was the "Saved ✓" pill simply
     not appearing — and that pill appears on every other keystroke, so its
     absence reads as a rendering hiccup rather than as data that did not save. */
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  }

  async function save() {
    const out = {};
    for (const [key, kind] of Object.entries(FIELDS)) {
      const el = $(key);
      if (!el) continue;
      if (kind === 'checked') out[key] = el.checked;
      else if (kind === 'range100') out[key] = Math.min(1, Math.max(0.5, Number(el.value) / 100));
      else if (kind === 'number') out[key] = Number(el.value) || 0;
      else out[key] = el.value;
    }
    // Sanity clamps
    out.captureDelay = Math.min(2000, Math.max(0, out.captureDelay));
    out.maxPageHeight = Math.min(200000, Math.max(2000, out.maxPageHeight || 50000));
    if (!out.filenameTemplate.trim()) out.filenameTemplate = FS_DEFAULTS.filenameTemplate;

    let stored = true;
    // The theme follows the value that was actually written, so it is inside
    // the same try: applying a theme the store rejected would be the pill's
    // failure wearing a different hat.
    try {
      await chrome.storage.sync.set(out);
      await fsApplyTheme();
    } catch (_) { stored = false; }
    const note = $('saveNote');
    /* The text is REWRITTEN, not just revealed. #saveNote is role="status", and
       a live region announces a change to its contents — fading a pill whose
       text has been sitting there since page load changes nothing, so the save
       was silent for a screen-reader user even though the region existed.
       Writing the same string replaces the text node, which is the change. */
    note.textContent = stored
      ? fsMessage('optionsSaved', null, 'Saved ✓')
      : fsMessage('optionsSaveFailed', null, 'Not saved ✕');
    note.classList.add('show');
    setTimeout(() => note.classList.remove('show'), 1200);
  }
})();
/* build 1.2.0 */
