/* FullShot shared page utilities: theme, settings, filenames, downloads. */

const FS_DEFAULTS = {
  imageFormat: 'png',
  jpegQuality: 0.92,
  captureDelay: 150,
  hideFixed: true,
  preScroll: false,
  adaptiveWait: true,
  hideOverlays: false,
  expandInner: true,
  unrollVirtual: false,
  expandInteractive: false,
  loadMore: false,
  infiniteScroll: false,
  waitStable: false,
  redactPII: false,
  /* The redaction walk's time budget in ms; -1 = the engine's own
     FS_PII_WALK_MS. It has no control on the Options page and it is still in
     this table on purpose: "Reset settings" writes THE DECLARED TABLE AND
     NOTHING ELSE, so a key missing from here is a key a reset cannot put back.
     Kept byte-for-byte in step with background.js's DEFAULTS — see the longer
     note there for why the key exists at all. */
  redactWalkMs: -1,
  maxPageHeight: 50000,
  filenameTemplate: 'fullshot-{domain}-{date}-{time}',
  pdfPaper: 'auto',
  pdfOrientation: 'portrait',
  pdfStamp: false,
  pdfSmartSplit: true,
  saveDirectory: '',
  saveAs: false,
  clipboardFit: true,
  autoDownload: false,
  autoOpenEditor: false,
  theme: 'system'
};

/* Format helpers: png | jpeg | webp */
function fsMime(format) {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}
function fsExt(format) {
  return format === 'jpeg' ? '.jpg' : format === 'webp' ? '.webp' : '.png';
}

/* Clipboard helper: browsers only accept PNG; optionally downscale huge
   images so pasting into Google Docs (25MP limit) & co. works.

   `text` is the AI hand-off sidecar (AI-HANDOFF-ENVELOPE.md §9) and is
   OPTIONAL. Three other pages call this — editor, beautify, scrollclip — and
   none of them passes it; a caller that offers no text writes exactly the one
   type it wrote before the sidecar existed, byte for byte. That is not
   politeness, it is the invariant: the image path must not change because a
   text feature arrived.

   MEASURED, NOT ASSUMED (Chromium 149, headless and headful through the real
   Windows clipboard): offering both types drops NOTHING. The paste event
   carries types ["text/plain","Files"] with the PNG in files[0], and which one
   lands is the receiving editor's decision — a default contenteditable takes
   the image, a textarea takes the text, a handler that reads text/plain first
   and preventDefaults takes the text and loses the image. Key order in the
   ClipboardItem does not matter; Chromium normalises it. Full table and the
   caveat in AI-HANDOFF-ENVELOPE.md §9.

   The lossy case is real, so the image-only route stays reachable without a
   setting: the editor, beautify and scroll-clip copies all land here with no
   text, so Edit -> Copy to clipboard is where a user goes when their editor
   ate the picture. */
async function fsCopyBlobToClipboard(blob, fitLimit, text) {
  let bmp = await createImageBitmap(blob);
  let w = bmp.width, h = bmp.height;
  const MAXP = 24.5e6;
  if (fitLimit && w * h > MAXP) {
    const s = Math.sqrt(MAXP / (w * h));
    w = Math.max(1, Math.floor(w * s));
    h = Math.max(1, Math.floor(h * s));
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const png = await fsCanvasToBlob(c, 'image/png');
  const payload = { 'image/png': png };
  if (typeof text === 'string' && text.length) {
    payload['text/plain'] = new Blob([text], { type: 'text/plain' });
  }
  await navigator.clipboard.write([new ClipboardItem(payload)]);
  c.width = c.height = 0;
}

async function fsGetSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(FS_DEFAULTS));
  return Object.assign({}, FS_DEFAULTS, stored);
}

/* ---- writing direction --------------------------------------------------
   The ONE place a FullShot page learns which way it reads. It asks the browser
   which message file actually loaded, never a list of RTL language codes: a
   list here would be a second source of truth alongside i18n/locales.mjs, and
   it would be wrong the day a fourth RTL locale is added.

   @@bidi_dir, not getUILanguage(): the two disagree whenever the browser's UI
   language has no _locales directory and Chrome falls back. getUILanguage()
   reports what the user set; @@bidi_dir reports the direction of the STRINGS
   that are actually on screen, and it is the strings that have to be readable.

   Synchronous and unconditional. The stylesheets already carry
   `direction: __MSG_@@bidi_dir__`, which Chrome substitutes before first paint,
   so this is not what stops an RTL flash — it is what puts the value on the
   dir ATTRIBUTE, which [dir=] selectors, :dir() and form controls read and CSS
   `direction` alone does not set. Both, because either one alone leaves a gap.

   It must never throw: pages/common.js is also required as a plain module by
   the editor tier, and popup.js runs inside a sim whose fake chrome has no
   i18n. A missing i18n is simply "no opinion" — leave the document alone. */
function fsApplyDir() {
  try {
    if (typeof chrome === 'undefined' || !chrome.i18n || !chrome.i18n.getMessage) return;
    const dir = chrome.i18n.getMessage('@@bidi_dir');
    if (dir === 'rtl' || dir === 'ltr') document.documentElement.dir = dir;
    const loc = chrome.i18n.getMessage('@@ui_locale');
    if (loc) document.documentElement.lang = loc.replace(/_/g, '-');
  } catch (_) { /* a browser without i18n reads left-to-right, as before */ }
}

/* ---- messages: the pass that actually reads the locale files -------------
   FullShot ships 55 fully translated message files and, until this function
   existed, rendered English in every one of them. Measured, not assumed: under
   --lang=ar, chrome.i18n.getMessage('popupModeFullTitle') returned "الصفحة
   كاملة" in the same browser session in which the popup rendered "Full page".
   Message files, manifest, direction and packaging can all be complete and
   correct while the product is 100% English, because those are four
   independent layers and only this one is the layer a user sees.

   WHY MARKUP CARRIES THE KEY AND NOT THE TEXT.
   Chrome substitutes __MSG_x__ in manifest.json and in .css files. It does NOT
   substitute inside HTML — a page that wrote __MSG_popupModeFullTitle__ into a
   text node would render those characters literally. So the key travels in an
   attribute and the substitution happens here, once, on load.

   THE ENGLISH STAYS IN THE HTML. `<b data-i18n="popupModeFullTitle">Full
   page</b>` is not redundancy — it is the fallback. A key that fails to
   resolve leaves the element exactly as authored and warns to the console, so
   the worst case is the English this product shipped for a year, never a blank
   button. That is also what makes the markup readable and reviewable: a
   diff shows the sentence, not just an identifier.

   textContent AND setAttribute, NEVER a markup sink. A message file is
   translated text and this pass is copied into 67 sibling tools; the day one of
   them takes a string from somewhere less trustworthy, the sink is what decides
   whether that is a bug or a vulnerability. A message therefore cannot carry
   markup — which is also why an element carrying data-i18n must hold text and
   no child elements, asserted in test/i18n-sim.node.js.

   It must never throw. pages/common.js is required as a plain module by the
   editor tier, and a browser whose chrome.i18n is missing simply has no
   opinion — same rule as fsApplyDir above. */

/* Attributes this pass may write, BY NAME. An allowlist, never a pattern: the
   difference between a tooltip and a navigation sink is not a thing a regex can
   be trusted to know, and `data-i18n-attr="href:someKey"` would turn a message
   file into a link target. `value` is deliberately absent — an <option value>
   is an ENUM ('png', 'a4', 'portrait'), and translating one corrupts the
   user's settings rather than merely looking wrong. */
const FS_I18N_ATTRS = ['alt', 'aria-description', 'aria-label', 'aria-placeholder',
  'aria-roledescription', 'aria-valuetext', 'label', 'placeholder', 'title'];

/* CLDR category -> key suffix. The SAME table as i18n/plurals.mjs, which is an
   ESM build-time module and is never shipped; test/i18n-sim.node.js asserts the
   two agree, so the copy cannot drift. */
const FS_PLURAL_SUFFIX = { zero: 'Zero', one: 'One', two: 'Two', few: 'Few', many: 'Many', other: 'Other' };

function fsI18nAvailable() {
  try { return typeof chrome !== 'undefined' && !!(chrome.i18n && chrome.i18n.getMessage); }
  catch (_) { return false; }
}

/* The locale of the message file that actually LOADED — not what the user set.
   Same reasoning as fsApplyDir: the two disagree whenever Chrome falls back,
   and it is the strings on screen that have to agree with the plural rule. */
function fsUiLocale() {
  try {
    if (fsI18nAvailable()) {
      const l = chrome.i18n.getMessage('@@ui_locale');
      if (l) return l.replace(/_/g, '-');
    }
  } catch (_) {}
  return 'en';
}

/* $TOKEN$ substitution for a FALLBACK string only. Chrome does this itself for
   a message that resolved; this is the path taken when it did not, so the shape
   has to match: tokens are filled in ORDER OF FIRST APPEARANCE, which is the
   order the English file declares them ($1, $2, $3). A repeated token spends
   the same value twice, and an unfilled one is left visible rather than blanked
   — a visible $ORIGIN$ is a bug report; a silent gap is not. */
function fsI18nSubst(text, subs) {
  if (!subs || !subs.length) return String(text);
  const seen = new Map();
  return String(text).replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name) => {
    const n = name.toLowerCase();
    if (!seen.has(n)) seen.set(n, seen.size);
    const v = subs[seen.get(n)];
    return v == null ? whole : String(v);
  });
}

/* Resolve without complaining — the plural selector below tries two keys and a
   miss on the first is normal, not a defect. */
function fsRawMessage(key, subs) {
  try {
    if (!fsI18nAvailable()) return '';
    return chrome.i18n.getMessage(key, subs == null ? undefined : subs.map(String)) || '';
  } catch (_) { return ''; }
}

/* The one lookup a page should call. `fallback` is the English to use when the
   key does not resolve; pass null where the caller has its own fallback (the
   DOM pass leaves the authored English in place) and null comes back. */
function fsMessage(key, subs, fallback) {
  const text = fsRawMessage(key, subs);
  if (text) return text;
  if (fsI18nAvailable()) console.warn('i18n: no message for "' + key + '"');
  return fallback == null ? null : fsI18nSubst(fallback, subs);
}

/* Chrome's messages.json has NO plural support — no ICU MessageFormat, no
   selector. The only shape that works is one key per CLDR category, chosen here
   with Intl.PluralRules for the locale that loaded. Categories are NOT a table
   in this file: ja has one, de two, fr three, ru four, ar six, and a hand-kept
   list would be wrong the day CLDR moves. See i18n/plurals.mjs. */
function fsPluralCategory(count) {
  try { return new Intl.PluralRules(fsUiLocale()).select(Number(count)); }
  catch (_) { return 'other'; }
}

function fsNumber(n) {
  try { return new Intl.NumberFormat(fsUiLocale()).format(Number(n)); }
  catch (_) { return String(n); }
}

/* `subs` is the COMPLETE positional list the message declares — count included,
   at whatever position it holds (scrollclipDims spends it third). Omit it and
   the formatted count is the only substitution. Falls back to <base>Other,
   because a locale file only carries the categories that locale uses and a
   category selected for a locale Chrome fell back FROM would otherwise blank
   the line. */
