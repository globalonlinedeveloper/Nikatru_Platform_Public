#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-analytics-liveness.mjs — IS THE ANALYTICS RAIL'S SILENCE A FAULT?
//
// [pipeline 11]E-13. The writer (`analyticsLiveness` in
// services/platform/src/scheduled.ts) measures and records; it does NOT grade.
// This file is the grader, and the separation is [ADR 035] rather than a filing
// choice:
//
//   `ok` in `cron_heartbeat` answers ONE question, the same one for every writer
//   in this portfolio: DID THE WORK SUCCEED. A query that ran and correctly
//   found nothing has succeeded. Teaching the writer to set ok=0 on zero events
//   was tried — it shipped 2026-08-06, went red on the first real cron run
//   (2026-08-07T06:00:23Z), and would have gone red EVERY DAY for the
//   owner-gated reason that no app has shipped. A daily red nobody can act on is
//   how an alarm gets muted, so the judgement moved HERE.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT MAKES THE JUDGEMENT POSSIBLE, AND WHY IT IS NOT A THRESHOLD.
//
// `analyticsLiveness`'s own doc comment rejects three candidate baselines for
// telling "the rail is broken" apart from "nobody opened the app": Cloudflare's
// Free-plan request analytics (UNVERIFIED), GlitchTip events (CONTAMINATED by
// the agent's own Electron visits) and a new server-side count of the launch
// config fetch (a NEW COLLECTION POSTURE needing an owner decision).
//
// The fourth signal is `consent_artifacts` IN THE SAME DATABASE. It arrives on
// a different route (`POST /v1/consent`), by a different client transport (an
// immediate single write, not the offline batch queue), into a different table
// — so no break anywhere in the events path can silence it. That is exactly the
// independence the other three were being judged on, and it costs no credential
// this cron does not already hold.
//
// The verdict therefore needs NO number nobody can derive:
//
//   consents > 0 AND events = 0   FAIL (1). Somebody answered a consent prompt
//                                 in a shipped build inside the window and the
//                                 events rail produced NOTHING. Reach is proven;
//                                 arrivals are zero.
//   events > 0                    PASS (0). The rail is producing.
//   consents = 0 AND events = 0   PASS (0) — AND IT PRINTS. Still genuinely
//                                 ambiguous, and the ambiguity is owner-gated
//                                 (no app has shipped), so [pipeline C-6]: it
//                                 must PRINT, never block. Zero and three must
//                                 not read alike, so the state is stated out
//                                 loud on every run.
//
// ⚠️ IT PARSES TOKENS, NEVER PROSE. The portfolio row's detail LEADS with
// `events=N apps=N consented_apps=N consents=N window=Nh`. This reader looks at
// those and at nothing else, because "assert on parsed structure, never by
// grepping prose" is a rule this repo has a scar from — a `grep '"r2_buckets"'`
// once matched the template comment explaining why there is no r2_buckets. A
// reworded sentence must not be able to move a verdict.
//
// ⚠️ FRESHNESS AND ABSENCE ARE NOT RE-IMPLEMENTED HERE, ON PURPOSE. "Did the run
// that was due actually run" is tooling/ops/check-heartbeats.mjs's
// occurrence-anchored limb, and it owns the ONE narrow cron parser in this repo.
// A second copy would drift in the way that reports clean. This reader states
// the age of the row it judged and leaves the timer to the file that watches
// timers; both run in the same ops-watch job, so a dead cron still reddens.
//
// EXIT CODES — the same three-valued contract as check-heartbeats.mjs,
// status.mjs and check-prod-provenance.mjs:
//   0 = verified (including the honest third state, which prints)
//   1 = a real failure — the rail is provably silent while users consented
//   2 = COULD NOT LOOK: no credential, no row, an unparseable detail, a writer
//       that could not run. Fails closed, and says WHICH. "I could not tell"
//       must never read as "I looked and it was fine".
//
// 🔴 `process.exit()` IS BANNED IN THIS FILE. Calling it while an undici (fetch)
// keep-alive handle is open crashes libuv on Windows —
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src/win/async.c:94` —
// and the process then reports 127, collapsing the 1-vs-2 distinction the codes
// above exist to draw. Measured in tooling/ops/verify-monitors.mjs on
// 2026-08-05, three runs out of three. Set `process.exitCode` and return.
//
// Usage:  node tooling/ops/check-analytics-liveness.mjs [--root <repoRoot>]
// Offline: --rows-file <json> injects heartbeat rows so every branch is
//          exercisable without network. It prints a loud banner.
// Env:    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The watched-job derivation is IMPORTED, never re-written: it already resolves
// the register's cron duty, its wrangler anchor, the D1 database that owns
// `cron_heartbeat`, and it refuses when any of those has drifted. A second copy
// would be a second thing to keep in step, and the drift would be invisible.
import { deriveWatchedJobs } from './check-heartbeats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTER_REL = 'tooling/ops/register.json';

/** `indexOf` returns -1 when absent and -1 + 1 === 0 silently selects argv[0];
 *  that off-by-one shipped once in this repo and blocked both production
 *  deploys. Same shape as check-heartbeats.mjs's, deliberately. */
function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

/** Exit 2, distinct from exit 1, and the distinction is the whole point. */
export class CouldNotLook extends Error {}

/**
 * The row the aggregate lives on. PINNED to the writer rather than hoped for:
 * `assertPinned` below fails closed if this literal stops appearing in the
 * Worker's source, because a target name this reader invents is a filter that
 * matches nothing — which returns "no row" forever, or, if the absence limb were
 * ever softened, green forever.
 */
export const PORTFOLIO_TARGET = '(portfolio)';

/** The declaration this reader resolves the job name through. Named rather than
 *  hardcoding the job STRING: renaming the constant then fails closed here
 *  instead of querying a name nothing writes. */
const JOB_CONST = 'ANALYTICS_LIVENESS_JOB';

/**
 * The leading `key=value` run, and nothing else.
 *
 * FIRST OCCURRENCE WINS: the tokens LEAD the detail by contract, so a later
 * `x=y` inside prose can never displace one. Order-tolerant on purpose — the
 * contract is "these tokens are present", not "in this sequence", and a reader
 * that broke when somebody reordered them would be asserting on layout.
 */
export function parseTokens(detail) {
  const out = {};
  for (const m of String(detail ?? '').matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g)) {
    if (!Object.prototype.hasOwnProperty.call(out, m[1])) out[m[1]] = m[2];
  }
  return out;
}

/** A token that must be a whole non-negative number, or the detail is not the
 *  contract and this reader must not guess at it. */
function intToken(tokens, key) {
  const raw = tokens[key];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * THE DECISION, KEPT PURE. `rows` are heartbeat rows for the analytics job (any
 * target, any age); everything impure has already happened.
 *
 * Returns `{ code, kind, lines }` — `code` is the process exit code, `kind` is
 * what a test asserts on, `lines` are for humans.
 */
export function judge(rows, nowMs) {
  if (!Array.isArray(rows)) {
    return {
      code: 2,
      kind: 'unreadable',
      lines: [`the query result was not an array — an unreadable answer is a failure, not a pass`],
    };
  }
  const portfolio = rows.filter((r) => r?.target === PORTFOLIO_TARGET);
  if (portfolio.length === 0) {
    return {
      code: 2,
      kind: 'absent',
      lines: [
        `no \`${PORTFOLIO_TARGET}\` row exists for the analytics liveness job (${rows.length} row(s) of other targets seen).`,
        'That row is written UNCONDITIONALLY by every run, including when the result set is empty, so its',
        'absence means the job has never run or can no longer write — not that there was nothing to say.',
      ],
    };
  }
  const newest = portfolio.reduce((a, b) => (Date.parse(b.ran_at) > Date.parse(a.ran_at) ? b : a));
  const stamp = Date.parse(newest.ran_at);
  if (Number.isNaN(stamp)) {
    return { code: 2, kind: 'unreadable', lines: [`the newest portfolio row has an unparseable ran_at (${newest.ran_at})`] };
  }
  const ageHours = (nowMs - stamp) / 3_600_000;
  const stampedAt = `${newest.ran_at} (${ageHours.toFixed(1)}h old)`;

  // ⚠️ ok=0 means THE WRITER COULD NOT RUN — its query threw. That tells this
  // reader nothing about the rail, so it is exit 2 and not exit 1. The failing
  // WRITER is check-heartbeats.mjs's limb, which reddens on the same row.
  if (Number(newest.ok) !== 1) {
    return {
      code: 2,
      kind: 'writer-failed',
      lines: [
        `the newest portfolio row carries ok=${newest.ok}, i.e. the liveness query itself could not run: ` +
          `${String(newest.detail ?? '').slice(0, 200)}`,
        `Written ${stampedAt}. A detector that could not run tells us nothing about what it watches.`,
      ],
    };
  }

  const tokens = parseTokens(newest.detail);
  const events = intToken(tokens, 'events');
  const consents = intToken(tokens, 'consents');
  const consentedApps = intToken(tokens, 'consented_apps');
  if (events === null || consents === null || consentedApps === null) {
    return {
      code: 2,
      kind: 'unparseable',
      lines: [
        'the newest portfolio row does not carry the structured tokens this reader parses ' +
          `(events=${tokens.events ?? '<missing>'} consents=${tokens.consents ?? '<missing>'} ` +
          `consented_apps=${tokens.consented_apps ?? '<missing>'}).`,
        `detail: ${String(newest.detail ?? '').slice(0, 200)}`,
        'The writer leads the detail with `events= apps= consented_apps= consents= window=` by contract.',
        'Guessing from the prose is the one thing this reader must never do, so it fails closed instead.',
      ],
    };
  }

  const window = tokens.window ?? '<unstated>';
  if (consents > 0 && events === 0) {
    return {
      code: 1,
      kind: 'silent-with-reach',
      lines: [
        `THE ANALYTICS RAIL IS SILENT WHILE ${consents} CONSENT ARTIFACT(S) LANDED FROM ${consentedApps} APP(S) ` +
          `IN THE SAME ${window} WINDOW.`,
        `Measured ${stampedAt}: events=${events}, consents=${consents}.`,
        'Consent arrives on POST /v1/consent — a different route, a different client transport and a different',
        'table — so a break in the events path cannot silence it. Reach is PROVEN and arrivals are ZERO, which',
        'is the one reading "an empty events table" could never support on its own.',
        'Look at, in order: the client event queue flushing at all; POST /v1/events answering 2xx from the app',
        "origin (CORS); and the ingest route's dedup, which drops a duplicate event_id silently by design.",
      ],
    };
  }
  if (events > 0) {
    return {
      code: 0,
      kind: 'live',
      lines: [`the rail produced events=${events} in the last ${window} (consents=${consents}), measured ${stampedAt}`],
    };
  }
  return {
    code: 0,
    kind: 'ambiguous-silence',
    lines: [
      `⬜ NOTHING AND NOBODY: events=0 AND consents=0 in the last ${window}, measured ${stampedAt}.`,
      'This is the honest third state and it is NOT a failure. With no consent either, a broken rail and a',
      'week in which nobody opened the app remain indistinguishable — the gap analyticsLiveness records.',
      'It is owner-gated (no app has shipped to a store yet), and [pipeline C-6] says an owner-gated gap must',
      'PRINT rather than block: a daily red nobody can act on is how an alarm gets muted. It becomes a real',
      'verdict — either way — the first time one consent artifact lands.',
    ],
  };
}

