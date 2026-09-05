/* verify-refs.mjs — every reference resolves INSIDE the zip, and nothing leaked in.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/verify-refs.mjs --zip dist/fullshot-chromium.zip --strict
     node scripts/verify-refs.mjs --zip dist/fullshot-chromium.zip --leaks
     node scripts/verify-refs.mjs --zip dist/fullshot-firefox.zip --strict --leaks

   Those three are the calls the workflows make, verbatim: ci.yml's "Reference
   integrity (inside the zip)" and "Leak check" steps in the `package` job, and
   release.yml's "Reference integrity + leak check on every artifact" step, which
   loops over dist/*.zip and passes both flags at once. They are cited by STEP
   NAME rather than by line: a line number is a pointer into a file other people
   edit, and nothing recomputes it.

   WHY THE ZIP AND NOT THE TREE

   Every other gate in scripts/ grades the SOURCE TREE. A file that loads fine
   unpacked and 404s inside the archive is invisible to all of them: the sims
   read the tree, the browser tier loads the tree with --load-extension, and the
   author loaded the tree too. The zip is the only artifact a reviewer or a user
   ever receives, so it gets its own grader — one that reads the bytes back OUT
   of the finished file instead of trusting the list the packer meant to write.
   The whole class of bug here is "the list and the archive disagreed", and it is
   how a missing background.js reached a package that could not have loaded at
   all.

   TWO FAMILIES, SELECTED BY FLAG

     --strict   reference integrity: every manifest / HTML / importScripts /
                executeScript / getURL reference resolves, CASE-EXACTLY, to an
                entry inside this archive
     --leaks    nothing that must never ship is in the archive — test/, docs,
                node_modules, nested zips, credential-shaped names

   Neither given runs BOTH, because the one thing a gate must never do is check
   less than it was asked to when the argv is ambiguous. `--strict` names a
   family; it is not a severity dial. The severity dial is `--warnings-as-errors`,
   as it is everywhere else in this directory. (The other available reading —
   --strict meaning "warnings are fatal", with both families always running — was
   considered and rejected: ci.yml gives the two steps different names and
   different flags, so the flags select what runs.)

   CASE MISMATCH IS ITS OWN ANSWER, NOT A KIND OF MISSING

   Windows and macOS resolve `icons/Icon128.PNG` against `icons/icon128.png` and
   load happily; the reviewer's Linux box 404s. Telling the author a file is
   "not in the package" sends them looking for something that is right there, so
   the two verdicts must not share a sentence.

   A SECOND IMPLEMENTATION ON PURPOSE

   templates/tool/publish/verify-package.node.js already implements this
   algorithm per tool, and this file is deliberately not an import of it: that
   one is CommonJS living inside a tool, aimed at that tool's publish/ layout,
   and it grades store-listing and version questions that belong to
   policy-check.mjs and check-version.mjs here. Two independent implementations
   of the same claim catch what one cannot — the same reasoning
   lib/toolinfo.mjs's packagedFiles() gives for not importing pack.mjs's
   collector.

   REQUIRED COVERAGE — A PASS OVER AN EMPTY SUBJECT IS THE BUG THIS FILE IS

   An archive that does not exist, does not parse as a zip, or holds no
   manifest.json is not a clean run: a reference scan over zero references and a
   leak scan over zero entries both print exactly the green a healthy package
   prints. So the subject set is asserted before anything is graded, and it is
   asserted in BOTH families — `--leaks` alone cannot pass over an empty
   archive either. The manifest's own reference count is asserted separately
   from the total, for the reason lint.mjs counts shipped files separately from
   the files it lints: a total that stays non-zero is exactly how a scanner that
   stopped scanning one source keeps reporting a pass.

   The same rule reaches one level lower, into the decode. Every claim below is
   a claim about bytes this file inflated, so each entry's CRC-32 is checked
   against the one the archive records: measured on a real fullshot zip, 200
   smashed bytes in the middle of a deflate stream inflated WITHOUT throwing,
   yielding a 48-byte fragment of a 1.6 KB catalogue — and every gate then
   graded the fragment and passed. `--allow-empty` is the one visible escape
   hatch, and `--warnings-as-errors` / `--owner-actions-fatal` behave as they do
   in every other gate here.

   Exit codes: 0 everything resolved and nothing leaked · 1 something failed ·
   2 could not run (no --zip, missing file, not a zip, unreadable archive). */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot } from './lib/toolinfo.mjs';

