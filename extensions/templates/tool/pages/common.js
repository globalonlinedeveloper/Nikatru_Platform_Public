/* SKELETON — shared page utilities: DOM, theme, clipboard, downloads, filenames.

   Load AFTER ../lib/settings.js (which defines SK_DEFAULTS and skGetSettings);
   both are plain scripts sharing one global scope, so this file uses those names
   directly.

   RULE 1 OF THIS FAMILY, and the reason el() exists:
   untrusted text — a page title, a url, a filename, an error string, anything
   that came from outside this extension — NEVER reaches the DOM as markup.
   createElement plus textContent, always. There is no innerHTML in this file and
   there should be none in any file that copies it. A tool that needs rich
   layout builds it out of elements, not out of a string.

   A useful check to keep in your sim (the reference calls it "=== sink ==="):
     the renderer never matches /innerHTML\s*=[^;]*\+/  and does contain textContent
   A test that does not bite is not a test — re-inject the bug and watch it fail
   before you believe it.
*/

/* ---------------- DOM ---------------- */
/* The path of least resistance is the safe one: to put text on screen you pass
   it here, and here it becomes a text node. */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function elText(node, text) {
  if (node) node.textContent = text == null ? '' : String(text);
  return node;
}

function elClear(node) {
  if (node) node.textContent = '';   // faster than innerHTML='' and never parses
  return node;
}

function elAppend(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}

/* An anchor whose href came from outside. ALLOWLIST of shapes, default deny:
   an https/http absolute url, or a plain relative path inside this extension.
   Anything else — javascript:, data:, blob:, a scheme split by a tab character,
   a control character the browser would strip later — is refused and the text is
   rendered as a plain span instead. Refusing is always safe here; guessing is
   not. (Hrefs YOU built, such as URL.createObjectURL output, are trusted: set
   .href directly, as skDownloadBlob does.) */
