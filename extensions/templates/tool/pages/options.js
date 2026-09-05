/* SKELETON options — auto-saving settings, plus the "your data" and "report a
   problem" sections every tool in this family ships.

   Loads after ../lib/settings.js (SK_DEFAULTS, skGetSettings, skSetSettings,
   skResetSettings, skMigrateSettings) and common.js (el, elText, elUntrusted,
   skMsg, skPlural, skConfirm, skToast, skDownloadJson, skBuildDiagnostic,
   skRequestPersistence, theme). Uses lib/storage.js for the list, the export
   and the per-row delete; the WIPE is done by the worker so that any job in
   flight is aborted first.

   THE FOUR THINGS THIS PAGE OWES THE USER, and none of them is optional:
     see it     the list, and a summary that says how much there is
     keep it    export, before an eviction or an uninstall takes it
     remove it  one row at a time, all of it, and the settings too
     trust it   a durability line that is true in both branches, and a report
                the user reads before it is written */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /* PLACEHOLDER(options-fields) — one entry per key in SK_DEFAULTS, keyed by the
     element id in options.html. Kinds: 'checked' | 'value' | 'number'.
     A key with no control here is a key the user cannot see or change; the sim
     asserts the three lists (SK_DEFAULTS, this, the html) agree. */
  const FIELDS = {
    copyOnOpen: 'checked',
    keepHistory: 'checked',
    historyLimit: 'number',
    retentionDays: 'number',
    theme: 'value'
  };

  let saveTimer = null;

  document.addEventListener('DOMContentLoaded', async () => {
    $('themeBtn').addEventListener('click', skToggleTheme);
    // A version string is FUNCTIONAL OUTPUT, not a sentence: it is the same
    // characters in every language and is pasted into bug reports.
    elText($('version'), 'v' + chrome.runtime.getManifest().version);

    // Idempotent, and the only place a page needs to think about schema drift:
    // an install that skipped versions is brought up to date before it is read.
    await skMigrateSettings();
    await renderFields();

    for (const key of Object.keys(FIELDS)) {
      const node = $(key);
      if (!node) continue;
      node.addEventListener(node.type === 'number' || node.type === 'text' ? 'input' : 'change', queueSave);
    }

    $('exportBtn').addEventListener('click', exportAll);
    $('clearBtn').addEventListener('click', clearAll);
    $('resetBtn').addEventListener('click', resetSettings);
    $('reportBtn').addEventListener('click', prepareReport);
    $('grantBtn').addEventListener('click', grantSiteAccess);
    $('revokeBtn').addEventListener('click', revokeSiteAccess);
    /* Re-read on every change, from whichever direction. The grant can also be
       revoked from chrome://extensions, and a row that says "granted" over a
       permission the user took away five seconds ago is worse than no row. */
    if (chrome.permissions && chrome.permissions.onAdded) {
      chrome.permissions.onAdded.addListener(renderSiteAccess);
      chrome.permissions.onRemoved.addListener(renderSiteAccess);
    }
    await renderSiteAccess();

    /* The options page is a Window with a user present, which is the only place
       navigator.storage.persist() can be called from — a service worker gets
       undefined. Guarded to once by a LOCAL setting inside the helper. */
    await skRequestPersistence();
    await refreshData();
  });

  /* THE WRITE-BACK PATH. Repaints every control from what is actually STORED.

     It exists because of a bug this family has already shipped once: save()
     clamps historyLimit in code (correctly — the widget's min/max is advice a
     user with devtools edits away), but the old version never put the clamped
     value back in the box. Type 999999, storage holds 1000, the page keeps
     showing 999999, and the answer to "what am I actually running?" becomes
     unknowable — which then makes every bug report from that user ambiguous.

     It is also the repaint the reset button needs, so there is one function and
     not two that drift. */
  async function renderFields() {
    const s = await skGetSettings();
    for (const [key, kind] of Object.entries(FIELDS)) {
      const node = $(key);
      if (!node) continue;
      if (kind === 'checked') node.checked = !!s[key];
      else node.value = s[key];
    }
    return s;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  }

  async function save() {
    const out = {};
    for (const [key, kind] of Object.entries(FIELDS)) {
      const node = $(key);
      if (!node) continue;
      if (kind === 'checked') out[key] = node.checked;
      else if (kind === 'number') out[key] = Number(node.value) || 0;
      else out[key] = node.value;
    }
    /* PLACEHOLDER(clamps) — a settings page is an input surface: clamp anything
       numeric here rather than trusting the widget's min/max, which a user with
       devtools can edit. Then let renderFields() below put the clamped value
       back on screen, or the form is lying about what is in effect. */
    out.historyLimit = Math.min(1000, Math.max(1, out.historyLimit || SK_DEFAULTS.historyLimit));
    out.retentionDays = Math.min(365, Math.max(0, out.retentionDays || 0));

    /* skSetSettings never throws — it answers. A write CAN fail for real (the
       8 KB per-item ceiling, the 120-writes-a-minute limiter after a burst),
       and the old code awaited it with no catch, so a failure became an
       unhandled rejection: no "Saved", no error, and a form still showing a
       value that was never stored. */
    const wrote = await skSetSettings(out);
    if (!wrote.ok) {
      skToast('toastSaveFailed');
      await renderFields();       // show what IS stored, not what was typed
      return;
    }

    await skApplyTheme();
    await renderFields();
    /* The text is SET here rather than sitting in the markup, because #saveNote
       is a role="status" region: a region whose text never changes is a region a
       screen reader never announces. Writing it on every save is what makes
       "Saved" audible as well as visible. */
    const note = $('saveNote');
    elText(note, skMsg('optionsSaved'));
    note.classList.add('show');
    setTimeout(() => note.classList.remove('show'), 1200);
    await refreshData();
  }

  /* The list. Every value here came from a web page, so every value here goes
     through elUntrusted()/elText() — never string concatenation, and never a
     plain span: a stored title carrying U+202E would otherwise reverse the
     rendering of the origin printed next to it. */
  async function refreshData() {
    const list = $('itemList');
    elClear(list);
    let rows = [];
    try { rows = await SKDB.getItemsNewestFirst(); } catch (_) {}

    /* chrome.i18n has no plural support and `n === 1 ? 'row' : 'rows'` is not a
       translation problem, it is a grammar bug — Arabic has six plural
       categories, Polish four. skPlural asks Intl.PluralRules which form this
       locale needs and reads that key. One sentence, one message, one
       $COUNT$ substitution: nothing is glued together with `+`. */
    elText($('dataSummary'), rows.length
      ? skPlural('dataStoredRows', rows.length, [String(rows.length)])
      : skMsg('dataNothingStored'));

    await renderDurability();

    for (const row of rows.slice(0, 200)) {
      const li = el('li');
      const del = el('button', 'btn row-del', skMsg('rowDelete'));
      del.type = 'button';
      /* Named by the ORIGIN, so a screen-reader user moving down a list of
         identical "Delete" buttons is told which row each one destroys. The
         origin is scheme + host and nothing else — the worker never stored a
         path — and it is set as an attribute VALUE through the substitution,
         never concatenated into a sentence. */
      del.setAttribute('aria-label', skMsg('rowDeleteLabel', [String(row.origin || '')]));
      del.addEventListener('click', () => deleteRow(row.id));
      elAppend(li,
        el('span', 'when', skFormatDate(row.createdAt || 0)),
        elUntrusted('what', row.title || ''),
        elUntrusted('when', row.origin || ''),
        del);
      list.appendChild(li);
    }
  }

  /* Verbatim in BOTH branches, and it never guesses. "Durable" on an origin
     that is actually best-effort would be the single most damaging sentence on
     this page: it is the one that stops a user exporting a backup. */
  async function renderDurability() {
    const key = await skDurabilityKey();
    const est = await SKDB.estimate();
    const line = $('dataDurability');
    if (est.supported && est.usage != null && est.quota != null) {
      elText(line, skMsg('dataDurabilityWithUsage',
        [skMsg(key), skFormatBytes(est.usage), skFormatBytes(est.quota)]));
    } else {
      elText(line, skMsg(key));
    }
  }

  /* ---------------- site access ---------------- */
  /* THE MOST CONSEQUENTIAL THING A USER CAN GRANT THIS FAMILY, AND THE ONE
     THING THE PRODUCT USED TO OFFER NO WAY BACK FROM.

     `chrome.permissions.request` is one click from inside the product;
     revoking it is four steps in a browser settings page the user has to be
     told about. That asymmetry is the same failure the blocked-page sentences
     exist to prevent — "nowhere to go" — applied to a privacy decision instead
     of an error. It also makes the store listing weaker: "optional, and you can
     turn it off in the extension" defends a permission; "optional" alone does
     not.

     PLACEHOLDER(optional-perms) — the origins come from the MANIFEST, never
     from a constant here, so the row can never claim a permission the tool does
     not declare. The skeleton declares none, so the section stays hidden and
     nothing is requested. Add `"optional_host_permissions": ["<all_urls>"]` (or
     narrower, and narrower is the answer) and every part of this lights up:
     the true state on load, a request path, a revoke path, and a re-read on
     both change events. */
  function optionalOrigins() {
    try { return chrome.runtime.getManifest().optional_host_permissions || []; }
    catch (_) { return []; }
  }

  async function renderSiteAccess() {
    const origins = optionalOrigins();
    const section = $('siteAccessSection');
    if (!origins.length) { section.hidden = true; return false; }
    section.hidden = false;

    /* Never assumed. `contains` is the browser's own answer, and it is asked
       again after every change rather than tracked in a variable that can go
       stale behind a chrome://extensions edit. */
    let held = false;
    try { held = !!(await chrome.permissions.contains({ origins })); } catch (_) {}

    elText($('siteAccessState'), skMsg(held ? 'siteAccessGranted' : 'siteAccessNotGranted'));
    $('grantBtn').hidden = held;
    $('revokeBtn').hidden = !held;
    return held;
  }

  /* Must be called from inside a user gesture — this IS one (a click handler),
     and Chrome refuses the request otherwise. */
  async function grantSiteAccess() {
    const origins = optionalOrigins();
    if (!origins.length) return;
    let got = false;
    try { got = !!(await chrome.permissions.request({ origins })); } catch (_) {}
    await renderSiteAccess();
    skToast(got ? 'toastSiteAccessGranted' : 'toastSiteAccessRefused');
  }

  async function revokeSiteAccess() {
    const origins = optionalOrigins();
    if (!origins.length) return;
    /* No confirmation. Revoking is the SAFE direction, and a prompt in front of
       the safe direction teaches people to click through the prompt in front of
       the dangerous one. */
    let gone = false;
    try { gone = !!(await chrome.permissions.remove({ origins })); } catch (_) {}
    await renderSiteAccess();
    skToast(gone ? 'toastSiteAccessRevoked' : 'toastSiteAccessRevokeFailed');
  }

  /* EXPORT. Portability is the other half of "reachable and deletable", and it
     is the only thing that makes eviction and uninstall survivable. Through
     skDownloadJson + skBuildFilename, so the file lands with the same shape as
     every other file this family writes. The filename tokens stay ISO-ish and
     locale-independent on purpose: a filename is functional output. */
  async function exportAll() {
    let payload = null;
    try {
      payload = await SKDB.exportAll({ version: chrome.runtime.getManifest().version });
    } catch (_) {
      skToast('toastExportFailed');
      return;
    }
    try {
      await skDownloadJson(payload, skBuildFilename('skeleton-export-{date}-{time}', { ext: '.json' }));
      skToast('toastExported');
    } catch (_) {
      skToast('toastExportFailed');
    }
  }

  /* One row, gone. No confirmation: it is a single row the user is looking at,
     it is named in the button's accessible name, and a prompt on every row
     trains people to dismiss prompts — which is what makes the prompt on
     "Delete everything" work. */
  async function deleteRow(id) {
    try { await SKDB.delete('items', id); } catch (_) {
      skToast('toastDeleteFailed');
      return;
    }
    await refreshData();
    skToast('toastRowDeleted');
  }

  async function clearAll() {
    /* Destructive and irreversible, so it asks first — through the shared
       <dialog> primitive, which restores focus to this button when it closes.
       Default deny: Escape, the backdrop and Cancel all resolve false. */
    const ok = await skConfirm({
      titleKey: 'confirmDeleteAllTitle',
      bodyKey: 'confirmDeleteAllBody',
      confirmKey: 'optDeleteAllButton',
      danger: true
    });
    if (!ok) return;

    // Through the worker: it aborts anything in flight before emptying the
    // stores, so a job cannot write a scratch row after the wipe.
    const resp = await chrome.runtime.sendMessage({ type: 'SK_CLEAR_DATA' })
      .catch(() => ({ ok: false }));
    await refreshData();
    skToast(resp && resp.ok ? 'toastDeleted' : 'toastDeleteFailed');
  }

  async function resetSettings() {
    const ok = await skConfirm({
      titleKey: 'confirmResetTitle',
      bodyKey: 'confirmResetBody',
      confirmKey: 'optResetButton',
      danger: true
    });
    if (!ok) return;
    const done = await skResetSettings();
    await renderFields();
    await skApplyTheme();
    skToast(done && done.ok ? 'toastReset' : 'toastResetFailed');
  }

  /* REPORT A PROBLEM — build, SHOW, then write. In that order.

     The user sees the exact bytes in a scrollable pane inside the confirm
     dialog and presses Save, or presses Cancel and nothing touches the disk.
     Default deny is not a formality here: this file is about to leave the
     machine by a route the product cannot see. */
  async function prepareReport() {
    const [settings, facts, durability, est, lastError] = await Promise.all([
      skGetSettings(),
      chrome.runtime.sendMessage({ type: 'SK_DIAGNOSTIC' })
        .then(r => (r && r.facts) || {}).catch(() => ({})),
      skDurabilityKey(),
      SKDB.estimate(),
      chrome.storage.session.get('skLastError')      // PLACEHOLDER(prefix)
        .then(g => (g && g.skLastError) || null).catch(() => null)
    ]);

    const report = skBuildDiagnostic({
      version: chrome.runtime.getManifest().version,
      uiLocale: skUiLocale(),
      userAgent: navigator.userAgent,
      settings, facts, durability, lastError,
      usage: est.usage, quota: est.quota
    });
    const text = JSON.stringify(report, null, 2);

    const ok = await skConfirm({
      titleKey: 'confirmReportTitle',
      bodyKey: 'confirmReportBody',
      confirmKey: 'confirmReportSave',
      previewText: text
    });
    if (!ok) return;

    try {
      await skDownloadJson(report, skBuildFilename('skeleton-report-{date}-{time}', { ext: '.json' }));
      skToast('toastReportSaved');
    } catch (_) {
      skToast('toastExportFailed');
    }
  }
})();
