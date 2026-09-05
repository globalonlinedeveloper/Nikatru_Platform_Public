/* tool.json — load, validate, and answer questions about a tool.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

   `tool.json` is the ENTIRE coupling surface between a tool and this repo
   (spec §1.3). Everything CI does is driven by it, so a tool never has to
   restructure itself to participate — and so every gate must read it through
   one loader rather than each re-deriving "what does this tool ship?".

   THE ID IS THE PUBLIC HANDLE, THE DIRECTORY IS NOT (spec §1.1)

     Category dir   Capitalized_Singular   Extension/        filesystem only
     Tool dir       Title_Snake_Case       Full_Screen_Shot/ filesystem only
     Tool id        lowercase-kebab        fullshot          tags, zips, CI matrix
     Product name   free text              FullShot          manifest, stores

   Directories can be renamed; ids cannot — a rename breaks every git tag, every
   release artifact name and every store listing that points at it. So every
   script here accepts EITHER form on the command line and resolves it to the
   same tool: `policy-check.mjs fullshot` and
   `policy-check.mjs Extension/Full_Screen_Shot` are the same command. CI passes
   the id (the matrix is built from ids); a human at a prompt has just tab-
   completed the path. Refusing one of those would be a papercut on every run.

   WHY VALIDATION IS FATAL AND NOT ADVISORY

   discover.mjs builds the CI matrix from these files. A tool.json that does not
   parse, or that carries a duplicate id, produces a matrix that is quietly wrong
   — jobs that skip a tool, or two jobs that overwrite each other's artifact.
   A matrix built on a lie is worse than no matrix, so a malformed tool.json
   stops the run rather than being skipped.

   Every error message here names the FILE, the FIELD, what was found and what
   was expected. "invalid tool.json" is not a message anyone can act on. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { die } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- repo root ---------------- */
/* Resolved from this file's own location, so a script works from any cwd —
   PowerShell in the repo root, bash in a tool directory, or a GitHub runner.
   `--repo-root` / TOOLS_REPO_ROOT exist so the self-test can point every gate
   at a synthetic fixture tree: a guard you can only run against the real repo
   is a guard you can only NEGATIVE-test by breaking the real repo. */
export function repoRoot(args) {
  const fromFlag = args && typeof args.get === 'function' ? args.get('repo-root') : null;
  const raw = (typeof fromFlag === 'string' && fromFlag) || process.env.TOOLS_REPO_ROOT || path.join(HERE, '..', '..');
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) die('repo root does not exist: ' + abs);
  return abs;
}

/* ---------------- small file helpers ---------------- */
/* A UTF-8 BOM makes JSON.parse throw with a message that names neither the BOM
   nor the file, and PowerShell 5.1 writes one by default from `Out-File
   -Encoding utf8`. Strip it on read, and report it separately where it matters,
   rather than letting a byte order mark present as "tool.json is corrupt". */
export function readText(abs) {
  const s = fs.readFileSync(abs, 'utf8');
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

export function hadBom(abs) {
  try { const b = fs.readFileSync(abs); return b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF; }
  catch (_) { return false; }
}

/* Returns {value} or {error} — never throws, because most callers want to
   report a bad file alongside other problems rather than abort on the first. */
export function readJson(abs) {
  let text;
  try { text = readText(abs); } catch (e) { return { error: 'cannot read ' + abs + ': ' + e.message }; }
  try { return { value: JSON.parse(text), text }; }
  catch (e) {
    /* Turn "Unexpected token } in JSON at position 412" into a line and column
       somebody can put a cursor on. */
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) {
      const pos = Number(m[1]);
      const upto = text.slice(0, pos);
      const line = upto.split('\n').length;
      const col = pos - (upto.lastIndexOf('\n') + 1) + 1;
      where = ' (line ' + line + ', column ' + col + ')';
    }
    return { error: abs + ' does not parse as JSON' + where + ': ' + e.message };
  }
}

export function sha256(buf) { return 'sha256-' + crypto.createHash('sha256').update(buf).digest('hex'); }