/* `--strict`, `--leaks` and `--allow-empty` are BOOLEANS, and parseArgs is
   deliberately dumb: it takes the next token as a flag's value
   (lib/report.mjs). So `--leaks dist/x.zip` would hand the path to --leaks and
   leave the archive unnamed. Pinning the booleans to `--key=value` before
   parseArgs sees them keeps a positional a positional — the same trap lint.mjs
   records, and it is worth paying for twice rather than discovering twice. */
const BOOLEAN_FLAGS = ['strict', 'leaks', 'allow-empty', 'warnings-as-errors', 'owner-actions-fatal'];
const args = parseArgs(process.argv.slice(2)
  .map(a => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
args.rejectUnknown(['zip', 'strict', 'leaks', 'allow-empty', 'warnings-as-errors', 'owner-actions-fatal', 'repo-root']);

/* --repo-root is accepted because every script here accepts it, and it is USED
   rather than tolerated: repoRoot() refuses a directory that does not exist
   instead of silently ignoring the flag, and the path this gate prints is made
   repo-relative through it. It selects nothing — the subject of this gate is
   one archive, and --zip is the pointer at it. */
const root = repoRoot(args);

const zipFlag = args.get('zip');
const positional = args.positional;
if (positional.length > 1) {
  die('more than one archive given: ' + positional.map(p => '"' + p + '"').join(', ') +
    '\nThis gate grades exactly ONE archive per run. release.yml loops over dist/*.zip and calls it\n' +
    'once per file, so each zip gets its own verdict line instead of one merged answer.');
}
if (typeof zipFlag === 'string' && positional.length) {
  die('the archive was given twice: --zip ' + zipFlag + ' and the positional "' + positional[0] + '".\n' +
    'Pass it one way. Picking one of the two would mean grading a file the caller did not name.');
}
const zipArg = typeof zipFlag === 'string' ? zipFlag : positional[0];
if (!zipArg) {
  die('no archive given.\n' +
    'usage: node scripts/verify-refs.mjs --zip <path.zip> [--strict] [--leaks]\n' +
    '  --strict  every reference resolves inside the zip, case-exactly\n' +
    '  --leaks   no test/, docs, node_modules, nested zip or credential-shaped file shipped\n' +
    '  neither   both families run' +
    (zipFlag === true ? '\n\n--zip was given with no value. It takes the path to the archive.' : ''));
}

const zipAbs = path.resolve(zipArg);
const wantRefs = args.bool('strict') || !args.bool('leaks');
const wantLeaks = args.bool('leaks') || !args.bool('strict');

/* ------------------------------------------------------------------ */
/* the archive — central-directory walk, no dependency                 */
/* ------------------------------------------------------------------ */
/* Every failure in here is a CANNOT RUN (exit 2), never a FAIL and never an
   empty Map. "This file is not a zip" and "this zip is clean" are different
   answers, and a reader that returns `new Map()` for the first makes them
   identical: zero entries scanned, zero problems found, green. That is the
   defect this whole file exists to refuse. */
function readZipOrDie(abs) {
  let buf;
  try { buf = fs.readFileSync(abs); }
  catch (e) {
    if (e.code === 'ENOENT') {
      die('the archive does not exist: ' + abs + '\n' +
        'Nothing was graded. In CI this step runs after pack.mjs, so an absent zip means the packer\n' +
        'did not write the name this gate was pointed at — check --out and the <id>-<target>.zip naming.');
    }
    die('cannot read ' + abs + ': ' + e.code + ' — ' + e.message);
  }
  if (buf.length < 22) die(abs + ' is ' + buf.length + ' byte(s) long — too short to be a zip at all.');

  /* The end-of-central-directory record is scanned for backwards because a zip
     may carry a trailing comment. Its absence means this is not a zip (or is
     truncated), which is an unreadable input, not a finding. */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    die(abs + ' has no end-of-central-directory record, so it is not a readable zip —\n' +
      'truncated, empty, or some other format wearing a .zip name. Nothing in it was graded.');
  }

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  /* 0xFFFF/0xFFFFFFFF are the zip64 escape values. A store package is never
     that big, and MIS-reading one is worse than refusing it: the 16-bit count
     would be a lie and every entry past it would go ungraded in silence. */
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    die(abs + ' uses zip64 extensions. This reader does not, and reading it with the 32-bit fields\n' +
      'would grade a prefix of the archive while reporting on all of it.');
  }
  if (cdOff + cdSize > buf.length) {
    die(abs + ' declares a central directory at ' + cdOff + '+' + cdSize + ' bytes, past the end of a ' +
      buf.length + '-byte file. The archive is truncated.');
  }

  const entries = new Map();
  const order = [];
  const dupes = [];
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      die(abs + ': central-directory entry ' + n + ' of ' + count + ' does not start with the expected\n' +
        'signature at byte ' + p + '. The archive is malformed and only a prefix of it could be read.');
    }
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (lho + 30 > buf.length) die(abs + ': entry "' + name + '" points at byte ' + lho + ', past the end of the file.');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    if (raw.length !== csize) {
      die(abs + ': entry "' + name + '" declares ' + csize + ' compressed byte(s) but only ' + raw.length +
        ' are present. The archive is truncated.');
    }
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw); }
      catch (e) { die(abs + ': entry "' + name + '" does not inflate: ' + e.message + '. The archive is corrupt.'); }
    } else {
      die(abs + ': entry "' + name + '" uses compression method ' + method + '. Only stored (0) and deflate (8)\n' +
        'are used by any packer in this repository, and guessing at the bytes of the rest would mean\n' +
        'grading content this reader never actually decoded.');
    }
    /* THE CHECKSUM IS CHECKED, AND THAT IS NOT BELT AND BRACES. Corrupting the
       middle of a deflate stream does not reliably make inflate throw: measured
       on a real fullshot archive, 200 smashed bytes inflated without complaint
       and every gate below then graded the garbage that came out — 85 entries
       read, all references resolved, PASS. Every claim this file makes is a
       claim about DECODED bytes, so the one field that says whether the decode
       was right is worth the table below. */
    if (crc32(data) !== crc) {
      die(abs + ': entry "' + name + '" decodes to ' + data.length + ' byte(s) whose CRC does not match\n' +
        'the one the archive records. The bytes are corrupt. They would still have been scanned for\n' +
        'references and leaks, and a scan of garbage reports the same clean as a scan of the file that\n' +
        'was meant to be there.');
    }
    order.push(name);
    if (entries.has(name)) dupes.push(name); else entries.set(name, data);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { entries, order, dupes };
}

