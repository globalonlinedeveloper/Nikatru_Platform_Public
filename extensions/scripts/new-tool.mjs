/* new-tool.mjs — stamp a new tool from the template.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest
     node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest --dry-run

   Copies the template, stamps the four facts that must be right on day one, and
   writes the tool.json that makes the monorepo see it. Everything else — the
   strings, the code, the icons, the listing — is TEMPLATE.md's job, and this
   script deliberately does not pretend to do it.

   WHICH TEMPLATE

     templates/tool/   if it exists   (the name spec §1.2 gives it, and where
                                       the template actually lives since the
                                       move recorded in ref/pre-prune-2026-09-08:extensions/MIGRATION.md)
     _skeleton/        otherwise      (the pre-move location, kept as a fallback)

   The template is a real, loadable MV3 extension with 55 locales, two test
   tiers, a packager and a preflight, and its own TEMPLATE.md describing the
   specialisation procedure step by step. Copying it is what the procedure
   already says to do.

   THE _skeleton FALLBACK IS DELIBERATE — DO NOT DELETE IT. It is what makes a
   half-built templates/tool/ recoverable, and that is not hypothetical: this
   directory really did exist holding only README.md and tool.json while it was
   being built, and a scaffolder that preferred it stamped a two-file tool and
   exited 0. The refusal below (a template with no manifest.json is an error,
   and the message names the fallback) is the guard that came out of it.
   The script PRINTS which template it used, because "where did this tool come
   from" is the first question a fleet audit asks.

   WHY THE NEW TOOL IS RED THE MOMENT IT EXISTS, ON PURPOSE

   The permission justifications in the generated tool.json are EMPTY STRINGS, so
   policy-check fails until a human writes them. That is the design. Filling them
   with "TODO: explain this permission" would produce a tool that passes its own
   privacy gate while explaining nothing, and the whole value of that gate is
   that it cannot be satisfied by a machine.

   Exit codes: 0 scaffolded · 1 refused · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
import {
  repoRoot, loadAllTools, readJson, walk,
  RE_TOOL_ID, RE_CATEGORY_DIR, RE_TOOL_DIR
} from './lib/toolinfo.mjs';
import { readHouseIdentity, identityFromHouse, geckoIdFor, isPlaceholderValue } from './lib/tool-identity.mjs';

/* `--dry-run` is a boolean and parseArgs takes the next token as a flag's value
   (report.mjs:137-139), so `--dry-run <anything>` read as dry-run OFF and this
   script WRITES a tool directory there is no undo for. Same treatment as
   lint.mjs:48; every other option here takes a value. */
