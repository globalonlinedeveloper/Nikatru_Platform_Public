// check-agent-docs.mjs - the instruction-doc guard for `Nikatru_Platform_Public`.
//
// S1 section 5.1 specifies ten limbs. THIS FILE CARRIES TWO OF THEM, deliberately:
// limb A parts BOM / PATH CHARACTERS / SYMLINK / SIZE CAPS, and limb B, the Codex
// 24 KiB budget. That is exactly S1 section 5.7 row 1, which is the only row
// scheduled for phase 1. Limbs C to J are phases 7 and 9 and are NOT here; a limb
// that exists but checks nothing is worse than a limb that is honestly absent.
//
// EXIT CODES, the corpus convention: 0 green, 1 a finding, 2 COVERAGE LOST.
// COVERAGE LOST is deliberately NOT a pass: it means the guard did not check
// enough to be evidence. The first error line always names the limb that refused.
//
// EVERY LIMB IN THIS FILE IS AN ERROR: a new finding exits 1. S1 section 5.7 lands
// a new limb as a warning (its id in CONFIG.warnLimbs, where a finding prints and
// exits 0) and promotes it to exit 1 only under a measured false-positive rate
// below 1 in 20, by moving its id OUT of CONFIG.warnLimbs — a one-line diff a
// reviewer can see. All five limbs here were promoted together
// (O-PUBLIC-DOCS-HAND-WRITTEN-FACTS); the array is empty and the warn branch below
// stays for the next limb that lands.
//
// PROMOTED ON LANDING: limb X-NO-VERIFY (O-PUBLIC-HOOKS-ADVERTISE-NO-VERIFY),
// 2026-09-24. It was never in CONFIG.warnLimbs and --write-baseline never freezes
// it (PROMOTED_ON_LANDING), because the change that added it also fixed every line
// it names, so its false-positive rate was measured before it could fail anything.
// Measured on the tree it landed on (170eb673 plus train W17's dtap and pf2, plus
// this change; first drafted on 964920a7):
//   before the fix, 3 findings and no other: .githooks/pre-commit:95,
//     .githooks/pre-push:71 and tooling/scripts/spec-guards.mjs:755, each the
//     bypass printed as the way forward. extensions/CONTRIBUTING.md:221 was a 4th
//     once CONTRIBUTING.md joined the subjects, and was reworded in the same change.
//   after the fix: 6 file(s), 7 occurrence(s), 7 prohibition(s), 0 withdrawn,
//     0 quoted, 0 instruction(s), 4 comment line(s) skipped in spec-guards.mjs
//     (:228, :239, :241 and :436, the records of the incidents).
//   The prohibitions are AGENTS.md :47 and :78, START-HERE.md :44 and two lines in
//   each hook. CONFIG.floors.noVerifyFiles is 6, the subject count that day:
//   both hooks, spec-guards.mjs, AGENTS.md, START-HERE.md, extensions/CONTRIBUTING.md.
//   CLAUDE.md and .claude/**/*.md are gitignored here: 0 tracked, matched by
//   pattern, and graded the day one is tracked. This limb never reads the working
//   tree for them.
//
// THE BASELINE. `.agentdocs.baseline.json` at the repo root freezes the findings
// that existed the day this guard landed, so it could land without a flag day.
// Baselined findings print on every run under BASELINE and never fail. The file is
// GENERATED (`node tooling/scripts/check-agent-docs.mjs --write-baseline`) and never typed, because a
// hand-kept list of measurements is the artefact this corpus has watched go stale
// three times.
//
// THE EXEMPTIONS are S1 section 0 and they ship in this first commit rather than as
// a follow-up. Each one prints its hit count on every run, so an exemption list
// cannot quietly grow.
//
// Usage:
//   node tooling/scripts/check-agent-docs.mjs
//   code=$?
//   echo "EXIT"
//   echo "$code"

const CONFIG = {
  "repo": "Nikatru_Platform_Public",
  "selfPath": "tooling/scripts/check-agent-docs.mjs",
  "rootUp": [
    "..",
    ".."
  ],
  "sentinels": [
    "AGENTS.md",
    "tooling",
    "apps"
  ],
  "warnLimbs": [],
  "floors": {
    "trackedFiles": 1000,
    "docsScanned": 1,
    "bomScanned": 800,
    "budgetChecked": 200,
    "noVerifyFiles": 6
  }
};

/* The exemption list is code rather than data because each row carries a reason
   that has to be read next to the test it justifies. S1 section 0. */
