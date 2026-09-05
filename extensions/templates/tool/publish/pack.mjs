/* SKELETON — the packager. No browser, no dependency, no build step.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node publish/pack.mjs             build both packages, then grade them
     node publish/pack.mjs --verify    grade the existing packages, build nothing
     node publish/pack.mjs --extract <dir>
                                       unpack the built Chrome package so the
                                       real-browser tier can load THE PACKAGE
                                       rather than the working folder:
                                         node publish/pack.mjs --extract /tmp/pkg
                                         SMOKE_EXT_DIR=/tmp/pkg node test/browser/smoke.mjs
                                       Every other gate in this repo grades the
                                       folder. This is the only one that puts a
                                       real Chrome in front of the bytes a
                                       reviewer will receive, and it is the only
                                       way to catch an allowlist that dropped a
                                       file the browser needs but no manifest
                                       reference names.

   Two packages, one source tree:

     <slug>-<version>.zip           Chrome AND Edge (the same Chromium MV3 package)
     <slug>-<version>-firefox.zip   AMO: publish/manifest.firefox.json swapped in.
                                    background.js is IDENTICAL — the importScripts
                                    guard lives in the source file, not in this
                                    script, so there is no text anchor to lose.

   WHY A SCRIPT AND NOT A ZIP UTILITY

   Because the package is the only thing a reviewer ever sees, and hand-zipping
   gets it wrong in two ways that cost weeks:

     1. Right-clicking the folder in Windows Explorer nests everything under
        My_Tool/, and the store answers "Manifest file is missing or unreadable"
        with no explanation. Most common first-upload failure there is.
     2. Everything rides along. test/ in this family contains, deliberately,
        an exfiltration-shaped URL and a fixture that installs five network
        APIs — inside an item whose entire listing claim is "zero network
        calls". That is not a warning, that is a malware-review referral. So
        the file list is a POSITIVE ALLOWLIST: a new .md dropped into pages/
        cannot ride along, because nothing but .html/.js/.css from pages/ ever
        could.

   THE ALLOWLIST IS NOT THE WHOLE STORY: see localeMessageFiles() below for the
   one directory that must be impossible to drop, and why a pattern language is
   the wrong tool for it.
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { assertLocalesInPackage } from '../_locales/package-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.SK_ROOT ? path.resolve(process.env.SK_ROOT) : path.join(HERE, '..');
const PUBLISH = path.join(ROOT, 'publish');
const require_ = createRequire(import.meta.url);
const VERIFY = require_(path.join(PUBLISH, 'verify-package.node.js'));

/* ---------------- the allowlist ---------------- */
/* Every file the browser loads, and nothing else. Extensions are pinned per
   directory, so a README dropped into popup/ cannot ship. `only` pins exact
   names where the extension is not enough (or where there is none). */
export const ALLOW = [
  { dir: '.', only: ['manifest.json'] },
  { dir: '.', only: ['background.js'] },
  /* PolyForm Shield, "Notices": anyone who gets a copy of any part of the
     software must also get a copy of the terms. A store user receives the zip,
     so the zip carries the licence. It is allowlisted EXPLICITLY rather than
     swept in, so it is a decision and not an accident. */
  { dir: '.', only: ['LICENSE'] },
  { dir: 'icons', exts: ['.png'] },
  { dir: 'lib', exts: ['.js'] },
  { dir: 'pages', exts: ['.html', '.js', '.css'] },
  { dir: 'popup', exts: ['.html', '.js', '.css'] },
  { dir: '_locales', only: ['messages.json'], exts: ['.json'], recurse: true }
];

/* Belt and braces: even inside an allowed directory, never these. */
export const NEVER = VERIFY.NEVER;

/* Bounded rather than unlimited: an allowlist that follows a tree of unknown
   depth is a denylist wearing a hat, and a symlink loop would hang the build.
   Two levels is _locales/<lang>/messages.json with one to spare. */
export const MAX_DEPTH = 3;

function walkRule(relDir, rule, depth, files) {
  const abs = relDir ? path.join(ROOT, relDir) : ROOT;
  let names;
  try { names = fs.readdirSync(abs).sort(); } catch (_) { return; }
  for (const name of names) {
    const rel = relDir ? relDir + '/' + name : name;
    if (NEVER.test(rel)) continue;
    let st;
    try { st = fs.statSync(path.join(ROOT, rel)); } catch (_) { continue; }
    if (st.isDirectory()) { if (depth > 0) walkRule(rel, rule, depth - 1, files); continue; }
    if (!st.isFile()) continue;
    if (rule.only && rule.only.indexOf(name) < 0) continue;
    if (rule.exts && rule.exts.indexOf(path.extname(name).toLowerCase()) < 0) continue;
    files.push(rel);
  }
}

