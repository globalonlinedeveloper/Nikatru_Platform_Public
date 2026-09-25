// ─────────────────────────────────────────────────────────────────────────────
// guard-declaration.mjs — the private corpus's DECLARED guard set, read for the
// pre-commit runner out of a git blob and never out of a working tree.
//
// Row: O-GUARD-SET-DECLARED-NOWHERE (this is its Public half). Prepares
// O-HELD-REASONS-RUNS-IN-NO-HOOK and O-COMPOSE-HEALTHCHECK-GUARD-IN-NO-HOOK.
//
// 🔴 WHY THIS EXISTS. Until this file, the fifteen corpus guards the hook runs were
// rows in `spec-guards.mjs`'s GUARDS table, typed by hand in THIS repository, while
// the corpus kept its own sweep list of the same guards in ITS repository. A guard
// added on one side was in no hook until somebody remembered the other side — the
// `assert-platform-state` failure recorded below, repeated for the held-reasons and
// compose-healthcheck guards. The corpus now declares its guard set in ONE file,
// `Private/requirements/tooling/guards.json`, which its `assert-guard-set` checks,
// and this module is how the hook reads it.
//
// WHAT IS READ, AND FROM WHERE:
//   · a commit OUTSIDE the corpus (the public side) reads
//     `HEAD:requirements/tooling/guards.json` of the corpus — the declaration as the
//     corpus last committed it. A half-edited declaration in the corpus's working
//     tree is not what a Public commit is judged against.
//   · a commit IN the corpus (the private side) reads `:requirements/tooling/guards.json`,
//     the STAGED blob — the declaration that very commit is about to record.
//   Every read goes through `repo-git.mjs`. Git exports `GIT_DIR` into every hook
//   process and it beats `git -C`, so a bare spawn from a Public hook would answer
//   with the Public repository's blob, or with none at all.
//
// SELECTION. An entry runs on a side iff its `hook` array names that side (`"public"`
// or `"private"`), with its `args` passed verbatim. `fast`, `sweep`, `sweepArgs` and
// `ci` are the corpus sweep's fields and are not read here.
//
// PINNED_HOOK. Sixteen names must be declared for BOTH sides. The declaration is data
// in another repository, so deleting a row there is an edit no review in this one
// sees; the pin is this side's floor under that edit. A pinned name that is absent,
// or declared for one side only, is a refusal.
//
// REFUSALS. This module has no main and exits nothing. It THROWS a
// `GuardDeclarationError`, and the runner prints it as COVERAGE LOST, exit 2:
//   blob    the blob could not be read — not committed, not staged, git absent, or
//           the corpus root is not its own repository;
//   parse   the blob is not JSON, or is not an object with an array under `entries`
//           (a bare array and any other key included);
//   entry   an entry without `id`, `file` or `hook`, whose `hook` or `args` is not a
//           list of strings, or whose `hook` names a value other than "public" or
//           "private";
//   pinned  a PINNED_HOOK name absent, or not declared for both sides.
// A runner that cannot read its guard list has checked nothing.
//
// Tests: tooling/ci/test/guard-declaration.test.mjs (the loader, over two throwaway
// repositories), tooling/ci/test/spec-guards.test.mjs (the pins) and
// tooling/ci/test/spec-guards-worktree.test.mjs (the runner, end to end).
//
// ── THE COMMENT BLOCKS OF THE FIFTEEN ROWS THAT MOVED ────────────────────────
// Moved VERBATIM from the GUARDS table of `7f5d0bfd:tooling/scripts/spec-guards.mjs`,
// in the order they stood, one section per guard name. The rows themselves are now
// entries in the declaration. Three blocks stood above rows retired on 2026-09-08
// (assert-research-archive, assert-plans-archive, assert-session-index) and are kept
// with their neighbours, so the table's history stays in one place. Every date and
// measurement inside them is as written on its day, and "above" / "below" / "this
// array" / "this hook" mean the old table and the hook that ran it.
// ─────────────────────────────────────────────────────────────────────────────

// ── check-dod-sync ── (no block of its own; `spec-guards.mjs` says above its GUARDS
// table why it is the control for the 2026-08-15 deletion)