/* ---------------- reading the filesystem ---------------- */
/* ENOENT IS AN ANSWER. EVERY OTHER ERRNO IS AN UNKNOWN, AND AN UNKNOWN IS NEVER
   SPELLED `[]`.

   "It is not there" is a fact a caller can act on, and it is the only case the
   catches below were ever written for. EACCES, EPERM, ENOTDIR, ELOOP,
   ENAMETOOLONG and EMFILE are not facts about the tree — they are the read
   failing — and a read failure that returns an empty array, or quietly drops
   one subtree, is indistinguishable from a clean tree. That is this family's
   most expensive bug shape and the one the whole corpus is written against: not
   a check that broke, a check that stopped checking and kept printing green.

   Measured on this repo, not reasoned about. Deny read on ONE subdirectory,
   Extension/Full_Screen_Shot/pages, and nothing anywhere says a word:

     lint.mjs fullshot     26 file(s) parse — 15 shipped  ->  16 file(s) — 5     EXIT 0
     policy-check.mjs      85 packaged file(s)            ->  67                 EXIT unchanged
                           zero network calls in 15 script(s)  ->  in 5, still PASS

   Ten shipped page scripts stopped being parsed and stopped being scanned for
   network calls, and both gates printed the same verdict line as a healthy run.
   The `length === 0` guards downstream (lint.mjs:163, lint.mjs:186,
   policy-check.mjs:76, new-tool.mjs:139, sync-core.mjs:110) do not help here:
   every one of them tests zero-versus-nonzero, and a PARTIAL read walks past all
   five. The category-directory case is worse still — with Extension/ unreadable,
   discover.mjs printed "tools on disk: NONE ... That is a real state, not a
   search failure" and exited 0. An empty CI matrix, every tool skipped, green.

   So nothing in this module swallows. A read that fails exits 2 (CANNOT RUN)
   naming the path and the errno, which is the honest answer; the alternative is
   a gate grading a subset it cannot name while reporting on the whole.

   THE CONTRACT THIS GIVES CALLERS, and the reason it is shaped this way: every
   signature stays exactly as it was. walk() still returns string[], so its nine
   consumers — packagedFiles below, lint.mjs:78 and :92, check-core-sync.mjs:65,
   :138 and :139, sync-core.mjs:109 and :135, new-tool.mjs:138 — need no change
   and cannot half-adopt it. They either receive a COMPLETE list or they never
   get control back. A `{files, errors}` return would have been the same promise
   with nine chances to ignore it. */
function unreadable(verb, abs, e) {
  die('cannot ' + verb + ' ' + abs + ': ' + e.code + ' — ' + e.message + '\n' +
    'That is a read failing, not a directory being empty, and every gate here grades "the\n' +
    'packaged set" — a file list short by an unreadable subtree passes exactly like a complete\n' +
    'one. Refusing to answer with a partial set. Fix the permissions or the path and re-run.');
}

/* Recursive walk returning repo-relative POSIX paths. Bounded by `skip` rather
   than by depth: these trees are hand-made, not generated, and a symlink loop
   is caught by the visited-set. */
export function walk(rootAbs, { skip = () => false, base = '' } = {}) {
  const out = [];
  const seen = new Set();
  (function rec(relDir) {
    const abs = relDir ? path.join(rootAbs, relDir) : rootAbs;
    let real;
    /* ENOENT here is the walk root not existing, and several callers walk a
       vendor directory that may legitimately be absent — sync-core.mjs:135
       pre-checks with existsSync, check-core-sync.mjs:65 does not — with the
       zero-length guards downstream already grading that case. It cannot be a
       dangling link: statSync below runs first for every non-root entry. */
    try { real = fs.realpathSync(abs); } catch (e) { if (e.code === 'ENOENT') return; unreadable('resolve', abs, e); }
    if (seen.has(real)) return;
    seen.add(real);
    let names;
    try { names = fs.readdirSync(abs).sort(); } catch (e) { if (e.code === 'ENOENT') return; unreadable('read directory', abs, e); }
    for (const name of names) {
      const rel = relDir ? relDir + '/' + name : name;
      if (skip(rel)) continue;
      const entryAbs = path.join(rootAbs, rel);
      let st;
      /* A dangling symlink or junction throws ENOENT from statSync — measured,
         both realpathSync and statSync report ENOENT for one — and it is the
         single entry that is neither file nor directory and must be skipped
         rather than reported. Everything else reaching here is a read failure. */
      try { st = fs.statSync(entryAbs); } catch (e) { if (e.code === 'ENOENT') continue; unreadable('stat', entryAbs, e); }
      if (st.isDirectory()) rec(rel);
      else if (st.isFile()) out.push(rel);
    }
  })(base);
  return out.sort();
}

