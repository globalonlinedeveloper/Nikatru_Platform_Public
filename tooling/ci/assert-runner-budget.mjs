#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-runner-budget.mjs — how much Actions capacity this account is actually
// CONSUMING, read from GitHub's own billing ledger, with a declared ceiling.
//
// 🔴 WHY THIS EXISTS, AND IT IS NOT A COST GUARD. QUOTA EXHAUSTION IS ONE OF THE
// WAYS A SCHEDULED WORKFLOW TURNS OFF SILENTLY. When an account passes its
// spending limit GitHub stops starting Actions runs; the workflow file is
// unchanged, the cron entry is unchanged, `gh run list` returns nothing, and
// nothing anywhere goes red — a stopped timer is indistinguishable from a quiet
// fortnight. assert-platform-proof-fresh.mjs's own header names the failure
// ("a schedule can quietly stop … a quota change does the same") and then
// detects it the only way an age check can: FOURTEEN DAYS LATE, by which point
// the six-platform proof, the nightly e2e proof and the whole ops-watch alarm
// chain have all been dark for two weeks. This reads the CAUSE, not the symptom.
//
// The two guards are complements, not duplicates. Freshness answers "did the
// proof run?"; this answers "can it still run tomorrow?". Only one of them can
// be checked before the thing has already failed.
//
// ── THE CEILING, AND WHY IT IS ZERO ──────────────────────────────────────────
//
// GitHub does not bill standard runners on PUBLIC repositories, on any plan.
// The billing ledger records that as a 100% DISCOUNT rather than as zero usage:
// August 2026 for this repository shows 10,469 Linux minutes with grossAmount
// 62.814 and discountAmount 62.814, netAmount 0. So the number that says whether
// quota can ever shut this factory off is NET BILLED, not minutes — minutes are
// already in five figures and mean nothing while the discount holds.
//
// A ceiling of zero is therefore a tripwire on the ASSUMPTION, not a budget:
//   · the repository goes PRIVATE (minutes start drawing on the 2,000/month free
//     allowance, with the ×2 Windows and ×10 macOS multipliers this factory's
//     six-platform proof uses heavily), or
//   · a lane moves to a larger or GPU runner class, which bills on public repos
//     too, or
//   · another repository on the SAME ACCOUNT exhausts the shared allowance —
//     the account is the billing subject, not the repository.
//
// 🔴 AND IT IS NOT HYPOTHETICAL. Read live on 2026-08-08 from the account that
// owns this repository:
//     2026-07 | actions | Actions Windows | 1236 Minutes
//             | gross 12.36 | discount 0 | NET 12.36 | repo Project_Cross_Platform_Apps
// A month in which THIS repository's Windows runner minutes were billed in full,
// with no discount applied, while every other line that month for the same
// repository was fully discounted. Nothing in the tree noticed, because nothing
// in the tree had ever read this ledger. That single row is why the ceiling here
// is a real check and not a formality — and why prior periods are PRINTED with
// their figures rather than dropped by a check that only ever looks at today.
//
// ── WHAT IS READ, AND FROM WHERE ─────────────────────────────────────────────
//
//   GET /users/{owner}/settings/billing/usage      (falls back to
//   GET /organizations/{owner}/settings/billing/usage on 404)
//
// ⚠️ THE OLDER ENDPOINT IS GONE. `/users/{owner}/settings/billing/actions` —
// the one that returned `total_minutes_used` / `included_minutes`, and the one
// almost every example still shows — answers **410 Gone**, "This endpoint has
// been moved.", verified against this account on 2026-08-08. A guard written
// from memory would have shipped pointing at it and failed closed forever, which
// is indistinguishable from a real quota problem.
//
// ⚠️ THE UNFILTERED RESPONSE IS THE YEAR TO DATE, NOT THE MONTH, and that is the
// second thing only a live read tells you. Applying a zero-net ceiling to it
// fails immediately on any account that has ever paid for anything: this one
// shows $78.05 + $15.72 + $12.36 of net-billed Actions usage across April-August
// 2026. So the ledger is GROUPED BY MONTH and the ceiling is applied to the
// CURRENT billing period — the only period in which spending can still be
// stopped — while every earlier period with a non-zero net is printed as the
// evidence that the ceiling is not theoretical.
//
// ── EXIT CODES: THREE-VALUED, THE SAME SHAPE ops-watch.yml ALREADY READS ─────
//   0 · the current billing period's net-billed Actions spend is at or under the
//       declared ceiling. (Or: no credential yet, and the dated tripwire below
//       has not expired.)
//   1 · it is OVER. Quota is being consumed in a way that can stop this account's
//       runs, and the scheduled proofs go with them.
//   2 · IT COULD NOT LOOK — no credential past the deadline, a non-200, an
//       unreadable body, a ledger with no Actions rows in it. "I could not tell"
//       must never read as "it is fine"; that is exactly how every claim this
//       repository has had to repair became unfalsifiable.
//
// ── THE DATED TRIPWIRE ───────────────────────────────────────────────────────
// Modelled on assert-platform-proof-fresh.mjs's SCHEDULE_PROOF_DEADLINE, and for
// the identical situation: a state that is NOT YET PROVEN rather than broken, and
// that resolves itself once an owner does one thing. Reading this ledger needs a
// credential with billing scope, and no such secret exists in this repository
// today (see the note on GITHUB_TOKEN below). Failing on day one would file an
// ops-watch issue nobody can close; printing forever would make the gap
// permanent. So it PRINTS loudly until the deadline and then FAILS CLOSED.
//
// 🔴 GITHUB_TOKEN IS ALMOST CERTAINLY NOT ENOUGH, AND THIS IS RECORDED AS
// UNVERIFIED RATHER THAN ASSERTED. The billing endpoints are account-scoped, not
// repository-scoped: the classic PAT that answered 200 above carries `user`, and
// a fine-grained token needs the account-level "Plan" read permission. A
// workflow's `GITHUB_TOKEN` is an installation token scoped to ONE REPOSITORY
// and `actions: read` is a repository permission, so it has no account-level
// billing dimension to grant. That reasoning was not confirmed against a real
// GITHUB_TOKEN — no such token can be minted locally — so the guard does not
// depend on the answer: it tries whatever token it is given, and a 403 or 404
// from a token that exists is exit 2 with a message naming the owner action.
// Whoever wires this will find out on the first run, which is the honest place
// to find out.
//
// Usage:
//   node tooling/ci/assert-runner-budget.mjs
//   node tooling/ci/assert-runner-budget.mjs --usage-file fixture.json [--now <iso>]
//   node tooling/ci/assert-runner-budget.mjs --repo owner/name --repo-file f.json
//
// Env: GH_BILLING_TOKEN (preferred) or GITHUB_TOKEN / GH_TOKEN
//      GITHUB_REPOSITORY (owner/name; defaults to this repository)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── THE DECLARED CEILING ─────────────────────────────────────────────────────
// USD of NET-BILLED `product: "actions"` usage in the CURRENT billing period,
// account-wide. Zero, because standard runners on a public repository are not
// billed — the ledger records a 100% discount, so any net at all means the
// public-repo assumption has stopped holding (see the header for the three ways
// that happens, and for the July 2026 row where it already did).
//
// It is a TRIPWIRE ON AN ASSUMPTION, not a budget. Raising it is a decision that
// this factory now pays for CI, and it should be made in a diff that says so.
const CURRENT_PERIOD_NET_BILLED_CEILING_USD = 0;