// ── assert-spec ── (the comment that stood at the end of its `rel` line)
// fallback chain — `locate` takes the FIRST that exists, so only one candidate need resolve. 🔴 2026-08-18: the LEADING entry is now corpus-RELATIVE, which is what survives the move — `locate` joins it onto PRIVATE_ROOT, so it resolves to `Private/requirements/…` before the move and `..._Private/requirements/…` after it, with no second edit on the day. The `Private/…` spelling is demoted to a fallback rather than deleted because it is still how the path resolves from the OTHER candidate roots. The `spec/` entry names the pre-flatten layout (retired 2026-08-16, when spec/ dissolved into requirements/) and is kept on purpose. Same shape as the four entries below it.

// ── assert-index-complete ──
  /* ADDED 2026-08-15 with the flatten. `Private/README.md` is the index the
     flatten exists to deliver, and an index is a hand-kept second copy of the
     tree — the exact artefact this repository has twice watched go stale in
     silence. The README it replaced still read as authoritative while pointing
     at `../knowledge/decisions/`, a directory that had not existed for days.
     Prose cannot announce its own staleness, so the index is asserted instead. */
// (the comment that stood at the end of its `rel` line)
// same fallback chain, corpus-relative leading entry added 2026-08-18 (retired 2026-08-16 layout in the third slot) — see the assert-spec entry above

// ── assert-research-archive ── (row retired 2026-09-08; this block stood below assert-index-complete)
  /* ADDED 2026-08-16 with the streamline. `assert-index-complete` deliberately
     does NOT enumerate `research/` — 51 filenames in the corpus index would bury
     the sixteen runbooks that index exists to surface — and the cost of that
     judgement was measured on the day: `research/README.md` named 8 of its 51
     files, and carried a link to `../../company/MASTER_PLAN.md` for a day after
     that path stopped existing. So the directory gets its own register and its
     own guard, at its own depth. Same doctrine, one level down. */

// ── assert-plans-archive ── (row retired 2026-09-08)
  /* ADDED 2026-08-31 with the plans/ streamline. The SECOND directory to get its
     own register at its own depth, and the reasoning is `assert-research-archive`'s
     verbatim: `assert-index-complete` guards the `### dir/ — N files` heading for
     `plans/` and nothing below it, so a reader could not tell a LIVE stage plan
     from a 2026-08-08 executed draft without opening the file. 46 files, six
     directories, four kinds, zero markers.
     🔴 THAT COST WAS ALREADY PAID TWICE IN THIS DIRECTORY, IN WRITING:
     `plans/rework-patches/README.md` listed four of twelve patches as OUTSTANDING
     when all twelve had merged, and `plans/adr040-artifacts/README.md` described
     three patches as PENDING when all three had merged and none was on disk. Both
     read as current the whole time.
     ⚠️ THE REGISTER WAS EXPLICITLY REJECTED ON 2026-08-16 — "no guard would read
     it" — and that objection was RIGHT. This entry is the condition it named; the
     rejection is quoted in `plans/index.json` rather than quietly reversed.
     ⚠️ One deliberate difference from the research guard it copies: `plans/` is NOT
     flat, so its readdir is RECURSIVE and a floor (`nested`, 25) fails the run if
     the walk ever stops descending. A non-recursive walk here would check 16 of 46
     files and print ok. */

// ── assert-adr-citations ──
  /* ADDED 2026-08-16 with the decisions/ streamline. The ADR set had ONE property
     nothing could check and nothing structurally could: whether a cited number is
     a decision at all. Three — 012, 014, 018 — were pre-allocated as headings in
     `research/29-SYNTHESIS-A-S.md`, never written, and are cited 63 times today
     from 17 files, one of them in the PUBLIC tree. A bare `[ADR 012]` is not a
     markdown link, so `assert-index-complete`'s link limb cannot see it, and the
     README table lists only files that exist, so a number with no file is
     invisible to any check that walks files. Existing phantoms are DECLARED and
     printed on every run rather than banned — the citations sit inside the
     finished spec, which must not be restructured — so what this ratchets is the
     NEXT one: an ADR cited before it lands fails the commit that writes it. */
// (the comment that stood at the end of its `rel` line)
// same fallback chain, corpus-relative leading entry added 2026-08-18 (retired 2026-08-16 layout in the third slot) — see the assert-spec entry above

