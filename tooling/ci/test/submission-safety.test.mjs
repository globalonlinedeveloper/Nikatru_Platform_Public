// ─────────────────────────────────────────────────────────────────────────────
// submission-safety.test.mjs — assert-submission-safety.mjs must be able to FAIL.
//
// [pipeline 10]D-6. A strike attaches to the PUBLISHER, so a bad submission is
// charged to every app the factory ships (L21). That asymmetry is the whole
// requirement.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Four mutations against a full COPY of this
// repository, 2026-08-03, all four caught and restored byte-identically:
//
//   1. subly's `tagline` emptied ⇒ exit 1. Writable TODAY, because
//      `brick.yaml`'s `description` still defaults to "".
//   2. THE VACUOUS-AT-n=1 CASE: a SECOND catalogue entry whose tagline differs
//      only in case and punctuation ⇒ exit 1. `apps.json` has exactly one entry
//      today, so the duplicate limb compares ZERO pairs — which is why the
//      guard PRINTS the compared-pair count on every run.
//   3. the `tagline` key renamed to `description` — literally D-6's original
//      defect, which named a key `apps.json` does not have and so ranged over
//      nothing forever ⇒ exit 1 naming the APP fault. It reports "app X has an
//      empty tagline", NOT "the scan is broken": blaming the scanner for a
//      fault it correctly found is a real failure mode with its own record in
//      assert-app-versioning.mjs's test header.
//   4. `apps.json` emptied ⇒ COVERAGE LOST.
//
// A `resolvedTaglines === 0 ⇒ COVERAGE LOST` clause was written and DELETED:
// the loop either resolves a tagline or reports that app, so zero resolved
// always implies at least one problem and the branch was unreachable. It is
// re-pointed at an ACCOUNTING IDENTITY — every catalogue entry resolved or
// reported — which has a writable failing input.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-submission-safety.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-safety-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const REGISTER = {
  channels: [
    { id: 'web', kind: 'web', deploymentEnvironment: '{app}-web' },
    { id: 'windows-store', kind: 'store', deploymentEnvironment: '{app}-windows-store' },
  ],
};

