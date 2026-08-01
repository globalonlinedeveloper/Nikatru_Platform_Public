// ─────────────────────────────────────────────────────────────────────────────
// data-inventory.test.mjs — assert-data-inventory.mjs must be able to FAIL.
//
// [pipeline K-8]. The recorded mutation run is against a scratch COPY OF THE
// REAL REPOSITORY, 11/11 as intended, and it includes the INVERSE case that
// matters most: a commented-out `r2_buckets` block in a wrangler config must NOT
// register as a binding. This repo has already shipped a guard whose
// `grep '"r2_buckets"'` matched the comment explaining why there is no
// r2_buckets — the fix is to parse, not to grep, and the test below is what
// keeps it parsed.
//
// ⚠️ A FIXTURE AGREES WITH WHATEVER MISUNDERSTANDING WROTE IT. These are the
// regression net; the mutation run against the real tree is the proof.
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
const GUARD = join(CI_DIR, 'assert-data-inventory.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-inventory-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const write = (root, relPath, body) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

const DERIVATION = {
  migrationRoots: ['services'],
  minMigrationFiles: 1,
  wranglerRoots: ['services'],
  minWranglerConfigs: 1,
  pagesFunctionRoots: ['sites/nikatru/functions'],
  minPagesFunctionFiles: 1,
  minPagesKvBindings: 1,
};

const RETENTION_KINDS = {
  ttl: 'the store expires the record itself',
  keep: 'kept until deliberately deleted; needs a reason',
  undecided: 'nobody has decided; needs an ownerItem, prints every run',
  derived: 'a container, not a record',
};

const DEFAULT_STORES = [
  {
    id: 'd1:main_db',
    kind: 'd1-database',
    name: 'main_db',
    personalData: false,
    retention: { kind: 'derived', reason: 'a container' },
    writtenBy: ['services/api/wrangler.jsonc'],
  },
  {
    id: 'table:main_db.people',
    kind: 'd1-table',
    name: 'people',
    personalData: true,
    retention: { kind: 'keep', reason: 'the user asked us to hold it' },
    writtenBy: ['services/api/migrations/0001_init.sql'],
    disclosure: { page: 'privacy.html', quote: 'we store your email address' },
  },
  {
    id: 'kv:abc123',
    kind: 'kv-namespace',
    name: 'CACHE_KV',
    personalData: false,
    retention: { kind: 'keep', reason: 'a cache of public values' },
    writtenBy: ['services/api/wrangler.jsonc'],
  },
  {
    id: 'kv:site-signups',
    kind: 'kv-namespace-pages',
    name: 'SIGNUPS',
    personalData: true,
    retention: { kind: 'undecided', ownerItem: 'O-3', reason: 'no bound is set and none is invented here' },
    writtenBy: ['sites/nikatru/functions/api/subscribe.js'],
    disclosure: { page: 'privacy.html', quote: 'we store your email address' },
  },
];

const WRANGLER = `{
  // A comment mentioning r2_buckets must NOT read as a binding.
  // "r2_buckets": [{ "binding": "EXPORTS", "bucket_name": "ghost-bucket" }]
  "name": "api",
  "d1_databases": [
    { "binding": "MAIN_DB", "database_name": "main_db", "migrations_dir": "migrations" }
  ],
  "kv_namespaces": [{ "binding": "CACHE_KV", "id": "abc123" }]
}
`;

const MIGRATION = `-- A commented-out table is not a table.
-- CREATE TABLE ghosts (id TEXT);
CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, email TEXT);
INSERT INTO audit (note) VALUES ('CREATE TABLE not_a_table (x TEXT)');
`;

const SUBSCRIBE = `export async function onRequestPost({ env }) {
  await env.SIGNUPS.put('sub:x', '{}');
}
`;

const PRIVACY = '<html><body><main><h1>Privacy</h1><p>we store your email address and nothing else.</p></main></body></html>\n';

function fixture({ stores, derivation = {}, wrangler = WRANGLER, migration = MIGRATION, subscribe = SUBSCRIBE, privacy = PRIVACY, retentionKinds = RETENTION_KINDS, extraFiles = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });
  write(
    root,
    join('tooling', 'legal', 'data-inventory.json'),
    JSON.stringify(
      {
        derivation: { ...DERIVATION, ...derivation },
        retentionKinds,
        stores: stores ?? structuredClone(DEFAULT_STORES),
      },
      null,
      2,
    ),
  );
  if (wrangler !== null) write(root, join('services', 'api', 'wrangler.jsonc'), wrangler);
  if (migration !== null) write(root, join('services', 'api', 'migrations', '0001_init.sql'), migration);
  if (subscribe !== null) write(root, join('sites', 'nikatru', 'functions', 'api', 'subscribe.js'), subscribe);
  if (privacy !== null) write(root, join('sites', 'nikatru', 'privacy.html'), privacy);
  for (const [p, body] of Object.entries(extraFiles)) write(root, p.split('/').join(dirname('a/b') === 'a' ? '/' : '/'), body);
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-data-inventory — the baseline fixture is valid input', () => {
  test('a complete, consistent tree passes', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });

  test('a row with retention `undecided` PRINTS and does not fail the build', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /RETENTION UNDECIDED \(O-3\)/);
  });
});

