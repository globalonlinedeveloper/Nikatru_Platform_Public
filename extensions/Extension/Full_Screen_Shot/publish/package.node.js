/* FullShot store packaging LIBRARY. No browser, no npm dependency, no build step.
   (It does `require()` ONE module out of the monorepo — the shared zip
   timestamp; the note above that line says what that costs and what holds it.)

   ⚠️ SINCE 2026-09-24 (G3) THIS FILE BUILDS NOTHING. Its main() — build(),
   verifyPackage() and five source checks — was a second packer beside
   scripts/pack.mjs that no workflow ran; it is retired, and the note above
   module.exports at the bottom names where each of its checks is read now.
   What remains is the set of real functions test/i18n-sim.node.js and
   tooling/ci/test/extensions-shared-constants.test.mjs require and grade.
   The paragraphs below describe the packer as it was, because the functions
   they explain are the ones still exported.

   Two packages, one source tree:
     fullshot-<ver>.zip           Chrome AND Edge (same Chromium MV3 package)
     fullshot-<ver>-firefox.zip   AMO candidate: manifest.firefox.json swapped in
                                  and background.js importScripts GUARDED, exactly
                                  as the 1.9.11 Firefox package was built by hand.

   The allowlist is positive, not a denylist: only the shipped extension surface
   goes in. Docs, tests, scratch files and publish/ itself can never be swept up
   by a stray glob, and the built file set is diffed against the previous release
   so a silently dropped file is caught.

   NOT one of the eight test tiers, and NOT the AMO submission gate — that is
   publish/verify-firefox-package.node.js, which is red by design until the owner
   sets a real gecko.id. This script exits non-zero only on a packaging or
   reference-integrity defect; the placeholder id is reported as a named owner
   action so the two scripts cannot disagree about what blocks a submission. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;

/* ---------------- the allowlist ---------------- */
/* Every file the browser loads, and nothing else. Extensions are pinned per
   directory so a new .md or .txt dropped into pages/ cannot ride along. */
/* `recurse` is opt-in per rule: a flat read is the right default for a directory
   of leaf assets, and the wrong one the moment a resource is NESTED. _locales is
   the first nested resource this tree has ever had — messages.json lives at
   _locales/<lang>/messages.json, one level below the rule's own directory — so a
   flat readdirSync of `_locales` returns only the language DIRECTORY NAMES, every
   one of which is then discarded by the extension test and the isFile() test.
   Adding the rule without the walk ships nothing and reports a cheerful
   "Allowlist: 30 files"; see the R12 note in verifyPackage. */
const ALLOW = [
  { dir: '.', exts: ['.json'], only: ['manifest.json'] },
  { dir: '.', exts: ['.js'], only: ['background.js'] },
  { dir: 'content', exts: ['.js'] },
  { dir: 'icons', exts: ['.png'] },
  { dir: 'pages', exts: ['.html', '.js', '.css'] },
  { dir: 'popup', exts: ['.html', '.js', '.css'] },
  { dir: '_locales', exts: ['.json'], only: ['messages.json'], recurse: true }
];

/* Belt and braces: even inside an allowed directory these never ship. */
const NEVER = /(^|\/)(node_modules|test|publish|\.[^/]*)(\/|$)|DELETE-ME|\.md$|\.zip$/i;

/* Depth is bounded rather than unlimited: an allowlist that follows a tree of
   unknown depth is a denylist wearing a hat, and a symlink loop would hang the
   build. Two levels is _locales/<lang>/messages.json with one to spare. */
const MAX_DEPTH = 3;

function walkRule(relDir, rule, depth, files) {
  const abs = relDir ? path.join(ROOT, relDir) : ROOT;
  for (const name of fs.readdirSync(abs).sort()) {
    const rel = relDir ? relDir + '/' + name : name;
    if (NEVER.test(rel)) continue;
    let st;
    try { st = fs.statSync(path.join(ROOT, rel)); } catch (_) { continue; }
    if (st.isDirectory()) {
      if (depth > 0) walkRule(rel, rule, depth - 1, files);
      continue;
    }
    if (!st.isFile()) continue;
    if (rule.only && !rule.only.includes(name)) continue;
    if (!rule.exts.includes(path.extname(name).toLowerCase())) continue;
    files.push(rel);
  }
}