/* The zip CRC-32, built once on first use. Node ships no crc32, and the
   alternative — trusting inflate to have thrown — was measured not to hold. */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ */
/* comment strippers — a scan that reads prose as code is not a scan   */
/* ------------------------------------------------------------------ */
/* This family's shipped files carry long comments that quote the very APIs
   these scans look for — background.js's banner explains what importScripts()
   is, three lines above the guard that calls it. Scanning raw source reports the
   paragraph explaining a rule as a violation of it, and the author's rational
   response to a check that is red on correct code is to switch it off. Comments
   are blanked to spaces so every offset stays where it was; string literals are
   tracked so a `/*` inside a quoted string does not derail the walk. Ported from
   templates/tool/publish/verify-package.node.js, which learned it the hard way. */
function stripJsComments(src) {
  const s = String(src);
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
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

/* Same rule for markup: a commented-out `<script src="old.js">` loads nothing,
   so grading it would fail a page for a line the browser never reads. */
function stripHtmlComments(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
}

/* ------------------------------------------------------------------ */
/* reference resolution                                                */
/* ------------------------------------------------------------------ */
function resolveRef(entries, ref, ctx) {
  const clean = String(ref).split('#')[0].split('?')[0].trim();
  if (!clean) return { ok: true, target: '', reason: 'EMPTY' };

  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(clean);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    /* data: and blob: are self-contained — nothing leaves the machine and there
       is nothing in the archive to resolve. Anything else carrying a scheme is
       either a network subresource (which breaks the zero-network claim every
       listing in this repo makes) or a hardcoded chrome-extension:// origin,
       which is a different id on every install. */
    if (s === 'data' || s === 'blob') return { ok: true, target: clean, reason: 'INLINE' };
    return { ok: false, target: clean, reason: 'EXTERNAL' };
  }

  const base = ctx.indexOf('/') >= 0 ? ctx.slice(0, ctx.lastIndexOf('/')) : '';
  const target = clean.charAt(0) === '/'
    ? clean.slice(1)
    : path.posix.normalize((base ? base + '/' : '') + clean);

  if (target.indexOf('../') === 0) return { ok: false, target, reason: 'ESCAPES' };

  /* web_accessible_resources entries may carry `*`. A pattern is graded on
     whether it selects anything at all: a rule matching nothing is either a
     typo or a set of files that stopped being packaged, and both are the same
     silence. */
  if (/[*?]/.test(target)) {
    const re = new RegExp('^' + target.split('').map(ch =>
      ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('') + '$');
    const hits = [...entries.keys()].filter(k => re.test(k));
    return hits.length
      ? { ok: true, target, reason: 'PATTERN', found: hits.length + ' entr' + (hits.length === 1 ? 'y' : 'ies') }
      : { ok: false, target, reason: 'PATTERN MATCHES NOTHING' };
  }

  if (entries.has(target)) return { ok: true, target, reason: 'OK' };

  const lower = target.toLowerCase();
  let found = null;
  for (const k of entries.keys()) { if (k.toLowerCase() === lower) { found = k; break; } }
  if (found) return { ok: false, target, reason: 'CASE MISMATCH', found };
  return { ok: false, target, reason: 'MISSING' };
}

function refWhy(r) {
  if (r.reason === 'CASE MISMATCH') {
    return 'CASE MISMATCH: the reference says "' + r.target + '", the archive holds "' + r.found + '".\n' +
      'Loads on Windows and macOS, 404s on the reviewer\'s Linux box — so it passes every check made\n' +
      'on the machine that built it and fails the one made on the machine that grades it.';
  }
  if (r.reason === 'MISSING') {
    return 'MISSING from the archive: ' + r.target + '\n' +
      'The file is named by the package and is not in it. If it exists in the tree, package.include\n' +
      'in tool.json does not select it.';
  }
  if (r.reason === 'ESCAPES') return 'escapes the archive root: ' + r.target;
  if (r.reason === 'EXTERNAL') {
    return 'points OUTSIDE the archive: ' + r.target + '\n' +
      'A packaged subresource must be in the package. An http(s) one is a network call at load time.';
  }
  if (r.reason === 'PATTERN MATCHES NOTHING') {
    return 'the pattern "' + r.target + '" selects no entry in the archive.\n' +
      'A web_accessible_resources rule that matches nothing exposes nothing — either it is a typo or\n' +
      'the files it names stopped being packaged.';
  }
  return r.reason + ': ' + r.target;
}

/* ------------------------------------------------------------------ */
/* extraction                                                          */
/* ------------------------------------------------------------------ */
/* Every place an MV3 manifest can name a packaged file. Written out key by key
   rather than by walking the JSON for anything that looks like a path: a walk
   would grade `default_title` and every __MSG_ placeholder as a broken
   reference, and the fix for that is always to loosen the walk until it stops
   seeing the real ones too. */
function manifestRefs(mf, push) {
  const icons = mf.icons;
  if (icons && typeof icons === 'object') for (const k of Object.keys(icons)) push(icons[k], 'manifest.json', 'icons.' + k);
  else if (typeof icons === 'string') push(icons, 'manifest.json', 'icons');

  const action = mf.action || {};
  const di = action.default_icon;
  if (di && typeof di === 'object') for (const k of Object.keys(di)) push(di[k], 'manifest.json', 'action.default_icon.' + k);
  else if (typeof di === 'string') push(di, 'manifest.json', 'action.default_icon');
  push(action.default_popup, 'manifest.json', 'action.default_popup');

  push(mf.options_page, 'manifest.json', 'options_page');
  push(mf.options_ui && mf.options_ui.page, 'manifest.json', 'options_ui.page');
  push(mf.devtools_page, 'manifest.json', 'devtools_page');
  push(mf.side_panel && mf.side_panel.default_path, 'manifest.json', 'side_panel.default_path');

  const bg = mf.background || {};
  push(bg.service_worker, 'manifest.json', 'background.service_worker');
  push(bg.page, 'manifest.json', 'background.page');
  /* background.scripts is the Firefox event-page fallback the AMO linter demands
     alongside service_worker. It is a real second load path, so it is graded. */
  (Array.isArray(bg.scripts) ? bg.scripts : []).forEach((s, i) => push(s, 'manifest.json', 'background.scripts[' + i + ']'));

  (Array.isArray(mf.content_scripts) ? mf.content_scripts : []).forEach((cs, i) => {
    (Array.isArray(cs.js) ? cs.js : []).forEach((s, j) => push(s, 'manifest.json', 'content_scripts[' + i + '].js[' + j + ']'));
    (Array.isArray(cs.css) ? cs.css : []).forEach((s, j) => push(s, 'manifest.json', 'content_scripts[' + i + '].css[' + j + ']'));
  });

  /* MV3 spells this as objects with a `resources` array; MV2 as a flat array of
     strings. Both shapes are read, because a manifest that still uses the old
     one is a manifest whose references are still real. */
  (Array.isArray(mf.web_accessible_resources) ? mf.web_accessible_resources : []).forEach((w, i) => {
    if (typeof w === 'string') { push(w, 'manifest.json', 'web_accessible_resources[' + i + ']'); return; }
    (Array.isArray(w && w.resources) ? w.resources : []).forEach((s, j) =>
      push(s, 'manifest.json', 'web_accessible_resources[' + i + '].resources[' + j + ']'));
  });

  const over = mf.chrome_url_overrides;
  if (over && typeof over === 'object') for (const k of Object.keys(over)) push(over[k], 'manifest.json', 'chrome_url_overrides.' + k);

  (Array.isArray(mf.sandbox && mf.sandbox.pages) ? mf.sandbox.pages : []).forEach((s, i) =>
    push(s, 'manifest.json', 'sandbox.pages[' + i + ']'));

  const dnr = mf.declarative_net_request;
  (Array.isArray(dnr && dnr.rule_resources) ? dnr.rule_resources : []).forEach((rr, i) =>
    push(rr && rr.path, 'manifest.json', 'declarative_net_request.rule_resources[' + i + '].path'));
}

/* `<a href>` is deliberately NOT scanned. It navigates; it loads nothing into
   the extension's context, and every options page in this repo is required to
   carry an external privacy-policy link. scripts/README.md records the same
   deviation for policy-check's remote-subresource gate, for the same reason: a
   gate that fails correct code gets switched off, and then it guards nothing. */
const HTML_REFS = [
  [/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, '<script src>'],
  [/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi, '<link href>'],
  [/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, '<img src>'],
  [/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, '<iframe src>']
];

/* ------------------------------------------------------------------ */
/* the leak rules                                                      */
/* ------------------------------------------------------------------ */
/* ci.yml names this step's subject in its own title — "no test/, docs,
   node_modules, zips, secrets" — so the table below is that sentence, one rule
   per class, each carrying why it matters. A table rather than one regex
   because a leak has to be reported with the reason it is a leak; "LEAKED:
   test/fixtures/evil.js" and nothing else is a fact nobody can act on.

   DELIBERATELY NARROWER THAN THE PER-TOOL VERIFIER in exactly one place: that
   one refuses every `.mjs`, because in that tool nothing shipped is an ES
   module. Repo-wide that is false — lint.mjs lints shipped `.js` AND `.mjs` —
   so refusing the extension here would fail a correct package the day a tool
   ships a module. Credential CONTENT is not graded here either: secret-scan.mjs
   owns that question over the whole tree. This grades the archive's file list. */
const LEAK_RULES = [
  [/(^|\/)node_modules(\/|$)/i, 'node_modules',
    'A dependency tree in a store package is megabytes of code nobody here wrote, read or\n' +
    'intended to ship, and the reviewer grades all of it as yours.'],
  [/(^|\/)tests?(\/|$)/i, 'test directory',
    'test/ in this family carries, deliberately, exfiltration-shaped fixture URLs and a fixture\n' +
    'that installs five network APIs — inside an item whose listing claims zero network calls.\n' +
    'A reviewer grepping the zip finds them, and that is a malware-review referral, not a warning.'],
  /* `publish/` and `tools/` are this family's build-time directories, named
     exactly. NOT `scripts/`: plenty of correct extensions ship their content
     scripts from a directory with that name, and a rule that fails a correct
     package is a rule somebody deletes — taking the rest of this table with it. */
  [/(^|\/)(publish|tools)(\/|$)/i, 'build tooling',
    'The packer, the graders and the fleet tooling are build-time modules. Shipping them hands a\n' +
    'reviewer code that reads the filesystem and spawns processes.'],
  [/(^|\/)docs?(\/|$)/i, 'documentation directory',
    'Documentation is for the repository, not for the browser.'],
  [/\.mdx?$/i, 'documentation file',
    'A HANDOFF or TEMPLATE markdown file describes how the tool is BUILT — internal notes, open\n' +
    'gaps, sometimes the next thing to fix. None of that belongs in a user\'s download.'],
  [/\.zip$/i, 'nested archive',
    'A zip inside the zip is a previous release riding along, which puts two different packages\n' +
    'under one version number — the unrecoverable one.'],
  [/(^|\/)\.[^/]+/, 'dot-file or dot-directory',
    '.git, .env, .DS_Store and friends: repository state and machine state, never product.'],
  [/(^|\/)(secrets?|credentials?)[-._]/i, 'credential-shaped name',
    'Deliberately broad. A legitimate pages/secret-santa.js costs one rename; a published\n' +
    'credential costs a rotation you cannot be sure finished.'],
  [/\.(pem|key|p12|pfx|crt|cer|jks|keystore)$/i, 'key or certificate',
    'Nothing in this family needs a secret — zero network calls, no accounts, no CI that publishes\n' +
    'for you — so one in a tool folder is already a mistake. This is what stops it becoming a\n' +
    'PUBLISHED mistake.'],
  [/(^|\/)(tool|skeleton|package|package-lock)\.json$/i, 'repository metadata',
    'tool.json is the coupling surface between a tool and this monorepo; package.json and its\n' +
    'lockfile belong to the e2e harness. No browser reads any of them.'],
  [/\.(bak|orig|tmp|log)$|~$/i, 'scratch file',
    'An editor leftover in a store package is the reviewer\'s first impression of the item.']
];

/* ------------------------------------------------------------------ */
/* run                                                                 */
/* ------------------------------------------------------------------ */
const shown = (() => {
  const rel = path.relative(root, zipAbs).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') ? rel : zipAbs;
})();

const { entries, order, dupes } = readZipOrDie(zipAbs);

const scope = [wantRefs ? 'references' : null, wantLeaks ? 'leaks' : null].filter(Boolean).join(' + ');
const r = new Report('verify-refs · ' + shown + ' · ' + scope);

/* ---------------- 0. the subject set, before anything is graded ---------------- */
/* Asserted in both families. Everything below reports on a set, and every one of
   those reports is indistinguishable from a healthy one when the set is empty. */
if (order.length === 0) {
  r.fail('the archive holds at least one entry',
    shown + ' parses as a zip and contains nothing.\n' +
    'This is not a clean run: a reference scan over an empty archive finds no broken references and\n' +
    'a leak scan finds no leaks, and both print the same green a correct package prints.');
  process.exit(r.finish({ warningsAsErrors: args.bool('warnings-as-errors'), ownerActionsFatal: args.bool('owner-actions-fatal') }));
}
r.pass(order.length + ' entr' + (order.length === 1 ? 'y' : 'ies') + ' read back out of the archive',
  (fs.statSync(zipAbs).size / 1024).toFixed(1) + ' KB on disk');

if (dupes.length) {
  r.fail('no entry name appears twice',
    'the central directory lists these name(s) more than once: ' + [...new Set(dupes)].join(', ') + '.\n' +
    'Which copy a browser extracts is unspecified, so the package that was graded and the package that\n' +
    'was installed can differ — and every check below reads only one of the two.');
}

const badNames = order.filter(n =>
  n.indexOf('\\') >= 0 || n.charAt(0) === '/' || n.indexOf('../') >= 0 || /^[a-zA-Z]:/.test(n));
if (badNames.length) {
  r.fail('every entry name is a clean relative forward-slashed path',
    badNames.slice(0, 6).join(', ') + (badNames.length > 6 ? ' +' + (badNames.length - 6) : '') + '\n' +
    'A backslash, a leading slash, a drive letter or a ../ segment in an entry name is either a packer\n' +
    'built on Windows path joining or a path-traversal shape, and extractors disagree about both.');
}
const dirEntries = order.filter(n => /\/$/.test(n));
if (dirEntries.length) {
  r.warn(dirEntries.length + ' directory entr' + (dirEntries.length === 1 ? 'y' : 'ies') + ' in the archive',
    dirEntries.slice(0, 4).join(', ') + '\n' +
    'Harmless — stores accept them and they carry no bytes — but neither packer in this repository\n' +
    'writes one, so their presence means the zip was not built by pack.mjs.');
}

/* manifest.json is the root of every reference chain AND the thing a store
   reads first. Missing means the upload fails with "Manifest file is missing or
   unreadable", which is what right-clicking the folder in Windows Explorer and
   choosing "Send to → Compressed folder" produces: everything nested one level
   down. */
let mf = null;
if (!entries.has('manifest.json')) {
  r.fail('manifest.json is at the ROOT of the archive',
    'not found at the top level. First entries: ' + order.slice(0, 3).join(', ') + '\n' +
    'If they share a leading directory the archive was made by zipping the FOLDER instead of its\n' +
    'CONTENTS. The store answers "Manifest file is missing or unreadable" and says nothing about why.');
} else {
  try {
    /* A UTF-8 BOM makes JSON.parse throw with a message that names neither the
       BOM nor the file, and PowerShell 5.1 writes one by default. Stripped on
       read here for the same reason lib/toolinfo.mjs strips it: a byte order
       mark must not present as "the packaged manifest is corrupt". */
    const text = entries.get('manifest.json').toString('utf8');
    const parsed = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      r.fail('the packaged manifest.json is a JSON object',
        'it parses as ' + (parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : typeof parsed) + '.\n' +
        'Every reference below is read off its keys, and on a non-object every one of them reads\n' +
        'undefined — which grades as "this package names no files", i.e. as compliance.');
    } else {
      mf = parsed;
      r.pass('the packaged manifest.json parses', 'v' + (mf.version || '(no version)'));
    }
  } catch (e) {
    r.fail('the packaged manifest.json parses', 'manifest.json in ' + shown + ' does not parse as JSON: ' + e.message);
  }
}

