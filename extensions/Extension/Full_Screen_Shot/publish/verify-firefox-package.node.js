/* FullShot Firefox (AMO) package verification. No browser, no dependencies.
   Grades the EFFECTIVE Firefox manifest against Mozilla's current MV3 rules,
   against the Chrome manifest it must stay in step with, and — when the
   matching package exists — against the zip itself. Any blocker exits non-zero:
   the Firefox submission must not be able to happen by accident.

     node publish/verify-firefox-package.node.js
     node publish/verify-firefox-package.node.js --zip publish/fullshot-1.10.2-firefox.zip

   🔴 REWRITTEN 2026-08-20, BECAUSE IT WAS GRADING THE WRONG DOCUMENT.
   On 2026-08-18 publish/manifest.firefox.json stopped being a full second
   manifest and became an RFC 7386 MERGE PATCH — which is what scripts/pack.mjs
   applies to build the Firefox package. This script went on reading it as a
   whole manifest, and the result was not a quiet wrong answer but a loud one:
   22 failures and 3 "blockers", of which 19 failures and 2 blockers were the
   script misreading a patch. It reported, among others:

     · "manifest_version is 3"      FAIL — the patch does not restate it
     · "name is present"            FAIL — likewise
     · "version === root version"   FAIL — "firefox undefined vs root 1.10.2",
                                    and told the owner to bump a field that no
                                    longer exists in that file
     · "no minimum_chrome_version"  FAIL — the patch carries
                                    `"minimum_chrome_version": null`, which is
                                    RFC 7386 for DELETE THIS KEY. The guard read
                                    the key as PRESENT and demanded it be
                                    dropped — i.e. it demanded the removal of
                                    the very line that removes it.
     · 11 × "identical to the Chrome manifest: <key>" FAIL — every key the patch
                                    inherits rather than restates.

   A guard that fails this loudly on a correct tree is worse than one that is
   merely absent: it trains everybody to read its output as noise, and the ONE
   real blocker in that wall of red (the importScripts guard, below) had been
   sitting in it unread.

   SO IT NOW MERGES FIRST AND GRADES THE RESULT. The subject is the manifest
   Firefox will actually see, which is the only document any of these rules are
   about. The patch itself is still graded, for the two properties that are
   properties OF a patch: that it is a JSON object, and that it does not pin a
   `version` (see the version limb).

   ⚠️ IT NOW DIFFERS FROM templates/tool/publish/verify-firefox-package.node.js
   ON PURPOSE — DO NOT "SYNC" THEM. The skeleton still uses the ORIGINAL design:
   its publish/manifest.firefox.json is a full second manifest and its
   publish/pack.mjs has no merge step at all, so a full-manifest grader is the
   correct grader THERE. FullShot migrated to the merge-patch model on
   2026-08-18 and this file is catching up with its own tool. Checked 2026-08-20:
   nothing in scripts/ or .github/workflows asserts the two are identical, so the
   divergence breaks no guard — but a future pass that "restores consistency" by
   copying one over the other would silently break whichever tool it landed on.
   Migrating the skeleton is a separate change, and it is the overlay and
   pack.mjs that would move first.

   NOT one of the eight test tiers, and no longer "RED by design": the owner
   replaced the placeholder add-on id on 2026-08-18, and the importScripts guard
   — the one real blocker left in the wall of red — landed 2026-08-20. It is
   GREEN, and `.github/workflows/ci.yml` now runs it, which it never did before.

   Sources (Mozilla, read 2026-08-12):
     browser_specific_settings.gecko — id format/length, strict_min_version,
     data_collection_permissions shape and the data-type vocabulary
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
     what "collect or transmit" means, and the "none" declaration
       https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
     required for new add-ons submitted from 2025-11-03
       https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
     background: Firefox ignores service_worker and runs scripts; ship both
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
     BACKGROUND_SERVICE_WORKER_NOFALLBACK (error) / _IGNORED (warning)
       https://mozilla.github.io/addons-linter/
     minimum_chrome_version is a Chrome-only key (absent from Mozilla's
     manifest.json key index)
       https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const FF_PATH = path.join(__dirname, 'manifest.firefox.json');
const CH_PATH = path.join(ROOT, 'manifest.json');

/* The placeholder shipped in the first Firefox manifest. It is not a domain the
   owner controls, so an add-on signed under it would be signed under a name
   belonging to nobody — this is the reason the script exists. */
