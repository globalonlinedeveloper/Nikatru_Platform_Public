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
// 2026-08-09 — the `ttl` limb, added with the first row that uses that kind
// (kv:nikatru-signups, once the owner declared 365 days). REAL-TREE MUTATION:
// `expirationTtl` renamed to `expirationTTL` throughout
// sites/nikatru/functions/api/subscribe.js — the row's only writer —
//   -> exit 1, "declares retention `ttl` and not one of its `writtenBy` files
//      sets an expiry". Restored byte-identical, guard re-verified exit 0.
// The limb exists because `ttl` is the only retention kind that asserts
// something about CODE, and until that row it had never been exercised: a `ttl`
// row whose writers set nothing keeps the record forever while printing NOTHING,
// which is strictly worse than the `undecided` it replaced.
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
  // Two rows owe an erasure story in the baseline fixture (the table and the
  // Pages KV namespace), so the floor is a real relationship here rather than a
  // zero that could never fire.
  minErasureRowsChecked: 2,
};

const ERASURE_KINDS = {
  purge: 'a `user_id` column, deleted by the route',
  unlink: 'a *_user_id reference, nulled by the route',
  pseudonymous: 'no column resolves to an account',
  'no-personal-data': 'nothing about a person',
  'no-route': 'nothing reaches it; needs blockedBy; prints',
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
    erasure: { kind: 'purge', route: 'services/api/src/routes/account.ts', reason: 'the row is theirs' },
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
    erasure: { kind: 'no-route', blockedBy: 'nothing in this tree deletes a signup key' },
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
CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, email TEXT, user_id TEXT);
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
        erasureKinds: ERASURE_KINDS,
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
  // The erasure route a `purge` / `unlink` row names must exist as a file.
  write(root, join('services', 'api', 'src', 'routes', 'account.ts'), 'export default {};\n');
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

  // 🔴 `ttl` is the one kind that asserts something about CODE. Before the
  // signup KV's period was declared (2026-08-09) no row used it, so this half
  // of the vocabulary — "the row names the code that sets the expiry" — had
  // never been checked once. These two cases are what make it a relationship.
  test('`ttl` whose writers set NO expiry FAILS — worse than `undecided`, because it prints nothing', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[3].retention = { kind: 'ttl', reason: 'the store expires it' };
    // The fixture's subscribe.js writes with a plain two-argument put.
    const r = run(fixture({ stores }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares retention `ttl` and not one of its `writtenBy` files sets an expiry/);
  });

  test('`ttl` passes once the named writer really sets one', () => {
    const stores = structuredClone(DEFAULT_STORES);
    stores[3].retention = { kind: 'ttl', reason: 'the store expires it' };
    const subscribe = `export async function onRequestPost({ env }) {
  await env.SIGNUPS.put('sub:x', '{}', { expirationTtl: 31536000 });
}
`;
    const r = run(fixture({ stores, subscribe }));
    assert.equal(r.status, 0, out(r));
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

// ─────────────────────────────────────────────────────────────────────────────
// THE ERASURE RELATION — [pipeline K-7].
//
// The gap this exists for was live in this repository: `provider_notifications`
// held the buyer's name and email verbatim and carried no `user_id`, so the
// schema-derived sweep in the account route could not see it — and the route
// answered `{ok:true}` anyway. A delete route that silently misses rows is worse
// than no delete route, because the user is told their data is gone.
//
// Every test below is a ONE-EDIT difference from the passing baseline, and the
// direction that matters most is the third: a row DECLARING itself unreachable
// about a table that has just become reachable. That is how a real gap gets a
// clean bill of health, and it is the case a fixture written by the same person
// who wrote the guard is least likely to think of, so it is written out here.
// ─────────────────────────────────────────────────────────────────────────────
const withStores = (mutate) => {
  const stores = structuredClone(DEFAULT_STORES);
  mutate(stores);
  return stores;
};
const tableRow = (stores) => stores.find((s) => s.id === 'table:main_db.people');

describe('every table declares how an erasure request reaches it', () => {
  test('a table row with NO `erasure` at all FAILS', () => {
    const r = run(fixture({ stores: withStores((s) => delete tableRow(s).erasure) }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no `erasure`/);
  });

  test('a `purge` row whose table has no `user_id` FAILS — the sweep never sees it', () => {
    const r = run(fixture({ migration: MIGRATION.replace(', user_id TEXT', '') }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares erasure `purge`, and no migration gives/);
  });

  test('a `pseudonymous` row whose table HAS a user column FAILS — the declaration went false', () => {
    // 🔴 THE DIRECTION THAT MATTERS MOST. "Nothing here can be addressed to a
    // person" is a claim about the schema, and a migration can falsify it
    // tomorrow. Without this, the row would go on saying "unreachable" about a
    // table an erasure request can now reach, and the gap would look closed.
    const r = run(
      fixture({
        stores: withStores((s) => {
          tableRow(s).erasure = { kind: 'pseudonymous', reason: 'keyed on an install id' };
        }),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /The declaration has become FALSE/);
  });

  test('a `no-personal-data` row on a table holding personal data FAILS', () => {
    const r = run(
      fixture({
        migration: MIGRATION.replace(', user_id TEXT', ''),
        stores: withStores((s) => {
          tableRow(s).erasure = { kind: 'no-personal-data', reason: 'nothing about anybody' };
        }),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /declares erasure `no-personal-data` while the row itself says/);
  });

  test('an `unlink` row naming a column no migration creates FAILS', () => {
    const r = run(
      fixture({
        stores: withStores((s) => {
          tableRow(s).erasure = {
            kind: 'unlink',
            column: 'claimed_user_id',
            route: 'services/api/src/routes/account.ts',
          };
        }),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /and no migration gives/);
  });

  test('an `unlink` row on a column outside the reference form FAILS — nothing nulls it', () => {
    const r = run(
      fixture({
        migration: MIGRATION.replace(', user_id TEXT', ', owner TEXT'),
        stores: withStores((s) => {
          tableRow(s).erasure = {
            kind: 'unlink',
            column: 'owner',
            route: 'services/api/src/routes/account.ts',
          };
        }),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /which does not end in/);
  });

  test('a column added by ALTER TABLE counts — this is how the real reach gap was closed', () => {
    // Migration 0006 adds `user_id` to an existing table with ALTER TABLE. A
    // column parser that only read CREATE TABLE would report the column absent
    // and fail a declaration that is correct — sending the fix to the wrong file.
    const r = run(
      fixture({
        migration: `${MIGRATION.replace(', user_id TEXT', '')}ALTER TABLE people ADD COLUMN user_id TEXT;\n`,
      }),
    );
    assert.equal(r.status, 0, out(r));
  });

  test('a `user_id` inside a CHECK constraint is NOT a column', () => {
    // Top-level comma splitting, not a regex over the whole body. Without it a
    // constraint mentioning the column name would satisfy a `purge` declaration
    // on a table that has no such column at all.
    const r = run(
      fixture({
        migration: MIGRATION.replace(
          ', user_id TEXT',
          ", note TEXT, CHECK (note NOT IN ('user_id', 'x'))",
        ),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /declares erasure `purge`, and no migration gives/);
  });

  test('a `purge` row naming a route file that does not exist FAILS', () => {
    const r = run(
      fixture({
        stores: withStores((s) => {
          tableRow(s).erasure.route = 'services/api/src/routes/gone.ts';
        }),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /names erasure route/);
  });

  test("an erasure kind outside the register's own vocabulary FAILS", () => {
    const r = run(
      fixture({
        stores: withStores((s) => {
          tableRow(s).erasure = { kind: 'handled', route: 'services/api/src/routes/account.ts' };
        }),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /erasureKinds` dictionary/);
  });

  test('`no-route` PRINTS with what blocks it, and does not fail the build', () => {
    // Owner-gated and architecture-gated gaps print. A guard that reddens main
    // on work nobody can do today is a guard somebody switches off.
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /ERASURE UNREACHABLE/);
    assert.match(out(r), /nothing in this tree deletes a signup key/);
  });

  test('`no-route` with no `blockedBy` FAILS — an exemption nobody owns', () => {
    const r = run(
      fixture({
        stores: withStores((s) => {
          s.find((x) => x.id === 'kv:site-signups').erasure = { kind: 'no-route' };
        }),
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /names no `blockedBy`/);
  });

  test('an `unverified` erasure question with no ownerItem FAILS, and with one PRINTS', () => {
    // Never invent a retention period, a statute or a regulator. An open legal
    // question is a legitimate declaration; an anonymous one is a permanent
    // exemption with a polite label.
    const nobody = run(
      fixture({
        stores: withStores((s) => {
          tableRow(s).erasure.unverified = { question: 'is there a statutory basis to retain?' };
        }),
      }),
    );
    assert.equal(nobody.status, 1);
    assert.match(out(nobody), /with no `ownerItem`/);

    const owned = run(
      fixture({
        stores: withStores((s) => {
          tableRow(s).erasure.unverified = {
            question: 'is there a statutory basis to retain?',
            ownerItem: 'O-3',
          };
        }),
      }),
    );
    assert.equal(owned.status, 0, out(owned));
    assert.match(out(owned), /ERASURE UNVERIFIED \(O-3\)/);
  });

  test('an erasure walk that checks fewer rows than the floor is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { minErasureRowsChecked: 9 } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /erasure declaration\(s\) were compared to the schema, floor 9/);
  });
});