const BOOLEAN_FLAGS = ['dry-run'];
const args = parseArgs(process.argv.slice(2)
  .map(a => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
args.rejectUnknown(['category', 'name', 'id', 'dir', 'summary', 'template', 'dry-run', 'repo-root']);
const root = repoRoot(args);
const dryRun = args.bool('dry-run');

const category = String(args.get('category', 'Extension'));
const name = args.get('name');
const id = args.get('id');

if (typeof name !== 'string' || !name.trim()) die('--name is required, e.g. --name "Tab Digest" (free text; it becomes the product name in the manifest and the store).');
if (typeof id !== 'string' || !id.trim()) die('--id is required, e.g. --id tabdigest.\nThe id is lowercase-kebab and is the STABLE PUBLIC HANDLE: git tags, zip names and the CI matrix are all built from it. Directories can be renamed later; this cannot.');
if (!RE_TOOL_ID.test(id)) die('--id "' + id + '" is not lowercase-kebab (' + RE_TOOL_ID.source + ').\nIt appears in a git tag and a zip filename, so uppercase letters and underscores are not available.');
if (!RE_CATEGORY_DIR.test(category)) die('--category "' + category + '" is not Capitalized_Singular (spec §1.1). Use Extension, Web, Cli or Desktop.\nA category is a DELIVERY SURFACE, not a product theme: the surface decides the toolchain, the CI matrix and the store target, and it never changes. Themes change every time marketing does.');

/* "Tab Digest" -> Tab_Digest */
function toTitleSnake(s) {
  return String(s).trim().split(/[\s\-_]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('_');
}
const dirName = args.get('dir') ? String(args.get('dir')) : toTitleSnake(name);
if (!RE_TOOL_DIR.test(dirName)) die('the tool directory "' + dirName + '" is not Title_Snake_Case (spec §1.1).\nDerived from --name "' + name + '". Pass --dir explicitly if the derivation is wrong.');

const relDir = category + '/' + dirName;
const destAbs = path.join(root, relDir);

const r = new Report('new-tool · ' + id + ' -> ' + relDir + (dryRun ? '  [dry run]' : ''));

/* ---------------- refuse before touching anything ---------------- */
if (fs.existsSync(destAbs)) {
  die(relDir + ' already exists. This script never writes into an existing directory — a half-stamped\ntool over an existing one is worse than no tool, and there is no undo.');
}

const { tools, errors } = loadAllTools(root);
if (errors.length) {
  console.error('CANNOT RUN — existing tool.json problems must be fixed first:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(2);
}
const clash = tools.find(t => t.id === id);
if (clash) die('tool id "' + id + '" is already used by ' + clash.rel + '/tool.json.\nIds are the public handle and cannot be reused: two tools sharing one produces two release artifacts with the same name, and the second silently overwrites the first.');
const dirClash = tools.find(t => t.rel.toLowerCase() === relDir.toLowerCase());
if (dirClash) die('a tool already lives at ' + dirClash.rel + ', which differs from ' + relDir + ' only by letter case.\nGit on Windows is case-insensitive by default and GitHub runners are not — this is the exact pair that works on your machine and dies on the runner.');

/* ---------------- template ---------------- */
const explicit = args.get('template');
const candidates = explicit ? [String(explicit)] : ['templates/tool', '_skeleton'];
const templateRel = candidates.find(c => fs.existsSync(path.join(root, c)));
if (!templateRel) {
  die('no template found. Looked for: ' + candidates.join(', ') + '.\nSpec §1.2 names templates/tool/, which is where the template lives; _skeleton/ is its pre-move location, kept as a fallback. Pass --template <dir> to use another.');
}
const templateAbs = path.join(root, templateRel);

/* A template with no manifest is not a loadable extension, and stamping from it
   produces a directory that looks like a tool, passes discovery, and cannot be
   installed. This bit, exactly, nearly happened: templates/tool/ appeared in
   this repo holding only README.md and tool.json while it was being built, and
   precedence sent this script straight at it — a two-file scaffold with no
   background.js, no icons and no locales, reported as a success. Refuse, name
   the fallback, and let the caller choose. */
/* EXISTENCE WAS NEVER ENOUGH, and existence is all this used to check. A
   template manifest with a trailing comma parses to nothing; `.value || {}`
   downstream turned that failure into an empty object, and this script stamped a
   tool.json declaring ZERO permissions with a CHANGELOG seeded at a fabricated
   0.0.1, printed three PASS lines and exited 0. That is the opposite of the
   red-on-day-one design at :35-41: policy-check demands a justification per
   declared permission, and a tool that declares none satisfies it by having
   nothing to explain. JSON `null`, `[]` and `"x"` all parse and produce the
   identical outcome with no error to test for, so the SHAPE is checked too.
   Returns {value} or {problem}. */
function probeManifest(abs) {
  if (!fs.existsSync(abs)) return { problem: 'there is no manifest.json' };
  const p = readJson(abs);
  if (p.error) return { problem: p.error };
  if (p.value === null || typeof p.value !== 'object' || Array.isArray(p.value)) {
    return { problem: abs + ' parses, but not as a JSON object' };
  }
  return { value: p.value };
}
const templateManifestAbs = path.join(templateAbs, 'manifest.json');
const templateManifestProbe = probeManifest(templateManifestAbs);
if (templateManifestProbe.problem) {
  const alt = candidates.find(c => c !== templateRel && !probeManifest(path.join(root, c, 'manifest.json')).problem);
  die(templateRel + ' has no manifest.json this script can use, so it is not a loadable extension and\n' +
    'stamping from it would produce a directory that looks like a tool, passes discovery, and cannot\n' +
    'be installed.\n' +
    '  ' + templateManifestProbe.problem + '\n' +
    (alt
      ? 'It is probably still being built. ' + alt + ' does have one — use it explicitly:\n' +
        '  node scripts/new-tool.mjs --category ' + category + ' --name "' + name + '" --id ' + id + ' --template ' + alt
      : 'No candidate template has a manifest.json this script can read. Nothing here can scaffold a working extension yet.'));
}

r.note('template: ' + templateRel + (templateRel === '_skeleton' && !explicit ? '  (templates/tool/ was not found, so the pre-move template location is used)' : ''));

/* Things a new tool must not inherit. Build output, other people's history, and
   the previous tool's release artifacts — a zip in publish/ is the exact
   artifact a store received for a DIFFERENT extension. */
const SKIP = [
  /^\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /^(dist|build|out|web-ext-artifacts)(\/|$)/,
  /(^|\/)\.claude(\/|$)/,
  /^publish\/.*\.(zip|xpi|crx)$/i,
  /(^|\/)test\/.*\/out(\/|$)/,
  /\.(pem|p12|key)$/i,
  /(^|\/)secrets?\./i
];
const sourceFiles = walk(templateAbs, { skip: rel => SKIP.some(re => re.test(rel)) });
if (sourceFiles.length === 0) die(templateRel + ' contains no files to copy.');

/* ---------------- what the stamped tool will declare ---------------- */
const has = rel => sourceFiles.includes(rel) || sourceFiles.some(f => f.startsWith(rel + '/'));

const include = ['manifest.json'];
if (has('background.js')) include.push('background.js');
if (has('LICENSE')) include.push('LICENSE');
for (const d of ['content', 'lib', 'pages', 'popup', 'icons', 'vendor/core']) if (has(d)) include.push(d + '/');
include.push('_locales/');

const exclude = ['**/*.node.js', '**/*.mjs', '**/node_modules/**', '**/*.md',
  '**/dist/**', '**/test/**', 'tools/**', 'publish/**', 'Reference/**'];

/* No `|| {}`. The fallback is what made an unreadable template look like a
   template declaring nothing; proven usable above, so a future regression
   throws here instead of fabricating defaults. */
const templateManifest = templateManifestProbe.value;
const permissions = {};
for (const p of (Array.isArray(templateManifest.permissions) ? templateManifest.permissions : [])) permissions[p] = '';

const tests = sourceFiles.filter(f => /^test\/.*\.node\.js$/.test(f) || /^test\/.*\/run\.js$/.test(f)).sort();

const toolJson = {
  $schema: '../../scripts/schema/tool.schema.json',
  id,
  name: String(name).trim(),
  surface: category.toLowerCase(),
  status: 'wip',
  summary: String(args.get('summary', '')) || 'ONE SENTENCE, user-facing. This becomes the README catalog row.',
  aiHandoff: '',
  manifest: 'manifest.json',
  package: { include, exclude },
  targets: {
    chromium: { stores: ['chrome', 'edge'] },
    ...(has('publish/manifest.firefox.json') ? { firefox: { overlay: 'publish/manifest.firefox.json' } } : {})
  },
  tests,
  policy: {
    permissions,
    optionalHostPermissions: {},
    networkAllowlist: []
  },
  listings: { chrome: null, edge: null, firefox: null },
  /* THE STORE AXIS, stamped for every new tool. `targets` above is the BUILD
     axis and has two entries; this has three, because the chromium build ships
     to Chrome and Edge as two separate listings. Stamping it here is what stops
     tool #2 having its listing hand-typed into a console: check-store-metadata
     .mjs grades a stamped tool from its first commit, and `served: false` means
     the missing directories print rather than blocking the build. */
  storeMetadata: {
    sharedDir: 'store/_shared',
    stores: {
      chrome: { target: 'chromium', dir: 'store/chrome', served: false },
      edge: { target: 'chromium', dir: 'store/edge', served: false },
      ...(has('publish/manifest.firefox.json')
        ? { firefox: { target: 'firefox', dir: 'store/firefox', served: false } }
        : {})
    }
  }
};

r.note(sourceFiles.length + ' file(s) to copy · package.include: ' + include.join(', '));
r.note('tool.json tests: ' + (tests.length ? tests.join(', ') : 'none found'));

/* ---------------- Chrome Web Store publisher ceiling ---------------- */
/* 20 extensions PER PUBLISHER, enforced per publisher account. It is not a
   soft limit you request more of at the moment you need it, and it applies to
   the account, not to this repository — so the count that matters may already
   be higher than what this repo can see. */
{
  const shippingExtensions = tools.filter(t => t.surface === 'extension' && t.status !== 'archived');
  const after = shippingExtensions.length + (category.toLowerCase() === 'extension' ? 1 : 0);
  if (after > 20) {
    r.owner('this would be extension number ' + after + ' under one Chrome Web Store publisher, and the limit is 20',
      'The ceiling is per publisher account and is enforced there, not here — nothing stops you building\n' +
      'this tool, but it cannot be listed under the same account without retiring another. Decide which\n' +
      'before the listing work, not after it.');
  } else if (after >= 18) {
    r.warn(after + ' of the 20 Chrome Web Store extensions per publisher would be used',
      'Worth knowing now: the ceiling is per publisher account and is not negotiable at submission time.');
  }
}

/* ---------------- the house identity ---------------- */
/* O-NEW-TOOL-HAS-NO-FIREFOX-IDENTITY. The owner domain, support address,
   privacy URL and homepage are the same for every tool, and are recorded once in
   <the directory above this extensions root>/tooling/house-identity.json. They
   are written into the new tool's publish/identity.json, and the add-on id they
   imply into its Firefox manifest, so a stamped tool carries a real identity
   from its first commit. Until 2026-09-25 this script copied the template's
   REPLACE-WITH-YOUR-DOMAIN values and printed an owner action; AMO fixes an
   add-on's id at first signing, so a placeholder is refused here, before
   anything is written, rather than reported after. */
const house = readHouseIdentity(path.join(root, '..'));
let identity = null;
if (house.error) {
  r.fail('the house identity can be read', house.error + '\n' +
    'publish/identity.json is written from it, and no script can choose an owner domain on the owner\'s behalf.');
} else {
  const placeholders = Object.keys(house.value).filter(k => isPlaceholderValue(house.value[k]));
  if (placeholders.length) {
    r.fail('the house identity holds no placeholder',
      house.rel + ' ' + placeholders.map(k => k + ' = "' + house.value[k] + '"').join(', ') + '.\n' +
      'Every tool stamped from it would carry that value, and the Firefox add-on id built from it is\n' +
      'permanent from the moment AMO signs it.');
  } else {
    identity = identityFromHouse(house.value, id);
    r.pass('the identity comes from ' + house.rel, 'add-on id ' + geckoIdFor(identity) + ' · support ' + identity.supportEmail +
      ' · privacy ' + identity.privacyPolicyUrl);
  }
}
if (!identity) process.exit(r.finish());

if (dryRun) {
  r.note('');
  r.note('tool.json that would be written:');
  for (const line of JSON.stringify(toolJson, null, 2).split('\n')) r.note('  ' + line);
  r.pass('dry run — nothing was written');
  process.exit(r.finish());
}

/* ---------------- write ---------------- */
let written = 0;
try {
  for (const rel of sourceFiles) {
    const dst = path.join(destAbs, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(templateAbs, rel), dst);
    written++;
  }
} catch (e) {
  r.fail('copying the template', e.message + '\n' + written + ' file(s) had already been written to ' + relDir +
    ' — delete that directory before retrying, so the next run starts from nothing.');
  process.exit(EXIT_FAIL);
}
r.pass('copied ' + written + ' file(s) from ' + templateRel);

/* Stamp provenance. TEMPLATE.md §0: do this the moment you copy the folder,
   while you still know. It is what makes "which tools have the fixed packager?"
   answerable at all. skeletonVersion is NEVER touched — it records the version
   copied FROM, which is the entire point. */
const skeletonJsonAbs = path.join(destAbs, 'skeleton.json');
/* The destination was empty and was filled from sourceFiles alone, so "the template had it" IS
   "it is here" — asked of that list, not of the disk a second time before the write (CodeQL #72). */
if (sourceFiles.includes('skeleton.json')) {
  const p = readJson(skeletonJsonAbs);
  if (p.value) {
    p.value.tool = dirName;
    p.value.copiedAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(skeletonJsonAbs, JSON.stringify(p.value, null, 2) + '\n', 'utf8');
    r.pass('stamped skeleton.json', 'tool="' + dirName + '" copiedAt=' + p.value.copiedAt +
      ' · skeletonVersion left at ' + p.value.skeletonVersion + ', which is the point of it');
  } else r.warn('skeleton.json did not parse — provenance not stamped', p.error);
}

/* TEMPLATE.md §1: the identity is the FIRST edit, and the slug is the signal
   the tool's own test tier reads to decide whether it is still the skeleton.
   The house values overwrite the template's placeholders field by field, so the
   template's README and NOTES keys come along unchanged. */
const identityAbs = path.join(destAbs, 'publish', 'identity.json');
/* Answered from the copied list, as skeleton.json is above (CodeQL #73). */
if (sourceFiles.includes('publish/identity.json')) {
  const p = readJson(identityAbs);
  if (p.value && typeof p.value === 'object' && !Array.isArray(p.value)) {
    Object.assign(p.value, identity);
    fs.writeFileSync(identityAbs, JSON.stringify(p.value, null, 2) + '\n', 'utf8');
    r.pass('wrote the house identity into publish/identity.json', 'slug "' + id + '", owner domain ' + identity.ownerDomain +
      ' — TEMPLATE.md §1; the tool\'s own sim reads the slug to know it is no longer the skeleton');
  } else {
    r.fail('the template\'s publish/identity.json is a JSON object', (p.error || 'it parsed, but not as an object') + '\n' +
      relDir + ' was written without its identity; delete that directory, fix the template, and run this again.');
  }
} else {
  fs.mkdirSync(path.dirname(identityAbs), { recursive: true });
  fs.writeFileSync(identityAbs, JSON.stringify(identity, null, 2) + '\n', 'utf8');
  r.pass('wrote publish/identity.json from the house identity', 'the template carries none · slug "' + id + '"');
}

/* The Firefox manifest carries the add-on id AMO reads, and it is the one
   geckoIdFor() derives from the identity just written. */
const ffManifestRel = toolJson.targets.firefox && toolJson.targets.firefox.overlay;
if (typeof ffManifestRel === 'string' && ffManifestRel) {
  const ffAbs = path.join(destAbs, ffManifestRel);
  const p = readJson(ffAbs);
  if (p.value && typeof p.value === 'object' && !Array.isArray(p.value)) {
    const bss = (p.value.browser_specific_settings && typeof p.value.browser_specific_settings === 'object')
      ? p.value.browser_specific_settings : (p.value.browser_specific_settings = {});
    const gecko = (bss.gecko && typeof bss.gecko === 'object') ? bss.gecko : (bss.gecko = {});
    gecko.id = geckoIdFor(identity);
    fs.writeFileSync(ffAbs, JSON.stringify(p.value, null, 2) + '\n', 'utf8');
    r.pass('set the Firefox add-on id in ' + ffManifestRel, gecko.id);
  } else {
    r.fail('the template\'s ' + ffManifestRel + ' is a JSON object', (p.error || 'it parsed, but not as an object') + '\n' +
      relDir + ' was written without its Firefox add-on id; delete that directory, fix the template, and run this again.');
  }
}

const toolJsonAbs = path.join(destAbs, 'tool.json');
fs.writeFileSync(toolJsonAbs, JSON.stringify(toolJson, null, 2) + '\n', 'utf8');
r.pass('wrote ' + relDir + '/tool.json', 'status "wip", ' + Object.keys(permissions).length + ' permission(s) with EMPTY justifications');

/* The same shape with no alert of its own: answered from the copied list (the CodeQL #72 class). */
if (!sourceFiles.includes('CHANGELOG.md')) {
  const v = templateManifest.version || '0.0.1';
  fs.writeFileSync(path.join(destAbs, 'CHANGELOG.md'),
    '# Changelog\n\nAll notable changes to ' + String(name).trim() + '.\n' +
    'Keep-a-Changelog format, newest first. The version here must always equal the one in\n' +
    '`manifest.json` — `node scripts/check-version.mjs ' + id + '` is the gate that says so.\n\n' +
    '## [' + v + '] - ' + new Date().toISOString().slice(0, 10) + '\n\n### Added\n\n' +
    '- Stamped from `' + templateRel + '`. Nothing of this tool\'s own exists yet.\n', 'utf8');
  r.pass('wrote ' + relDir + '/CHANGELOG.md', 'seeded at v' + v + ' to match the manifest');
}

/* ---------------- what a human must now do ---------------- */
r.blank();
r.note('NEXT — in this order, and none of it is optional:');
r.note('');
r.note('  1. Write the permission justifications in ' + relDir + '/tool.json.');
r.note('     They are empty strings right now, so this FAILS:');
r.note('       node scripts/policy-check.mjs ' + id);
r.note('     That failure is the design. A justification a script could write is a justification');
r.note('     that explains nothing, and Chrome review asks for this exact text at submission.');
r.note('');
r.note('  2. Add the tool to the issue-form dropdowns, or CI fails on the next push:');
/* ⏱ 2026-09-08 — REPOINTED TO THE REPOSITORY ROOT. These two lines told an author to
   edit `.github/ISSUE_TEMPLATE/`, which from inside `extensions/` is the subtree copy
   GitHub never reads: issue forms resolve at the repository ROOT only. The forms were
   promoted to the root in the 2026-09-08 prune, so the instruction now names where they
   are. The workflow step that grades these ids moved with them and reads
   `$GITHUB_WORKSPACE/.github/ISSUE_TEMPLATE/`, so an author who follows the OLD
   instruction now gets a red build instead of a silently unreachable edit. */
r.note('       <repo root>/.github/ISSUE_TEMPLATE/bad-page.yml   (../.github/... from here)');
r.note('       <repo root>/.github/ISSUE_TEMPLATE/bug.yml        (../.github/... from here)');
r.note('     add this option line to each:   - ' + String(name).trim() + ' (' + id + ')');
r.note('     (ci.yml greps for "(' + id + ')" in both — issue forms cannot be generated, so this is');
r.note('     the one place a new tool has to be added by hand.)');
r.note('');
r.note('  3. Work through ' + relDir + '/TEMPLATE.md top to bottom. Its §14 is the finish line, and');
r.note('       node publish/preflight.mjs        (from ' + relDir + ')');
r.note('     is red by design until you get there.');
r.note('');
r.note('  4. Write ' + relDir + '/publish/STORE-LISTING.md in YOUR OWN WORDS.');
r.note('     Microsoft Store policy 10.1.4 requires DISTINCT metadata per listing — a description');
r.note('     reused from a sibling extension is a rejection, and this repo will one day hold many.');
r.note('');
r.note('  5. Then the repo gates:');
r.note('       node scripts/lint.mjs ' + id);
r.note('       node scripts/policy-check.mjs ' + id);
r.note('       node scripts/check-version.mjs ' + id);
r.note('       node scripts/gen-catalog.mjs        (adds the README row)');

process.exit(r.finish());