// Floating point: the ledger's own arithmetic produces values like 0.000074324,
// and gross minus discount will not always land on an exact zero. One cent is
// below any real charge and above any rounding artefact.
const CEILING_EPSILON_USD = 0.01;

// The dated tripwire. ARBITRARY and recorded as arbitrary: one month from the
// day this guard was written, which is long enough for the owner to create a
// billing-scoped secret and short enough that the gap cannot become furniture.
// Before it, no credential PRINTS and exits 0. After it, no credential is exit 2.
const BUDGET_READ_DEADLINE = Date.parse('2026-09-08T00:00:00Z');

const DEFAULT_REPO = 'globalonlinedeveloper/Nikatru_Android_Apps_Public';
const PRODUCT = 'actions';

const EXIT_OK = 0;
const EXIT_OVER_CEILING = 1;
const EXIT_COULD_NOT_LOOK = 2;

// `indexOf` returns -1 when absent, and -1 + 1 === 0 silently selects argv[0].
// That exact off-by-one shipped in assert-gate-passed.mjs and blocked both
// production deploys with the SHA plainly in the command line. Never repeat it.
function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

const say = (m) => console.log(m);
const gap = (m) => console.log(`⬜  ${m}`);
const usd = (n) => `$${n.toFixed(2)}`;

/** The one shape of "I could not look". Never 0, never 1. */
export class CouldNotLook extends Error {}