const PLACEHOLDER_ID = /REPLACE-WITH-YOUR-DOMAIN|\.example$/i;
/* MDN: email-style id, 80 characters or less. */
const GECKO_ID_RE = /^[a-zA-Z0-9\-._]*@[a-zA-Z0-9\-._]+$/;

/* MDN browser_specific_settings: `required` takes "none" OR one or more of
   these; `optional` takes these plus technicalAndInteraction. */
const DATA_TYPES = ['authenticationInfo', 'bookmarksInfo', 'browsingActivity',
  'financialAndPaymentInfo', 'healthInfo', 'locationInfo', 'personalCommunications',
  'personallyIdentifyingInfo', 'searchTerms', 'websiteActivity', 'websiteContent'];
const OPTIONAL_ONLY = ['technicalAndInteraction'];

/* Top-level keys allowed to differ between the Chrome and Firefox manifests.
   Anything else that differs is drift, not a port. */
const ALLOWED_DELTA = ['background', 'browser_specific_settings',
  'content_security_policy', 'minimum_chrome_version', 'options_page', 'options_ui'];
/* `content_security_policy` added 2026-08-26, when manifest.json began declaring one
   and publish/manifest.firefox.json began deleting it with an RFC 7386 null member.
   THIS IS A CLASSIFICATION, NOT A RELAXATION, and the check that matters is untouched:
   the absent-check above still asserts Firefox carries NO CSP at all, which is
   strictly stronger than the drift limb's "identical to Chrome" ever was. Without
   this entry the two limbs are MUTUALLY UNSATISFIABLE — inherit the key and the
   absent-check fails; delete it and the drift limb calls the deletion drift — so a
   correct tree could not be green either way. `minimum_chrome_version` sits in both
   lists for exactly the same reason and is the precedent. */

let FAILS = 0;
/* Whether the PACKAGE limb actually opened a zip. A run that graded no package
   has not verified a package, and must not print the same summary as one that
   did — see the summary block at the bottom. */
