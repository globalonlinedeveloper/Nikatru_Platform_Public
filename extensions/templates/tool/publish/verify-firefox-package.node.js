/* SKELETON — the AMO submission gate. No browser, no dependency.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node publish/verify-firefox-package.node.js
     node publish/verify-firefox-package.node.js --zip publish/<slug>-<v>-firefox.zip

   Grades publish/manifest.firefox.json against Mozilla's current MV3 rules,
   against publish/identity.json (which owns the add-on id), and against the
   Chrome manifest it must stay in step with. It is a SUBMISSION gate, not one
   of the test tiers: it is RED while the owner has not chosen a domain, and
   that is the correct state for a skeleton. Do not add it to the all-green set;
   do add it to the release routine in publish/SUBMISSION.md.

   Sources (Mozilla, read 2026-08-12):
     gecko id format (email-style, ≤80 chars, ^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$,
     or a GUID), strict_min_version, and the data_collection_permissions shape
     and vocabulary
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
     what "collect or transmit" means and how "none" is declared
       https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
     required for new add-ons submitted from 2025-11-03
       https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
     Firefox ignores background.service_worker and runs background.scripts;
     declaring the worker without the scripts fallback is the addons-linter
     ERROR BACKGROUND_SERVICE_WORKER_NOFALLBACK
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
       https://mozilla.github.io/addons-linter/
     minimum_chrome_version is a Chrome-only key, absent from Mozilla's index
       https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version

   THE ONE THAT CANNOT BE UNDONE: AMO fixes an add-on's identity at FIRST
   SIGNING. An id you did not mean is not a typo you correct later — it is an
   add-on that belongs to nobody, permanently, and the only remedy is publishing
   a different add-on and abandoning the install base. So the placeholder check
   here is a hard FAIL, publish/pack.mjs refuses to WRITE a Firefox package
   while it is present, and the id is derived from one field in
   publish/identity.json so it can never be typed twice.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const V = require(path.join(__dirname, 'verify-package.node.js'));
const ROOT = V.ROOT;
const PUBLISH = path.join(ROOT, 'publish');
const FF_PATH = path.join(PUBLISH, 'manifest.firefox.json');
const CH_PATH = path.join(ROOT, 'manifest.json');

const PLACEHOLDER_ID = /REPLACE|\.example$|^$/i;
const GECKO_ID_EMAIL = /^[a-zA-Z0-9\-._]*@[a-zA-Z0-9\-._]+$/;
const GECKO_ID_GUID = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;

/* `required` takes "none" OR one or more of these; `optional` takes these plus
   technicalAndInteraction, and never "none". */
const DATA_TYPES = ['authenticationInfo', 'bookmarksInfo', 'browsingActivity',
  'financialAndPaymentInfo', 'healthInfo', 'locationInfo', 'personalCommunications',
  'personallyIdentifyingInfo', 'searchTerms', 'websiteActivity', 'websiteContent'];
const OPTIONAL_ONLY = ['technicalAndInteraction'];

/* The ONLY top-level keys allowed to differ between the two manifests. Anything
   else that differs is drift, not a port — and drift is how the Firefox build
   quietly stops being the audited product. */
const ALLOWED_DELTA = ['background', 'browser_specific_settings',
  'minimum_chrome_version', 'options_page', 'options_ui'];