/* ---------------- _locales is ALLOWLIST-ALWAYS ---------------- */
/* The rule in ALLOW is necessary and NOT sufficient, because it is governed by
   a pattern language: it survives only while the entry stays, `recurse` stays
   true, MAX_DEPTH stays >= 2, and NEVER never grows a clause that happens to
   match a leading underscore. Four independent edits can each silently un-ship
   55 locale directories, and every one of them looks innocent in review
   ("exclude dotfiles and underscore scratch dirs" is the exact wording that did
   it in the reference implementation — whose COMPLIANCE-CHECKLIST then recorded
   the omission as a PASSING check, so the documentation would tell the next
   maintainer that fixing it was the bug).

   And once default_locale is set the failure is not a degradation: Chrome
   REFUSES to load an extension whose default catalogue is absent.

   So localisation does not go through the pattern language at all. This
   enumerates the tree directly — no ALLOW entry, no NEVER test, no depth
   budget — and collect() unions it in unconditionally. There is no expressible
   value of ALLOW/NEVER/MAX_DEPTH that can drop a locale from the package.

   The generic rule is deliberately KEPT rather than deleted: the two paths are
   then independent implementations of the same claim, and the build reports any
   disagreement. The bug is now both impossible AND visible. */
export function localeMessageFiles() {
  const dir = path.join(ROOT, '_locales');
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  return names.filter(e => e.isDirectory())
    .map(e => '_locales/' + e.name + '/messages.json')
    .filter(rel => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (_) { return false; } })
    .sort();
}

/* What the pattern language ALONE would collect — used only to report drift
   between the two paths, never to decide what ships. */
export function localesViaAllowRules() {
  const files = [];
  for (const rule of ALLOW) {
    if (rule.dir !== '_locales') continue;
    if (!fs.existsSync(path.join(ROOT, rule.dir))) continue;
    walkRule(rule.dir, rule, rule.recurse ? MAX_DEPTH : 0, files);
  }
  return files.sort();
}

export function collect() {
  const files = [];
  for (const rule of ALLOW) {
    if (!fs.existsSync(path.join(ROOT, rule.dir))) continue;
    walkRule(rule.dir === '.' ? '' : rule.dir, rule, rule.recurse ? MAX_DEPTH : 0, files);
  }
  for (const f of localeMessageFiles()) files.push(f);
  return Array.from(new Set(files)).sort();
}

/* ---------------- identity: one source for the Firefox add-on id ---------- */
export function readIdentity() {
  return JSON.parse(fs.readFileSync(path.join(PUBLISH, 'identity.json'), 'utf8'));
}
export function geckoIdFor(identity) {
  return String(identity.slug) + '@' + String(identity.ownerDomain);
}
export function isPlaceholderId(id) {
  return /REPLACE|\.example$|^$/i.test(String(id || ''));
}

/* ---------------- minimal zip writer (deflate, deterministic) ------------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* A fixed timestamp keeps the build reproducible: same inputs, same bytes, so a
   rebuild that changes the file is a change in the CODE and can be diffed. */
const DOS_TIME = 0x0000, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function writeZip(dest, entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(dest, Buffer.concat([Buffer.concat(locals), cdBuf, eocd]));
}

export function buildEntries(files) {
  return files.map(rel => ({ name: rel, data: fs.readFileSync(path.join(ROOT, rel)) }));
}

/* ---------------- the localisation gate, BEFORE a byte is written --------- */
/* verify-package refuses a zip whose default catalogue is absent — but it runs
   AFTER the write, so the artifact it condemns is the one now sitting on disk
   and the last good one has already been overwritten. Refuse rather than
   degrade: an unshippable zip written over a good one is not something a
   non-zero exit code can undo. Pure, so the sim can drive it with synthetic
   inputs and the gate is graded rather than trusted. */
export function localeProblems(files, manifests, onDiskOverride) {
  const have = new Set(files);
  const onDisk = onDiskOverride || localeMessageFiles();
  const out = [];
  for (const { label, mf } of manifests) {
    if (!mf) { out.push(label + ' does not parse — cannot grade its localisation'); continue; }
    const dl = mf.default_locale;
    if (dl) {
      const need = '_locales/' + dl + '/messages.json';
      if (onDisk.indexOf(need) < 0) out.push(label + ' sets default_locale "' + dl + '" but ' + need + ' is not in the working tree');
      else if (!have.has(need)) out.push(label + ' sets default_locale "' + dl + '" and the build did NOT collect ' + need + ' — the store rejects this upload outright');
    } else if (onDisk.length) {
      out.push(label + ' sets no default_locale while the tree holds ' + onDisk.length +
        ' locale(s) — the store rejects "Localization used, but default_locale wasn\'t specified"');
    }
  }
  const dropped = onDisk.filter(f => !have.has(f));
  if (dropped.length) {
    out.push(dropped.length + ' of ' + onDisk.length + ' locale file(s) on disk were not collected: ' +
      dropped.slice(0, 6).join(', ') + (dropped.length > 6 ? ' +' + (dropped.length - 6) : '') +
      ' — those markets would silently receive the default locale');
  }
  return out;
}