/** `YYYY-MM` of an instant, in UTC. The ledger stamps every row at the first of
 *  its month in UTC, so the comparison has to be made in the same zone or a
 *  run in the first hours of a month reads the previous one as current. */
export function billingPeriod(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The decision, kept pure so every branch is exercisable without a network.
 * This is where the real defects live; the fetch is the boring half.
 *
 * Throws CouldNotLook for anything unreadable — a ledger that cannot be parsed
 * is not a ledger showing zero.
 */
export function evaluateUsage(body, nowMs, ceilingUsd = CURRENT_PERIOD_NET_BILLED_CEILING_USD) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new CouldNotLook('the usage report is not a JSON object');
  }
  const items = body.usageItems;
  if (!Array.isArray(items)) {
    throw new CouldNotLook(
      '`usageItems` is missing or is not an array. The billing report changed shape, and a reader that ' +
        'shrugged at that would sum an empty list and report zero spend — the most reassuring possible ' +
        'output for the state where nothing is being read at all',
    );
  }

  const actions = items.filter((i) => i !== null && typeof i === 'object' && i.product === PRODUCT);
  // COVERAGE LOST: a non-empty ledger with no `product: "actions"` row in it
  // means the product key was renamed or the filter has stopped matching, and
  // every total below would be a confident zero.
  if (items.length > 0 && actions.length === 0) {
    throw new CouldNotLook(
      `the usage report carries ${items.length} row(s) and NOT ONE has product "${PRODUCT}" ` +
        `(seen: ${[...new Set(items.map((i) => i?.product))].join(', ') || 'nothing'}). ` +
        'COVERAGE LOST — the filter has stopped matching, so every total below would be zero for the ' +
        'wrong reason, which is the one failure this whole guard family exists to remove',
    );
  }

  const periods = new Map();
  for (const it of actions) {
    if (typeof it.date !== 'string' || it.date.length < 7) {
      throw new CouldNotLook(`a usage row carries no readable \`date\` (${JSON.stringify(it.date)})`);
    }
    for (const k of ['quantity', 'grossAmount', 'discountAmount', 'netAmount']) {
      if (typeof it[k] !== 'number' || !Number.isFinite(it[k])) {
        throw new CouldNotLook(
          `a usage row dated ${it.date} carries a non-numeric \`${k}\` (${JSON.stringify(it[k])}). ` +
            'A row that cannot be added up must stop the count, never be skipped: skipping it lowers ' +
            'every total silently, in the direction that passes',
        );
      }
    }
    const p = it.date.slice(0, 7);
    if (!periods.has(p)) periods.set(p, { period: p, net: 0, gross: 0, discount: 0, minutes: 0, byRepo: new Map() });
    const acc = periods.get(p);
    acc.net += it.netAmount;
    acc.gross += it.grossAmount;
    acc.discount += it.discountAmount;
    if (it.unitType === 'Minutes') acc.minutes += it.quantity;
    const repo = typeof it.repositoryName === 'string' && it.repositoryName !== '' ? it.repositoryName : '(account-level)';
    if (!acc.byRepo.has(repo)) acc.byRepo.set(repo, { net: 0, minutes: 0 });
    const r = acc.byRepo.get(repo);
    r.net += it.netAmount;
    if (it.unitType === 'Minutes') r.minutes += it.quantity;
  }

  const period = billingPeriod(nowMs);
  const current = periods.get(period) ?? { period, net: 0, gross: 0, discount: 0, minutes: 0, byRepo: new Map() };
  const prior = [...periods.values()].filter((p) => p.period !== period).sort((a, b) => a.period.localeCompare(b.period));

  return {
    period,
    current,
    prior,
    priorBilled: prior.filter((p) => p.net > CEILING_EPSILON_USD),
    ceilingUsd,
    over: current.net > ceilingUsd + CEILING_EPSILON_USD,
    rowsRead: actions.length,
  };
}

// ── the network halves, each isolated so the decision above stays pure ───────

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'nikatru-ci',
  };
}

/**
 * The account's Actions ledger. USER endpoint first, ORGANIZATION on a 404 —
 * tried rather than declared, because "which kind of account owns this repo" is
 * a fact the API already knows and a constant in here would be a second
 * declaration of it, and the first to drift.
 *
 * ⚠️ NOT `/users/{owner}/settings/billing/actions`. That endpoint answers 410
 * Gone ("This endpoint has been moved."), verified 2026-08-08.
 */
