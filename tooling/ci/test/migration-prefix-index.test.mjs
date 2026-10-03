// ─────────────────────────────────────────────────────────────────────────────
// migration-prefix-index.test.mjs — redundantPrefixIndexes (tooling/ci/migration-tables.mjs)
// and the tooling/ci/check-migrations.mjs limb that runs it (⏱ 2026-10-01,
// rv2-services-034, row O-BRICK-REDUNDANT-USER-INDEX): no index that is a strict
// column-prefix of another on the same table. The brick's own `idx_records_user`
// is the red control, run against the real check-migrations.mjs on a copy of the
// tree with that line put back.
//
// Run:  node --test tooling/ci/test/migration-prefix-index.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createdIndexKeys, redundantPrefixIndexes } from '../migration-tables.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');
const BRICK_SQL = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/migrations/0001_init.sql';
const at = (dir, name, text) => ({ path: `${dir}/${name}`, text });

describe('redundantPrefixIndexes — what is compared', () => {
  test('🔴 RED: (user_id) beside (user_id, seq) and (user_id, id) is one finding naming both covers', () => {
    const got = redundantPrefixIndexes([
      at('d', '0001.sql', `CREATE TABLE r (id TEXT PRIMARY KEY, user_id TEXT, seq INTEGER);
CREATE INDEX IF NOT EXISTS idx_r_user ON r (user_id);
CREATE INDEX IF NOT EXISTS idx_r_pull ON r (user_id, seq);
CREATE INDEX IF NOT EXISTS idx_r_boot ON r (user_id, id);`),
    ]);
    assert.equal(got.length, 1);
    assert.deepEqual(
      { index: got[0].index, table: got[0].table, columns: got[0].columns, line: got[0].line, covers: got[0].coveredBy.map((c) => c.index) },
      { index: 'idx_r_user', table: 'r', columns: ['user_id'], line: 2, covers: ['idx_r_boot', 'idx_r_pull'] },
    );
  });

  test('🔴 RED: across two files of ONE directory, and with quoting, case and ASC/DESC differences', () => {
    const got = redundantPrefixIndexes([
      at('d', '0001.sql', 'CREATE INDEX "Idx_A" ON "t" ("a" ASC);\n'),
      at('d', '0002.sql', 'create index idx_ab on T (A desc, b);\n'),
    ]);
    assert.deepEqual(got.map((g) => [g.index, g.file]), [['idx_a', 'd/0001.sql']]);
  });

  test('GREEN: equal column lists, a different first column, and a different table are not prefixes', () => {
    assert.deepEqual(
      redundantPrefixIndexes([
        at('d', '0001.sql', `CREATE INDEX i1 ON t (a, b);
CREATE INDEX i2 ON t (a, b);
CREATE INDEX i3 ON t (b);
CREATE INDEX i4 ON u (a);`),
      ]),
      [],
    );
  });

  test('GREEN: a UNIQUE or partial short index enforces or covers something the longer does not', () => {
    assert.deepEqual(
      redundantPrefixIndexes([
        at('d', '0001.sql', `CREATE UNIQUE INDEX u1 ON t (a);
CREATE INDEX p1 ON t (b) WHERE b IS NOT NULL;
CREATE INDEX l1 ON t (a, c);
CREATE INDEX l2 ON t (b, c);`),
      ]),
      [],
    );
    // …and a partial LONGER index cannot stand in for a plain short one.
    assert.deepEqual(redundantPrefixIndexes([at('d', '0001.sql', 'CREATE INDEX s ON t (a);\nCREATE INDEX l ON t (a, b) WHERE b > 0;\n')]), []);
  });

  test('GREEN: a COLLATE difference and an expression column are not the same column', () => {
    assert.deepEqual(
      redundantPrefixIndexes([at('d', '0001.sql', 'CREATE INDEX s ON t (a COLLATE NOCASE);\nCREATE INDEX l ON t (a, b);\nCREATE INDEX e ON t (lower(a));\nCREATE INDEX e2 ON t (lower(a), b);\n')]),
      [],
    );
  });

  test('GREEN: a later DROP INDEX removes the short index; two directories never mix', () => {
    assert.deepEqual(
      redundantPrefixIndexes([
        at('d', '0001.sql', 'CREATE INDEX s ON t (a);\nCREATE INDEX l ON t (a, b);\n'),
        at('d', '0002.sql', 'DROP INDEX IF EXISTS s;\n'),
        at('e', '0001.sql', 'CREATE INDEX s ON t (a);\n'),
        at('f', '0001.sql', 'CREATE INDEX l ON t (a, b);\n'),
      ]),
      [],
    );
  });

  test('a CREATE INDEX inside a comment or a string is not an index', () => {
    assert.deepEqual(
      redundantPrefixIndexes([
        at('d', '0001.sql', "-- CREATE INDEX s ON t (a);\nCREATE INDEX l ON t (a, b);\nINSERT INTO notes VALUES ('CREATE INDEX x ON t (a)');\n"),
      ]),
      [],
    );
    assert.deepEqual([...createdIndexKeys([at('d', '0001.sql', '-- CREATE INDEX s ON t (a);\nCREATE INDEX l ON t (a, b);\n')])], ['d\u0000l']);
  });

  test('the real tree: the brick has none, and the three kept on applied schemas are exactly what is found', () => {
    const dirs = [
      'services/platform/migrations',
      'services/subscriptiontracker-api/migrations',
      BRICK_SQL.slice(0, BRICK_SQL.lastIndexOf('/')),
    ];
    const files = [];
    for (const d of dirs) {
      const r = spawnSync('git', ['-C', REPO, 'ls-files', '--', d], { encoding: 'utf8' });
      for (const f of r.stdout.trim().split('\n').filter((x) => x.endsWith('.sql'))) files.push({ path: f, text: readFileSync(join(REPO, f), 'utf8') });
    }
    assert.ok(files.length >= 25, `only ${files.length} migration file(s) read`);
    assert.deepEqual(
      redundantPrefixIndexes(files).map((g) => `${g.dir} ${g.index}`),
      [
        'services/platform/migrations idx_entitlements_user',
        'services/platform/migrations idx_bundle_grants_user',
        'services/subscriptiontracker-api/migrations idx_subscriptions_user',
      ],
    );
  });
});

