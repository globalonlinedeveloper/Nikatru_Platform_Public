/* SKELETON — preflight: is this still the skeleton?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node publish/preflight.mjs

   THE MACHINE HALF OF TEMPLATE.md's FINAL CHECKLIST. Everything in that list
   that a script can decide, decided by a script — because a checklist executed
   67 times, mostly by an agent, mostly with nobody reading the output, is a
   checklist whose items get declared done by judgement.

   THIS SCRIPT IS RED IN THE SKELETON, ON PURPOSE. It is not one of the test
   tiers and it must never be added to the all-green set. Its whole job is to
   answer "has this copy actually become a tool yet?", and for _skeleton itself
   the honest answer is no. Every red it prints is a specialisation step
   somebody has not done; when it goes green, the two test tiers are green and
   the package builds, you are looking at a submittable item.

   It scans exactly the file set publish/pack.mjs would SHIP — not the folder —
   so a placeholder that survives only in a file nobody packages does not block
   a release, and one that reaches a user always does.
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { collect, ROOT, readIdentity, geckoIdFor, isPlaceholderId } from './pack.mjs';
import { versionProblems, currentVersion } from './bump-version.mjs';

const require_ = createRequire(import.meta.url);
const V = require_(path.join(ROOT, 'publish', 'verify-package.node.js'));

let TODO = [];
let PASSES = 0;
function ok(label, extra) { PASSES++; console.log('PASS  ' + label + (extra ? '  — ' + extra : '')); }
function todo(label, what) {
  TODO.push({ label, what });
  console.log('TODO  ' + label + (what ? '  — ' + what : ''));
}
function grade(label, isDone, doneExtra, todoExtra) {
  if (isDone) ok(label, doneExtra); else todo(label, todoExtra);
  return isDone;
}

const readIf = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return null; } };
const shipped = collect();
const textShipped = shipped.filter(f => /\.(js|html|css|json)$/i.test(f) || f === 'LICENSE');

function hits(re, files) {
  const out = [];
  for (const f of files) {
    const src = readIf(f);
    if (src == null) continue;
    const m = src.match(re);
    if (m) out.push(f + ' ×' + m.length);
  }
  return out;
}
const show = a => a.slice(0, 5).join(', ') + (a.length > 5 ? ' +' + (a.length - 5) + ' more' : '');

console.log('preflight — ' + shipped.length + ' files would ship\n');

console.log('=== identity ===');
const identity = readIdentity();
grade('publish/identity.json names a domain you control',
  !isPlaceholderId(String(identity.ownerDomain)) && !!identity.ownerDomain,
  identity.ownerDomain,
  'ownerDomain is "' + identity.ownerDomain + '". The Firefox add-on id is derived from it and AMO ' +
  'fixes that identity at FIRST SIGNING — it cannot be corrected later.');
grade('the slug is the tool\'s, not the skeleton\'s',
  identity.slug && identity.slug !== 'skeleton', identity.slug, 'slug is still "skeleton"');
grade('a support email is set',
  !isPlaceholderId(String(identity.supportEmail)) && /@/.test(String(identity.supportEmail)),
  identity.supportEmail, 'supportEmail is still a placeholder — the store shows this to users');
grade('the privacy policy URL is set and is https',
  /^https:\/\//.test(String(identity.privacyPolicyUrl)) && !isPlaceholderId(String(identity.privacyPolicyUrl)),
  identity.privacyPolicyUrl,
  'privacyPolicyUrl is still a placeholder. publish/PRIVACY-POLICY.html must be HOSTED and the URL ' +
  'pasted into the store listing — there is no publish button without it.');
grade('the derived Firefox add-on id is real',
  !isPlaceholderId(geckoIdFor(identity)), geckoIdFor(identity), geckoIdFor(identity));

console.log('\n=== the skeleton\'s own marks ===');
const ph = hits(/PLACEHOLDER\([a-z-]+\)/g, textShipped);
grade('no PLACEHOLDER( tag survives in anything that ships', ph.length === 0,
  'clean', show(ph) + ' — each one is an edit point TEMPLATE.md told you about');
const skel = hits(/skeleton|replace me/gi, textShipped);
grade('no "skeleton" or "replace me" literal survives in anything that ships', skel.length === 0,
  'clean', show(skel));
const slots = hits(/⟨[A-Z_]+⟩/g, ['LICENSE'].concat(
  ['publish/PRIVACY-POLICY.html', 'publish/STORE-LISTING.md', 'publish/SUBMISSION.md', 'publish/COMPLIANCE-CHECKLIST.md']
    .filter(f => readIf(f) !== null)));
grade('every ⟨SLOT⟩ in the licence and the publish documents is filled', slots.length === 0,
  'clean', show(slots));

console.log('\n=== the demo feature has an expiry date ===');
/* The shipped shell does one small real thing so its patterns are live code
   rather than stubs. That is scaffolding, not an example to build BESIDE: an
   item whose listing describes table extraction and whose popup also offers an
   unrelated "copy the page title" button, plus a "copy on open" preference, is
   a single-purpose violation — one of the top rejection reasons there is, and
   one judged on what the item does rather than on what the listing says. */
const demo = hits(/read-title|copy-title|runReadTitle|describeTab|copyOnOpen/g, textShipped);
grade('the demo read-title / copy-title feature has been replaced by the real one',
  demo.length === 0, 'gone',
  show(demo) + ' — scaffolding, not a second feature. Delete it, including its options row.');
