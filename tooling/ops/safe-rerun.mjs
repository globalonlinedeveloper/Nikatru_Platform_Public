#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// safe-rerun.mjs — `gh run rerun` on an OLD commit CANCELS the live run for the
// branch's actual HEAD. This refuses to do that.
//
// 🔴 THE INCIDENT, 2026-08-12, IN THIS REPOSITORY. `ci.yml` declares:
//
//        concurrency:
//          group: ci-${{ github.ref }}
//          cancel-in-progress: true
//
//    THE GROUP KEY IS THE **REF**, NOT THE SHA. Every run of that workflow on
//    `refs/heads/main` — for any commit, at any age — lands in the SAME group
//    `ci-refs/heads/main`, and a new entrant with `cancel-in-progress: true`
//    evicts whatever is in flight there.
//
//    So re-running the flaky CI run for `6559d6e` (an OLDER commit on main)
//    CANCELLED the in-flight run for `eff4fc2`, which was main's HEAD at that
//    moment. `ci-gate` for eff4fc2 therefore never reported — not "failed",
//    NEVER — and `deploy-workers.yml`'s `assert-gate-passed.mjs` sat polling for
//    a verdict that could no longer arrive, then failed closed. Two red lanes,
//    one of them a deploy, from one apparently-harmless re-run of an unrelated
//    flake. Nothing warned, because from GitHub's side nothing went wrong: the
//    concurrency rule did exactly what it is written to do.
//
//    The tell is worth naming, because it is the general shape: **a re-run is a
//    NEW entrant into a concurrency group, not a replay of an old one.** The age
//    of the commit buys no protection at all.
//
// WHAT THIS REFUSES. Given a run id, exit non-zero WITHOUT re-running when BOTH:
//   (a) the run's head SHA is not the current HEAD of its branch — i.e. this is
//       a re-run of history, so its result cannot be what anyone is waiting on;
//       AND
//   (b) another run in the SAME concurrency group for that ref is `in_progress`
//       or `queued` right now — i.e. there is something live to evict.
// Either alone is harmless: re-running HEAD is the normal thing to do, and an
// old re-run with nothing in flight cancels nothing. It is the pair that costs a
// deploy. Anything else re-runs normally.
//
// 🔴 THE GROUP IS DERIVED BY PARSING `.github/workflows/*.yml`, NEVER HARDCODED.
// `ci-` is one workflow's prefix, and a literal here would be the second
// declaration of a fact the workflow already states — this repository's most
// repeated failure. It is also simply WRONG for the neighbours, all of which are
// live in this tree today:
//   · `deploy-workers.yml` → group `deploy-workers`, cancel-in-progress: FALSE.
//     A re-run QUEUES behind the live one; it cannot evict it. Nothing to refuse.
//   · `deploy-web.yml`     → NO `concurrency:` block at all. Runs never collide.
//     Nothing to refuse.
//   · `ops-watch.yml`      → group `ops-watch`, cancel-in-progress: FALSE.
// A hardcoded `ci-` would have refused re-runs on lanes that cannot collide, and
// — the direction that actually costs something — would silently allow the
// cancelling re-run the day a second workflow adopts a ref-keyed group.
//
// Because groups are REPOSITORY-wide rather than per-workflow, two different
// workflows that resolve to the same group string DO evict each other. Comparing
// resolved group strings (rather than "is it the same workflow") is what makes
// that case answerable at all, and it is unit-tested below.
//
// ── EXIT CONTRACT ────────────────────────────────────────────────────────────
//   0 = re-run performed (or, with --dry-run, would have been).
//   1 = REFUSED. Both conditions held; no re-run was requested.
//   2 = I COULD NOT LOOK — no credential, API unreachable, the workflow file for
//       the run is not in this tree, or a group expression this parser cannot
//       resolve. A DIFFERENT code from 1 on purpose: "I could not tell" must
//       never be readable as "I looked and it was fine", and it must equally
//       never be readable as "I refused".
//
// ⚠️ NO `process.exit()` BELOW ONCE A `fetch` HAS BEEN MADE. Calling it while an
// undici keep-alive handle is open crashes libuv on Windows —
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — and the process
// then reports 127 for BOTH outcomes, collapsing the exact distinction the codes
// above exist to draw. Same bug that broke three sibling verifiers until
// 2026-08-05. `process.exitCode` + return, throughout.
//
// ── NEGATIVE TEST (recorded, per the standing rule) ──────────────────────────
// The failing case was constructed and run against THIS file, through `main()`,
// not against a fixture of the judgement:
//
//   fixture: run 16000000001, workflow `.github/workflows/ci.yml`, branch main,
//            head_sha 6559d6e…  ·  branchHeads.main = eff4fc2…  ·  one sibling
//            run 16000000002 at eff4fc2… with status `in_progress`.
//   command: SAFE_RERUN_FIXTURE=<f> SAFE_RERUN_FIXTURE_LOG=<log> \
//            node tooling/ops/safe-rerun.mjs 16000000001
//   measured: exit 1, stderr names group `ci-refs/heads/main`, and <log> WAS
//            NEVER CREATED — proving no re-run was requested, which is the claim
//            that matters. Asserting only the exit code would have passed
//            against a version that refused loudly and re-ran anyway.
//   restored: by deleting `--fixture` from the invocation. Nothing in the tree
//            or on GitHub was mutated; the fixture transport has no network
//            path at all, so this can never cancel a real run.
//
// ── MUTATION TESTED AGAINST THE REAL FILE, NOT AGAINST FIXTURES ─────────────
// "All 41 cases passed" is not evidence — `assert-seams-wired.mjs` once shipped
// broken with all six of its fixtures green, and only breaking the actual tree
// exposed it. So this implementation was broken four ways in place, the suite
// re-run each time, and restored byte-identically (`diff -q` against a copy
// taken before the first edit). Measured 2026-08-12:
//
//   A. refuse, then POST the re-run anyway (the failure an exit-code-only
//      assertion cannot see)          → 5 red, incl. the two `reran === false`
//   B. hardcode `groupOf` to `'ci-' + refOf(run)`, always cancelling — the
//      second-declaration failure this
//      file's header forbids           → 8 red: deploy-web (no block),
//                                        deploy-workers (cancel:false), the
//                                        stripped-block mutation, the
//                                        cross-workflow case, and both
//                                        unknowable-group exits
//   C. `coverageProblem` returns null
//      unconditionally                 → 2 red (both COVERAGE LOST cases)
//   D. drop condition (a) — treat every
//      run as if it were HEAD          → 8 red, incl. the incident replay
//
// Each mutation is red for the reason it was chosen, not incidentally: B leaves
// the incident replay itself GREEN (a hardcoded `ci-` still refuses the case it
// was written from), which is exactly why the derivation needs its own cases.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//   node tooling/ops/safe-rerun.mjs <runId> [--failed] [--dry-run]
//                                   [--workflows <dir>] [--repo <owner/name>]
//
//   --failed      re-run only the failed jobs (POST …/rerun-failed-jobs).
//                 ⚠️ NOT a safe harbour: a partial re-run enters the SAME
//                 concurrency group and evicts just as hard.
//   --dry-run     decide and print; never POST. The live read path, no writes.
//   --workflows   parse a different directory (tests point this at fixtures).
//   --repo        owner/name; else $GITHUB_REPOSITORY, else `git remote origin`.
//
//   Credential: GH_TOKEN / GITHUB_TOKEN, else the local vault
//   (`.claude/secrets.env`) key `Project_Cross_Platform_Apps_GITHUB_PAT`.
//   🔴 THAT FILE IS MIXED — `Project_nik_GITHUB_PAT` is single-quoted,
//   `Project_Cross_Platform_Apps_GITHUB_PAT` is bare (measured, both, on
//   2026-08-12). A reader that keeps the quotes sends `Bearer '…'` and GitHub
//   answers 401, which reads EXACTLY like a revoked token — the same two
//   characters cost two sessions on the Cloudflare token. `unquote` strips a
//   MATCHED surrounding pair only, so a bare value is untouched.
//   Nothing below ever prints the token's value.
//
// ── HONEST LIMITS, stated rather than implied ────────────────────────────────
// · The workflow files are read from the CURRENT WORKING TREE, while the run
//   being re-run was queued against the tree at ITS commit. If a concurrency
//   block changed in between, this reasons with today's declaration. That is the
//   right default (the re-run is queued NOW, against today's `main` definition
//   for `push` lanes) but it is an approximation for a re-run of a branch whose
//   own copy of the workflow differed.
// · A tag push and a branch push cannot be told apart from the runs API alone —
//   both report the name in `head_branch`. Both sides of the comparison are
//   expanded the same way, so a collision is never MISSED; the worst case is a
//   false refusal when a tag and a branch share a name. Refusing wrongly costs a
//   re-typed command; allowing wrongly costs a deploy.
// · `github.actor`, `github.job` and anything more elaborate than a bare
//   `github.<key>` in a group expression are UNRESOLVABLE here, and unresolvable
//   is exit 2, never a silent allow.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listDir } from '../ci/tree-walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** Statuses that mean "this run is holding the concurrency group right now".
 *  `waiting` (a deployment-protection hold), `requested` and `pending` occupy
 *  the group exactly as `queued` does, so they are listed: the requirement names
 *  in_progress/queued, and these are the other spellings GitHub uses for the
 *  same state. Omitting them would be a hole with no compensating benefit. */