describe('check-migrations.mjs — the limb, on a copy of the real tree', () => {
  let TMP;
  before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-prefix-index-')); });
  after(() => { rmSync(TMP, { recursive: true, force: true }); });
  let seq = 0;
  const COPIED = [
    'services/platform/migrations',
    'services/platform/wrangler.jsonc',
    'services/subscriptiontracker-api/migrations',
    'services/subscriptiontracker-api/wrangler.jsonc',
    'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/migrations',
    'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/wrangler.jsonc',
  ];
  function tree(edits = {}) {
    const root = join(TMP, `t${seq++}`);
    for (const rel of COPIED) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      cpSync(join(REPO, rel), join(root, rel), { recursive: true });
    }
    for (const [rel, f] of Object.entries(edits)) writeFileSync(join(root, rel), f(readFileSync(join(root, rel), 'utf8')));
    return root;
  }
  const run = (cwd) => {
    const r = spawnSync(process.execPath, [join(REPO, 'tooling', 'ci', 'check-migrations.mjs')], { cwd, encoding: 'utf8', timeout: 60_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  test('GREEN control: the copied tree is clean, and the three kept indexes are PRINTED', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /redundant prefix indexes KEPT on an applied schema[\s\S]*idx_entitlements_user[\s\S]*idx_bundle_grants_user[\s\S]*idx_subscriptions_user/);
  });

  test("🔴 RED CONTROL: the brick's idx_records_user put back is refused (exit 1), naming the line and both covering indexes", () => {
    const root = tree({
      [BRICK_SQL]: (t) => t.replace(
        '-- THE pull index:',
        'CREATE INDEX IF NOT EXISTS idx_records_user ON records (user_id);\n-- THE pull index:',
      ),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /0001_init\.sql:\d+ {2}REDUNDANT INDEX idx_records_user ON records \(user_id\) — a strict column-prefix of idx_records_boot \(user_id, id\), idx_records_pull \(user_id, server_seq\)/);
  });

  test('🔴 RED: a kept index dropped by a new migration makes its KEPT row stale, and the row is a finding', () => {
    const root = tree();
    writeFileSync(join(root, 'services/subscriptiontracker-api/migrations/0099_drop_redundant.sql'), 'DROP INDEX IF EXISTS idx_subscriptions_user;\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /KEPT_PREFIX_INDEXES names services\/subscriptiontracker-api\/migrations idx_subscriptions_user, which is no longer a redundant prefix index there/);
  });

  test('🔴 RED: a NEW redundant index on an applied schema is not covered by the kept rows', () => {
    const root = tree();
    writeFileSync(join(root, 'services/platform/migrations/0099_new.sql'), 'CREATE INDEX IF NOT EXISTS idx_signups_x ON signups (signed_up_at, email);\nCREATE INDEX IF NOT EXISTS idx_signups_y ON signups (signed_up_at);\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /REDUNDANT INDEX idx_signups_y ON signups \(signed_up_at\)/);
  });
});
