/* SKELETON — the package grader. No browser, no dependency, no build step.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED (it lives under publish/, which is on the
   packaging never-list and in the harness's SKIP_DIRS).

     node publish/verify-package.node.js                 # grade the current version's zips
     node publish/verify-package.node.js --zip <path>    # grade one archive

   WHY THIS FILE IS SEPARATE FROM pack.mjs

   The zip is the only artifact a reviewer ever sees, and every other gate in
   this folder grades the FOLDER. A file that loads fine unpacked and 404s inside
   the archive is invisible to the node sim (it reads the tree), invisible to the
   browser smoke test (it loads the tree with --load-extension) and invisible to
   the developer (they loaded the tree too). So the archive gets its own grader,
   and the grader reads the bytes BACK OUT of the finished file rather than
   trusting the list the builder meant to write. The whole class of bug here is
   "the list and the archive disagreed".

   THE TWO THINGS THAT MAKE IT WORTH RUNNING

   1. CASE MISMATCH is reported SEPARATELY FROM MISSING. Windows and macOS
      resolve `icons/Icon128.PNG` against `icons/icon128.png` and load happily;
      a Linux reviewer's machine 404s. "not in the package" sends the author
      looking for a missing file that is right there, so the two answers must
      not share a sentence. The reference implementation's teeth pass caught
      exactly this defect, once, for real.
   2. manifestGates() is a PURE function exported for the node sim, so the
      store's upload rules are enforced against the working tree on every sim
      run AND against the packaged manifest at build time — one implementation,
      graded twice. A second copy in the sim is a copy that can pass while the
      real one fails, which is the shape of bug this whole folder is about.

   Nothing here decides what goes IN the package; that is pack.mjs's allowlist.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.env.SK_ROOT ? path.resolve(process.env.SK_ROOT) : path.join(__dirname, '..');
const PUBLISH = path.join(ROOT, 'publish');

/* Belt and braces, and the leak check. Kept here rather than in pack.mjs so the
   grader can condemn an entry the builder should never have produced — two
   independent statements of the same rule.

   The credential clause is not decoration. Nothing in this family needs a
   secret — zero network calls, no accounts, no CI that publishes for you — so a
   secrets.json or a .pem in a tool folder is already a mistake; what this stops
   is that mistake becoming a PUBLISHED one. `.env` and friends are covered by
   the dot-prefix clause; these are the ones that do not start with a dot.
   Deliberately broad: if you have a legitimate `pages/secret-santa.js`, rename
   it. A false positive costs one rename and fails LOUDLY — the reference check
   reports the file as MISSING from the package — while a false negative costs
   you a published credential. */
/* `tools` and `skeleton.json` joined this list when fleet provenance did. They
   are already unreachable — no ALLOW rule names them, and .mjs/.md are refused
   by extension — so adding them changes nothing today, which is exactly the
   point of a second line of defence: the day somebody widens an allowlist rule,
   the provenance stamp and the fleet auditor must not be what rides along. */
const NEVER = /(^|\/)(node_modules|test|publish|tools|\.[^/]*)(\/|$)|(^|\/)skeleton\.json$|\.md$|\.mjs$|\.zip$|DELETE|(^|\/)(secrets?|credentials)[-.]|\.(pem|key|p12|pfx)$/i;

/* _locales is allowlist-ALWAYS in pack.mjs: it deliberately bypasses the
   pattern language, so grading it BY the pattern language asks a question the
   collector never asked and reports 55 shipped catalogues as scratch files. A
   diagnostic that tells the owner a locale is junk is how the wrong thing gets
   deleted. The locale set has its own, better checks below. */
const LEAK_EXEMPT = /^_locales\/[^/]+\/messages\.json$/;

/* Chrome's own manifest limits. Sources, read 2026-08-12:
     name ≤ 75 (the extension fails to load above it), store display truncates
       near 45 — https://developer.chrome.com/docs/extensions/reference/manifest/name
     short_name ≤ 12 — same page
     version: 1–4 dot-separated integers, 0–65535, no leading zeros —
       https://developer.chrome.com/docs/extensions/reference/manifest/version
     description ≤ 132 —
       https://developer.chrome.com/docs/extensions/reference/manifest/description */
