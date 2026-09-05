/* pack.mjs — the allowlist becomes a deterministic zip, one target at a time.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/pack.mjs fullshot --target chromium --out dist
     node scripts/pack.mjs fullshot --target firefox  --out dist --release

   THE CONTRACT IS THE WORKFLOWS', NOT THIS SCRIPT'S, so it is quoted here
   rather than paraphrased:

   CITED BY STEP NAME, NOT BY LINE. Every one of these is a `- name:` a reader
   can grep for; the line numbers that stood here were wrong by roughly a
   hundred lines each and had been for long enough that no state of either file
   made them right — see the CORRECTED note at the foot of this block.

     ci.yml, job `package`
       "Build package"                        node scripts/pack.mjs <tool> --target <target> --out dist
       "Reference integrity (inside the zip)"  node scripts/verify-refs.mjs --zip dist/<tool>-<target>.zip --strict
       "Leak check (no test/, docs, ...)"      node scripts/verify-refs.mjs --zip dist/<tool>-<target>.zip --leaks
       "Determinism check (zip is byte-        node scripts/pack.mjs <tool> --target <target> --out dist2
        reproducible)"                        ...then sha256.mjs dist/<...>.zip == sha256.mjs dist2/<...>.zip
       "web-ext lint (Firefox only)"           web-ext@8 lint --source-dir dist/unpacked-firefox --warnings-as-errors

     release.yml, job `release`
       "Build all store packages"              node scripts/pack.mjs <id> --target chromium --out dist --release
                                               node scripts/pack.mjs <id> --target firefox  --out dist --release
       "Reference integrity + leak check       node scripts/verify-refs.mjs --zip "$z" --strict --leaks
        on every artifact"
       "web-ext lint"                          [ -d dist/unpacked-firefox ] || the release stops there,
                                               then the same web-ext@8 lint as CI
       "Checksums"                             sha256sum *.zip  (coreutils, not sha256.mjs)

   ⚠️ CORRECTED 2026-08-22. The block above used to cite these by line —
   ci.yml:338 / :345,348 / :356 / :364 and release.yml:88 / :111 / :131. All
   eight were stale: ci.yml:364 lands in a comment about the AMO gate, and the
   web-ext step was already ~120 lines further down AT HEAD, so the citation was
   never right in any state a reader could check out. One was stale in SUBSTANCE
   as well as position: `release.yml:131 ... --target chromium --release (no
   --out)` describes an invocation release.yml does not make. Both of its pack
   calls pass `--out dist`; the bare `--release` form survives only inside the
   release-notes text, as the command a third party runs to reproduce the digests
   in SHA256SUMS.txt. Step names move only when somebody renames a step, and a
   rename is a thing you can grep for.

   Which fixes four things: the output is `<out>/<id>-<target>.zip`, `--out`
   defaults to `dist`, an unpacked tree is left at `<out>/unpacked-<target>/`,
   and TWO RUNS OVER ONE TREE MUST PRODUCE THE SAME BYTES. Nothing downstream
   reads this script's stdout or a $GITHUB_OUTPUT value; the exit code and those
   two paths are the entire interface.

   WHY THIS BUILDS FROM tool.json AND NOT FROM A SECOND ALLOWLIST

   Every tool stamped from templates/tool carries publish/pack.mjs, whose ALLOW
   list is authoritative for that tool's own build. This one is repo-wide and
   reads package.include/exclude through lib/toolinfo.mjs `packagedFiles()` —
   the same function policy-check.mjs and lint.mjs grade. That is deliberate:
   the gate that reports "zero network calls in 15 packaged script(s)" and the
   packer that decides which 15 files a store receives have to be answering from
   ONE list, or the claim is about a file set nobody shipped.

   THE SUBJECT SET, AND THE FLOOR UNDER IT

   The defect this whole family is written against is a gate that passes because
   its subject set was empty, absent or unreadable rather than because it
   verified anything — and a packager has the worst version of it: an empty
   allowlist writes a valid, tiny, well-formed zip containing nothing, and every
   step after it verifies that zip happily. So four floors, none of them a
   constant that can be edited down without showing up in a diff:

     1. the file set is non-empty, and it contains the tool's own manifest;
     2. every _locales/<lang>/messages.json ON DISK is in it — Chrome refuses to
        load an extension whose default catalogue is absent, which is a refusal
        to install rather than a degradation;
     3. every entry of the last released package for this target is in it: the
        golden master, which git tracks precisely so this comparison exists
        (.gitignore — "Each release zip is a golden master ... and what pack.mjs
        diffs the next build against");
     4. the written archive is read BACK OUT and its entry names must equal the
        list we meant to write. "The list and the archive disagreed" is the one
        class of bug a packager cannot afford to take on trust.

   An ABSENT golden master is reported as "this floor graded nothing", never as
   a clean diff; a golden master that cannot be READ exits 2. An empty answer
   and a failed read are different facts and they get different exit codes here.

   WHAT --release CHANGES

   Warnings and owner gaps become failures. A CI build gets another chance in
   five minutes; a published package does not — the store keeps whichever
   artifact it received first, and no diff run afterwards tells you which one a
   user has. The warning that matters most is the golden-master content diff at
   an UNCHANGED version: bytes differing from the artifact already packaged
   under this version number is exactly that unrecoverable state, which is worth
   knowing in CI and worth stopping for at release.

   Exit codes: 0 packed and every floor held · 1 a floor failed · 2 could not
   run (bad usage, unreadable input). A build that refuses to write never exits 0. */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, packagedFiles, readJson, listToolPaths, versionProblem } from './lib/toolinfo.mjs';