function fsPluralMessage(base, count, subs, fallback) {
  const args = subs == null ? [fsNumber(count)] : subs;
  const cat = fsPluralCategory(count);
  const keys = cat === 'other' ? [base + 'Other'] : [base + FS_PLURAL_SUFFIX[cat], base + 'Other'];
  for (const k of keys) {
    const t = fsRawMessage(k, args);
    if (t) return t;
  }
  if (fsI18nAvailable()) console.warn('i18n: no message for "' + base + FS_PLURAL_SUFFIX[cat] + '" (or its Other form)');
  return fallback == null ? null : fsI18nSubst(fallback, args);
}

/* data-i18n-args="3" — literal substitutions for a message spent in static
   markup, comma-separated, trimmed. Only for values that are part of the
   markup itself (the delay dropdown's 3, 5, 10); anything computed belongs in
   a fsMessage() call, where it is not limited to text that survives an
   attribute. */
function fsI18nArgs(el) {
  const raw = el.getAttribute('data-i18n-args');
  if (raw == null || raw === '') return null;
  return raw.split(',').map(s => s.trim());
}

/* Walk `root` (the document by default) and fill in every marked element.
   Returns how many writes happened, so a caller — or a test — can tell "the
   page has no keys" from "the pass never ran".

   Call it again after rendering: history cards, batch rows and result toasts
   are built at runtime and are not in the document when the load pass runs. */
function fsApplyI18n(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
  const nodes = [];
  if (typeof scope.hasAttribute === 'function' &&
      (scope.hasAttribute('data-i18n') || scope.hasAttribute('data-i18n-attr'))) nodes.push(scope);
  const found = scope.querySelectorAll('[data-i18n], [data-i18n-attr]');
  for (let i = 0; i < found.length; i++) nodes.push(found[i]);

  let written = 0;
  for (const el of nodes) {
    const args = fsI18nArgs(el);
    const key = el.getAttribute('data-i18n');
    if (key) {
      const text = fsMessage(key, args, null);
      if (text != null) { el.textContent = text; written++; }
    }
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) continue;
    /* "title:popupToggleTheme; aria-label:popupDismiss" — one pair per
       attribute, separated by ';'. The key may not contain ':', and none does:
       a message name is [A-Za-z0-9_]. */
    for (const pair of spec.split(';')) {
      if (!pair.trim()) continue;
      const cut = pair.indexOf(':');
      const name = (cut < 0 ? pair : pair.slice(0, cut)).trim().toLowerCase();
      const k = cut < 0 ? '' : pair.slice(cut + 1).trim();
      if (!name || !k) { console.warn('i18n: malformed data-i18n-attr "' + pair.trim() + '"'); continue; }
      if (FS_I18N_ATTRS.indexOf(name) < 0) { console.warn('i18n: refusing to write attribute "' + name + '"'); continue; }
      const text = fsMessage(k, args, null);
      if (text != null) { el.setAttribute(name, text); written++; }
    }
  }
  return written;
}