const NAME_MAX = 75, NAME_TRUNCATES_AT = 45, SHORT_NAME_MAX = 12, DESCRIPTION_MAX = 132;

/* ------------------------------------------------------------------ */
/* zip reader — central directory walk + inflateRaw                    */
/* ------------------------------------------------------------------ */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central-directory entry ' + n);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.slice(start, start + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* comment stripper — a scan that reads prose as code is not a scan    */
/* ------------------------------------------------------------------ */
/* This family's shipped files carry long comments that quote the very APIs
   these scans look for: background.js's banner says "No fetch, no XHR, no
   WebSocket", and the paragraph above the importScripts guard explains what
   importScripts() is. Scanning raw source therefore reports the paragraph
   explaining a rule as a violation of it — and the author's rational response
   to a check that is red on correct code is to delete the check. (Found the
   hard way: the guard check below went red on the very comment that documents
   the guard.) Comments are blanked to SPACES, so every offset a caller compares
   stays exactly where it was; string literals are tracked so an "https://" or a
   "/*" inside a quoted string does not derail it. */
function stripComments(src) {
  const s = String(src);
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += (s[i] === '\n' ? '\n' : ' '); i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < s.length) {
        out += s[i];
        if (s[i] === '\\') { i++; if (i < s.length) out += s[i]; i++; continue; }
        if (s[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* reference resolution — CASE MISMATCH is its own answer              */
/* ------------------------------------------------------------------ */
function resolveRef(entries, ref, ctx) {
  const clean = String(ref).split('#')[0].split('?')[0].trim();
  if (!clean) return { ok: true, target: '', reason: 'EMPTY' };

  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(clean);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    /* data: and blob: are self-contained — no request leaves the machine and
       there is nothing in the package to resolve. Everything else with a scheme
       is either a network call (which breaks the product's central claim) or a
       hardcoded extension origin (which breaks on every other install). */
    if (s === 'data' || s === 'blob') return { ok: true, target: clean, reason: 'INLINE' };
    return { ok: false, target: clean, reason: 'EXTERNAL' };
  }

  const base = ctx.indexOf('/') >= 0 ? ctx.slice(0, ctx.lastIndexOf('/')) : '';
  const target = clean.charAt(0) === '/'
    ? clean.slice(1)
    : path.posix.normalize((base ? base + '/' : '') + clean);

  if (target.indexOf('../') === 0) return { ok: false, target, reason: 'ESCAPES' };
  if (entries.has(target)) return { ok: true, target, reason: 'OK' };

  const lower = target.toLowerCase();
  let found = null;
  for (const k of entries.keys()) { if (k.toLowerCase() === lower) { found = k; break; } }
  if (found) return { ok: false, target, reason: 'CASE MISMATCH', found };
  return { ok: false, target, reason: 'MISSING' };
}

function refExtra(r) {
  if (r.reason === 'OK') return '→ ' + r.target;
  if (r.reason === 'INLINE') return 'inline ' + r.target.slice(0, 24) + '…';
  if (r.reason === 'CASE MISMATCH') {
    return 'CASE MISMATCH: the reference says "' + r.target + '", the package holds "' + r.found +
      '". Loads on Windows and macOS, 404s on the reviewer\'s Linux box.';
  }
  if (r.reason === 'MISSING') return 'MISSING from the package: ' + r.target;
  if (r.reason === 'ESCAPES') return 'escapes the package root: ' + r.target;
  if (r.reason === 'EXTERNAL') return 'points OUTSIDE the package: ' + r.target;
  return r.reason;
}

/* ------------------------------------------------------------------ */
/* manifestGates — pure; the sim runs it on the tree, pack on the zip  */
/* ------------------------------------------------------------------ */
/* Every rule here is one an upload can be REJECTED for, or one this family has
   already been bitten by. No fs: the caller supplies the catalogues, the store
   listing text and whether _locales exists, so the same function grades a
   parsed tree manifest and a parsed packaged manifest with no branching. */
function resolveMsg(value, cat) {
  return String(value).replace(/__MSG_([A-Za-z0-9_@]+)__/g, (m, key) => {
    const hit = cat && Object.prototype.hasOwnProperty.call(cat, key) ? cat[key] : null;
    return hit && typeof hit.message === 'string' ? hit.message : m;
  });
}

function messageKeys(manifest) {
  const out = new Set();
  const re = /__MSG_([A-Za-z0-9_@]+)__/g;
  let m;
  while ((m = re.exec(JSON.stringify(manifest)))) out.add(m[1]);
  return out;
}

function manifestGates(mf, opts) {
  const o = opts || {};
  const cats = o.catalogues || {};                 // { en: {key:{message}}, … }
  const dflt = mf.default_locale;
  const defaultCat = dflt ? cats[dflt] : null;
  const codes = Object.keys(cats).sort();
  const listing = typeof o.storeListing === 'string' ? o.storeListing : null;
  const out = [];
  const add = (label, ok, extra) => out.push({ label, ok: !!ok, extra: extra == null ? '' : String(extra) });

  add('manifest_version is 3', mf.manifest_version === 3, String(mf.manifest_version));
  add('no comment-style keys (Chrome warns on every key it does not know)',
    Object.keys(mf).every(k => !/^[_/]/.test(k) && k !== 'comment'), Object.keys(mf).length + ' keys');

  /* --- the two fields that make an upload fail with no useful error --- */
  add('no developer "key" field — it pins a local extension id and is rejected on upload',
    !('key' in mf), 'key' in mf ? 'PRESENT — delete it; it is a chrome://extensions development artefact' : 'absent');
  add('no "update_url" — a store-hosted item must not self-host its updates',
    !('update_url' in mf), 'update_url' in mf ? 'PRESENT: ' + mf.update_url : 'absent');

  /* --- version --- */
  const ver = String(mf.version || '');
  const parts = ver.split('.');
  const shaped = /^\d{1,5}(\.\d{1,5}){0,3}$/.test(ver);
  const noLeadingZeros = parts.every(p => p === '0' || !/^0/.test(p));
  const inRange = parts.every(p => Number(p) <= 65535);
  add('version is 1–4 integers, 0–65535, no leading zeros (Chrome refuses anything else)',
    shaped && noLeadingZeros && inRange,
    ver + (shaped ? (noLeadingZeros ? (inRange ? '' : ' — a part exceeds 65535') : ' — a part has a leading zero') : ' — malformed'));

  /* --- localisation, in both directions --- */
  if (o.hasLocales !== undefined) {
    add('default_locale is declared if and only if _locales/ exists',
      (!!dflt) === (!!o.hasLocales),
      dflt ? 'default_locale=' + dflt + ' locales=' + (o.hasLocales ? 'present' : 'ABSENT (Chrome: "Catalog file is missing for locale")')
        : (o.hasLocales ? '_locales/ exists but no default_locale — every __MSG_ ships literally' : 'no localisation'));
  }
  const keys = Array.from(messageKeys(mf)).sort();
  if (dflt) {
    add('the default catalogue is loadable', !!defaultCat, dflt + (defaultCat ? ' — ' + Object.keys(defaultCat).length + ' keys' : ' — NOT FOUND'));
    const unresolvedDefault = keys.filter(k => !(defaultCat && Object.prototype.hasOwnProperty.call(defaultCat, k)));
    add('every __MSG_*__ the manifest spends resolves in the default catalogue',
      unresolvedDefault.length === 0,
      unresolvedDefault.length ? 'UNRESOLVED: ' + unresolvedDefault.join(', ') + ' — would ship literally as the store name'
        : keys.length + ' key(s): ' + keys.join(', '));
    const gaps = [];
    for (const code of codes) {
      const miss = keys.filter(k => !Object.prototype.hasOwnProperty.call(cats[code], k));
      if (miss.length) gaps.push(code + ':' + miss.join('/'));
    }
    add('every __MSG_*__ resolves in EVERY locale, not just the default',
      gaps.length === 0, gaps.slice(0, 4).join(' | ') || keys.length + ' key(s) × ' + codes.length + ' locales');
  }

  /* --- the three length limits, measured on the RESOLVED string in EVERY
         locale. Measuring `__MSG_appDescription__` is 22 characters and passes
         trivially while all 55 real descriptions go unchecked — which is what
         happens to a length check the day i18n lands. --- */
  const gradeLength = (field, value, max, why) => {
    if (typeof value !== 'string' || !value) { add(field + ' is present', false, 'absent'); return; }
    const per = (codes.length ? codes : ['(no catalogue)']).map(code => ({
      code, text: resolveMsg(value, cats[code] || null)
    }));
    const over = per.filter(p => Array.from(p.text).length > max);
    const worst = per.slice().sort((a, b) => Array.from(b.text).length - Array.from(a.text).length)[0];
    add(field + ' is ≤ ' + max + ' characters in every locale (' + why + ')',
      over.length === 0,
      over.length
        ? over.slice(0, 3).map(p => p.code + '=' + Array.from(p.text).length).join(', ') +
          (over.length > 3 ? ' +' + (over.length - 3) : '') + ' over the limit'
        : 'longest is ' + worst.code + ' at ' + Array.from(worst.text).length);
  };
  gradeLength('name', mf.name, NAME_MAX, 'Chrome refuses to load a longer one');
  gradeLength('short_name', mf.short_name, SHORT_NAME_MAX, 'shown under the icon');
  gradeLength('description', mf.description, DESCRIPTION_MAX, 'the store cuts it here');
  if (typeof mf.name === 'string' && codes.length) {
    const longest = codes.map(c => Array.from(resolveMsg(mf.name, cats[c])).length).sort((a, b) => b - a)[0];
    if (longest > NAME_TRUNCATES_AT) {
      add('NOTE: the store display truncates a name near ' + NAME_TRUNCATES_AT + ' characters', true,
        'longest locale is ' + longest + ' — legal, but put the keyword first and the brand last');
    }
  }

  /* --- icons --- */
  add('icons declares a 128 (the store listing image comes from it)',
    !!(mf.icons && mf.icons['128']), JSON.stringify(Object.keys(mf.icons || {})));

  /* --- the permission surface --- */
  add('no STATIC host_permissions — broad access is requested at run time or not at all',
    !mf.host_permissions,
    mf.host_permissions ? 'DECLARED: ' + JSON.stringify(mf.host_permissions) +
      ' — this is the "Read and change all your data on all websites" install warning'
      : 'none');
  const broadCs = (mf.content_scripts || []).filter(cs =>
    (cs.matches || []).some(m => m === '<all_urls>' || /^\*:\/\//.test(m) || /^https?:\/\/\*\/\*$/.test(m)));
  add('no content_scripts entry matches every url',
    broadCs.length === 0,
    broadCs.length ? 'MATCHES EVERYTHING: ' + JSON.stringify(broadCs.map(c => c.matches)) : (mf.content_scripts || []).length + ' declared');

  /* Not "the permissions are exactly activeTab,storage" — that goes red on the
     first tool that legitimately adds `downloads`, and the author's rational
     move is to delete the check, taking the host-permission guard above out
     with it. What scales is: whatever you declared, you wrote down why. */
  if (listing !== null) {
    const declared = (mf.permissions || []).concat(mf.optional_permissions || [])
      .concat((mf.optional_host_permissions || []).length ? ['optional_host_permissions'] : []);
    const missing = [], thin = [];
    for (const perm of declared) {
      const re = new RegExp('^###\\s+Permission:\\s+`' + perm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\s*$', 'm');
      const at = listing.search(re);
      if (at < 0) { missing.push(perm); continue; }
      const rest = listing.slice(at);
      const body = rest.slice(rest.indexOf('\n') + 1).split(/\n#{2,3}\s/)[0].trim();
      if (body.replace(/\s+/g, ' ').length < 40) thin.push(perm);
    }
    add('every declared permission has a written justification in publish/STORE-LISTING.md',
      missing.length === 0 && thin.length === 0,
      missing.length ? 'NO justification for: ' + missing.join(', ')
        : thin.length ? 'justification too thin to paste into the dashboard: ' + thin.join(', ')
          : declared.length + ' permission(s) justified: ' + (declared.join(', ') || 'none declared'));
  }

  /* --- background --- */
  const bg = mf.background || {};
  add('the service worker is a classic script AND importScripts is guarded in source',
    bg.type !== 'module',
    bg.type === 'module'
      ? 'type:"module" — background.js uses importScripts, which does not exist in a module worker'
      : (bg.service_worker || '(none)') + (bg.scripts ? ' + scripts fallback for Firefox' : ''));

  return out;
}

/* ------------------------------------------------------------------ */
/* verifyPackage — grades an archive that has already been written     */
/* ------------------------------------------------------------------ */
const NET = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|SharedWorker)\s*\(|\bnavigator\s*\.\s*sendBeacon\b|importScripts\(\s*["']https?:/g;

function verifyPackage(opts) {
  const o = opts || {};
  const zipPath = o.zipPath;
  const kind = o.kind || 'chrome';
  const root = o.root || ROOT;
  const publishDir = o.publishDir || path.join(root, 'publish');
  const checks = [];
  const actions = [];
  const add = (label, ok, extra) => { checks.push({ label, ok: !!ok, extra: extra == null ? '' : String(extra) }); return !!ok; };
  const act = (who, text) => actions.push(who + ': ' + text);
  const done = () => ({ checks, actions, fails: checks.filter(c => !c.ok).length });

  if (!fs.existsSync(zipPath)) { add('the package exists', false, zipPath); return done(); }

  let entries;
  try { entries = readZip(zipPath); }
  catch (e) { add('the package reads as a zip', false, e.message); return done(); }
  add('the package reads as a zip', true, entries.size + ' entries, ' +
    (fs.statSync(zipPath).size / 1024).toFixed(1) + ' KB on disk');

  /* 1. THE MOST COMMON FIRST-UPLOAD FAILURE. Right-clicking the tool folder in
        Windows Explorer and choosing "Send to → Compressed folder" nests every
        path under My_Tool/, and the store answers "Manifest file is missing or
        unreadable" with no hint about why. Zip the CONTENTS, not the folder. */
  if (!add('manifest.json is at the ROOT of the archive, not nested in a folder',
    entries.has('manifest.json'),
    entries.has('manifest.json') ? 'root-level' :
      'NESTED — first entries: ' + Array.from(entries.keys()).slice(0, 3).join(', ') +
      '. Zip the CONTENTS of the folder, not the folder itself.')) return done();

  const badNames = Array.from(entries.keys()).filter(n =>
    n.indexOf('\\') >= 0 || n.charAt(0) === '/' || n.indexOf('../') >= 0 || /\/$/.test(n));
  add('every entry name is a clean forward-slashed relative path',
    badNames.length === 0, badNames.slice(0, 4).join(', ') || entries.size + ' entries');

  let mf = null;
  try { mf = JSON.parse(entries.get('manifest.json').toString('utf8')); }
  catch (e) { add('the packaged manifest.json parses', false, e && e.message); return done(); }
  add('the packaged manifest.json parses', true, 'v' + mf.version);

  /* 2. the store's upload rules, run against what is IN the archive */
  const packagedCats = {};
  for (const [name, data] of entries) {
    const m = /^_locales\/([^/]+)\/messages\.json$/.exec(name);
    if (!m) continue;
    try { packagedCats[m[1]] = JSON.parse(data.toString('utf8')); }
    catch (e) { add('packaged _locales/' + m[1] + '/messages.json parses', false, e.message); }
  }
  let listing = null;
  try { listing = fs.readFileSync(path.join(publishDir, 'STORE-LISTING.md'), 'utf8'); } catch (_) {}
  for (const g of manifestGates(mf, {
    catalogues: packagedCats,
    hasLocales: Object.keys(packagedCats).length > 0,
    storeListing: listing
  })) add(g.label, g.ok, g.extra);

  /* 3. every reference resolves INSIDE the archive, case-exact */
  const refs = [];
  const push = (ref, ctx, what) => { if (ref) refs.push({ ref, ctx, what }); };
  for (const k of Object.keys(mf.icons || {})) push(mf.icons[k], 'manifest.json', 'icons.' + k);
  for (const k of Object.keys((mf.action && mf.action.default_icon) || {})) push(mf.action.default_icon[k], 'manifest.json', 'action.default_icon.' + k);
  push(mf.action && mf.action.default_popup, 'manifest.json', 'action.default_popup');
  push(mf.options_page, 'manifest.json', 'options_page');
  push(mf.options_ui && mf.options_ui.page, 'manifest.json', 'options_ui.page');
  push(mf.background && mf.background.service_worker, 'manifest.json', 'background.service_worker');
  ((mf.background && mf.background.scripts) || []).forEach((s, i) => push(s, 'manifest.json', 'background.scripts[' + i + ']'));
  (mf.content_scripts || []).forEach((cs, i) => {
    (cs.js || []).forEach(s => push(s, 'manifest.json', 'content_scripts[' + i + '].js'));
    (cs.css || []).forEach(s => push(s, 'manifest.json', 'content_scripts[' + i + '].css'));
  });
  (mf.web_accessible_resources || []).forEach((w, i) =>
    (w.resources || []).forEach(s => push(s, 'manifest.json', 'web_accessible_resources[' + i + ']')));

  let htmlPages = 0;
  for (const [name, data] of entries) {
    if (!/\.html$/i.test(name)) continue;
    htmlPages++;
    const html = data.toString('utf8');
    let m;
    const re = [
      [/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, '<script src>'],
      [/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi, '<link href>'],
      [/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, '<img src>']
    ];
    for (const [rx, what] of re) { while ((m = rx.exec(html))) push(m[1], name, name + ' ' + what); }
  }
  let importCalls = 0;
  for (const [name, data] of entries) {
    if (!/\.js$/i.test(name)) continue;
    const src = data.toString('utf8');
    const rx = /importScripts\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = rx.exec(src))) { importCalls++; push(m[1], name, name + ' importScripts'); }
  }

  const bad = [];
  for (const r of refs) {
    const res = resolveRef(entries, r.ref, r.ctx);
    if (!res.ok) bad.push({ r, res });
  }
  add('every reference in the package resolves INSIDE the package, case-exact',
    bad.length === 0,
    bad.length
      ? bad.map(b => b.r.what + ': ' + refExtra(b.res)).join(' | ')
      : refs.length + ' reference(s) across the manifest, ' + htmlPages + ' HTML page(s) and ' +
        importCalls + ' importScripts call(s)');
  add('the HTML and importScripts scan actually found something to grade',
    htmlPages > 0 && importCalls > 0, htmlPages + ' pages, ' + importCalls + ' importScripts calls');

  /* 4. the zero-network promise, in the packaged JavaScript itself */
  const netHits = [];
  let jsCount = 0;
  for (const [name, data] of entries) {
    if (!/\.js$/i.test(name)) continue;
    jsCount++;
    const found = stripComments(data.toString('utf8')).match(NET);
    if (found) netHits.push(name + ': ' + Array.from(new Set(found)).join(', '));
  }
  add('no packaged script can reach the network', netHits.length === 0, netHits.join(' | ') || jsCount + ' scripts clean');

  /* 5. nothing that must never ship */
  const leaked = Array.from(entries.keys()).filter(k => !LEAK_EXEMPT.test(k) && NEVER.test(k));
  add('no test, doc, build script or scratch file leaked into the package',
    leaked.length === 0,
    leaked.length ? 'LEAKED: ' + leaked.join(', ') +
      ' — test/ carries exfiltration-shaped fixture URLs and five network APIs; a reviewer grepping the zip finds them'
      : 'clean');

  /* 6. the licence notice travels with the copy (PolyForm Shield, "Notices") */
  add('LICENSE is in the package', entries.has('LICENSE'),
    entries.has('LICENSE') ? 'the notice travels with every copy, as the licence requires' : 'ABSENT');

  /* 7. localisation: the set, not just the default */
  const packagedLocales = Object.keys(packagedCats).sort();
  if (mf.default_locale) {
    add('the default catalogue is in the archive',
      !!packagedCats[mf.default_locale],
      packagedCats[mf.default_locale] ? mf.default_locale + ' — ' + packagedLocales.length + ' locale(s) packaged'
        : 'MISSING _locales/' + mf.default_locale + '/messages.json — the store rejects this upload outright');
    let treeLocales = [];
    try {
      treeLocales = fs.readdirSync(path.join(root, '_locales'), { withFileTypes: true })
        .filter(e => e.isDirectory())
        .filter(e => fs.existsSync(path.join(root, '_locales', e.name, 'messages.json')))
        .map(e => e.name).sort();
    } catch (_) {}
    const absent = treeLocales.filter(l => packagedLocales.indexOf(l) < 0);
    add('the package carries EVERY locale the tree declares',
      absent.length === 0 && treeLocales.length > 0,
      absent.length
        ? packagedLocales.length + '/' + treeLocales.length + ' packaged; SILENTLY DROPPED: ' +
          absent.slice(0, 8).join(', ') + (absent.length > 8 ? ' +' + (absent.length - 8) : '') +
          ' — those markets receive English and nothing rejects it'
        : treeLocales.length + '/' + treeLocales.length + ' locales');
    const strays = Array.from(entries.keys()).filter(k => k.indexOf('_locales/') === 0 && !LEAK_EXEMPT.test(k));
    add('_locales carries nothing but catalogues (the generator is a build script)',
      strays.length === 0, strays.join(', ') || packagedLocales.length + ' catalogues');
  }

  /* 8. version parity, in all three places it is written */
  let treeVer = null;
  try { treeVer = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version; } catch (_) {}
  add('the packaged version matches the working tree', mf.version === treeVer, mf.version + ' vs ' + treeVer);
  add('the filename carries the packaged version',
    path.basename(zipPath).indexOf(mf.version) >= 0, path.basename(zipPath));

  /* 9. staleness: does the archive still match the code?
        Everything above compares the zip against the MANIFEST. A zip built
        before sixteen files were edited passes all of it while carrying the old
        ones. Reported as an owner ACTION rather than a FAIL: a stale artifact is
        a release-process fact, not a source defect — but it must never be
        silent. */
  if (Array.isArray(o.treeFiles)) {
    const expectDiff = new Set(kind === 'firefox' ? ['manifest.json'] : []);
    const missing = o.treeFiles.filter(f => !entries.has(f));
    const changed = o.treeFiles.filter(f => entries.has(f) && !expectDiff.has(f) &&
      !fs.readFileSync(path.join(root, f)).equals(entries.get(f)));
    const orphan = Array.from(entries.keys()).filter(k => o.treeFiles.indexOf(k) < 0);
    if (missing.length || changed.length || orphan.length) {
      const show = a => a.slice(0, 6).join(', ') + (a.length > 6 ? ' +' + (a.length - 6) : '');
      act('OWNER', 'rebuild ' + path.basename(zipPath) + ' — it no longer matches the working tree' +
        (missing.length ? '; NOT PACKAGED: ' + show(missing) : '') +
        (changed.length ? '; STALE BYTES: ' + show(changed) : '') +
        (orphan.length ? '; NO LONGER IN THE TREE: ' + show(orphan) : '') +
        '. Bump the version first (node publish/bump-version.mjs patch) — two different packages under one version is unrecoverable.');
      add('every packaged file is byte-identical to the tree', false,
        missing.length + ' missing, ' + changed.length + ' stale, ' + orphan.length + ' orphaned');
    } else {
      add('every packaged file is byte-identical to the tree', true, o.treeFiles.length + ' files');
    }
  }

  /* 10. per-browser */
  const bgCode = stripComments((entries.get('background.js') || Buffer.alloc(0)).toString('utf8'));
  const guardRe = /if\s*\(\s*typeof\s+importScripts\s*[!=]==?\s*['"]function['"]\s*\)/;
  const guardAt = bgCode.search(guardRe);
  const firstCall = bgCode.indexOf('importScripts(');
  add('the packaged background.js guards importScripts before calling it',
    firstCall < 0 || (guardAt >= 0 && guardAt < firstCall),
    firstCall < 0 ? 'no importScripts calls at all'
      : (guardAt >= 0 && guardAt < firstCall)
        ? 'the same file loads as a Chrome service worker and a Firefox event page'
        : 'UNGUARDED — Firefox runs background.js as an event-page script where importScripts is undefined, so the add-on throws on load and is dead');

  const expectPath = kind === 'firefox' ? path.join(publishDir, 'manifest.firefox.json') : path.join(root, 'manifest.json');
  let expect = null;
  try { expect = JSON.parse(fs.readFileSync(expectPath, 'utf8')); } catch (_) {}
  add('the packaged manifest is byte-for-byte the one it should be',
    !!expect && JSON.stringify(mf) === JSON.stringify(expect),
    path.relative(root, expectPath).replace(/\\/g, '/'));

  if (kind === 'firefox') {
    const gecko = (mf.browser_specific_settings || {}).gecko || {};
    const placeholder = /REPLACE|\.example$|^$/i.test(String(gecko.id || ''));
    add('gecko.id is a real id, not a placeholder', !placeholder, gecko.id || '(absent)');
    if (placeholder) {
      act('OWNER', 'set publish/identity.json ownerDomain to a domain you control. AMO fixes the ' +
        'add-on identity at FIRST SIGNING, so a placeholder that ships once cannot be walked back.');
    }
    add('background.scripts is declared alongside service_worker (addons-linter: BACKGROUND_SERVICE_WORKER_NOFALLBACK)',
      Array.isArray(mf.background && mf.background.scripts) && mf.background.scripts.length > 0,
      JSON.stringify(mf.background && mf.background.scripts));
    add('no minimum_chrome_version in the Firefox package', !('minimum_chrome_version' in mf),
      mf.minimum_chrome_version || 'absent');
  } else {
    add('the Chrome package declares minimum_chrome_version',
      typeof mf.minimum_chrome_version === 'string', mf.minimum_chrome_version || 'absent');
  }

  return done();
}

module.exports = {
  ROOT, PUBLISH, NEVER, LEAK_EXEMPT,
  NAME_MAX, NAME_TRUNCATES_AT, SHORT_NAME_MAX, DESCRIPTION_MAX,
  readZip, resolveRef, refExtra, resolveMsg, messageKeys, manifestGates, verifyPackage,
  stripComments
};

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */
if (require.main === module) {
  (async () => {
    const argZip = (() => { const i = process.argv.indexOf('--zip'); return i !== -1 ? process.argv[i + 1] : null; })();
    const identity = JSON.parse(fs.readFileSync(path.join(PUBLISH, 'identity.json'), 'utf8'));
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;

    /* collect() lives in pack.mjs — imported rather than re-implemented, so the
       staleness check grades the same file set the builder ships. */
    let treeFiles = null;
    try {
      const url = require('url').pathToFileURL(path.join(PUBLISH, 'pack.mjs')).href;
      treeFiles = (await import(url)).collect();
    } catch (e) { console.log('NOTE  could not read the allowlist from pack.mjs (' + e.message + ') — skipping the staleness check'); }

    const targets = argZip
      ? [{ zipPath: path.resolve(argZip), kind: /firefox/i.test(argZip) ? 'firefox' : 'chrome' }]
      : [
        { zipPath: path.join(PUBLISH, identity.slug + '-' + version + '.zip'), kind: 'chrome' },
        { zipPath: path.join(PUBLISH, identity.slug + '-' + version + '-firefox.zip'), kind: 'firefox' }
      ];

    let fails = 0;
    const allActions = [];
    for (const t of targets) {
      if (!argZip && !fs.existsSync(t.zipPath)) {
        console.log('\n### ' + path.basename(t.zipPath) + '  (' + t.kind + ')');
        console.log('NOTE  not built — run: node publish/pack.mjs');
        continue;
      }
      console.log('\n### ' + path.basename(t.zipPath) + '  (' + t.kind + ')');
      const r = verifyPackage(Object.assign({ treeFiles }, t));
      for (const c of r.checks) console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.label + (c.extra ? '  — ' + c.extra : ''));
      fails += r.fails;
      allActions.push.apply(allActions, r.actions);
    }
    console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASS') + ' — package + reference integrity');
    if (allActions.length) {
      console.log('\nBlocking a submission (not a packaging defect):');
      allActions.forEach((a, i) => console.log('  ' + (i + 1) + '. ' + a));
    }
    process.exit(fails ? 1 : 0);
  })().catch(e => { console.error(e && e.stack || e); process.exit(1); });
}
