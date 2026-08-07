// ─────────────────────────────────────────────────────────────────────────────
// runner-budget.test.mjs — assert-runner-budget.mjs must be able to FAIL.
//
// [pipeline F-10] every guard carries a recorded failing case. For this one the
// failing case is not hypothetical and is not invented: the fixture in
// `LIVE_LEDGER` below is the REAL response this account's billing endpoint
// returned on 2026-08-08, trimmed to the fields the guard reads. Its July 2026
// period carries $106.12 of net-billed Actions usage — $12.36 of it attributed
// to THIS repository, at zero discount — so the over-ceiling case is exercised
// against a month that actually happened rather than against numbers chosen to
// make the assertion fire.
//
// ⚠️ THE TWO THINGS ONLY A LIVE READ COULD HAVE TAUGHT, both encoded here:
//   · the older `/settings/billing/actions` endpoint answers 410 Gone, so a
//     guard written from memory would have failed closed forever;
//   · the unfiltered usage report is the YEAR TO DATE, not the current month, so
//     a zero-net ceiling applied to the whole payload fails on any account that
//     has ever paid for anything. Hence the grouping by billing period, and
//     hence the `--now` flag: the period under test has to be selectable or the
//     decision cannot be exercised at all.
//
// Every case runs the real guard as a child process with a fixture file, so the
// argument handling, the exit codes and the decision are all exercised with no
// stubbing and no network.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { evaluateUsage, billingPeriod, CouldNotLook } from '../assert-runner-budget.mjs';

const GUARD = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assert-runner-budget.mjs');

const EXIT_OK = 0;
const EXIT_OVER_CEILING = 1;
const EXIT_COULD_NOT_LOOK = 2;

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-budget-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Write a fixture and hand back its path. Raw strings allowed, so "not JSON at
 *  all" is a case that can be written. */
function fixture(body) {
  const p = join(TMP, `usage${seq++}.json`);
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return p;
}

/** Run the guard with NO billing credential in the environment unless a case
 *  supplies one. A developer's shell (and a CI runner) both carry GITHUB_TOKEN,
 *  and inheriting it would silently turn the no-credential cases into network
 *  calls — a test that passes for a reason it does not state. */
