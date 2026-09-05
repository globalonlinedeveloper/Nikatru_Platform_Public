#!/usr/bin/env node
/* SKELETON — the fleet audit. Which tools are behind, and which have diverged?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED. READ-ONLY: it opens files and prints; it
   writes nothing, anywhere.

     node tools/audit-fleet.mjs                  audit every tool in the repository
     node tools/audit-fleet.mjs <dir> [<dir>…]   audit specific folders
     node tools/audit-fleet.mjs --files          also list every diverged file
     node tools/audit-fleet.mjs --repo-root <d>  audit a different tree (see below)

   WHY THIS EXISTS.

   The moment tool #2 is copied there are two copies of test/harness.js, and no
   way to answer "which tools have the fixed version?" The reference proves both
   halves of the problem: its packaging script shipped with a lexical-sort bug
   that silently diffed against two releases back, and it was fixed one session
   later in exactly one place. Under a copy-the-folder model that fix reaches
   one tool out of 67, and nothing anywhere records which one.

   Retro-fitting provenance is guesswork — by then the copies have diverged for
   good reasons and for accidental ones, and telling them apart means reading
   ~1,600 lines of inherited test code per tool. Stamping it costs one file.

   WHAT IT REPORTS, per tool:

     BEHIND      its skeleton.json names an older skeletonVersion
     DIVERGED    an inherited file's content differs from the template's
     UNSTAMPED   no skeleton.json at all — copied before provenance existed, or
                 copied by hand
     CURRENT     same version, every inherited file byte-identical

   DIVERGED IS NOT AUTOMATICALLY WRONG. A tool may have a real reason to change
   its own copy of a shared file. The point is that the reason should be
   visible, in one list, rather than being 67 silent decisions nobody can find.

   TWO ROLES, TWO NAMES — this is the part that used to be one constant.

   This file is inherited: it is copied into every stamped tool and is meant to
   be run from there (`node tools/audit-fleet.mjs` appears in TEMPLATE.md and
   README-tour.md, both of which are also copied). So it runs in two contexts,
   and the directory above it means something different in each:

     TEMPLATE   the thing every tool is GRADED AGAINST, and the one directory
                excluded from the audit. Found by name — the repository's
                templates/tool (or the pre-move _skeleton), confirmed by a
                skeleton.json whose `tool` and `copiedAt` are empty, which is
                the only thing that distinguishes a template from a copy of it.
     TREE       the directory this copy happens to be running inside. The
                template when run from templates/tool/tools/; a TOOL when run
                from Extension/<Tool>/tools/.

   Until 2026-08-15 one constant, SKELETON = path.resolve(HERE, '..'), served
   both — plus the baseline hashes, plus the printed version. Correct in the
   template, and three wrong answers at once inside a stamped tool: every
   sibling was diffed against THAT tool's own possibly-drifted copies, BEHIND
   was computed against that tool's frozen skeletonVersion (so nothing was ever
   BEHIND), and the running tool excluded itself from its own audit. Measured,
   not predicted: a template at v1.3.0 with two tools stamped v1.1.0 reported
   `0 behind` and one DIVERGED sibling — for a file the RUNNING tool had edited.
   private/OPERATIONS.md:128 had already reproduced the same thing: "a stamped
   copy printed itself as `skeleton`".

   EXIT CODES.

   Drift is a REPORT and always exits 0. BEHIND, DIVERGED and UNSTAMPED are
   findings about the fleet, not failures of this script, and a tool that has
   deliberately changed an inherited file must not fail somebody else's build.
   The two non-zero exits both mean the opposite thing — "do not believe this
   report" — and a later reader restoring "exit 0 always" would reopen both
   holes:

     2  CANNOT RUN     no repository root, no template to compare against, a
                       named path that is not a tool, or a file that could not
                       be read for any reason other than not existing. The
                       audit never started. A usage error is not a drift finding.
     1  BROKEN AUDIT   the walk ran and reached nothing — including, when this
                       copy is inside a stamped tool, not reaching that tool
                       itself. Something moved and discovery did not follow.
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE = path.resolve(HERE, '..');

const die = (why, hint) => {
  console.error('CANNOT RUN — ' + why + (hint ? '\n' + hint : ''));
  process.exit(2);
};
const broken = (why, hint) => {
  console.error('\nBROKEN AUDIT — ' + why + (hint ? '\n' + hint : ''));
  process.exit(1);
};

/* ENOENT is an ANSWER — "the file is not there" is a real result, and an absent
   inherited file is one of the things this script exists to report. Every OTHER
   errno is an UNKNOWN, and an unknown must never be spelled `null`: a tool whose
   skeleton.json could not be read for permissions used to come back
   indistinguishable from a tool that has no provenance at all, and got the
   confident verdict UNSTAMPED. Same rule for a file that does not parse — a
   provenance file you cannot read is not a tool without provenance. */