CONFIG.exemptions = [
  {
    id: "apple-asset-catalogue",
    why: "Apple's asset catalogue requires the @2x / @3x form in the filename. Renaming one breaks the iOS build.",
    test: (p) => /^apps\/[^/]+\/ios\/.*@[0-9]+x\.png$/.test(p),
  },
  {
    id: "mason-brick-templates",
    why: "Mason template syntax IS the filename under tooling/bricks/. The braces and the hash are how the generator substitutes, not decoration.",
    test: (p) => p.startsWith('tooling/bricks/') && /[{}#]/.test(p),
  },
];
/* ------------------------------------------------------------------ BODY */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The root is found by walking up a fixed number of levels and then PROVING it
   with sentinel files, the same arithmetic and the same proof the assert-*
   guards beside this one use. A moved script lands on a different tree, and a
   different tree is not a wronger-looking one. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ...CONFIG.rootUp);
for (const sentinel of CONFIG.sentinels) {
  if (!existsSync(join(ROOT, sentinel))) {
    console.error('x COVERAGE LOST - ' + ROOT + ' does not look like ' + CONFIG.repo + ' (missing ' + sentinel + ').');
    process.exit(2);
  }
}

const WRITE_BASELINE = process.argv.includes('--write-baseline');
/* --index says "judge the STAGED content on purpose", which is what a pre-commit
   hook means. Every other caller is asking about the tree in front of them. */
const INDEX_MODE = process.argv.includes('--index');
const BASELINE_PATH = join(ROOT, '.agentdocs.baseline.json');

/* ---------------------------------------------------------------- git I/O */

/* core.quotepath=false is not optional. Without it git wraps any path holding a
   byte outside the plain set in double quotes and C-escapes it, so the exact
   limb that hunts for those bytes would be reading git's quoting rather than
   the filename. Measured 2026-09-08: 28 of Private's paths came back quoted,
   and one of them grouped under a leading double quote as if it were a
   directory. */
function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', '-C', ROOT, ...args],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error('x COVERAGE LOST - git ' + args.join(' ') + ' failed: ' + String(r.stderr || '').trim());
    process.exit(2);
  }
  return r.stdout;
}

/* The INDEX, never the working directory. A concurrent writer's untracked file
   must not redden another writer's commit; Private proved that class on
   2026-09-07, when three agents skipped the hook in one afternoon over it. */
const indexRows = String(git(['ls-files', '--cached', '-s']))
  .split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const meta = line.slice(0, tab).split(/\s+/);
    return { mode: meta[0], sha: meta[1], path: line.slice(tab + 1) };
  });

const trackedFiles = indexRows.length;
const byPath = new Map(indexRows.map((r) => [r.path, r]));

/* One cat-file --batch for the whole doc set beats one spawn per file by an
   order of magnitude, and it reads the blob the INDEX holds rather than
   whatever is on disk right now. */