// ── assert-session-index ── (row retired 2026-09-08; this block stood below assert-adr-citations)
  /* ADDED 2026-08-17 with the session-log index. `session-notes.md` is 11k lines
     and 149 entries, APPEND-ONLY and correct that way — the log is the durable
     memory, and truncating it would destroy what the corpus is for. What it had
     no map, so in practice nobody read past the top: every finding after the
     first week was on disk and effectively unreachable. `notes/session-notes-index.json`
     is that map. ⚠️ It is also the FOURTH hand-kept second copy of a tree in this
     corpus, and the other three each went stale in silence — so it gets the same
     treatment as the other three registers rather than a promise. The drift here
     is not hypothetical or slow: appending an entry IS the ritual of that file,
     and the row is forgotten the first time somebody appends in a hurry. The
     title limb is the sharp one — it catches an INSERTION, which shifts every
     line below it and would otherwise leave each row pointing confidently at
     somebody else's entry, exactly the `ci.yml:NNNN` failure one file over. */

// ── assert-public-citations ──
  /* ADDED 2026-08-17. THE PUBLIC HALF OF ST-3, AND NOTHING HAD EVER CHECKED IT.
     `assert-spec` limb 3 checks the spec's own `guard` fields, and
     `assert-adr-citations` is scoped to `Private/` — so between them a file in
     the PUBLIC tree could cite anything at all and no build would notice. Its
     first run found 241 unresolved citations across 101 files.

     It resolves two classes, and the split between them reversed the obvious
     read: 362 `Private/...` path references, of which 189 were dead, against
     1,464 `[pipeline X-N]` tags yielding 1,020 requirement ids, of which only 18
     were. So the tags were NOT rot — each still resolves to an `origin` field in
     `Private/requirements/*.json` — and rewriting them would have been a large
     edit that destroyed working pointers. The paths were the damage.

     It belongs in this set rather than in CI for the same reason every other
     guard here does: the resolution target is private, so a CI run would answer
     NOT APPLICABLE every time, which is a check that always passes. */

// ── assert-requirements-index ──
  /* ADDED 2026-08-27. `Private/requirements/index.json` is a hand-kept second copy
     of the tree here. Measured with `fs` instrumented
     rather than grepped: assert-spec, assert-research-archive and assert-session-index touch
     it zero times, assert-index-complete only existsSync()s it, and assert-adr-citations
     readFileSync()s it but text-scans for `ADR NNN` and `Private/` paths. Setting an `entries`
     count to 1 and a `perStage` cell to 999 left all five at exit 0.
     ⚠️ It checks `entries` and `perStage` ONLY. The `bytes` figures it used to carry are
     DELETED, not guarded — three of the seven were stale on the day, and index.json's own
     `_generated` note records why: a byte count re-measured while other writers hold the
     checkout open is stale before it is read. One `rel` candidate, corpus-relative: this guard
     never existed under the pre-2026-08-18 layouts, so it has no legacy spellings to fall back
     to and adding dead ones would be citing paths that do not resolve. */

// ── assert-platform-state ──
  /* ADDED 2026-09-05 with the knowledge set. `Private/platform-state/` is the
     cold-start knowledge set [ADR 067] decision 3 created: eight schema-validated
     files in which every number is `{value, asOf, verify}` and a BARE number is
     refused anywhere in the directory. It is the FIFTH hand-kept second copy of the
     tree in this corpus, and the other four each went stale in silence — which is
     why it was born with a guard rather than a promise.
     🔴 THE GUARD EXISTED AND NOTHING RAN IT, which is the failure class this whole
     set exists to close: `assert-platform-state.mjs` was written on the day the
     directory was, was documented in two READMEs, and was in no runner at all — so
     a mutated state file committed clean. A guard that is written and not wired is a
     guard nobody runs. One `rel` candidate, corpus-relative: this guard has never
     existed under any pre-2026-08-18 layout, so it has no legacy spellings to fall
     back to and adding dead ones would be citing paths that do not resolve — same
     reasoning as the `assert-requirements-index` entry above. */

