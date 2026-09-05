/* discover.mjs — which tools does this push actually affect?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/discover.mjs                       list every tool
     node scripts/discover.mjs --base <sha>          only tools the diff touches
     node scripts/discover.mjs --base <sha> --out "$GITHUB_OUTPUT"
     node scripts/discover.mjs --json                machine-readable, stdout

   Emits `tools=["fullshot",...]` and `count=N`, which ci.yml turns into the
   job matrix. IT EMITS IDS, NOT PATHS: the artifact names, the zip names and
   the release tags are all built from the id, and a matrix keyed on anything
   else has to translate somewhere — which is a place to get it wrong.

   THE THREE WAYS THIS SCRIPT IS ALLOWED TO BE WRONG, AND WHICH ONE IT PICKS

   Testing too few tools ships a break. Testing too many wastes runner minutes.
   Those are not symmetrical, so every ambiguity here resolves to ALL TOOLS:

     - no --base, an empty --base, or the all-zeros sha GitHub sends for the
       first push to a branch  ->  ALL
     - a --base git cannot resolve (force-push, shallow clone, deleted branch)
       ->  ALL, with the reason printed
     - the commit-subject fallback cannot READ the subjects (git log failed)
       ->  ALL, with the reason printed
     - not a git repository at all  ->  ALL, with the reason printed
     - the diff touches core/, scripts/, .github/ or a root-level config file
       ->  ALL, because those change what every tool is graded by

   WHY THE EMPTY ANSWER IS PRINTED LOUDLY

   `count=0` is a legitimate outcome — ci.yml guards on it — but it is also
   exactly what a broken glob produces, and a broken glob looks like a green
   run. So a zero-tool answer always explains WHY it is zero: no tool.json
   files at all, or a diff that touched none of them. "No matches found" from a
   search that never looked in the right place is this corpus's most expensive
   recurring bug; it does not get to hide here.

   Exit codes: 0 the matrix is trustworthy · 1 a tool.json is malformed or two
   tools share an id (a matrix built on that is quietly wrong) · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, die, EXIT_OK, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, loadAllTools } from './lib/toolinfo.mjs';

/* `--json` and `--all` are booleans and parseArgs takes the next token as a
   flag's value (report.mjs:137-139), so `--all <anything>` silently read as
   --all OFF — a NARROWER matrix from a flag whose whole job is to widen it.
   Same treatment as lint.mjs:48. Only --base, --out and --repo-root take values. */