const SK_RELATIVE_HREF = /^[A-Za-z0-9._~\-\/]+(\?[A-Za-z0-9._~\-\/=&%+]*)?(#[A-Za-z0-9._~\-%]*)?$/;

function skSafeHref(href) {
  const s = String(href == null ? '' : href).trim();
  if (!s) return '';
  /* A PROTOCOL-RELATIVE href names no scheme, so it used to slip through the
     relative branch below: a leading double slash followed by a host is not an
     absolute url by that pattern's reckoning, but the browser resolves it
     against the CURRENT page's scheme and it is a live off-site navigation.
     (Deliberately described rather than shown: this file ships, and a hostile-
     looking url in shipped source is something a store scanner reads without
     reading the sentence around it.)
     On an extension page it resolves against chrome-extension: and reaches
     nothing, which is why an earlier version of this file left the hole open
     with a paragraph explaining why it was fine. The paragraph was the damage:
     the moment a tool renders a link inside a CONTENT SCRIPT — on an https:
     page, which is where in-page overlays live — the same helper hands back a
     working open redirect whose visible text the attacker also chose. Two
     characters, checked before anything else. */
  if (s.slice(0, 2) === '//') return '';
  if (/^https?:\/\/[^\s<>"'`\\^{}|\x00-\x20\x7f]+$/i.test(s)) return s;
  if (SK_RELATIVE_HREF.test(s)) return s;
  return '';
}

function elLink(text, href, cls) {
  const safe = skSafeHref(href);
  if (!safe) return el('span', cls, text);
  const a = el('a', cls, text);
  a.href = safe;
  a.rel = 'noopener noreferrer';
  return a;
}

/* THE NODE FOR TEXT THAT CAME FROM OUTSIDE — a page title, an origin, a
   filename. Use this instead of el('span', …) for every such value.

   It emits a <bdi>, which isolates the bidirectional algorithm BY DEFAULT with
   no CSS at all. That matters for two separate reasons:

   correctness  an LTR origin spliced into an Arabic or Hebrew sentence
                reorders, and the brackets around it land on the wrong sides.
   security     a page title containing U+202E RIGHT-TO-LEFT OVERRIDE reverses
                the rendering of everything after it in the same bidi paragraph.
                A title of "‮elpmaxe.knab//:sptth" rendered next to the real
                origin line lets a hostile page change what the ORIGIN appears
                to say — and the origin line is the one thing the whole
                originOf() design exists to keep honest. elText() stops that
                text becoming markup. Only isolation stops it hijacking the
                display of the trusted text beside it.

   <bdi> survives a stylesheet a tool author edited; .text-untrusted (which also
   sets unicode-bidi: isolate, plus wrapping) does not. Belt and braces: this
   helper applies both. */
function elUntrusted(cls, text) {
  const n = el('bdi', cls ? cls + ' text-untrusted' : 'text-untrusted', text);
  return n;
}

/* ---------------- i18n ---------------- */
/* RULE 2 OF THIS FAMILY: no user-visible string is a literal. Every one comes
   from _locales/<locale>/messages.json through here.

   A SENTENCE IS ONE MESSAGE, NEVER TWO GLUED TOGETHER. `skMsg('a') + ' ' +
   skMsg('b')` compiles English word order into the program: German puts the
   verb last, Japanese needs particles between the pieces, and Arabic and Hebrew
   run the other way. If you need a value inside a sentence, the sentence gets a
   $PLACEHOLDER$ and the value is a substitution. test/i18n-sim.node.js fails on
   any localised string that is an operand of `+`.

   NOT EVERYTHING IS A UI STRING. The tool's FUNCTIONAL OUTPUT — exported
   Markdown, CSV headers, captured page text, the {date}/{time} tokens in a
   filename — is the user's own content in the page's own language, and
   translating it corrupts data. Those never come from here. */

/* chrome.i18n.getMessage returns '' for a key that is not in the catalogue, and
   it does it silently: a typo becomes an empty label that reads as a CSS bug,
   not as a missing translation, and it survives review because nothing looks
   broken enough to chase. Return a marker instead, so a missing key is loud in
   the UI and mechanically findable in a test. */
const SK_MISSING_OPEN = '⟦';    // ⟦
const SK_MISSING_CLOSE = '⟧';   // ⟧

/* Resolve, or ''. Silent on purpose: skPlural below tries two keys and a miss
   on the first is ordinary, not a defect. Every caller that DOES want noise
   makes it itself, so there is exactly one place per failure that speaks.
   It must never throw — this file is also loaded as a plain module by the test
   tier, where chrome.i18n does not exist and having no opinion is correct. */
function skRawMsg(key, subs) {
  try { return chrome.i18n.getMessage(String(key == null ? '' : key), subs) || ''; }
  catch (_) { return ''; }
}

/* The one lookup a page's JAVASCRIPT calls. A key that does not resolve comes
   back as the ⟦key⟧ marker — never '', because a blank label reads as a CSS bug
   and survives review, while ⟦popupCopied⟧ is a bug report the first time
   anyone sees it. The DOM pass below does NOT come through here: markup has an
   authored English fallback to fall back TO, and it does. */
function skMsg(key, subs) {
  const k = String(key == null ? '' : key);
  const out = skRawMsg(k, subs);
  if (out !== '') return out;
  console.warn('i18n: no message for "' + k + '"');
  return SK_MISSING_OPEN + k + SK_MISSING_CLOSE;
}

/* The locale of the message file that actually LOADED — not the one the user
   set. The two disagree every time Chrome falls back: a browser set to a
   locale this extension does not ship loads _locales/en and getUILanguage()
   still answers with the user's choice, so Intl.PluralRules would pick a
   category for a grammar that is not on screen. It is the STRINGS that have to
   agree with the plural rule. @@ui_locale spells it with an underscore
   ('pt_BR'); BCP-47 — and the lang attribute — wants a hyphen. */
function skUiLocale() {
  try {
    const loaded = chrome.i18n.getMessage('@@ui_locale');
    if (loaded) return loaded.replace(/_/g, '-');
  } catch (_) {}
  try { return chrome.i18n.getUILanguage() || 'en'; } catch (_) { return 'en'; }
}

/* chrome.i18n has NO plural support, and an English `n === 1 ? 'row' : 'rows'`
   ternary is not a translation problem, it is a grammar bug: Arabic has six
   plural categories, Polish four, Russian three. Intl.PluralRules knows which
   one a number falls into for this locale; the catalogue carries all six forms
   for every plural family, so there is always something to read.
   `_other` is the only form that must exist — everything else falls back to it. */
const SK_PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function skPlural(baseKey, n, subs) {
  let cat = 'other';
  try { cat = new Intl.PluralRules(skUiLocale()).select(Number(n)); } catch (_) {}
  if (SK_PLURAL_CATEGORIES.indexOf(cat) < 0) cat = 'other';
  let out = skRawMsg(baseKey + '_' + cat, subs);
  /* A locale file only carries the categories that locale uses, so a category
     selected for a locale Chrome fell back FROM would otherwise blank the line.
     _other is the one form every family must declare. */
  if (out === '') out = skRawMsg(baseKey + '_other', subs);
  if (out !== '') return out;
  console.warn('i18n: no message for "' + baseKey + '_' + cat + '" (or its _other form)');
  return SK_MISSING_OPEN + baseKey + '_' + cat + SK_MISSING_CLOSE;
}

/* THE ATTRIBUTES THIS PASS MAY WRITE, BY NAME. An allowlist, never a pattern:
   the difference between a tooltip and a navigation sink is not something a
   regex can be trusted to know, and data-i18n-attr="href:someKey" would turn a
   message file into a link target. _locales/ is the one part of a shipped
   extension that a translator — or a translation service, or whoever sends the
   PR — edits, and it is reviewed as prose, by someone reading for grammar.
   Everything reachable from here must therefore be inert TEXT.

   `value` is deliberately absent: an <option value> is an ENUM ('system',
   'light', 'dark'), and translating one corrupts the user's settings rather
   than merely looking wrong. So are href, src, srcdoc, style and the two
   form-submission attributes, for the harder version of the same reason. */
const SK_I18N_ATTRS = ['alt', 'aria-description', 'aria-label', 'aria-placeholder',
  'aria-roledescription', 'aria-valuetext', 'label', 'placeholder', 'title'];

/* The declarative half: the markup carries the KEY, this puts the text in.
     data-i18n="key"                             -> textContent
     data-i18n-attr="title:key; aria-label:key2" -> one pair per attribute
   An icon-only button needs BOTH: per HTML-AAM an element's content wins over
   its title attribute, so a button whose content is "◐" announces as "◐" no
   matter what the tooltip says.

   A KEY THAT DOES NOT RESOLVE LEAVES THE AUTHORED ENGLISH STANDING, and warns.
   Overwriting it — with '' or with the ⟦key⟧ marker — turns one forgotten
   catalogue entry into an unusable control, and does it in every locale
   including the author's own. A miss degrades to English; never to blank.

   Returns how many strings it put in place, so a caller — or a test — can tell
   "this page has no keys" from "the pass never ran". Call it again after
   rendering: rows built at run time are not in the document at boot. */
function skApplyI18n(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
  const nodes = [];
  // The root itself may be a freshly built node that carries a key.
  if (typeof scope.hasAttribute === 'function' &&
      (scope.hasAttribute('data-i18n') || scope.hasAttribute('data-i18n-attr'))) nodes.push(scope);
  for (const node of scope.querySelectorAll('[data-i18n], [data-i18n-attr]')) nodes.push(node);

  let applied = 0;
  for (const node of nodes) {
    const key = node.getAttribute('data-i18n');
    if (key) {
      const text = skRawMsg(key);
      if (text === '') {
        console.warn('i18n: no message for "' + key + '" — leaving the authored text');
      } else {
        // Written only when it DIFFERS. A live region (role="status"/"alert")
        // re-announces itself every time its text is set, so an applier that
        // rewrites identical text on every pass turns a status line into a
        // screen reader that will not stop talking.
        if (node.textContent !== text) elText(node, text);
        applied++;
      }
    }
    const spec = node.getAttribute('data-i18n-attr');
    if (!spec) continue;
    /* "title:popupRefresh; aria-label:popupRefresh" — one pair per attribute,
       separated by ';'. A key may not contain ':', and none does: a message
       name is [A-Za-z0-9_]. */
    for (const pair of spec.split(';')) {
      if (!pair.trim()) continue;
      const cut = pair.indexOf(':');
      const name = (cut < 0 ? pair : pair.slice(0, cut)).trim().toLowerCase();
      const k = cut < 0 ? '' : pair.slice(cut + 1).trim();
      if (!name || !k) { console.warn('i18n: malformed data-i18n-attr "' + pair.trim() + '"'); continue; }
      if (SK_I18N_ATTRS.indexOf(name) < 0) {
        console.warn('i18n: refusing to write attribute "' + name + '" — not in SK_I18N_ATTRS');
        continue;
      }
      const text = skRawMsg(k);
      if (text === '') {
        console.warn('i18n: no message for "' + k + '" — leaving the authored ' + name);
        continue;
      }
      if (node.getAttribute(name) !== text) node.setAttribute(name, text);
      applied++;
    }
  }
  return applied;
}

/* lang drives locale-correct text-transform and hyphenation (Turkish 'i'
   uppercases to 'İ', not 'I'); dir drives every logical property in the
   stylesheets. @@bidi_dir is chrome.i18n's own answer, so ar/fa/he are right
   without this file keeping a list.
   The CSS keys off [dir="rtl"] rather than :dir(rtl) on purpose: :dir() only
   shipped in Chrome 120 and this manifest declares minimum_chrome_version 116. */
function skApplyDirection() {
  const root = document.documentElement;
  if (!root) return 'ltr';
  root.lang = skUiLocale();
  let dir = '';
  try { dir = chrome.i18n.getMessage('@@bidi_dir') || ''; } catch (_) {}
  root.dir = dir === 'rtl' ? 'rtl' : 'ltr';
  return root.dir;
}

/* ---------------- theme ---------------- */
/* Through the settings API, never chrome.storage.sync directly: the area a key
   lives in is lib/settings.js's decision (see the partition note there), and a
   page that hardcodes 'sync' breaks silently the day a key moves. */
async function skApplyTheme() {
  let theme = 'system';
  try { theme = (await skGetSettings()).theme || 'system'; } catch (_) {}
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

async function skToggleTheme() {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  await skSetSettings({ theme: next });
}

/* ---------------- durability ---------------- */
/* THE BROWSER CAN DELETE THE USER'S LIBRARY WITHOUT ASKING.

   An origin's IndexedDB sits in a BEST-EFFORT bucket until something calls
   navigator.storage.persist(). Under storage pressure Chrome evicts best-effort
   origins silently: no prompt, no notification, no event. For a local-first
   tool whose whole proposition is "your data never leaves your machine", losing
   the library without a word is the worst available outcome and the one nobody
   is warned about.

   TWO THINGS EVERY TOOL WOULD OTHERWISE REDISCOVER SEPARATELY:

   1. StorageManager.persist() is exposed on WINDOW ONLY. Calling it from the
      service worker gets you undefined. It has to live on an extension page,
      which is also where a user gesture exists — so the request is made from
      the popup at the moment the tool first stores something, and from the
      options page, and nowhere else.

   2. The `unlimitedStorage` permission RAISES THE QUOTA. It does not make
      anything durable. A tool that adds that permission has bought a bigger
      best-effort bucket and a false sense of safety.

   Asked ONCE, recorded in a LOCAL setting (durability is granted per origin per
   device, so syncing "we already asked" would leave a second device in the
   best-effort bucket for good — see SK_LOCAL_KEYS). */
async function skRequestPersistence() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav || !nav.storage || typeof nav.storage.persist !== 'function') {
    return { supported: false, persisted: false, asked: false };
  }
  let already = false;
  try { already = !!(await nav.storage.persisted()); } catch (_) {}
  if (already) return { supported: true, persisted: true, asked: false };

  let asked = false;
  try { asked = !!(await skGetSettings()).skPersistAsked; } catch (_) {}
  if (asked) return { supported: true, persisted: false, asked: false };

  let granted = false;
  try { granted = !!(await nav.storage.persist()); } catch (_) {}
  await skSetSettings({ skPersistAsked: true });
  return { supported: true, persisted: granted, asked: true };
}

/* What to TELL the user, as a message key. Both branches are declared, and the
   best-effort branch says what to do about it. Never label a best-effort origin
   durable — that is the one sentence in this whole area that would be a lie. */
async function skDurabilityKey() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav || !nav.storage || typeof nav.storage.persisted !== 'function') return 'dataDurabilityUnknown';
  try { return (await nav.storage.persisted()) ? 'dataDurable' : 'dataBestEffort'; }
  catch (_) { return 'dataDurabilityUnknown'; }
}

