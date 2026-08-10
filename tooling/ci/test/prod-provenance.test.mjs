// ─────────────────────────────────────────────────────────────────────────────
// prod-provenance.test.mjs — the negative cases for [pipeline B-17]'s two limbs:
// the GATE (tooling/ci/assert-prod-provenance.mjs), the MONITOR
// (tooling/ops/check-prod-provenance.mjs), and the enumeration both share
// (tooling/ci/migration-tables.mjs).
//
// 🔴 EVERY GATE CASE MUTATES A COPY OF THE REAL TREE, never a hand-built
// fixture. This repository has shipped a guard whose six fixture tests all
// passed against a broken version (`assert-seams-wired.mjs`): a fixture you
// write encodes the same misunderstanding as the guard you write. The copy below
// carries the real services/platform/migrations, the real registers and the real
// ops-watch.yml, so every mutation here is one somebody could make in a diff.
//
// The MONITOR cases run offline through `--rows-file` / `--runs-file`, because
// the one thing a test must not do is write to production — which is the very
// requirement under test. Its behaviour against REAL production data is recorded
// separately: on 2026-08-06 it read 25 rows across 9 tables, and bumping the
// release line in apps/subly/pubspec.yaml made it print the real
// `consent_artifacts` row as unattributable.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumerateMigrationTables, sqlLiteral } from '../migration-tables.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATE = join(REPO, 'tooling', 'ci', 'assert-prod-provenance.mjs');
const MONITOR = join(REPO, 'tooling', 'ops', 'check-prod-provenance.mjs');

const REGISTER = 'tooling/prod-provenance.json';
const MIGRATIONS = 'services/platform/migrations';
const OPS_WATCH = '.github/workflows/ops-watch.yml';