/* ================= the zip primitives ==================================
   First in the file because everything below is about deciding what to hand
   them. No dependency, and none is coming: this repo's whole claim is that the
   command CI runs is the command you run, on bare Node, forever. */

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

/* A FIXED timestamp is the whole determinism story, and ci.yml's
   "Determinism check (zip is byte-reproducible)" step is the check that proves
   it: build twice, compare sha256. (Cited by step name since 2026-08-22; it
   used to read ci.yml:352-360, which is now a comment about the store axis.)
   Same constant as
   templates/tool/publish/pack.mjs (1 Jan 2026, 00:00) so a tool's own packager
   and this one cannot drift on it. */
const DOS_TIME = 0x0000, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function writeZip(dest, list) {
  const locals = [], central = [];
  let offset = 0;
  /* Sorted here as well as upstream, because entry ORDER is part of the bytes:
     a caller that hands over an unsorted list must not be able to break
     reproducibility quietly. */
  for (const e of [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const name = Buffer.from(e.name, 'utf8');
    /* Bit 11 says "this name is UTF-8". Set only when it must be, so ASCII
       names — every path in every tool today — produce the header bytes any
       other deterministic packer would write. */
    const flags = name.length === e.name.length ? 0 : 0x800;
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(list.length, 8); eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(dest, Buffer.concat([Buffer.concat(locals), cd, eocd]));
}

/* Returns {buf, entries: Map name -> {crc, method, compressedSize, size,
   localOffset}}, read from the CENTRAL DIRECTORY — the archive's own index,
   rather than a scan of local headers that a truncated file would still half
   satisfy.

   EVERY failure in here exits 2. A golden master this cannot parse must never
   read as "no previous entries": that is precisely the empty-versus-unreadable
   confusion the floors exist to prevent, and it would switch the dropped-file
   check off while printing a clean diff. */
function readZipIndex(abs) {
  let buf;
  try { buf = fs.readFileSync(abs); }
  catch (e) { die('cannot read ' + abs + ': ' + e.code + ' — ' + e.message); }
  if (buf.length < 22) die(abs + ' is ' + buf.length + ' byte(s) — too short to be a zip at all.');

  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xFFFF);
  for (let i = buf.length - 22; i >= floor; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd === -1) {
    die(abs + ' has no end-of-central-directory record — it is not a zip, or it is truncated.\n' +
      'Read as "zero entries" that would silently disable a floor, so it stops the run instead.');
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    die(abs + ' is a ZIP64 archive and this reader does not speak ZIP64.\n' +
      'Nothing here writes one — 65535 entries or 4 GB would each be a bug of their own — so this is a\n' +
      'refusal to guess rather than a missing feature.');
  }
  if (cdOffset + cdSize > buf.length) die(abs + ' declares a central directory past the end of the file — truncated.');

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      die(abs + ': central directory entry ' + (i + 1) + ' of ' + count + ' is not where the archive says it is.');
    }
    const flags = buf.readUInt16LE(p + 8);
    if (flags & 0x1) die(abs + ': entry ' + (i + 1) + ' is encrypted, and no packager here writes one.');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (entries.has(name)) {
      die(abs + ' carries "' + name + '" twice. Two entries under one name is a package whose contents depend on the reader.');
    }
    entries.set(name, {
      crc: buf.readUInt32LE(p + 16),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42)
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.size !== count) die(abs + ': the central directory named ' + count + ' entries and yielded ' + entries.size + '.');
  return { buf, entries };
}