async function fetchUsage(owner, token) {
  const attempts = [
    `https://api.github.com/users/${owner}/settings/billing/usage`,
    `https://api.github.com/organizations/${owner}/settings/billing/usage`,
  ];
  let last = null;
  for (const url of attempts) {
    let res;
    try {
      res = await fetch(url, { headers: authHeaders(token) });
    } catch (e) {
      throw new CouldNotLook(`${url} could not be reached (${e.message})`);
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch (e) {
        throw new CouldNotLook(`${url} answered 200 with a body that is not JSON (${e.message})`);
      }
    }
    last = `${res.status} from ${url}`;
    if (res.status === 404) continue; // wrong account kind — try the other one
    if (res.status === 403) {
      throw new CouldNotLook(
        `${last} — the token exists and is NOT permitted to read billing. The billing endpoints are ` +
          'ACCOUNT-scoped: a repository-scoped GITHUB_TOKEN with `actions: read` has no account-level ' +
          'plan dimension to grant, whatever repository permissions it carries. OWNER ACTION — create a ' +
          'GH_BILLING_TOKEN repository secret from a token with billing read (classic: `user`; ' +
          'fine-grained: account permission "Plan" → read).',
      );
    }
    throw new CouldNotLook(last);
  }
  throw new CouldNotLook(
    `${last} — neither the user nor the organization billing endpoint answered for "${owner}". ` +
      'A 404 from BOTH is usually a token without billing read rather than a missing account, because ' +
      'GitHub returns 404 rather than 403 for resources a token may not even know exist.',
  );
}

/** Repository visibility — the single fact that decides whether the free-minutes
 *  allowance is load-bearing. Enrichment, never a gate: a failure here PRINTS as
 *  could-not-establish, because the subject of this guard is the ledger. */
async function fetchVisibility(repo, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`${res.status}`);
  const body = await res.json();
  return { private: body.private === true, visibility: body.visibility ?? (body.private ? 'private' : 'public') };
}

function readFixture(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new CouldNotLook(`could not read ${what} fixture ${path}: ${e.message}`);
  }
}