const readJson = (p) => {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    die('cannot read ' + p + ': ' + e.code);
  }
  /* PowerShell 5.1 writes a BOM by default, and JSON.parse then throws with a
     message naming neither the BOM nor the file. */
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  try { return JSON.parse(text); }
  catch (e) {
    die(p + ' does not parse as JSON: ' + e.message,
      'Reporting this tool as UNSTAMPED would be a wrong answer stated confidently.');
  }
};
const md5 = (p) => {
  try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    die('cannot hash ' + p + ': ' + e.code,
      'An unreadable file is not a file that differs, and it is not a file that matches.');
  }
};

/* ---------------- arguments ---------------- */
/* `--repo-root` / TOOLS_REPO_ROOT exist for the same reason they exist in
   scripts/lib/toolinfo.mjs: the assertions below can only be trusted once they
   have been made to FAIL, and an assertion you can only negative-test by
   breaking the real repository is one nobody will negative-test. An unknown
   option is refused rather than ignored — `--strict` does not exist yet, and
   silently auditing everything while the caller believes they asked for a gate
   is the failure this whole file is about. */
const argv = process.argv.slice(2);
let showFiles = false;
let repoRootFlag = null;
const named = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--files') { showFiles = true; continue; }
  if (a === '--repo-root') { repoRootFlag = argv[++i] || ''; continue; }
  if (a.startsWith('--repo-root=')) { repoRootFlag = a.slice('--repo-root='.length); continue; }
  if (a[0] === '-') die('unknown option ' + a, 'Known options: --files, --repo-root <dir>.');
  named.push(a);
}
if (repoRootFlag !== null && !repoRootFlag) die('--repo-root needs a directory');

/* ---------------- where the repository is ---------------- */
/* NAMED, NOT POSITIONAL, which is the same rule test/browser/smoke.mjs already
   follows for _playwright: ascend looking for a marker, never count `..`
   segments. The walk root used to be path.dirname(SKELETON) — the template's
   PARENT — and that was a synonym for "the repository root" only while the
   template sat at the repository root. It moved to templates/tool/, whose
   parent templates/ has exactly one child: the template, which the walk
   deliberately skips. Result, measured before and after the move: `tools 0
   found`, `0 current · 0 behind · 0 diverged · 0 unstamped`, exit 0. A drift
   audit reporting that nothing has drifted because it looked at nothing.
   MIGRATION.md §6 carries the same measurement.

   The marker is .git, which every clone has by definition. It is a file rather
   than a directory in a worktree or a submodule, so existsSync is the right
   probe and statSync().isDirectory() would not be. */