// ---------------- glob ----------------
//
// Just enough of the syntax tool.json actually uses. NOTE the comment style:
// these are line comments, not a block, because a doubled star followed by a
// slash IS a block-comment terminator and every glob below contains one. That
// is not a hypothetical — templates/tool/TEMPLATE.md records it happening twice in
// this family, once swallowing an entire CSS light-token block (dark mode
// looked perfect, light mode had no focus ring, every static check still
// passed) and once making node report a syntax error 130 lines from its cause.
//
//   <star><star>/*.node.js        any depth, that extension
//   <star><star>/node_modules/**  any depth, everything beneath it
//   Reference/**                  that directory, everything beneath it
//   content/                      a directory prefix (trailing slash)
//
// Deliberately NOT a full glob implementation. A pattern language nobody can
// predict is how an exclude list silently stops excluding — and this repo has
// already paid for exactly that, in a packaging allowlist whose underscore
// exclusion would have dropped all 55 locale directories the day i18n landed.
export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // A doubled star followed by a slash matches zero or more directory
        // segments; a bare doubled star matches anything, slashes included.
        if (pattern[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; }
        else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

export function matchesAny(relPath, patterns) {
  for (const p of patterns) {
    if (!p) continue;
    /* A trailing slash means "this directory and everything in it" — the form
       tool.json's `include` uses (`"content/"`, `"vendor/core/"`). */
    if (p.endsWith('/')) { if (relPath === p.slice(0, -1) || relPath.startsWith(p)) return p; continue; }
    if (relPath === p) return p;
    if (globToRegExp(p).test(relPath)) return p;
  }
  return null;
}

/* ---------------- naming rules (spec §1.1) ---------------- */
export const RE_TOOL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const RE_CATEGORY_DIR = /^[A-Z][a-z0-9]*$/;                       // Extension, Web, Cli, Desktop
export const RE_TOOL_DIR = /^[A-Z][A-Za-z0-9]*(?:_[A-Z0-9][A-Za-z0-9]*)*$/; // Full_Screen_Shot

/* Chrome: 1–4 dot-separated integers, 0–65535, no leading zeros, and NO
   pre-release suffix — `1.9.11-beta` is illegal (spec §3.1). */
export const RE_VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;

export function versionProblem(v) {
  if (typeof v !== 'string' || !v) return 'missing';
  if (!RE_VERSION.test(v)) {
    return 'not a legal extension version: "' + v + '". Chrome accepts 1 to 4 dot-separated ' +
      'integers, each 0-65535, with no leading zeros and NO pre-release suffix (1.9.11-beta is rejected ' +
      'at upload). Use the 4th component for store-only re-uploads: 1.9.11.1';
  }
  const parts = v.split('.').map(Number);
  const over = parts.find(n => n > 65535);
  if (over !== undefined) return 'component ' + over + ' exceeds the 65535 maximum in "' + v + '"';
  return null;
}

/* Newest first, Keep-a-Changelog: `## [1.9.11] — 2026-07-17`. An `[Unreleased]`
   heading above it is skipped rather than rejected — it is the format's own
   convention and refusing it would push people to stop using the format. Any of
   -, en dash or em dash is accepted as the separator: which dash a heading uses
   is not a fact worth failing a release over. */
export function changelogTop(text) {
  const re = /^##\s*\[([^\]]+)\]/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].trim();
    if (/^unreleased$/i.test(label)) continue;
    return label;
  }
  return null;
}

// ---------------- discovery ----------------
//
// Spec §4.1: discover.mjs globs Category/Tool/tool.json — depth exactly two,
// which is the naming rule of §1.1 expressed as a filesystem shape.
const NON_CATEGORY = new Set(['scripts', 'templates', 'docs', 'core', 'node_modules', 'dist', 'build', 'out', 'private']);