function readBlobs(rows) {
  if (rows.length === 0) return new Map();
  const out = new Map();
  const r = spawnSync('git', ['-C', ROOT, 'cat-file', '--batch'],
    { input: Buffer.from(rows.map((x) => x.sha).join('\n') + '\n', 'utf8'), encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error('x COVERAGE LOST - git cat-file --batch failed.');
    process.exit(2);
  }
  const buf = r.stdout;
  let at = 0;
  for (const row of rows) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) { console.error('x COVERAGE LOST - the cat-file stream ended early.'); process.exit(2); }
    const header = buf.slice(at, nl).toString('utf8').split(' ');
    const size = Number(header[2]);
    if (!Number.isFinite(size)) { console.error('x COVERAGE LOST - unparsable cat-file header: ' + header.join(' ')); process.exit(2); }
    out.set(row.path, buf.slice(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return out;
}

/* ------------------------------------------------------------- exemptions */

const exemptionHits = new Map(CONFIG.exemptions.map((e) => [e.id, 0]));
function exemptionFor(path) {
  for (const e of CONFIG.exemptions) {
    if (e.test(path)) { exemptionHits.set(e.id, exemptionHits.get(e.id) + 1); return e; }
  }
  return null;
}

/* --------------------------------------------------------------- findings */

const findings = [];
const record = (limb, path, message) => findings.push({ limb, path, message });

/* --- limb A, part BOM --------------------------------------------------- */
const TEXTY = /\.(md|json|jsonl|mjs|js|ts|yml|yaml)$/;
const textyRows = indexRows.filter((r) => TEXTY.test(r.path) && r.mode !== '120000');
const textyBlobs = readBlobs(textyRows);
let bomScanned = 0;
for (const row of textyRows) {
  const b = textyBlobs.get(row.path);
  if (!b) continue;
  bomScanned += 1;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    record('A-BOM', row.path, 'starts with a UTF-8 BOM (EF BB BF). JSON.parse throws on it and PowerShell Out-File -Encoding utf8 writes it. Write the file from node.');
  }
}

/* --- limb A, part PATH CHARACTERS --------------------------------------- */
const PLAIN = /^[A-Za-z0-9._/-]+$/;
let pathsExempt = 0;
for (const row of indexRows) {
  if (PLAIN.test(row.path)) continue;
  if (exemptionFor(row.path)) { pathsExempt += 1; continue; }
  record('A-PATH', row.path, 'holds a character outside [A-Za-z0-9._/-].');
}

/* --- limb A, part SYMLINK ----------------------------------------------- */
for (const row of indexRows) {
  if (row.mode === '120000') {
    record('A-LINK', row.path, 'is a symlink in the git index. Windows needs Admin or Developer Mode to check one out, so it is a file that exists on one machine and not on another.');
  }
}

/* --- limb A, part SIZE CAPS --------------------------------------------- */
/* Caps are S1 section 1. A per-directory CLAUDE.md is capped at one line ONLY
   once its sibling AGENTS.md exists; until then it IS the directory card and is
   read as one.

   🔴 THE ROOT CAP WAS CUT 12288 -> 8192 BYTES AND 200 -> 160 LINES ON 2026-09-08,
   and it is a cut rather than a re-base: the file was 13,646 bytes that morning,
   OVER the old cap, and is 8,166 after. The measurement behind it is the cold
   start. A session opening in this repo was told to read `Private/platform-state/`
   whole and `Private/TRAPS.md` before running anything: 434,324 bytes, about
   108,581 tokens at bytes/4, measured with `stat -c%s` on 2026-09-08. Two thirds
   of that was two copies of the same 190 traps. The repair is a small GENERATED
   card plus queries, and a cap on the hand-written file is what stops the card
   being ignored and the file regrowing — the corpus has watched exactly that
   happen to `NOW.md`, to `resume-session/SKILL.md` and to this file.

   START-HERE.md IS GENERATED by tooling/scripts/gen-start-here.mjs, and this cap
   is the second of its two guards. The generator's own `--check` fails on a hand
   edit; this cap fails on a card that grew legitimately, through the generator,
   past what a cold read is worth. Both are needed: `--check` cannot tell a bigger
   tree from a wordier template. */
function capFor(path) {
  const leaf = path.slice(path.lastIndexOf('/') + 1);
  const isRoot = !path.includes('/');
  if (path === 'START-HERE.md') return { lines: 90, bytes: 4 * 1024 };
  if (leaf === 'AGENTS.md') return isRoot ? { lines: 160, bytes: 8 * 1024 } : { lines: 100 };
  if (leaf === 'CLAUDE.md') {
    if (isRoot) return { lines: 3 };
    return byPath.has(path.replace(/CLAUDE\.md$/, 'AGENTS.md')) ? { lines: 1 } : { lines: 100 };
  }
  if (leaf === 'SKILL.md') return { lines: 300 };
  if (path === 'docs/PICTURE.md') return { lines: 350, warnLines: 240 };
  if (/^\.claude\/rules\/[^/]+\.md$/.test(path)) return { lines: 300 };
  return null;
}
const docRows = indexRows.filter((r) => capFor(r.path));
const docBlobs = readBlobs(docRows);
const docsScanned = docRows.length;
for (const row of docRows) {
  const cap = capFor(row.path);
  const text = String(docBlobs.get(row.path) || '');
  const lines = text.split('\n').length;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (lines > cap.lines) record('A-SIZE', row.path, 'is ' + lines + ' lines, cap ' + cap.lines + '.');
  else if (cap.warnLines && lines > cap.warnLines) record('A-SIZE', row.path, 'is ' + lines + ' lines, warn at ' + cap.warnLines + ', cap ' + cap.lines + '.');
  if (cap.bytes && bytes > cap.bytes) record('A-SIZE', row.path, 'is ' + bytes + ' bytes, cap ' + cap.bytes + '.');
}

/* --- limb B, CODEX BUDGET ----------------------------------------------- */
/* openai/codex #13386, open since 2026-03-03: Codex truncates the concatenated
   AGENTS.md chain at 32 KiB and says nothing. 24 KiB is the headroom S1 sets. */
const CODEX_BUDGET = 24 * 1024;
const agentsRows = indexRows.filter((r) => r.path.endsWith('AGENTS.md'));
const agentsBlobs = readBlobs(agentsRows);
const agentsBytes = new Map(agentsRows.map((r) => [r.path, Buffer.byteLength(String(agentsBlobs.get(r.path) || ''), 'utf8')]));
const leafDirs = new Set(indexRows.map((r) => (r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '')));
let worstPath = '';
let worstBytes = 0;
let budgetChecked = 0;
for (const dir of leafDirs) {
  const parts = dir === '' ? [] : dir.split('/');
  let sum = agentsBytes.get('AGENTS.md') || 0;
  for (let i = 1; i <= parts.length; i += 1) {
    sum += agentsBytes.get(parts.slice(0, i).join('/') + '/AGENTS.md') || 0;
  }
  budgetChecked += 1;
  if (sum > worstBytes) { worstBytes = sum; worstPath = dir === '' ? '<repo root>' : dir + '/'; }
  if (sum > CODEX_BUDGET) {
    record('B-CODEX', dir === '' ? '<repo root>' : dir + '/', 'the AGENTS.md chain sums to ' + sum + ' bytes, budget ' + CODEX_BUDGET + '.');
  }
}

/* --- limb X, NO-VERIFY (promoted on landing) ---------------------------- */
/* O-PUBLIC-HOOKS-ADVERTISE-NO-VERIFY. Until 2026-09-24 both hooks answered a red
   runner by printing the bypass itself, `git commit --no-verify`, as an override,
   and spec-guards.mjs ended its exit-1 message with "or commit with --no-verify".
   AGENTS.md prohibits that flag twice; the hooks printed it as the way forward, at
   the moment a writer is most tempted. This limb grades every place a writer is
   told what to do about a red hook, and a printed or written flag passes only
   inside a prohibition.

   THE SUBJECTS are matched by pattern against the INDEX, like every limb here:
     .githooks/*                       every line, comments included
     tooling/scripts/spec-guards.mjs   CODE lines only (see codeLines below)
     AGENTS.md, CLAUDE.md, CONTRIBUTING.md at any depth, START-HERE.md, and
     .claude/**\/*.md                  one unit per paragraph or list item, its
                                       continuation lines joined (markdownUnits)
   CLAUDE.md and .claude/ are gitignored in this repo (.gitignore `CLAUDE.md` and
   `.claude/`), so 0 of them are tracked and this limb grades none. They are matched
   so the day one is tracked it is graded; the working tree is never read for them.

   A FLAG OCCURRENCE is judged by Private's rule, ported (see judgeUnit): its CLAUSE runs
   from the last CLAUSE_BREAKS mark before it (or the unit's start) up to the flag.
     prohibition  the clause holds NEGATED (never / not / no / nor / without / n't)
     withdrawn    a dated "⏱ <date>, APPENDED — ...WITHDRAWN" after it in the same unit,
                  or the unit opens with the generator's "⏱ <date> AMENDED: ...WITHDRAWN"
     quoted       the text before it ends with a NO_VERIFY_QUOTED `before` phrase
     instruction  anything else: a finding, exit 1
   NO_VERIFY_QUOTED is empty. An entry goes in only for text that QUOTES the flag
   without instructing it, with its file and line in a comment beside it.

   SPEC-GUARDS.MJS IS READ FOR ITS CODE, because its comments at the four
   `--no-verify` lines there RECORD the incidents that made the flag a prohibition
   (the worktree commits of 2026-09-07 and the retired guards of 2026-08-15). A
   record of a bypass is not an instruction to take one. What it PRINTS is judged,
   and that is where the exit-1 message lived. */
const NO_VERIFY_SUBJECTS = [
  { units: 'lines', test: (p) => /(^|\/)\.githooks\/[^/]+$/.test(p) },
  { units: 'code-lines', test: (p) => p === 'tooling/scripts/spec-guards.mjs' },
  { units: 'markdown', test: (p) => /(^|\/)(AGENTS|CLAUDE|CONTRIBUTING)\.md$/.test(p) || p === 'START-HERE.md' },
  { units: 'markdown', test: (p) => /^\.claude\/.+\.md$/.test(p) },
];
/* A limb that finds no hook has graded nothing. Each of these must be a SUBJECT
   (in the index AND matched above), or the run is COVERAGE LOST. */
const NO_VERIFY_MUST_EXIST = ['.githooks/pre-commit', '.githooks/pre-push', 'tooling/scripts/spec-guards.mjs', 'AGENTS.md'];
const NO_VERIFY_QUOTED = [];
const PROMOTED_ON_LANDING = ['X-NO-VERIFY'];
const FLAG = '--no-verify';
const NEGATED = /\b(?:never|not|no|nor|without)\b|n't\b/i;
const CLAUSE_BREAKS = ['. ', '; ', ': ', ' — ', ' – ', '(', '!', '?'];
const APPENDED_WITHDRAWAL = /⏱ ?\d{4}-\d{2}-\d{2},? APPENDED[^⏱]*?--no-verify[^⏱]*?\bWITHDRAWN\b/g;
const AMENDED_LEAD = /^⏱ ?\d{4}-\d{2}-\d{2} AMENDED:[^⏱]*?--no-verify[^⏱]*?\bWITHDRAWN\b/;

/* One unit per line, with the line number it came from. */
function lineUnits(text) {
  return text.split('\n').map((t, i) => ({ text: t, starts: [0], nos: [i + 1] }));
}

/* The code lines of a JS file: a line inside a block comment, or one opening with
   `//` or `/*`, is skipped, and code after a `*\/` on the same line is kept. Only a
   comment that opens a line is recognised, so a mid-line `/*` never hides the code
   around it: the error this can make is to judge a comment, which is loud, never to
   skip code, which would be silent. */
function codeLines(text) {
  const units = [];
  let skipped = 0;
  let inBlock = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    let rest = lines[i];
    let comment = '';
    if (!inBlock && rest.trim().startsWith('/*')) inBlock = true;
    if (inBlock) {
      const end = rest.indexOf('*/');
      if (end === -1) { comment = rest; rest = ''; }
      else { comment = rest.slice(0, end + 2); rest = rest.slice(end + 2); inBlock = false; }
    }
    if (rest.trim().startsWith('//')) { comment += rest; rest = ''; }
    if (/--no-verify\b/.test(comment)) skipped += 1;
    if (rest.trim() !== '') units.push({ text: rest, starts: [0], nos: [i + 1] });
  }
  return { units, skipped };
}