function findRepoRoot() {
  const forced = repoRootFlag || process.env.TOOLS_REPO_ROOT;
  if (forced) {
    const abs = path.resolve(forced);
    if (!fs.existsSync(abs)) die('repo root does not exist: ' + abs);
    return abs;
  }
  let dir = HERE;
  for (let up = 0; up < 12; up++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return null;
}
const REPO_ROOT = findRepoRoot();

/* ---------------- what we are grading against ---------------- */
/* skeleton.json's own note says it: `tool` and `copiedAt` are "Empty here
   because _skeleton is not a tool", and scripts/new-tool.mjs stamps both the
   moment it copies the folder. That pair is the whole discriminator, and it is
   why a template is found by ASKING rather than by position. Precedence
   mirrors new-tool.mjs: templates/tool first, _skeleton as the pre-move
   fallback, and finally TREE itself for the case that has to keep working —
   running from the template, wherever the template lives. */
const isTemplate = (dir) => {
  const j = readJson(path.join(dir, 'skeleton.json'));
  return !!j && j.tool === '' && j.copiedAt === '';
};
const tried = [];
let TEMPLATE = null;
if (REPO_ROOT) {
  for (const rel of ['templates/tool', '_skeleton']) {
    const abs = path.join(REPO_ROOT, rel);
    tried.push(abs);
    if (isTemplate(abs)) { TEMPLATE = abs; break; }
  }
}
if (!TEMPLATE) {
  tried.push(TREE);
  if (isTemplate(TREE)) TEMPLATE = TREE;
}
if (!TEMPLATE) {
  die('no template to compare against. Looked for a skeleton.json with an empty `tool`\n' +
    'and an empty `copiedAt` in:\n' + tried.map(p => '  ' + p).join('\n'),
    (REPO_ROOT ? '' : 'No repository root either — no .git above ' + HERE + '.\n') +
    'Falling back to this tree\'s own copy is what the old code did implicitly, and it is\n' +
    'the bug: every sibling gets graded against THIS tool\'s files and THIS tool\'s frozen\n' +
    'skeletonVersion, the running tool excludes itself, and the report looks clean.\n' +
    'Pass --repo-root <dir> to point at the tree that holds templates/tool.');
}

const SELF = readJson(path.join(TEMPLATE, 'skeleton.json'));
const INHERITED = SELF.inherited || [];
const BASE = {};
const noReference = [];
for (const rel of INHERITED) {
  const h = md5(path.join(TEMPLATE, rel));
  if (h === null) noReference.push(rel);
  else BASE[rel] = h;
}

/* ---------------- where the tools live ---------------- */
/* Every directory in the repository, one and two levels deep, that contains a
   manifest.json or a tool.json — the Category/Tool shape scripts/lib/toolinfo.mjs
   discovers by. Named by what they ARE rather than by a hard-coded path, so a
   fleet that is reorganised does not silently audit nothing; a blocklist of
   directory names would put back exactly the positional coupling that failed.
   The one exclusion is the TEMPLATE, by identity — not "wherever this file
   happens to live", which is what silently removed the running tool from its
   own audit. */
const isTool = (dir) =>
  fs.existsSync(path.join(dir, 'manifest.json')) || fs.existsSync(path.join(dir, 'tool.json'));

function findTools(root) {
  const out = [];
  const seen = new Set();
  const consider = (dir) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    if (path.resolve(dir) === TEMPLATE) return;
    if (isTool(dir)) out.push(dir);
  };
  const kidsOf = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name[0] !== '.' && d.name !== 'node_modules')
        .map(d => path.join(dir, d.name));
    } catch (e) {
      /* ENOENT only: a directory that vanished between the readdir that named
         it and the one that descends into it. ENOTDIR is NOT tolerated — it is
         how `--repo-root <a file>` announces itself. */
      if (e.code === 'ENOENT') return [];
      die('cannot list ' + dir + ': ' + e.code,
        'A directory that cannot be read is not a directory with no tools in it.');
    }
  };
  for (const kid of kidsOf(root)) {
    consider(kid);
    for (const g of kidsOf(kid)) consider(g);
  }
  return out;
}