function run(args, env = {}) {
  const clean = { ...process.env };
  delete clean.GH_BILLING_TOKEN;
  delete clean.GITHUB_TOKEN;
  delete clean.GH_TOKEN;
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', env: { ...clean, ...env } });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ── the real ledger, trimmed to the fields the guard reads ───────────────────
// Captured 2026-08-08 from GET /users/globalonlinedeveloper/settings/billing/usage.
const row = (date, sku, unitType, quantity, gross, discount, net, repositoryName = '') => ({
  date,
  product: 'actions',
  sku,
  quantity,
  unitType,
  pricePerUnit: quantity === 0 ? 0 : gross / quantity,
  grossAmount: gross,
  discountAmount: discount,
  netAmount: net,
  repositoryName,
});

const LIVE_LEDGER = {
  usageItems: [
    row('2026-04-01T00:00:00Z', 'Actions Linux', 'Minutes', 2105, 12.63, 12.63, 0),
    row('2026-04-01T00:00:00Z', 'Actions storage', 'GigabyteHours', 0.221199968, 0.000074324, 0.000074324, 0),
    row('2026-05-01T00:00:00Z', 'Actions Linux', 'Minutes', 450, 2.7, 2.7, 0, 'pdfcraftai'),
    row('2026-06-01T00:00:00Z', 'Actions Linux', 'Minutes', 9434, 56.604, 56.604, 0, 'pdfcraftai'),
    row('2026-06-01T00:00:00Z', 'Actions Windows', 'Minutes', 800, 8, 8, 0, 'ratel'),
    row('2026-06-01T00:00:00Z', 'Actions macOS 3-core', 'Minutes', 1861, 115.382, 115.382, 0, 'ratel'),
    // 🔴 THE ROW THIS GUARD EXISTS FOR. Zero discount, $12.36 net, THIS repository.
    row('2026-07-01T00:00:00Z', 'Actions Linux', 'Minutes', 13008, 78.048, 0, 78.048, 'pdfcraftai'),
    row('2026-07-01T00:00:00Z', 'Actions Windows', 'Minutes', 1236, 12.36, 0, 12.36, 'Project_Cross_Platform_Apps'),
    row('2026-07-01T00:00:00Z', 'Actions macOS 3-core', 'Minutes', 325, 20.15, 20.15, 0, 'Project_Cross_Platform_Apps'),
    row('2026-07-01T00:00:00Z', 'Actions storage', 'GigabyteHours', 46770.334186938, 15.715765916, 0, 15.715765916, 'ratel'),
    row('2026-08-01T00:00:00Z', 'Actions Linux', 'Minutes', 10469, 62.814, 62.814, 0, 'Project_Cross_Platform_Apps'),
    row('2026-08-01T00:00:00Z', 'Actions Windows', 'Minutes', 49, 0.49, 0.49, 0, 'Project_Cross_Platform_Apps'),
    row('2026-08-01T00:00:00Z', 'Actions macOS 3-core', 'Minutes', 49, 3.038, 3.038, 0, 'Project_Cross_Platform_Apps'),
    row('2026-08-01T00:00:00Z', 'Actions storage', 'GigabyteHours', 12944.910612203, 4.349748492, 4.349748492, 0, 'Project_Cross_Platform_Apps'),
  ],
};

const AUG = '2026-08-08T12:00:00Z';
const JUL = '2026-07-15T12:00:00Z';

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-runner-budget — consumption under the ceiling', () => {
  test('PASSES the fully-discounted current period, and PRINTS what was consumed', () => {
    const { code, out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', AUG]);
    assert.equal(code, EXIT_OK, out);
    assert.match(out, /billing period 2026-08/);
    assert.match(out, /NET \$0\.00 \(ceiling \$0\.00\)/);
    assert.match(out, /10,567 minute\(s\)/); // 10469 + 49 + 49, storage excluded
    assert.match(out, /runner budget — 14 ledger row\(s\) read/);
  });

  // A month whose net is a rounding artefact of the ledger's own arithmetic must
  // not fail. An assertion that fires on correct input is worse than none — this
  // repository has already rejected its own 129-character fixture against a
  // made-up limit, and the same rule applies to a float.
  test('PASSES a net that is a rounding artefact rather than a charge', () => {
    const { code, out } = run([
      '--usage-file',
      fixture({ usageItems: [row('2026-08-01T00:00:00Z', 'Actions storage', 'GigabyteHours', 0.22, 0.000074324, 0, 0.000074324)] }),
      '--now',
      AUG,
    ]);
    assert.equal(code, EXIT_OK, out);
  });

  // Minutes and money are different questions and the guard must not conflate
  // them: five figures of minutes at a 100% discount is the NORMAL state here.
  test('does not fail on large minute counts while the discount holds', () => {
    const { code } = run([
      '--usage-file',
      fixture({ usageItems: [row('2026-08-01T00:00:00Z', 'Actions Linux', 'Minutes', 99999, 599.99, 599.99, 0, 'Project_Cross_Platform_Apps')] }),
      '--now',
      AUG,
    ]);
    assert.equal(code, EXIT_OK);
  });

  // The evidence limb. A check that only ever looks at today cannot show that
  // the ceiling it enforces has already been crossed once.
  test('PRINTS a prior period that WAS billed, with its figures and repositories', () => {
    const { out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', AUG]);
    assert.match(out, /PRIOR PERIOD BILLED: 2026-07 — NET \$106\.12/);
    assert.match(out, /Project_Cross_Platform_Apps \$12\.36/);
  });
});

describe('assert-runner-budget — over the declared ceiling', () => {
  // 🔴 THE RECORDED FAILING CASE, AND IT IS A REAL MONTH. July 2026 billed
  // $106.12 of Actions usage on this account, $12.36 of it on this repository at
  // zero discount, while nothing in the tree was reading the ledger at all.
  test('FAILS the period in which this account was actually billed', () => {
    const { code, out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', JUL]);
    assert.equal(code, EXIT_OVER_CEILING, out);
    assert.match(out, /billing period 2026-07 is NET \$106\.12 .* over the declared ceiling \$0\.00/);
    assert.match(out, /a spending limit can stop runs from STARTING/);
  });

  // The failure names the three assumptions rather than the number, because
  // "raise the ceiling" is the wrong first move and a guard whose fix is not
  // obvious is a guard people disable.
  test('the failure names WHICH assumption to check before raising anything', () => {
    const { out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', JUL]);
    assert.match(out, /did the repository go private\?/);
    assert.match(out, /larger runner class/);
    assert.match(out, /exhaust the shared allowance/);
  });
});

describe('assert-runner-budget — it fails CLOSED, never silently', () => {
  test('exit 2 on a fixture that is not JSON at all', () => {
    const { code, out } = run(['--usage-file', fixture('not json {'), '--now', AUG]);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
    assert.match(out, /could not read usage fixture/);
  });

  test('exit 2 on a fixture path that does not exist', () => {
    const { code, out } = run(['--usage-file', join(TMP, 'absent.json'), '--now', AUG]);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
  });

  // The shape change that would otherwise read as zero spend — the most
  // reassuring possible output for the state where nothing is being read.
  test('exit 2 when `usageItems` is missing', () => {
    const { code, out } = run(['--usage-file', fixture({ total: 0 }), '--now', AUG]);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
    assert.match(out, /`usageItems` is missing or is not an array/);
  });

  test('exit 2 when `usageItems` is not an array', () => {
    const { code } = run(['--usage-file', fixture({ usageItems: { total: 0 } }), '--now', AUG]);
    assert.equal(code, EXIT_COULD_NOT_LOOK);
  });

  // COVERAGE LOST: rows present, none of them Actions. The filter has stopped
  // matching and every total would be a confident zero.
  test('exit 2 and COVERAGE LOST when no row carries product "actions"', () => {
    const { code, out } = run([
      '--usage-file',
      fixture({ usageItems: [{ ...row('2026-08-01T00:00:00Z', 'Copilot', 'Users', 1, 10, 0, 10), product: 'copilot' }] }),
      '--now',
      AUG,
    ]);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE has product "actions"/);
  });

  // A row that cannot be added up must STOP the count. Skipping it lowers every
  // total silently, in the direction that passes.
  test('exit 2 on a non-numeric amount rather than skipping the row', () => {
    const bad = row('2026-08-01T00:00:00Z', 'Actions Linux', 'Minutes', 10, 1, 1, 0);
    bad.netAmount = 'free';
    const { code, out } = run(['--usage-file', fixture({ usageItems: [bad] }), '--now', AUG]);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
    assert.match(out, /non-numeric `netAmount`/);
  });

  test('exit 2 on a row with no readable date', () => {
    const bad = row('2026-08-01T00:00:00Z', 'Actions Linux', 'Minutes', 10, 1, 1, 0);
    delete bad.date;
    const { code, out } = run(['--usage-file', fixture({ usageItems: [bad] }), '--now', AUG]);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
    assert.match(out, /no readable `date`/);
  });

  test('exit 2 on an unparseable --now', () => {
    const { code, out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', 'last tuesday']);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
    assert.match(out, /--now is not a parseable date/);
  });

  // An empty ledger is a legitimate answer (a new account, a quiet year) and
  // must NOT be COVERAGE LOST — the marker fires on rows present and none
  // matching, which is a different thing. An assertion that cannot tell those
  // two apart would fire on correct input.
  test('an EMPTY ledger passes rather than being read as a broken filter', () => {
    const { code, out } = run(['--usage-file', fixture({ usageItems: [] }), '--now', AUG]);
    assert.equal(code, EXIT_OK, out);
    assert.doesNotMatch(out, /COVERAGE LOST/);
  });
});

describe('assert-runner-budget — the dated tripwire on the missing credential', () => {
  // Modelled on assert-platform-proof-fresh.mjs's SCHEDULE_PROOF_DEADLINE: a
  // state that is NOT YET PROVEN rather than broken, which resolves itself once
  // the owner does one thing. Printed until the deadline, failed closed after.
  test('PRINTS and exits 0 before the deadline when no token exists', () => {
    const { code, out } = run(['--now', '2026-08-08T12:00:00Z']);
    assert.equal(code, EXIT_OK, out);
    assert.match(out, /runner budget UNREAD/);
    assert.match(out, /OWNER ACTION — add GH_BILLING_TOKEN/);
    assert.match(out, /becomes a hard failure \(exit 2\) on 2026-09-08/);
  });

  test('FAILS CLOSED with exit 2 once the deadline has passed', () => {
    const { code, out } = run(['--now', '2026-09-09T00:00:00Z']);
    assert.equal(code, EXIT_COULD_NOT_LOOK, out);
    assert.match(out, /The deadline \(2026-09-08\) has passed/);
    assert.match(out, /unanswered rather than merely young/);
  });

  // The tripwire must not swallow a real read. A fixture is a read.
  test('the tripwire does not fire when a ledger was actually read', () => {
    const { code, out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', '2026-09-09T00:00:00Z']);
    assert.equal(code, EXIT_OK, out);
    assert.doesNotMatch(out, /runner budget UNREAD/);
  });
});

describe('assert-runner-budget — repository visibility is enrichment, not a gate', () => {
  test('PRINTS loudly when the repository is private', () => {
    const repoFile = join(TMP, `repo${seq++}.json`);
    writeFileSync(repoFile, JSON.stringify({ private: true, visibility: 'private' }));
    const { code, out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', AUG, '--repo-file', repoFile]);
    assert.equal(code, EXIT_OK, out);
    assert.match(out, /IS PRIVATE \(private\)/);
    assert.match(out, /free-minutes allowance is now load-bearing/);
  });

  test('says nothing extra when the repository is public', () => {
    const repoFile = join(TMP, `repo${seq++}.json`);
    writeFileSync(repoFile, JSON.stringify({ private: false, visibility: 'public' }));
    const { code, out } = run(['--usage-file', fixture(LIVE_LEDGER), '--now', AUG, '--repo-file', repoFile]);
    assert.equal(code, EXIT_OK, out);
    assert.doesNotMatch(out, /IS PRIVATE/);
  });
});

describe('assert-runner-budget — the pure halves', () => {
  // The ledger stamps every row at the first of its month in UTC. Deriving the
  // current period in local time would read the previous month as current for
  // anyone east of UTC — which is this owner (IST, +5:30), on every run in the
  // first five and a half hours of a month.
  test('billingPeriod is computed in UTC, not local time', () => {
    assert.equal(billingPeriod(Date.parse('2026-08-01T00:00:00Z')), '2026-08');
    assert.equal(billingPeriod(Date.parse('2026-07-31T23:59:59Z')), '2026-07');
    assert.equal(billingPeriod(Date.parse('2026-01-01T00:00:00Z')), '2026-01');
  });

  test('evaluateUsage separates the current period from the prior ones', () => {
    const v = evaluateUsage(LIVE_LEDGER, Date.parse(AUG));
    assert.equal(v.period, '2026-08');
    assert.equal(v.over, false);
    assert.deepEqual(v.prior.map((p) => p.period), ['2026-04', '2026-05', '2026-06', '2026-07']);
    assert.deepEqual(v.priorBilled.map((p) => p.period), ['2026-07']);
  });

  test('evaluateUsage throws CouldNotLook rather than returning a zero', () => {
    assert.throws(() => evaluateUsage(null, Date.parse(AUG)), CouldNotLook);
    assert.throws(() => evaluateUsage({}, Date.parse(AUG)), CouldNotLook);
  });

  // The ceiling is a parameter of the decision, so raising it is a real change
  // with a visible effect — the property that proves the constant is connected
  // to something, in the same shape as REQUIRED_COVERAGE elsewhere in this tree.
  test('raising the ceiling changes the verdict, so the constant is load-bearing', () => {
    assert.equal(evaluateUsage(LIVE_LEDGER, Date.parse(JUL), 0).over, true);
    assert.equal(evaluateUsage(LIVE_LEDGER, Date.parse(JUL), 200).over, false);
  });
});