/* Markdown, one unit per paragraph or list item, so a sentence wrapped over two
   lines is judged whole: AGENTS.md puts "Never" at the end of one line and the flag
   at the start of the next. A heading, a table row and each line of a fenced block
   stand alone, because each is read alone. */
function markdownUnits(text) {
  const units = [];
  let cur = null;
  text.split('\n').forEach((line, i) => {
    const starts = line.trim() === '' || /^\s*(?:[-*+] |\d+\. |#|\||```)/.test(line);
    if (line.trim() === '') { cur = null; return; }
    if (starts || !cur) { cur = { at: i + 1, text: line.trim() }; units.push(cur); return; }
    cur.text += ' ' + line.trim();
  });
  return units;
}

/* Every flag in one unit, judged and counted; an instruction is recorded at `path:where`.
   FLAG, NEGATED, CLAUSE_BREAKS, APPENDED_WITHDRAWAL, AMENDED_LEAD, markdownUnits and this
   judge are PORTED from Private's limb (requirements/tooling/check-agent-docs.mjs, 2026-09-26,
   train W17 HOOKS-4); only the counters (nv) and the record text are this file's. */
function judgeUnit(path, where, unit) {
  let from = unit.indexOf(FLAG);
  if (from < 0) return;
  const leadWithdraws = AMENDED_LEAD.test(unit);
  /* the END of the last withdrawal: the flag the withdrawal itself names is part of it */
  const withdrawnUpTo = [...unit.matchAll(APPENDED_WITHDRAWAL)].reduce((m, x) => Math.max(m, x.index + x[0].length), -1);
  while (from >= 0) {
    nv.occurrences += 1;
    const before = unit.slice(0, from);
    const cut = Math.max(...CLAUSE_BREAKS.map((b) => before.lastIndexOf(b) + (before.lastIndexOf(b) < 0 ? 0 : b.length)));
    const clause = before.slice(Math.max(0, cut));
    const quoted = NO_VERIFY_QUOTED.find((q) => before.endsWith(q.before));
    if (NEGATED.test(clause)) nv.prohibition += 1;
    else if (leadWithdraws || from < withdrawnUpTo) nv.withdrawn += 1;
    else if (quoted) nv.quoted += 1;
    else {
      nv.instruction += 1;
      /* the finding quotes the clause it judged: from the break before the flag to the next one after it */
      const ends = CLAUSE_BREAKS.map((b) => unit.indexOf(b, from + FLAG.length)).filter((i) => i >= 0);
      const said = unit.slice(Math.max(0, cut), ends.length ? Math.min(...ends) : unit.length).trim();
      record('X-NO-VERIFY', path + ':' + where, 'offers --no-verify as a way forward: "' + said.slice(0, 160) + '". Name the fix instead (read the first FAIL line, fix what it names); the flag may appear here only in a clause that prohibits it.');
    }
    from = unit.indexOf(FLAG, from + FLAG.length);
  }
}

const noVerifyRows = indexRows.filter((r) => r.mode !== '120000' && NO_VERIFY_SUBJECTS.some((s) => s.test(r.path)));
const noVerifyBlobs = readBlobs(noVerifyRows);
const noVerifyFiles = noVerifyRows.length;
const noVerifyMissing = NO_VERIFY_MUST_EXIST.filter((p) => !noVerifyRows.some((r) => r.path === p));
const nv = { occurrences: 0, prohibition: 0, withdrawn: 0, quoted: 0, instruction: 0, skipped: 0 };
for (const row of noVerifyRows) {
  const kind = NO_VERIFY_SUBJECTS.find((s) => s.test(row.path)).units;
  const text = String(noVerifyBlobs.get(row.path) || '');
  let units;
  if (kind === 'markdown') units = markdownUnits(text);
  else if (kind === 'code-lines') { const c = codeLines(text); units = c.units; nv.skipped += c.skipped; }
  else units = lineUnits(text);
  for (const u of units) judgeUnit(row.path, u.at ?? u.nos[0], u.text);
}

/* ----------------------------------------------------------- honesty gate */
/* THE SUBJECT OF THIS GUARD IS THE INDEX, AND THAT IS RIGHT FOR A HOOK AND WRONG
   FOR A SWEEP. Measured 2026-09-08 in the private corpus, whose copy of this file is
   the same file: an edit pushing AGENTS.md 13 bytes past its cap exited 0 while
   UNSTAGED and 1 the moment it was staged. A green printed before `git add` was not a
   statement about the tree the operator was looking at, and nothing in the output said
   so. In CI the checkout is clean by construction, so this gate is silent there; it
   earns its place on the ad-hoc runs, which is where this guard is mostly used.

   THE SUBJECT IS NOT CHANGED. What changes is that a run whose answer cannot be about
   the working tree now REFUSES instead of printing ok. Nothing below can turn a red
   into a green: every branch here only ever exits 2.

   🔴 `git status --porcelain`, NOT `git diff-files`. Measured 2026-09-08: a bare
   `touch` of AGENTS.md, changing not one byte, makes `git diff-files --name-status`
   print `M` out of git's stale stat cache, while `git status --porcelain` prints
   nothing -- `status` refreshes that cache and `diff-files` does not. A gate built on
   `diff-files` would cry COVERAGE LOST over a timestamp, and a guard that false-alarms
   is a guard that gets ignored: this same failure, reached by a longer road.

   TRACKED PATHS ONLY (--untracked-files=no). An untracked file stays invisible, so a
   concurrent writer's new file still cannot redden anyone else -- the 2026-09-07
   property this guard was built around is preserved exactly, not weakened.

   It sits ABOVE --write-baseline on purpose. A baseline frozen off an unstaged tree is
   a stale measurement that then gets COMMITTED and outlives the session that took it,
   which is worse than a stale run. */
if (!INDEX_MODE) {
  const contentSubjects = new Set([
    ...textyRows.map((r) => r.path),
    ...docRows.map((r) => r.path),
    ...agentsRows.map((r) => r.path),
    ...noVerifyRows.map((r) => r.path),
  ]);
  const REC_SEP = String.fromCharCode(0);
  const parts = String(git(['status', '--porcelain', '--untracked-files=no', '-z'])).split(REC_SEP);
  const diverged = [];
  for (let i = 0; i < parts.length; i += 1) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const X = rec[0];
    const Y = rec[1];
    const path = rec.slice(3);
    /* a rename or a copy carries its ORIGINAL path as its own NUL record */
    if (X === 'R' || X === 'C') i += 1;
    if (Y === ' ') continue;
    /* A path whose BYTES this run read: the answer about it is stale outright.
       D / T / U: a delete, a typechange or an unmerged path moves the tracked-path
       and mode picture that limbs A-PATH, A-LINK and capFor judge, so it counts even
       when its bytes were never read. */
    if (Y === 'D' || Y === 'T' || Y === 'U' || contentSubjects.has(path)) diverged.push(Y + '  ' + path);
  }
  if (diverged.length > 0) {
    console.error('x COVERAGE LOST - the working tree differs from the index for ' + diverged.length + ' file(s) this guard judges.');
    for (const d of diverged) console.error('    ' + d);
    console.error('  This guard reads the INDEX (git ls-files --cached -s + git cat-file --batch), so its verdict');
    console.error('  is about what a commit would contain, not about what is on disk. Stage these files and');
    console.error('  re-run, or pass --index if you meant to judge the staged content (a pre-commit hook does).');
    console.error('  2 is deliberately NOT a pass: an answer about the wrong snapshot is not evidence.');
    process.exit(2);
  }
}