/* ---------------- clipboard ---------------- */
/* writeText first (it is the real API), then a textarea + execCommand fallback
   for the cases where the async clipboard is refused — a document that lost
   focus, or a browser that wants the clipboardWrite permission this manifest
   deliberately does not ask for. Both paths need a user gesture, so call this
   from a click handler. */
async function skCopyText(text) {
  const s = String(text == null ? '' : text);
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch (_) { /* fall through */ }
  /* try/FINALLY, not try/catch with the remove on the success line. The
     textarea holds the very text the user asked to copy — which in this family
     is page-derived and often the sensitive thing on screen. If execCommand
     throws, a success-line remove() never runs and that node stays in the DOM
     of a page that can live for hours. The node must go whatever happens. */
  let ta = null;
  try {
    ta = document.createElement('textarea');
    ta.value = s;                       // a value, never markup
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand('copy');
  } catch (_) {
    return false;
  } finally {
    if (ta) { try { ta.remove(); } catch (_) {} }
  }
}

/* ---------------- filenames ---------------- */
function skPad(n) { return String(n).padStart(2, '0'); }

/* String.prototype.slice counts UTF-16 CODE UNITS, so slice(0, 60) can cut an
   emoji in half and leave a lone surrogate that renders as U+FFFD in the
   filename AND in the stored row — mojibake the user will blame on the page.
   Every character above U+FFFF is two code units: any emoji, and much of CJK
   Extension B. Intl.Segmenter goes further and keeps grapheme clusters whole
   (Devanagari conjuncts, Hangul jamo, ZWJ sequences, a base letter plus its
   combining marks) — available since Chrome 87, well under the declared
   minimum_chrome_version of 116. The Array.from fallback is surrogate-safe on
   its own, which is the part that must never regress. */