async function main() {
  const usageFile = flag('--usage-file');
  const repoFile = flag('--repo-file');
  const nowFlag = flag('--now');
  const repo = flag('--repo') ?? (process.env.GITHUB_REPOSITORY || DEFAULT_REPO);
  const owner = repo.split('/')[0];

  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    console.error(`FAIL  --now is not a parseable date: ${nowFlag}`);
    return EXIT_COULD_NOT_LOOK;
  }

  const token = process.env.GH_BILLING_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

  let body;
  if (usageFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --usage-file is set. This must NEVER appear in a real CI log.');
    try {
      body = readFixture(usageFile, 'usage');
    } catch (e) {
      console.error(`FAIL  ${e.message}`);
      return EXIT_COULD_NOT_LOOK;
    }
  } else if (token === null) {
    // ── the dated tripwire ──────────────────────────────────────────────────
    // NOT PROVEN rather than broken, and it resolves itself the day the owner
    // adds the secret. Printed until the deadline, then failed closed. A gap
    // that only ever prints is one nobody closes.
    const past = nowMs >= BUDGET_READ_DEADLINE;
    const line = past ? (m) => console.error(`FAIL  ${m}`) : gap;
    line('runner budget UNREAD — no GH_BILLING_TOKEN / GITHUB_TOKEN / GH_TOKEN in the environment.');
    console[past ? 'error' : 'log'](
      past
        ? '      The deadline (2026-09-08) has passed and this duty has still never run, so the quota\n' +
            '      question is unanswered rather than merely young. OWNER ACTION — create a GH_BILLING_TOKEN\n' +
            '      repository secret from a token with billing read (classic: `user`; fine-grained: account\n' +
            '      permission "Plan" → read). Until then, an account that stops starting runs looks exactly\n' +
            '      like a quiet fortnight, and assert-platform-proof-fresh.mjs notices 14 days later.'
        : '      This is the OWNER-GATED half and it prints rather than failing, per [pipeline C-6].\n' +
            '      It becomes a hard failure (exit 2) on 2026-09-08 if no billing-scoped token exists by then.\n' +
            '      OWNER ACTION — add GH_BILLING_TOKEN (classic PAT with `user`, or fine-grained with the\n' +
            '      account-level "Plan" read permission). GITHUB_TOKEN is repository-scoped and is not\n' +
            '      expected to carry a billing dimension; the first real run is what settles that.',
    );
    return past ? EXIT_COULD_NOT_LOOK : EXIT_OK;
  } else {
    try {
      body = await fetchUsage(owner, token);
    } catch (e) {
      console.error(`FAIL  could not read the Actions usage ledger — ${e.message}`);
      console.error('      Exit 2, deliberately: "I could not look" must never read as "I looked and it was fine".');
      return EXIT_COULD_NOT_LOOK;
    }
  }

  let verdict;
  try {
    verdict = evaluateUsage(body, nowMs);
  } catch (e) {
    if (!(e instanceof CouldNotLook)) throw e;
    console.error(`FAIL  the Actions usage ledger could not be counted — ${e.message}`);
    return EXIT_COULD_NOT_LOOK;
  }

  // ── consumption, printed on every run ───────────────────────────────────────
  const c = verdict.current;
  say(
    `⬜  billing period ${verdict.period}: ${c.minutes.toLocaleString('en-US')} Actions minute(s), ` +
      `gross ${usd(c.gross)} − discount ${usd(c.discount)} = NET ${usd(c.net)} (ceiling ${usd(verdict.ceilingUsd)})`,
  );
  for (const [name, r] of [...c.byRepo.entries()].sort((a, b) => b[1].minutes - a[1].minutes)) {
    say(`      · ${name}: ${r.minutes.toLocaleString('en-US')} minute(s), net ${usd(r.net)}`);
  }

  // Prior periods that WERE billed. Printed with their figures rather than
  // dropped, because a check that only ever looks at today cannot show that the
  // ceiling it enforces has already been crossed once.
  for (const p of verdict.priorBilled) {
    const who = [...p.byRepo.entries()]
      .filter(([, r]) => r.net > CEILING_EPSILON_USD)
      .map(([n, r]) => `${n} ${usd(r.net)}`)
      .join(', ');
    gap(
      `PRIOR PERIOD BILLED: ${p.period} — NET ${usd(p.net)} of Actions usage was charged (${who || 'account-level'}). ` +
        'Not a failure now, and not decoration either: it is the evidence that "public repos are not ' +
        'billed" is an assumption about the present, not a property of the account.',
    );
  }

  // ── visibility, enrichment only ────────────────────────────────────────────
  let vis = null;
  if (repoFile) {
    try {
      vis = readFixture(repoFile, 'repository');
    } catch {
      vis = null;
    }
  } else if (token !== null && !usageFile) {
    try {
      vis = await fetchVisibility(repo, token);
    } catch (e) {
      gap(`COULD-NOT-ESTABLISH: ${repo}'s visibility was not readable (${e.message}). The ceiling still applies; only the explanation of WHY it holds is missing.`);
    }
  }
  if (vis !== null && vis.private === true) {
    gap(
      `${repo} IS PRIVATE (${vis.visibility}). The free-minutes allowance is now load-bearing: every ` +
        'minute draws on it, with the ×2 Windows and ×10 macOS multipliers this factory\'s six-platform ' +
        'proof spends most of its time in. This is the exact change the ceiling above exists to catch.',
    );
  }

  if (verdict.over) {
    console.error('');
    console.error(
      `FAIL  billing period ${verdict.period} is NET ${usd(c.net)} of Actions usage, over the declared ceiling ${usd(verdict.ceilingUsd)}.`,
    );
    console.error('      This account is now paying for CI, so a spending limit can stop runs from STARTING —');
    console.error('      and a workflow that never starts is indistinguishable from a healthy quiet one. Every');
    console.error('      scheduled proof in this repository (the 6-platform build, the nightly e2e, ops-watch)');
    console.error('      goes dark together, and the freshness guards notice up to 14 days later.');
    console.error('');
    console.error('      Establish WHICH of the three assumptions broke before raising anything:');
    console.error('        · did the repository go private?  · did a lane move to a larger runner class?');
    console.error('        · did another repository on this account exhaust the shared allowance?');
    console.error('      Raising CURRENT_PERIOD_NET_BILLED_CEILING_USD is a decision that this factory now pays');
    console.error('      for CI. Make it in a diff that says so.');
    return EXIT_OVER_CEILING;
  }

  say(
    `ok  runner budget — ${verdict.rowsRead} ledger row(s) read; period ${verdict.period} net ${usd(c.net)} ` +
      `is within the declared ceiling ${usd(verdict.ceilingUsd)}`,
  );
  return EXIT_OK;
}

// Only run when executed directly, so the pure halves can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
