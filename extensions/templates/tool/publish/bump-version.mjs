/* SKELETON — the version bump, in one command.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node publish/bump-version.mjs patch          0.0.1 -> 0.0.2
     node publish/bump-version.mjs minor          0.0.1 -> 0.1.0
     node publish/bump-version.mjs major          0.1.4 -> 1.0.0
     node publish/bump-version.mjs 1.2.3          exactly that
     node publish/bump-version.mjs --check        agree? (the sim calls this)
     node publish/bump-version.mjs --sync         rewrite derived fields only

   WHY A SCRIPT FOR A THREE-CHARACTER EDIT

   Because it is never one edit. The version is written in manifest.json, in
   publish/manifest.firefox.json (a SECOND manifest that AMO reads and that
   nothing else will remind you about), in the CHANGELOG heading, and in the two
   package filenames. The reference implementation shipped "(v1.10)" section
   labels inside a 1.9.13 build and carried a stale "build 1.9.10" comment
   that its problem-report path nearly used as the runtime version. Its own
   retro: "whoever closes an increment should grep the diff for version strings,
   not just bump the manifest." That grep is this script.

   Nothing here guesses. VERSION_SITES is a declared list; adding a site is one
   line, and a site that stops matching is a hard failure rather than a silent
   skip.

   THE VERSION IS NEVER REUSED. Two different packages under one version number
   is unrecoverable in public: the store keeps whichever it received first, and
   no diff you can run afterwards tells you which one a user has. Bump before
   you rebuild, always.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.SK_ROOT ? path.resolve(process.env.SK_ROOT) : path.join(HERE, '..');
const PUBLISH = path.join(ROOT, 'publish');

const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const readText = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

/* Every place a version number is written, as data. A JSON site is rewritten
   with a targeted string replacement rather than JSON.stringify, so the file
   keeps its formatting and the diff stays one line. */
export const VERSION_SITES = [
  { file: 'manifest.json', what: 'the Chrome/Edge manifest' },
  { file: 'publish/manifest.firefox.json', what: 'the AMO manifest — a second file nothing else reminds you about' }
];

/* Files that legitimately contain a version-shaped number that is NOT this
   tool's version, and must never be rewritten or reported. */
const NOT_A_PRODUCT_VERSION = [
  'LICENSE',          // "PolyForm Shield License 1.0.0"
  'CHANGELOG.md',     // every past release, by design
  'README.md',        // may quote past releases
  'TEMPLATE.md'
];

export function currentVersion() { return readJson('manifest.json').version; }

export function changelogTop(text) {
  const m = /^##\s*\[(\d+(?:\.\d+){1,3})\]/m.exec(text || readText('CHANGELOG.md'));
  return m ? m[1] : null;
}

export function geckoId() {
  const id = readJson('publish/identity.json');
  return String(id.slug) + '@' + String(id.ownerDomain);
}

/* THE PURE CHECK. Returns a list of human-readable problems; empty means every
   version site agrees. Exported so test/skeleton-sim.node.js grades the real
   function instead of re-implementing it and drifting from it. */
export function versionProblems() {
  const out = [];
  const root = readJson('manifest.json');
  const v = root.version;

  for (const site of VERSION_SITES) {
    if (!exists(site.file)) { out.push(site.file + ' is missing — ' + site.what); continue; }
    let mf = null;
    try { mf = readJson(site.file); } catch (e) { out.push(site.file + ' does not parse: ' + e.message); continue; }
    if (mf.version !== v) {
      out.push(site.file + ' says v' + mf.version + ' but manifest.json says v' + v +
        ' — bump them in the same commit (' + site.what + ')');
    }
  }

  if (!exists('CHANGELOG.md')) out.push('CHANGELOG.md is missing — a release with no entry is a release nobody can explain');
  else {
    const top = changelogTop();
    if (top !== v) {
      out.push('CHANGELOG.md\'s top entry is [' + top + '] but the tree is at v' + v +
        ' — the release is undocumented');
    }
  }

  /* The derived Firefox identity. It is written into manifest.firefox.json (AMO
     reads the file, not this script) and it must equal what identity.json
     implies, or the two disagree the moment someone edits one of them. */
  if (exists('publish/identity.json') && exists('publish/manifest.firefox.json')) {
    const want = geckoId();
    const have = ((readJson('publish/manifest.firefox.json').browser_specific_settings || {}).gecko || {}).id;
    if (have !== want) {
      out.push('publish/manifest.firefox.json gecko.id is "' + have + '" but publish/identity.json implies "' +
        want + '" — run: node publish/bump-version.mjs --sync');
    }
  }
  return out;
}

/* Every remaining literal of the OLD version, after a bump. A version left
   behind in a comment, a docstring or a store listing is exactly the defect
   the reference shipped twice. */
export function strayOldVersion(oldVer) {
  const hits = [];
  const skipDirs = new Set(['node_modules', '.git', 'test', 'icons', '_locales']);
  const wanted = /\.(js|mjs|html|css|json|md)$/i;
  const needle = new RegExp('(^|[^\\d.])' + oldVer.replace(/\./g, '\\.') + '([^\\d.]|$)');
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      if (name.charAt(0) === '.') continue;
      const abs = path.join(dir, name), r = rel ? rel + '/' + name : name;
      let st; try { st = fs.statSync(abs); } catch (_) { continue; }
      if (st.isDirectory()) { if (!skipDirs.has(name)) walk(abs, r); continue; }
      if (!wanted.test(name)) continue;
      if (NOT_A_PRODUCT_VERSION.indexOf(r) >= 0) continue;
      const text = fs.readFileSync(abs, 'utf8');
      text.split('\n').forEach((line, i) => { if (needle.test(line)) hits.push(r + ':' + (i + 1) + '  ' + line.trim().slice(0, 90)); });
    }
  })(ROOT, '');
  return hits;
}