/* --------------------------------------------------------------- baseline */

/* 🔴 THIS SEPARATOR WAS A LITERAL NUL BYTE IN THIS FILE UNTIL 2026-09-09, AND IT MADE
   THIS GUARD'S OWN SOURCE INVISIBLE TO A SWEEP FOR GUARDS. One NUL at byte 12611 was
   enough for `file` to call the whole thing `data` and for `grep -I` -- which skips
   binary files, and is what a sweep uses so it does not drown in build output -- to
   pass over it in silence. Measured here on the day, control first:
     grep -a  -c 'process.exit' <this file>          -> 11
     grep -I  -c 'process.exit' <this file>          ->  0   (exit 1)
     grep -Irl 'process.exit' tooling/scripts/*.mjs  -> does NOT list this file
   A guard nothing can find is one nobody audits, which is the same shape as the
   defect this whole file exists to catch: a check that quietly stops being checked.
   `String.fromCharCode(0)` is the same value with none of the invisibility. The
   sibling copy in the private corpus carried the identical byte and was cleaned the
   same way; the business-brain copy too. */
const KEY_SEP = String.fromCharCode(0);
const key = (f) => f.limb + KEY_SEP + f.path;
let baseline = { entries: [] };
// READ ONCE (CodeQL #271): --write-baseline below rewrites this file, and whether to parse it is
// no longer a separate existence check. ENOENT is the only "absent"; any other failure to read
// is the COVERAGE LOST it already was inside the old try.
let baselineRaw = null;
try { baselineRaw = readFileSync(BASELINE_PATH, 'utf8'); }
catch (err) {
  if (err.code !== 'ENOENT') {
    console.error('x COVERAGE LOST - .agentdocs.baseline.json does not parse: ' + err.message);
    process.exit(2);
  }
}
if (baselineRaw !== null) {
  try { baseline = JSON.parse(baselineRaw); }
  catch (err) {
    console.error('x COVERAGE LOST - .agentdocs.baseline.json does not parse: ' + err.message);
    process.exit(2);
  }
}
/* A limb in PROMOTED_ON_LANDING is never frozen: it landed as exit 1 because the
   text it grades was fixed in the same change, so a baseline entry for it could
   only ever be a finding somebody chose to keep. --write-baseline leaves its
   findings out and says how many; an entry for it found in the file is IGNORED
   and printed, and the finding it names still fails. */