function extractTo(abs, dest) {
  const { buf, entries } = readZipIndex(abs);
  /* Removed first. A file left behind by a previous build is a file web-ext
     would lint and no store would ever receive. */
  fs.rmSync(dest, { recursive: true, force: true });
  for (const [name, e] of entries) {
    /* These names are ones this script just wrote, so this cannot fire today —
       which is why it is here rather than assumed: extractTo() is one edit away
       from being pointed at an archive from somewhere else. */
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      die(abs + ' contains an entry that escapes the extraction directory: "' + name + '"');
    }
    const start = e.localOffset;
    if (start + 30 > buf.length || buf.readUInt32LE(start) !== 0x04034b50) {
      die(abs + ': the local header for "' + name + '" is not where the central directory says it is.');
    }
    const dataAt = start + 30 + buf.readUInt16LE(start + 26) + buf.readUInt16LE(start + 28);
    const raw = buf.slice(dataAt, dataAt + e.compressedSize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) {
      /* Caught rather than allowed to propagate. Measured by mutating the writer
         to corrupt one payload byte: zlib throws Z_DATA_ERROR and node prints a
         stack trace with no mention of the archive or the entry, which reads as
         a crash in the packer rather than as a verdict about a file. */
      try { data = zlib.inflateRawSync(raw); }
      catch (err) { die(abs + ': "' + name + '" will not inflate — ' + err.message + '\nThe archive is corrupt, so the unpacked tree web-ext lints cannot be produced from it.'); }
    } else {
      die(abs + ': "' + name + '" uses compression method ' + e.method + '; only store (0) and deflate (8) are written here.');
    }
    if (crc32(data) !== e.crc) die(abs + ': "' + name + '" fails its own CRC — the archive is corrupt.');
    const fileAbs = path.join(dest, name);
    fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
    fs.writeFileSync(fileAbs, data);
  }
}

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

/* ================= arguments ================= */
/* `--release` and the two strictness flags are BOOLEANS, and parseArgs is
   deliberately dumb: it takes the next token as a flag's value
   (report.mjs:137-139), so `pack.mjs --release fullshot` swallows the tool id
   and then grades nothing. Pinning the booleans to the `--key=value` form
   before parseArgs sees them keeps a positional a positional. lint.mjs:56 does
   the same thing for the same reason. */