function nextVersion(cur, how) {
  if (/^\d+(\.\d+){1,3}$/.test(how)) return how;
  const p = cur.split('.').map(Number);
  while (p.length < 3) p.push(0);
  if (how === 'major') return [p[0] + 1, 0, 0].join('.');
  if (how === 'minor') return [p[0], p[1] + 1, 0].join('.');
  if (how === 'patch') return [p[0], p[1], p[2] + 1].join('.');
  return null;
}

function writeVersion(rel, from, to) {
  const abs = path.join(ROOT, rel);
  const before = fs.readFileSync(abs, 'utf8');
  const needle = '"version": "' + from + '"';
  if (before.indexOf(needle) < 0) return { ok: false, why: 'no `' + needle + '` in ' + rel };
  fs.writeFileSync(abs, before.replace(needle, '"version": "' + to + '"'), 'utf8');
  return { ok: true };
}

function syncGeckoId() {
  const rel = 'publish/manifest.firefox.json';
  if (!exists(rel) || !exists('publish/identity.json')) return { ok: false, why: 'identity.json or manifest.firefox.json is missing' };
  const want = geckoId();
  const abs = path.join(ROOT, rel);
  const before = fs.readFileSync(abs, 'utf8');
  const m = /"id":\s*"([^"]*)"/.exec(before);
  if (!m) return { ok: false, why: 'no gecko "id" field in ' + rel };
  if (m[1] === want) return { ok: true, unchanged: true, id: want };
  fs.writeFileSync(abs, before.replace(m[0], '"id": "' + want + '"'), 'utf8');
  return { ok: true, id: want, was: m[1] };
}

function stampChangelog(to) {
  const abs = path.join(ROOT, 'CHANGELOG.md');
  const text = fs.readFileSync(abs, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const at = text.indexOf('## [Unreleased]');
  if (at < 0) return { ok: false, why: 'CHANGELOG.md has no "## [Unreleased]" heading to write under' };
  const head = text.slice(0, at + '## [Unreleased]'.length);
  const rest = text.slice(at + '## [Unreleased]'.length);
  const nextHeading = rest.search(/\n##\s/);
  const carried = (nextHeading < 0 ? rest : rest.slice(0, nextHeading)).trim();
  const tail = nextHeading < 0 ? '' : rest.slice(nextHeading);
  const body = carried || '### Changed\n\n- ⟨say what changed, for the person reading this in a year⟩';
  fs.writeFileSync(abs, head + '\n\n## [' + to + '] — ' + today + '\n\n' + body + '\n' + tail, 'utf8');
  return { ok: true, carried: !!carried };
}

/* ---------------- CLI ---------------- */
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const arg = process.argv[2];
  const cur = currentVersion();
  let fails = 0;
  const say = (ok, label, extra) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  — ' + extra : '')); };

  if (arg === '--check' || !arg) {
    console.log('version check — the tree says v' + cur + '\n');
    const problems = versionProblems();
    say(problems.length === 0, 'every version site agrees',
      problems.length ? problems.join(' | ') : VERSION_SITES.map(s => s.file).concat('CHANGELOG.md').join(', '));
    console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASS'));
    process.exit(fails ? 1 : 0);
  }

  if (arg === '--sync') {
    const r = syncGeckoId();
    say(r.ok, 'publish/manifest.firefox.json gecko.id derived from publish/identity.json',
      r.ok ? (r.unchanged ? 'unchanged: ' + r.id : r.was + ' -> ' + r.id) : r.why);
    process.exit(fails ? 1 : 0);
  }

  const to = nextVersion(cur, arg);
  if (!to) {
    console.log('usage: node publish/bump-version.mjs <major|minor|patch|x.y.z|--check|--sync>');
    process.exit(2);
  }
  if (to === cur) { console.log('FAIL  ' + to + ' is the current version. A version is never reused.'); process.exit(1); }
  console.log('bumping ' + cur + ' -> ' + to + '\n');

  for (const site of VERSION_SITES) {
    if (!exists(site.file)) { say(false, 'rewrote ' + site.file, 'missing — ' + site.what); continue; }
    const r = writeVersion(site.file, cur, to);
    say(r.ok, 'rewrote ' + site.file, r.ok ? cur + ' -> ' + to : r.why);
  }
  const cl = stampChangelog(to);
  say(cl.ok, 'CHANGELOG.md stamped', cl.ok ? (cl.carried ? 'carried the Unreleased notes into [' + to + ']'
    : 'wrote a placeholder stanza — fill it in before you build') : cl.why);
  const g = syncGeckoId();
  say(g.ok, 'gecko.id in step with publish/identity.json', g.ok ? g.id : g.why);

  const strays = strayOldVersion(cur);
  say(strays.length === 0, 'no literal of the OLD version survives anywhere it should not',
    strays.length ? strays.slice(0, 8).join('  |  ') + (strays.length > 8 ? '  +' + (strays.length - 8) + ' more' : '')
      : 'searched every .js/.mjs/.html/.css/.json/.md outside test/, _locales/ and the changelog');

  console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASS') +
    '\nNext: fill in the CHANGELOG stanza, then  node publish/pack.mjs');
  process.exit(fails ? 1 : 0);
}