// ── assert-links, check-agent-docs ── (one block over both rows)
  /* ADDED 2026-09-09. BOTH OF THESE LANDED ON 2026-09-08 AND NOTHING INVOKED THEM.
     They ran in the manual sweep (`.claude/skills/run-guards/`) and in no hook and no
     CI job, which is the `assert-platform-state` failure one entry above, repeated
     within a day of being written down there. A guard nothing runs is a guard nobody
     runs, and the defect that prompted the link guard had survived three commits.

     🔴 CI IS NOT THE ALTERNATIVE HERE, and that is not a preference. Both subjects are
     under `Private/`, which no CI job can read — the reason this whole runner exists
     (see the header). Wiring them "into CI instead" would produce a job that answers
     NOT APPLICABLE forever, i.e. a check that always passes. The hook is the only
     enforcement surface these two have, so the cost below is the price of enforcing
     them at all, not a choice between two places to put them.

     ⏱ MEASURED 2026-09-09 on this machine, three samples each, warm:
       assert-links       3641 / 3745 / 3652 ms
       check-agent-docs    585 /  590 /  650 ms
       the fast set before  7044 ms in-runner (7.3-8.6 s wall)
     So the hook goes from ~7.0 s to ~11.3 s in-runner: +4.3 s, and `assert-links` is
     four fifths of it. That is deliberately RECORDED rather than absorbed: it is the
     second-slowest entry in the set after `assert-public-citations` (4.5 s), and if
     the set is ever split into a hook tier and a pre-push tier, these numbers are
     where that split should be argued from.

     `args: ['--index']` is NOT a loosening. Both guards implement the honesty gate
     from the 2026-09-08 index-blind-spot audit: their subject is the git INDEX, so a
     run over an unstaged edit exits 2 (COVERAGE LOST) rather than printing a green
     about content nobody staged. In a pre-commit hook, judging the staged index IS
     the question being asked — "is what I am about to commit clean?" — so `--index`
     is the mode that MATCHES the caller. Anywhere else the gate stays armed. Proved
     mid-pass on the live tree: over three unstaged edits `assert-links` exited 2 and
     named all three files.

     Both entries anchor their own ROOT from `import.meta.url`, not from cwd, so they
     check the corpus from a public-repo commit and a private-repo commit alike — one
     `rel` candidate each, corpus-relative, for the same reason as the two entries
     above: neither guard existed under any pre-2026-08-18 layout, so a legacy
     spelling would be a path that does not resolve. */

// ── gen-adr-frontmatter, gen-index, gen-picture-stamp, gen-register-index,
//    gen-start-here, gen-traps ── (one block over all six rows)
  /* ADDED 2026-09-16. THE CORPUS'S SIX GENERATORS, EACH RUN AS `--check`, AND UNTIL
     TODAY NOTHING IN THIS HOOK RAN ANY OF THEM.
     `O-GEN-CHECK-IS-A-NO-OP` (closed 2026-09-13) gave all six one shared `--check`
     (`requirements/tooling/gen-check.mjs`: generate into memory, compare, exit 1 on a
     diff, WRITE NOTHING) and put them in the run-guards SWEEP. The sweep is run by a
     session that remembers to; this runner is run by `git commit`. So the property
     "a drifted generated page is caught" held only when somebody swept, which is the
     `assert-platform-state` failure above, a third time.

     🔴 MEASURED 2026-09-16, BOTH HALVES, on the private corpus as committed:
       node requirements/tooling/gen-start-here.mjs --check      → EXIT 1
       node tooling/scripts/spec-guards.mjs --fast               → EXIT 0
     The stale page was committed through this hook and the hook said nothing. A few
     hours later, with other commits between, the same generator was red on
     START-HERE.md — the entry card every cold session reads first.

     ONE ROW PER GENERATOR, not one row running all six, so a red names the page that
     drifted and a deleted generator trips the coverage floor by name.
     `args: ['--check']` is the whole point: without it four of the six WRITE their
     target, and a hook that rewrites the corpus while claiming to inspect it is the
     no-op that row was filed over, with a side effect added.

     ⚠️ TWO READ THE GIT INDEX. `gen-index` and `gen-picture-stamp` derive their
     page from `git ls-files --cached` by design, so a commit that adds or removes a
     corpus file is red until README.md and the stamp are regenerated IN THE SAME
     COMMIT. That is the drift they were built to catch, not a false positive. The
     other four read the working tree, as every row here except the two `--index`
     guards does. No generator reads a
     clock into the compared bytes: `gen-traps`' `asOf` and the stamp's
     `commit`/`branch` are declared `volatile` in gen-check.mjs and printed, and
     `gen-start-here` interpolates only register values.

     ⏱ MEASURED 2026-09-16 on this machine, three samples each, warm, cwd = the
     public worktree (all six anchor ROOT from `import.meta.url`):
       gen-adr-frontmatter   193 / 157 / 167 ms
       gen-index             230 / 210 / 204 ms
       gen-picture-stamp    1047 /1064 /1023 ms   (one `git ls-files` over the corpus)
       gen-register-index    155 / 154 / 160 ms
       gen-start-here        154 / 167 / 162 ms
       gen-traps             137 / 141 / 147 ms
       the fast set before  18118 ms in-runner (assert-public-citations 10716 of it)
     So +~1.9 s, ~10 %. None is slow by this file's own yardstick — `assert-links`
     (3.6-4.7 s) and `assert-public-citations` (4.5-10.7 s) are the entries a split
     would be argued from — so all six are `fast`. One corpus-relative `rel` each,
     for the reason given on `assert-platform-state`: no earlier layout had them. */