/* ---------------- _locales is ALLOWLIST-ALWAYS (R12) ---------------- */
/* R12: "the packaging allowlist excludes underscore-prefixed paths, so the
   moment default_locale is set, _locales/ is silently dropped from the zip and
   the store rejects the package."

   The rule in ALLOW above is necessary but it is not SUFFICIENT, because it is
   still governed by a pattern language: it survives only while ALLOW keeps the
   entry, `recurse` stays true, MAX_DEPTH stays >= 2, and NEVER never grows a
   clause that happens to match a leading underscore. Four independent edits can
   each silently un-ship 55 locale directories, and every one of them looks
   innocent in review ("exclude dotfiles and underscore scratch dirs").

   So localisation does not go through the pattern language at all. This function
   enumerates the tree directly — no ALLOW entry, no NEVER test, no depth budget —
   and collect() unions it in unconditionally. There is no expressible value of
   ALLOW/NEVER/MAX_DEPTH that can drop a locale from the package.

   The generic rule is deliberately KEPT rather than deleted: the two paths are
   then independent implementations of the same claim, and test/i18n-sim.node.js
   reports any disagreement between them (verifyPackage and main() did, until
   2026-09-24). R12 is now both impossible AND visible — if
   someone re-adds the underscore exclusion the zip stays correct and the build
   says so out loud, instead of the bug simply moving somewhere quieter. */
function localeMessageFiles() {
  const dir = path.join(ROOT, '_locales');
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  return names.filter(e => e.isDirectory())
    .map(e => '_locales/' + e.name + '/messages.json')
    .filter(rel => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (_) { return false; } })
    .sort();
}

/* What the pattern language ALONE would have collected — used only to report
   drift between the two paths, never to decide what ships. */
function localesViaAllowRules() {
  const files = [];
  for (const rule of ALLOW) {
    if (rule.dir !== '_locales') continue;
    if (!fs.existsSync(path.join(ROOT, rule.dir))) continue;
    walkRule(rule.dir, rule, rule.recurse ? MAX_DEPTH : 0, files);
  }
  return files.sort();
}

function collect() {
  const files = [];
  for (const rule of ALLOW) {
    if (!fs.existsSync(path.join(ROOT, rule.dir))) continue;
    walkRule(rule.dir === '.' ? '' : rule.dir, rule, rule.recurse ? MAX_DEPTH : 0, files);
  }
  for (const f of localeMessageFiles()) files.push(f);
  return [...new Set(files)].sort();
}

/* ---------------- the Firefox manifest OVERLAY (RFC 7386) ---------------- */
/* publish/manifest.firefox.json IS NOT A MANIFEST. Since the overlay conversion
   it is an RFC 7386 MERGE PATCH — five keys, no `version`, no `default_locale`,
   deliberately, so that a version bump cannot drift between the two engines. The
   Firefox manifest is what that patch produces when merged ONTO manifest.json,
   and that merged object is the only thing this script may grade: it is what
   ships.

   Reading the patch as a whole manifest is not one bug, it is every check at
   once, and each one is a true statement about the file and a false statement
   about the package:
     · it declares no default_locale  → the R12 build gate refused EVERY Firefox
       build, at package.node.js's build() — a live packaging gate, not a test
     · it carries no version          → version parity graded undefined
     · it spends no __MSG_*__ keys    → key parity graded an empty set
     · build() wrote the patch VERBATIM into the Firefox zip as manifest.json —
       a five-key add-on with no name, no icons, no permissions and no locales.
   The last one never surfaced only because the localisation gate above it kept
   refusing to build at all. Fixing the gate without fixing the writer would have
   shipped it.

   The overlay path is READ FROM tool.json (`targets.firefox.overlay`), never
   hardcoded: tool.json is the monorepo contract that scripts/pack.mjs already
   reads, and a hardcoded filename would silently degrade this script to grading
   a file that is no longer the overlay the rest of the repo applies. */
const TOOL_JSON = path.join(ROOT, 'tool.json');
const PACK_MJS = path.join(ROOT, '..', '..', 'scripts', 'pack.mjs');