/** A real-tree copy carrying exactly what the gate reads. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-prod-provenance-'));
  mkdirSync(join(root, 'tooling', 'ops'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  cpSync(join(REPO, REGISTER), join(root, REGISTER));
  cpSync(join(REPO, OPS_WATCH), join(root, OPS_WATCH));
  cpSync(join(REPO, 'tooling', 'ops', 'check-prod-provenance.mjs'), join(root, 'tooling', 'ops', 'check-prod-provenance.mjs'));
  mkdirSync(join(root, MIGRATIONS), { recursive: true });
  cpSync(join(REPO, MIGRATIONS), join(root, MIGRATIONS), { recursive: true });
  return root;
}

const readRegister = (root) => JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
const writeRegister = (root, reg) => writeFileSync(join(root, REGISTER), JSON.stringify(reg, null, 2));

function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GATE, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── the enumeration both limbs share ────────────────────────────────────────
describe('migration-tables — the one reading of the schema', () => {
  const real = enumerateMigrationTables(join(REPO, MIGRATIONS));

  test('reads every migration file and finds more tables than B-17 prose names', () => {
    assert.ok(real.filesRead >= 6, `expected 6+ migration files, read ${real.filesRead}`);
    assert.ok(
      real.tables.size >= 9,
      `expected 9+ tables; B-17's prose names FOUR and a hardcoded list of four is the regression this whole change exists for. Found ${real.tables.size}`,
    );
    assert.deepEqual(real.problems, []);
  });

  test('a table name that appears only in a COMMENT is not a table', () => {
    // 0004_money_rail.sql:52 contains the literal text `CREATE TABLE` inside a
    // comment. A grep-based enumerator reads that comment as a table.
    assert.equal(real.tables.has('sneaking'), false);
    for (const name of real.tables.keys()) assert.match(name, /^[a-z_][a-z0-9_]*$/);
  });

  test('columns include ALTER TABLE … ADD COLUMN, not only the CREATE body', () => {
    // `entitlements` gets its whole provider half from 0004 section A, and
    // `provider_notifications.user_id` arrives in 0006. A CREATE-only scan would
    // reject the rule that names `provider_environment` as a phantom column.
    assert.ok(real.tables.get('entitlements').columns.has('provider_environment'));
    assert.ok(real.tables.get('provider_notifications').columns.has('user_id'));
  });

  test('constraint clauses are not mistaken for columns', () => {
    const cols = real.tables.get('cancellation_requests').columns;
    for (const kw of ['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT']) assert.equal(cols.has(kw), false);
  });

  test('seeded reference values survive the scan — the pass that must NOT strip literals', () => {
    const seeded = real.tables.get('revocation_reasons').seeds.get('reason');
    assert.ok(seeded.size >= 8, `expected the 8 seeded revocation reasons, got ${seeded.size}`);
    assert.ok(seeded.has('chargeback_reversed'));
    // The descriptions contain commas, parentheses and double quotes; a regex
    // split would have torn the tuples apart and lost values.
    assert.ok(seeded.has('cancelled_at_period_end'));
  });

  test('sqlLiteral refuses a non-literal cell rather than admitting it', () => {
    assert.equal(sqlLiteral("'refund_approved'"), 'refund_approved');
    assert.equal(sqlLiteral("'it''s'"), "it's");
    assert.equal(sqlLiteral('NULL'), null);
    assert.equal(sqlLiteral('lower(x)'), null);
  });

  test('an empty directory reports zero rather than throwing — the caller owns COVERAGE LOST', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nikatru-empty-migrations-'));
    try {
      const r = enumerateMigrationTables(empty);
      assert.equal(r.filesRead, 0);
      assert.equal(r.tables.size, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ── the GATE ────────────────────────────────────────────────────────────────
describe('assert-prod-provenance — the gate limb', () => {
  test('the real tree passes, and says out loud that it has not seen production', () => {
    const r = spawnSync(process.execPath, [GATE, REPO], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /9 table\(s\) enumerated/);
    assert.match(r.stdout, /HAS NOT LOOKED AT PRODUCTION/);
    assert.match(r.stdout, /MONITOR/);
  });

  test('THE REGRESSION: a migration that adds a table with no rule is RED', () => {
    withTree(
      (root) =>
        appendFileSync(
          join(root, MIGRATIONS, '0005_cancellation_requests.sql'),
          '\nCREATE TABLE IF NOT EXISTS support_notes (note_id TEXT PRIMARY KEY, body TEXT);\n',
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`support_notes`.*NO rule/s);
      },
    );
  });

  test('a rule for a table no migration creates is RED', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.ghost_table = { marker: 'app_version', resolver: 'released-build', reason: 'x'.repeat(120) };
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /rule for `ghost_table`/);
      },
    );
  });

  test('a marker naming a column the table does not have is RED', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.cron_heartbeat.marker = 'app_version';
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`cron_heartbeat` declares marker `app_version` and its schema has no such column/);
      },
    );
  });

  test('ANTI-DOWNGRADE: a table WITH app_version may not use a weaker resolver', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.consent_artifacts.marker = 'platform';
        reg.tables.consent_artifacts.resolver = 'live-environment';
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /HAS an `app_version` column and declares resolver/);
      },
    );
  });

  test('an undeclared resolver is RED — the monitor cannot execute one it has never heard of', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.entitlements.resolver = 'vibes';
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /declares resolver "vibes"/);
      },
    );
  });

  test('THE EMPTY PREDICATE: migration-seed over a column nothing seeds is RED', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.revocation_reasons.marker = 'description';
        reg.tables.cron_heartbeat.marker = 'target';
        reg.tables.cron_heartbeat.resolver = 'migration-seed';
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`migration-seed` on `target`, and no INSERT/);
      },
    );
  });

  test('an exemption with no written reason is RED', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.unclaimed_payments.reason = 'n/a';
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /carries no written `reason` of substance/);
      },
    );
  });

  test('a non-released-build reason that never says what it stands in for is RED', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.cron_heartbeat.reason = 'The job column is the marker for this table and it is fine, honestly, for at least eighty characters of prose.';
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never mentions `app_version`/);
      },
    );
  });

  test('THE PAIR: unwiring the monitor from ops-watch.yml is RED', () => {
    withTree(
      (root) => {
        const wf = readFileSync(join(root, OPS_WATCH), 'utf8').replace(
          /node tooling\/ops\/check-prod-provenance\.mjs/g,
          'node tooling/ops/check-heartbeats.mjs',
        );
        writeFileSync(join(root, OPS_WATCH), wf);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no job in .*ops-watch\.yml runs tooling\/ops\/check-prod-provenance\.mjs/);
      },
    );
  });

  test('ops-watch.yml acquiring a push trigger is RED — it holds the D1 credential', () => {
    withTree(
      (root) => {
        const wf = readFileSync(join(root, OPS_WATCH), 'utf8').replace(/^on:\s*$/m, 'on:\n  push:\n    branches: [main]');
        writeFileSync(join(root, OPS_WATCH), wf);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /acquired a push.*trigger/s);
      },
    );
  });

  test('COVERAGE LOST when the migrations directory is empty', () => {
    withTree(
      (root) => {
        rmSync(join(root, MIGRATIONS), { recursive: true, force: true });
        mkdirSync(join(root, MIGRATIONS), { recursive: true });
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /not one \.sql file was read/);
      },
    );
  });

  test('COVERAGE LOST when the register declares no resolvers', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.resolvers = {};
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST.*declares no `resolvers`/s);
      },
    );
  });
});

// ── the MONITOR ─────────────────────────────────────────────────────────────
describe('check-prod-provenance — the monitor limb', () => {
  const RUNS = [
    { run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab' },
    { run_number: 119, head_sha: '2594564aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  ];

  function run(rowsByTable, runs = RUNS, deployments = null) {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-monitor-'));
    try {
      const rowsFile = join(dir, 'rows.json');
      const runsFile = join(dir, 'runs.json');
      writeFileSync(rowsFile, JSON.stringify(rowsByTable));
      writeFileSync(runsFile, JSON.stringify(runs));
      const argv = [MONITOR, '--root', REPO, '--rows-file', rowsFile, '--runs-file', runsFile];
      if (deployments !== null) {
        const deploymentsFile = join(dir, 'deployments.json');
        writeFileSync(deploymentsFile, JSON.stringify(deployments));
        argv.push('--deployments-file', deploymentsFile);
      }
      return spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('an empty production is green, and announces it is only a monitor', () => {
    const r = run({});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /THIS IS A MONITOR, NOT A GATE/);
    assert.match(r.stdout, /9 table\(s\) enumerated/);
  });

  test('the real production consent row resolves — it is a shipped build, not residue', () => {
    // 1.0.101+e138f5b: release line 1.0 (apps/subly/pubspec.yaml), run 101 of the
    // served lane, head e138f5b. Read from platform_db on 2026-08-06.
    const r = run({ consent_artifacts: [{ marker: '1.0.101+e138f5b', n: 1 }] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /consent_artifacts\s+1 row\(s\), 0 unattributable/);
  });

  test("B-17's RECORDED FAILING INPUT: one row with app_version c6-localprobe counts 1", () => {
    const r = run({ consent_artifacts: [{ marker: 'c6-localprobe', n: 1 }] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /consent_artifacts: 1 row\(s\)/);
    assert.match(r.stderr, /not the shape a shipped build produces/);
  });

  test('the dart-define default `dev` does not resolve', () => {
    const r = run({ events: [{ marker: 'dev', n: 42 }] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /events: 42 row\(s\)/);
  });

  test('a well-formed version for a run that never happened does not resolve', () => {
    const r = run({ events: [{ marker: '1.0.9999+deadbee', n: 3 }] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no run numbered 9999/);
  });

  test('a version claiming a run that shipped a DIFFERENT commit does not resolve', () => {
    const r = run({ events: [{ marker: '1.0.101+abc1234', n: 1 }] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 101 shipped e138f5b, not abc1234/);
  });

  test('a NULL app_version does not resolve — an unattributable row is not an absent one', () => {
    const r = run({ consent_artifacts: [{ marker: null, n: 1 }] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no app_version at all/);
  });

  test('a sandbox entitlement is flagged — B-17\'s "free Pro unlock nobody notices"', () => {
    const r = run({ entitlements: [{ marker: 'sandbox', n: 1 }, { marker: 'live', n: 5 }] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /entitlements: 1 row\(s\).*environment is `sandbox`/s);
    assert.doesNotMatch(r.stderr, /entitlements: 5 row\(s\)/);
  });

  test('the real cron_heartbeat jobs resolve and a renamed one does not', () => {
    const ok = run({ cron_heartbeat: [{ marker: 'supabase_keepalive', n: 10 }, { marker: 'renewals', n: 3 }, { marker: 'analytics_liveness', n: 3 }] });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const bad = run({ cron_heartbeat: [{ marker: 'supabase_ping', n: 4 }] });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /job `supabase_ping` is declared by no/);
  });

  test('a revocation reason outside the migration seed does not resolve', () => {
    const ok = run({ revocation_reasons: [{ marker: 'chargeback_reversed', n: 1 }] });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const bad = run({ revocation_reasons: [{ marker: 'because_i_said_so', n: 1 }] });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /is not one of the \d+ values the migrations seed/);
  });

  test('EXIT 2, NOT 1, when the released-build set is empty — "I could not look"', () => {
    const r = run({ events: [{ marker: 'dev', n: 1 }] }, []);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /COULD NOT LOOK/);
    assert.match(r.stderr, /released-build set is EMPTY/);
  });

  test('EXIT 2 when a table has no rule — it must not query a shorter list and print clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-monitor-uncovered-'));
    const root = realTree();
    try {
      appendFileSync(join(root, MIGRATIONS, '0003_cron_heartbeat.sql'), '\nCREATE TABLE IF NOT EXISTS orphan_rows (id TEXT);\n');
      const rowsFile = join(dir, 'rows.json');
      const runsFile = join(dir, 'runs.json');
      writeFileSync(rowsFile, '{}');
      writeFileSync(runsFile, JSON.stringify(RUNS));
      // The register + migrations come from the mutated copy; apps/ and services/
      // resolvers still need the real repo, so only the register root moves.
      cpSync(join(REPO, 'apps'), join(root, 'apps'), { recursive: true });
      cpSync(join(REPO, 'tooling', 'channel-register.json'), join(root, 'tooling', 'channel-register.json'));
      mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
      cpSync(join(REPO, 'tooling', 'legal', 'provider-register.json'), join(root, 'tooling', 'legal', 'provider-register.json'));
      cpSync(join(REPO, 'services', 'platform', 'src'), join(root, 'services', 'platform', 'src'), { recursive: true });
      const r = spawnSync(
        process.execPath,
        [MONITOR, '--root', root, '--rows-file', rowsFile, '--runs-file', runsFile],
        { cwd: REPO, encoding: 'utf8' },
      );
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /COVERAGE LOST — 1 table\(s\).*orphan_rows/s);
      assert.match(r.stderr, /printed a clean total/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fixture mode announces itself so it can never pass as a real ops-watch run', () => {
    const r = run({});
    assert.match(r.stdout, /OFFLINE FIXTURE MODE/);
  });
});

// ── THE DEPLOYMENT WITNESS ───────────────────────────────────────────────────
// Modelled on the REAL incident, not on an invented one. deploy-web run 144
// (2026-08-08) deployed successfully and then failed its post-deploy smoke, so
// the RUN concluded `failure` while the bundle served real users — whose rows
// carried `1.0.144+40c0787`. The version, the sha and the run number below are
// the actual ones; the fix under test is that a GitHub Deployment for that
// commit is enough to attribute them, without a hand-written attestation.
describe('check-prod-provenance — a failed run that DID deploy', () => {
  const SHA144 = '40c0787a41f9ee7f5befdcb380646ae717f4a9f7';
  const RUNS = [
    { run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab', conclusion: 'success' },
    { run_number: 144, head_sha: SHA144, conclusion: 'failure' },
  ];
  const ROWS = { consent_artifacts: [{ marker: '1.0.144+40c0787', n: 1 }] };

  function run(rowsByTable, runs, deployments) {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-witness-'));
    try {
      const f = (name, v) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };
      const argv = [MONITOR, '--root', REPO, '--rows-file', f('rows.json', rowsByTable), '--runs-file', f('runs.json', runs)];
      if (deployments !== null) argv.push('--deployments-file', f('deployments.json', deployments));
      return spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('THE INCIDENT: a failed run with a GitHub Deployment for its sha RESOLVES', () => {
    const r = run(ROWS, RUNS, [SHA144]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /consent_artifacts\s+1 row\(s\), 0 unattributable/);
  });

  test('and it says so out loud — an acceptance on the weaker footing is never silent', () => {
    const r = run(ROWS, RUNS, [SHA144]);
    assert.match(r.stdout, /deployment-witnessed build accepted: 1\.0\.144\+40c0787/);
    assert.match(r.stdout, /run 144 concluded `failure`/);
  });

  test('THE NEGATIVE CASE: the same failed run with NO deployment stays unattributable', () => {
    const r = run(ROWS, RUNS, []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /NO GitHub Deployment names 40c0787/);
    assert.match(r.stderr, /nothing witnesses that this build was ever published/);
  });

  test('a deployment for some OTHER commit does not witness this build', () => {
    const r = run(ROWS, RUNS, ['1111111111111111111111111111111111111111']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /NO GitHub Deployment names 40c0787/);
  });

  test('BOTH HALVES OR NEITHER: a deployment cannot lend a sha to a run number it never had', () => {
    // The version claims run 101; run 101 really shipped e138f5b. A deployment
    // for 40c0787 must not rescue `1.0.101+40c0787` — run numbers are what
    // version strings are ORDERED by, so the run-number leg is not optional.
    const r = run({ events: [{ marker: '1.0.101+40c0787', n: 2 }] }, RUNS, [SHA144]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 101 shipped e138f5b, not 40c0787/);
  });

  test('a run that is merely CANCELLED is not deployed either, absent a witness', () => {
    const cancelled = [{ run_number: 145, head_sha: SHA144, conclusion: 'cancelled' }];
    const r = run({ events: [{ marker: '1.0.145+40c0787', n: 1 }] }, cancelled, []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 145 concluded `cancelled`/);
  });

  test('the successful-run path is untouched — no deployment ledger needed for it', () => {
    const r = run({ consent_artifacts: [{ marker: '1.0.101+e138f5b', n: 1 }] }, RUNS, []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /deployment-witnessed/);
  });

  test('the census names both witnesses so a shrinking ledger is visible', () => {
    const r = run(ROWS, RUNS, [SHA144]);
    assert.match(r.stdout, /2 completed lane run\(s\), 1 successful/);
    assert.match(r.stdout, /1 commit\(s\) with a GitHub Deployment/);
  });

  test('a fixture with no --deployments-file reads as NO second witness, never as a permissive one', () => {
    const r = run(ROWS, RUNS, null);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /deployment ledger: NOT READ \(fixture mode\)/);
    assert.match(r.stderr, /NO GitHub Deployment names 40c0787/);
  });
});

// ── WITNESS (b)'s SUBJECT: WHICH ENVIRONMENTS THE LEDGER IS READ FROM ────────
// 🔴 THESE EXIST BECAUSE THE EXPANSION WAS UNREACHABLE. `servedEnvironments()`
// is consulted on ONE line — the live branch of `deployedShas` — and that line
// sits behind `githubRuns`, which needs a credential no test has. So the tests
// above, which cover the resolver thoroughly, covered the environment set NOT AT
// ALL: it could have expanded to the wrong name, or to nothing, and every one of
// them would still be green. Its `CouldNotLook` was an assertion no input could
// make fail, which this repository's own rule calls worse than none.
//
// `--emit-served-environments` reaches the SAME function the live read calls —
// not a copy — so these grade the thing that runs.
describe('check-prod-provenance — the environments witness (b) is read from', () => {
  const CHANNELS = 'tooling/channel-register.json';
  const CATALOGUE = 'sites/_shared/_data/apps.json';

  function emit(build) {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-served-envs-'));
    try {
      build(root);
      return spawnSync(process.execPath, [MONITOR, '--root', root, '--emit-served-environments'], { cwd: REPO, encoding: 'utf8' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const write = (root, rel, value) => {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify(value, null, 2));
  };

  test('THE REAL TREE: the emitted environment is the one deploy-web.yml actually records', () => {
    // The binding that matters. `record-deployment.mjs <env>` in the lane and
    // this reader's expansion are two sides of one name, and nothing else in the
    // tree holds them together — a rename on either side would make the ledger
    // read from an environment nobody writes, and witness (b) would go silently
    // empty (every failed-run build unattributable, with no error).
    const r = spawnSync(process.execPath, [MONITOR, '--emit-served-environments'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const emitted = r.stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean);
    assert.ok(emitted.length > 0, 'the real tree must expand to at least one environment');

    // COMMENT LINES ARE DROPPED FIRST, and that is not tidiness — this file
    // NAMES `record-deployment.mjs` in its prose four times, so a naive match
    // reads the next English word ("writes") as an environment. Caught by this
    // very test on its first run; a scan of a file this heavily commented must
    // strip the commentary before it reads the executable text.
    // Two normalisations, and this test earned BOTH by failing on them:
    //  · COMMENT LINES GO FIRST. This file names `record-deployment.mjs` in its
    //    prose four times, so a naive match reads the next English word
    //    ("writes") as an environment.
    //  · `${{ … }}` EXPRESSIONS COLLAPSE BEFORE THE MATCH, NEVER AFTER. The real
    //    call is `record-deployment.mjs ${{ matrix.app }}-web …`, and `\S+`
    //    stops at the space INSIDE the expression — so a substitution applied to
    //    the captured text only ever sees `${{`.
    const lane = readFileSync(join(REPO, '.github', 'workflows', 'deploy-web.yml'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
      .replace(/\$\{\{\s*matrix\.app\s*\}\}/g, '{app}')
      .replace(/\$\{\{[^}]*\}\}/g, 'EXPR');

    const templates = [...lane.matchAll(/record-deployment\.mjs\s+(\S+)/g)].map((m) => m[1]);
    assert.ok(templates.length > 0, 'deploy-web.yml must still call record-deployment.mjs');
    const slugs = JSON.parse(readFileSync(join(REPO, 'sites', '_shared', '_data', 'apps.json'), 'utf8')).map((a) => a.slug);
    assert.ok(slugs.length > 0, 'the app catalogue must name at least one app');
    for (const t of templates) {
      for (const s of slugs) {
        const env = t.replace('{app}', s);
        assert.ok(
          emitted.includes(env),
          `deploy-web.yml records "${env}" but the ledger reader does not read it (reads: ${emitted.join(', ')})`,
        );
      }
    }
  });

  test('`{app}` expands over EVERY app — a second app is a second environment', () => {
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true, deploymentEnvironment: '{app}-web' }] });
      write(root, CATALOGUE, [{ slug: 'subly' }, { slug: 'drift' }]);
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n').sort(), ['drift-web', 'subly-web']);
  });

  test('THE NEGATIVE CASE: a register that expands to NOTHING is exit 2, never an empty ledger', () => {
    // An empty environment set makes githubDeployments return an empty sha set,
    // which reads exactly like "nothing was ever deployed" — so every build from
    // a failed run would be called unattributable and nothing would say why.
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true }] });
      write(root, CATALOGUE, [{ slug: 'subly' }]);
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COULD NOT LOOK/);
    assert.match(r.stderr, /witness \(b\) would be silently empty/);
  });

  test('a served channel with apps but NO app in the tree is exit 2, not a silent empty', () => {
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true, deploymentEnvironment: '{app}-web' }] });
      write(root, CATALOGUE, []);
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /witness \(b\) would be silently empty/);
  });

  test('an UNSERVED channel lends no environment — a Worker deploy is not an app publish', () => {
    // A Worker deployed at some commit says nothing about whether the app bundle
    // at that commit ever reached a browser. If service environments counted,
    // any Worker deploy would witness every app build sharing its sha.
    const r = emit((root) => {
      write(root, CHANNELS, {
        channels: [
          { id: 'web', served: true, deploymentEnvironment: '{app}-web' },
          { id: 'windows-store', served: false, deploymentEnvironment: '{app}-windows-store' },
        ],
      });
      write(root, CATALOGUE, [{ slug: 'subly' }]);
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['subly-web']);
  });

  test('with no catalogue the apps/ directory is the floor — the reader still works', () => {
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true, deploymentEnvironment: '{app}-web' }] });
      mkdirSync(join(root, 'apps', 'subly'), { recursive: true });
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['subly-web']);
  });

  test('a channel whose environment names no app is taken literally, not dropped', () => {
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true, deploymentEnvironment: 'the-one-site' }] });
      write(root, CATALOGUE, [{ slug: 'subly' }]);
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['the-one-site']);
  });
});