// ── assert-guard-set ── (new with the declaration: no row ever stood in the old
// table. It is the corpus's own check that every guard, generator and test it
// declares runs somewhere, and the one entry that makes the declaration a subject of
// the hook as well as its source.)
// ─────────────────────────────────────────────────────────────────────────────
import { repoGit, RepoGitError } from './repo-git.mjs';

/** Where the declaration lives, relative to the corpus root. */
export const DECLARATION_REL = 'requirements/tooling/guards.json';

/** The two sides a hook entry can name. */
export const SIDES = Object.freeze(['public', 'private']);

/** The guards the hook must run on BOTH sides, whatever the declaration says. The
 *  fifteen rows that moved out of `spec-guards.mjs`, plus `assert-guard-set`, which
 *  checks the declaration itself. Removing one here is a reviewed edit in this
 *  repository; removing one from the declaration alone is a refusal. */
export const PINNED_HOOK = Object.freeze([
  'check-dod-sync',
  'assert-spec',
  'assert-index-complete',
  'assert-adr-citations',
  'assert-public-citations',
  'assert-requirements-index',
  'assert-platform-state',
  'assert-links',
  'check-agent-docs',
  'gen-adr-frontmatter',
  'gen-index',
  'gen-picture-stamp',
  'gen-register-index',
  'gen-start-here',
  'gen-traps',
  'assert-guard-set',
]);

/** The fields every entry must carry for the hook to act on it. */
export const REQUIRED_FIELDS = Object.freeze(['id', 'file', 'hook']);

/** The one key the entry list sits under. The declaration is an object — the corpus
 *  writes `_what`, `_fields` and `entries` — and a bare array, or a list under any other
 *  key, is refused: a shape nobody writes is a branch no real run exercises. */
export const ENTRY_LIST_KEYS = Object.freeze(['entries']);

/** Thrown for every refusal. `limb` is one of 'side', 'blob', 'parse', 'entry',
 *  'pinned'. `tried` lists each blob the loader asked for — `{ root, blob, command,
 *  why }` — and `detail` carries one line per defect found in the declaration. */
export class GuardDeclarationError extends Error {
  constructor(limb, message, tried = [], detail = []) {
    super(message);
    this.name = 'GuardDeclarationError';
    this.limb = limb;
    this.tried = tried;
    this.detail = detail;
  }
}

/** The blob a side reads: the committed declaration for a public-side commit, the
 *  staged one for a commit in the corpus itself. */
export function blobSpec(side) {
  if (side === 'public') return `HEAD:${DECLARATION_REL}`;
  if (side === 'private') return `:${DECLARATION_REL}`;
  throw new GuardDeclarationError('side', `unknown side ${JSON.stringify(side)}; expected one of ${SIDES.join(', ')}`);
}

/** Read the declaration's bytes for `side` out of the repository at `privateRoot`.
 *  `cat-file blob` rather than `show`, so no textconv or pager can stand between the
 *  object and the parser. */
export function readDeclaration(privateRoot, side) {
  const blob = blobSpec(side);
  const tried = { root: privateRoot, blob, command: `git -C ${privateRoot} cat-file blob ${blob}` };
  let text;
  try {
    text = repoGit(privateRoot, 'cat-file', 'blob', blob);
  } catch (e) {
    if (!(e instanceof RepoGitError)) throw e;
    const what = side === 'public' ? 'the COMMITTED declaration' : 'the STAGED declaration';
    throw new GuardDeclarationError('blob', `${what} could not be read: ${e.message}`, [{ ...tried, why: e.detail || e.message }]);
  }
  return { ...tried, text };
}

const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