function readJson(p) {
  try { return { value: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { return { error: e && e.message }; }
}

/* LIFTED VERBATIM from scripts/pack.mjs — the monorepo packer that applies the
   same overlay to the same tree. Two merges that must agree is a defect waiting
   to happen, so this copy is not maintained: it is COMPARED. `mergePatchDrift()`
   below reads pack.mjs's own source and fails the build if the two ever differ.

   IT STAYS A COMPARISON EVEN NOW THAT THIS FILE REQUIRES AN ESM MODULE (the zip
   timestamp, further down). The two cases are not alike. zip-time.mjs is two
   constants and a comment, and it exports them. scripts/pack.mjs exports
   NOTHING — `grep -n export scripts/pack.mjs` returns no lines, measured
   2026-09-20 — and it is a script that packs a tool when it is loaded, so there
   is no mergePatch to require and requiring the file would run the builder
   inside the tool that grades what the builder produced. */

/* RFC 7386 §2, all of it: a null member DELETES, an object member merges
   recursively, anything else replaces. Arrays replace wholesale — which is what
   lets an overlay state background.scripts at all. */
function mergePatch(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (base !== null && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete out[key];
    else out[key] = mergePatch(out[key], patch[key]);
  }
  return out;
}

/* Comments and whitespace differ freely; the CODE may not. */
function normalizeFn(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* Returns null when pack.mjs is not reachable from here (this tool packaged on
   its own), a string when the two implementations differ, and '' when they
   agree. Never silently "passes" for a file it could not read. */
function mergePatchDrift() {
  if (!fs.existsSync(PACK_MJS)) return null;
  const src = fs.readFileSync(PACK_MJS, 'utf8');
  const start = src.indexOf('function mergePatch');
  if (start < 0) return 'scripts/pack.mjs no longer defines a function named mergePatch';
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return 'scripts/pack.mjs mergePatch does not close — cannot compare';
  return normalizeFn(src.slice(start, end + 1)) === normalizeFn(mergePatch)
    ? '' : 'the copy in publish/package.node.js and the one in scripts/pack.mjs are no longer the same code';
}

/* The whole Firefox story in one object, so no caller has to re-derive it:
     { none: true }              tool.json declares no Firefox target — legitimate,
                                 and it means there is no Firefox package at all
     { error }                   the overlay is named but unusable — a defect
     { rel, patch, base, merged} the manifest that actually ships                */
function firefoxManifest() {
  const tool = readJson(TOOL_JSON);
  if (tool.error) {
    return { error: 'tool.json does not parse (' + tool.error + '). targets.firefox.overlay is where the '
      + 'Firefox overlay is named, so without it this script cannot know which file to merge — and it must '
      + 'not guess a filename.' };
  }
  const t = (tool.value && tool.value.targets && tool.value.targets.firefox) || null;
  const rel = t ? t.overlay : undefined;
  /* A tool with no Firefox target is a legitimate state, not a hole: absent, or
     an explicit null, means there is no second package to build and nothing to
     grade. It must not crash, and it must not quietly grade zero checks while
     printing nothing — main() says so out loud. */
  if (rel === undefined || rel === null) return { none: true };
  if (typeof rel !== 'string' || !rel) {
    return { error: 'tool.json targets.firefox.overlay is ' + JSON.stringify(rel) +
      '; it must be a path relative to the tool directory, or null for a tool with no Firefox target.' };
  }
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    return { rel, error: rel + ' is named by tool.json targets.firefox.overlay but is not on disk' };
  }
  const p = readJson(abs);
  if (p.error) return { rel, error: rel + ' does not parse — ' + p.error };
  if (p.value === null || typeof p.value !== 'object' || Array.isArray(p.value)) {
    return { rel, error: rel + ' parses as ' +
      (p.value === null ? 'null' : Array.isArray(p.value) ? 'an array' : 'a ' + typeof p.value) +
      '. An RFC 7386 merge patch is an OBJECT; a top-level null or array REPLACES the whole manifest, '
      + 'which would ship an add-on carrying no manifest content at all.' };
  }
  const base = readJson(path.join(ROOT, 'manifest.json'));
  if (base.error) return { rel, patch: p.value, error: 'manifest.json does not parse — ' + base.error };
  return { rel, patch: p.value, base: base.value, merged: mergePatch(base.value, p.value) };
}

/* The bytes that go into the Firefox zip. Same serialisation scripts/pack.mjs
   uses, so the two packers produce a byte-identical manifest from one patch. */
function firefoxManifestBytes(merged) {
  return Buffer.from(JSON.stringify(merged, null, 2) + '\n', 'utf8');
}

/* ---------------- the localisation gate (R12), at BUILD time ---------------- */
/* verifyPackage already refuses a zip whose default_locale has no messages.json.
   That is not enough on its own, because it runs AFTER writeZip: the artifact it
   condemns is the one now sitting on disk, and the last good one has already been
   overwritten. Reproduced in a sandbox by re-adding the underscore exclusion to
   NEVER — the build printed "Allowlist: 30 files", wrote BOTH zips with zero
   locales on top of the good ones, and only then reported 2 FAIL. The Firefox
   importScripts guard learned this same lesson ("refuse rather than degrade");
   localisation now gets the same treatment.

   Pure by design: it takes the collected file list and the parsed manifests and
   returns human-readable problems. The i18n tier calls it directly with synthetic
   inputs, so the gate itself is GRADED rather than trusted. */
/* Every manifest that SHIPS, one entry per package — so `mf` is the merged
   Firefox manifest, never the patch. Callers that legitimately care about the
   patch itself get it as `.patch` on the same entry (see `patchProblems`, which
   grades the patch for restating the version — a thing that is only wrong about
   the PATCH and invisible in the merge). Both are exposed rather than one,
   because grading either one alone was how this defect happened: the merge is
   what the store receives, and the patch is what a human edits. */
function readManifests() {
  const base = readJson(path.join(ROOT, 'manifest.json'));
  const out = [{ label: 'manifest.json', mf: base.error ? null : base.value }];
  const ff = firefoxManifest();
  /* No Firefox target: one package, one manifest. Returning a second entry whose
     mf is null would report a parse failure for a file nobody claimed exists. */
  if (ff.none) return out;
  out.push({
    label: (ff.rel || 'the Firefox overlay') + ' merged onto manifest.json',
    mf: ff.merged || null,
    patch: ff.patch || null,
    overlayRel: ff.rel || null,
    error: ff.error || null
  });
  return out;
}

/* Checks that are about the PATCH, not about the manifest it produces. There is
   exactly one class of them and this is why `.patch` is exposed at all: a merge
   patch that restates a field it should inherit merges CLEANLY and grades green
   everywhere — right up to the bump where the two copies disagree and the AMO
   package silently carries the previous number. That is invisible downstream of
   the merge by construction, so it has to be asked here. */
function patchProblems(manifests) {
  const out = [];
  for (const m of manifests) {
    if (!m.patch) continue;
    for (const key of ['version', 'default_locale']) {
      if (Object.prototype.hasOwnProperty.call(m.patch, key) && m.patch[key] !== null) {
        out.push((m.overlayRel || m.label) + ' restates "' + key + '" (' + JSON.stringify(m.patch[key]) +
          '). An overlay is a merge patch: it must carry only what DIFFERS, and inherit ' + key +
          ' from manifest.json. While it restates it, every bump has to be right twice and the failure ' +
          'mode is a package silently carrying the previous value.');
      }
    }
  }
  return out;
}

function localeProblems(files, manifests, onDiskOverride) {
  const have = new Set(files);
  const onDisk = onDiskOverride || localeMessageFiles();
  const out = [];
  for (const { label, mf, error } of manifests) {
    if (!mf) { out.push(error ? label + ': ' + error : label + ' does not parse — cannot grade its localisation'); continue; }
    const dl = mf.default_locale;
    if (dl) {
      const need = '_locales/' + dl + '/messages.json';
      if (!onDisk.includes(need)) {
        out.push(label + ' sets default_locale "' + dl + '" but ' + need +
          ' is not in the working tree');
      } else if (!have.has(need)) {
        out.push(label + ' sets default_locale "' + dl + '" and the build did NOT collect ' + need +
          ' — the store rejects this upload outright (R12)');
      }
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

/* ---------------- minimal zip writer (deflate, deterministic) ---------------- */
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

/* A fixed timestamp keeps the build reproducible: same inputs, same bytes.

   THE VALUE IS READ FROM extensions/scripts/lib/zip-time.mjs, the module
   scripts/pack.mjs and templates/tool/publish/pack.mjs already import. It used
   to be restated here, under a comment promising the three sites agreed while
   nothing compared them; then the comparison was written and this file still
   held the second definition. One definition is the end of that, and a
   `require()` of the .mjs is how a CommonJS file reaches it.

   THE NODE FLOOR IT COSTS, WRITTEN DOWN BECAUSE IT IS LOAD-BEARING. Node
   enabled require() of an ES module by default in 22.12.0 and has kept it
   unflagged since; below that this line throws ERR_REQUIRE_ESM at load. The
   only automated caller of this file is test/i18n-sim.node.js, which requires
   it as a library, and .github/workflows/extensions-ci.yml runs the sims on node
   '22' and '24' — bare majors, which setup-node always resolves to the newest
   release of that line, so the 22 leg cannot land below 22.12 (it measured
   v22.23.2 on 2026-09-19). tooling/ci/test/extensions-shared-constants.test.mjs
   fails if that matrix is ever lowered past the floor, and grades the bytes
   writeZip stamps rather than the text of this line.

   Throwing at load on an ancient node, or when extensions/scripts/ is not
   beside the tool, is the same refuse-rather-than-degrade choice the
   localisation gate and the Firefox background guard above make: a packager
   that cannot prove which timestamp it is stamping must not write a zip. */
const { DOS_TIME, DOS_DATE } = require('../../../scripts/lib/zip-time.mjs');

function writeZip(dest, entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    // Store instead of deflate when compression does not pay — same rule a
    // normal zipper uses, and it keeps tiny files byte-obvious.
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

/* ---------------- minimal zip reader (verify what was written) ---------------- */
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
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + size);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* The Chrome package must still carry the real importScripts() calls: under an
   MV3 SERVICE WORKER they are how pages/db.js and pages/batch.js arrive, and a
   Chrome zip that lost them is dead on first capture.

   INDENT-TOLERANT, NOT LOOSE. background.js:24 guards the calls with
   `if (typeof importScripts === 'function') {` (2026-08-20, the Firefox port),
   so the call now sits indented beneath that `if`. The column-0 anchor this
   check used to carry stopped matching that source and reported a Chrome
   package defect that did not exist. `^[ \t]*` tolerates the indent and
   NOTHING else — the trailing `$` and the literal `);` are kept on purpose:
     · deleting the call            → false (the harm this guards)
     · replacing it with self.db=1  → false
     · commenting it out            → false (`//` is not space or tab)
     · the Firefox background.scripts form, which has no call at all → false
   A `.includes('importScripts')` or a dropped `$` would pass all four. */
const CHROME_IMPORTSCRIPTS_RE = /^[ \t]*importScripts\('pages\/db\.js'\);$/m;
function chromeKeepsImportScripts(bgSrc) {
  return CHROME_IMPORTSCRIPTS_RE.test(String(bgSrc == null ? '' : bgSrc));
}

/* ---------------- a library, not a packer ---------------- */
/* RETIRED 2026-09-24 (G3): this file's own main() — build(), verifyPackage() and
   the five source checks it ran before them. It was the SECOND packer beside
   scripts/pack.mjs, and no workflow ever ran it: its only automated caller was
   test/i18n-sim.node.js, which requires it as a library and never reached
   main(). What it graded that nothing else did now lives where CI reads it:
     · the allowlist still reaches _locales on its own  -> test/i18n-sim.node.js
     · the Firefox overlay is usable, is an OBJECT and
       sets only the documented Firefox deltas         -> publish/verify-firefox-package.node.js
     · its mergePatch is pack.mjs's mergePatch          -> tooling/ci/test/extensions-shared-constants.test.mjs
     · RTCPeerConnection and SharedWorker, which only
       verifyPackage()'s NET regex named               -> scripts/policy-check.mjs NETWORK
   The packages themselves are built by `node scripts/pack.mjs fullshot` and
   graded by scripts/verify-refs.mjs, scripts/check-store-packages.mjs and
   publish/verify-firefox-package.node.js --zip. Running this file directly
   refuses with exit 2 rather than printing a pass over nothing. */
module.exports = {
  ROOT, ALLOW, NEVER, MAX_DEPTH,
  DOS_TIME, DOS_DATE, writeZip,
  collect, localeMessageFiles, localesViaAllowRules, localeProblems, readManifests, readZip,
  mergePatch, mergePatchDrift, firefoxManifest, firefoxManifestBytes, patchProblems,
  chromeKeepsImportScripts
};

if (require.main === module) {
  console.error('publish/package.node.js is a library since 2026-09-24 and builds nothing.\n' +
    'Build:  node scripts/pack.mjs fullshot [--target firefox] --out <dir>   (from extensions/)\n' +
    'Grade:  node scripts/check-store-packages.mjs fullshot --dir <dir>\n' +
    '        node Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js --zip <dir>/fullshot-firefox.zip\n' +
    'COVERAGE LOST, not a pass: this run checked nothing.');
  process.exit(2);
}