/* ---------------- 1. reference integrity ---------------- */
if (wantRefs) {
  if (!mf) {
    r.note('reference integrity was NOT graded: the manifest above is missing or unusable, and it is the');
    r.note('root of every reference chain. The run is already failing on that; this line exists so the');
    r.note('absent reference verdict cannot be read as a passing one.');
  } else {
    const refs = [];
    const push = (ref, ctx, what) => { if (typeof ref === 'string' && ref) refs.push({ ref, ctx, what }); };
    manifestRefs(mf, push);
    const fromManifest = refs.length;

    let htmlFiles = 0, htmlRefs = 0;
    for (const [name, data] of entries) {
      if (!/\.html?$/i.test(name)) continue;
      htmlFiles++;
      const html = stripHtmlComments(data.toString('utf8'));
      for (const [rx, what] of HTML_REFS) {
        let m;
        while ((m = rx.exec(html))) { push(m[1], name, name + ' ' + what); htmlRefs++; }
      }
    }

    /* The three JavaScript load paths. `files:` on executeScript/insertCSS is
       resolved against the EXTENSION ROOT, not against the calling script —
       that is chrome.scripting's rule, and getting it wrong would report every
       injection from a subdirectory as missing. */
    let jsFiles = 0, importRefs = 0, execCalls = 0, execRefs = 0, urlRefs = 0;
    const dynamic = [];
    for (const [name, data] of entries) {
      if (!/\.m?js$/i.test(name)) continue;
      jsFiles++;
      const src = stripJsComments(data.toString('utf8'));
      let m;

      const imp = /importScripts\s*\(([^)]*)\)/g;
      while ((m = imp.exec(src))) {
        const args = [...m[1].matchAll(/["']([^"']+)["']/g)].map(a => a[1]);
        if (!args.length) { dynamic.push(name + ': importScripts(' + m[1].trim().slice(0, 40) + ')'); continue; }
        for (const a of args) { push(a, name, name + ' importScripts'); importRefs++; }
      }

      const exec = /(?:executeScript|insertCSS)\s*\(/g;
      while ((m = exec.exec(src))) {
        execCalls++;
        const near = src.slice(m.index, m.index + 600);
        const list = /\bfiles\s*:\s*\[([^\]]*)\]/.exec(near);
        if (!list) continue;                       /* a func:-based injection names no packaged file */
        const args = [...list[1].matchAll(/["']([^"']+)["']/g)].map(a => a[1]);
        if (!args.length) { dynamic.push(name + ': files: [' + list[1].trim().slice(0, 40) + ']'); continue; }
        for (const a of args) { push('/' + a.replace(/^\//, ''), name, name + ' executeScript files'); execRefs++; }
      }

      const url = /\bgetURL\s*\(\s*["']([^"']*)["']\s*\)/g;
      while ((m = url.exec(src))) {
        /* getURL('') and getURL('/') return the extension origin itself — a
           legitimate idiom that names no file. */
        if (m[1] === '' || m[1] === '/') continue;
        push('/' + m[1].replace(/^\//, ''), name, name + ' runtime.getURL');
        urlRefs++;
      }
    }

    const bad = [];
    for (const ref of refs) {
      const res = resolveRef(entries, ref.ref, ref.ctx);
      if (!res.ok) bad.push({ ref, res });
    }

    const breakdown = fromManifest + ' from the manifest · ' + htmlRefs + ' across ' + htmlFiles +
      ' HTML page(s) · ' + importRefs + ' importScripts · ' + execRefs + ' from ' + execCalls +
      ' executeScript/insertCSS call(s) · ' + urlRefs + ' getURL, in ' + jsFiles + ' script(s)';

    if (bad.length) {
      for (const b of bad) r.fail(b.ref.what + '  →  ' + b.ref.ref, refWhy(b.res));
      r.note(bad.length + ' of ' + refs.length + ' reference(s) do not resolve (' + breakdown + ').');
    } else {
      r.pass('every reference resolves inside the archive, case-exactly',
        refs.length + ' reference(s): ' + breakdown);
    }

    /* REQUIRED COVERAGE. The manifest's own count is asserted SEPARATELY from
       the total for the reason lint.mjs counts shipped files separately: a
       total that stays non-zero is exactly how one source silently stops being
       scanned. A manifest that names no packaged file at all is not an
       extension a browser can load, so zero here is a broken extractor or a
       broken package — never a clean result. */
    if (fromManifest === 0 && !args.bool('allow-empty')) {
      r.fail('0 references extracted from the manifest — REQUIRED COVERAGE not met',
        'the packaged manifest.json names no icon, popup, options page, background script, content\n' +
        'script or web-accessible resource. Either it is not a loadable extension manifest, or the\n' +
        'extraction above stopped reading a key it used to read — and a reference scan that extracts\n' +
        'nothing reports exactly the green of one that checked everything and found it clean.\n' +
        'If an extension that names no file is really intended, pass --allow-empty so the decision is\n' +
        'visible in the workflow rather than implicit in a glob.');
    }
    if (dynamic.length) {
      r.warn(dynamic.length + ' injection path(s) this gate cannot resolve',
        dynamic.slice(0, 4).join('\n') + (dynamic.length > 4 ? '\n+' + (dynamic.length - 4) + ' more' : '') + '\n' +
        'The file list is computed at run time, so no static check can say whether it resolves. Named\n' +
        'here rather than counted as covered — the gap is the point.');
    }
  }
}

/* ---------------- 2. the leak check ---------------- */
if (wantLeaks) {
  const leaked = [];
  for (const name of order) {
    for (const [re, label, why] of LEAK_RULES) {
      if (re.test(name)) { leaked.push({ name, label, why }); break; }
    }
  }
  if (leaked.length) {
    const byRule = new Map();
    for (const l of leaked) {
      if (!byRule.has(l.label)) byRule.set(l.label, { why: l.why, names: [] });
      byRule.get(l.label).names.push(l.name);
    }
    for (const [label, { why, names }] of byRule) {
      r.fail(label + ' shipped in the archive',
        names.slice(0, 8).join(', ') + (names.length > 8 ? ' +' + (names.length - 8) + ' more' : '') +
        (why ? '\n' + why : '') + '\n' +
        'Nothing but what the browser loads belongs in a store package. Fix package.include in\n' +
        'tool.json — the exclusion is a positive allowlist, so a file ships only because a rule named it.');
    }
  } else {
    r.pass('nothing that must never ship is in the archive',
      order.length + ' entr' + (order.length === 1 ? 'y' : 'ies') + ' graded against ' +
      LEAK_RULES.length + ' rule(s): test/, build tooling, docs, node_modules, nested zips, dot-files, ' +
      'keys and credential-shaped names');
  }
}

process.exit(r.finish({
  warningsAsErrors: args.bool('warnings-as-errors'),
  ownerActionsFatal: args.bool('owner-actions-fatal')
}));