/* A named path is resolved against the cwd, the way every other CLI behaves,
   and then — for a relative argument — against the repository root, so the
   documented `Extension/Full_Screen_Shot` also works from a subdirectory.
   Whatever it resolves to, it is CHECKED. It used to sail through
   path.resolve() unexamined: `Extension/No_Such_Tool` printed `tools 1 found`
   and `UNSTAMPED  No_Such_Tool` at exit 0, byte-identical to the report for the
   real tool, because the real tool is unstamped too. A typo could not be told
   from a finding — in the branch that MIGRATION.md §6 recommended as the
   workaround for the other half of this bug. The message prints the RESOLVED
   paths, because the argument as typed is precisely the part that looked fine. */
function resolveNamed(arg) {
  const cands = [path.resolve(arg)];
  if (REPO_ROOT && !path.isAbsolute(arg)) cands.push(path.resolve(REPO_ROOT, arg));
  for (const abs of cands) {
    let st = null;
    try { st = fs.statSync(abs); }
    catch (e) { if (e.code !== 'ENOENT') die('cannot stat ' + abs + ': ' + e.code); }
    if (st && st.isDirectory() && isTool(abs)) return abs;
  }
  die('"' + arg + '" is not a tool directory. Tried:\n' + cands.map(p => '  ' + p).join('\n'),
    'A tool directory holds a manifest.json or a tool.json; existence alone is not enough,\n' +
    'or any directory at all reports UNSTAMPED. Relative paths resolve against the cwd,\n' +
    'which is ' + process.cwd() + '.');
}

if (!named.length && !REPO_ROOT) {
  die('cannot locate the repository root: no .git above ' + HERE + '.',
    'Automatic discovery walks the repository, so without it there is nothing to walk.\n' +
    'Pass --repo-root <dir>, set TOOLS_REPO_ROOT, or name the tool directories.');
}
const tools = named.length ? named.map(resolveNamed) : findTools(REPO_ROOT);

/* Numeric, never lexical — "1.10.0" sorts BEFORE "1.9.0" as a string, which is
   the exact bug the reference's packaging diff shipped with. */