const BOOLEAN_FLAGS = ['release', 'warnings-as-errors', 'owner-actions-fatal'];
const args = parseArgs(process.argv.slice(2)
  .map(a => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
args.rejectUnknown(['target', 'out', 'release', 'warnings-as-errors', 'owner-actions-fatal', 'repo-root']);

const root = repoRoot(args);

const TARGETS = ['chromium', 'firefox'];
const target = args.get('target');
if (typeof target !== 'string' || !TARGETS.includes(target)) {
  die('--target must be one of: ' + TARGETS.join(', ') +
    (typeof target === 'string' ? ', found "' + target + '"' : ', and none was given') +
    '\nusage: node scripts/pack.mjs <tool-id|Category/Tool_Dir> --target <chromium|firefox> [--out dist] [--release]' +
    '\nThe two targets are the two packages: chromium is uploaded to Chrome AND Edge unchanged, and' +
    '\nfirefox is the same tree with the AMO manifest overlay applied.');
}

/* Resolved against the CURRENT DIRECTORY, not against --repo-root: `--out dist`
   in ci.yml runs with the checkout as its cwd, and every path in that job — the
   verify-refs call, the sha256 comparison, the artifact upload — is written the
   same way. Resolving it against the repo root instead would put the zip
   somewhere the next step does not look. */
const outArg = args.get('out', 'dist');
if (typeof outArg !== 'string' || !outArg) die('--out needs a directory, e.g. --out dist');
const outDir = path.resolve(outArg);

/* An --out inside the source tree is refused rather than handled: this script
   deletes and rewrites <out>/unpacked-<target>/ on every run, and a build
   directory sitting inside a tool would also feed the NEXT build its own
   output. Both are cheap to prevent and expensive to notice. */
{
  const inside = (parent, child) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (inside(outDir, root)) {
    die('--out ' + outDir + ' is the repo root, or contains it.\n' +
      'This script rewrites <out>/unpacked-' + target + '/ on every run. Point it at a build directory:\n' +
      '  node scripts/pack.mjs <tool> --target ' + target + ' --out dist');
  }
  for (const e of listToolPaths(root)) {
    if (inside(path.join(root, e.rel), outDir)) {
      die('--out ' + outDir + ' is inside ' + e.rel + '/.\n' +
        'A build directory inside a tool ends up in the next build\'s own file set, and this script\n' +
        'deletes <out>/unpacked-' + target + '/ before it writes. Keep the output outside the source tree.');
    }
  }
}

const tool = resolveTool(root, args.positional[0]);
if (args.positional.length > 1) {
  die('more than one tool given: ' + args.positional.map(t => '"' + t + '"').join(', ') +
    '\nThis packs exactly ONE tool for ONE target. It will not pick one of them for you.');
}

/* A tool may declare a `build` command, after which the package is cut from
   <tool>/dist/unpacked rather than from the source tree. Refused rather than
   guessed at: ci.yml runs no `npm ci` and no build step at all today, so the
   directory this would zip is whatever a previous local run left behind, and
   packaging a stale tree is the quietest possible way to ship the wrong bytes.
   It lands with the build step, in the same change. */
if (tool.build) {
  die(tool.rel + '/tool.json declares a "build" command (' + JSON.stringify(tool.build) + ') and this packer runs no builds.\n' +
    'ci.yml has no build step, so <tool>/dist/unpacked would be whatever a previous local run left on\n' +
    'disk. Either drop "build" from tool.json, or land the build step in ci.yml and the dist/unpacked\n' +
    'branch here together — a packer that silently zips a stale build directory is worse than one that refuses.');
}

const r = new Report('pack · ' + tool.id + ' · ' + target + ' (' + tool.rel + ')' + (args.bool('release') ? '  [release]' : ''));

const zipName = tool.id + '-' + target + '.zip';
const zipPath = path.join(outDir, zipName);
const unpackedDir = path.join(outDir, 'unpacked-' + target);
const show = a => a.slice(0, 4).join(', ') + (a.length > 4 ? ' +' + (a.length - 4) + ' more' : '');
const forHumans = abs => path.relative(process.cwd(), abs).split(path.sep).join('/');

/* ---------------- 1. the version ---------------- */
/* check-version.mjs owns version AGREEMENT (manifest == CHANGELOG == tag). What
   is graded here is only what this script cannot pack without: a version the
   store will accept, and one the golden-master comparison below can compare. */
const version = tool.manifest ? tool.manifest.version : null;
const vp = versionProblem(version);
if (vp) {
  r.fail(tool.manifestRel + ' carries a usable version',
    'version is ' + vp + '\n' +
    'The upload is rejected at the store, and this packer cannot tell whether the last released\n' +
    'package is the same version as this build — so the golden-master floor below loses its anchor too.');
}

/* ---------------- 2. the file set ---------------- */
const { files, localesOnDisk, missedByRules, missedByCollector } = packagedFiles(root, tool);
const localeCount = files.filter(f => f.startsWith('_locales/')).length;
r.note(files.length + ' file(s) selected by package.include/exclude: ' +
  localeCount + ' locale catalogue(s) + ' + (files.length - localeCount) + ' code/assets');

/* FLOOR 1 — the empty package. An include list that has stopped matching writes
   a perfectly valid zip containing nothing, and verify-refs, the determinism
   check and the artifact upload all pass over it without a word. */
if (files.length === 0) {
  r.fail('the package is not empty',
    'package.include in ' + tool.rel + '/tool.json selected ZERO files from ' + tool.rel + '/.\n' +
    'That is not an empty tool — it is a pattern language that has stopped matching. The zip built\n' +
    'from it is well formed, uploads, and installs as nothing at all.\n' +
    'Check the patterns against the tree: paths are relative to ' + tool.rel + '/ and a directory\n' +
    'prefix needs its trailing slash ("pages/" not "pages").');
} else if (!files.includes(tool.manifestRel)) {
  /* The same failure one notch less total, and the one every store answers with
     the same unexplained sentence. */
  r.fail('the package contains the manifest',
    tool.manifestRel + ' is not selected by package.include, so the zip would carry no manifest at all.\n' +
    'Every store answers that with "Manifest file is missing or unreadable" and nothing else.');
} else {
  r.pass(files.length + ' file(s) to pack', 'manifest included, ' + localeCount + ' locale catalogue(s)');
}

/* FLOOR 2 — localisation, which does NOT go through the pattern language.
   packagedFiles() enumerates _locales directly and unions it in, so the two
   paths are independent implementations of one claim; a disagreement in the
   direction that ships (missedByCollector) is a failure and the benign one is a
   warning. policy-check.mjs grades both as well — this is the copy that runs
   holding the bytes about to be written. */
{
  /* NOT CHECKED HERE: "is every catalogue on disk in the file set". It cannot
     fail — packagedFiles() returns the UNION of the pattern-matched set and the
     directly enumerated one, so localesOnDisk is a subset of files by
     construction, and an assertion that cannot fail is worse than none because
     it inflates apparent coverage. That is the union doing its job, and what
     grades the union itself is the two-way drift pair below. The catalogue this
     script CAN lose is one the manifest names and the disk does not have. */
  const dl = tool.manifest && tool.manifest.default_locale;
  if (typeof dl === 'string' && dl) {
    const need = '_locales/' + dl + '/messages.json';
    if (!files.includes(need)) {
      r.fail('the default locale catalogue is packaged',
        tool.manifestRel + ' sets default_locale "' + dl + '" and the build did not collect ' + need + '.\n' +
        'The store rejects the upload outright, and a browser that received it would refuse to load the\n' +
        'extension rather than fall back to anything.');
    } else {
      r.pass('default_locale "' + dl + '" is packaged', need);
    }
  } else if (localesOnDisk.length) {
    r.fail('default_locale is declared',
      'the tree holds ' + localesOnDisk.length + ' locale catalogue(s) but ' + tool.manifestRel + ' sets no default_locale.\n' +
      'The store rejects it by name: "Localization used, but default_locale wasn\'t specified".');
  }
  if (missedByCollector.length) {
    r.fail('the unconditional locale collector sees every catalogue the rules do',
      missedByCollector.map(f => '  ' + f).join('\n') +
      '\nThese ship through package.include but are invisible to the direct _locales enumeration, which\n' +
      'is the list every locale gate here and in policy-check.mjs is graded against. So they go into the\n' +
      'zip and nothing ever grades them. Measured cause: a locale directory replaced by a Windows\n' +
      'junction, which readdirSync reports as isSymbolicLink and not isDirectory.');
  }
  if (missedByRules.length) {
    r.warn('package.include no longer reaches _locales on its own',
      missedByRules.length + ' of ' + localesOnDisk.length + ' catalogue(s) are carried ONLY by the unconditional\n' +
      'collector. The package is still correct — the collector is what ships — but the pattern language\n' +
      'has stopped seeing them, and the next person to read include/exclude will believe otherwise.\n' +
      'Add "_locales/" back to package.include in tool.json.');
  }
}

/* ---------------- 3. the manifest this target ships ---------------- */
/* chromium ships the base manifest byte for byte. firefox ships the base with
   targets.firefox.overlay applied as an RFC 7386 merge patch — the handful of
   keys that differ, rather than a second full manifest that has to be edited
   twice and one day will not be (spec §3.4). */
const manifestAbs = path.join(tool.dirAbs, tool.manifestRel);
let manifestBytes = null;
if (target === 'chromium') {
  manifestBytes = fs.readFileSync(manifestAbs);
  r.pass('chromium manifest', tool.manifestRel + ' ships unchanged — the same bytes go to Chrome and to Edge');
} else {
  const overlayRel = tool.targets && tool.targets.firefox ? tool.targets.firefox.overlay : undefined;
  if (typeof overlayRel !== 'string' || !overlayRel) {
    /* ci.yml states this outcome as a decision rather than an accident, in the
       comment above its `package` job's matrix — grep it for `quietly stops
       building Firefox`. (Cited by phrase since 2026-08-22; it used to read
       ci.yml:324-331, which now lands in the store-identity block.) It says:
       "a tool that cannot build a firefox package FAILS this leg rather than
       skipping it ... the right fix is the overlay, not a matrix that quietly
       stops building Firefox." A skipped leg and a passing leg are the same row
       on the checks list. */
    r.fail('targets.firefox.overlay names a manifest overlay',
      tool.rel + '/tool.json has targets.firefox.overlay = ' +
      JSON.stringify(overlayRel === undefined ? null : overlayRel) + ', so there is nothing to apply and no\n' +
      'Firefox manifest to ship. A full second manifest — publish/manifest.firefox.json in every tool\n' +
      'here today — is NOT an overlay: it restates version, description and every permission, so a bump\n' +
      'has to be right twice.\n' +
      'Convert it to an RFC 7386 merge patch carrying only what differs (background.scripts,\n' +
      'browser_specific_settings.gecko, options_ui, and "options_page": null to delete the Chrome key),\n' +
      'then point targets.firefox.overlay at it. This leg is red until then, on purpose.');
  } else {
    const p = readJson(path.join(tool.dirAbs, overlayRel));
    if (p.error) {
      r.fail('the Firefox overlay parses', p.error);
    } else if (p.value === null || typeof p.value !== 'object' || Array.isArray(p.value)) {
      r.fail('the Firefox overlay is a JSON object',
        tool.rel + '/' + overlayRel + ' parses as ' +
        (p.value === null ? 'null' : Array.isArray(p.value) ? 'an array' : 'a ' + typeof p.value) + '.\n' +
        'An RFC 7386 merge patch is an object; a top-level null or array REPLACES the whole manifest,\n' +
        'which would ship an add-on carrying no manifest content at all.');
    } else {
      const merged = mergePatch(tool.manifest, p.value);
      const gecko = ((merged.browser_specific_settings || {}).gecko || {}).id || '';
      /* AMO fixes the add-on identity at FIRST SIGNING. A placeholder that ships
         once is not a typo you correct later; it is an add-on that belongs to
         nobody, forever, and the only remedy is publishing a different add-on
         and abandoning the install base. So this refuses to WRITE rather than
         warning and writing anyway — an artifact that exists is an artifact
         somebody uploads at 11pm. It is ALSO recorded as an owner action,
         because choosing the domain is not work anyone else can do. */
      if (!gecko || /REPLACE|\.example$/i.test(gecko)) {
        r.fail('the Firefox add-on id is real',
          'the merged manifest carries browser_specific_settings.gecko.id = ' + JSON.stringify(gecko) + '.\n' +
          'AMO fixes the add-on identity at first signing and it cannot be walked back: ship this once and\n' +
          'the listing, its reviews and its users belong to a placeholder permanently.');
        r.owner('the Firefox add-on id needs a domain the owner controls',
          'Set gecko.id to <slug>@<a-domain-you-own> in ' + tool.rel + '/' + overlayRel + ' — where a tool carries\n' +
          'publish/identity.json, `node publish/bump-version.mjs --sync` derives it for you.\n' +
          'This is the one owner gap here that is ALSO fatal, and it is fatal because the artifact must not\n' +
          'exist — not because CI should be red on work only the owner can do.');
      } else if (merged.version !== version) {
        r.fail('the merged Firefox manifest is at the tree\'s version',
          'the overlay produces version ' + JSON.stringify(merged.version) + ' but ' + tool.manifestRel + ' says v' + version + '.\n' +
          'An overlay should not restate the version at all — while it does, every bump has to be made\n' +
          'twice, and the failure mode is an AMO package silently carrying the previous number.');
      } else {
        manifestBytes = Buffer.from(JSON.stringify(merged, null, 2) + '\n', 'utf8');
        r.pass('firefox manifest', overlayRel + ' applied as a merge patch — gecko.id ' + gecko);
      }
    }
  }
}

/* ---------------- 4. the golden master ---------------- */
/* .gitignore, on why the release zips are the one build output git tracks:
   "Each release zip is a golden master — the exact artifact a store received,
   and what pack.mjs diffs the next build against."

   Two arms, and what separates them is whether the tracked artifact is THIS
   version:

     older version   a dropped file is a bug (FAIL); an added one is a feature
                     (printed, not graded)
     same version    the bytes should not have moved at all. Content differing
                     from the artifact already packaged under this number is the
                     unrecoverable state — the store keeps whichever package it
                     received first. WARN in CI, fatal under --release. */
const publishDir = path.join(tool.dirAbs, 'publish');
const GOLDEN_RE = target === 'firefox'
  ? new RegExp('^' + tool.id + '-(\\d+(?:\\.\\d+){0,3})-firefox\\.zip$')
  : new RegExp('^' + tool.id + '-(\\d+(?:\\.\\d+){0,3})(?:-chromium)?\\.zip$');

function goldenMaster() {
  let names;
  try { names = fs.readdirSync(publishDir); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    /* The same rule as toolinfo.mjs's walk: ENOENT is an answer, every other
       errno is a read failing, and a read failure that answers "no previous
       release" disables the floor and says nothing. */
    die('cannot read ' + tool.rel + '/publish: ' + e.code + ' — ' + e.message + '\n' +
      'That is a read failing, not an absent publish directory, and it would have quietly turned off\n' +
      'the dropped-file floor. Fix the permissions or the path and re-run.');
  }
  /* Compared as NUMBERS. A lexical sort puts 1.9.7 after 1.9.11 and then diffs
     against two releases back — harmless while the file set is unchanged, and
     wrong at exactly the moment a dropped-file check matters. */
  const cmp = (a, b) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  };
  let best = null;
  for (const n of names) {
    const m = GOLDEN_RE.exec(n);
    if (!m) continue;
    if (!best || cmp(m[1], best.version) > 0) best = { name: n, version: m[1], abs: path.join(publishDir, n) };
  }
  return best;
}

const golden = goldenMaster();

/* ---------------- 5. refuse, or write ---------------- */
/* Everything above grades the build and nothing above has written a byte. A
   build that cannot carry its own manifest or its own locales must not
   overwrite a good artifact: an unshippable zip written over a shippable one is
   not something a non-zero exit code undoes. */
const finishOptions = {
  warningsAsErrors: args.bool('release') || args.bool('warnings-as-errors'),
  ownerActionsFatal: args.bool('release') || args.bool('owner-actions-fatal')
};

/* `r.fails` is the reporter's own record of what it graded wrong; reading it is
   how this script asks "is there anything here that must not become a file?"
   rather than keeping a second count that can disagree with the report. */
const entries = [];
if (r.fails.length === 0) {
  for (const rel of files) {
    entries.push({
      name: rel,
      data: rel === tool.manifestRel ? manifestBytes : fs.readFileSync(path.join(tool.dirAbs, rel))
    });
  }

  if (golden) {
    const before = readZipIndex(golden.abs).entries;
    const have = new Map(entries.map(e => [e.name, crc32(e.data)]));
    const dropped = [...before.keys()].filter(n => !have.has(n));
    const added = entries.map(e => e.name).filter(n => !before.has(n));
    const changed = [...before.entries()].filter(([n, e]) => have.has(n) && have.get(n) !== e.crc).map(([n]) => n);

    if (dropped.length) {
      r.fail('every file in the last released package is still packaged',
        'vs ' + golden.name + ' (' + before.size + ' entries): DROPPED ' + show(dropped) + '\n' +
        'A file that shipped and no longer does is a removal nobody wrote down. If it is deliberate, say\n' +
        'so in the CHANGELOG and replace the golden master; until then this is the floor holding.');
    } else {
      r.pass('nothing dropped vs ' + golden.name, before.size + ' entries, every one still packaged');
    }

    if (golden.version === version) {
      if (changed.length || added.length) {
        r.warn('this build differs from the artifact already packaged as v' + version,
          golden.name + ' is the previously built package for THIS version, and the tree has moved since:\n' +
          (changed.length ? '  ' + changed.length + ' file(s) changed: ' + show(changed) + '\n' : '') +
          (added.length ? '  ' + added.length + ' file(s) added: ' + show(added) + '\n' : '') +
          'Two different packages under one version number is unrecoverable in public — the store keeps\n' +
          'whichever it received first and nothing you can run afterwards tells you which one a user has.\n' +
          'Bump the manifest and the CHANGELOG. Fatal under --release, where there is no next build.');
      } else {
        r.pass('identical in content to ' + golden.name, 'the tree still packages exactly what v' + version + ' shipped');
      }
    } else {
      r.note('vs ' + golden.name + ' (v' + golden.version + ' -> v' + version + '): ' +
        (added.length ? added.length + ' added (' + show(added) + ')' : 'nothing added') + ' · ' +
        (changed.length ? changed.length + ' changed' : 'nothing changed') +
        ' — expected across a version, and graded only for what went missing');
    }
  } else {
    /* Named, never silent: this is the floor reporting that it graded nothing.
       That is the right state for a first package and an alarming one for a tool
       with a release history, and the reader can tell which. */
    r.note('no previous release package for ' + target + ' in ' + tool.rel + '/publish/ — the dropped-file floor');
    r.note('graded 0 entries. That is correct for a first package, and it is NOT a clean diff: nothing');
    r.note('was compared. Keep each released zip in publish/ (git tracks them deliberately) and the next');
    r.note('build is measured against it.');
  }
}

if (r.fails.length) {
  r.blank();
  r.note('NOTHING WAS WRITTEN — ' + r.fails.length + ' floor(s) failed above, and a build that cannot carry');
  r.note('its own manifest, its own locales or its own history must not become an artifact.');
  process.exit(r.finish(finishOptions));
}

fs.mkdirSync(outDir, { recursive: true });
writeZip(zipPath, entries);
r.pass('wrote ' + forHumans(zipPath), entries.length + ' entries — sorted, fixed timestamp, fixed deflate level, so two runs give one sha256');

/* ---------------- 6. read it back out ---------------- */
/* Never from the list we meant to write — "the list and the archive disagreed"
   is the entire class of bug this step exists for. The unpacked tree web-ext
   lints is inflated from the zip for the same reason: a second copy of the
   source tree would lint something nobody uploads. */
{
  const wrote = [...readZipIndex(zipPath).entries.keys()].sort();
  const meant = entries.map(e => e.name).sort();
  if (wrote.length !== meant.length || wrote.some((n, i) => n !== meant[i])) {
    const missing = meant.filter(n => !wrote.includes(n));
    const extra = wrote.filter(n => !meant.includes(n));
    r.fail('the archive holds exactly the file set that was collected',
      'read back out of ' + zipName + ': ' + wrote.length + ' entries against ' + meant.length + ' intended.\n' +
      (missing.length ? '  missing from the zip: ' + show(missing) + '\n' : '') +
      (extra.length ? '  in the zip but never collected: ' + show(extra) + '\n' : '') +
      'The writer and the collector disagree, so nothing downstream is grading what it believes it is.');
  } else {
    r.pass('the archive reads back as ' + wrote.length + ' entries', 'the list and the archive agree');
    extractTo(zipPath, unpackedDir);
    r.pass('unpacked to ' + forHumans(unpackedDir) + '/', target === 'firefox'
      ? 'inflated from the zip — this is what `web-ext lint --source-dir` reads (the "web-ext lint" steps in ci.yml and release.yml)'
      : 'inflated from the zip, not copied from the source tree');
  }
}

/* The shared reporter prints "N passed · 1 warning(s)" and then returns 1 under
   --release, and a summary with no FAILED line beside a red exit code is how a
   reader concludes the runner is broken. Say which knob did it. */
if (finishOptions.warningsAsErrors && r.warns.length) {
  r.note((args.bool('release') ? '--release' : '--warnings-as-errors') + ' grades warnings as failures: the ' +
    r.warns.length + ' warning(s) above are why this exits 1.');
}

process.exit(r.finish(finishOptions));