const SUBLY = { slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' };

function fixture({ apps = [SUBLY], ledger = null } = {}) {
  const root = join(TMP, `f${seq++}`);
  const write = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write('sites/_shared/_data/apps.json', JSON.stringify(apps, null, 2));
  write('tooling/channel-register.json', JSON.stringify(REGISTER, null, 2));
  if (ledger !== null) write('ledger.json', JSON.stringify(ledger, null, 2));
  return root;
}

function run(root, args = []) {
  const r = spawnSync(process.execPath, [GUARD, root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-submission-safety — the tagline limb', () => {
  test('PASSES on the portfolio as it stands, and PRINTS the compared-pair count', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /TAGLINE PAIRS COMPARED: 0/);
    assert.match(out, /VACUOUS until app #2/);
  });

  test('FAILS on an empty tagline — writable today, brick.yaml defaults to ""', () => {
    const { code, out } = run(fixture({ apps: [{ ...SUBLY, tagline: '' }] }));
    assert.equal(code, 1);
    assert.match(out, /has an empty `tagline`/);
    // The rule cited must be 10.1.4, never 10.1.1 — 10.1.1 carries the
    // "unless the product is also published by you" carve-out, so it does not
    // bind our portfolio against itself.
    assert.match(out, /10\.1\.4/);
    assert.match(out, /NO carve-out/);
    assert.doesNotMatch(out, /10\.1\.1 requires/);
  });

  test('FAILS on a missing tagline key — D-6\'s original defect, reported as an APP fault', () => {
    const app = { ...SUBLY };
    delete app.tagline;
    const { code, out } = run(fixture({ apps: [app] }));
    assert.equal(code, 1);
    assert.match(out, /has an empty `tagline`/);
    assert.doesNotMatch(out, /scan is broken/);
  });

  // The case that stops being vacuous the day app #2 exists.
  test('FAILS on two apps whose taglines differ only in case and punctuation', () => {
    const { code, out } = run(
      fixture({ apps: [SUBLY, { ...SUBLY, slug: 'subly2', tagline: 'TRACK  EVERY  SUBSCRIPTION,  IN ONE PLACE!' }] }),
    );
    assert.equal(code, 1);
    assert.match(out, /share a tagline \(normalised: "track every subscription in one place"\)/);
    assert.match(out, /the penalty attaches to the PUBLISHER/);
  });

  test('two genuinely different taglines PASS, and the pair count is now non-zero', () => {
    const { code, out } = run(
      fixture({ apps: [SUBLY, { ...SUBLY, slug: 'drift', tagline: 'A metronome that keeps time by feel' }] }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /TAGLINE PAIRS COMPARED: 1/);
  });
});

describe('assert-submission-safety — the web-prove-first rule', () => {
  test('is NOT asked in the CI mode — a planned app must not fail every build', () => {
    const { code, out } = run(fixture({ apps: [{ ...SUBLY, status: 'planned' }] }));
    assert.equal(code, 0, out);
  });

  test('FAILS in --submitting mode when the app is not live', () => {
    const { code, out } = run(fixture({ apps: [{ ...SUBLY, status: 'planned' }] }), ['--submitting', '--app', 'subly']);
    assert.equal(code, 1);
    assert.match(out, /only "live" may be submitted to a store/);
    assert.match(out, /charged to all of them/);
  });

  test('PASSES in --submitting mode when the app IS live', () => {
    const { code, out } = run(fixture(), ['--submitting', '--app', 'subly']);
    assert.equal(code, 0, out);
    assert.match(out, /passed the web-prove-first rule/);
  });

  test('FAILS in --submitting mode for an app the catalogue does not list', () => {
    const { code, out } = run(fixture(), ['--submitting', '--app', 'ghost']);
    assert.equal(code, 1);
    assert.match(out, /is not in sites\/_shared\/_data\/apps\.json/);
  });

  test('COVERAGE LOST when --submitting is given with no --app', () => {
    const { code, out } = run(fixture(), ['--submitting']);
    assert.equal(code, 1);
    assert.match(out, /--submitting was given with no --app/);
  });
});

describe('assert-submission-safety — the cadence limb is OURS and says so', () => {
  test('with no ledger it PRINTS UNKNOWN, never zero, and labels the rule as ours', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /CADENCE UNREAD/);
    assert.match(out, /UNKNOWN, not zero/);
    /* The label was `MASTER_PLAN.md:277,:281` until 75374e4 repointed it at a
       SECTION instead of two line numbers — precisely because a line number is a
       pointer into a file other people edit, and nothing recomputes it. The guard
       moved; this assertion did not, and the suite has been red since. */
    assert.match(out, /NIKATRU cadence rule \(`MASTER_PLAN\.md` § 10, AUTO-MODE execution operating model\)/);
  });

  test('an EMPTY ledger prints zero with the reason — no account exists yet', () => {
    const { code, out } = run(fixture({ ledger: [] }), ['--ledger', 'ledger.json']);
    assert.equal(code, 0, out);
    assert.match(out, /CADENCE: 0 store submission\(s\) on record/);
    assert.match(out, /NIKATRU cadence rule/);
  });

  test('a ledger inside the cap PRINTS the count', () => {
    const ledger = [
      { environment: 'subly-windows-store', createdAt: '2026-08-03T00:00:00Z', description: 'nk1 state=live sha=abc12345 listing=https://a/x' },
    ];
    const { code, out } = run(fixture({ ledger }), ['--ledger', 'ledger.json']);
    assert.equal(code, 0, out);
    assert.match(out, /CADENCE 2026-08: 1\/2/);
  });

  // The limb becoming build-failing the moment a real ledger exists.
  test('FAILS over the cap, and names the rule as OURS rather than a store policy', () => {
    const at = (d) => ({ environment: 'subly-windows-store', createdAt: `2026-08-0${d}T00:00:00Z`, description: `nk1 state=live sha=abc1234${d} listing=https://a/x` });
    const { code, out } = run(fixture({ ledger: [at(1), at(2), at(3)] }), ['--ledger', 'ledger.json']);
    assert.equal(code, 1);
    assert.match(out, /3 store submission\(s\) recorded in 2026-08/);
    assert.match(out, /THIS IS OUR RULE, NOT A STORE POLICY/);
  });

  test('a web deploy in the ledger is not a submission and does not count', () => {
    const ledger = [
      { environment: 'subly-web', createdAt: '2026-08-01T00:00:00Z', description: 'nk1 state=live sha=abc12345' },
      { environment: 'subly-web', createdAt: '2026-08-02T00:00:00Z', description: 'nk1 state=live sha=abc12346' },
      { environment: 'subly-web', createdAt: '2026-08-03T00:00:00Z', description: 'nk1 state=live sha=abc12347' },
    ];
    const { code, out } = run(fixture({ ledger }), ['--ledger', 'ledger.json']);
    assert.equal(code, 0, out);
    assert.match(out, /CADENCE: 0 store submission/);
  });

  test('an UNREADABLE ledger row is printed, never silently dropped', () => {
    const ledger = [{ environment: 'subly-windows-store', createdAt: '2026-08-03T00:00:00Z', description: 'live at abc12345' }];
    const { code, out } = run(fixture({ ledger }), ['--ledger', 'ledger.json']);
    assert.equal(code, 0, out);
    assert.match(out, /LEDGER ROW UNREADABLE/);
  });

  test('COVERAGE LOST when the named ledger is not there', () => {
    const { code, out } = run(fixture(), ['--ledger', 'nope.json']);
    assert.equal(code, 1);
    assert.match(out, /a count of nothing reported as compliance/);
  });
});

describe('assert-submission-safety — coverage and the limb that only PRINTS', () => {
  test('COVERAGE LOST when the catalogue is empty', () => {
    const { code, out } = run(fixture({ apps: [] }));
    assert.equal(code, 1);
    assert.match(out, /lists no app/);
  });

  test('COVERAGE LOST when the catalogue is not there at all', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('the visual-identity limb PRINTS and does not pretend to check', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /VISUAL IDENTITY: NOT CHECKED, and deliberately not/);
    assert.match(out, /a guard that pretended to check it would always pass/);
  });
});
