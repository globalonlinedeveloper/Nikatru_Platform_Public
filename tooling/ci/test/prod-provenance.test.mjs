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
// release line in apps/subscriptiontracker/pubspec.yaml made it print the real
// `consent_artifacts` row as unattributable.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, cpSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumerateMigrationTables, sqlLiteral } from '../migration-tables.mjs';
import { attestationCommitRead, attestationDeployments, CouldNotLook, collectPaged, reservedAddressCensusSql } from '../../ops/check-prod-provenance.mjs';

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
  // ⏱ THE ENUMERATION WAS 11 UNTIL 2026-09-09 and is 15 now: 0009_bundle_grants.sql
  // added bundle_grants, bundle_sources, feature_sets and feature_set_members, over
  // 9 migration files. The count is PINNED rather than derived ON PURPOSE — a
  // derived count agrees with any schema, including one that quietly stopped
  // enumerating — so it moves in the same commit as the migration that moved it,
  // with the measurement written beside it rather than the number simply edited.
  // ⏱ 2026-09-15 · 15 -> 16: 0010_pending_erasures.sql ([ADR 081]) adds pending_erasures, over
  // 10 migration files — measured: `16 table(s) enumerated from services/platform/migrations (10 migration file(s))`.
  // ⏱ 2026-09-15 · 16 -> 17: 0011_signups.sql ([ADR 087]) adds signups, over 11 migration files.
  test('the real tree passes, and says out loud that it has not seen production', () => {
    const r = spawnSync(process.execPath, [GATE, REPO], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /19 table\(s\) enumerated/); // ⏱ 2026-09-18: 18 -> 19, 0013 content_reports (O-PLAY-AI-CONTENT-REPORTING).
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
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /not one \.sql file was read/);
      },
    );
  });

  test('⏱ 2026-09-15 · [ADR 087] `not-reserved-address` on a column other than `email` is RED', () => {
    withTree(
      (root) => {
        const reg = readRegister(root);
        reg.tables.signups.marker = 'signed_up_at';
        writeRegister(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`signups` declares resolver `not-reserved-address` on `signed_up_at`/);
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
        assert.equal(r.status, 2);
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
    assert.match(r.stdout, /19 table\(s\) enumerated/); // ⏱ 2026-09-18: 18 -> 19, 0013 content_reports (O-PLAY-AI-CONTENT-REPORTING).
  });

  test('the real production consent row resolves — it is a shipped build, not residue', () => {
    // 1.0.101+e138f5b: release line 1.0 (apps/subscriptiontracker/pubspec.yaml), run 101 of the
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

  test('⏱ 2026-09-15 · [ADR 087] a signup at an ordinary domain resolves; one at a reserved test domain is residue', () => {
    const ok = run({ signups: [{ marker: 'unreserved', n: 3 }] });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /signups\s+3 row\(s\), 0 unattributable/);
    const bad = run({ signups: [{ marker: 'unreserved', n: 3 }, { marker: 'reserved', n: 1 }] });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /signups: 1 row\(s\) — addressed to a domain reserved for testing/);
  });

  test('🔴 the signups census query returns COUNTS, never an address, and classifies the reserved domains', async () => {
    const sql = reservedAddressCensusSql('signups', 'email');
    assert.match(sql, /^SELECT CASE WHEN .* THEN 'reserved' ELSE 'unreserved' END AS marker, COUNT\(\*\) AS n FROM "signups" GROUP BY 1$/);
    assert.doesNotMatch(sql, /SELECT "email"/, 'the generic census shape would return every address');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(join(REPO, MIGRATIONS, '0011_signups.sql'), 'utf8'));
    const put = db.prepare('INSERT INTO signups (email, signed_up_at) VALUES (?, ?)');
    for (const e of ['probe@example.com', 'a@sub.EXAMPLE.org', 'x@foo.test', 'y@host.invalid', 'z@localhost', 'real@gmail.com', 'person@example.co.uk', 'me@notexample.com']) {
      put.run(e, '2026-09-15T00:00:00.000Z');
    }
    const got = Object.fromEntries(db.prepare(sql).all().map((r) => [r.marker, Number(r.n)]));
    assert.deepEqual(got, { reserved: 5, unreserved: 3 });
  });

  test('⏱ 2026-09-15 · [ADR 087] a pending signup-purge step resolves by the second resolver; an undeclared step does not', () => {
    const ok = run({ pending_erasures: [{ marker: 'subscriptiontracker', n: 2 }, { marker: 'platform:signups', n: 1 }] });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /second-resolver acceptance: pending_erasures: 1 row\(s\) with `app_id` = `platform:signups` .* `erasure-step`/);
    const bad = run({ pending_erasures: [{ marker: 'platform:renamed', n: 1 }] });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /pending_erasures: 1 row\(s\)/);
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
  const CATALOGUE = 'catalog/apps.json';

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
    const slugs = JSON.parse(readFileSync(join(REPO, 'catalog', 'apps.json'), 'utf8')).map((a) => a.slug);
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
      write(root, CATALOGUE, [{ slug: 'subscriptiontracker' }, { slug: 'drift' }]);
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n').sort(), ['drift-web', 'subscriptiontracker-web']);
  });

  // ── THE RETIRED-ENVIRONMENT WIDENING, AND THE ASYMMETRY THAT MAKES IT SAFE ──
  // A GitHub Deployment environment is a name on GitHub, created the day the
  // deploy ran; it does not move when a directory is renamed. When `apps/subly`
  // became `apps/subscriptiontracker` the ledger went from 58 witnesses to 2 and
  // six groups of real production rows stopped tracing to any published build.
  // RETIRED_ENVIRONMENTS repairs the READ side only, and these two cases are the
  // only thing standing between that and a reader that accepts any name someone
  // adds to a list.
  test('the LEDGER reads the retired environments and the EMITTED set does not', () => {
    const emitted = spawnSync(process.execPath, [MONITOR, '--emit-served-environments'], { cwd: REPO, encoding: 'utf8' });
    const ledger = spawnSync(process.execPath, [MONITOR, '--emit-ledger-environments'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr);
    assert.equal(ledger.status, 0, ledger.stdout + ledger.stderr);
    const lines = (r) => r.stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean);
    const e = lines(emitted);
    const l = lines(ledger);

    // (a) SUPERSET. Everything the lane writes today is still read — a retired
    //     entry must never be able to displace a live one.
    for (const env of e) assert.ok(l.includes(env), `the ledger stopped reading "${env}", which deploy-web.yml writes today`);

    // (b) STRICT. If the two sets are equal, RETIRED_ENVIRONMENTS is empty or
    //     duplicates the derivation, and this whole limb is asserting nothing.
    //     That is the state to fail in, not to pass quietly through.
    assert.ok(
      l.length > e.length,
      `--emit-ledger-environments returned the same set as --emit-served-environments (${l.join(', ')}). ` +
        'Either RETIRED_ENVIRONMENTS is empty — in which case delete it and this test together — or it is ' +
        'listing a name the derivation already produces, which grades nothing.',
    );

    // (c) THE ASYMMETRY. A retired name reaching the EMITTED set would mean the
    //     reader claims deploy-web.yml records into an environment nothing has
    //     written since the rename.
    for (const env of l) {
      if (e.includes(env)) continue;
      assert.ok(
        !e.includes(env),
        `"${env}" is retired but is being emitted as an environment the lane records into`,
      );
    }
  });

  test('THE NEGATIVE CASE: a register that expands to NOTHING is exit 2, never an empty ledger', () => {
    // An empty environment set makes githubDeployments return an empty sha set,
    // which reads exactly like "nothing was ever deployed" — so every build from
    // a failed run would be called unattributable and nothing would say why.
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true }] });
      write(root, CATALOGUE, [{ slug: 'subscriptiontracker' }]);
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
      write(root, CATALOGUE, [{ slug: 'subscriptiontracker' }]);
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['subscriptiontracker-web']);
  });

  test('with no catalogue the apps/ directory is the floor — the reader still works', () => {
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true, deploymentEnvironment: '{app}-web' }] });
      mkdirSync(join(root, 'apps', 'subscriptiontracker'), { recursive: true });
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['subscriptiontracker-web']);
  });

  test('a channel whose environment names no app is taken literally, not dropped', () => {
    const r = emit((root) => {
      write(root, CHANNELS, { channels: [{ id: 'web', served: true, deploymentEnvironment: 'the-one-site' }] });
      write(root, CATALOGUE, [{ slug: 'subscriptiontracker' }]);
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['the-one-site']);
  });
});