async function fsApplyTheme() {
  const { theme } = await chrome.storage.sync.get('theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

async function fsToggleTheme() {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  await chrome.storage.sync.set({ theme: next });
}

function fsPad(n) { return String(n).padStart(2, '0'); }

function fsBuildFilename(template, { title = '', url = '', width = 0, height = 0 } = {}) {
  let domain = '';
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
  const d = new Date();
  const map = {
    '{domain}': domain || 'page',
    '{title}': title.slice(0, 60),
    '{date}': `${d.getFullYear()}-${fsPad(d.getMonth() + 1)}-${fsPad(d.getDate())}`,
    '{time}': `${fsPad(d.getHours())}-${fsPad(d.getMinutes())}-${fsPad(d.getSeconds())}`,
    '{width}': String(width),
    '{height}': String(height)
  };
  let name = template || FS_DEFAULTS.filenameTemplate;
  for (const [k, v] of Object.entries(map)) name = name.split(k).join(v);
  // Sanitize for filesystems.
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_');
  return name.replace(/^[_\-.]+|[_\-.]+$/g, '') || 'fullshot';
}

/* ---- a measurement is DATA, and data does not flip -----------------------
   "1280×4096" dropped into a right-to-left sentence renders as "4096×1280".
   Measured, not assumed: the × is bidi-neutral and the digits are weak, so the
   pair takes the paragraph's direction and comes out reversed — a 1280-wide
   capture that reads 4096 wide. That is the same class of harm as translating
   a filename: FullShot corrupting the user's own numbers.

   `unicode-bidi: isolate` on the container does NOT fix it. Isolation stops the
   run from disturbing its neighbours; the run's own base direction is still
   inherited, so the reversal happens inside the isolate. Only pinning the
   direction fixes it, and the pin has to sit around the NUMBERS, not around the
   sentence — the sentence is translated and genuinely reads right-to-left.

   So the pin is two characters of the string itself rather than markup:
   U+2066 LEFT-TO-RIGHT ISOLATE … U+2069 POP DIRECTIONAL ISOLATE. They work in
   textContent, in a title attribute, in a document.title and in a canvas
   fillText, which markup does not; they are invisible; and they keep the rule
   in one function instead of in five call sites.

   Spelled from char codes, never pasted as the characters: a literal U+2066 in
   source is invisible in every editor and turns the file binary to grep — the
   same trap a NUL byte set in i18n/backtranslation.mjs one phase ago. */
const FS_LRI = String.fromCharCode(0x2066), FS_PDI = String.fromCharCode(0x2069);
function fsDims(w, h, sep) {
  return FS_LRI + String(w) + (sep == null ? '×' : sep) + String(h) + FS_PDI;
}

function fsFormatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

async function fsDownloadBlob(blob, filename) {
  const { saveDirectory, saveAs } = await chrome.storage.sync.get(['saveDirectory', 'saveAs']);
  let dir = String(saveDirectory || '')
    .replace(/[<>:"|?*\x00-\x1f\\]/g, '')     // strip invalid chars, backslashes
    .split('/').map(s => s.trim().replace(/^\.+|\.+$/g, '')).filter(Boolean).join('/');
  const path = dir ? dir + '/' + filename : filename;
  const url = URL.createObjectURL(blob);
  return chrome.downloads.download({ url, filename: path, saveAs: !!saveAs })
    .finally(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
}

function fsLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

function fsCanvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas export failed — image may be too large')), type, quality);
  });
}

/* ---- failure text -------------------------------------------------------
   Every catch block on these pages used to put the exception's own message on
   screen. That is the worker's parked-failure-note bug one surface along, and
   the worker took three attempts to settle it: no sanitising leaked; a regex
   leaked again (its class excluded the apostrophe, which Chrome does not
   percent-encode, so a path containing one carried a token and a card number
   straight through); an ALLOWLIST held. This is that allowlist, for pages.

   Why a page needs one when most of what fails here is canvas work: two calls
   in these catch blocks are about a NAME rather than about pixels.
   fsDownloadBlob hands the browser a filename built from the CAPTURED PAGE's
   {domain} and {title}, under the directory the user set in saveDirectory —
   which lives in chrome.storage.sync and therefore syncs. FSDB.put seals a
   record holding the captured page's title and url, so an IndexedDB rejection
   is the engine talking about exactly that. Everything else in those blocks
   (bitmaps, canvases, the GIF encoder, the clipboard) can only fail about
   sizes and formats — but they route through here too, because one rule in
   one place is the only kind a call site written next year cannot skip.

   Why a table and not a filter: a filter has to understand its input in order
   to clean it, and an engine string is not ours to understand. Recognised text
   is REPLACED by a clause written here; anything else becomes one clause also
   written here. Neither branch ever returns a piece of its argument, so there
   is no character class left to get wrong. The raw value still reaches
   console.error — local, ephemeral, never rendered, never stored. */
/* Clauses, not sentences: every call site prefixes the action that failed
   ("Copy failed — ..."), which is information the user needs and no exception
   ever carried. They start lower-case and end in a stop for that reason, and
   they hold no dash of their own so the prefix's dash stays the only one. */
const FS_REASON_GENERIC = 'no reason was given. Please try again.';

/* Left: text FullShot itself writes, exactly. Right: the clause a person
   reads. Only sentences this project produces are listed. An engine wording
   guessed at here would be a row that never matches, and a row that never
   matches is worse than the generic clause it was meant to improve on — it
   reads like coverage. New user-facing text belongs in this table as a
   literal, never interpolated at a call site. */
const FS_REASONS = [
  ['Failed to decode image', 'that screenshot could not be decoded.'],
  ['Canvas export failed — image may be too large', 'the image is too large to export here.']
];

const FS_REASON_BY_TEXT = new Map();
for (const row of FS_REASONS) {
  FS_REASON_BY_TEXT.set(row[0].toLowerCase(), row[1]);
  // A clause that has been through the gate once must survive a second pass
  // unchanged — cheaper to guarantee here than to prove at every call site.
  if (!FS_REASON_BY_TEXT.has(row[1].toLowerCase())) FS_REASON_BY_TEXT.set(row[1].toLowerCase(), row[1]);
}
FS_REASON_BY_TEXT.set(FS_REASON_GENERIC.toLowerCase(), FS_REASON_GENERIC);

/* The only thing a page may put on screen about a failure. The logging lives
   here too, so a call site cannot show the text and forget the console — or,
   worse, do it the other way round.

   A value that is not already a string is NOT stringified on the way in:
   String() and `+` both run a foreign object's own toString, which is not a
   thing a guard does to the value it is guarding against. Such a value simply
   gets the generic clause. */
function fsHumanReason(e) {
  try { console.error(e); } catch (_) {}
  const raw = typeof e === 'string' ? e
    : (e && typeof e.message === 'string' ? e.message : null);
  if (raw === null) return FS_REASON_GENERIC;
  return FS_REASON_BY_TEXT.get(raw.trim().toLowerCase()) || FS_REASON_GENERIC;
}

function fsToast(msg, ms = 2200) {
  let t = document.getElementById('fs-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'fs-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t.__timer);
  t.__timer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ==========================================================================
   THE AI HAND-OFF ENVELOPE
   Specification: AI-HANDOFF-ENVELOPE.md (normative). Read that first — this is
   the reference implementation of a shape sixty-seven sibling tools implement
   against, and the document is the part that transfers.

   Why it lives in common.js rather than in a module of its own: every surface
   that can copy a picture eventually has to copy the context beside it, and
   common.js is the one file all of them already load. A pages/aictx.js would
   need a <script> tag on five pages, and the pages are not this item's to edit.

   Nothing in here touches the DOM, the network or storage. It is arithmetic
   and string handling, which is why the whole of it is graded by
   test/aihandoff-sim.node.js against the shipped file.
   ========================================================================== */

/* The version a consumer reads. MAJOR before the dot is breaking; MINOR after
   it is additive only. Bumping this is a decision, not a side effect — see
   AI-HANDOFF-ENVELOPE.md §2.

   1.1 removes `redaction.pixels`, `.state`, `.severity` and `.evidence`
   (REDACTION-CLAIM-SPEC.md §2.2). §2 of the envelope spec's "ignore unknown
   keys" rule covers a key that APPEARS; it does not cover one that disappears,
   so a consumer keyed on `pixels === "baked"` now reads `undefined` — which is
   the correct direction, and which is why the minor moves. */
const FS_AI_ENVELOPE = 'ai-handoff/1.1';

/* ---- the limit table ----------------------------------------------------
   THIS TABLE IS A MOVING TARGET AND IS MAINTAINED BY HAND. Every row is a
   hand-copied reading of somebody else's published limits and billing
   arithmetic; they change without telling us, and a number here that nobody
   re-checks quietly becomes folklore. `asOf` is the month a human last read the
   row's `source`, and BOTH travel in the payload so a reader can see a stale
   estimate without knowing anything about us.

   THE TWO CEILINGS ARE DIFFERENT FACTS, AND CONFLATING THEM IS THE DEFECT THIS
   TABLE WAS REBUILT FOR. `maxEdge`/`maxArea` are the size past which a consumer
   DOWNSCALES the image anyway — exceeding them costs bytes and latency and
   nothing else. `hardMaxEdge` is the size past which the request is REJECTED
   with a validation error, and there is no recovery from it: the paste simply
   fails. Anthropic documents both ("Claude resizes oversized images rather than
   rejecting them, up to the API's request limits. Beyond those limits the
   request fails with a validation error instead"), and pages/result.js clamps
   its own stitched canvas at MAX_DIM = 16000 px — twice the reject ceiling. A
   table that only knew the soft number could not tell the difference between an
   image that will arrive smaller and an image that will not arrive.

   `hardMaxEdge: null` means the vendor documents NO reject threshold, which is
   a different statement from "we did not look".

   *** EVERY ROW MUST CARRY A CLAMP, AND THE NULLS ARE WHERE THAT WENT WRONG. ***
   This table shipped with `maxEdge: null, maxArea: null, hardMaxEdge: null` on
   the `openai` and `gemini` rows, on the reading that neither vendor published
   pixel geometry. fsAiFitDims turns each null into Infinity, so those two rows
   applied NO CLAMP AT ALL — a 16000x40000 stitched canvas came back out of the
   builder as a 16000x40000 image, scale 1, untiled — and the oversize gate,
   guarded by `if (P.hardMaxEdge > 0)`, skipped exactly the two rows that had
   nothing else protecting them. The protection covered Claude and was silent
   for the other two while reading, at every call site, as though it applied to
   all three. That is the same shape as claiming a redaction that did not run.

   Two things were wrong and only one of them was the code. Both vendors DO
   publish pixel geometry — OpenAI a 2048 px dimension limit beside its patch
   budget, Google a 3072x3072 resolution box — so the geometry columns were
   empty because nobody had re-read the source, not because the source was
   silent. What is genuinely absent from both is a REJECT threshold, and the
   lesson is that "documents no reject threshold" was allowed to be read as
   "documents no geometry". A row may have only a fit target. A row may not have
   neither: fsAiRowCeiling() below turns a row's columns into the one number
   every emission is graded against, it answers 0 for a row that declares
   nothing, and the gate REFUSES on 0 rather than waving the image through.
   Adding a fourth vendor without a clamp now fails a check instead of shipping.

   Rules are named by MECHANISM, never by vendor: products get renamed and
   merged, the arithmetic outlives the name, and a rule labelled with a company
   turns into a false claim about that company the first time it moves. The ROWS
   are named by vendor because the numbers in them are that vendor's numbers.

   *** THE PASTE PATH IS UNVERIFIED. *** Every number below is the documented
   API limit. What claude.ai, chatgpt.com and gemini.google.com do to an image
   dropped into their WEB UI has not been measured by anyone here — they may
   resize client-side long before an API ever sees it, in which case the safe
   row is stricter than it needs to be. That is the safe direction to be wrong
   in, and this table is deliberately the ONLY place the geometry lives, so the
   day somebody measures the paste path it is corrected here and nowhere else.

   TWO COLUMNS ARE RECORDED AND NOT ENFORCED, which is worth saying out loud
   rather than leaving a reader to assume the table is a contract:
     `manyImageMaxEdge` — the stricter per-image limit that applies once a
        single request carries more than 20 images. FullShot hands over ONE
        image, so it never applies here; it is kept because a sibling tool
        reading this table will batch, and because the day FullShot emits its
        tile set as separate images is the day it starts to bind.
     `maxBytes` — the per-image byte cap. Nothing checks it, because the byte
        count only exists after the PNG is encoded, in the caller. A 1568px
        image is normally well under 5 MB; a noisy one may not be. That is a
        real gap and it is a size question, not a geometry one.

   Nothing here is presented as exact. fsAiTokens() cannot return exact: true —
   there is no code path that sets it.

   THE MAINTENANCE CONTRACT, since it is the last thing read before the numbers:
   every row below is maintained by hand and is only as true as its `asOf`. When
   you touch a row, re-read its `source` that day, move `asOf`, and re-run
   test/aihandoff-sim — the vendors' own published examples are pinned there, so
   a transcription slip reddens instead of shipping. */
const FS_AI_DEFAULT_PROFILE = 'safe';
const FS_AI_PROFILES = {
  /* THE DEFAULT, and the reason the common case asks the user nothing: every
     column is the most restrictive value in the table below it, so an image
     that satisfies this row satisfies all three vendors at once. Its token rule
     is Claude's, stamped as such — the three arithmetics disagree by more than
     rounding (a 1092x1092 image is 1521 visual tokens to Claude, 1225 patches
     to OpenAI and 1032 to Gemini), so one number cannot be true for all three
     and pretending otherwise would be the same class of lie as a single
     dimension constant. The rule and the date travel beside the number. */
  safe: {
    maxEdge: 1568, maxArea: 1150000, minScale: 0.5,
    hardMaxEdge: 8000, maxBytes: 5 * 1024 * 1024,
    rule: 'patches-28', patchPx: 28, maxPatches: 1568,
    asOf: '2026-08', source: 'the three rows below, each at its most restrictive'
  },
  /* platform.claude.com/docs/en/build-with-claude/vision, read 2026-08.
     Reject: "The maximum dimensions per image are 8000x8000 px", and a request
     carrying more than 20 images drops that to 2000 px per side. Fit: the
     standard resolution tier resizes to a 1568 px long edge and a 1568 visual
     token budget (the high-resolution tier is 2576/4784 — the standard tier is
     used here because it is the one that binds on every model). Cost: one
     visual token per 28x28 patch. Bytes: 10 MB on the API and on claude.ai,
     5 MB on Bedrock and Vertex; the smaller is the one carried.
     maxArea is NOT the budget times the patch area: ceil() on both axes can add
     a whole row and column of patches, and 1150000 is the largest round area
     for which the fitted result still counts under 1568 tokens at every aspect
     ratio the stitcher produces. */
  claude: {
    maxEdge: 1568, maxArea: 1150000, minScale: 0.5,
    hardMaxEdge: 8000, manyImageMaxEdge: 2000, maxBytes: 5 * 1024 * 1024,
    rule: 'patches-28', patchPx: 28, maxPatches: 1568,
    asOf: '2026-08', source: 'platform.claude.com/docs/en/build-with-claude/vision'
  },
  /* developers.openai.com/api/docs/guides/images-vision, re-read 2026-08-13.
     TWO constraints, and the doc is explicit that they act together: "Some
     models tokenize images by covering them with 32px x 32px patches. Many
     model and detail-level combinations define a maximum patch budget", and
     "If either limit is exceeded, we resize the image while preserving aspect
     ratio to fit within the lesser of those two constraints for the selected
     detail level." The second of the two limits is a PIXEL-DIMENSION limit,
     2048 px at `detail: high`.
       maxEdge 2048 — that pixel-dimension limit. The tile-based models
     (GPT-4o, GPT-4.1, the o-series) reach the same number down a different
     path in the same document — "Scale to fit in a 2048px x 2048px square,
     maintaining original aspect ratio" — so 2048 is two independent readings
     agreeing rather than one sentence carrying the whole row.
       maxArea 1450000 — DERIVED, not published, and derived the same way the
     Claude row's area is: the largest round area for which the fitted result
     still counts under 1536 patches at every aspect ratio the stitcher can
     produce. Not 1536*32*32 = 1572864, because ceil() on both axes can add a
     whole row and column of patches; the true worst case at that area is 1620
     patches (833x1891), and 1450000 tops out at 1500. Swept exhaustively over
     every integer width up to maxEdge, not sampled.
       maxPatches 1536 — the smallest published budget (gpt-5.4-mini,
     gpt-5-mini, gpt-4.1-mini at `detail: high`). The larger models allow 2500,
     and gpt-5.5 at `detail: original` 10000, with gpt-5.6 at `original`
     documenting no finite budget at all; 1536 is the conservative reading and
     the only one that is true of every model in the family.
       hardMaxEdge null — genuinely absent, and that is now a claim about the
     document rather than an empty column: an image past either limit is
     RESIZED, never refused. maxBytes null for the same reason — what the doc
     publishes is "Up to 512 MB total payload size per request" and "Up to 1500
     individual image inputs per request", both request-level facts about a
     batch this product does not send. */
  openai: {
    maxEdge: 2048, maxArea: 1450000, minScale: 0.5,
    hardMaxEdge: null, maxBytes: null,
    rule: 'patches-32', patchPx: 32, maxPatches: 1536,
    asOf: '2026-08', source: 'developers.openai.com/api/docs/guides/images-vision'
  },
  /* ai.google.dev/gemini-api/docs/image-understanding, re-read 2026-08-13, and
     firebase.google.com/docs/ai-logic/analyze-images for the geometry — Google
     publishes the same API's limits across both, and the resolution box is
     stated on the second: "larger images are scaled down and padded to fit a
     maximum resolution of 3072 x 3072 while preserving their original aspect
     ratio". Cited from where it is actually written rather than from where a
     reader would expect it, because that gap is why this column was empty.
       maxEdge 3072 — that box. A fit target, not a reject: "scaled down and
     padded", so hardMaxEdge stays null and means it.
       maxArea null, and this one is a deliberate blank rather than an
     unfinished cell. Google publishes no area limit and no patch budget, and
     its token rule is ASPECT-DRIVEN, not area-driven: the crop unit is
     floor(min(w,h) / 1.5), so a square image is ceil(w/u) x ceil(h/u) = 2 x 2
     = 4 tiles at 3072 px exactly as at 300 px. An area column here would be a
     number invented to fill a column, which is the habit that produced the
     bug above. maxEdge is the clamp, and maxEdge alone bounds the area at
     3072^2 anyway.
       maxBytes null — "The total request size limit is 20 MB" is again a
     request-level fact, and it covers the prompt and the system instruction
     with the image.
       The cost rule: 258 tokens flat when both sides are <= 384 px; otherwise
     768x768 tiles at 258 tokens each, counted with the documented crop unit
     — their own worked example is 960x540 -> 3 x 2 = 6 tiles. That formula
     charges a tall strip heavily, which is a real property of the rule and not
     a mistake in transcribing it. */
  gemini: {
    maxEdge: 3072, maxArea: null, minScale: 0.5,
    hardMaxEdge: null, maxBytes: null,
    rule: 'tiles-768', tilePx: 768, perTile: 258, smallEdge: 384, cropDivisor: 1.5,
    asOf: '2026-08', source: 'ai.google.dev/gemini-api/docs/image-understanding'
  }
};

/* ---- the one number every emission is graded against ---------------------
   The largest long edge a row permits AT ALL, folding the two ceilings that
   mean different things into the single fact the gate needs: it does not
   matter to a wrong-sized image whether the consumer would have rejected it or
   merely thrown the extra pixels away — either way the clamp did not run.

   0 MEANS "THIS ROW DECLARES NO CLAMP", and returning 0 rather than Infinity is
   the whole point of the function. Infinity is the answer that made the
   original defect invisible: every `w > ceiling` comparison downstream is false
   against Infinity, so an unclamped row grades exactly like a clamped one. 0 is
   false to `> 0` and therefore has to be handled, which is how the gate below
   comes to refuse instead of pass.

   Pure and total. A row shape this function has never seen — a fourth vendor,
   a half-edited row, null, undefined — answers 0 and is refused, without anyone
   having anticipated its shape. */
function fsAiRowCeiling(row) {
  const r = row || {};
  const hard = r.hardMaxEdge > 0 ? r.hardMaxEdge : Infinity;
  const fit = r.maxEdge > 0 ? r.maxEdge : Infinity;
  const px = Math.min(hard, fit);
  return px === Infinity ? 0 : px;
}

/* Roles a payload can have. Extend by ADDING; never redefine one. */
const FS_AI_ROLES = ['image', 'text', 'legend'];

/* What the detector cannot find. Required in the payload, not just in the
   docs: a reader who is not told the limit trusts the mask further than it
   deserves. */
const FS_AI_NOT_COVERED = ['names', 'postal addresses', 'free-form secrets',
  'text drawn inside images, canvas or video'];

/* ============================================================================
   THE REDACTION CLAIM — REDACTION-CLAIM-SPEC.md §0, §2

   THE CLAIM MUST NOT BE LARGER THAN THE INSTRUMENT.

   Six rounds of fixes tried to say whether the PICTURE was clean by asking the
   DOM, and each was defeated by a page shape nobody had enumerated — the last
   of them being text split across inline element boundaries, which is not an
   exotic shape but every page on the web. The picture is produced by the
   compositor; the DOM is a different instrument that usually agrees with it and
   sometimes does not, and there is no finite list of the ways they diverge.

   SO THE STATE MACHINE IS GONE, NOT AMENDED. There is no `fsRedactionState`, no
   eight-state ladder, no `severity`, no `pixels`, and no sentence table keyed by
   any of them. What survives is the ACTS: three integers written by the lines of
   code that performed them, plus the two facts about the walk. Three numbers
   tell the story without anyone summarising them — 3/3/3, 3/2/2, 0/0/0 — and
   the summarising is left to the person, who can see the image.

   AND ALL THREE COUNT THE SAME THING, WHICH IS THE CORRECTION THIS FILE CARRIES.
   Reading 3/2/2 as "one match is not covered" is a SUBTRACTION, so the three
   numbers have to be in one unit or the reading is false. They were not: a block
   is one CLIENT RECT and a token that wraps across a line has two, so a card
   number breaking over a line reported 1 matched / 2 painted, and the surplus
   paid for a genuinely uncovered email elsewhere on the page — the alarm silent,
   the ledger a serene 2/2/2, the address legible in the delivered image. All
   three counters therefore count MATCHES. The blocks are still counted, by the
   bake ledger, under names that say `blocks`; they are what the outlines in the
   review dialog are drawn from, and they are never subtracted from a match.

     TWO NUMBERS MAY ONLY BE SUBTRACTED IF THEY COUNT THE SAME THING.

   TWO RULES KEEP IT REDUCED, and both are re-read by fsEnvelopeVerdict below
   rather than merely written down here:

     Rule 1 — no field whose value summarises the counters into a judgement.
     Rule 2 — THE ACTS BLOCK HOLDS NO WORDS. Every value in it is an integer, a
              boolean, `null`, or one member of the four-value `truncatedBy`
              enum, because A WORD IS WHERE A VERDICT HIDES.
   ========================================================================== */

/* v4 — INCOMPLETENESS IS DATA, NOT AN ABSENCE.
   Nine rounds of defects in this feature share one shape: something the
   pipeline gave up on was computed and then dropped, and a downstream consumer
   reasoned over a partial set believing it complete. A textSkipped counter read
   into a local and never used; a walk truncation never propagated; two `continue`
   statements discarding rectangles that existed because PII was found there; a
   roll-up grading a match against the blocks that survived a cap rather than the
   blocks it produced. Patching each instance produced the next instance.

   So the acts block now carries the giving-up as first-class values, and it
   keeps the REASONS apart, because a reader acts on them differently:

     matchedComplete   is `matched` the whole count, or did something stop it
     walkComplete      we stopped early …
     truncatedBy       … and which budget bounded us
     textRefused       LEAVES we refused item by item — over the per-leaf cap,
                       or a style or rect we could not read at all
     blocksLost        BLOCKS a match produced that the box cap never emitted
     blocksUnpainted   BLOCKS that arrived and were never drawn
     blocksUnread      BLOCKS that were drawn and never read back

   Two rules the additions obey. Every one is an integer or a boolean, so §0.1's
   Rule 2 holds and no word can hide here. And every name carries its UNIT, so
   §2.1's "two numbers may only be subtracted if they count the same thing"
   survives contact with five new counters. */
const FS_REDACT_ACTS_V = 4;

/* The one enum. `elements` and `time` are the walk's own budgets; `ceiling` is
   the box cap. `null` is the fourth value and it means the walk was not
   truncated — it is not the absence of an answer, which is what
   `ledger: "absent"` says. */
const FS_REDACT_TRUNCATED = ['elements', 'time', 'ceiling'];
const FS_REDACT_LEDGER = ['present', 'partial', 'absent'];

/* THE ALLOWLISTS, and they are allowlists rather than denylists on purpose. A
   denylist of four names is a list the next verdict simply avoids: it arrives
   called `reviewedByHuman`, or `coverage`, or `ok`. Declaring what may appear
   means a field nobody anticipated fails on the first bundle. */
const FS_REDACT_KEYS = ['requested', 'detector', 'acts', 'kinds', 'text',
  'markers', 'surfaces', 'notCovered'];
const FS_REDACT_ACT_KEYS = ['v', 'matched', 'painted', 'verifiedOpaque',
  'matchedComplete', 'walkComplete', 'truncatedBy',
  'textRefused', 'blocksLost', 'blocksUnpainted', 'blocksUnread', 'ledger'];

/* The four fields §2.2 removes, named so their reappearance at ANY depth is an
   immediate refusal rather than a review comment six months from now. */
const FS_VERDICT_KEYS = ['pixels', 'state', 'severity', 'evidence'];

/* EVERY BOOLEAN THE ENVELOPE IS ALLOWED TO CARRY, anywhere in it. This is Rule 2
   generalised past the acts block, and it is the part of the scan that is by
   SHAPE rather than by name: a boolean is the shortest possible verdict, so one
   that nobody declared is refused whatever it is called. `reviewedByHuman: true`
   fails here, and it fails wherever in the envelope it is placed. */
/* `requested` is on the list because it reports THE SETTING — what the user
   asked for — and not what became of the image. That distinction is the whole
   list: every name here is a fact about the tool's own configuration or about
   the arithmetic of the paste, and none of them is a summary of the acts. */
/* `matchedComplete` is admitted for the same reason `walkComplete` is: it
   reports whether an ACT was performed on everything the pass reached, and it
   is false-when-in-doubt. It is not a summary of the counters — it cannot be
   true and the picture still full of PII the detector does not look for, which
   §1's standing limits say in words the payload carries beside it. */
const FS_AI_BOOL_KEYS = ['requested', 'needsTiling', 'exact', 'inline',
  'conceals', 'walkComplete', 'matchedComplete'];

/* input: { scan, bake, legacy } — the scan ledger content/capture.js wrote at
   each act, and the bake ledger pages/result.js wrote at each fillRect and each
   read-back. Pure and total: a ledger of an unrecognised shape is NOT a ledger,
   and every counter it cannot supply is `null`, NEVER `0`. A zero is a
   measurement; this is the absence of one, and the difference is the whole
   reason the old design could print a confident number about a page it had
   never read.

   `legacy` is set by the store boundary translating a v2 record (§4): the
   surviving act fields are lifted, everything else is null, and the ledger says
   `partial` so nobody mistakes a lift for a reading. */
function fsRedactActs(input) {
  const i = input || {};
  const s = (i.scan && typeof i.scan === 'object' && i.scan.v === 2) ? i.scan : null;
  const b = (i.bake && typeof i.bake === 'object' && i.bake.v === 1) ? i.bake : null;
  const int = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v) : null;
  const tr = (s && s.truncated && typeof s.truncated === 'object') ? s.truncated : null;
  const dec = (s && s.declined && typeof s.declined === 'object') ? s.declined : null;
  const ledger = (!s && !b) ? 'absent' : (i.legacy || !s || !b) ? 'partial' : 'present';
  /* THE PER-ITEM REFUSALS, IN LEAVES, AND ONLY THE PER-ITEM ONES. `tooLong` is
     the per-leaf character cap and `unmeasurable` is a style or a rect that
     could not be read — both mean this leaf's text was NEVER HANDED TO THE
     DETECTOR, which is a different fact from "we stopped early" and is why it
     is not folded into `truncatedBy`. `declined.ceiling` belongs to the ceiling
     story and is deliberately left there; `declined.other` is a span the
     SECOND measurement could not hold, whose text was read and matched
     normally, so counting it here would say a leaf went unread that did not.
     Both parts must be integers: a ledger that cannot supply one cannot supply
     the sum, and a sum with a missing addend is exactly the kind of confident
     number this file exists to refuse. */
  const refusedParts = dec ? [int(dec.tooLong), int(dec.unmeasurable)] : null;
  const textRefused = (refusedParts && refusedParts.every(v => v !== null))
    ? refusedParts[0] + refusedParts[1] : null;
  const acts = {
    v: FS_REDACT_ACTS_V,
    /* Counted once PER MATCH, in content/capture.js, on the line after the
       detector returns. A match that produced no rectangle is still a match,
       which is what makes `painted < matched` arithmetic rather than judgement. */
    matched: s ? int(s.matched) : null,
    /* THE MATCH-UNIT COUNTERS, AND ONLY THOSE. `bake.painted` and
       `bake.verified` are still written and still correct — they count BLOCKS,
       one per client rect — and they are deliberately not read here: a block
       count in a field the renderer subtracts from `matched` is the defect this
       version exists to remove, and it would arrive silently. A ledger that
       cannot supply the match-unit roll-up supplies `null`, because a zero is a
       measurement and this is the absence of one. */
    painted: b ? int(b.matchesPainted) : null,
    verifiedOpaque: b ? int(b.matchesVerifiedOpaque) : null,
    /* THE COMPLETENESS THAT BELONGS TO `matched`, projected from the one value
       that carries it — the seal in content/capture.js, written from the facts
       recorded at each place the pass gave up. It is two fields here rather
       than one only because Rule 2 forbids an object in this block, and this is
       the single expression in the product where they can come apart: a ledger
       that supplies the count and not the flag answers `null`, which is "we
       cannot tell whether this number is whole" and never `true`. */
    matchedComplete: (s && int(s.matched) !== null &&
                      typeof s.matchedComplete === 'boolean') ? s.matchedComplete : null,
    walkComplete: s ? !!(tr && !tr.walk && !tr.time && !tr.ceiling && !tr.error &&
                         s.walksCompleted === s.walks) : null,
    /* Most-binding first. A pass that hit the box ceiling AND ran out of time
       reports the ceiling, because that is the one that bounded the result.
       `tr.error` names no budget — a subtree refused to enumerate, which is not
       a limit anybody set — so it leaves `walkComplete` false with nothing to
       blame it on, which is the honest pair for it. */
    truncatedBy: !tr ? null
      : tr.ceiling ? 'ceiling' : tr.time ? 'time' : tr.walk ? 'elements' : null,
    textRefused,
    /* THE THREE BLOCK-UNIT COUNTERS, NAMED SO NOBODY SUBTRACTS THEM FROM A
       MATCH COUNT (§2.1). Lost: produced by a match and never emitted, because
       the box cap filled. Unpainted: emitted and never drawn, because the frame
       it was measured in was not in this composition or it fell outside every
       segment. Unread: drawn and never read back, because the read-back's area
       budget refused it or getImageData threw. Three different acts, three
       different remedies, and a single flag standing for all three would tell a
       reader that something is uncovered without telling them what to do. */
    blocksLost: b ? int(b.blocksLost) : null,
    blocksUnpainted: b ? int(b.blocksUnpainted) : null,
    blocksUnread: b ? int(b.verifySkipped) : null,
    ledger
  };
  if (ledger === 'absent') {
    acts.matched = null; acts.painted = null; acts.verifiedOpaque = null;
    acts.matchedComplete = null; acts.walkComplete = null; acts.truncatedBy = null;
    acts.textRefused = null; acts.blocksLost = null;
    acts.blocksUnpainted = null; acts.blocksUnread = null;
  }
  return acts;
}

/* ---- the one subtraction in the design ----------------------------------
   HOW MANY MATCHES ARE NOT COVERED, in matches, or `null` where no honest
   subtraction can be made. Every renderer of §3.4's shortfall — the permanent
   line, the review dialog's first paragraph, and the emphasis on it — asks
   THIS function, because a sentence and the bolding of that sentence computed
   by two predicates is two predicates that will disagree, and they did: the
   text arm fired on `verifiedOpaque < painted` while the bold arm tested
   `painted < matched`, so the product's one bolded line was not bolded on the
   run that produced it.

   COVERED IS THE READ-BACK WHERE THERE IS ONE. `verifiedOpaque` is a re-read of
   the composed canvas and `painted` is a record of intent, so the artifact
   wins; `painted` is the fallback only for a record that carries no read-back
   at all. Both count matches (see fsRedactActs above).

   A NON-POSITIVE ANSWER MUST RENDER NOTHING. `covered` counts a subset of
   `matched`, so a covered count above it is not a smaller alarm — it is an
   arithmetic impossibility, and the honest rendering of an impossibility is
   silence. The product printed the alternative once: "Redaction matched 3 and
   covered 5. 0 matches are not covered in this image." — a safety verdict
   emitted by a bug, on the one line this design reserves for a real
   subtraction, in a product that had just deleted its verdicts. §0.1 forbids
   that sentence "however it is computed", and that one was computed.

   THE CLAMP STAYS EVEN THOUGH NO PIPELINE STILL PRODUCES THE SHAPE. It used to
   be justified by pages/db.js's §4 lift, which read a v2 ledger's BLOCK counters
   into these fields; that lift now reads match-unit names only and answers
   `null` twice for an old record, because a v2 ledger carries no per-match
   identity and there is nothing honest to recover one from. So the last
   in-product source of an impossible triple is gone — and this function is
   still handed acts by callers it does not control: a record on disk written by
   any build, and `redactActs` passed straight into fsAiBundle. A guard removed
   because the one caller that needed it was fixed is a guard the next caller
   does not have. What it must never do is print a reassurance. */
function fsRedactShortfall(acts) {
  const a = (acts && typeof acts === 'object') ? acts : null;
  if (!a) return null;
  const int = v => (typeof v === 'number' && isFinite(v) && Math.floor(v) === v) ? v : null;
  const matched = int(a.matched);
  if (matched === null) return null;
  const verified = int(a.verifiedOpaque), painted = int(a.painted);
  const covered = verified !== null ? verified : painted;
  if (covered === null) return null;
  const short = matched - covered;
  return short > 0 ? short : 0;
}

/* One acts value, graded by its own kind. Rule 2 with teeth: `ledger` and
   `truncatedBy` are the only two that may hold a string, and both are closed
   sets declared above. */
function fsRedactActValueOk(key, v) {
  if (key === 'v') return v === FS_REDACT_ACTS_V;
  if (key === 'ledger') return FS_REDACT_LEDGER.indexOf(v) >= 0;
  if (key === 'truncatedBy') return v === null || FS_REDACT_TRUNCATED.indexOf(v) >= 0;
  /* The two completeness flags, and they are the only booleans in the block:
     both answer "was this act performed on everything it could reach", both are
     `null` when the ledger cannot say, and neither summarises a counter. */
  if (key === 'walkComplete' || key === 'matchedComplete') return v === null || typeof v === 'boolean';
  return v === null || (typeof v === 'number' && isFinite(v) && Math.floor(v) === v);
}

/* THE SELF RE-READ (§5). Handed the envelope the builder is about to return, it
   walks the whole of it and reports every place a verdict could be hiding.
   Returns null for a clean envelope, or a comma-joined list of paths.

   Same doctrine as FS_ENVELOPE_UNREDACTED: GRADE THE OUTPUT. A rule written in a
   comment is a rule the next edit does not read; a rule that re-reads the result
   fails on the first bundle. */
function fsEnvelopeVerdict(env) {
  const bad = [];
  /* `scope` is what THIS object is: the redaction block, its acts block, or
     neither. It is deliberately not inherited — `kinds` is a histogram whose
     keys are pattern names, and an allowlist that descended into it would refuse
     `email`. */
  const walk = (node, path, scope, depth) => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (let n = 0; n < node.length; n++) walk(node[n], path + '[' + n + ']', null, depth + 1);
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      const p = path ? path + '.' + k : k;
      if (FS_VERDICT_KEYS.indexOf(k) >= 0) { bad.push(p + ' (removed field)'); continue; }
      if (typeof v === 'boolean' && FS_AI_BOOL_KEYS.indexOf(k) < 0) {
        bad.push(p + ' (undeclared boolean)'); continue;
      }
      if (scope === 'acts') {
        if (FS_REDACT_ACT_KEYS.indexOf(k) < 0) { bad.push(p + ' (not an act)'); continue; }
        if (!fsRedactActValueOk(k, v)) bad.push(p + ' (not an integer, boolean, null or enum)');
        continue;                       // acts values are scalars by construction
      }
      if (scope === 'redaction' && FS_REDACT_KEYS.indexOf(k) < 0) {
        bad.push(p + ' (not a declared redaction field)'); continue;
      }
      walk(v, p, (scope === 'redaction' && k === 'acts') ? 'acts'
               : (k === 'redaction') ? 'redaction' : null, depth + 1);
    }
  };
  walk(env, '', null, 0);
  return bad.length ? bad.join(', ') : null;
}