export function listToolPaths(root) {
  const out = [];
  let top;
  try { top = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { die('cannot read repo root ' + root + ': ' + e.message); }
  for (const c of top) {
    if (!c.isDirectory()) continue;
    if (c.name.startsWith('.') || c.name.startsWith('_')) continue;
    if (NON_CATEGORY.has(c.name)) continue;
    let tools;
    /* The repo root already dies four lines up; a CATEGORY that cannot be read
       has to as well, and this is the highest-stakes swallow in the file. With
       Extension/ denied, discover.mjs built an EMPTY matrix and announced it as
       a finding — "tools on disk: NONE ... That is a real state, not a search
       failure" — then exited 0. Every gate for every tool skipped, CI green,
       and the message asserting the exact opposite of the truth. */
    const catAbs = path.join(root, c.name);
    try { tools = fs.readdirSync(catAbs, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') continue; unreadable('read category directory', catAbs, e); }
    for (const t of tools) {
      if (!t.isDirectory()) continue;
      const rel = c.name + '/' + t.name;
      if (fs.existsSync(path.join(root, rel, 'tool.json'))) out.push({ category: c.name, dirName: t.name, rel });
    }
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/* ---------------- validation ---------------- */
const STATUSES = ['idea', 'wip', 'shipping', 'archived'];
const SURFACES = ['extension', 'web', 'cli', 'desktop'];
/* README / NOTES / absent are DOCUMENTATION keys, and they are first-class here
   rather than tolerated. Every hand-written JSON file in this family carries
   them — publish/identity.json, skeleton.json, core/core.json — because a
   config file that cannot explain itself gets explained in a document that then
   goes stale separately. `absent` in particular is how a tool records what the
   architecture names but this tool does not have, so a reader can tell a gap
   from an oversight. Warning about them would have trained people to delete the
   only place the reasoning lives. */
const DOC_KEYS = ['README', 'NOTES', 'absent'];
/* 🔴 `storeMetadata` WAS MISSING HERE FROM 2026-08-20 UNTIL LATER THE SAME DAY, AND THE WARNING IT
   PRODUCED WAS FALSE. The key was added to tool.json with the store layer and IS read —
   scripts/check-store-metadata.mjs reads nothing else — but this list did not know about it, so every
   `discover.mjs` run printed `unknown key "storeMetadata" — nothing reads it`.
   That is worse than a missing warning: a reader who believed it would have deleted a key three store
   listings and a wired CI gate depend on. A vocabulary list is a second declaration of what exists,
   and the second declaration is the one that goes stale. */
const KNOWN_KEYS = ['$schema', 'id', 'name', 'surface', 'status', 'summary', 'aiHandoff',
  'manifest', 'core', 'package', 'targets', 'tests', 'policy', 'listings', 'storeMetadata', 'build', ...DOC_KEYS];

export function loadTool(root, entry) {
  const rel = typeof entry === 'string' ? entry : entry.rel;
  const dirAbs = path.join(root, rel);
  const jsonAbs = path.join(dirAbs, 'tool.json');
  const errors = [];
  const warnings = [];
  const where = rel + '/tool.json';

  const parsed = readJson(jsonAbs);
  if (parsed.error) return { rel, errors: [parsed.error], warnings, tool: null };
  if (hadBom(jsonAbs)) {
    errors.push(where + ' starts with a UTF-8 byte order mark. Rewrite it without one — a BOM ' +
      'breaks strict JSON readers and PowerShell 5.1 writes one by default from `Out-File -Encoding utf8`.');
  }
  const j = parsed.value;
  if (j === null || typeof j !== 'object' || Array.isArray(j)) {
    return { rel, errors: [where + ' must contain a JSON object, found ' + (Array.isArray(j) ? 'an array' : typeof j)], warnings, tool: null };
  }

  const [category, dirName] = rel.split('/');
  const req = (key, type, why) => {
    const v = j[key];
    if (v === undefined || v === null) { errors.push(where + ': "' + key + '" is required. ' + why); return null; }
    if (type === 'string' && (typeof v !== 'string' || !v.trim())) {
      errors.push(where + ': "' + key + '" must be a non-empty string, found ' + JSON.stringify(v) + '. ' + why);
      return null;
    }
    if (type === 'object' && (typeof v !== 'object' || Array.isArray(v))) {
      errors.push(where + ': "' + key + '" must be an object, found ' + (Array.isArray(v) ? 'an array' : typeof v) + '. ' + why);
      return null;
    }
    if (type === 'array' && !Array.isArray(v)) {
      errors.push(where + ': "' + key + '" must be an array, found ' + typeof v + '. ' + why);
      return null;
    }
    return v;
  };

  /* id — the one field a rename can never fix. */
  const id = req('id', 'string', 'It is the stable public handle: git tags (<id>-v<version>), release artifact names and the CI matrix are all built from it.');
  if (id && !RE_TOOL_ID.test(id)) {
    errors.push(where + ': "id" is "' + id + '" but must be lowercase-kebab (' + RE_TOOL_ID.source + '). ' +
      'It appears in a git tag and a zip filename, so uppercase and underscores are not available.');
  }

  req('name', 'string', 'The product name as users see it, e.g. "FullShot".');
  const summary = req('summary', 'string', 'One sentence for the README catalog table.');
  if (summary && summary.length > 160) {
    warnings.push(where + ': "summary" is ' + summary.length + ' characters. It becomes a README table cell; keep it under about 160 so the table stays readable.');
  }

  const surface = req('surface', 'string', 'One of: ' + SURFACES.join(', ') + '. The delivery surface decides the toolchain and the store target.');
  if (surface && !SURFACES.includes(surface)) {
    errors.push(where + ': "surface" is "' + surface + '", expected one of ' + SURFACES.join(', ') + '.');
  } else if (surface && category && surface !== category.toLowerCase()) {
    errors.push(where + ': "surface" is "' + surface + '" but this tool lives under ' + category + '/. ' +
      'A category IS the delivery surface (spec §1.1) — they cannot disagree.');
  }

  const status = req('status', 'string', 'One of: ' + STATUSES.join(', ') + '.');
  if (status && !STATUSES.includes(status)) {
    errors.push(where + ': "status" is "' + status + '", expected one of ' + STATUSES.join(', ') + '.');
  }

  if (category && !RE_CATEGORY_DIR.test(category)) {
    errors.push('category directory "' + category + '/" is not Capitalized_Singular (spec §1.1). Expected e.g. Extension/, Web/, Cli/, Desktop/.');
  }
  if (dirName && !RE_TOOL_DIR.test(dirName)) {
    errors.push('tool directory "' + rel + '" is not Title_Snake_Case (spec §1.1). Expected e.g. Full_Screen_Shot/.');
  }

  /* manifest — the SINGLE source of truth for the version (spec §3.1). */
  const manifestRel = typeof j.manifest === 'string' && j.manifest ? j.manifest : 'manifest.json';
  const manifestAbs = path.join(dirAbs, manifestRel);
  let manifest = null;
  if (!fs.existsSync(manifestAbs)) {
    errors.push(where + ': "manifest" points at ' + rel + '/' + manifestRel + ', which does not exist.');
  } else {
    const mp = readJson(manifestAbs);
    if (mp.error) errors.push(mp.error);
    /* PARSING IS NOT THE SAME AS BEING USABLE, and this is the same rule as the
       one above the walk, applied to a JSON value instead of a directory: `[]`,
       `null`, `42` and `"x"` all parse, after which every downstream
       `manifest.<key>` reads undefined — which the gates grade as ABSENCE, and
       absence is the thing they were built to reward. Measured with
       manifest.json set to []: this function returned ZERO errors and
       policy-check printed PASS "no permissions requested — the strongest
       possible answer to a permission review" about a tool that declares five,
       PASS "no static host_permissions", and PASS "name/short_name/description
       within store limits". A manifest that is MISSING is already fatal eleven
       lines up; one that is unusable has to weigh the same, or "cannot be read"
       ends up stricter than "cannot be used". It is the same treatment tool.json
       itself gets at the top of this function, for the same reason: this is
       structure, not content, so it belongs in the loader. */
    else if (mp.value === null || typeof mp.value !== 'object' || Array.isArray(mp.value)) {
      errors.push(where + ': "manifest" points at ' + rel + '/' + manifestRel + ', which parses as ' +
        (mp.value === null ? 'null' : Array.isArray(mp.value) ? 'an array' : 'a ' + typeof mp.value) +
        '. A manifest must be a JSON object — every gate reads keys off it, and a non-object makes ' +
        'them all report "key absent", which is graded as compliance.');
    } else manifest = mp.value;
  }
  /* The manifest's version FORMAT is deliberately NOT validated here.
     This function validates the tool.json CONTRACT — the things that must hold
     before any gate can run. A malformed version string breaks no structure; it
     is content, and check-version.mjs and policy-check.mjs both grade it. Making
     it fatal here meant those gates could never report it as their own failure:
     they exited 2 ("could not run") with the message coming from the loader, so
     the one script whose entire job is version agreement was the one script that
     could not say so. Found by scripts/test/selftest.node.js. */
  if (j.version !== undefined) {
    errors.push(where + ' carries a "version" field. It must not: the manifest is the single source of ' +
      'truth for the version (spec §3.1) and every duplicate is a drift bug waiting for a release day.');
  }

  /* package — what ships. */
  const pkg = req('package', 'object', 'It declares what goes into the zip: { "include": [...], "exclude": [...] }.');
  if (pkg) {
    if (!Array.isArray(pkg.include) || pkg.include.length === 0) {
      errors.push(where + ': "package.include" must be a non-empty array of paths or directory prefixes ' +
        '(e.g. ["manifest.json", "background.js", "pages/", "_locales/"]). An empty include ships nothing.');
    }
    if (pkg.exclude !== undefined && !Array.isArray(pkg.exclude)) {
      errors.push(where + ': "package.exclude" must be an array of glob patterns.');
    }
  }

  /* policy — the privacy claim in machine-readable form (spec §1.3, §4.3).
     Only its SHAPE is checked here. The contents (is every permission
     justified, is networkAllowlist declared) are graded by policy-check.mjs,
     which is the script that consumes them — for the same reason the manifest
     version format moved out of this function. A check that lives in the loader
     turns every gate's exit code into 2 "could not run", so the gate that owns
     the rule can never be the one that reports it, and the branch inside that
     gate becomes an assertion that cannot fail. */
  req('policy', 'object', 'It carries the permission justifications and the network allowlist that policy-check enforces.');

  /* tests — a listed test that does not exist is a test that silently stopped
     running. That is this corpus's single most expensive class of bug. */
  if (j.tests !== undefined) {
    if (!Array.isArray(j.tests)) errors.push(where + ': "tests" must be an array of paths relative to ' + rel + '/.');
    else for (const t of j.tests) {
      if (typeof t !== 'string') { errors.push(where + ': every entry in "tests" must be a string, found ' + JSON.stringify(t)); continue; }
      if (!fs.existsSync(path.join(dirAbs, t))) {
        errors.push(where + ': "tests" lists ' + rel + '/' + t + ', which does not exist. A test path that no ' +
          'longer resolves does not fail — it silently stops running, and the suite still reports green.');
      }
    }
  }

  /* targets / overlays. */
  if (j.targets !== undefined) {
    if (typeof j.targets !== 'object' || Array.isArray(j.targets)) errors.push(where + ': "targets" must be an object.');
    else {
      const ff = j.targets.firefox;
      if (ff && typeof ff.overlay === 'string' && !fs.existsSync(path.join(dirAbs, ff.overlay))) {
        errors.push(where + ': targets.firefox.overlay points at ' + rel + '/' + ff.overlay + ', which does not exist.');
      }
    }
  }

  /* core channel. */
  if (j.core !== undefined && j.core !== null) {
    if (typeof j.core !== 'object' || Array.isArray(j.core)) {
      errors.push(where + ': "core" must be an object like { "channel": "v1", "pin": null }, or be omitted entirely if this tool vendors no shared core.');
    } else if (j.core.channel !== null && j.core.channel !== undefined && !/^v\d+$/.test(String(j.core.channel))) {
      errors.push(where + ': core.channel is ' + JSON.stringify(j.core.channel) + '. It names a directory under core/ and must look like "v1".');
    }
  }

  for (const k of Object.keys(j)) {
    if (!KNOWN_KEYS.includes(k)) {
      warnings.push(where + ': unknown key "' + k + '" — nothing reads it. Known keys: ' + KNOWN_KEYS.join(', ') + '.');
    }
  }

  const tool = {
    id: id || null,
    name: j.name || null,
    surface: surface || null,
    status: status || null,
    summary: j.summary || '',
    aiHandoff: j.aiHandoff || '',
    rel, dirAbs, category, dirName,
    jsonPath: jsonAbs,
    manifestRel, manifestAbs, manifest,
    version: manifest ? manifest.version : null,
    core: j.core === undefined ? null : j.core,
    package: j.package || { include: [], exclude: [] },
    targets: j.targets || {},
    tests: Array.isArray(j.tests) ? j.tests : [],
    policy: j.policy || {},
    listings: j.listings || {},
    build: j.build || null,
    raw: j
  };
  return { rel, errors, warnings, tool: errors.length ? null : tool };
}

/* Loads every tool, and refuses to return a partial answer. A duplicate id is
   fatal here rather than downstream: two tools sharing an id produce two CI
   matrix jobs writing the same artifact name, and the second silently wins. */
export function loadAllTools(root) {
  const entries = listToolPaths(root);
  const tools = [];
  const errors = [];
  const warnings = [];
  for (const e of entries) {
    const r = loadTool(root, e);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    if (r.tool) tools.push(r.tool);
  }
  const byId = new Map();
  for (const t of tools) {
    if (byId.has(t.id)) {
      errors.push('duplicate tool id "' + t.id + '": declared by both ' + byId.get(t.id).rel + '/tool.json and ' +
        t.rel + '/tool.json. The id is the release-artifact name — two tools cannot share one.');
    } else byId.set(t.id, t);
  }
  return { tools, errors, warnings, byId };
}

/* Accepts an id ("fullshot") or a path ("Extension/Full_Screen_Shot", with
   either slash). Exits 2 when it cannot resolve — a gate that silently checks
   nothing because the name was mistyped is worse than one that refuses. */
export function resolveTool(root, selector) {
  if (!selector) die('no tool given.\nusage: <script> <tool-id|Category/Tool_Dir> [options]');
  const { tools, errors, byId } = loadAllTools(root);
  if (errors.length) {
    console.error('CANNOT RUN — tool.json problems must be fixed before any gate can run:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(2);
  }
  const norm = String(selector).replace(/\\/g, '/').replace(/\/+$/, '');
  if (byId.has(norm)) return byId.get(norm);
  const byPath = tools.find(t => t.rel === norm);
  if (byPath) return byPath;
  /* Accept a path into the tool as well, e.g. Extension/Full_Screen_Shot/manifest.json */
  const inside = tools.find(t => norm.startsWith(t.rel + '/'));
  if (inside) return inside;
  die('no tool named "' + selector + '".\n' +
    (tools.length
      ? 'known tools: ' + tools.map(t => t.id + ' (' + t.rel + ')').join(', ')
      : 'this repo currently contains NO tool.json files, so no tool can be named. ' +
        'A tool joins the monorepo by adding tool.json + CHANGELOG.md to its directory (spec §1.3).'));
}

/* ---------------- what actually ships ---------------- */
/* Returns the file set tool.json's package rules select, PLUS every
   _locales/<lang>/messages.json on disk, unioned in unconditionally.

   The union is not belt-and-braces, it is the lesson: `_locales` is governed by
   a pattern language in `include`/`exclude`, and four independent innocent-
   looking edits can each silently drop 55 locale directories — after which
   Chrome REFUSES to load the extension at all, because its declared
   default_locale catalogue is absent. So localisation does not go through the
   pattern language. The two paths are then independent implementations of the
   same claim, and the returned `missedByRules` / `missedByCollector` pair
   reports any disagreement in EITHER direction: the bug is both impossible AND
   visible. (This sentence promised a function called `localeDrift` until
   2026-08-15. There has never been one anywhere in the repo — and the check it
   named was, until the same day, computed in one direction only. A comment
   describing a guarantee nobody implemented is how the guarantee gets believed
   instead of built.)

   This mirrors templates/tool/publish/pack.mjs, which reached the same conclusion
   for the same reason. It is deliberately a SECOND implementation rather than
   an import: pack.mjs is per-tool and this is repo-wide, and two agreeing
   implementations catch what one cannot. */
export function packagedFiles(root, tool) {
  const include = Array.isArray(tool.package.include) ? tool.package.include : [];
  const exclude = Array.isArray(tool.package.exclude) ? tool.package.exclude : [];

  const all = walk(tool.dirAbs, {
    skip: rel => {
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      return name === '.git' || name === 'node_modules';
    }
  });

  const viaRules = all.filter(rel => matchesAny(rel, include) && !matchesAny(rel, exclude));
  const localesOnDisk = localeMessageFiles(tool.dirAbs);
  const files = Array.from(new Set([...viaRules, ...localesOnDisk])).sort();

  /* THE DRIFT REPORT, BOTH WAYS — it used to be computed in one direction only.
     `missedByRules` is catalogues the pattern language misses, which is the
     benign direction: the collector still ships them, so the zip is right and a
     warning is the correct volume. The direction that was never computed is the
     one that bites. A catalogue the RULES can see and the unconditional
     collector cannot means the collector is blind, and `localesOnDisk` — the
     list policy-check's store-limit and thin-locale gates are about to be
     graded against — is a lie. Two implementations only catch what one cannot
     if the comparison is symmetric; comparing in one direction is one
     implementation with an audit trail.

     Not hypothetical, and not only a permissions story. Measured on this tree
     with _locales/fr replaced by a junction to the same content (Windows makes
     one without admin, and readdirSync reports it isSymbolicLink, NOT
     isDirectory): localesOnDisk 54, viaRules 55, missedByRules [], and
     policy-check printed "85 packaged file(s): 55 locale catalogue(s)" and
     'default_locale "en" resolves — 54 catalogue(s) packaged' in the same run.
     It contradicted itself inside one report and passed. A locale shipped in
     the zip that no gate ever graded, with no signal anywhere.
     `missedByCollector` is that run's signal, and it is a FAIL, not a warning:
     unlike the other direction, the file set is not saved by the union. */
  const missedByRules = localesOnDisk.filter(f => !viaRules.includes(f));
  const missedByCollector = viaRules.filter(f => RE_LOCALE_CATALOGUE.test(f) && !localesOnDisk.includes(f));
  return { files, viaRules, localesOnDisk, missedByRules, missedByCollector };
}

/* Exactly _locales/<one segment>/messages.json — the shape localeMessageFiles
   emits, so the two sides of the comparison above cannot drift on spelling. */
const RE_LOCALE_CATALOGUE = /^_locales\/[^/]+\/messages\.json$/;

/* Enumerated directly: no include rule, no exclude test, no depth budget.
   There is no expressible value of include/exclude that can drop a locale.

   ENOENT is the one tolerated failure, and it is a real answer: a tool with no
   _locales tree is legitimate and policy-check grades it "no localisation".
   Every other errno is fatal, because the alternative was measured and it is a
   clean red-to-green flip. With _locales unreadable (a plain file in its place
   is enough — ENOTDIR) and no default_locale in the manifest, the true verdict

     FAIL  default_locale is declared
           the tree holds 55 locale catalogue(s) but the manifest sets no default_locale.
           The store rejects this outright: "Localization used, but default_locale wasn't specified".

   became

     PASS  no localisation — no _locales tree and no default_locale — consistent

   An empty answer read as a clean one, in the one function whose entire purpose
   is that no rule can quietly drop a locale. Note that the OTHER arm of the
   union does not save this: gate 6 asks localesOnDisk, not the file set.

   The dirent type test stays deliberately narrow. An entry that is a link
   rather than a directory is not guessed at here — it is caught by the two-way
   drift check in packagedFiles, which is the mechanism this whole design is
   supposed to rest on, and a second place that quietly widens the definition of
   "locale directory" is a second place for the two paths to agree by accident. */
export function localeMessageFiles(dirAbs) {
  const dir = path.join(dirAbs, '_locales');
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; unreadable('read', dir, e); }
  return names.filter(e => e.isDirectory())
    .map(e => '_locales/' + e.name + '/messages.json')
    .filter(rel => {
      /* throwIfNoEntry:false is node's own ENOENT switch: a locale directory
         holding no catalogue returns undefined instead of throwing, so the
         legitimate case needs no errno string compare and every genuine read
         failure still reaches the catch. */
      const abs = path.join(dirAbs, rel);
      let st;
      try { st = fs.statSync(abs, { throwIfNoEntry: false }); } catch (e) { unreadable('stat', abs, e); }
      return st ? st.isFile() : false;
    })
    .sort();
}

/* Resolve __MSG_key__ against a locale catalogue. Store limits are enforced on
   what a user SEES, and what a user sees is the translated string — measuring
   the length of the literal "__MSG_appDescription__" measures nothing. */
export function readLocale(dirAbs, locale) {
  const abs = path.join(dirAbs, '_locales', locale, 'messages.json');
  if (!fs.existsSync(abs)) return { error: '_locales/' + locale + '/messages.json does not exist' };
  const p = readJson(abs);
  if (p.error) return { error: p.error };
  return { messages: p.value, abs };
}

/* chrome.i18n supplies these itself. They are NEVER in messages.json, and a
   gate that demands they be there fails a correct extension — FullShot uses
   __MSG_@@bidi_dir__ exactly as documented. Found by running the gate against
   the real tree; the fixture had no bidi support and would never have shown it. */
export const PREDEFINED_MESSAGES = new Set([
  '@@extension_id', '@@ui_locale', '@@bidi_dir', '@@bidi_reversed_dir',
  '@@bidi_start_edge', '@@bidi_end_edge'
]);

export function resolveMessages(text, messages) {
  const missing = [];
  const out = String(text).replace(/__MSG_([A-Za-z0-9_@]+)__/g, (all, key) => {
    if (PREDEFINED_MESSAGES.has(key)) return all;
    const entry = messages && messages[key];
    if (!entry || typeof entry.message !== 'string') { missing.push(key); return '__MSG_' + key + '__'; }
    return entry.message;
  });
  return { text: out, missing };
}

export const RE_MSG_PLACEHOLDER = /__MSG_([A-Za-z0-9_@]+)__/g;