function skClipText(s, max) {
  const str = String(s == null ? '' : s);
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const out = [];
    for (const piece of seg.segment(str)) {
      if (out.length >= max) break;
      out.push(piece.segment);
    }
    return out.join('');
  } catch (_) {
    return Array.from(str).slice(0, max).join('');
  }
}

/* THE FILENAME ALLOWLIST — the one place untrusted text meets the filesystem.

   THIS USED TO BE A DENYLIST, and it was the house rule broken in the house's
   own code: `.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')`. The rule says never
   sanitise untrusted text with a character class, and this family has now lost
   that argument twice (an apostrophe in a url path; a `([\s\S]*)` capture) — in
   both cases because the class did not know a character.

   What THIS class did not know, on a value derived from a page title:
     · U+202E and friends. `report<RLO>gnp.exe` displays as `report exe.png`,
       which is the classic download-name spoof. Zero-width marks likewise.
     · C1 controls U+0080–U+009F, and U+007F. Only the C0 range was covered.
     · Windows reserved DEVICE NAMES. A page titled "NUL" produced `NUL.png`,
       which on Windows is not a file and never becomes one.
     · Bytes. It truncated to 60 CHARACTERS, and the limit almost every
       filesystem actually enforces is ~255 BYTES. Sixty CJK or emoji
       characters are 180–240 bytes before the rest of the template.

   So it is inverted. KEEP [A-Za-z0-9._-]; every other code point becomes '_'.
   The property that has to hold is a positive one and it can be stated in one
   line, which is why the sim can fuzz it: FOR EVERY INPUT, the output character
   set is a subset of the declared allowlist. There is nothing left for a
   character to be misunderstood as.

   The device-name check is an exact comparison against a declared array, not a
   pattern, for the same reason. */