export function readManifests() {
  const read = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };
  return [
    { label: 'manifest.json', mf: read(path.join(ROOT, 'manifest.json')) },
    { label: 'publish/manifest.firefox.json', mf: read(path.join(PUBLISH, 'manifest.firefox.json')) }
  ];
}

/* ---------------- CLI ---------------- */
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  let FAILS = 0;
  const ACTIONS = [];
  const check = (label, ok, extra) => {
    if (!ok) FAILS++;
    console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (extra ? '  — ' + extra : ''));
    return ok;
  };
  const action = (who, text) => ACTIONS.push(who + ': ' + text);

  const verifyOnly = process.argv.includes('--verify');
  const identity = readIdentity();
  const rootManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const version = rootManifest.version;
  const chromeZip = path.join(PUBLISH, identity.slug + '-' + version + '.zip');
  const firefoxZip = path.join(PUBLISH, identity.slug + '-' + version + '-firefox.zip');

  const extractAt = process.argv.indexOf('--extract');
  if (extractAt !== -1) {
    const dest = process.argv[extractAt + 1];
    const which = process.argv.includes('--firefox') ? firefoxZip : chromeZip;
    if (!dest) { console.log('usage: node publish/pack.mjs --extract <dir> [--firefox]'); process.exit(2); }
    if (!fs.existsSync(which)) { console.log('FAIL  ' + path.basename(which) + ' has not been built — run: node publish/pack.mjs'); process.exit(1); }
    const entries = VERIFY.readZip(which);
    fs.rmSync(dest, { recursive: true, force: true });
    for (const [name, data] of entries) {
      const abs = path.join(dest, name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
    }
    console.log('extracted ' + entries.size + ' entries from ' + path.basename(which) + ' to ' + dest);
    console.log('\nnow load THE PACKAGE in a real browser, not the folder:');
    console.log('  SMOKE_EXT_DIR=' + dest + ' node test/browser/smoke.mjs');
    process.exit(0);
  }

  console.log('packaging ' + identity.slug + ' v' + version + (verifyOnly ? '  (verify only)' : ''));

  /* The two paths to _locales must agree. The always-collector is what SHIPS,
     so a disagreement never breaks the package — but a NEVER clause or a lost
     `recurse` that would once have silently emptied the zip must not now pass
     unremarked. */
  {
    const viaRules = localesViaAllowRules();
    const always = localeMessageFiles();
    const ruleBlind = always.filter(f => viaRules.indexOf(f) < 0);
    check('the generic allowlist rule still reaches _locales on its own', ruleBlind.length === 0,
      ruleBlind.length
        ? 'the always-rule is carrying ' + ruleBlind.length + '/' + always.length + ' locale(s) alone — ' +
          'ALLOW/NEVER/MAX_DEPTH no longer see them. The package is still correct; the pattern language is not.'
        : always.length + ' locale(s) reachable by both paths');
  }

  function build() {
    const files = collect();
    console.log('\nallowlist: ' + files.length + ' files  (' +
      files.filter(f => f.startsWith('_locales/')).length + ' locales + ' +
      files.filter(f => !f.startsWith('_locales/')).length + ' code/assets)');

    const problems = localeProblems(files, readManifests());
    if (problems.length) {
      FAILS += problems.length;
      problems.forEach(p => console.log('  FAIL  localisation: ' + p));
      console.log('  SKIPPED both packages — a build that cannot carry its own _locales tree must never ' +
        'overwrite a good artifact. Nothing was written; the previous zips are untouched.');
      action('BUILD', 'the localisation gate refused this build — fix _locales collection in publish/pack.mjs.');
      return;
    }

    /* A dropped file is always a bug; a new one is worth a second look.
       Versions are compared as NUMBERS: a lexical sort puts 1.9.7 after 1.9.11,
       which silently diffs against two releases back — harmless while the file
       set is unchanged, and wrong exactly when a dropped-file check matters. */
    const verOf = f => (f.match(/(\d+)\.(\d+)\.(\d+)/) || ['', '0', '0', '0']).slice(1).map(Number);
    const prev = fs.readdirSync(PUBLISH)
      .filter(f => f.startsWith(identity.slug + '-') && /\d+\.\d+\.\d+\.zip$/.test(f) && f !== path.basename(chromeZip))
      .sort((a, b) => { const x = verOf(a), y = verOf(b); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); })
      .pop();
    if (prev) {
      const before = new Set(VERIFY.readZip(path.join(PUBLISH, prev)).keys());
      const dropped = Array.from(before).filter(f => files.indexOf(f) < 0);
      const added = files.filter(f => !before.has(f));
      const show = a => a.slice(0, 4).join(', ') + (a.length > 4 ? ' +' + (a.length - 4) + ' more' : '');
      console.log('  vs ' + prev + ': ' + (dropped.length ? 'DROPPED ' + show(dropped) : 'nothing dropped') +
        ' · ' + (added.length ? 'added ' + added.length + ': ' + show(added) : 'nothing added'));
      if (dropped.length) { FAILS++; console.log('  FAIL  a file present in ' + prev + ' is missing from this build'); }
    }

    const chromeEntries = buildEntries(files);
    writeZip(chromeZip, chromeEntries);
    /* Read the entries BACK OUT of the written archive, never from the list we
       meant to write: "the list and the archive disagreed" is the entire class
       of bug this guard exists for. Throws — a package that cannot load is not
       a partial success. */
    assertLocalesInPackage(Array.from(VERIFY.readZip(chromeZip).keys()), { root: ROOT });
    console.log('  wrote ' + path.basename(chromeZip));

    /* ---- Firefox ----
       The add-on identity is fixed by AMO at FIRST SIGNING. A placeholder that
       ships once is not a typo you correct; it is an add-on that belongs to
       nobody, forever, and the only remedy is publishing a different add-on and
       abandoning the install base. So this refuses to WRITE rather than warning
       and writing anyway: an artifact that exists is an artifact someone
       uploads at 11pm. */
    const ffPath = path.join(PUBLISH, 'manifest.firefox.json');
    let ff = null;
    try { ff = JSON.parse(fs.readFileSync(ffPath, 'utf8')); } catch (e) {
      FAILS++; console.log('  FAIL  publish/manifest.firefox.json does not parse — ' + e.message); return;
    }
    const id = ((ff.browser_specific_settings || {}).gecko || {}).id || '';
    const want = geckoIdFor(identity);
    const blockers = [];
    if (isPlaceholderId(id)) blockers.push('gecko.id is still a placeholder: "' + id + '"');
    if (id !== want) blockers.push('gecko.id "' + id + '" does not match identity.json (' + want + ')');
    if (ff.version !== version) blockers.push('manifest.firefox.json is at v' + ff.version + ', the tree is at v' + version);
    if (blockers.length) {
      FAILS += blockers.length;
      blockers.forEach(b => console.log('  FAIL  firefox: ' + b));
      console.log('  SKIPPED ' + path.basename(firefoxZip) + ' — refusing to write an AMO candidate with a ' +
        'placeholder or mismatched identity. AMO fixes the add-on id at first signing and it cannot be walked back.');
      action('OWNER', 'set "ownerDomain" in publish/identity.json to a domain you control, then run ' +
        'node publish/bump-version.mjs --sync to write the derived gecko.id into publish/manifest.firefox.json.');
      return;
    }

    const ffEntries = chromeEntries.map(e =>
      e.name === 'manifest.json' ? { name: e.name, data: fs.readFileSync(ffPath) } : e);
    writeZip(firefoxZip, ffEntries);
    assertLocalesInPackage(Array.from(VERIFY.readZip(firefoxZip).keys()), { root: ROOT });
    console.log('  wrote ' + path.basename(firefoxZip) + '  (same background.js — the guard is in the source)');
  }

  if (!verifyOnly) build();

  const treeFiles = collect();
  for (const [zipPath, kind] of [[chromeZip, 'chrome'], [firefoxZip, 'firefox']]) {
    console.log('\n### ' + path.basename(zipPath) + '  (' + kind + ')');
    if (!fs.existsSync(zipPath)) { console.log('  NOTE  not built'); continue; }
    const r = VERIFY.verifyPackage({ zipPath, kind, root: ROOT, publishDir: PUBLISH, treeFiles });
    for (const c of r.checks) { if (!c.ok) FAILS++; console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.label + (c.extra ? '  — ' + c.extra : '')); }
    r.actions.forEach(a => ACTIONS.push(a));
  }

  console.log('\n' + (FAILS ? FAILS + ' FAILURES' : 'ALL PASS') + ' — packaging + reference integrity');
  if (ACTIONS.length) {
    console.log('\nNOT SUBMITTABLE — ' + ACTIONS.length + ' owner action(s):');
    Array.from(new Set(ACTIONS)).forEach((a, i) => console.log('  ' + (i + 1) + '. ' + a));
  }
  process.exit(FAILS ? 1 : 0);
}