// ── derivation ───────────────────────────────────────────────────────────────

/** Every .ts/.js/.mjs source under a directory, concatenated. Same reduction
 *  check-heartbeats.mjs applies for the same reason: the job name is a fact
 *  about the Worker's source, not about a list in a script. */
function readSourceTree(dir) {
  let out = '';
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out += readSourceTree(p);
    else if (/\.(ts|js|mjs)$/.test(e.name)) out += readFileSync(p, 'utf8');
  }
  return out;
}

/** The Worker source directory, resolved through the register's cron duty anchor
 *  — the same path check-heartbeats.mjs resolves, so the two cannot disagree
 *  about which Worker they are talking about. */
function workerSource(root) {
  const regPath = join(root, REGISTER_REL);
  if (!existsSync(regPath)) throw new CouldNotLook(`${REGISTER_REL} does not exist`);
  let reg;
  try {
    reg = JSON.parse(readFileSync(regPath, 'utf8'));
  } catch (e) {
    throw new CouldNotLook(`${REGISTER_REL} could not be parsed (${e.message})`);
  }
  const row = (reg.rows ?? []).find((r) => r.kind === 'duty' && r?.mechanism?.substrate === 'cloudflare-cron');
  if (!row) throw new CouldNotLook(`${REGISTER_REL} declares no \`cloudflare-cron\` duty, so the Worker cannot be located`);
  const srcDir = join(root, dirname(row.mechanism.anchor), 'src');
  if (!existsSync(srcDir)) throw new CouldNotLook(`${row.id} anchors at ${row.mechanism.anchor}, and ${dirname(row.mechanism.anchor)}/src does not exist`);
  return readSourceTree(srcDir);
}