const SK_NAME_ALLOWED = /[^A-Za-z0-9._-]+/g;

/* Reserved on every version of Windows, with or without an extension, in any
   case, and also as `CON.txt`. Compared exactly against the stem. */
const SK_DEVICE_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
];

/* What almost every filesystem enforces, minus room for the extension and for
   the " (1)" a browser appends when the name is taken. */
const SK_NAME_MAX_BYTES = 200;

function skByteLength(s) {
  try { return new TextEncoder().encode(s).length; } catch (_) {}
  // No TextEncoder (an old worker context): count UTF-8 bytes by code point.
  let n = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/* Truncate on BYTES while cutting only between whole characters. Every
   character that survives the allowlist above is one ASCII byte, so this is
   exact here; it is written generically because a tool that widens the
   allowlist must not have to rediscover the difference. */
function skClipBytes(s, maxBytes) {
  const str = String(s == null ? '' : s);
  if (skByteLength(str) <= maxBytes) return str;
  let out = '', used = 0;
  for (const ch of str) {
    const n = skByteLength(ch);
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}

/* PLACEHOLDER(filename) — the tokens your tool offers. Everything substituted in
   goes through the allowlist above, so a hostile page title cannot climb out of
   the download folder, carry a path separator, or reverse how the name reads.

   THE {date} AND {time} TOKENS ARE DELIBERATELY NOT LOCALISED. A filename is
   FUNCTIONAL OUTPUT: it sorts, it is typed into shells, it is matched by
   scripts. `Intl.DateTimeFormat` would produce 04/07/2026 in one locale and
   07/04/2026 in another and '٢٠٢٦' in a third, and a folder of those does not
   sort. Locale-aware formatting belongs to the UI chrome only — skFormatDate
   and skFormatBytes below.

   ONE MORE THING, AND IT IS NOT A SANITISING PROBLEM: `{title}` writes
   page-derived text into a filename that lands in ~/Downloads, in the download
   shelf and in chrome://downloads, permanently and in front of anyone looking
   at the screen. Offer the token if your tool needs it; do not put it in the
   DEFAULT template for anything that reads a page the user might not want
   named. */
function skBuildFilename(template, { title = '', origin = '', ext = '' } = {}) {
  const d = new Date();
  const host = String(origin).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '');
  const map = {
    '{host}': host || 'page',
    '{title}': skClipText(title, 60),
    '{date}': `${d.getFullYear()}-${skPad(d.getMonth() + 1)}-${skPad(d.getDate())}`,
    '{time}': `${skPad(d.getHours())}-${skPad(d.getMinutes())}-${skPad(d.getSeconds())}`
  };
  let name = String(template || 'skeleton-{host}-{date}');
  for (const [k, v] of Object.entries(map)) name = name.split(k).join(v);

  name = name
    .replace(SK_NAME_ALLOWED, '_')      // ALLOWLIST: everything else becomes _
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');

  name = skClipBytes(name, SK_NAME_MAX_BYTES).replace(/[_\-.]+$/g, '');

  // A device name is not a filename on Windows, whatever you append to it.
  if (SK_DEVICE_NAMES.indexOf(name.toUpperCase().split('.')[0]) >= 0) name = '_' + name;

  return (name || 'file') + (ext || '');
}

/* UI CHROME, so these two ARE locale-aware — a number and a date shown to a
   person read wrong otherwise: de-DE writes 1,5 MB where en-GB writes 1.5 MB,
   and fr-FR writes 1,5 Mo. Both take the EXTENSION's UI locale explicitly,
   never the implicit browser default: chrome.i18n may have picked a different
   language from the one Intl would default to, and a French UI showing US-format
   timestamps is a bug nobody files. */
/* Gigabytes are in the ladder because a storage QUOTA is measured in them: the
   options page prints "using X of Y", and a Y of "10,240.1 MB" is a number the
   reader has to do arithmetic on before it means anything. */
const SK_BYTE_STEPS = [
  [1024, 'byte', 1, 0],
  [1048576, 'kilobyte', 1024, 1],
  [1073741824, 'megabyte', 1048576, 1],
  [Infinity, 'gigabyte', 1073741824, 1]
];

function skFormatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  const step = SK_BYTE_STEPS.find(s => v < s[0]) || SK_BYTE_STEPS[SK_BYTE_STEPS.length - 1];
  const value = v / step[2];
  try {
    return new Intl.NumberFormat(skUiLocale(), {
      style: 'unit', unit: step[1], unitDisplay: 'short', maximumFractionDigits: step[3]
    }).format(value);
  } catch (_) {
    const SHORT = { byte: 'B', kilobyte: 'KB', megabyte: 'MB', gigabyte: 'GB' };
    return value.toFixed(step[3]) + ' ' + SHORT[step[1]];
  }
}

