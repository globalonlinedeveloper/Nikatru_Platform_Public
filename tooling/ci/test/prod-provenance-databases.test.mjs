// ─────────────────────────────────────────────────────────────────────────────
// prod-provenance-databases.test.mjs — the failing cases for
// O-PROVENANCE-WALKS-ONE-DATABASE: [pipeline B-17]'s two limbs walk EVERY D1
// database the platform register's Workers own, not one hard-coded path.
//
// WHY THIS EXISTS. Until 2026-09-26 tooling/ops/check-prod-provenance.mjs read
// `services/platform/wrangler.jsonc` and nothing else, and
// tooling/prod-provenance.json registered no subscriptiontracker_db table, so a
// table added to the app database was enumerated by neither the gate nor the
// monitor, and both printed a clean total. The set is now
// tooling/ci/migration-tables.mjs `registeredD1Databases`: servingWorker, then
// each appWorker, every TOP-LEVEL D1 binding carrying `migrations_dir`.
//
// The cases, as the design numbers them:
//   R1  a table planted in a copy of the app database's migrations: the gate is
//       red (limb 2) and the monitor is COVERAGE LOST naming
//       `subscriptiontracker_db.planted`. Before this change both were green.
//   R3  a Worker the register gains, owning a database prod-provenance.json
//       does not name: COVERAGE LOST, naming it, in both limbs.
//   R4  a database prod-provenance.json names and no Worker owns: a finding.
//   R5  an `exempt` rule with a 5-character reason: a finding.
//   ENV `env.<name>.d1_databases` (the capture sandbox) is NOT walked — the lead
//       ruling of 2026-09-25. Held on the real tree and on a fixture.
//
// Every case runs the REAL gate and the REAL monitor over a COPY of the real
// tree (nothing under services/ is ever edited in place), the monitor in its
// offline `--rows-file` / `--runs-file` fixture mode. Nothing here reads or
// writes production. Every case is written out by hand.
//
// Run:  node --single-threaded --test tooling/ci/test/prod-provenance-databases.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  databaseLock,
  databaseSources,
  EXEMPT,
  exemptionProblem,
  MIN_EXEMPTION_REASON,
  PLATFORM_REGISTER_REL,
  registeredD1Databases,
} from '../migration-tables.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATE = join(REPO, 'tooling', 'ci', 'assert-prod-provenance.mjs');
const MONITOR = join(REPO, 'tooling', 'ops', 'check-prod-provenance.mjs');
const REGISTER = 'tooling/prod-provenance.json';
const APP_CONFIG = 'services/subscriptiontracker-api/wrangler.jsonc';
const APP_MIGRATIONS = 'services/subscriptiontracker-api/migrations';
/** One real run of the released-build lane, so the census can run at all. */
const RUNS = [{ run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab' }];

/** A copy of the real tree carrying what the gate and the offline monitor open. */
function realCopy() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-prov-dbs-'));
  const files = [
    REGISTER,
    'tooling/channel-register.json',
    'tooling/legal/provider-register.json',
    'catalog/apps.json',
    'tooling/ops/check-prod-provenance.mjs',
  ];
  for (const rel of files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  // The gate reads ops-watch.yml and deploy-workers.yml; the monitor, once a
  // workflow directory exists, reads every release lane's run host from it.
  cpSync(join(REPO, '.github'), join(root, '.github'), { recursive: true });
  for (const rel of databaseSources(REPO)) cpSync(join(REPO, rel), join(root, rel), { recursive: true });
  cpSync(join(REPO, 'services/platform/src'), join(root, 'services/platform/src'), { recursive: true });
  for (const e of readdirSync(join(REPO, 'apps'), { withFileTypes: true })) {
    const src = join(REPO, 'apps', e.name, 'pubspec.yaml');
    if (!e.isDirectory() || !existsSync(src)) continue;
    mkdirSync(join(root, 'apps', e.name), { recursive: true });
    cpSync(src, join(root, 'apps', e.name, 'pubspec.yaml'));
  }
  return root;
}

const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const writeJson = (root, rel, v) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), JSON.stringify(v, null, 2));
};