export const LIVE_STATUSES = new Set([
  'in_progress',
  'queued',
  'waiting',
  'requested',
  'pending',
]);

/** 🔴 A MATCHED surrounding quote pair only. See the header: the vault is mixed,
 *  and stripping unconditionally would eat a leading `'` from a bare value. */
const unquote = (v) => v.replace(/^(['"])([\s\S]*)\1$/, '$2');

/** The local vault, overridable so a test can point it somewhere absent.
 *  Without this seam the no-credential case means one thing on a CI runner (no
 *  `.claude/`, exit 2) and the OPPOSITE on the owner's laptop (vault present →
 *  a real token → the LIVE GitHub API contacted). Same seam, same reason, as
 *  `verify-auth-providers.mjs`. */
const VAULT = () => process.env.NIKATRU_VAULT ?? join(ROOT, '.claude', 'secrets.env');

export function fromVault(key, file = VAULT()) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue; // the vault carries commented `export` examples
    const i = line.indexOf('=');
    if (i < 0) continue;
    if (line.slice(0, i).trim() === key) return unquote(line.slice(i + 1).trim());
  }
  return null;
}

export const token = () =>
  process.env.GH_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim() ||
  fromVault('Project_Cross_Platform_Apps_GITHUB_PAT');

// ═══════════════════════════════════════════════════════════════════════════
// THE WORKFLOW PARSE — structure, never prose
// ═══════════════════════════════════════════════════════════════════════════

/** Strip YAML comments. A `#` at line start or after whitespace begins one.
 *
 *  ⚠️ NOT COSMETIC. `ci.yml` is more comment than YAML, and this very file's
 *  subject — the word `concurrency` and the string `cancel-in-progress` — occurs
 *  inside prose blocks in several workflows here. A grep would match the comment
 *  explaining a group and keep "passing" after somebody deleted the real one. */
export const stripComments = (raw) =>
  raw
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');

const indentOf = (l) => l.match(/^[ \t]*/)[0].length;

/** Parse the TOP-LEVEL `concurrency:` declaration and `name:` out of one
 *  workflow. Job-level `concurrency:` is deliberately NOT read: it is indented,
 *  it governs only that job, and conflating the two would attribute a group to
 *  runs that never enter it.
 *
 *  Returns { name, declared, group, cancelInProgress, cancelIsExpression }.
 *  `declared:false` means the workflow has no top-level concurrency at all —
 *  which is `deploy-web.yml` today, and means its runs can never evict anything.
 */
export function parseWorkflow(raw) {
  const lines = stripComments(raw).split('\n');

  /** Top-level scalar `key: value`, value possibly empty. */
  const topLine = (key) => {
    const re = new RegExp(`^(['"]?)${key}\\1\\s*:(.*)$`);
    for (let i = 0; i < lines.length; i++) {
      if (indentOf(lines[i]) !== 0) continue;
      const m = lines[i].match(re);
      if (m) return { index: i, rest: m[2].trim() };
    }
    return null;
  };

  const nameAt = topLine('name');
  const name = nameAt && nameAt.rest !== '' ? unquote(nameAt.rest) : null;

  const at = topLine('concurrency');
  if (!at) return { name, declared: false, group: null, cancelInProgress: false, cancelIsExpression: false };

  // Scalar form — `concurrency: some-group`. GitHub treats it as the group with
  // cancel-in-progress defaulting to false, so it can never evict anything.
  if (at.rest !== '') {
    return {
      name,
      declared: true,
      group: unquote(at.rest),
      cancelInProgress: false,
      cancelIsExpression: false,
    };
  }

  // Mapping form. Collect the indented block that follows.
  let group = null;
  let cancel = null;
  for (let i = at.index + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (indentOf(lines[i]) === 0) break;
    const g = lines[i].match(/^\s+(['"]?)group\1\s*:(.*)$/);
    if (g) group = unquote(g[2].trim());
    const c = lines[i].match(/^\s+(['"]?)cancel-in-progress\1\s*:(.*)$/);
    if (c) cancel = unquote(c[2].trim());
  }

  // 🔴 AN UNRESOLVABLE `cancel-in-progress` IS TREATED AS CANCELLING. A value
  // like `${{ github.ref != 'refs/heads/main' }}` cannot be evaluated here, and
  // the two ways of being wrong are not symmetric: guessing "cancels" costs a
  // re-typed command, guessing "does not cancel" costs the deploy this file
  // exists to protect. Recorded on the result so the caller can say so out loud.
  const cancelIsExpression = cancel !== null && /\$\{\{/.test(cancel);
  const cancelInProgress = cancelIsExpression ? true : String(cancel).trim() === 'true';

  return { name, declared: true, group, cancelInProgress, cancelIsExpression };
}

/** Every workflow in `dir`, keyed by the repo-relative path GitHub reports on a
 *  run object (`.github/workflows/<file>`), so a run maps to its declaration
 *  without a second naming convention to keep in step. */
export function loadWorkflows(dir) {
  if (!existsSync(dir)) return new Map();
  const out = new Map();
  for (const f of listDir(dir)) {
    if (!/\.(ya?ml)$/.test(f)) continue;
    out.set(`.github/workflows/${f}`, { file: f, ...parseWorkflow(readFileSync(join(dir, f), 'utf8')) });
  }
  return out;
}

/** COVERAGE SELF-CHECKS over the parse, as a pure function so both have a
 *  recorded failing case that needs no live API.
 *
 *  Two distinct ways this scan can reach nothing while still printing a verdict:
 *    1. no workflow files at all — wrong directory, or the lane set moved;
 *    2. workflow files, but NOT ONE declares a top-level `concurrency:` — which
 *       on a repository that has four such blocks today means the PARSER went
 *       blind (a reshaped YAML, a flow-style mapping), and a blind parser
 *       green-lights every re-run there is.
 *  Returns null when the scan is sound. */
export function coverageProblem(workflows) {
  if (workflows.size === 0) {
    return (
      'COVERAGE LOST — no workflow files were parsed, so this scan read NOTHING and every ' +
      'concurrency group it could refuse on is invisible to it. A re-run allowed on an empty ' +
      'parse is allowed for the wrong reason.'
    );
  }
  const withConcurrency = [...workflows.values()].filter((w) => w.declared);
  if (withConcurrency.length === 0) {
    return (
      `COVERAGE LOST — ${workflows.size} workflow file(s) parsed and NOT ONE declares a top-level ` +
      '`concurrency:` block. Either every group was genuinely removed, or this parser stopped ' +
      'seeing the shape it depends on. Both mean the refusal below can never fire, which is ' +
      'indistinguishable from "nothing to refuse".'
    );
  }
  return null;
}

/** The NAMED lane. `ci.yml` is the workflow whose `cancel-in-progress: true` +
 *  ref-keyed group caused the incident; it is the reason this file exists. If it
 *  is renamed, retired or loses its concurrency block, say so LOUDLY rather than
 *  quietly grading a set that no longer contains the subject.
 *  Returns null when the named lane is present and still cancelling. */
export function namedLaneProblem(workflows, named = '.github/workflows/ci.yml') {
  const w = workflows.get(named);
  if (!w) {
    return `COVERAGE LOST — ${named} is not in the parsed set. It is the lane whose ref-keyed, cancelling group cost a HEAD run on 2026-08-12; point this name at its replacement in the same change that renames it.`;
  }
  if (!w.declared || !w.group) {
    return `COVERAGE LOST — ${named} no longer declares a top-level \`concurrency.group\`. Either the hazard is genuinely gone (delete this check and say why) or the parser stopped reading it.`;
  }
  if (!w.cancelInProgress) {
    return `COVERAGE LOST — ${named} declares a group but \`cancel-in-progress\` is not true, so this tool would now allow every re-run on it. If that is deliberate, this check has to be re-pointed deliberately too.`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/** The `github.ref` a run entered its concurrency group under.
 *  Returns null when it cannot be determined — never a guess. */
export function refOf(run) {
  if (run.event === 'pull_request' || run.event === 'pull_request_target') {
    const n = run.pull_requests?.[0]?.number;
    if (!n) return null;
    return `refs/pull/${n}/${run.event === 'pull_request' ? 'merge' : 'head'}`;
  }
  if (run.head_branch) return `refs/heads/${run.head_branch}`;
  return null;
}

/** Expand a `concurrency.group` template for one run.
 *  Only bare `${{ github.<key> }}` is understood; anything else is reported as
 *  UNRESOLVED rather than pasted through, because a template silently treated as
 *  a literal compares equal to itself for every run and would make two unrelated
 *  runs look like a collision (or two colliding runs look unrelated). */
export function expandGroup(template, ctx) {
  const unresolved = [];
  const value = String(template).replace(/\$\{\{([^}]*)\}\}/g, (_m, inner) => {
    const key = inner.trim();
    if (Object.prototype.hasOwnProperty.call(ctx, key) && typeof ctx[key] === 'string') return ctx[key];
    unresolved.push(key);
    return `<UNRESOLVED:${key}>`;
  });
  return { value, unresolved };
}

/** The context a run supplies to its own group expression. */
export function contextFor(run, workflow, repo) {
  const ref = refOf(run);
  if (ref === null) return null;
  const refName = ref.replace(/^refs\/(heads|tags)\//, '').replace(/^refs\/pull\//, '');
  return {
    'github.ref': ref,
    'github.ref_name': refName,
    'github.workflow': workflow.name ?? workflow.file ?? '',
    'github.event_name': String(run.event ?? ''),
    'github.sha': String(run.head_sha ?? ''),
    'github.run_id': String(run.id ?? ''),
    'github.repository': String(repo ?? ''),
    'github.head_ref':
      run.event === 'pull_request' || run.event === 'pull_request_target'
        ? String(run.head_branch ?? '')
        : '',
  };
}

/** The resolved concurrency group for a run, or a stated reason it is unknown.
 *  { group } | { unknown: '<why>' } | { none: '<why>' } */
export function groupOf(run, workflows, repo) {
  const wf = workflows.get(run.path);
  if (!wf) {
    return {
      unknown: `the workflow file \`${run.path}\` for run ${run.id} is not in the parsed set — this working tree cannot say what group that run occupies`,
    };
  }
  if (!wf.declared || !wf.group) {
    return { none: `${wf.file} declares no top-level \`concurrency:\`, so its runs never share a group` };
  }
  const ctx = contextFor(run, wf, repo);
  if (ctx === null) {
    return {
      unknown: `run ${run.id} (event \`${run.event}\`) carries no ref this parser can reconstruct`,
    };
  }
  const { value, unresolved } = expandGroup(wf.group, ctx);
  if (unresolved.length) {
    return {
      unknown: `${wf.file}'s group \`${wf.group}\` uses ${unresolved.map((u) => `\`${u}\``).join(', ')}, which this parser cannot resolve`,
    };
  }
  return { group: value, workflow: wf };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE JUDGEMENT — pure, so it can be exercised without a network or a token
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param run             the run object being re-run (GitHub shape)
 * @param branchHeadSha   the current tip of `run.head_branch`, or null if unknown
 * @param workflows       Map from `loadWorkflows`
 * @param siblings        every OTHER run currently on that branch (any status)
 * @param repo            'owner/name', for `${{ github.repository }}`
 * @returns { code, verdict: 'allow'|'refuse'|'unknown', reason, group, colliding[] }
 */
export function decide({ run, branchHeadSha, workflows, siblings = [], repo = '' }) {
  const target = groupOf(run, workflows, repo);

  if (target.unknown) {
    return {
      code: 2,
      verdict: 'unknown',
      reason: `I COULD NOT LOOK — ${target.unknown}. Refusing to guess: a wrong guess here either blocks a legitimate re-run or cancels a live one.`,
      group: null,
      colliding: [],
    };
  }

  if (target.none) {
    return {
      code: 0,
      verdict: 'allow',
      reason: `${target.none}. A re-run cannot evict anything.`,
      group: null,
      colliding: [],
    };
  }

  if (!target.workflow.cancelInProgress) {
    return {
      code: 0,
      verdict: 'allow',
      reason: `${target.workflow.file} declares group \`${target.group}\` with \`cancel-in-progress: false\`, so a re-run QUEUES behind whatever is live rather than evicting it.`,
      group: target.group,
      colliding: [],
    };
  }

  // (a) — is this a re-run of HISTORY, or of the tip?
  if (!branchHeadSha) {
    return {
      code: 2,
      verdict: 'unknown',
      reason: `I COULD NOT LOOK — the current HEAD of \`${run.head_branch}\` is unknown, so I cannot tell whether run ${run.id} is history or the tip. That is the whole first half of the test.`,
      group: target.group,
      colliding: [],
    };
  }
  if (String(run.head_sha) === String(branchHeadSha)) {
    return {
      code: 0,
      verdict: 'allow',
      reason: `run ${run.id} IS the current HEAD of \`${run.head_branch}\` (${short(branchHeadSha)}). Re-running the tip is the normal thing to do — anything it evicts is another attempt at the same commit.`,
      group: target.group,
      colliding: [],
    };
  }

  // (b) — is there anything live in that same group to evict?
  const colliding = [];
  for (const s of siblings) {
    if (String(s.id) === String(run.id)) continue;
    if (!LIVE_STATUSES.has(String(s.status))) continue;
    const g = groupOf(s, workflows, repo);
    if (g.unknown) {
      return {
        code: 2,
        verdict: 'unknown',
        reason: `I COULD NOT LOOK — a live run (${s.id}, ${s.status}) is on this branch and ${g.unknown}. It might or might not be in \`${target.group}\`, and "might" is not a basis for re-running.`,
        group: target.group,
        colliding: [],
      };
    }
    if (g.none) continue;
    if (g.group === target.group) colliding.push({ ...s, group: g.group });
  }

  if (colliding.length === 0) {
    return {
      code: 0,
      verdict: 'allow',
      reason: `run ${run.id} is behind HEAD (${short(run.head_sha)} vs ${short(branchHeadSha)}), but NOTHING is live in group \`${target.group}\` — there is nothing for the re-run to cancel.`,
      group: target.group,
      colliding: [],
    };
  }

  return {
    code: 1,
    verdict: 'refuse',
    reason:
      `REFUSED. Run ${run.id} is at ${short(run.head_sha)}, which is NOT the current HEAD of ` +
      `\`${run.head_branch}\` (${short(branchHeadSha)}), and ${colliding.length} run(s) are live in the ` +
      `SAME concurrency group \`${target.group}\`. ${target.workflow.file} sets ` +
      `\`cancel-in-progress: true\`${target.workflow.cancelIsExpression ? ' (via an expression this parser could not evaluate, so it is assumed to cancel)' : ''}, ` +
      'and the group key is the REF, not the SHA — so re-running this OLD run would evict the live one.',
    group: target.group,
    colliding,
  };
}

const short = (sha) => String(sha ?? '').slice(0, 7);

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — live, or a fixture with NO NETWORK PATH AT ALL
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://api.github.com';

function liveApi(repo, tok) {
  const headers = {
    authorization: `Bearer ${tok}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'nikatru-safe-rerun',
  };
  const get = async (path) => {
    const res = await fetch(`${API}${path}`, { headers });
    if (!res.ok) {
      const e = new Error(`GET ${path} → HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  };
  return {
    live: true,
    getRun: (id) => get(`/repos/${repo}/actions/runs/${id}`),
    getBranchHead: async (branch) =>
      (await get(`/repos/${repo}/commits/${encodeURIComponent(branch)}`)).sha,
    listRuns: async (branch) => {
      const out = [];
      for (const status of ['in_progress', 'queued']) {
        const page = await get(
          `/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&status=${status}&per_page=100`,
        );
        out.push(...(page.workflow_runs ?? []));
      }
      return out;
    },
    rerun: async (id, failedOnly) => {
      const res = await fetch(
        `${API}/repos/${repo}/actions/runs/${id}/${failedOnly ? 'rerun-failed-jobs' : 'rerun'}`,
        { method: 'POST', headers },
      );
      if (!res.ok) throw new Error(`POST rerun → HTTP ${res.status} ${await res.text()}`);
      return true;
    },
  };
}

/** The injection point. A JSON file stands in for every API answer, and `rerun`
 *  writes a line to $SAFE_RERUN_FIXTURE_LOG instead of calling GitHub.
 *
 *  🔴 THE LOG IS THE POINT, NOT A CONVENIENCE. The claim under test is "it did
 *  NOT re-run", and an exit code alone cannot distinguish a tool that refused
 *  from a tool that refused loudly and re-ran anyway. The absence of the log
 *  file is the evidence. There is deliberately NO fetch in this object: the
 *  negative test cannot cancel a real run even if the fixture is wrong. */
function fixtureApi(path) {
  const fx = JSON.parse(readFileSync(path, 'utf8'));
  const log = process.env.SAFE_RERUN_FIXTURE_LOG;
  return {
    live: false,
    repo: fx.repo,
    getRun: async (id) => {
      const r = fx.runs?.[String(id)];
      if (!r) {
        const e = new Error(`fixture has no run ${id}`);
        e.status = 404;
        throw e;
      }
      return r;
    },
    getBranchHead: async (branch) => {
      const sha = fx.branchHeads?.[branch];
      if (!sha) {
        const e = new Error(`fixture has no branch head for ${branch}`);
        e.status = 404;
        throw e;
      }
      return sha;
    },
    listRuns: async (branch) => fx.runsByBranch?.[branch] ?? [],
    rerun: async (id, failedOnly) => {
      if (log) appendFileSync(log, `rerun ${id} failedOnly=${failedOnly}\n`);
      console.log(`   (fixture transport: a re-run of ${id} WOULD have been POSTed here)`);
      return true;
    },
  };
}

function repoFromGit() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
export function parseArgs(argv) {
  const args = { runId: null, failed: false, dryRun: false, workflows: null, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--failed') args.failed = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--workflows') args.workflows = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (/^\d+$/.test(a)) args.runId = a;
    else return { error: `unrecognised argument \`${a}\`` };
  }
  if (!args.runId) return { error: 'no run id given. Usage: safe-rerun.mjs <runId> [--failed] [--dry-run]' };
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`✗ ${args.error}`);
    return 2;
  }

  const wfDir = args.workflows ? resolve(args.workflows) : join(ROOT, '.github', 'workflows');
  const workflows = loadWorkflows(wfDir);

  const cov = coverageProblem(workflows);
  if (cov) {
    console.error(`✗ ${cov}`);
    console.error(`  scanned: ${wfDir}`);
    return 2;
  }
  // The named-lane floor applies to the real tree. A caller pointing --workflows
  // at a fixture is a weaker situation and says so rather than demanding this
  // repository's lane names of an unrelated directory.
  if (!args.workflows) {
    const named = namedLaneProblem(workflows);
    if (named) {
      console.error(`✗ ${named}`);
      return 2;
    }
  }

  const fixture = process.env.SAFE_RERUN_FIXTURE;
  let api;
  let repo;
  if (fixture) {
    if (!existsSync(fixture)) {
      console.error(`✗ SAFE_RERUN_FIXTURE points at ${fixture}, which does not exist.`);
      return 2;
    }
    api = fixtureApi(fixture);
    repo = args.repo ?? api.repo ?? 'fixture/fixture';
    console.log(`⚠️  FIXTURE TRANSPORT — no network. Reading ${fixture}`);
  } else {
    repo = args.repo ?? (process.env.GITHUB_REPOSITORY?.trim() || repoFromGit());
    if (!repo) {
      console.error('✗ I COULD NOT LOOK — no repository. Pass --repo owner/name or set GITHUB_REPOSITORY.');
      return 2;
    }
    const tok = token();
    if (!tok) {
      console.error(
        '✗ I COULD NOT LOOK — no GitHub credential. Set GH_TOKEN/GITHUB_TOKEN, or make ' +
          '`Project_Cross_Platform_Apps_GITHUB_PAT` readable in the local vault. Exit 2, not a pass.',
      );
      return 2;
    }
    api = liveApi(repo, tok);
  }

  let run;
  try {
    run = await api.getRun(args.runId);
  } catch (e) {
    console.error(`✗ I COULD NOT LOOK — could not read run ${args.runId}: ${e.message}`);
    if (e.status === 401) {
      console.error('  A 401 is the reader before the credential: the vault quotes SOME of its values.');
    }
    return 2;
  }

  if (!run.head_branch) {
    console.error(`✗ I COULD NOT LOOK — run ${args.runId} reports no head_branch, so it has no ref to compare.`);
    return 2;
  }

  let branchHeadSha = null;
  try {
    branchHeadSha = await api.getBranchHead(run.head_branch);
  } catch (e) {
    console.error(
      `✗ I COULD NOT LOOK — could not read the current HEAD of \`${run.head_branch}\`: ${e.message}. ` +
        '(A fork-headed run has no such branch here.)',
    );
    return 2;
  }

  let siblings = [];
  try {
    siblings = await api.listRuns(run.head_branch);
  } catch (e) {
    console.error(`✗ I COULD NOT LOOK — could not list live runs for \`${run.head_branch}\`: ${e.message}`);
    return 2;
  }

  const verdict = decide({ run, branchHeadSha, workflows, siblings, repo });

  console.log('');
  console.log(`run ${run.id}  ${run.name ?? run.path}  (${run.path})`);
  console.log(`  head    ${short(run.head_sha)} on ${run.head_branch}   ·   branch tip ${short(branchHeadSha)}`);
  console.log(`  group   ${verdict.group ?? '(none declared)'}`);
  for (const c of verdict.colliding) {
    console.log(`  ⚠️  LIVE in the same group: run ${c.id} (${c.status}) at ${short(c.head_sha)} — ${c.path}`);
  }
  console.log('');

  if (verdict.code !== 0) {
    console.error(`✗ ${verdict.reason}`);
    if (verdict.verdict === 'refuse') {
      console.error('');
      console.error('  What to do instead — pick the one that matches what you actually want:');
      console.error(`    · wait for the live run(s) above to finish, then re-run ${run.id};`);
      console.error('    · re-run the run for the CURRENT HEAD instead, if the tip is what you need green;');
      console.error('    · if you really do mean to evict the live run, run the `gh run rerun` by hand and');
      console.error('      say so out loud — that is a decision, and it should not be made by a tool.');
    }
    return verdict.code;
  }

  console.log(`ok  ${verdict.reason}`);
  if (args.dryRun) {
    console.log('--  --dry-run: no re-run was requested.');
    return 0;
  }
  try {
    await api.rerun(run.id, args.failed);
  } catch (e) {
    console.error(`✗ the re-run was allowed but the request failed: ${e.message}`);
    return 2;
  }
  console.log(`ok  re-run requested for ${run.id}${args.failed ? ' (failed jobs only)' : ''}.`);
  return 0;
}

// Only run when EXECUTED. A test importing `decide`/`parseWorkflow` must not
// fire a live API call as a side effect and silently set the suite's exit code.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