/** Parse the declaration and check every entry's shape. Returns the entry list, or
 *  throws with EVERY malformed entry named, not only the first. */
export function parseDeclaration(text, source) {
  const tried = source ? [source] : [];
  const where = source ? source.blob : DECLARATION_REL;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new GuardDeclarationError('parse', `${where} is not JSON: ${e.message}`, tried);
  }
  const [key] = ENTRY_LIST_KEYS;
  const isObject = doc !== null && typeof doc === 'object' && !Array.isArray(doc);
  if (!isObject || !Array.isArray(doc[key])) {
    throw new GuardDeclarationError('parse', `${where} holds no \`${key}\` list: expected an object with an array under \`${key}\``, tried);
  }
  const list = doc[key];

  const bad = [];
  list.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      bad.push(`entry ${i}: not an object`);
      return;
    }
    const label = isNonEmptyString(entry.id) ? `entry ${i} (${entry.id})` : `entry ${i}`;
    const missing = REQUIRED_FIELDS.filter((k) => !Object.prototype.hasOwnProperty.call(entry, k));
    if (missing.length) bad.push(`${label}: no ${missing.map((k) => `\`${k}\``).join(', ')}`);
    if (!missing.includes('id') && !isNonEmptyString(entry.id)) bad.push(`${label}: \`id\` is not a non-empty string`);
    if (!missing.includes('file') && !isNonEmptyString(entry.file)) bad.push(`${label}: \`file\` is not a non-empty string`);
    if (!missing.includes('hook') && !isStringList(entry.hook)) bad.push(`${label}: \`hook\` is not a list of strings`);
    else if (!missing.includes('hook')) {
      for (const value of entry.hook.filter((v) => !SIDES.includes(v))) {
        bad.push(`${label}: \`hook\` names ${JSON.stringify(value)}, which is neither ${SIDES.map((s) => `"${s}"`).join(' nor ')}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'args') && !isStringList(entry.args)) bad.push(`${label}: \`args\` is not a list of strings`);
  });
  if (bad.length) {
    throw new GuardDeclarationError('entry', `${where}: ${bad.length} entr${bad.length === 1 ? 'y' : 'ies'} the hook cannot act on`, tried, bad);
  }
  return list;
}

/** Every PINNED_HOOK name that is absent, or not declared for both sides — one line
 *  each. Empty when the pin holds. `pinned` is a parameter so a test can hand in a
 *  mutated pin list; the loader passes PINNED_HOOK. */
export function pinnedGaps(entries, pinned = PINNED_HOOK) {
  const gaps = [];
  for (const name of pinned) {
    const entry = entries.find((e) => e.id === name);
    if (!entry) {
      gaps.push(`${name}: not declared`);
      continue;
    }
    const lacking = SIDES.filter((s) => !entry.hook.includes(s));
    if (lacking.length) gaps.push(`${name}: declared with hook ${JSON.stringify(entry.hook)}, which lacks ${lacking.map((s) => `"${s}"`).join(' and ')}`);
  }
  return gaps;
}

/** The entries a side runs: those whose `hook` names it. */
export function selectForSide(entries, side) {
  blobSpec(side);
  return entries.filter((e) => e.hook.includes(side));
}

/** A declared entry in the shape `spec-guards.mjs` runs: `rel` is the entry's one
 *  `file`, which the runner's `locate()` joins onto the corpus root first and the
 *  public roots after; `args` is the entry's `args`, verbatim. */
export function runnerRow(entry) {
  return {
    name: entry.id,
    speed: 'fast',
    needsPrivate: true,
    rel: [entry.file],
    args: [...(entry.args ?? [])],
    what: entry.what ?? `(no \`what\` in ${DECLARATION_REL})`,
  };
}

/** Read, parse, pin-check and select, in that order. Returns
 *  `{ side, root, blob, entries, selected, rows }`; throws GuardDeclarationError. */
export function loadGuardDeclaration(privateRoot, side) {
  const source = readDeclaration(privateRoot, side);
  const entries = parseDeclaration(source.text, source);
  const gaps = pinnedGaps(entries);
  if (gaps.length) {
    throw new GuardDeclarationError('pinned', `${source.blob}: ${gaps.length} pinned guard(s) are not declared for both sides`, [source], gaps);
  }
  const selected = selectForSide(entries, side);
  return { side, root: privateRoot, blob: source.blob, entries, selected, rows: selected.map(runnerRow) };
}