describe('the both-directions relation', () => {
  test('a new table with no row FAILS', () => {
    const r = run(fixture({ migration: `${MIGRATION}CREATE TABLE support_tickets (id TEXT);\n` }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO row for it/);
  });

  test('a row whose store no longer exists FAILS — the wish-list direction', () => {
    const r = run(fixture({ migration: MIGRATION.replace('people', 'persons') }));
    assert.equal(r.status, 1);
    assert.match(out(r), /and NO such store exists in the tree/);
  });

  test('a new KV binding with no row FAILS', () => {
    const r = run(fixture({ wrangler: WRANGLER.replace('{ "binding": "CACHE_KV", "id": "abc123" }', '{ "binding": "CACHE_KV", "id": "abc123" }, { "binding": "SESSION_KV", "id": "def456" }') }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO row for it/);
  });

  test('a new R2 bucket with no row FAILS', () => {
    const r = run(fixture({ wrangler: WRANGLER.replace('"kv_namespaces"', '"r2_buckets": [{ "binding": "EXPORTS", "bucket_name": "app-exports" }],\n  "kv_namespaces"') }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO row for it/);
  });

  test('a commented-out binding is NOT a binding', () => {
    // The recorded failure this replaces: a grep for '"r2_buckets"' matched the
    // template comment explaining why there is no r2_buckets.
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.ok(!out(r).includes('ghost-bucket'));
  });

  test('a CREATE TABLE inside a comment or a string literal is NOT a table', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.ok(!out(r).includes('ghosts'));
    assert.ok(!out(r).includes('not_a_table'));
  });

  test('two rows with the same id FAIL', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores.push(structuredClone(DEFAULT_STORES[0]));
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /TWO rows with id/);
  });
});

describe('retention is declared, never invented', () => {
  test('a row with no retention at all FAILS', () => {
    const stores = structuredClone(DEFAULT_STORES);
    delete stores[1].retention;
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `retention`/);
  });

  test('`keep` with no written reason FAILS', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[1].retention = { kind: 'keep' };
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares retention `keep` with no `reason`/);
  });

  test('`undecided` with no ownerItem FAILS — a permanent exemption with a polite label', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[3].retention = { kind: 'undecided', reason: 'nobody has decided' };
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names no `ownerItem`/);
  });

  test('a retention kind outside the register\'s own dictionary FAILS', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[1].retention = { kind: 'forever-ish', reason: 'why not' };
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not in the register's own/);
  });
});

describe('a personal-data row quotes a sentence the notice still publishes', () => {
  test('a quote the page no longer makes FAILS', () => {
    const r = run(fixture({ privacy: '<html><body><main><h1>Privacy</h1><p>we store your contact details.</p></main></body></html>' }));
    assert.equal(r.status, 1);
    assert.match(out(r), /does not appear in the visible text of/);
  });

  test('a personal-data row with no disclosure at all FAILS', () => {
    const stores = structuredClone(DEFAULT_STORES);
    delete stores[1].disclosure;
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `disclosure`/);
  });

  test('a quote that only appears in an HTML comment does NOT satisfy the disclosure', () => {
    const r = run(fixture({ privacy: '<html><body><main><h1>Privacy</h1><!-- we store your email address --><p>nothing here.</p></main></body></html>' }));
    assert.equal(r.status, 1);
    assert.match(out(r), /does not appear in the visible text of/);
  });
});

describe('a row stays attached to the code that fills it', () => {
  test('a writer file that no longer exists FAILS', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[1].writtenBy = ['services/api/migrations/gone.sql'];
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names a writer/);
  });

  test('a writer that never mentions the store FAILS', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[3].writtenBy = ['services/api/wrangler.jsonc'];
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /never mentions/);
  });

  test('a row naming no writer at all FAILS', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[2].writtenBy = [];
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names no `writtenBy`/);
  });
});

describe('coverage self-checks — a walk that under-reaches is not a pass', () => {
  test('a missing register is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'tooling', 'legal', 'data-inventory.json'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /this guard compares the\s+tree to nothing and prints ok/);
  });

  test('a migration walk below its floor is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { minMigrationFiles: 5 } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /migration file\(s\) under/);
  });

  test('a wrangler walk below its floor is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { minWranglerConfigs: 4 } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /wrangler config\(s\), floor 4/);
  });

  test('a Pages-Function walk pointed at nothing is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { pagesFunctionRoots: ['sites/nowhere'] } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('a TOML wrangler config this walk cannot parse is COVERAGE LOST, not silently skipped', () => {
    const root = fixture();
    write(root, join('services', 'other', 'wrangler.toml'), 'name = "other"\n');
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /only parses JSON\/JSONC/);
  });

  test('a migration set with no CREATE TABLE at all is COVERAGE LOST', () => {
    const r = run(fixture({ migration: '-- nothing here\nALTER TABLE people ADD COLUMN x TEXT;\n' }));
    assert.equal(r.status, 1);
    assert.match(out(r), /ZERO CREATE TABLE statements/);
  });

  test('a migrations directory no wrangler config claims FAILS — its tables cannot be filed', () => {
    const root = fixture({ wrangler: WRANGLER.replace(', "migrations_dir": "migrations"', '') });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /no wrangler config claims with a `migrations_dir`/);
  });
});