const BOOLEAN_FLAGS = ['json', 'all'];
const args = parseArgs(process.argv.slice(2)
  .map(a => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
args.rejectUnknown(['base', 'out', 'json', 'repo-root', 'all']);
const root = repoRoot(args);

/* Paths that change how EVERY tool is graded. A change here widens the matrix
   to everything, because the gates themselves moved. */
const WIDENS_TO_ALL = [
  'core/', 'scripts/', '.github/', 'templates/',
  '.gitattributes', '.gitignore', '.githooks/'
];

const { tools, errors, warnings } = loadAllTools(root);

if (errors.length) {
  console.error('CANNOT BUILD A CI MATRIX — ' + errors.length + ' tool.json problem(s):');
  for (const e of errors) console.error('  - ' + e);
  console.error('\nA matrix built from a malformed tool.json is quietly wrong: it skips a tool, or it');
  console.error('gives two tools the same artifact name and the second silently overwrites the first.');
  process.exit(EXIT_FAIL);
}
for (const w of warnings) console.log('WARN  ' + w);

const allIds = tools.map(t => t.id).sort();

function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function isGitRepo() {
  try { git(['rev-parse', '--git-dir']); return true; } catch (_) { return false; }
}

/* Returns {files, reason} — files===null means "could not diff, widen to all". */
function changedFiles(base) {
  if (!base || base === '' || /^0{7,40}$/.test(base)) {
    return { files: null, reason: 'no usable --base (GitHub sends an all-zeros sha for the first push to a branch)' };
  }
  if (!isGitRepo()) return { files: null, reason: 'not a git repository (' + root + ')' };
  try { git(['cat-file', '-e', base + '^{commit}']); }
  catch (_) { return { files: null, reason: 'git cannot resolve base "' + base + '" — force-push, shallow clone, or a deleted branch' }; }
  let out;
  try { out = git(['diff', '--name-only', base + '...HEAD']); }
  catch (_) {
    /* No merge base (unrelated histories) — fall back to a straight two-dot
       diff rather than reporting an empty change set, which would test nothing. */
    try { out = git(['diff', '--name-only', base, 'HEAD']); }
    catch (e2) { return { files: null, reason: 'git diff against "' + base + '" failed: ' + String(e2.message).split('\n')[0] }; }
  }
  return { files: out.split('\n').map(s => s.trim()).filter(Boolean), reason: null };
}

/* CONTRIBUTING §7: commits are `<tool-id>: <imperative summary>`. That prefix is
   the fallback when path detection is ambiguous — a commit that only edits a
   file outside any tool directory but says `fullshot:` is telling you which
   tool the author believes they changed, and believing them costs one job.

   Returns {ids, error}, and the sentinel is the point. A git failure here used
   to return [], which the caller then published as "no commit subject carried a
   tool-id prefix" — a claim about subjects it had never read — with count=0,
   which ci.yml turns into skipping every per-tool job. Silent, green, testing
   nothing: the one git call in this file that failed CLOSED, against a header
   (:19, :29-36) that promises every ambiguity widens and every zero explains
   itself. `ids: []` still means what it always meant — read, none matched.

   No `-1` fallback: an empty or all-zeros base is already `files === null` out
   of changedFiles and widened at :153 before this is ever called, so the branch
   could not be taken and only inflated apparent coverage. */
function idsFromCommitSubjects(base) {
  let out;
  try { out = git(['log', '--format=%s', base + '..HEAD']); }
  catch (e) {
    /* execFileSync's own message is only "Command failed: git log …". What git
       actually objected to is on the piped stderr, and that is the half a
       reader can act on. */
    return { ids: null, error: String(e.stderr || '').trim().split('\n')[0] || String(e.message).split('\n')[0] };
  }
  const found = new Set();
  for (const s of out.split('\n').map(s => s.trim()).filter(Boolean)) {
    const m = /^([a-z][a-z0-9-]*)\s*:/.exec(s);
    if (m && allIds.includes(m[1])) found.add(m[1]);
  }
  return { ids: [...found], error: null };
}

let selected;
let why;

if (args.bool('all') || tools.length === 0) {
  selected = allIds;
  why = args.bool('all') ? '--all was given' : 'there are no tools to select from';
} else {
  /* Trimmed ONCE, here. It used to be trimmed for changedFiles and passed raw to
     idsFromCommitSubjects, so a base carrying whitespace — an env var with a
     trailing newline, a shell-quoted argument — resolved fine for cat-file and
     diff and then failed `git log`, landing squarely in the swallow that was. */
  const rawBase = args.get('base', process.env.GITHUB_BASE_SHA || '');
  const base = typeof rawBase === 'string' ? rawBase.trim() : '';
  const { files, reason } = changedFiles(base);
  if (files === null) {
    selected = allIds;
    why = 'widened to ALL tools: ' + reason;
  } else {
    const widener = files.find(f => WIDENS_TO_ALL.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p)));
    if (widener) {
      selected = allIds;
      why = 'widened to ALL tools: ' + widener + ' changed, and that changes what every tool is graded by';
    } else {
      const hit = new Set();
      for (const t of tools) for (const f of files) if (f.startsWith(t.rel + '/')) hit.add(t.id);
      if (hit.size === 0) {
        const { ids: fromSubjects, error: logError } = idsFromCommitSubjects(base);
        if (logError) {
          selected = allIds;
          why = 'widened to ALL tools: git log against "' + base + '" failed: ' + logError +
            ' — the commit subjects were never read, so a zero answer would be a guess';
        } else if (fromSubjects.length) {
          selected = fromSubjects.sort();
          why = 'no changed file fell inside a tool directory; the commit subject prefix named ' + selected.join(', ') +
            ' (CONTRIBUTING §7)';
        } else {
          selected = [];
          why = files.length + ' file(s) changed and none of them are inside a tool directory, ' +
            'and every commit subject was read and none carried a tool-id prefix';
        }
      } else {
        selected = [...hit].sort();
        why = 'changed files fall inside ' + selected.length + ' tool director' + (selected.length === 1 ? 'y' : 'ies');
      }
    }
  }
}

/* ---------------- report ---------------- */
console.log('tools on disk: ' + (allIds.length ? allIds.join(', ') : 'NONE'));
if (allIds.length === 0) {
  console.log('');
  console.log('  This repo currently contains NO Category/Tool/tool.json files.');
  console.log('  That is a real state, not a search failure: no tool has been onboarded to the');
  console.log('  monorepo contract yet. A tool joins by adding tool.json + CHANGELOG.md to its');
  console.log('  directory (spec §1.3) — zero source changes, zero file moves.');
  console.log('  Until then every per-tool gate has nothing to grade, and ci.yml skips the matrix');
  console.log('  on count=0 rather than reporting a green run over an empty set.');
}
console.log('selected:      ' + (selected.length ? selected.join(', ') : 'NONE') + '  (' + why + ')');

const payload = JSON.stringify(selected);

if (args.has('json')) console.log(payload);

const outPath = args.get('out');
if (typeof outPath === 'string' && outPath) {
  /* GITHUB_OUTPUT is append-only and key=value per line. */
  try {
    fs.appendFileSync(path.resolve(outPath), 'tools=' + payload + '\ncount=' + selected.length + '\n', 'utf8');
    console.log('wrote tools/count to ' + outPath);
  } catch (e) { die('cannot write --out "' + outPath + '": ' + e.message); }
}

process.exit(EXIT_OK);