/* ---- the detector -------------------------------------------------------
   These five patterns are a VERBATIM COPY of content/capture.js's fsPiiMatches
   — the pass that decides where the opaque blocks go. The copy exists because
   the two live in different worlds: the boxes are computed in a content script
   that a page cannot reach, and the text has to be masked on the page side.

   Two copies that "agree" are two copies that will disagree after the next
   edit to one of them, so they are not trusted to agree: test/aihandoff-sim
   extracts the five push() lines from both files and compares them. Edit one
   without the other and that check reddens. */
function fsAiLuhnOk(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

/* All PII matches in a string as {start,end,kind} char spans. Overlapping
   spans (an SSN that also matches the phone shape) merge to one, earliest and
   longest first — the same merge capture.js performs so one token cannot
   produce two markers. */
function fsAiPiiSpans(s) {
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
  push(/\d(?:[ -]?\d){12,18}/g, 'card', t => { const d = t.replace(/[ -]/g, ''); return d.length >= 13 && d.length <= 19 && fsAiLuhnOk(d); });
  push(/\+?\d[\d().\-\s]{5,}\d/g, 'phone', t => { const d = t.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 && /[+().\-\s]/.test(t); });
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let lastEnd = -1;
  for (const m of raw) { if (m.start >= lastEnd) { out.push(m); lastEnd = m.end; } }
  return out;
}

/* Replace each span with its KIND, never with a fixed-width blob. "[email]"
   lets a model reason about the field and lets a future search index find the
   record; "████" throws away the one thing that was safe to keep. */
function fsAiMaskText(s) {
  const str = s == null ? '' : String(s);
  const spans = fsAiPiiSpans(str);
  if (!spans.length) return { text: str, kinds: {} };
  const kinds = {};
  let out = '', last = 0;
  for (const m of spans) {
    out += str.slice(last, m.start) + '[' + m.kind + ']';
    kinds[m.kind] = (kinds[m.kind] || 0) + 1;
    last = m.end;
  }
  return { text: out + str.slice(last), kinds };
}

/* ---- the fit ------------------------------------------------------------
   TWO criteria, and the binding one wins. The long edge is the one that was
   missing: area alone lets a 1280x15000 strip through untouched — 19.2 MP is
   under every area threshold in use — and then something downstream squashes
   it without telling anyone.

   The two clamps are INDEPENDENT — each is computed from the original size, so
   the result is min(maxEdge/edge, sqrt(maxArea/area)) whichever way round they
   are written, and the order below is not load-bearing. That is worth saying
   plainly: the teeth pass for this file swapped the two statements expecting a
   check to redden, nothing did, and an ordering claim nobody can violate is a
   comment that lies. What IS load-bearing is that the edge criterion exists.

   Below minScale the answer is tiles, not a squash: the returned w/h are the
   floored size and needsTiling says the caller must not use them as one image.
   AI-HANDOFF-ENVELOPE.md §6.

   THE HARD CEILING FOLDS INTO THE EDGE CRITERION rather than becoming a third
   one, and that is deliberate. `hardMaxEdge` is a reject threshold, not a
   preference, so the honest way to spend it is to make it impossible to exceed:
   every path through this function is already bounded by maxEdge, so clamping
   maxEdge to the smaller of the two at the door means no caller — present or
   future, correct or careless — can produce a size above the ceiling. It also
   leaves `limitedBy` as the two documented values; a third member would be a
   new enum member in a shipped payload, which §2 makes an additive version
   change, and this is the same fact expressed in the existing vocabulary. */
function fsAiFitDims(w, h, opts) {
  const o = opts || {};
  const hardMaxEdge = o.hardMaxEdge > 0 ? o.hardMaxEdge : Infinity;
  const maxEdge = Math.min(o.maxEdge > 0 ? o.maxEdge : Infinity, hardMaxEdge);
  const maxArea = o.maxArea > 0 ? o.maxArea : Infinity;
  const minScale = o.minScale == null ? 0.5 : o.minScale;
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  let scale = 1, limitedBy = null;
  const edge = Math.max(W, H);
  if (edge > maxEdge) { scale = maxEdge / edge; limitedBy = 'edge'; }
  if (W * H * scale * scale > maxArea) { scale = Math.sqrt(maxArea / (W * H)); limitedBy = 'area'; }
  let needsTiling = false;
  if (scale < minScale) { needsTiling = true; scale = minScale; }
  if (scale >= 1) return { w: W, h: H, scale: 1, limitedBy: null, needsTiling: false };
  return {
    w: Math.max(1, Math.round(W * scale)), h: Math.max(1, Math.round(H * scale)),
    scale, limitedBy, needsTiling
  };
}

/* Two significant figures. A precise-looking number from an imprecise rule is
   a lie told by formatting. */
function fsAiRound2(n) {
  if (!(n > 0)) return 0;
  if (n < 100) return Math.round(n);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

/* THE ARITHMETIC ITSELF, unrounded, one branch per documented mechanism.
   It is separate from fsAiTokens() for one reason: the rounded number is for a
   person, and a person's number cannot be compared against a vendor's published
   table — 1296 and 1300 are the same answer to a reader and different answers
   to a check. This is the function test/aihandoff-sim pins against the four
   rows of Anthropic's own token table and against Google's own worked example,
   which is the only way a transcription error in the table above gets caught.

   Both patch rules CAP at the budget, because both vendors document that an
   image over the budget is downscaled to it rather than charged for in full.
   Uncapped, a 3840x2160 screenshot would be quoted at 10764 tokens when the
   consumer will charge 1568 — an estimate seven times too high is as useless as
   one seven times too low, and it is the direction that stops a user pasting
   something that would in fact have been cheap. */
function fsAiTokenCount(w, h, profile) {
  const p = FS_AI_PROFILES[profile] || FS_AI_PROFILES[FS_AI_DEFAULT_PROFILE];
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (p.rule === 'tiles-768') {
    if (W <= p.smallEdge && H <= p.smallEdge) return p.perTile;
    /* The published crop unit, verbatim: floor(min(w,h) / 1.5), then each axis
       divided by it. Not w*h/(768*768) — that is the tidier arithmetic and it
       is not the one that is charged. */
    const unit = Math.max(1, Math.floor(Math.min(W, H) / p.cropDivisor));
    return p.perTile * Math.ceil(W / unit) * Math.ceil(H / unit);
  }
  const n = Math.ceil(W / p.patchPx) * Math.ceil(H / p.patchPx);
  return p.maxPatches > 0 ? Math.min(n, p.maxPatches) : n;
}

/* An estimate, stamped with the rule that produced it and the month a human
   last checked that rule. Never exact. AI-HANDOFF-ENVELOPE.md §8. */
function fsAiTokens(w, h, profile) {
  const p = FS_AI_PROFILES[profile] || FS_AI_PROFILES[FS_AI_DEFAULT_PROFILE];
  return { estimate: fsAiRound2(fsAiTokenCount(w, h, profile)),
           rule: p.rule, asOf: p.asOf, exact: false };
}

/* ---- tiles --------------------------------------------------------------
   Cuts move to a section top when one is in range, so a tile starts where the
   page starts a section instead of mid-paragraph; `cutOn` records which
   happened so the choice is auditable. Consecutive tiles share `overlapPx`
   rows — a line cut at a boundary appears whole in one of the two — and
   `overlapPx` is what THIS tile repeats from the one before it, 0 for the
   first. minTile stops a cut from being moved so far back that the tile
   becomes a sliver; it does NOT constrain the final remainder, which is
   whatever is left of the page. AI-HANDOFF-ENVELOPE.md §7.

   THE HORIZONTAL AXIS IS A LIMIT TOO, AND IT WAS NOT BEING APPLIED.
   A tile row is a full-width band of the capture, so the plan for a 3200px-wide
   page described 3200px-wide images and the plan for a page at the stitcher's
   own 16000px ceiling described 16000px-wide images — over Claude's documented
   8000px reject threshold, and therefore a set of pieces that cannot be sent at
   all. The cuts were the only thing this function reasoned about; the width was
   simply inherited. It now returns the SCALE its pieces are meant to be
   rendered at, together with the rendered tile size, and the stride is measured
   in source pixels so that the tile is legal AFTER that scale rather than
   before it. The rows themselves stay in source coordinates, exactly as §7
   defines them — the geometry is the renderer's business and the coordinates
   are the consumer's, and mixing the two is how a cut ends up in the wrong
   place.

   A tile is an image, so a tile obeys §6: it is bounded by maxEdge on both
   axes AND by maxArea, rather than only by the long edge. A piece the consumer
   is going to downscale on arrival is bytes spent to be thrown away, and its
   share of the token estimate would be wrong in the bargain. */
function fsAiPlanTiles(o) {
  const w = Math.max(1, Math.round(o.w)), h = Math.max(1, Math.round(o.h));
  const hardMaxEdge = o.hardMaxEdge > 0 ? Math.round(o.hardMaxEdge) : Infinity;
  const maxEdge = Math.min(o.maxEdge > 0 ? Math.round(o.maxEdge) : Infinity, hardMaxEdge);
  const maxArea = o.maxArea > 0 ? o.maxArea : Infinity;
  const overlap = o.overlap > 0 ? Math.round(o.overlap) : 0;
  const breaks = Array.isArray(o.breakYs) ? o.breakYs.slice().sort((a, b) => a - b) : null;
  /* Never an upscale: a capture narrower than the limit is rendered at 1:1. */
  const scale = Math.min(1, maxEdge / w);
  const tileW = Math.max(1, Math.round(w * scale));
  const tileH = Math.max(1, Math.min(maxEdge, Math.floor(maxArea / tileW)));
  const stride = Math.min(Math.max(1, Math.floor(tileH / scale)), h);
  const minTile = o.minTile > 0 ? Math.round(o.minTile) : Math.floor(stride / 2);
  const tiles = [];
  let from = 0, guard = 0;
  while (from < h && guard++ < 10000) {
    const target = Math.min(from + stride, h);
    let to = target, cutOn = 'stride';
    if (to < h && breaks) {
      let best = 0;
      for (const y of breaks) if (y > from + minTile && y <= target && y > best) best = y;
      if (best) { to = best; cutOn = 'break'; }
    }
    if (to >= h) { to = h; cutOn = 'end'; }
    tiles.push({
      index: tiles.length + 1, count: 0,
      fromY: from, toY: to, overlapPx: from === 0 ? 0 : overlap, cutOn
    });
    if (to >= h) break;
    from = Math.max(0, to - overlap);
  }
  for (const t of tiles) t.count = tiles.length;
  /* One image is all a clipboard holds, so the plan owes it an overview: the
     whole thing fitted PAST the floor. It answers "what is this?" while the
     tiles answer "what does it say?". */
  const overview = fsAiFitDims(w, h, { maxEdge, maxArea, minScale: 0 });
  /* scale/tileW/tileH are for whoever RENDERS the plan and are deliberately not
     put in the envelope: §7 fixes the row shape, and adding a key to a shipped
     payload is an additive version change rather than a bug fix. A consumer
     reads the cuts; a producer reads the geometry. */
  return { tiles, overview, overlapPx: overlap, scale, tileW, tileH };
}

/* ---- the legend ---------------------------------------------------------
   An arrow in a screenshot means nothing to a model; this is the sentence the
   arrow was standing in for.

   PERCENTAGES, NOT PIXELS. The image is fitted, tiled and cropped between the
   editor and the model, and a pixel coordinate is wrong after any of those
   three. One decimal place is plenty. AI-HANDOFF-ENVELOPE.md §10. */
function fsAiLegend(objects, dims, textLayer, mask) {
  const list = Array.isArray(objects) ? objects : [];
  const W = Math.max(1, (dims && dims.w) || 1), H = Math.max(1, (dims && dims.h) || 1);
  const pct = v => Math.round(v * 1000) / 10;
  const at = (x, y) => ({ xPct: pct(x / W), yPct: pct(y / H) });
  const take = s => (typeof mask === 'function' ? mask(s) : String(s == null ? '' : s));
  /* Near-enough to be about the same line, and no further: a label attached to
     text a third of a page away is worse than no label. */
  const reach = Math.max(24, H * 0.03);
  const near = y => {
    if (!Array.isArray(textLayer) || !textLayer.length) return null;
    let best = null, bestD = Infinity;
    for (const t of textLayer) {
      const d = Math.abs((t.y || 0) - y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best && bestD <= reach ? take(best.text) : null;
  };
  const out = [];
  list.forEach((o, i) => {
    const row = { id: i + 1, kind: o.type };
    let anchorY = 0;
    if (o.type === 'arrow' || o.type === 'line') {
      row.from = at(o.x1, o.y1); row.at = at(o.x2, o.y2); anchorY = o.y2;
    } else if (o.type === 'pen' || o.type === 'hl') {
      const pts = o.points || [];
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
      const x1 = Math.max.apply(null, xs), y1 = Math.max.apply(null, ys);
      row.from = at(pts.length ? pts[0].x : 0, pts.length ? pts[0].y : 0);
      row.at = at(pts.length ? pts[pts.length - 1].x : 0, pts.length ? pts[pts.length - 1].y : 0);
      row.box = { xPct: pct(x0 / W), yPct: pct(y0 / H), wPct: pct((x1 - x0) / W), hPct: pct((y1 - y0) / H) };
      anchorY = (y0 + y1) / 2;
    } else if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'blur') {
      row.box = { xPct: pct(o.x / W), yPct: pct(o.y / H), wPct: pct(o.w / W), hPct: pct(o.h / H) };
      row.at = at(o.x + o.w / 2, o.y + o.h / 2);
      anchorY = o.y + o.h / 2;
      /* A concealing mark declares itself. A model told the region is
         deliberately hidden stops trying to read the smear as data. */
      if (o.type === 'blur') row.conceals = true;
    } else {
      row.at = at(o.x, o.y); anchorY = o.y;
      if (o.type === 'text') row.label = take(o.text);
      else if (o.type === 'num') row.label = String(o.n);
      else if (o.type === 'emoji') row.label = String(o.char == null ? '' : o.char);
    }
    const n = near(anchorY);
    if (n) row.near = n;         // absent, not null, when there is nothing to say
    out.push(row);
  });
  return out;
}

/* ---- the bundle ---------------------------------------------------------
   ONE function assembles every text-bearing part of the envelope, because a
   second one is how the mask gets skipped. Every foreign string — anything
   that came from the captured page or from the user — enters through
   takeText(), which masks it when redaction is on and records it either way.

   INV-R (AI-HANDOFF-ENVELOPE.md §5): a text sidecar carrying the PII the image
   blacks out is worse than no redaction, because the user believes they are
   protected. The gate below therefore grades the OUTPUT, not the path: after
   everything is assembled it re-reads what it is about to hand over and throws
   rather than emit a bundle that claims a protection it does not have. A
   missing call site cannot talk its way past a re-read.

   Refuse, do not degrade. Emitting the image alone would be a silent half —
   the user asked for a hand-off and would get one, with no way to tell. */
function fsAiBundle(input) {
  const i = input || {};
  const subject = i.subject || {};
  /* THE ONLY THREE ANSWERS. `true` = the user asked for redaction, `false` =
     they did not, `null` = this record cannot say (REDACTION-CLAIM-SPEC.md §4).
     Anything else is `null`, which gates and masks — "we cannot tell" resolves
     toward showing the person the picture, because the opposite default costs
     them their data. */
  const requested = i.redactRequested === true ? true
    : i.redactRequested === false ? false : null;
  /* `null` masks for the same reason: over-masking costs a date in a URL coming
     back as a marker, and the opposite mistake costs the user their data. */
  const redacting = requested !== false;

  /* THE REVIEW PRECONDITION, AT THE PRODUCER (§3.5). Not at the Copy button:
     a call site added next year cannot talk its way past a re-read, which is
     the same doctrine as the two gates at the bottom of this function. It is
     checked FIRST because everything below it is work spent on a bundle that
     must not be emitted.

     `reviewed` is a PRECONDITION AND NEVER A PAYLOAD. It does not appear in the
     envelope, in the text, or on the record — a consumer reading
     `reviewedByHuman: true` summarises it as APPROVED, and a human's "I looked"
     laundered into machine-readable assurance is the same verdict this design
     removes, wearing a person as a costume. fsEnvelopeVerdict refuses it. */
  if (requested !== false && i.reviewed !== true) {
    throw new Error('FS_ENVELOPE_UNREVIEWED');
  }
  const kinds = {};
  const carried = [];
  function takeText(s) {
    const str = s == null ? '' : String(s);
    if (!str) return '';
    /* textAlreadyMasked is a claim by a caller that masked earlier (the right
       place is the process that read the string). It is TRUSTED here and
       VERIFIED by the gate — which is the only order that catches a lie. */
    if (!redacting || i.textAlreadyMasked) { carried.push(str); return str; }
    const m = fsAiMaskText(str);
    for (const k of Object.keys(m.kinds)) kinds[k] = (kinds[k] || 0) + m.kinds[k];
    carried.push(m.text);
    return m.text;
  }

  const profileName = FS_AI_PROFILES[i.profile] ? i.profile : FS_AI_DEFAULT_PROFILE;
  const P = FS_AI_PROFILES[profileName];
  const src = subject.image || subject.content || { w: 1, h: 1 };
  const part = i.part || null;
  const partH = part ? Math.max(1, part.toY - part.fromY) : src.h;
  const fitSrc = { w: src.w, h: partH };
  let fit = fsAiFitDims(fitSrc.w, fitSrc.h, P);
  let plan = null;
  if (fit.needsTiling) {
    plan = fsAiPlanTiles({ w: fitSrc.w, h: fitSrc.h, maxEdge: P.maxEdge, maxArea: P.maxArea,
                           hardMaxEdge: P.hardMaxEdge,
                           overlap: i.overlap == null ? 64 : i.overlap, breakYs: i.breakYs });
    /* The one image a clipboard can hold is the overview, so THAT is what the
       budget must quote. Quoting the un-tileable floored size would be a
       number for an image nobody is going to paste. */
    fit = { w: plan.overview.w, h: plan.overview.h, scale: plan.overview.scale,
            limitedBy: plan.overview.limitedBy, needsTiling: true };
  }
  const tokens = fsAiTokens(fit.w, fit.h, profileName);

  const contents = [{
    path: 'image/page-1.png', role: 'image', type: 'image/png',
    w: fit.w, h: fit.h, scale: Math.round(fit.scale * 1e4) / 1e4,
    index: part ? part.index : 1, count: part ? part.count : 1,
    fromY: part ? part.fromY : 0, toY: part ? part.toY : src.h, overlapPx: 0
  }];

  /* The context block is ALWAYS a payload, and it is always a text one. It is
     most of the envelope's value for a tenth of its work, and — the part that
     is easy to miss — it carries the URL and the title, which is text that can
     carry PII whether or not a page-text sidecar was ever produced. A producer
     with no text layer at all still has a text surface to protect. */
  contents.push({ path: 'text/context.md', role: 'text', type: 'text/markdown', chars: 0 });

  const legend = i.annotations && i.annotations.length
    ? fsAiLegend(i.annotations, { w: src.w, h: src.h }, i.pageText, takeText) : null;
  if (legend && legend.length) {
    contents.push({ path: 'legend/annotations.json', role: 'legend',
      type: 'application/json', count: legend.length, inline: true });
  }

  const body = [];
  if (Array.isArray(i.pageText)) {
    for (const e of i.pageText) {
      const t = takeText(e && e.text);
      if (!t) continue;
      const href = e && e.href ? takeText(e.href) : '';
      body.push(e && e.kind === 'heading' ? '## ' + t
        : e && e.kind === 'item' ? '- ' + t
        : href ? '[' + t + '](' + href + ')' : t);
    }
  }

  const notes = (Array.isArray(i.notes) ? i.notes : []).map(takeText).filter(Boolean);

  /* WHAT WAS DONE TO THE IMAGE, IN WORDS, FOR THE READER WHO HAS ONLY THIS.
     `budget` already carries the numbers, and a number is not a statement: a
     consumer that reads `scale: 0.13` has to infer that the text is illegible,
     and a person reading the payload has to infer it twice. The two situations
     are also easy to confuse with each other, so they get different sentences —
     "smaller" and "too small to read" are not the same news.

     These are OURS, not foreign, so they bypass takeText() rather than being
     masked and re-read: they are built from integers this function computed a
     dozen lines ago, and the gate exists to grade text that came from a captured
     page. Nothing here can carry a secret unless a screenshot's WIDTH is one.
     (They also must not go through the mask: "1280x18750" is close enough to
     the phone shape that a future loosening of that pattern would start
     redacting our own arithmetic.) */
  const fitNote = [];
  if (plan) {
    fitNote.push('This image is an OVERVIEW, not the readable page: the capture is ' +
      fitSrc.w + 'x' + fitSrc.h + ' px and cannot be shown as one image at a scale its text ' +
      'survives. The whole capture is ' + plan.tiles.length + ' tiles of ' +
      plan.tileW + 'x' + plan.tileH + ' px with ' + plan.overlapPx +
      ' px of overlap; `tiles` lists where each one starts and ends.');
  } else if (fit.scale < 1) {
    fitNote.push('Downscaled from ' + fitSrc.w + 'x' + fitSrc.h + ' to ' + fit.w + 'x' + fit.h +
      ' px (limited by ' + fit.limitedBy + ') to stay inside the documented image limits.');
  }
  /* Said on every bundle, including the untouched one, because the claim being
     made is about the LIMITS and not about this image. A reader who is told the
     numbers and not told where they came from will assume they were measured.

     BUILT FROM THE CEILING, AND THE REJECT CLAUSE ONLY WHERE THERE IS ONE. The
     previous version interpolated the columns raw, so the two rows with null
     geometry emitted, verbatim, "at most null px on the long edge, rejected
     outright above null px" — a limit claim that cannot be true, printing a
     JavaScript value's name at a person, in the one artefact a model reads.
     The absence of a reject threshold is stated POSITIVELY rather than by
     omission: a reader given a fit target and nothing else assumes there is a
     cliff past it, and for these two vendors there is not. */
  fitNote.push('Image limits are the documented API limits for ' + P.source +
    ' (read ' + P.asOf + '), profile "' + profileName + '": at most ' +
    fsAiRowCeiling(P) + ' px on the long edge, ' +
    (P.hardMaxEdge > 0
      ? 'and rejected outright above ' + P.hardMaxEdge + ' px'
      : 'and no reject threshold is documented for it — an oversized image is ' +
        'downscaled on arrival rather than refused') +
    '. What a web chat UI does to a PASTED image is unverified: it may ' +
    'resize before any API sees it.');
  for (const s of fitNote) notes.push(s);

  const env = {
    envelope: FS_AI_ENVELOPE,
    id: String(i.id || (subject.id || 'bundle') + '-' + (i.now || Date.now())),
    createdAt: new Date(i.now || Date.now()).toISOString(),
    producer: {
      tool: (i.producer && i.producer.tool) || 'unknown',
      version: String((i.producer && i.producer.version) || '0'),
      surface: (i.producer && i.producer.surface) || 'unknown'
    },
    subject: {
      kind: subject.kind || 'web-page',
      mode: subject.mode || 'unknown',
      url: takeText(subject.url),
      title: takeText(subject.title),
      capturedAt: subject.capturedAt || null,
      viewport: subject.viewport || null,
      content: subject.content || null,
      image: subject.image || null
    },
    contents,
    redaction: {
      requested,
      detector: 'fullshot/pii-regex@1',
      /* THE ACTS, and nothing that summarises them. Built by fsRedactActs from
         the two ledgers, each counter written by the line that performed the
         act it counts. A consumer that wants to know whether the image is clean
         has to look at the image; this block says only what was done. */
      acts: i.redactActs || (requested === false ? fsRedactActs(null) : null),
      /* A statement about THE BUNDLE'S OWN TEXT PAYLOAD, not about the image,
         and the one word left in the block — because FS_ENVELOPE_UNREDACTED
         re-reads every carried string before this is allowed to be emitted. */
      text: redacting ? 'masked' : 'none',
      surfaces: redacting
        ? contents.map(r => r.role).filter((r, n, a) => a.indexOf(r) === n).concat(['envelope'])
        : [],
      kinds: Object.assign({}, i.pixelKinds || {}, kinds),
      markers: ['[email]', '[phone]', '[card]', '[ssn]', '[token]'],
      notCovered: FS_AI_NOT_COVERED.slice()
    },
    budget: {
      source: { w: src.w, h: partH },
      fit: { w: fit.w, h: fit.h, scale: Math.round(fit.scale * 1e4) / 1e4,
             limitedBy: fit.limitedBy || null, needsTiling: !!fit.needsTiling },
      tokens, profile: profileName
    },
    notes
  };
  if (legend && legend.length) env.legend = legend;
  if (plan) env.tiles = { count: plan.tiles.length, overlapPx: plan.overlapPx, rows: plan.tiles };

  const text = fsAiText(env, { part, body });
  for (const row of contents) if (row.role === 'text') row.chars = text.length;

  /* THE GATE. Everything foreign that this bundle is about to hand over, read
     back one more time. Not the serialized JSON — an ISO date is phone-shaped
     and would throw on every bundle — only the strings that came from outside,
     each recorded by takeText() as it went in. */
  if (redacting) {
    for (const s of carried) {
      if (fsAiPiiSpans(s).length) {
        throw new Error('FS_ENVELOPE_UNREDACTED');
      }
    }
  }

  /* THE SECOND GATE, and the same doctrine as the first: grade the OUTPUT.
     Everything above is supposed to make an oversized emission impossible — the
     hard ceiling folds into maxEdge in both fsAiFitDims and fsAiPlanTiles — so
     this can only fire if somebody edits the table into an inconsistent state
     (a maxEdge above a hardMaxEdge, a row with a reject threshold and no fit
     target). That is exactly the edit this catches. A structural guarantee
     nobody re-reads is a comment; a re-read is a guarantee.

     REFUSE, DO NOT DEGRADE, and refuse for the same reason INV-R does. Silently
     shipping an image the consumer will reject with a validation error spends
     the user's paste and gives them an error message from someone else's
     product about a file they did not know had been resized.

     THE GUARD IS THE ROW'S CEILING, NOT ITS REJECT THRESHOLD, and that
     distinction is the defect this gate was rebuilt for. `if (P.hardMaxEdge > 0)`
     read like a null-check and behaved like an exemption: two of the four rows
     document no reject threshold, so the gate did not run for them at all — the
     two rows that also had no fit target, and therefore the only two that
     needed re-reading. A guard that switches itself off for exactly the rows
     with nothing else protecting them is worse than no guard, because every
     call site above it reads as though the guard applied.

     A row that declares no ceiling is refused OUTRIGHT, before any comparison.
     There is no honest emission from such a row: the builder cannot say what
     was done to the image, so it must not hand one over. That is the branch
     that makes a fourth vendor added without a clamp fail loudly on its first
     bundle instead of quietly emitting a 16000 px image. */
  {
    const ceiling = fsAiRowCeiling(P);
    if (!(ceiling > 0)) throw new Error('FS_ENVELOPE_NOCLAMP');
    const over = [];
    for (const row of contents) {
      if (row.role === 'image' && (row.w > ceiling || row.h > ceiling)) {
        over.push(row.path + ' ' + row.w + 'x' + row.h);
      }
    }
    if (plan && (plan.tileW > ceiling || plan.tileH > ceiling)) {
      over.push('tile ' + plan.tileW + 'x' + plan.tileH);
    }
    if (over.length) throw new Error('FS_ENVELOPE_OVERSIZE');
  }

  /* THE THIRD GATE — REDACTION-CLAIM-SPEC.md §5. Same doctrine as the two
     above: grade the OUTPUT, refuse, do not degrade.

     It no longer grades a CLAIM against its evidence, because there is no claim
     left to grade. What it grades is that the acts block EXISTS whenever the
     user asked for redaction, and that a block which says it has no ledger is
     not carrying a counter beside that admission — a number next to "absent" is
     a measurement that nobody made. */
  if (requested !== false) {
    const a = env.redaction.acts;
    if (!a || typeof a !== 'object') throw new Error('FS_ENVELOPE_NOEVIDENCE');
    if (a.ledger === 'absent') {
      /* Every counter, including the five v4 added: a block count beside "no
         ledger" is a measurement nobody made, and it does not become less of
         one for being a count of what went wrong. `!= null` rather than
         `!== null` so a record written before those fields existed reads as
         the absence it is rather than as a violation. */
      for (const k of ['matched', 'painted', 'verifiedOpaque', 'matchedComplete',
                       'walkComplete', 'truncatedBy', 'textRefused', 'blocksLost',
                       'blocksUnpainted', 'blocksUnread']) {
        if (a[k] != null) throw new Error('FS_ENVELOPE_NOEVIDENCE');
      }
    }
  }

  /* THE FOURTH GATE — §5's FS_ENVELOPE_VERDICT, which is §0.1's two rules with
     teeth. The builder re-reads its own output, so reintroducing the verdict in
     a new costume fails on the FIRST bundle rather than in a review six months
     from now. It is deliberately the last gate: it grades the finished object,
     including anything a caller managed to inject through `redactActs`. */
  {
    const leak = fsEnvelopeVerdict(env);
    if (leak) throw new Error('FS_ENVELOPE_VERDICT');
  }
  return { envelope: env, text };
}

/* The text payload. Markdown, addressed to a model rather than to a person,
   and DELIBERATELY NOT LOCALISED: it must read the same in every locale so a
   bundle produced in one country parses in another. Translating "Source:"
   would be the same class of mistake as translating a filename template. The
   UI chrome around it is localised as normal; the payload is not.
   AI-HANDOFF-ENVELOPE.md §4. */
function fsAiText(env, extra) {
  const x = extra || {};
  const s = env.subject, b = env.budget, r = env.redaction;
  /* THE PAYLOAD'S OWN VOCABULARY IS ASCII. Not decoration: "1280×3000" written
     with U+00D7 is a bidi-weak run, and the isolate characters that fix it on
     a page (fsDims, above) would be invisible junk inside a file a model reads
     and a JSON manifest a script greps. Keeping the frame to ASCII removes the
     hazard instead of papering over it — and it is the reason the shared
     "no page builds a bare W x H pair" check does not fire on this function.
     Text that came FROM the page keeps whatever script it was written in; it
     is the user's own text and travels verbatim. */
  const dim = (o, unit) => o ? o.w + 'x' + o.h + (unit ? ' ' + unit : '') : 'unknown';
  const L = ['# Screenshot context', ''];
  L.push('- Source: ' + (s.url || 'unknown'));
  L.push('- Title: ' + (s.title || 'untitled'));
  L.push('- Captured: ' + (s.capturedAt || 'unknown'));
  L.push('- Mode: ' + s.mode);
  if (s.viewport) L.push('- Viewport: ' + dim(s.viewport, 'px') + ' at ' + (s.viewport.dpr || 1) + ' dpr');
  if (s.content) L.push('- Page content: ' + dim(s.content, 'px'));
  if (s.image) L.push('- Full image: ' + dim(s.image, 'px'));
  if (x.part) {
    L.push('- Part: ' + x.part.index + ' of ' + x.part.count +
           ' (rows ' + x.part.fromY + '-' + x.part.toY + ' of ' + (s.image ? s.image.h : '?') + ')');
  }
  /* REDACTION-CLAIM-SPEC.md §2.3 — the acts, stated, and then the limit of the
     instrument, stated as a CONSTANT. Nothing here summarises the three numbers,
     because the summary is the verdict this design removes. */
  const kinds = Object.keys(r.kinds || {}).map(k => k + ' ' + r.kinds[k]).join(', ');
  const a = r.acts || {};
  if (r.requested === false) {
    L.push('- Redaction: not requested; text ' + r.text + '.');
  } else if (a.ledger === 'absent') {
    L.push('- Redaction: no record of a redaction pass on this capture; text ' + r.text + '.');
  } else {
    /* `??` is not available in this file's dialect and a `|| 0` would turn the
       absence of a measurement into a measurement, so a null counter is printed
       as the word "unknown" — outside the acts block, in prose, where §0.1's
       Rule 2 does not reach and where a reader needs to be able to tell a zero
       from a blank. */
    const n = v => (typeof v === 'number' ? String(v) : 'unknown');
    /* "OF THEM", not "blocks": all three numbers count MATCHES, and one match
       can need several blocks — a token that wraps across a line gets one per
       client rect. This line used to read "3 blocks painted" beside "3 matched",
       inviting exactly the subtraction the two units do not support, and a
       consumer performing it on a wrapped token would read one too many
       covered. Two words, and the reading is pinned to one unit. */
    /* THE COUNT AND ITS COMPLETENESS TRAVEL TOGETHER HERE TOO. A consumer that
       reads `3 matched` out of this line and subtracts it from something is
       doing arithmetic on a number that may have stopped early, and §5 of
       AI-HANDOFF-ENVELOPE.md invites exactly that subtraction. The word is
       attached to the number rather than added at the end of the line, because
       a qualifier at the end of a line is a qualifier a summariser drops. */
    L.push('- Redaction: requested; ' + n(a.matched) + ' matched (' +
           (a.matchedComplete === true ? 'whole count'
             : a.matchedComplete === false ? 'PARTIAL count' : 'completeness unknown') +
           '), ' + n(a.painted) +
           ' of them painted over, ' + n(a.verifiedOpaque) + ' read back opaque; walk ' +
           (a.walkComplete === true ? 'complete'
             : a.walkComplete === false
               ? 'incomplete' + (a.truncatedBy ? ' (' + a.truncatedBy + ')' : '')
               : 'unknown') + '; text ' + r.text + '.' + (kinds ? ' (' + kinds + ')' : ''));
    /* EVERY PLACE THIS CAPTURE GAVE UP, WITH ITS SIZE AND ITS UNIT, on its own
       line and only when there is something to say. Four numbers rather than
       one, because "we did not read this text", "we ran out of blocks", "we
       could not place this block" and "we did not read this block back" are
       four different situations for whoever receives the image. */
    const gaps = [];
    if (a.textRefused > 0) gaps.push(a.textRefused + ' pieces of text not read');
    if (a.blocksLost > 0) gaps.push(a.blocksLost + ' blocks found and never drawn');
    if (a.blocksUnpainted > 0) gaps.push(a.blocksUnpainted + ' blocks not placed in the image');
    if (a.blocksUnread > 0) gaps.push(a.blocksUnread + ' blocks drawn but not read back');
    if (gaps.length) L.push('- Redaction gaps: ' + gaps.join('; ') + '.');
  }
  /* THE CONSTANT. Emitted whenever redaction was requested, and it is the only
     defence against a consumer turning 3/3/3 back into "clean" in its own
     summary. It is not conditional on the numbers, because it is not about
     them. */
  if (r.requested !== false) {
    L.push('- FullShot reads the text a page exposes. It cannot see this image. The line ' +
           'above counts what FullShot did, not what is in the picture.');
    L.push('- The redactor does not find: ' + r.notCovered.join(', '));
  }
  L.push('- This paste: ' + b.fit.w + 'x' + b.fit.h + ' px, about ' +
         b.tokens.estimate + ' tokens (estimate, rule ' + b.tokens.rule +
         ', checked ' + b.tokens.asOf + ')');
  if (env.tiles) {
    L.push('- Legible tiles available: ' + env.tiles.count +
           ' with ' + env.tiles.overlapPx + ' px overlap (this paste is the whole page, reduced)');
  }
  if (env.notes && env.notes.length) {
    L.push('', '## Notes');
    for (const n of env.notes) L.push('- ' + n);
  }
  if (env.legend && env.legend.length) {
    L.push('', '## Annotations');
    for (const a of env.legend) L.push('- ' + fsAiLegendLine(a));
  }
  if (x.body && x.body.length) {
    L.push('', '## Page text', '');
    for (const line of x.body) L.push(line);
  }
  return L.join('\n');
}

/* One legend row as a sentence. Same facts as the JSON beside it — a model
   that reads prose better than a schema gets the prose, and a consumer that
   wants the numbers reads env.legend. */
function fsAiLegendLine(a) {
  const at = p => p ? p.xPct + '%, ' + p.yPct + '%' : '?';
  let s = '[' + a.id + '] ' + a.kind;
  if (a.label) s += ' "' + a.label + '"';
  if (a.kind === 'arrow' || a.kind === 'line') s += ' from ' + at(a.from) + ' to ' + at(a.at);
  else if (a.box) s += ' covering ' + a.box.wPct + '% x ' + a.box.hPct + '% at ' + at(a.at);
  else s += ' at ' + at(a.at);
  if (a.conceals) s += ' (content deliberately hidden)';
  if (a.near) s += ' - near "' + a.near + '"';
  return s;
}

/* A page script when a page loads it; a plain module when a sim requires it.
   Same idiom as pages/batch.js, for the same reason: the reducer above is the
   part of this file most in need of grading and the least reachable through a
   browser, and a sim that stubbed it would only ever grade the stub. */
/* Direction is applied the instant this file is parsed, because it is one
   attribute and the stylesheet has already set the CSS half; the string pass
   waits for a document to walk. Every page loads common.js at the END of body,
   so readyState is normally 'interactive' already and the pass runs at once —
   the listener is for the day a page moves the tag into <head>. Wrapped in an
   arrow, never passed to addEventListener directly: the handler would receive
   the Event as `root` and quietly walk nothing. */
function fsOnDomReady(fn) {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else { fn(); }
}
if (typeof document !== 'undefined') {
  fsApplyDir();
  fsApplyTheme();
  fsOnDomReady(() => fsApplyI18n());
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FS_REASONS, FS_REASON_GENERIC, fsHumanReason, fsApplyDir,
    FS_I18N_ATTRS, FS_PLURAL_SUFFIX, fsI18nSubst, fsMessage, fsPluralCategory,
    fsPluralMessage, fsApplyI18n, fsUiLocale, fsNumber, fsDims,
    FS_REDACT_ACTS_V, FS_REDACT_TRUNCATED, FS_REDACT_LEDGER,
    FS_REDACT_KEYS, FS_REDACT_ACT_KEYS, FS_VERDICT_KEYS, FS_AI_BOOL_KEYS,
    fsRedactActs, fsRedactShortfall, fsRedactActValueOk, fsEnvelopeVerdict,
    FS_AI_ENVELOPE, FS_AI_PROFILES, FS_AI_DEFAULT_PROFILE, FS_AI_ROLES, FS_AI_NOT_COVERED,
    fsAiLuhnOk, fsAiPiiSpans, fsAiMaskText, fsAiRowCeiling, fsAiFitDims, fsAiRound2,
    fsAiTokenCount, fsAiTokens,
    fsAiPlanTiles, fsAiLegend, fsAiBundle, fsAiText, fsAiLegendLine,
    fsCopyBlobToClipboard
  };
}