const dbName = /const\s+DB_NAME\s*=\s*'([^']+)'/.exec(readIf('lib/storage.js') || '');
grade('the IndexedDB database has the tool\'s own name',
  !!dbName && dbName[1] !== 'skeleton', dbName && dbName[1], 'DB_NAME is still "skeleton"');

console.log('\n=== provenance ===');
/* Nothing stamps which skeleton a tool came from unless the copy step does it,
   and retro-stamping is guesswork: by then the copies have diverged for real
   reasons and accidental ones and telling them apart means reading 1,600 lines
   of inherited test code per tool. It is one file and it is checked here
   because it is a step, not a preference. */
const prov = (() => { try { return JSON.parse(readIf('skeleton.json')); } catch (_) { return null; } })();
grade('skeleton.json records which tool this is and when it was copied',
  !!prov && !!prov.tool && /^\d{4}-\d{2}-\d{2}/.test(String(prov.copiedAt)),
  prov ? prov.tool + ' from skeleton v' + prov.skeletonVersion + ' on ' + prov.copiedAt : 'missing',
  prov ? 'skeleton.json has no "tool"/"copiedAt" — stamp them (TEMPLATE.md step 0), do NOT touch skeletonVersion'
       : 'skeleton.json is missing entirely');
grade('CHANGELOG-skeleton.md has been deleted (it is the skeleton\'s history, not your tool\'s)',
  !fs.existsSync(path.join(ROOT, 'CHANGELOG-skeleton.md')), 'gone',
  'still present — it belongs to _skeleton');
grade('HANDOFF.md has a real session entry, not just the template',
  !!readIf('HANDOFF.md') && !/^# HANDOFF — ⟨TOOL⟩/m.test(readIf('HANDOFF.md') || ''),
  'in use',
  'still the ⟨TOOL⟩ template — every session appends one entry, and it is the only place decisions survive');

console.log('\n=== store assets ===');
/* CWS will not accept a submission without a screenshot at exactly 1280x800 or
   640x400, and wrong dimensions are an upload rejection rather than a nag. Both
   are generated, so neither is a reason to open an image editor. */
const shots = (() => {
  try { return fs.readdirSync(path.join(ROOT, 'publish', 'store')).filter(f => /\.png$/i.test(f)); }
  catch (_) { return []; }
})();
grade('publish/store/ holds at least one listing screenshot',
  shots.some(f => /^screenshot-(1280x800|640x400)-/.test(f)),
  shots.filter(f => f.indexOf('screenshot-') === 0).join(', '),
  'run: node publish/shots.mjs   (1280x800, from the real browser, so it cannot drift from the product)');
grade('publish/store/ holds the 440x280 promo tile',
  shots.indexOf('promo-tile-440x280.png') >= 0, 'present',
  'run: node icons/make-icons.mjs --promo "Your Tool"   — items without one rank poorly in browse');

console.log('\n=== documents ===');
grade('TEMPLATE.md has been deleted (it is the skeleton\'s instructions, not your tool\'s)',
  !fs.existsSync(path.join(ROOT, 'TEMPLATE.md')), 'gone',
  'still present — work through it, then delete it');
const readme = readIf('README.md');
grade('README.md has been rewritten for this tool',
  !!readme && !/the starting point for every tool in this family/.test(readme), 'rewritten',
  'still opens with the skeleton\'s own first sentence');
grade('CHANGELOG.md has an entry for the current version',
  !!readIf('CHANGELOG.md') && versionProblems().every(p => p.indexOf('CHANGELOG') < 0),
  'v' + currentVersion(), versionProblems().filter(p => p.indexOf('CHANGELOG') >= 0).join(' | '));
grade('LICENSE names a licensor',
  !/⟨LICENSOR⟩/.test(readIf('LICENSE') || '⟨LICENSOR⟩'), 'named', 'LICENSE still says ⟨LICENSOR⟩');

console.log('\n=== manifest, against the store\'s upload rules ===');
{
  const mf = JSON.parse(readIf('manifest.json'));
  const cats = {};
  let hasLocales = false;
  try {
    for (const d of fs.readdirSync(path.join(ROOT, '_locales'), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(ROOT, '_locales', d.name, 'messages.json');
      if (fs.existsSync(p)) { cats[d.name] = JSON.parse(fs.readFileSync(p, 'utf8')); hasLocales = true; }
    }
  } catch (_) {}
  const gates = V.manifestGates(mf, { catalogues: cats, hasLocales, storeListing: readIf('publish/STORE-LISTING.md') });
  for (const g of gates) grade(g.label, g.ok, g.extra, g.extra);
  grade('the version is no longer the skeleton\'s 0.0.1', mf.version !== '0.0.1', mf.version,
    'still 0.0.1 — 0.1.0 is the conventional first real build');
  const problems = versionProblems();
  grade('every version site agrees', problems.length === 0,
    'manifest.json, publish/manifest.firefox.json, CHANGELOG.md', problems.join(' | '));
}

console.log('\n' + PASSES + ' ready, ' + TODO.length + ' outstanding');
if (TODO.length) {
  console.log('\nNOT SUBMITTABLE — ' + TODO.length + ' thing(s) a human must do:');
  TODO.forEach((t, i) => console.log('  ' + (i + 1) + '. ' + t.label + (t.what ? '\n       ' + t.what : '')));
  console.log('\n(In _skeleton itself this list is SUPPOSED to be long. It is the specialisation\n' +
    ' procedure in TEMPLATE.md, restated by a script that cannot be talked into skipping a step.)');
}
process.exit(TODO.length ? 1 : 0);