function skFormatDate(ms) {
  const d = new Date(Number(ms) || 0);
  try {
    return new Intl.DateTimeFormat(skUiLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch (_) {
    return d.toLocaleString();
  }
}

/* ---------------- downloads ---------------- */
/* The anchor path needs NO permission and is what this skeleton ships with.
   chrome.downloads is used only if a tool has declared the "downloads"
   permission for a reason it can defend in the store listing. */
async function skDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (chrome.downloads && chrome.downloads.download) {
      return await chrome.downloads.download({ url, filename, saveAs: false });
    }
    const a = el('a');
    a.href = url;                 // our own blob url, not untrusted input
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/* One object, one file, one place the JSON shape is decided. Both things this
   family writes to disk — the data export and the problem report — go through
   here, so they are formatted the same way and neither invents its own.
   Pretty-printed on purpose: these are files a person opens. */
async function skDownloadJson(obj, filename) {
  const text = JSON.stringify(obj, null, 2) + '\n';
  return skDownloadBlob(new Blob([text], { type: 'application/json' }), filename);
}

/* ---------------- the problem report ---------------- */
/* A REPORT-A-PROBLEM PATH WITH NO BACKEND.

   The product makes no network calls, so there is nothing to send a report TO.
   That is not a limitation to work around — it is the whole position. What the
   user gets is a file they can read, keep and send themselves, by whatever
   route they already trust.

   Which makes redaction a DESIGN CONSTRAINT, not a courtesy: this file is about
   to leave the machine by a path this product cannot see, chosen by a user who
   is annoyed and in a hurry. So:

   IT IS BUILT FROM AN ALLOWLIST, NOT SCRUBBED.
   Every field below is named here, one at a time. Nothing walks an object and
   takes what it finds, and nothing is passed through a regex that tries to
   remove urls or tokens from prose — that is the sanitiser shape this family
   has now failed with twice (see the long note above GATE 1 in background.js).
   A field that is not in this function does not reach the file, whatever a tool
   later puts in its settings, its job records or its rows.

   THEREFORE, NEVER IN A REPORT: a page url or path, a query string, a page
   title, a captured document, a row's contents, a clipboard value, a setting
   whose type is a free-text string. Counts, booleans, numbers, declared codes,
   and the extension's own version.

   PLACEHOLDER(diagnostic) — add your tool's fields here, and add each one to
   the sim's redaction check at the same time. If you cannot state in one line
   why a field cannot identify a page or a person, it does not go in. */
function skBuildDiagnostic(input) {
  const i = input || {};
  const settings = i.settings || {};
  const facts = i.facts || {};
  const last = i.lastError || null;

  /* Settings are reported as SHAPES, not values, unless the value is a number
     or a boolean. A boolean cannot identify anything; a free-text setting can
     name a client, a host or a person, and the partition in lib/settings.js
     exists precisely because tools grow those. */
  const settingsOut = {};
  for (const key of Object.keys(settings).sort()) {
    const v = settings[key];
    if (typeof v === 'boolean' || typeof v === 'number') settingsOut[key] = v;
    else if (typeof v === 'string') settingsOut[key] = SK_SAFE_SETTING_VALUES.indexOf(v) >= 0 ? v : '(text)';
    else settingsOut[key] = '(' + (v === null ? 'null' : typeof v) + ')';
  }

  return {
    report: 'skeleton-problem-report',   // PLACEHOLDER(prefix)
    schema: 1,
    createdAt: new Date(Number(i.now) || Date.now()).toISOString(),
    version: String(i.version || ''),
    uiLocale: String(i.uiLocale || ''),
    /* The platform, at the coarsest useful grain. A full user-agent string is a
       fingerprint; "which engine, roughly which version" is what actually
       narrows a bug down. */
    platform: skCoarsePlatform(i.userAgent),
    settings: settingsOut,
    storage: {
      itemRows: Number(facts.itemRows),
      scratchRows: Number(facts.scratchRows),
      durability: String(i.durability || 'dataDurabilityUnknown'),
      usageBytes: i.usage == null ? null : Number(i.usage),
      quotaBytes: i.quota == null ? null : Number(i.quota)
    },
    jobs: {
      inFlight: Number(facts.jobsInFlight),
      actions: Array.isArray(facts.jobActions) ? facts.jobActions.slice(0, 8).map(String) : [],
      jobTimeoutMs: Number(facts.jobTimeoutMs),
      scratchTtlMs: Number(facts.scratchTtlMs)
    },
    /* The last failure, as the note already stores it: a reason KEY, a scheme +
       host, and a time. Not the sentence — a key is stable across languages and
       is what a maintainer greps for. Not the url — the note never had one. */
    lastFailure: last ? {
      reasonKey: String(last.reason || ''),
      action: String(last.action || ''),
      origin: String(last.origin || ''),
      when: new Date(Number(last.when) || 0).toISOString()
    } : null
  };
}

/* The only string setting values that may be reported verbatim: a closed set of
   this family's own enum values. Anything else becomes '(text)'. Same shape as
   the reasons allowlist, same reason. */
const SK_SAFE_SETTING_VALUES = ['system', 'light', 'dark'];   // PLACEHOLDER(setting-enums)

/* Engine family and major version, and nothing else. Built by matching a
   declared list of engine tokens — never by echoing the user-agent, which
   carries build numbers, device models and locale hints. */
const SK_ENGINES = ['Edg', 'OPR', 'Vivaldi', 'Brave', 'Firefox', 'Chrome'];

function skCoarsePlatform(ua) {
  const s = String(ua || '');
  for (const name of SK_ENGINES) {
    const i = s.indexOf(name + '/');
    if (i < 0) continue;
    const major = /^(\d{1,4})/.exec(s.slice(i + name.length + 1));
    return name + ' ' + (major ? major[1] : '?');
  }
  return 'unknown';
}

/* ---------------- toast ---------------- */
/* Pass a MESSAGE KEY, not a sentence: skToast('popupCopied'). The toast is
   often the only feedback for "it worked" versus "it did not", so it is the
   last place a hardcoded English string should survive.
   The live-region attributes are set at CREATION, before any text — a region
   that gains role="status" at the same moment it gains its text is not reliably
   announced, because there was nothing there to observe changing. */
function skToast(key, ms = 2200, subs) {
  let t = document.getElementById('sk-toast');
  if (!t) {
    t = el('div');
    t.id = 'sk-toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  elText(t, skMsg(key, subs));
  t.classList.add('show');
  clearTimeout(t.__timer);
  t.__timer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------------- confirm dialog ---------------- */
/* THE ONLY MODAL IN THIS FAMILY. Use it; do not hand-roll a scrim div.

   A hand-rolled `<div class="modal">` has to reimplement, correctly, every one
   of: containing Tab inside itself, making the page behind it inert, closing on
   Escape, and — the one everybody forgets — putting focus BACK on the control
   that opened it. The reference implementation shipped one of these and got
   three of the five wrong; multiply by 67 and the honest prediction is that it
   never gets fixed. Native <dialog> + showModal() does all five in the engine,
   at zero bytes and with no dependency.

   Returns a promise for `true` (confirmed) or `false` (cancelled, Escape,
   backdrop click, or a browser with no <dialog>). Default deny: anything that
   is not an explicit press of the confirm button resolves false, so a
   destructive action can never happen by accident or by an engine quirk.

   The content is built with el()/elText(), so the family's no-markup rule holds
   inside the dialog too. Every string is a KEY.

   opts.previewText turns it into a REVIEW dialog: the text is shown in a
   scrollable, read-only <pre> above the buttons. That is how the problem report
   is written — the user sees the exact bytes before anything reaches the disk,
   because a file assembled on their behalf and sent onwards is not something
   they should have to take on trust. It is a text node like everything else
   here, so a page-derived string that leaked into a report would be shown, not
   rendered. */
function skConfirm(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const doc = document;
    /* Captured BEFORE the dialog exists. This is the focus restore target, and
       it is the whole reason a tool must not build its own modal: by the time
       showModal() has run, activeElement is inside the dialog and the trigger
       is unrecoverable. */
    const trigger = doc.activeElement && typeof doc.activeElement.focus === 'function'
      ? doc.activeElement : null;

    const dlg = el('dialog', 'sk-dialog');
    dlg.id = 'sk-confirm';

    if (typeof dlg.showModal !== 'function') {
      // No <dialog> support: refuse rather than run the action unconfirmed.
      console.warn('SKELETON: <dialog> is unavailable, so the action was not confirmed');
      resolve(false);
      return;
    }

    const heading = el('h2', null, skMsg(o.titleKey));
    heading.id = 'sk-confirm-title';
    const bodyText = el('p', null, skMsg(o.bodyKey));
    bodyText.id = 'sk-confirm-body';
    dlg.setAttribute('aria-labelledby', heading.id);
    dlg.setAttribute('aria-describedby', bodyText.id);

    /* Cancel comes FIRST in the DOM and carries autofocus, so the initial focus
       lands on the least destructive choice. A dialog that opens with "Delete"
       focused turns Enter into a loaded gun. */
    const cancel = el('button', 'btn', skMsg(o.cancelKey || 'confirmCancel'));
    cancel.type = 'button';
    cancel.setAttribute('autofocus', '');
    const confirm = el('button', 'btn ' + (o.danger ? 'danger' : 'primary'), skMsg(o.confirmKey));
    confirm.type = 'button';

    let answer = false;
    const finish = (value) => {
      answer = value;
      try { dlg.close(); } catch (_) { done(); }
    };
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      dlg.remove();
      // Restore focus to whatever opened this, AFTER the dialog has gone.
      if (trigger) { try { trigger.focus(); } catch (_) {} }
      resolve(answer);
    };

    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    // Escape fires 'cancel' then 'close' natively — nothing to wire, but the
    // default answer must already be false when it does.
    dlg.addEventListener('close', done);
    // A click on the backdrop targets the dialog element itself. Padding clicks
    // do too, so the pointer has to be proved outside the box first; if the
    // engine cannot tell us, we keep the dialog open, which is the safe default.
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg || typeof dlg.getBoundingClientRect !== 'function') return;
      const r = dlg.getBoundingClientRect();
      if (!r || !r.width) return;
      const outside = e.clientX < r.left || e.clientX > r.right ||
                      e.clientY < r.top || e.clientY > r.bottom;
      if (outside) finish(false);
    });

    let preview = null;
    if (o.previewText != null) {
      preview = el('pre', 'sk-preview', String(o.previewText));
      preview.id = 'sk-confirm-preview';
      // Reachable by keyboard, because it scrolls: a pane a mouse user can
      // scroll and a keyboard user cannot is a pane whose contents the keyboard
      // user is being asked to approve unseen.
      preview.setAttribute('tabindex', '0');
      preview.setAttribute('role', 'group');
      preview.setAttribute('aria-labelledby', bodyText.id);
    }

    elAppend(dlg, heading, bodyText, preview, elAppend(el('div', 'row'), cancel, confirm));
    doc.body.appendChild(dlg);
    dlg.showModal();
  });
}

/* Boot order matters: direction first (the stylesheet keys off [dir]), then the
   strings, then the theme. All three run at end-of-body, before first paint, so
   nothing is ever shown in the wrong language or the wrong direction and then
   corrected — a flash of untranslated content is the i18n equivalent of a flash
   of unstyled content, and it is worse in RTL because the whole layout jumps. */
skApplyDirection();
skApplyI18n();
skApplyTheme();