let FAILS = 0;
const ACTIONS = [];
function check(label, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null && extra !== '' ? '  — ' + extra : ''));
  if (!ok) FAILS++;
  return !!ok;
}
function gate(label, ok, extra, action) {
  if (!check(label, ok, extra) && action) ACTIONS.push(action);
  return !!ok;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const ff = JSON.parse(fs.readFileSync(FF_PATH, 'utf8'));
const ch = JSON.parse(fs.readFileSync(CH_PATH, 'utf8'));
const identity = JSON.parse(fs.readFileSync(path.join(PUBLISH, 'identity.json'), 'utf8'));
const wantId = String(identity.slug) + '@' + String(identity.ownerDomain);

console.log('=== manifest: parse, version, identity ===');
check('publish/manifest.firefox.json parses', !!ff);
check('manifest_version is 3', ff.manifest_version === 3, ff.manifest_version);
gate('its version is in step with manifest.json', ff.version === ch.version,
  'firefox ' + ff.version + ' vs root ' + ch.version,
  'RELEASE: bump both manifests together — node publish/bump-version.mjs patch does it in one step.');

console.log('\n=== browser_specific_settings.gecko ===');
const gecko = (ff.browser_specific_settings || {}).gecko || {};
const id = String(gecko.id || '');
check('the gecko block is present', !!(ff.browser_specific_settings && ff.browser_specific_settings.gecko));
check('gecko.id is present (AMO cannot sign an MV3 add-on without one)', !!id, id || '(absent)');
gate('gecko.id is NOT a placeholder', !PLACEHOLDER_ID.test(id), id,
  'OWNER: set "ownerDomain" in publish/identity.json to a domain you actually control, then ' +
  'node publish/bump-version.mjs --sync. AMO fixes the add-on identity at FIRST SIGNING — ' +
  'a placeholder that ships once cannot be walked back. Nobody but the owner can pick this.');
gate('gecko.id is exactly what publish/identity.json implies', id === wantId, id + ' vs ' + wantId,
  'FIX: node publish/bump-version.mjs --sync — the id must be derived, never typed.');
check('gecko.id matches Mozilla\'s email-style or GUID format',
  GECKO_ID_EMAIL.test(id) || GECKO_ID_GUID.test(id), id);
check('gecko.id is 80 characters or fewer', id.length <= 80, id.length + ' chars');
check('gecko.strict_min_version is declared', typeof gecko.strict_min_version === 'string', gecko.strict_min_version);
check('gecko.strict_min_version is 115.0 or later (older builds cannot verify signatures since March 2025)',
  parseFloat(gecko.strict_min_version) >= 115, gecko.strict_min_version);
check('no gecko.update_url (a listed AMO add-on must not self-host updates)', !('update_url' in gecko));

console.log('\n=== data_collection_permissions (mandatory for new add-ons since 2025-11-03) ===');
const dcp = gecko.data_collection_permissions;
const okDcp = gate('data_collection_permissions is declared',
  !!dcp && typeof dcp === 'object' && !Array.isArray(dcp), dcp === undefined ? 'absent' : typeof dcp,
  'BLOCKER: add browser_specific_settings.gecko.data_collection_permissions — AMO refuses the submission without it.');
if (okDcp) {
  const req = dcp.required;
  check('required is a non-empty array', Array.isArray(req) && req.length > 0, JSON.stringify(req));
  check('every required value is in Mozilla\'s vocabulary',
    Array.isArray(req) && req.every(v => v === 'none' || DATA_TYPES.indexOf(v) >= 0), JSON.stringify(req));
  check('"none" is never combined with a data type',
    !Array.isArray(req) || req.indexOf('none') < 0 || req.length === 1, JSON.stringify(req));
  /* This family makes zero network calls and nothing it reads leaves the
     machine, so "none" is the honest declaration — and note that it is NOT in
     conflict with telling Google "Website content". Mozilla is asking what you
     COLLECT OR TRANSMIT; Google is asking what you HANDLE, which includes
     reading a page locally. Two questions, two honest answers. The reasoning is
     written out in publish/COMPLIANCE-CHECKLIST.md so the two never look like a
     contradiction to a reviewer or to you. */
  check('this tool declares no data collection (required === ["none"])',
    deepEqual(req, ['none']), JSON.stringify(req));
  if ('optional' in dcp) {
    check('optional holds only known data types',
      Array.isArray(dcp.optional) && dcp.optional.every(v => DATA_TYPES.indexOf(v) >= 0 || OPTIONAL_ONLY.indexOf(v) >= 0),
      JSON.stringify(dcp.optional));
    check('"none" never appears in optional',
      !Array.isArray(dcp.optional) || dcp.optional.indexOf('none') < 0, JSON.stringify(dcp.optional));
  }
}

console.log('\n=== background: the Firefox fallback ===');
const bg = ff.background || {};
check('background.service_worker is declared (the Chrome/Edge path)', typeof bg.service_worker === 'string', bg.service_worker);
gate('background.scripts is declared alongside it (the Firefox path)',
  Array.isArray(bg.scripts) && bg.scripts.length > 0, JSON.stringify(bg.scripts),
  'BLOCKER: service_worker without scripts is the addons-linter ERROR BACKGROUND_SERVICE_WORKER_NOFALLBACK, ' +
  'and it leaves Firefox with no background page at all.');
check('the worker file is LAST in background.scripts (its libraries load before it)',
  Array.isArray(bg.scripts) && bg.scripts[bg.scripts.length - 1] === bg.service_worker,
  Array.isArray(bg.scripts) ? bg.scripts.join(' → ') : '');
(Array.isArray(bg.scripts) ? bg.scripts : []).forEach(s => check('background script exists on disk: ' + s, exists(s)));

/* Every importScripts target in the worker must ALSO be in background.scripts:
   Chrome loads them by calling importScripts, Firefox loads them from the
   manifest, and a library added to one and not the other is a Firefox-only
   ReferenceError that no Chrome test can see. */
{
  const src = V.stripComments(fs.readFileSync(path.join(ROOT, bg.service_worker || 'background.js'), 'utf8'));
  const targets = [];
  const re = /importScripts\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) targets.push(m[1]);
  const missing = targets.filter(t => (bg.scripts || []).indexOf(t) < 0);
  check('every importScripts target is also listed in background.scripts',
    missing.length === 0,
    missing.length ? 'FIREFOX WOULD NOT LOAD: ' + missing.join(', ') : targets.join(', ') || 'none');
}