/**
 * The job name and the portfolio target, both READ FROM THE WRITER.
 *
 * 🔴 COVERAGE LOST rather than a default: a reader that invents either literal
 * queries a name nothing writes and a target nothing matches, which returns "no
 * row" forever. This repo has already shipped one symbol that matched only its
 * own declaration; the rule since is that a literal shared by two files is
 * derived from one of them, not typed into both.
 */
export function deriveWriterLiterals(root) {
  const src = workerSource(root);
  const m = new RegExp(`export\\s+const\\s+${JOB_CONST}\\s*=\\s*['"]([^'"]+)['"]`).exec(src);
  if (!m) {
    throw new CouldNotLook(
      `COVERAGE LOST — no \`export const ${JOB_CONST} = '…'\` declaration in the Worker's source. ` +
        'The job whose rows this reader judges cannot be named, so it would query nothing and report clean.',
    );
  }
  if (!src.includes(`'${PORTFOLIO_TARGET}'`) && !src.includes(`"${PORTFOLIO_TARGET}"`)) {
    throw new CouldNotLook(
      `COVERAGE LOST — the literal \`${PORTFOLIO_TARGET}\` appears nowhere in the Worker's source, so the ` +
        'aggregate row this reader filters for is not the row the writer writes. The filter would match nothing.',
    );
  }
  return { job: m[1], portfolioTarget: PORTFOLIO_TARGET };
}