// ── ⏱ 2026-09-23 · A BUILD THAT LEFT THROUGH A STORE SUBMISSION ──────────────
// Modelled on the REAL incident. The first Play upload was submit-play.yml
// run_number 5 (run 35787897094, 21:38:59Z → 21:59:43Z) at 0390db6d; its record
// step wrote Deployment 6601614981 on subscriptiontracker-android-play at
// 21:59:38Z. The build stamped `1.0.5+0390db6`, and the consent row it wrote was
// called unattributable by ops-watch run 35820464059, because this reader knew
// deploy-web.yml as the only release lane. Run_number 4 (35786771434, 21:27:38Z →
// 21:35:44Z, at 22fd29b7) was a DRY RUN: it concluded `success`, uploaded nothing
// and recorded no Deployment — so a successful run is exactly what must NOT be
// enough on this footing. The run numbers, times and ids below are the real ones.
//
// ⏱ 2026-09-23 (rework) — THE BINDING IS THE RUN'S IDENTITY, NOT A TIME WINDOW.
// The first version of footing (c) bound a Deployment to the run whose lifetime
// contained its `created_at`. Review found three holes in that: a dry run at
// the upload's commit whose lifetime overlapped the Deployment resolved on it
// (A2); an earlier dry run re-run the next morning moved its `updated_at` past
// the Deployment and resolved on it (A1); and a recovery Deployment written by
// hand after a rate-limited record step could never bind (F3).
// record-deployment.mjs now writes `{workflow, run_id, run_attempt, run_number}`
// into every Deployment, and the resolver accepts a submission stamp only when a
// Deployment on the lane's environments at the run's full head names that run's
// id and that lane's workflow. Deployment 6601614981 was written before the
// payload existed (`payload: {}` — measured); it binds to run 35787897094 alone
// through `legacyDeploymentBindings` in tooling/prod-provenance.json. The shas
// below are the real full ones, because that entry is matched on the full sha.
describe('check-prod-provenance — a SUBMISSION lane build', () => {
  const SHA5 = '0390db6da9125c51959a6db19ebaf8130728fdae';
  const SHA4 = '22fd29b784ee0b3bc66f6cac8a88b549d34fd5b3';
  const SHA6P = '6a6b6c6d' + '11223344556677889900aabbccddeeff';
  const PLAY = '.github/workflows/submit-play.yml';
  const ENV = 'subscriptiontracker-android-play';
  const RUN5 = { path: PLAY, id: 35787897094, run_number: 5, run_attempt: 1, head_sha: SHA5, conclusion: 'success', created_at: '2026-09-22T21:38:59Z', updated_at: '2026-09-22T21:59:43Z' };
  const RUN4 = { path: PLAY, id: 35786771434, run_number: 4, run_attempt: 1, head_sha: SHA4, conclusion: 'success', created_at: '2026-09-22T21:27:38Z', updated_at: '2026-09-22T21:35:44Z' };
  // The real record: written before record-deployment.mjs wrote a payload.
  const DEP5 = { environment: ENV, sha: SHA5, created_at: '2026-09-22T21:59:38Z', id: 6601614981, payload: {} };
  const WEB101 = { run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab', conclusion: 'success' };
  // deploy-web.yml has its own run 5 (436 completed runs, measured 2026-09-23).
  const WEB5 = { run_number: 5, head_sha: 'aa11bb22cc33dd44ee55ff6600112233445566ff', conclusion: 'success' };
  const ROW5 = { consent_artifacts: [{ marker: '1.0.5+0390db6', n: 1 }] };
  const REFUSED = 'a dry run writes none, and a hand-written recovery Deployment must carry the run payload';

  /** The payload record-deployment.mjs writes, for a fixture run of submit-play.yml. */
  const payloadOf = (r) => ({ workflow: 'submit-play.yml', run_id: r.id, run_attempt: r.run_attempt, run_number: r.run_number });

  function run(rowsByTable, runs, deployments) {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-submission-'));
    try {
      const f = (name, v) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };
      const argv = [MONITOR, '--root', REPO, '--rows-file', f('rows.json', rowsByTable), '--runs-file', f('runs.json', runs)];
      if (deployments !== null) argv.push('--deployments-file', f('deployments.json', deployments));
      return spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('S-1 THE INCIDENT AS THE LIVE READ SEES IT: deploy-web\'s own run 5 listed LAST does not hide the Play upload', () => {
    // The real Play Deployment carries no payload, so this resolves through the
    // legacy binding. origin/main's reader refuses it: it keys runs by number
    // alone and deploy-web's run 5, listed last, shipped another commit.
    const r = run(ROW5, [WEB101, RUN5, WEB5], [DEP5]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /consent_artifacts\s+1 row\(s\), 0 unattributable/);
  });

  test('S-2 and it says so out loud, naming the run, the Deployment and the legacy binding that carried it', () => {
    const r = run(ROW5, [WEB101, RUN5, WEB5], [DEP5]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /submission-witnessed build accepted: 1\.0\.5\+0390db6 — submit-play\.yml run 5 at 0390db6/);
    assert.match(r.stdout, /Deployment 6601614981 on subscriptiontracker-android-play carries no payload and is bound to run 35787897094 by legacyDeploymentBindings \(measured 2026-09-23\)/);
    assert.match(r.stdout, /release lane · submission · submit-play\.yml: 1 completed run\(s\) · 1 Deployment\(s\)/);
  });

  test('S-3 THE REAL DRY RUN: run 4 at 22fd29b succeeded, uploaded nothing and recorded nothing — it stays unattributable', () => {
    const r = run({ consent_artifacts: [{ marker: '1.0.4+22fd29b', n: 1 }] }, [WEB101, RUN4, RUN5], [DEP5]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 4 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35786771434; a dry run writes none, and a hand-written recovery Deployment must carry the run payload/);
  });

  test('S-4 a later DRY RUN AT THE SAME SHA as the upload cannot borrow the upload\'s Deployment', () => {
    const RUN6 = { path: PLAY, id: 35900000006, run_number: 6, run_attempt: 1, head_sha: SHA5, conclusion: 'success', created_at: '2026-09-22T22:10:00Z', updated_at: '2026-09-22T22:15:00Z' };
    const r = run({ consent_artifacts: [{ marker: '1.0.6+0390db6', n: 1 }] }, [WEB101, RUN5, RUN6], [DEP5]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 6 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35900000006/);
  });

  test('S-5a A1: an earlier dry run at the upload\'s sha, RE-RUN the next morning, does not bind the upload\'s Deployment', () => {
    // Attempt 2 moved updated_at past the Deployment's created_at, which is what
    // let the time window accept it. The run id did not change, and neither did
    // the fact that no attempt of this run wrote a Deployment.
    const RUN4A = { ...RUN4, head_sha: SHA5, run_attempt: 2, updated_at: '2026-09-23T10:08:00Z' };
    const r = run({ consent_artifacts: [{ marker: '1.0.4+0390db6', n: 1 }] }, [WEB101, RUN4A, RUN5], [DEP5]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 4 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35786771434/);
  });

  test('S-5b A2: a dry run at the upload\'s sha whose lifetime CONTAINS the upload\'s Deployment does not bind it', () => {
    const RUN6 = { path: PLAY, id: 35900000006, run_number: 6, run_attempt: 1, head_sha: SHA5, conclusion: 'success', created_at: '2026-09-22T21:55:00Z', updated_at: '2026-09-22T22:03:00Z' };
    const r = run({ consent_artifacts: [{ marker: '1.0.6+0390db6', n: 1 }] }, [WEB101, RUN5, RUN6], [DEP5]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 6 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35900000006/);
  });

  test('S-6 a bare-sha ledger entry never witnesses a submission — it names no environment and no run', () => {
    const r = run(ROW5, [WEB101, RUN5], [SHA5]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 5 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35787897094/);
  });

  test('S-7 a Deployment on the WEB environment never witnesses a Play build', () => {
    const r = run(ROW5, [WEB101, RUN5], [{ ...DEP5, environment: 'subscriptiontracker-web', payload: payloadOf(RUN5) }]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /no Deployment on subscriptiontracker-android-play names run 35787897094/);
  });

  test('S-8 a Deployment on another channel of the same app does not witness this lane', () => {
    const r = run(ROW5, [WEB101, RUN5], [{ ...DEP5, environment: 'subscriptiontracker-linux-snap', payload: payloadOf(RUN5) }]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /no Deployment on subscriptiontracker-android-play names run 35787897094/);
  });

  // Run numbers are per workflow: deploy-web and submit-play each have a run 6.
  const RUN6P = { path: PLAY, id: 35900000106, run_number: 6, run_attempt: 1, head_sha: SHA6P, conclusion: 'success', created_at: '2026-09-23T01:00:00Z', updated_at: '2026-09-23T01:20:00Z' };
  const DEP6P = { environment: ENV, sha: SHA6P, created_at: '2026-09-23T01:19:00Z', id: 7000000001, payload: payloadOf(RUN6P) };
  const WEB6 = { run_number: 6, head_sha: '9f9e9d9c9b9a99989796959493929190bfbebdbc', conclusion: 'success' };
  const ROW6 = { consent_artifacts: [{ marker: '1.0.6+6a6b6c6', n: 1 }] };

  test('S-9 THE COLLISION: a served run listed LAST with the same number does not hide the Play build', () => {
    const r = run(ROW6, [WEB101, RUN6P, WEB6], [DEP6P]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /submission-witnessed build accepted: 1\.0\.6\+6a6b6c6 — submit-play\.yml run 6/);
  });

  test('S-10 the same collision with no Deployment is refused, and BOTH candidates say why', () => {
    const r = run(ROW6, [WEB101, RUN6P, WEB6], []);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 6 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35900000106; a dry run writes none, and a hand-written recovery Deployment must carry the run payload · run 6 shipped 9f9e9d9, not 6a6b6c6/);
  });

  test('S-11 `dev` stays refused with an upload and its Deployment right there', () => {
    const r = run({ consent_artifacts: [{ marker: 'dev', n: 1 }] }, [WEB101, RUN5], [DEP5]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /not the shape a shipped build produces/);
  });

  test('S-12 a fixture run on a workflow that is NO release lane is COULD NOT LOOK, never judged', () => {
    const r = run(ROW5, [WEB101, { ...RUN5, path: '.github/workflows/ci.yml' }], [DEP5]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /names workflow ci\.yml, which is no release lane/);
  });

  test('S-13 a submission run with no `id` is COULD NOT LOOK, never a guess', () => {
    const { id, ...anonymous } = RUN5;
    const r = run(ROW5, [WEB101, anonymous], [DEP5]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /run 5 of submit-play\.yml carries no `id`, so no Deployment's payload can be bound to it/);
  });

  test('S-14 a fixture with no --deployments-file reads as NO witness for a submission, never a permissive one', () => {
    const r = run(ROW5, [WEB101, RUN5], null);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 5 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35787897094/);
  });

  test('S-21 submission runs alone cannot stand in for an empty served lane — COULD NOT LOOK', () => {
    const r = run(ROW5, [RUN5], [DEP5]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /no completed run of the served lane deploy-web\.yml was found/);
  });

  test('S-22 a Deployment with no `created_at` binds by its payload alone — time is not consulted', () => {
    const { created_at, ...untimed } = DEP6P;
    const r = run(ROW6, [WEB101, RUN6P], [untimed]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /consent_artifacts\s+1 row\(s\), 0 unattributable/);
  });

  test('S-24 PAYLOAD MATCH: a Deployment whose payload names this run and this lane\'s workflow is accepted', () => {
    const r = run(ROW6, [WEB101, RUN6P], [DEP6P]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /submission-witnessed build accepted: 1\.0\.6\+6a6b6c6 — submit-play\.yml run 6 at 6a6b6c6, Deployment 7000000001 on subscriptiontracker-android-play whose payload names run 35900000106/);
  });

  test('S-25 a payload naming ANOTHER run id is refused, at the right sha on the right environment', () => {
    const r = run(ROW6, [WEB101, RUN6P], [{ ...DEP6P, payload: { ...payloadOf(RUN6P), run_id: 35900000999 } }]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 6 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35900000106/);
  });

  test('S-26 a payload naming this run id under ANOTHER workflow is refused', () => {
    const r = run(ROW6, [WEB101, RUN6P], [{ ...DEP6P, payload: { ...payloadOf(RUN6P), workflow: 'submit-snap.yml' } }]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 6 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35900000106/);
  });

  test('S-27 attempt 2 of a DRY RUN at an uploaded sha is refused: its id is its own, and no attempt of it wrote a Deployment', () => {
    const RUN7 = { path: PLAY, id: 35900000107, run_number: 7, run_attempt: 2, head_sha: SHA6P, conclusion: 'success', created_at: '2026-09-23T01:05:00Z', updated_at: '2026-09-23T09:00:00Z' };
    const r = run({ consent_artifacts: [{ marker: '1.0.7+6a6b6c6', n: 1 }] }, [WEB101, RUN6P, RUN7], [DEP6P]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 7 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35900000107/);
  });

  test('S-28 a payload-less Deployment the legacy list does not name is refused', () => {
    const r = run(ROW6, [WEB101, RUN6P], [{ ...DEP6P, payload: {} }]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`submit-play\\.yml run 6 concluded \`success\` but no Deployment on subscriptiontracker-android-play names run 35900000106; ${REFUSED}`));
  });

  test('S-29 THE LEGACY BINDING names ONE run: Deployment 6601614981 accepts run 5 and refuses run 4 at the same sha', () => {
    const RUN4S = { ...RUN4, head_sha: SHA5 };
    const rows = { consent_artifacts: [{ marker: '1.0.5+0390db6', n: 1 }, { marker: '1.0.4+0390db6', n: 1 }] };
    const r = run(rows, [WEB101, RUN4S, RUN5], [DEP5]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /consent_artifacts\s+2 row\(s\), 1 unattributable/);
    assert.match(r.stdout, /submission-witnessed build accepted: 1\.0\.5\+0390db6/);
    assert.match(r.stderr, /submit-play\.yml run 4 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35786771434/);
  });

  test('S-30 F3: a recovery Deployment written by hand AFTER the run ended binds when it carries the run payload', () => {
    const r = run(ROW6, [WEB101, RUN6P], [{ ...DEP6P, created_at: '2026-09-23T03:00:00Z' }]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /whose payload names run 35900000106/);
  });

  test('S-31 the legacy binding names ONE Deployment: another payload-less one at the same sha binds nothing', () => {
    const r = run(ROW5, [WEB101, RUN5], [{ ...DEP5, id: 6601614982 }]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-play\.yml run 5 concluded `success` but no Deployment on subscriptiontracker-android-play names run 35787897094/);
  });

  test('S-32 a payload the API returns as a JSON STRING binds like the object form', () => {
    const r = run(ROW6, [WEB101, RUN6P], [{ ...DEP6P, payload: JSON.stringify(payloadOf(RUN6P)) }]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /whose payload names run 35900000106/);
  });
});