function cmpVersion(a, b) {
  const A = String(a || '0').split('.').map(Number);
  const B = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

console.log('fleet audit');
console.log('reference   v' + SELF.skeletonVersion + '  ' + TEMPLATE);
console.log('running in  ' + TREE + (TREE === TEMPLATE ? '  (the template itself)' : ''));
console.log('inherited   ' + Object.keys(BASE).length + ' of ' + INHERITED.length +
  ' file(s) compared per tool');
/* A file listed in `inherited` but absent from the template has no baseline, so
   the comparison for it silently passes for every tool forever. That is an
   assertion that cannot fail, which is worse than none — say so on its own line
   rather than letting the count above imply coverage that does not exist. */
for (const rel of noReference) {
  console.log('            NO BASELINE  ' + rel + '  — listed in skeleton.json `inherited`, ' +
    'absent from the template, so no tool can be graded on it');
}
console.log('tools       ' + tools.length + ' found' +
  (named.length ? '  (named on the command line)' : '  under ' + REPO_ROOT) + '\n');

let behind = 0, diverged = 0, unstamped = 0, current = 0;

for (const dir of tools) {
  const name = path.basename(dir);
  const stamp = readJson(path.join(dir, 'skeleton.json'));
  const drift = [];
  const absent = [];
  for (const rel of INHERITED) {
    const there = md5(path.join(dir, rel));
    if (there === null) { absent.push(rel); continue; }
    if (BASE[rel] && there !== BASE[rel]) drift.push(rel);
  }

  let state, detail;
  if (!stamp) {
    state = 'UNSTAMPED'; unstamped++;
    detail = 'no skeleton.json — copied before provenance existed, or copied by hand';
  } else if (cmpVersion(stamp.skeletonVersion, SELF.skeletonVersion) < 0) {
    state = 'BEHIND'; behind++;
    detail = 'v' + stamp.skeletonVersion + ' -> v' + SELF.skeletonVersion +
      (drift.length ? '  (+' + drift.length + ' diverged)' : '');
  } else if (drift.length) {
    state = 'DIVERGED'; diverged++;
    detail = 'v' + stamp.skeletonVersion + '  ' + drift.length + ' inherited file(s) differ';
  } else {
    state = 'CURRENT'; current++;
    detail = 'v' + stamp.skeletonVersion + (stamp.copiedAt ? '  copied ' + stamp.copiedAt : '');
  }

  console.log(state.padEnd(11) + name.padEnd(28) + detail);
  if (showFiles) {
    for (const rel of drift) console.log('             differs   ' + rel);
    for (const rel of absent) console.log('             absent    ' + rel);
  }
}

console.log('\n' + current + ' current · ' + behind + ' behind · ' + diverged +
  ' diverged · ' + unstamped + ' unstamped');
if (behind || unstamped) {
  console.log('\nBEHIND means the template has moved on. Read CHANGELOG-skeleton.md, decide which');
  console.log('changes that tool needs, copy those files across, and bump its skeleton.json.');
  console.log('DIVERGED is not automatically wrong — but it should be a decision you can point at.');
}

/* THE ASSERTION THIS SCRIPT SPENT ITS WHOLE LIFE WITHOUT: that it is still
   scanning what it thinks it is scanning. Every scanner in this family needs
   one, and this is the one that would have caught the move in the commit that
   made it, rather than in an audit six weeks later.

   IT IS NOT `tools.length === 0`, and the difference is the whole point. Which
   zero is legitimate depends on which of the two roles above this copy is in:

   - INSIDE A STAMPED TOOL, that tool is now a tool like any other — the
     exclusion above skips the TEMPLATE, not self — so it MUST appear in its own
     audit. A bare count check is the wrong predicate in both directions here:
     too weak, because a walk rooted one level too low finds three siblings,
     misses the running tool, and reports `3 found`; and redundant, because a
     run that found itself already has a non-zero count. "I did not find myself"
     is strictly the stronger claim, and it is available for free.
   - IN THE TEMPLATE, the template is excluded by design, so there is no self to
     find and the count is all there is. Zero then means the walk missed the
     fleet — which is exactly what `0 current · 0 behind · 0 diverged · 0
     unstamped`, exit 0, looked like for this script's entire life. A fleet with
     genuinely no tools yet has nothing for a fleet audit to say; that state is
     reported here as the failure it is indistinguishable from, and the way to
     audit anything before the first tool is stamped is to name it.

   Neither check applies when directories were NAMED: the caller said what to
   look at, resolveNamed() already refused anything that is not a tool, and an
   explicit list that legitimately matches one tool is a report, not a gate. */
if (!named.length) {
  if (TREE !== TEMPLATE && isTool(TREE) && !tools.some(d => path.resolve(d) === TREE)) {
    broken('the walk never reached ' + TREE + ' — the tool this copy is running inside.',
      'It is a tool by the same test every other entry passed, it sits under the same\n' +
      'repository root, and discovery missed it. Whatever the list above says, it is not\n' +
      'the fleet. Check the depth of the walk against where the tools actually live.');
  }
  if (!tools.length) {
    broken('discovery found no tool directory under ' + REPO_ROOT + ' — nothing was scanned.',
      'A tool directory holds a manifest.json or a tool.json, one or two levels below the\n' +
      'repository root. Zero of them means the walk missed the fleet, not that the fleet is\n' +
      'clean. Name the directories explicitly to audit a fleet that has none of them yet.');
  }
}
/* Exit 0 for every DRIFT verdict, and only for those. This is a REPORT, not a
   gate: a tool that has deliberately changed an inherited file must not fail
   somebody else's build. That rule is about findings, and it never covered a
   run that could not be performed or a walk that reached nothing — conflating
   the two is how "0 found" came to read as good news. See EXIT CODES above
   before restoring "exit 0 always". */