let PACKAGE_GRADED = true;
const ACTIONS = [];
function check(label, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
  return !!ok;
}
/* A check that, when it fails, also parks a named action in the loud summary. */
function gate(label, ok, extra, action) {
  if (!check(label, ok, extra) && action) ACTIONS.push(action);
  return !!ok;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
const exists = rel => fs.existsSync(path.join(ROOT, rel));

/* RFC 7386 §2, all of it: a null member DELETES, an object member merges
   recursively, anything else replaces. Arrays replace wholesale — which is what
   lets the overlay state background.scripts at all.

   ⚠️ THIS IS A SECOND COPY. scripts/pack.mjs carries the same eight lines and is
   the one that BUILDS the package; this file only GRADES it, and it is CommonJS
   with no dependencies by design while that one is ESM, so importing across is
   not free. Two implementations of one spec is exactly how one of them starts
   certifying something the other never produced — so this copy does not ask to
   be trusted. It SELF-TESTS against RFC 7386's own worked examples on every run,
   below, and a divergence stops the script before it grades anything. */
function mergePatch(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (base !== null && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete out[key];
    else out[key] = mergePatch(out[key], patch[key]);
  }
  return out;
}

/* Straight out of RFC 7386 §3's example table. The `null` rows are the ones
   that matter here: they are the semantics the OLD version of this script did
   not implement, and getting them wrong is what produced the "drop
   minimum_chrome_version" blocker against a file whose whole job was to drop
   minimum_chrome_version. */
(function selfTestMergePatch() {
  const cases = [
    [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
    [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
    [{ a: 'b' }, { a: null }, {}],
    [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
    [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
    [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
    [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
  ];
  const bad = [];
  cases.forEach((c, i) => {
    const got = JSON.stringify(mergePatch(c[0], c[1]));
    const want = JSON.stringify(c[2]);
    if (got !== want) bad.push('  case ' + i + ': got ' + got + ', expected ' + want);
  });
  if (bad.length) {
    console.error('\nCANNOT RUN — this file\'s RFC 7386 merge does not implement RFC 7386:');
    bad.forEach(l => console.error(l));
    console.error('Everything below grades the MERGED manifest, so a wrong merge would grade a document');
    console.error('that is not the one Firefox receives. Refusing rather than reporting on it.');
    process.exit(2);
  }
}());

/* Minimal zip reader: central directory walk + inflateRaw. Enough to read the
   packaged manifest and background.js and to list entries for a leak check. */
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

/* Chrome runs background.js as a service worker (importScripts exists); Firefox
   runs it as an event-page script where importScripts is undefined and the two
   helpers arrive via background.scripts instead. Unguarded, the file throws on
   load in Firefox and the add-on is dead. */
/* 🔴 COMMENTS AND STRINGS ARE STRIPPED FIRST, AND THAT IS NOT TIDINESS — THIS
   DETECTOR BIT ON ITS OWN DOCUMENTATION ON 2026-08-20. It used to scan the raw
   source for `typeof importScripts` before the first `importScripts(`. The
   guard was then added to background.js together with a comment explaining it,
   and the comment contains the words "importScripts() is how the two helpers
   arrive" — an `importScripts(` occurrence EARLIER in the file than the guard.
   So the correctly-guarded file was reported unguarded, and the recommended fix
   would have been to write a worse comment.

   That is this corpus's single most repeated defect wearing the costume of the
   check that exists to catch it — the same class as the grep that matched the
   template comment explaining why there are no r2_buckets. A scan for CODE must
   look at code. */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++;
      out += '""';
      continue;
    }
    out += c; i++;
  }
  return out;
}

function importScriptsGuarded(src) {
  const code = stripCommentsAndStrings(src);
  const guard = code.indexOf('typeof importScripts');
  const first = code.indexOf('importScripts(');
  return guard !== -1 && first !== -1 && guard < first;
}

/* The detector's own two canaries, run on every invocation. A scanner that
   quietly stopped scanning reports exactly what a clean file reports, so this
   proves it can still say BOTH words before it is allowed to say either about
   the real source. */
(function selfTestGuardDetector() {
  const guarded = '/* importScripts() in prose */\nif (typeof importScripts === "function") { importScripts("a.js"); }\n';
  const unguarded = '/* a comment mentioning typeof importScripts */\nimportScripts("a.js");\n';
  const bad = [];
  if (!importScriptsGuarded(guarded)) bad.push('  a genuinely guarded file, with the words in a comment first, read as UNGUARDED');
  if (importScriptsGuarded(unguarded)) bad.push('  an unguarded file, with the guard words only in a comment, read as GUARDED');
  if (bad.length) {
    console.error('\nCANNOT RUN — the importScripts detector failed its own self-test:');
    bad.forEach(l => console.error(l));
    console.error('It would report on background.js without being able to tell the two apart.');
    process.exit(2);
  }
}());

console.log('\n=== the overlay: a well-formed RFC 7386 merge patch ===');
const patch = JSON.parse(fs.readFileSync(FF_PATH, 'utf8'));
const ch = JSON.parse(fs.readFileSync(CH_PATH, 'utf8'));
check('publish/manifest.firefox.json parses', !!patch);
/* A top-level null or array REPLACES the whole manifest rather than patching
   it, which would silently produce a Firefox manifest with nothing in it.
   pack.mjs refuses the same shape for the same reason. */
if (!gate('the overlay is a JSON OBJECT (a merge patch, not a replacement)',
  patch !== null && typeof patch === 'object' && !Array.isArray(patch),
  Array.isArray(patch) ? 'array' : patch === null ? 'null' : typeof patch,
  'BLOCKER: publish/manifest.firefox.json must be a JSON object. Under RFC 7386 a top-level null or array REPLACES the entire manifest, so the Firefox package would ship with no manifest content at all.')) {
  console.log('\nFAILURES: ' + FAILS + ' — the overlay cannot be applied, so nothing below could be graded.');
  process.exit(1);
}

/* 🔴 THE SUBJECT OF EVERY RULE BELOW. This is the manifest Firefox receives:
   the Chrome manifest with the overlay applied, which is byte-for-byte what
   scripts/pack.mjs writes into the Firefox zip. Grading the overlay instead —
   what this script did until 2026-08-20 — asks Mozilla's rules of a document
   that is not a manifest and was never meant to be one. */
const ff = mergePatch(ch, patch);

console.log('\n=== manifest: parse + identity (of the MERGED manifest) ===');
check('manifest_version is 3', ff.manifest_version === 3, ff.manifest_version);
check('name is present', typeof ff.name === 'string' && ff.name.length > 0, ff.name);

console.log('\n=== version: in step with the root manifest ===');
/* ⚠️ THIS LIMB INVERTED ON 2026-08-20 AND IS STRONGER FOR IT. It used to
   require the second manifest's `version` to EQUAL the root's, and parked a
   blocker telling the owner to bump both in one commit — a rule that depends on
   remembering, which this corpus has established will eventually be forgotten.
   A merge patch that stays silent about `version` INHERITS it, so the two can
   no longer disagree by construction. The check is therefore that the overlay
   does NOT pin one; equality is then a fact rather than a habit. */
gate('the overlay does not pin its own "version"',
  !('version' in patch), 'version' in patch ? JSON.stringify(patch.version) : 'inherited',
  'FIX: delete "version" from publish/manifest.firefox.json. A merge patch that omits it inherits manifest.json\'s, so the two can never drift; pinning it re-creates the "shipped 1.10.1 with 1.10.0 in the AMO manifest" class of bug that this file exists to prevent.');
check('merged version === manifest.json version', ff.version === ch.version,
  'merged ' + ff.version + ' vs root ' + ch.version);

console.log('\n=== browser_specific_settings.gecko ===');
const gecko = (ff.browser_specific_settings && ff.browser_specific_settings.gecko) || {};
check('gecko block present', !!ff.browser_specific_settings && !!ff.browser_specific_settings.gecko);
check('gecko.id present (AMO requires one for MV3 signing)', typeof gecko.id === 'string' && !!gecko.id, gecko.id);
gate('gecko.id is NOT the placeholder', !PLACEHOLDER_ID.test(String(gecko.id || '')), gecko.id,
  'OWNER: replace browser_specific_settings.gecko.id in publish/manifest.firefox.json with an email-style id on a domain you actually control (e.g. fullshot@yourdomain.tld). The current value is a placeholder — DO NOT submit to AMO until it is replaced. Nobody but the owner can pick this.');
check('gecko.id matches Mozilla\'s email-style format', GECKO_ID_RE.test(String(gecko.id || '')), gecko.id);
check('gecko.id is 80 characters or less', String(gecko.id || '').length <= 80, String(gecko.id || '').length);
check('gecko.strict_min_version present', typeof gecko.strict_min_version === 'string', gecko.strict_min_version);
check('gecko.update_url absent (listed AMO add-ons must not self-host updates)', !('update_url' in gecko));

console.log('\n=== data_collection_permissions (required for new add-ons since 2025-11-03) ===');
const dcp = gecko.data_collection_permissions;
const okDcp = gate('data_collection_permissions declared', !!dcp && typeof dcp === 'object' && !Array.isArray(dcp),
  dcp === undefined ? 'absent' : typeof dcp,
  'BLOCKER: add browser_specific_settings.gecko.data_collection_permissions — AMO refuses the submission without it.');
if (okDcp) {
  const req = dcp.required;
  check('required is a non-empty array', Array.isArray(req) && req.length > 0, JSON.stringify(req));
  const reqOk = Array.isArray(req) && req.every(v => v === 'none' || DATA_TYPES.indexOf(v) !== -1);
  check('every required value is in Mozilla\'s vocabulary', reqOk, JSON.stringify(req));
  check('"none" is not combined with other data types',
    !Array.isArray(req) || req.indexOf('none') === -1 || req.length === 1, JSON.stringify(req));
  /* FullShot makes zero network calls and nothing it reads leaves the machine,
     so "none" is the honest declaration. If the product ever starts collecting
     or transmitting, this check is the place that should force the conversation. */
  check('FullShot declares no data collection (required === ["none"])',
    deepEqual(req, ['none']), JSON.stringify(req));
  if ('optional' in dcp) {
    const opt = dcp.optional;
    check('optional is an array of known data types',
      Array.isArray(opt) && opt.every(v => DATA_TYPES.indexOf(v) !== -1 || OPTIONAL_ONLY.indexOf(v) !== -1),
      JSON.stringify(opt));
    check('"none" does not appear in optional', !Array.isArray(opt) || opt.indexOf('none') === -1, JSON.stringify(opt));
  }
}

console.log('\n=== background: the Firefox fallback ===');
/* ⚠️ REWRITTEN 2026-08-20 WITH THE OVERLAY. The old limb required the Firefox
   manifest to declare `service_worker` AND `scripts`, which was right when the
   file was a full second manifest carrying both. The overlay now DELETES
   service_worker (`"service_worker": null`), so the merged manifest has only
   `scripts` — and that is the better shape, not a regression: Firefox ignores
   service_worker and addons-linter raises BACKGROUND_SERVICE_WORKER_IGNORED for
   carrying one. The linter ERROR this limb really guards against is
   NOFALLBACK — a service_worker with NO scripts — and that is still checked. */
const bg = ff.background || {};
const chSw = (ch.background && ch.background.service_worker) || null;
gate('background.scripts declared (the Firefox path)',
  Array.isArray(bg.scripts) && bg.scripts.length > 0, JSON.stringify(bg.scripts),
  'BLOCKER: the merged Firefox manifest has no background.scripts. Firefox ignores background.service_worker, so this leaves the add-on with no background at all — and a service_worker without scripts is the addons-linter ERROR BACKGROUND_SERVICE_WORKER_NOFALLBACK.');
check('background.service_worker is NOT carried into Firefox (the overlay deletes it)',
  !('service_worker' in bg), bg.service_worker);
/* The load order still matters and is still checked — against the ROOT
   manifest's service-worker file, which is the one that must run LAST because
   the others define the globals it uses. */
check('the Chrome service-worker file is last in background.scripts',
  Array.isArray(bg.scripts) && chSw !== null && bg.scripts[bg.scripts.length - 1] === chSw,
  Array.isArray(bg.scripts) ? bg.scripts.join(', ') + '  (root service_worker: ' + chSw + ')' : '');
(Array.isArray(bg.scripts) ? bg.scripts : []).forEach(s =>
  check('background script resolves on disk: ' + s, exists(s)));

console.log('\n=== keys Firefox must not carry ===');
/* ⚠️ THE FIX TEXT CHANGED ON 2026-08-20 AND THE OLD ONE WAS ACTIVELY WRONG. It
   said "drop minimum_chrome_version from publish/manifest.firefox.json" — but
   that file carries `"minimum_chrome_version": null`, which is RFC 7386 for
   DELETE THIS KEY, i.e. it is the line that already removes it. Doing as the
   old message said would have PUT THE KEY BACK in the merged manifest. That is
   what grading a patch as a manifest costs: not a missed problem, an inverted
   instruction. */
gate('no minimum_chrome_version (Chrome-only key, not in Mozilla\'s manifest index)',
  !('minimum_chrome_version' in ff), ff.minimum_chrome_version,
  'FIX: the merged Firefox manifest still carries "minimum_chrome_version". Add `"minimum_chrome_version": null` to publish/manifest.firefox.json — under RFC 7386 a null member DELETES the key. Do NOT simply remove the line: an absent member INHERITS the Chrome value.');
check('no developer "key" field', !('key' in ff));
check('no top-level update_url', !('update_url' in ff));
check('no content_security_policy override (strict MV3 default applies)', !('content_security_policy' in ff));

console.log('\n=== permissions surface (must match the audited Chrome package) ===');
check('permissions identical to the Chrome manifest', deepEqual(ff.permissions, ch.permissions), JSON.stringify(ff.permissions));
check('no static host_permissions (broad access stays optional)', !('host_permissions' in ff));
check('optional_host_permissions is ["<all_urls>"]', deepEqual(ff.optional_host_permissions, ['<all_urls>']), JSON.stringify(ff.optional_host_permissions));

console.log('\n=== options surface ===');
check('options_ui declared (the Firefox form)', !!ff.options_ui && typeof ff.options_ui.page === 'string', JSON.stringify(ff.options_ui));
check('options page resolves on disk', !!ff.options_ui && exists(ff.options_ui.page), ff.options_ui && ff.options_ui.page);
check('options_page (the Chrome form) is not also present', !('options_page' in ff));

console.log('\n=== reference integrity (every path in the manifest exists) ===');
const refs = [];
if (ff.action && ff.action.default_popup) refs.push(ff.action.default_popup);
Object.keys((ff.action && ff.action.default_icon) || {}).forEach(k => refs.push(ff.action.default_icon[k]));
Object.keys(ff.icons || {}).forEach(k => refs.push(ff.icons[k]));
refs.forEach(r => check('resolves: ' + r, exists(r)));

console.log('\n=== drift: only the documented Firefox deltas may differ ===');
const keys = Array.from(new Set(Object.keys(ff).concat(Object.keys(ch)))).sort();
keys.filter(k => ALLOWED_DELTA.indexOf(k) === -1).forEach(k =>
  check('identical to the Chrome manifest: ' + k, deepEqual(ff[k], ch[k]),
    deepEqual(ff[k], ch[k]) ? null : 'firefox ' + JSON.stringify(ff[k]) + ' vs root ' + JSON.stringify(ch[k])));

console.log('\n=== build prerequisite: the importScripts guard ===');
const srcBg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const srcGuarded = importScriptsGuarded(srcBg);
check('source background.js guards importScripts', srcGuarded,
  srcGuarded ? null : 'unguarded — Chrome-only as it stands');

console.log('\n=== package ===');
const argZip = (() => { const i = process.argv.indexOf('--zip'); return i !== -1 ? process.argv[i + 1] : null; })();
const zipPath = argZip ? path.resolve(argZip)
  : path.join(__dirname, 'fullshot-' + ff.version + '-firefox.zip');
if (!fs.existsSync(zipPath)) {
  PACKAGE_GRADED = false;
  console.log('NOTE  no Firefox package at ' + path.basename(zipPath) + ' — nothing to grade yet.');
  /* Phrased as the property, not as the disaster: this line used to read
     "a Firefox package built from unguarded source would be dead on load",
     which is a sentence that reads as a WARNING when prefixed with PASS. A
     label has to be true in both directions or the log misleads whichever way
     it goes. */
  gate('the source this package would be built from guards importScripts', srcGuarded, null,
    'BUILD: source background.js still calls importScripts() unguarded. scripts/pack.mjs copies it verbatim, so the Firefox zip would throw ReferenceError on load and the add-on would be dead. Wrap the calls in `if (typeof importScripts === "function")`.');
} else {
  console.log('      ' + path.basename(zipPath));
  let entries = null;
  try { entries = readZip(zipPath); } catch (e) { check('package reads as a zip', false, e.message); }
  if (entries) {
    check('package reads as a zip', true, entries.size + ' entries');
    const zipped = entries.get('manifest.json');
    check('package contains manifest.json', !!zipped);
    if (zipped) {
      let pm = null;
      try { pm = JSON.parse(zipped.toString('utf8')); } catch (e) { check('packaged manifest parses', false, e.message); }
      if (pm) {
        check('packaged manifest parses', true);
        /* ⚠️ THIS COMPARISON ONLY BECAME MEANINGFUL ON 2026-08-20. `ff` used to
           be the raw overlay, so this asked whether a full packaged manifest
           equalled a merge patch — a question whose answer is always "no" once
           the overlay stopped restating every key. It is now the MERGED
           manifest, which is exactly what scripts/pack.mjs writes into the zip,
           so the two really are comparable and a difference really is a stale
           or hand-built package. */
        gate('packaged manifest === the merged Firefox manifest', deepEqual(pm, ff),
          'packaged version ' + pm.version,
          'BUILD: the zip\'s manifest.json differs from manifest.json + publish/manifest.firefox.json applied as a merge patch. The package is stale or was not built by scripts/pack.mjs — rebuild it.');
      }
    }
    const zbg = entries.get('background.js');
    check('package contains background.js', !!zbg);
    if (zbg) gate('packaged background.js guards importScripts',
      importScriptsGuarded(zbg.toString('utf8')), null,
      'BUILD: the packaged background.js calls importScripts() unguarded — it will throw on load in Firefox.');
    const leak = Array.from(entries.keys()).filter(n =>
      /^(test|Reference)\//.test(n) || /\.md$/i.test(n) || /\.node\.js$/i.test(n) ||
      /node_modules\//.test(n) || /DELETE/i.test(n));
    check('no test/dev/scratch files in the package', leak.length === 0, leak.join(', '));
  }
}

/* 🔴 "ALL PASS" OVER A SET THAT EXCLUDED THE PACKAGE IS THE VACUOUS GREEN, and
   this file printed it until 2026-08-20. With no zip on disk the summary of a
   run that inspected NO PACKAGE was byte-identical to one that inspected a good
   package — the `NOTE  no Firefox package … nothing to grade yet` above said so,
   and a NOTE above a green summary is precisely the line nobody reads.

   It became reachable, not merely theoretical, the same day: the six built
   Firefox zips were deleted, so the default `--zip` path stopped resolving and
   every bare run took this branch. A packaging gate that reports ALL PASS with
   no package to inspect will greenlight an unbuilt release.

   Same rule the rest of this family already follows — an empty subject and a
   verified subject must never print the same words. */
if (FAILS) {
  console.log('\nFAILURES: ' + FAILS);
} else if (PACKAGE_GRADED) {
  console.log('\nALL PASS');
} else {
  console.log('\nSOURCE PASSES — NO PACKAGE WAS GRADED.');
  console.log('Every check above ran against the source tree. The package limb opened nothing, so this run');
  console.log('says nothing about any zip. Build one and point this at it:');
  console.log('  node scripts/pack.mjs fullshot --target firefox --out dist');
  console.log('  node Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js --zip dist/fullshot-firefox.zip');
}
if (ACTIONS.length) {
  console.log('\n!!! THE FIREFOX PACKAGE IS NOT SUBMITTABLE — ' + ACTIONS.length + ' blocker(s):');
  ACTIONS.forEach((a, i) => console.log('  ' + (i + 1) + '. ' + a));
  console.log('');
}
process.exit(FAILS ? 1 : 0);