// ── ⏱ 2026-09-23 · THE RELEASE LANES, AND WHERE EACH ONE'S WITNESS IS READ ────
// `--emit-release-lanes` reaches releaseLanes(), the function the live read
// calls, without a token. The binding test holds each submission lane's
// emitted environments to the `record-deployment.mjs <env>` calls in that
// lane's own workflow file: a rename on either side would make footing (c) read
// an environment nothing writes, and every store build would go unattributable.
describe('check-prod-provenance — the release lanes', () => {
  const CHANNELS = 'tooling/channel-register.json';
  const CATALOGUE = 'catalog/apps.json';
  const SURFACES = { app: { flutterApp: true }, extension: { flutterApp: false } };
  const WEB = { id: 'web', surface: 'app', served: true, lane: { workflow: '.github/workflows/deploy-web.yml' }, deploymentEnvironment: '{app}-web' };
  const PLAYROW = { id: 'android-play', surface: 'app', served: false, submittable: true, submission: { workflow: '.github/workflows/submit-play.yml' }, deploymentEnvironment: '{app}-android-play' };

  const emitReal = (flagName) => spawnSync(process.execPath, [MONITOR, flagName], { cwd: REPO, encoding: 'utf8' });
  const parse = (stdout) =>
    stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean).map((l) => {
      const [workflow, kind, envs = ''] = l.split('\t');
      return { workflow, kind, environments: envs.split(',').filter(Boolean) };
    });

  function emitFixture(register) {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-release-lanes-'));
    try {
      mkdirSync(join(root, 'tooling'), { recursive: true });
      mkdirSync(join(root, 'catalog'), { recursive: true });
      writeFileSync(join(root, CHANNELS), JSON.stringify(register, null, 2));
      writeFileSync(join(root, CATALOGUE), JSON.stringify([{ slug: 'subscriptiontracker' }]));
      return spawnSync(process.execPath, [MONITOR, '--root', root, '--emit-release-lanes'], { cwd: REPO, encoding: 'utf8' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('S-15 THE REAL TREE: deploy-web is the served lane and the four app submission lanes are the others', () => {
    const r = emitReal('--emit-release-lanes');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const got = parse(r.stdout).map((l) => `${l.kind}:${l.workflow}`).sort();
    assert.deepEqual(got, [
      'served:deploy-web.yml',
      'submission:submit-appstore.yml',
      'submission:submit-play.yml',
      'submission:submit-snap.yml',
      'submission:submit-windows-store.yml',
    ]);
    assert.doesNotMatch(r.stdout, /extensions\.yml/, 'an extension build carries no APP_VERSION stamp and is no release lane');
  });

  test('S-16 THE REAL TREE BINDING: every environment a submission lane records into is one this reader reads', () => {
    const r = emitReal('--emit-release-lanes');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const slugs = JSON.parse(readFileSync(join(REPO, 'catalog', 'apps.json'), 'utf8')).map((a) => a.slug);
    let calls = 0;
    for (const lane of parse(r.stdout).filter((l) => l.kind === 'submission')) {
      // The same two normalisations the deploy-web binding above earned.
      const text = readFileSync(join(REPO, '.github', 'workflows', lane.workflow), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n')
        .replace(/\$\{\{\s*matrix\.app\s*\}\}/g, '{app}')
        .replace(/\$\{\{[^}]*\}\}/g, 'EXPR');
      for (const m of text.matchAll(/record-deployment\.mjs\s+(\S+)/g)) {
        calls += 1;
        const envs = m[1].includes('{app}') ? slugs.map((s) => m[1].replace('{app}', s)) : [m[1]];
        for (const env of envs) {
          assert.ok(
            lane.environments.includes(env),
            `${lane.workflow} records "${env}" but this reader looks for its Deployments on ${lane.environments.join(', ')}`,
          );
        }
      }
    }
    assert.ok(calls >= 3, `expected the Play, Snap and Windows Store lanes to record Deployments; found ${calls} call(s)`);
  });

  test('S-17 THIRD SURFACE: a submittable row on an undeclared surface is COULD NOT LOOK', () => {
    const r = emitFixture({
      surfaces: SURFACES,
      channels: [WEB, { ...PLAYROW, id: 'car-store', surface: 'car', submission: { workflow: '.github/workflows/submit-car.yml' }, deploymentEnvironment: '{app}-car-store' }],
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /whether its submitted builds carry an APP_VERSION stamp/);
  });

  test('S-18 a submittable EXTENSION row is no release lane; the app row beside it is', () => {
    const r = emitFixture({
      surfaces: SURFACES,
      channels: [WEB, PLAYROW, { id: 'amo', surface: 'extension', submittable: true, submission: { workflow: '.github/workflows/extensions.yml' }, deploymentEnvironment: '{app}-amo' }],
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n').sort(), [
      'deploy-web.yml\tserved\tsubscriptiontracker-web',
      'submit-play.yml\tsubmission\tsubscriptiontracker-android-play',
    ]);
  });

  test('S-19 a submittable app row with no submission.workflow is COULD NOT LOOK', () => {
    const { submission, ...noWorkflow } = PLAYROW;
    const r = emitFixture({ surfaces: SURFACES, channels: [WEB, noWorkflow] });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /is submittable but declares no submission\.workflow or deploymentEnvironment/);
  });

  test('S-20 THE ASYMMETRY HOLDS: no submission environment reaches the served set footing (b) reads', () => {
    const r = emitReal('--emit-served-environments');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /-android-play|-linux-snap|-windows-store|-appstore/);
  });

  test('S-23 a register with submission lanes and NO served lane is COULD NOT LOOK', () => {
    const r = emitFixture({ surfaces: SURFACES, channels: [PLAYROW] });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /no served lane in tooling\/channel-register\.json/);
  });
});

// ── ⏱ 2026-09-23 · ONE WORKFLOW IS ONE LANE, AND THE STRICTER FOOTING WINS ────
// linux-snap names submit-snap.yml as BOTH its `lane.workflow` and its
// `submission.workflow`. Today the row is `served: false`, so only the
// submission lane exists. The day it turns `served: true` (a store channel that
// went live and stays submittable) the first version of this reader made two
// lanes for one workflow and judged a snap stamp on the served footing, where a
// successful DRY RUN resolves. These cases flip that one field in a copy of the
// real tree, because the real register cannot show the state until it happens.
describe('check-prod-provenance — a row both served and submittable is judged as a submission', () => {
  const CHANNELS = 'tooling/channel-register.json';
  const SNAP = '.github/workflows/submit-snap.yml';
  const SHA7 = '7b7c7d7e' + '00112233445566778899aabbccddeeff';
  const WEB101 = { run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab', conclusion: 'success' };
  const ROW7 = { consent_artifacts: [{ marker: '1.0.7+7b7c7d7', n: 1 }] };

  /** A copy of what the monitor opens in offline mode, with linux-snap `served: true`. */
  function snapServedRoot() {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-snap-served-'));
    mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
    mkdirSync(join(root, 'catalog'), { recursive: true });
    cpSync(join(REPO, REGISTER), join(root, REGISTER));
    cpSync(join(REPO, 'tooling/legal/provider-register.json'), join(root, 'tooling/legal/provider-register.json'));
    cpSync(join(REPO, 'catalog/apps.json'), join(root, 'catalog/apps.json'));
    cpSync(join(REPO, MIGRATIONS), join(root, MIGRATIONS), { recursive: true });
    cpSync(join(REPO, 'services/platform/src'), join(root, 'services/platform/src'), { recursive: true });
    for (const e of readdirSync(join(REPO, 'apps'), { withFileTypes: true })) {
      const src = join(REPO, 'apps', e.name, 'pubspec.yaml');
      if (!e.isDirectory() || !existsSync(src)) continue;
      mkdirSync(join(root, 'apps', e.name), { recursive: true });
      cpSync(src, join(root, 'apps', e.name, 'pubspec.yaml'));
    }
    const reg = JSON.parse(readFileSync(join(REPO, CHANNELS), 'utf8'));
    const snap = reg.channels.find((c) => c.id === 'linux-snap');
    assert.equal(snap.served, false, 'the real linux-snap row is not served today; if it is, this copy tests nothing new');
    assert.equal(snap.lane.workflow, SNAP);
    assert.equal(snap.submission.workflow, SNAP);
    snap.served = true;
    writeFileSync(join(root, CHANNELS), JSON.stringify(reg, null, 2));
    return root;
  }

  function monitor(args, files = {}) {
    const root = snapServedRoot();
    try {
      const argv = [MONITOR, '--root', root, ...args];
      for (const [flagName, v] of Object.entries(files)) {
        const p = join(root, `${flagName.replace(/^--/, '')}.json`);
        writeFileSync(p, JSON.stringify(v));
        argv.push(flagName, p);
      }
      return spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('S-33 submit-snap.yml is emitted ONCE, as a submission lane, when its row is also served', () => {
    const r = monitor(['--emit-release-lanes']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const snapLines = r.stdout.trim().split('\n').filter((l) => l.startsWith('submit-snap.yml\t'));
    assert.deepEqual(snapLines, ['submit-snap.yml\tsubmission\tsubscriptiontracker-linux-snap']);
  });

  test('S-34 a successful snap DRY RUN with no Deployment stays unattributable when the row is also served', () => {
    const DRY = { path: SNAP, id: 35900000207, run_number: 7, run_attempt: 1, head_sha: SHA7, conclusion: 'success' };
    const r = monitor([], { '--rows-file': ROW7, '--runs-file': [WEB101, DRY], '--deployments-file': [] });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /submit-snap\.yml run 7 concluded `success` but no Deployment on subscriptiontracker-linux-snap names run 35900000207/);
  });

  test('S-35 a FAILED deploy-web run cannot borrow a snap upload\'s Deployment when the snap row is also served', () => {
    // The served ledger leaves out every environment a submission lane owns,
    // so footing (b) never reads a store upload as a web deploy.
    const WEB7 = { run_number: 7, head_sha: SHA7, conclusion: 'failure' };
    const SNAPDEP = { environment: 'subscriptiontracker-linux-snap', sha: SHA7, id: 7000000207, payload: { workflow: 'submit-snap.yml', run_id: 35900000299, run_attempt: 1, run_number: 9 } };
    const r = monitor([], { '--rows-file': ROW7, '--runs-file': [WEB101, WEB7], '--deployments-file': [SNAPDEP] });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /run 7 concluded `failure` and NO GitHub Deployment names 7b7c7d7 on a served environment/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 · A REFUSED GITHUB READ IS COULD NOT LOOK (exit 2), NEVER A BAD
// ATTESTATION (exit 1). The attestation loop read any non-200 on the commit as
// "not a commit" and any non-200 on the deployment list as "no Deployment
// exists", so a quota 403 paged as production rows that trace to no build.
// The three CONTROLS come first: the verdicts that ARE findings stay findings.
// ─────────────────────────────────────────────────────────────────────────────
describe('check-prod-provenance — manual-deploys attestation: a refused read is COULD NOT LOOK, never a bad attestation', () => {
  const SHA7 = 'e138f5b';
  const ENV = 'subscriptiontracker-web';
  const answer = (status, body) => ({ status, json: async () => body });
  const QUOTA = { message: 'API rate limit exceeded for installation.' };

  test('CONTROL — a commit GitHub finds is a commit', () => {
    assert.equal(attestationCommitRead(200, SHA7), 'commit');
  });

  test('CONTROL — a sha GitHub says is not a commit (404, 422) is still a finding', () => {
    assert.equal(attestationCommitRead(404, SHA7), 'not-a-commit');
    assert.equal(attestationCommitRead(422, SHA7), 'not-a-commit');
  });

  test('CONTROL — a Deployment list is returned as read, and an EMPTY one is still a finding for the caller', async () => {
    assert.deepEqual(await attestationDeployments(answer(200, [{ id: 1 }]), ENV, SHA7), [{ id: 1 }]);
    assert.deepEqual(await attestationDeployments(answer(200, []), ENV, SHA7), []);
  });

  test('🔴 a refused COMMIT read (401, 403 installation quota, 500, 503) is COULD NOT LOOK, not "not a commit"', () => {
    for (const status of [401, 403, 500, 503]) {
      assert.throws(
        () => attestationCommitRead(status, SHA7),
        (e) => e instanceof CouldNotLook && new RegExp(`returned ${status} reading commit e138f5b`).test(e.message),
        `HTTP ${status} on the commit must be CouldNotLook`,
      );
    }
  });

  test('🔴 a refused DEPLOYMENTS read is COULD NOT LOOK — it used to read as "no Deployment exists"', async () => {
    for (const status of [401, 403, 502]) {
      await assert.rejects(
        attestationDeployments(answer(status, QUOTA), ENV, SHA7),
        (e) => e instanceof CouldNotLook && new RegExp(`returned ${status} listing the Deployments of subscriptiontracker-web @ e138f5b`).test(e.message),
        `HTTP ${status} on the deployment list must be CouldNotLook`,
      );
    }
  });

  test('🔴 a deployment answer that is not a list is COULD NOT LOOK', async () => {
    await assert.rejects(attestationDeployments(answer(200, QUOTA), ENV, SHA7), (e) => e instanceof CouldNotLook && /without a list/.test(e.message));
  });

  test('🔴 a deployment answer that is not JSON is COULD NOT LOOK', async () => {
    const notJson = { status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    await assert.rejects(attestationDeployments(notJson, ENV, SHA7), (e) => e instanceof CouldNotLook && /other than JSON/.test(e.message));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// collectPaged — the paged-listing walker behind githubRuns/githubDeployments.
//
// 🔴 WHY THESE EXIST. Until 2026-09-22 both walkers were `out.push(...rows)`
// followed by `if (rows.length < 100) break;`: no de-duplication, no comparison
// against the API's OWN `total_count`, and a silent stop at the page cap. Each
// of the three turns an INCOMPLETE read into one that returns like a complete
// one, and this reader's whole contract is that "I could not look" (exit 2)
// must never read as "I looked and it was fine" (exit 0).
//
// The cases marked RED CONTROL are the proof the new refusals can fire at all;
// the cases around them are the proof they stay quiet on honest answers —
// including the EMPTY answer a Cloudflare Pages environment gives, which is a
// true reading of the GitHub ledger and must stay a clean pass.
//
// ⏱ CHANGED 2026-09-23 (O-PROVENANCE-MIN-CLAIM-PASSES-UNSTABLE-WALK): a walk is
// complete only when it is INTERNALLY CONSISTENT — one claim, no row served
// twice, as many distinct rows as claimed — and an inconsistent walk is walked
// again from page 1. The cases below that used to pass a duplicate or a growing
// claim now show the re-walk; the new cases, at production numbers, live in the
// sibling prod-provenance-walk.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
describe('collectPaged — a paged GitHub listing is read whole, or refused', () => {
  /** `n` rows whose ids start at `from` — the identity de-duplication rests on. */
  const rows = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i }));
  const idOf = (r) => r.id;
  const ids = (n, from = 1) => rows(n, from).map(idOf);
  /** The attempt count these cases pin, passed explicitly so a case reads alone. */
  const ATTEMPTS = 3;
  /** Canned pages, or a function of the attempt number when a re-walk is served differently. */
  const pageOf = (pages, page, attempt) => (typeof pages === 'function' ? pages(attempt) : pages)[page - 1] ?? { rows: [] };
  /** A walk over canned pages. Small perPage/pageCap so a case is readable; the
   *  pause between walks is recorded, never slept. */
  const walk = (pages) =>
    collectPaged({
      what: 'listing runs of ci.yml',
      idOf,
      perPage: 10,
      pageCap: 3,
      attempts: ATTEMPTS,
      sleep: async () => {},
      fetchPage: async (page, { attempt } = { attempt: 1 }) => pageOf(pages, page, attempt),
    });

  // ⏱ ADDED 2026-09-23 — the row's read-back clause: every walk leaves its numbers
  // behind (claimed, fetched, distinct, pages), so a false red is readable as a count.
  const walkLogged = (pages) => {
    const log = [];
    const done = collectPaged({
      what: 'listing runs of ci.yml',
      idOf,
      perPage: 10,
      pageCap: 3,
      attempts: ATTEMPTS,
      sleep: async () => {},
      log,
      fetchPage: async (page, { attempt } = { attempt: 1 }) => pageOf(pages, page, attempt),
    });
    return { log, done };
  };

  test('every walk records total_count, fetched, distinct and pages', async () => {
    const { log, done } = walkLogged([{ rows: rows(10), totalCount: 13 }, { rows: rows(3, 11), totalCount: 13 }]);
    await done;
    assert.deepEqual(log, [
      { what: 'listing runs of ci.yml', attempt: 1, attempts: ATTEMPTS, claimed: 13, claims: [13], fetched: 13, distinct: 13, pages: 2, consistent: true, why: null },
    ]);
  });

  test('a de-duplicated walk records MORE fetched than distinct — the duplicate is visible, and it is not a complete read', async () => {
    // ⏱ CHANGED 2026-09-23: this walk used to be returned. A row served twice
    // is a row some other row was pushed off the page for; with no total_count
    // to compare against, nothing else would ever notice the one never served.
    const { log, done } = walkLogged([{ rows: rows(10) }, { rows: [{ id: 10 }, { id: 11 }] }]);
    await assert.rejects(done, (e) => e instanceof CouldNotLook && /1 row\(s\) were served twice \(fetched 12, distinct 11\)/.test(e.message));
    assert.equal(log.length, ATTEMPTS, 'walked again from page 1, every time');
    for (const [i, w] of log.entries()) {
      assert.deepEqual(
        { attempt: w.attempt, claimed: w.claimed, fetched: w.fetched, distinct: w.distinct, pages: w.pages, consistent: w.consistent },
        { attempt: i + 1, claimed: null, fetched: 12, distinct: 11, pages: 2, consistent: false },
      );
    }
  });

  test('a walk that REFUSES still records its numbers first', async () => {
    const { log, done } = walkLogged([{ rows: rows(4), totalCount: 9 }]);
    await assert.rejects(done, (e) => e instanceof CouldNotLook);
    assert.equal(log.length, ATTEMPTS);
    for (const w of log) {
      assert.deepEqual({ claimed: w.claimed, fetched: w.fetched, distinct: w.distinct, pages: w.pages, consistent: w.consistent }, { claimed: 9, fetched: 4, distinct: 4, pages: 1, consistent: false });
    }
  });

  test('an honest single short page returns every row', async () => {
    assert.deepEqual((await walk([{ rows: rows(4), totalCount: 4 }])).map(idOf), ids(4));
  });

  test('an honest two-page listing returns both pages, in the order served', async () => {
    const got = await walk([{ rows: rows(10), totalCount: 13 }, { rows: rows(3, 11), totalCount: 13 }]);
    assert.deepEqual(got.map(idOf), ids(13));
  });

  test('zero rows is a COMPLETE READ, not a refusal — a Cloudflare Pages environment answers []', async () => {
    assert.deepEqual(await walk([{ rows: [] }]), []);
  });

  test('a listing that carries no total_count at all — the /deployments shape — is still read and returned', async () => {
    const got = await walk([{ rows: rows(10) }, { rows: rows(2, 11) }]);
    assert.deepEqual(got.map(idOf), ids(12));
  });

  test('a row re-served across pages is never returned twice: the walk is read again, and the clean read is returned', async () => {
    // ⏱ CHANGED 2026-09-23: attempt 1 re-serves id 10; attempt 2 is clean.
    const got = await walk((attempt) => (attempt === 1 ? [{ rows: rows(10) }, { rows: [{ id: 10 }, { id: 11 }] }] : [{ rows: rows(10) }, { rows: [{ id: 11 }] }]));
    assert.deepEqual(got.map(idOf), ids(11));
  });

  test('🔴 RED CONTROL: the API claims more rows than it served → COVERAGE LOST', async () => {
    await assert.rejects(
      walk([{ rows: rows(4), totalCount: 9 }]),
      (e) => e instanceof CouldNotLook && /said it had 9 row\(s\) and served 4 distinct one\(s\)/.test(e.message),
    );
  });

  test('🔴 RED CONTROL: a duplicate masking a row that fell off the end → COVERAGE LOST', async () => {
    // The exact shape a run completing mid-walk produces: 13 claimed, page 2
    // re-serves id 10, so 12 distinct rows arrive and one row is never served
    // at all. The pre-2026-09-22 walker returned 13 rows here — the right
    // LENGTH, the wrong CONTENT — and called the read complete.
    await assert.rejects(
      walk([{ rows: rows(10), totalCount: 13 }, { rows: [{ id: 10 }, { id: 11 }, { id: 12 }], totalCount: 13 }]),
      (e) => e instanceof CouldNotLook && /served 12 distinct one\(s\)/.test(e.message),
    );
  });

  test('🔴 RED CONTROL: every page full to the cap → the walk stopped short → COVERAGE LOST', async () => {
    await assert.rejects(
      walk([{ rows: rows(10) }, { rows: rows(10, 11) }, { rows: rows(10, 21) }]),
      (e) => e instanceof CouldNotLook && /all 3 pages of 10 came back full/.test(e.message),
    );
  });

  test('a total_count that GROWS under a live walk does not redden: the walk is read again, and the settled listing is returned', async () => {
    // Growth is not loss. A check that cries wolf on a list getting longer
    // while it is read gets muted, and a muted check is no check.
    // ⏱ CHANGED 2026-09-23: growth used to be let through by comparing the
    // SMALLEST claim — which is exactly what let the 09:28Z walk (384 claimed,
    // 439 served, 384 distinct) pass. Growth is now simply re-walked: attempt 1
    // claims 11 then 14 and is refused as a shifted listing; attempt 2 is whole.
    const got = await walk((attempt) =>
      attempt === 1
        ? [{ rows: rows(10), totalCount: 11 }, { rows: rows(3, 11), totalCount: 14 }]
        : [{ rows: rows(10), totalCount: 14 }, { rows: rows(4, 11), totalCount: 14 }],
    );
    assert.deepEqual(got.map(idOf), ids(14));
  });

  test('a claim larger than the cap can reach refuses for TRUNCATION, not for arithmetic', async () => {
    await assert.rejects(
      walk([{ rows: rows(10), totalCount: 500 }, { rows: rows(10, 11), totalCount: 500 }, { rows: rows(10, 21), totalCount: 500 }]),
      (e) => e instanceof CouldNotLook && /came back full/.test(e.message),
    );
  });

  test('a page that is not a list of rows is COULD NOT LOOK, never an empty read', async () => {
    await assert.rejects(
      walk([{ rows: null }]),
      (e) => e instanceof CouldNotLook && /a page of the listing was not an array of rows/.test(e.message),
    );
  });
});