console.log('\n=== the importScripts guard, in source ===');
{
  const code = V.stripComments(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'));
  const guardAt = code.search(/if\s*\(\s*typeof\s+importScripts\s*[!=]==?\s*['"]function['"]\s*\)/);
  const firstCall = code.indexOf('importScripts(');
  gate('background.js guards importScripts before calling it',
    firstCall < 0 || (guardAt >= 0 && guardAt < firstCall),
    firstCall < 0 ? 'no calls' : (guardAt >= 0 && guardAt < firstCall ? 'guarded in SOURCE, so the packaged file needs no rewriting' : 'UNGUARDED'),
    'BLOCKER: Firefox runs background.js as an event-page script where importScripts is undefined. ' +
    'Unguarded, the add-on throws on load and does nothing at all.');
}

console.log('\n=== keys Firefox must not carry ===');
gate('no minimum_chrome_version (a Chrome Web Store key that means nothing to Gecko)',
  !('minimum_chrome_version' in ff), ff.minimum_chrome_version,
  'FIX: drop "minimum_chrome_version" from publish/manifest.firefox.json.');
check('no developer "key" field', !('key' in ff));
check('no top-level update_url', !('update_url' in ff));
check('options_ui is declared (the Firefox form)', !!(ff.options_ui && typeof ff.options_ui.page === 'string'), JSON.stringify(ff.options_ui));
check('the options page exists on disk', !!(ff.options_ui && exists(ff.options_ui.page)), ff.options_ui && ff.options_ui.page);
check('options_page (the Chrome form) is NOT also present', !('options_page' in ff));

console.log('\n=== permission surface (must match the audited Chrome package) ===');
check('permissions identical to the Chrome manifest', deepEqual(ff.permissions, ch.permissions), JSON.stringify(ff.permissions));
check('no static host_permissions', !('host_permissions' in ff));

console.log('\n=== drift: only the documented deltas may differ ===');
{
  const keys = Array.from(new Set(Object.keys(ff).concat(Object.keys(ch)))).sort();
  const drifted = keys.filter(k => ALLOWED_DELTA.indexOf(k) < 0 && !deepEqual(ff[k], ch[k]));
  check('every key outside the documented delta list is identical',
    drifted.length === 0,
    drifted.length
      ? drifted.map(k => k + ': firefox ' + JSON.stringify(ff[k]) + ' vs root ' + JSON.stringify(ch[k])).join(' | ')
      : keys.length - ALLOWED_DELTA.filter(k => keys.indexOf(k) >= 0).length + ' shared key(s) identical; ' +
        'documented deltas: ' + ALLOWED_DELTA.join(', '));
}

console.log('\n=== package ===');
{
  const argZip = (() => { const i = process.argv.indexOf('--zip'); return i !== -1 ? process.argv[i + 1] : null; })();
  const zipPath = argZip ? path.resolve(argZip)
    : path.join(PUBLISH, identity.slug + '-' + ff.version + '-firefox.zip');
  if (!fs.existsSync(zipPath)) {
    console.log('NOTE  no Firefox package at ' + path.basename(zipPath) + ' — nothing to grade yet.');
    console.log('      publish/pack.mjs refuses to build one while gecko.id is a placeholder, which is why.');
  } else {
    const r = V.verifyPackage({ zipPath, kind: 'firefox', root: ROOT, publishDir: PUBLISH });
    for (const c of r.checks) { if (!c.ok) FAILS++; console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.label + (c.extra ? '  — ' + c.extra : '')); }
    r.actions.forEach(a => ACTIONS.push(a));
  }
}

console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
if (ACTIONS.length) {
  console.log('\n!!! THE FIREFOX PACKAGE IS NOT SUBMITTABLE — ' + ACTIONS.length + ' blocker(s):');
  Array.from(new Set(ACTIONS)).forEach((a, i) => console.log('  ' + (i + 1) + '. ' + a));
  console.log('');
}
process.exit(FAILS ? 1 : 0);