if (WRITE_BASELINE) {
  const freezable = findings.filter((f) => !PROMOTED_ON_LANDING.includes(f.limb));
  const out = {
    _what: 'Findings frozen on the day check-agent-docs.mjs landed. Each is printed on every run and none of them fails the guard. A finding that is NOT in here does fail, once its limb is promoted.',
    _generatedFrom: 'node ' + CONFIG.selfPath + ' --write-baseline. Never typed by hand.',
    _rule: 'This file may not GROW except in a commit whose message says why it grew. Shrinking it needs no ceremony: a cleared finding is the point of the exercise.',
    generatedAt: new Date().toISOString().slice(0, 10),
    repo: CONFIG.repo,
    count: freezable.length,
    entries: freezable
      .map((f) => ({ limb: f.limb, path: f.path, message: f.message }))
      .sort((a, b) => (a.limb + a.path).localeCompare(b.limb + b.path)),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('wrote ' + BASELINE_PATH + ' with ' + out.entries.length + ' frozen finding(s)');
  const unfrozen = findings.length - freezable.length;
  if (unfrozen > 0) console.log('  NOT FROZEN ' + unfrozen + ' finding(s) on ' + PROMOTED_ON_LANDING.join(', ') + ', promoted on landing and never baselined. Fix the text; the next run fails on it.');
  process.exit(0);
}
const baselineEntries = (baseline.entries || []).filter((b) => !PROMOTED_ON_LANDING.includes(b.limb));
const ignoredEntries = (baseline.entries || []).filter((b) => PROMOTED_ON_LANDING.includes(b.limb));
const frozen = new Set(baselineEntries.map(key));
const fresh = findings.filter((f) => !frozen.has(key(f)));
const stillFrozen = findings.filter((f) => frozen.has(key(f)));
const cleared = baselineEntries.filter((b) => !findings.some((f) => key(f) === key(b)));

/* -------------------------------------------------------- coverage floors */
/* A guard that reports PASS over an absent subject is the defect this corpus
   exists around. Each floor forces exit 2, which is deliberately NOT a pass. */
const floorFailures = [];
for (const [name, min] of Object.entries(CONFIG.floors)) {
  const got = { trackedFiles, docsScanned, bomScanned, budgetChecked, noVerifyFiles }[name];
  if (got === undefined) { floorFailures.push('floor ' + name + ' names nothing this guard measures'); continue; }
  if (got < min) floorFailures.push(name + ' ' + got + ' < ' + min);
}
for (const p of noVerifyMissing) floorFailures.push('X-NO-VERIFY ' + p + ' is not a subject (absent from the index, or no longer matched by NO_VERIFY_SUBJECTS), so the limb graded nothing there');

/* ----------------------------------------------------------------- report */

console.log('check-agent-docs - ' + CONFIG.repo);
console.log('  scanned: ' + trackedFiles + ' tracked file(s), ' + docsScanned + ' instruction doc(s), ' + bomScanned + ' text blob(s), ' + budgetChecked + ' directory chain(s)');
console.log('  codex budget: worst chain ' + worstBytes + ' bytes at ' + worstPath + ', budget ' + CODEX_BUDGET);
for (const e of CONFIG.exemptions) {
  console.log('  exemption ' + e.id + ': ' + exemptionHits.get(e.id) + ' path(s) - ' + e.why);
}
console.log('  path exemptions applied: ' + pathsExempt);
console.log('  x-no-verify: ' + noVerifyFiles + ' file(s), ' + nv.occurrences + ' occurrence(s): ' + nv.prohibition + ' prohibition(s), ' + nv.withdrawn + ' withdrawn, ' + nv.quoted + ' quoted, ' + nv.instruction + ' instruction(s); ' + nv.skipped + ' comment line(s) skipped in tooling/scripts/spec-guards.mjs');

if (floorFailures.length > 0) {
  console.error('x COVERAGE LOST - ' + floorFailures[0]);
  for (const f of floorFailures.slice(1)) console.error('  also: ' + f);
  console.error('  A floor is a declared minimum. Under it this run is not evidence, and it must not read as a pass.');
  process.exit(2);
}

for (const f of stillFrozen) console.log('  BASELINE ' + f.limb + ' ' + f.path + ' - ' + f.message);
for (const b of cleared) console.log('  CLEARED  ' + b.limb + ' ' + b.path + ' - fixed since the baseline was written. Re-run with --write-baseline to shrink the baseline.');
for (const b of ignoredEntries) console.log('  IGNORED  ' + b.limb + ' ' + b.path + ' - a baseline entry on a limb promoted on landing freezes nothing. Delete it from .agentdocs.baseline.json.');

if (fresh.length === 0) {
  console.log('ok  no new finding. ' + stillFrozen.length + ' baselined, ' + cleared.length + ' cleared.');
  process.exit(0);
}
/* Each finding is labelled by its OWN limb, so a run mixing a warning limb and a
   promoted one prints WARN beside the first and FAIL beside the second. */
const failing = fresh.filter((f) => !CONFIG.warnLimbs.includes(f.limb));
console.log('');
for (const f of fresh) console.log('  ' + (CONFIG.warnLimbs.includes(f.limb) ? 'WARN' : 'FAIL') + ' ' + f.limb + ' ' + f.path + ' - ' + f.message);
console.log('');
if (failing.length === 0) {
  console.log('!  ' + fresh.length + ' new finding(s), every one of them on a limb that is still a WARNING, so this run exits 0 by design. S1 section 5.7 lands a new limb as a warning and promotes it only under a measured false-positive rate below 1 in 20, by moving its id out of CONFIG.warnLimbs.');
  process.exit(0);
}
console.error('x ' + failing.length + ' new finding(s) on a promoted limb.');
process.exit(1);