function gate(root) {
  return spawnSync(process.execPath, [GATE, root], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
}
function monitor(root, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-prov-dbs-fx-'));
  try {
    writeFileSync(join(dir, 'rows.json'), '{}');
    writeFileSync(join(dir, 'runs.json'), JSON.stringify(RUNS));
    const argv = [MONITOR, '--root', root, '--rows-file', join(dir, 'rows.json'), '--runs-file', join(dir, 'runs.json'), ...extra(dir)];
    return spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const noExtra = () => [];

/** A second app Worker the platform register gains, owning `probe_db`. */
function addProbeWorker(root, { registerDb }) {
  const reg = readJson(root, PLATFORM_REGISTER_REL);
  reg.appWorkers.push({ name: 'probe-api', entrypoint: 'services/probe-api/src/index.ts', config: 'services/probe-api/wrangler.jsonc', hosts: [], routes: [] });
  writeJson(root, PLATFORM_REGISTER_REL, reg);
  writeJson(root, 'services/probe-api/wrangler.jsonc', {
    name: 'probe-api',
    main: 'src/index.ts',
    d1_databases: [{ binding: 'APP_DB', database_name: 'probe_db', database_id: '00000000-0000-4000-8000-000000000001', migrations_dir: 'migrations' }],
  });
  mkdirSync(join(root, 'services/probe-api/migrations'), { recursive: true });
  writeFileSync(join(root, 'services/probe-api/migrations/0001_init.sql'), 'CREATE TABLE IF NOT EXISTS probes (id TEXT PRIMARY KEY, note TEXT);\n');
  if (registerDb) {
    const pp = readJson(root, REGISTER);
    pp.databases.probe_db = {
      wrangler: 'services/probe-api/wrangler.jsonc',
      migrationsDir: 'services/probe-api/migrations',
      tables: { probes: { resolver: EXEMPT, reason: 'NO app_version COLUMN: `id` and `note` only, and neither names a build, an app or a money world, so nothing here can be traced.' } },
    };
    writeJson(root, REGISTER, pp);
  }
}

// ── the derived set, on the real tree ───────────────────────────────────────
describe('the real tree: every database the register\'s Workers own, and only those', () => {
  test('the derived set is exactly platform_db then subscriptiontracker_db, each from its owner', () => {
    const { databases, problems } = registeredD1Databases(REPO);
    assert.deepEqual(problems, []);
    assert.deepEqual(
      databases.map((d) => [d.name, d.worker, d.binding, d.wrangler, d.migrationsDir, d.serving]),
      [
        ['platform_db', 'platform', 'PLATFORM_DB', 'services/platform/wrangler.jsonc', 'services/platform/migrations', true],
        ['subscriptiontracker_db', 'subscriptiontracker-api', 'APP_DB', APP_CONFIG, APP_MIGRATIONS, false],
      ],
    );
  });

  test('prod-provenance.json names exactly that set, with the same files (limb 10 green)', () => {
    const reg = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8'));
    assert.deepEqual(databaseLock(registeredD1Databases(REPO).databases, reg.databases), { unregistered: [], stale: [], mismatched: [] });
    assert.equal(reg.tables, undefined, 'the one-database `tables` must not survive beside `databases`');
    assert.equal(reg.migrationsDir, undefined);
  });

  test('🔴 ENV: the real configs DO declare env.sandbox databases carrying migrations_dir, and neither is walked', () => {
    // The exclusion is only a claim if there is something to exclude: the capture
    // sandbox's two databases are in the real configs, each with `migrations_dir`.
    const sandboxNames = [];
    for (const rel of ['services/platform/wrangler.jsonc', APP_CONFIG]) {
      const text = readFileSync(join(REPO, rel), 'utf8');
      for (const m of text.matchAll(/"database_name"\s*:\s*"([a-z_]+_sandbox)"/g)) sandboxNames.push(m[1]);
    }
    assert.deepEqual(sandboxNames.sort(), ['platform_db_sandbox', 'platform_db_sandbox', 'subscriptiontracker_db_sandbox']);
    const walked = registeredD1Databases(REPO).databases.map((d) => d.name);
    assert.equal(walked.includes('platform_db_sandbox'), false, 'env.sandbox of services/platform is walked');
    assert.equal(walked.includes('subscriptiontracker_db_sandbox'), false, 'env.sandbox of services/subscriptiontracker-api is walked');
  });

  test('the monitor prints one line per database, then the total, and every exempt table as exempt', () => {
    const r = monitor(REPO, noExtra);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /MONITOR · \[pipeline B-17\] · platform_db: 22 table\(s\) enumerated from services\/platform\/migrations \(17 migration file\(s\)\), 0 row\(s\)\n/);
    assert.match(
      r.stdout,
      /MONITOR · \[pipeline B-17\] · subscriptiontracker_db: 4 table\(s\) enumerated from services\/subscriptiontracker-api\/migrations \(2 migration file\(s\)\), 0 row\(s\) · 4 exempt table\(s\), not queried/,
    );
    assert.match(r.stdout, /MONITOR · \[pipeline B-17\] · 2 database\(s\) walked \(platform_db, subscriptiontracker_db\): 26 table\(s\), 0 row\(s\)/);
    assert.match(r.stdout, /subscriptiontracker_db migration ledger: NOT READ \(fixture mode, no --schema-file\)/);
    assert.match(r.stdout, /⬜ {2}payment_history {10}exempt — not queried {3}\[no marker · exempt\]/);
    assert.match(r.stdout, /4 exempt table\(s\) were not queried, and say so above/);
  });

  test('the gate prints both databases', () => {
    const r = gate(REPO);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ok {2}prod provenance — subscriptiontracker_db: 4 table\(s\) enumerated from services\/subscriptiontracker-api\/migrations \(2 migration file\(s\)\), 4 rule\(s\), 0 uncovered/);
    assert.match(r.stdout, /exempt: budget_categories, budgets, payment_history, subscriptions/);
    assert.match(r.stdout, /2 database\(s\), the set tooling\/platform-register\.json's Workers own: platform_db, subscriptiontracker_db/);
  });
});

// ── R1 · the row's red control ──────────────────────────────────────────────
describe('R1 · a table planted in the app database is seen by both limbs', () => {
  test('green control: the unmutated copy is exit 0 in both', () => {
    const root = realCopy();
    try {
      const g = gate(root);
      assert.equal(g.status, 0, g.stdout + g.stderr);
      const m = monitor(root, noExtra);
      assert.equal(m.status, 0, m.stdout + m.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 R1: CREATE TABLE planted in a copy of services/subscriptiontracker-api/migrations — gate 1, monitor 2', () => {
    const root = realCopy();
    try {
      writeFileSync(join(root, APP_MIGRATIONS, '0003_planted.sql'), 'CREATE TABLE planted (id TEXT);\n');
      const g = gate(root);
      assert.equal(g.status, 1, g.stdout + g.stderr);
      assert.match(g.stderr, /subscriptiontracker_db: `planted` is created by services\/subscriptiontracker-api\/migrations\/0003_planted\.sql and has NO rule/);
      const m = monitor(root, noExtra);
      assert.equal(m.status, 2, m.stdout + m.stderr);
      assert.match(m.stderr, /COVERAGE LOST — 1 table\(s\) the migrations create have NO rule in tooling\/prod-provenance\.json: subscriptiontracker_db\.planted\./);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── R3 · a database no entry names ──────────────────────────────────────────
describe('R3 · a Worker that owns a database prod-provenance.json does not name', () => {
  test('🔴 R3: COVERAGE LOST naming probe_db, in the monitor and in the gate', () => {
    const root = realCopy();
    try {
      addProbeWorker(root, { registerDb: false });
      const m = monitor(root, noExtra);
      assert.equal(m.status, 2, m.stdout + m.stderr);
      assert.match(m.stderr, /COVERAGE LOST — 1 database\(s\) a Worker in tooling\/platform-register\.json owns have NO entry in tooling\/prod-provenance\.json `databases`: probe_db \(services\/probe-api\/wrangler\.jsonc binding `APP_DB`\)/);
      const g = gate(root);
      assert.equal(g.status, 2, g.stdout + g.stderr);
      assert.match(g.stderr, /COVERAGE LOST — 1 database\(s\) a Worker in tooling\/platform-register\.json owns have no entry .*probe_db/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the same Worker WITH an entry is walked: its line prints and the monitor is green', () => {
    const root = realCopy();
    try {
      addProbeWorker(root, { registerDb: true });
      const m = monitor(root, noExtra);
      assert.equal(m.status, 0, m.stdout + m.stderr);
      assert.match(m.stdout, /3 database\(s\) walked \(platform_db, subscriptiontracker_db, probe_db\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── R4 · an entry no Worker owns ────────────────────────────────────────────
describe('R4 · prod-provenance.json names a database no Worker owns', () => {
  test('🔴 R4: the app Worker leaves the platform register — subscriptiontracker_db is a stale entry, exit 1 in both', () => {
    const root = realCopy();
    try {
      const reg = readJson(root, PLATFORM_REGISTER_REL);
      reg.appWorkers = reg.appWorkers.filter((w) => w.name !== 'subscriptiontracker-api');
      writeJson(root, PLATFORM_REGISTER_REL, reg);
      const m = monitor(root, noExtra);
      assert.equal(m.status, 1, m.stdout + m.stderr);
      assert.match(m.stderr, /databases\.subscriptiontracker_db: no Worker in tooling\/platform-register\.json owns a database of that name/);
      assert.match(m.stdout, /1 database\(s\) walked \(platform_db\)/);
      const g = gate(root);
      assert.equal(g.status, 1, g.stdout + g.stderr);
      assert.match(g.stderr, /declares `databases\.subscriptiontracker_db`, and no Worker in tooling\/platform-register\.json owns a database of that name/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 an entry whose migrationsDir is not its owner\'s is a finding, exit 1 in both', () => {
    const root = realCopy();
    try {
      const pp = readJson(root, REGISTER);
      pp.databases.subscriptiontracker_db.migrationsDir = 'services/subscriptiontracker-api/migrations-old';
      writeJson(root, REGISTER, pp);
      const m = monitor(root, noExtra);
      assert.equal(m.status, 1, m.stdout + m.stderr);
      assert.match(m.stderr, /databases\.subscriptiontracker_db\.migrationsDir is "services\/subscriptiontracker-api\/migrations-old", and the owning config gives "services\/subscriptiontracker-api\/migrations"/);
      const g = gate(root);
      assert.equal(g.status, 1, g.stdout + g.stderr);
      assert.match(g.stderr, /subscriptiontracker_db\.migrationsDir is "services\/subscriptiontracker-api\/migrations-old"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── R5 · an exemption is an argument ────────────────────────────────────────
describe('R5 · an `exempt` rule must argue for itself', () => {
  test('🔴 R5: a 5-character reason — exit 1 in the monitor and in the gate', () => {
    const root = realCopy();
    try {
      const pp = readJson(root, REGISTER);
      pp.databases.subscriptiontracker_db.tables.budgets.reason = 'n/a!!';
      writeJson(root, REGISTER, pp);
      const m = monitor(root, noExtra);
      assert.equal(m.status, 1, m.stdout + m.stderr);
      assert.match(m.stderr, /`budgets` is exempt with a reason of 5 character\(s\); an exemption needs 20\+/);
      const g = gate(root);
      assert.equal(g.status, 1, g.stdout + g.stderr);
      assert.match(g.stderr, /subscriptiontracker_db: `budgets` is exempt with a reason of 5 character\(s\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a reason that never names one of the columns — exit 1 in both', () => {
    const root = realCopy();
    try {
      const pp = readJson(root, REGISTER);
      const t = pp.databases.subscriptiontracker_db.tables.budgets;
      t.reason = t.reason.replaceAll('`monthly_budget`', 'the amount');
      writeJson(root, REGISTER, pp);
      const m = monitor(root, noExtra);
      assert.equal(m.status, 1, m.stdout + m.stderr);
      assert.match(m.stderr, /`budgets` is exempt and its reason never names `monthly_budget`/);
      const g = gate(root);
      assert.equal(g.status, 1, g.stdout + g.stderr);
      assert.match(g.stderr, /`budgets` is exempt and its reason never names `monthly_budget`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a column added to an exempt table re-opens the exemption', () => {
    const root = realCopy();
    try {
      appendFileSync(join(root, APP_MIGRATIONS, '0002_schema_debt.sql'), '\nALTER TABLE budgets ADD COLUMN currency TEXT;\n');
      const g = gate(root);
      assert.equal(g.status, 1, g.stdout + g.stderr);
      assert.match(g.stderr, /`budgets` is exempt and its reason never names `currency`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 app_version added to an exempt table must take released-build (limb 5)', () => {
    const root = realCopy();
    try {
      appendFileSync(join(root, APP_MIGRATIONS, '0002_schema_debt.sql'), '\nALTER TABLE subscriptions ADD COLUMN app_version TEXT;\n');
      const g = gate(root);
      assert.equal(g.status, 1, g.stdout + g.stderr);
      assert.match(g.stderr, /subscriptiontracker_db: `subscriptions` HAS an `app_version` column and declares resolver "exempt"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── ENV · env.<name> is not production ──────────────────────────────────────
describe('ENV · an environment block is never walked (lead ruling 2026-09-25)', () => {
  test('🔴 a sandbox database under env.sandbox, named by no entry, leaves both limbs green', () => {
    const root = realCopy();
    try {
      const cfg = {
        name: 'probe-api',
        main: 'src/index.ts',
        d1_databases: [{ binding: 'APP_DB', database_name: 'probe_db', database_id: '00000000-0000-4000-8000-000000000001', migrations_dir: 'migrations' }],
        env: {
          sandbox: {
            d1_databases: [{ binding: 'APP_DB', database_name: 'probe_db_sandbox', database_id: '00000000-0000-4000-8000-000000000002', migrations_dir: 'migrations' }],
          },
        },
      };
      addProbeWorker(root, { registerDb: true });
      writeJson(root, 'services/probe-api/wrangler.jsonc', cfg);
      assert.deepEqual(
        registeredD1Databases(root).databases.map((d) => d.name),
        ['platform_db', 'subscriptiontracker_db', 'probe_db'],
      );
      const m = monitor(root, noExtra);
      assert.equal(m.status, 0, m.stdout + m.stderr);
      assert.doesNotMatch(m.stdout + m.stderr, /probe_db_sandbox/);
      // The gate is red here for a reason of its own — nothing in deploy-workers.yml
      // applies probe_db's migrations (limb 9) — and still never names the sandbox.
      const g = gate(root);
      assert.match(g.stderr, /probe_db: .*deploy-workers\.yml has 0 job\(s\) that run `d1 migrations apply … --remote` in services\/probe-api/);
      assert.doesNotMatch(g.stdout + g.stderr, /probe_db_sandbox/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 the same binding moved to the TOP level IS walked — COVERAGE LOST naming it (the exclusion is the env block, nothing else)', () => {
    const root = realCopy();
    try {
      addProbeWorker(root, { registerDb: true });
      const cfg = readJson(root, 'services/probe-api/wrangler.jsonc');
      cfg.d1_databases.push({ binding: 'SANDBOX_DB', database_name: 'probe_db_sandbox', database_id: '00000000-0000-4000-8000-000000000002', migrations_dir: 'migrations' });
      writeJson(root, 'services/probe-api/wrangler.jsonc', cfg);
      const m = monitor(root, noExtra);
      assert.equal(m.status, 2, m.stdout + m.stderr);
      assert.match(m.stderr, /COVERAGE LOST — 1 database\(s\) .*probe_db_sandbox \(services\/probe-api\/wrangler\.jsonc binding `SANDBOX_DB`\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── the pending-migration path, per database ────────────────────────────────
describe('the schema reads run per database, against each one\'s own ledger', () => {
  test('🔴 an app table missing though its migration is recorded names subscriptiontracker_db, exit 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-prov-dbs-schema-'));
    try {
      const schema = {
        subscriptiontracker_db: {
          tables: ['subscriptions', 'budget_categories', 'payment_history', 'd1_migrations', '_cf_KV'],
          migrations: ['0001_init.sql', '0002_schema_debt.sql'],
        },
      };
      writeFileSync(join(dir, 'schema.json'), JSON.stringify(schema));
      const r = monitor(REPO, () => ['--schema-file', join(dir, 'schema.json')]);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /subscriptiontracker_db\.budgets: absent from production, yet 0001_init\.sql is recorded in `d1_migrations`/);
      assert.match(r.stdout, /subscriptiontracker_db migration ledger: 2 migration\(s\) recorded in `d1_migrations` · 3 of 4 table\(s\) present/);
      assert.match(r.stdout, /platform_db migration ledger: NOT READ \(fixture mode, the --schema-file names no schema for it\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── the pure readers ────────────────────────────────────────────────────────
describe('registeredD1Databases, databaseLock and exemptionProblem', () => {
  test('🔴 two Workers claiming one database by migrations_dir is a problem, not a silent pick', () => {
    const root = realCopy();
    try {
      const cfg = readJson(root, 'tooling/platform-register.json');
      cfg.appWorkers.push({ name: 'twin', config: 'services/twin/wrangler.jsonc' });
      writeJson(root, 'tooling/platform-register.json', cfg);
      writeJson(root, 'services/twin/wrangler.jsonc', {
        d1_databases: [{ binding: 'APP_DB', database_name: 'subscriptiontracker_db', database_id: '00000000-0000-4000-8000-000000000003', migrations_dir: 'migrations' }],
      });
      const { problems } = registeredD1Databases(root);
      assert.equal(problems.length, 1);
      assert.match(problems[0], /`subscriptiontracker_db` carries `migrations_dir` in both services\/subscriptiontracker-api\/wrangler\.jsonc and services\/twin\/wrangler\.jsonc/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 an unreadable platform register is a problem, never an empty set', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-prov-dbs-empty-'));
    try {
      const { databases, problems } = registeredD1Databases(root);
      assert.deepEqual(databases, []);
      assert.match(problems[0], /tooling\/platform-register\.json is unreadable/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('databaseLock reads both ways', () => {
    const derived = [{ name: 'a', wrangler: 'w/a.jsonc', migrationsDir: 'w/m', binding: 'A' }];
    assert.deepEqual(databaseLock(derived, { a: { wrangler: 'w/a.jsonc', migrationsDir: 'w/m' } }), { unregistered: [], stale: [], mismatched: [] });
    assert.deepEqual(databaseLock(derived, {}).unregistered, ['a (w/a.jsonc binding `A`)']);
    assert.deepEqual(databaseLock(derived, { a: { wrangler: 'w/a.jsonc', migrationsDir: 'w/m' }, b: {} }).stale, ['b']);
    assert.equal(databaseLock(derived, { a: { wrangler: 'w/other.jsonc', migrationsDir: 'w/m' } }).mismatched.length, 1);
  });

  test('exemptionProblem: a marker, a short reason, an unnamed column — and a column name inside a longer word does not count', () => {
    const cols = new Set(['id', 'user_id']);
    assert.equal(exemptionProblem('t', { resolver: 'released-build', marker: 'x' }, cols), null, 'not exempt: not judged here');
    assert.match(exemptionProblem('t', { resolver: EXEMPT, marker: 'id', reason: 'names `id` and `user_id` at length' }, cols), /declares marker `id`/);
    assert.match(exemptionProblem('t', { resolver: EXEMPT, reason: 'x'.repeat(MIN_EXEMPTION_REASON - 1) }, cols), /reason of 19 character\(s\)/);
    assert.match(exemptionProblem('t', { resolver: EXEMPT, reason: 'only `user_id` is named in this reason' }, cols), /never names `id`/);
    assert.equal(exemptionProblem('t', { resolver: EXEMPT, reason: 'names `id` and `user_id`, both of them' }, cols), null);
  });
});