// ── D1, mirroring check-heartbeats.mjs's access exactly ─────────────────────
async function queryD1(databaseId, job) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`;
  // NO `CF-Connecting-IP` HEADER, EVER — Cloudflare's edge rejects any client
  // request carrying one with error 1000 before the origin is reached.
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      sql: 'SELECT job, target, ok, detail, ran_at FROM cron_heartbeat WHERE job = ? ORDER BY ran_at DESC LIMIT 20',
      params: [job],
    }),
  });
  if (!res.ok) throw new CouldNotLook(`the D1 API returned ${res.status} for job ${job}`);
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new CouldNotLook(`the D1 API response for job ${job} was not JSON (${e.message})`);
  }
  if (body?.success !== true) throw new CouldNotLook(`the D1 API reported failure for job ${job}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
  const rows = body?.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new CouldNotLook(`the D1 API response for job ${job} carried no results array`);
  return rows;
}

async function main() {
  const { jobs, problems } = deriveWatchedJobs(ROOT);
  if (problems.length) {
    throw new CouldNotLook(
      `the watched-job derivation reported ${problems.length} problem(s), so the register and the tree disagree ` +
        `about what is running:\n    ${problems.join('\n    ')}`,
    );
  }
  const { job } = deriveWriterLiterals(ROOT);
  const watched = jobs.find((j) => j.job === job);
  if (!watched) {
    throw new CouldNotLook(
      `the operations register's watched set does not include \`${job}\` (it names ${jobs.map((j) => j.job).join(', ')}). ` +
        'The job runs and nothing reads its outcome, which is the state check-heartbeats.mjs already refuses.',
    );
  }

  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) throw new CouldNotLook(`--now is not a parseable date: ${nowFlag}`);

  const rowsFile = flag('--rows-file');
  let rows;
  if (rowsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --rows-file is set. This must NEVER appear in a real ops-watch log.');
    try {
      rows = JSON.parse(readFileSync(rowsFile, 'utf8'));
    } catch (e) {
      throw new CouldNotLook(`could not read fixture ${rowsFile}: ${e.message}`);
    }
  } else {
    rows = await queryD1(watched.databaseId, job);
  }

  const verdict = judge(rows, nowMs);
  console.log(
    `⬜  judging job \`${job}\`, target \`${PORTFOLIO_TARGET}\`, from ${Array.isArray(rows) ? rows.length : 0} row(s) — [pipeline 11]E-13`,
  );
  // Routed through the ONE exit-2 path rather than printed here, so "I could not
  // look" always carries the same banner however it was reached.
  if (verdict.code === 2) throw new CouldNotLook(`${verdict.kind} — ${verdict.lines.join(' ')}`);
  const mark = verdict.code === 0 ? 'ok ' : '✗  ';
  const sink = verdict.code === 0 ? console.log : console.error;
  for (const l of verdict.lines) sink(`${mark} ${l}`);
  if (verdict.code === 1) {
    console.error('');
    console.error('    Exit 1. This reader runs on GitHub Actions ON PURPOSE — a different provider from the');
    console.error('    Cloudflare cron whose output it judges, so it survives the outage it is meant to report.');
  }
  process.exitCode = verdict.code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (e) {
    if (e instanceof CouldNotLook) {
      console.error(`✗ COULD NOT LOOK — ${e.message}`);
      console.error('');
      console.error('  This is exit 2, not exit 1, and the difference is the whole point: "I could not look" must');
      console.error('  never read as "I looked and it was fine". An empty events table already looks exactly like a');
      console.error('  quiet week; an unread one must not look like either.');
      process.exitCode = 2;
    } else {
      console.error(`✗ ${e.stack ?? e.message}`);
      process.exitCode = 2;
    }
  }
}
