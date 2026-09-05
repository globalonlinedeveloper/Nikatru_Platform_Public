// ─────────────────────────────────────────────────────────────────────────────
// d1-sql-inventory.test.mjs — the negative cases for the two halves of the D1
// runtime-rejection guard: tooling/ci/assert-d1-sql-inventory.mjs (static) and
// tooling/ops/check-d1-accepts-live-sql.mjs (live), over the shared extraction
// in tooling/ci/d1-sql-inventory.mjs.
//
// 🔴 EVERY TREE CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// This repository has shipped a guard whose six fixture tests all passed against
// a broken version (assert-seams-wired.mjs): a fixture you write encodes the
// same misunderstanding as the guard you write. The copy carries the real
// services/platform, the real services/subly-api, the real e2e/ops/scripts
// harnesses and the tooling/ci modules the mechanism reads — so every mutation
// below is one somebody could make in a diff. The FIRST test runs against the
// true repository root, unmodified and untrimmed, so the trimming the copy does
// cannot hide a file the guard needs.
//
// ⚠️ THE ACCEPTED SHAPES ARE TESTED AS HARD AS THE REJECTED ONE. An over-broad
// prohibition is not the safe error: a guard that reddens the build on
// `pragma_table_info(?)` — which production D1 accepts — is a guard somebody
// switches off, and the shape it was really about walks back in behind the
// switch. Four accepted forms have their own passing cases here.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MEASURED_CAUSE,
  REJECTED_FIXTURE,
  classify,
  identifierRole,
  inventoryFile,
  isBareIdentifierExpression,
  isIntrospective,
  normaliseProse,
  scanPreparedCalls,
  scanSqlLiterals,
  violatesD1Authorizer,
  yieldsTableNames,
} from '../d1-sql-inventory.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STATIC_GUARD = join(REPO, 'tooling', 'ci', 'assert-d1-sql-inventory.mjs');
const LIVE_GUARD = join(REPO, 'tooling', 'ops', 'check-d1-accepts-live-sql.mjs');

const PLATFORM_ROUTE = 'services/platform/src/routes/account.ts';
const SUBLY_ROUTE = 'services/subly-api/src/routes/account.ts';
const SUBS_ROUTE = 'services/subly-api/src/routes/subscriptions.ts';

/** The tooling/ci modules the mechanism reads. The rest of that directory is
 *  scanned in the real-repo test below; trimming it here keeps ~25 tree copies
 *  under a megabyte each instead of 3.4 MB, and the trimming is stated rather
 *  than silent. */
const CI_MODULES = [
  'd1-sql-inventory.mjs',
  'assert-d1-sql-inventory.mjs',
  'text-reductions.mjs',
  'tree-walk.mjs',
  'assert-ops-register.mjs',
];

function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-d1-sql-'));
  for (const svc of ['services/platform', 'services/subly-api']) {
    mkdirSync(join(root, svc), { recursive: true });
    cpSync(join(REPO, svc, 'src'), join(root, svc, 'src'), { recursive: true });
    copyFileSync(join(REPO, svc, 'wrangler.jsonc'), join(root, svc, 'wrangler.jsonc'));
  }
  for (const d of ['tooling/e2e', 'tooling/ops', 'tooling/scripts']) {
    // SOURCE ONLY. The guard reads .ts/.js/.mjs; copying tooling/ops wholesale
    // dragged register.json (200 kB) into every one of the ~25 tree copies below
    // and put the file's runtime past two minutes.
    cpSync(join(REPO, d), join(root, d), {
      recursive: true,
      filter: (src) => !/\.[A-Za-z0-9]+$/.test(src) || /\.(?:ts|js|mjs|cjs)$/.test(src),
    });
  }
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  for (const m of CI_MODULES) copyFileSync(join(REPO, 'tooling', 'ci', m), join(root, 'tooling', 'ci', m));
  return root;
}

const runStatic = (root) => spawnSync(process.execPath, [STATIC_GUARD, root], { cwd: REPO, encoding: 'utf8' });

// ── ONE tree, snapshotted and restored around each case ─────────────────────
// A fresh copy per test put this file past two minutes on Windows: ~25 × (copy
// the tree + recursive delete) is filesystem time, not guard time. The tree is
// still the REAL one; what changed is that it is rebuilt from an in-memory
// snapshot instead of from disk. The restore recreates deleted files and removes
// added ones, so a test that deletes a whole directory is as safe as one that
// edits a line — and the snapshot is verified below by a test that mutates,
// restores, and re-runs the guard expecting green.
let SHARED = null;
const sharedTree = () => (SHARED ??= realTree());

function snapshotOf(root) {
  const snap = new Map();
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
      else snap.set(`${rel}${e.name}`, readFileSync(p));
    }
  };
  walk(root, '');
  return snap;
}

function restoreTo(root, snap) {
  const now = snapshotOf(root);
  for (const rel of now.keys()) if (!snap.has(rel)) rmSync(join(root, rel), { force: true });
  for (const [rel, buf] of snap) {
    const p = join(root, rel);
    if (!now.has(rel) || !now.get(rel).equals(buf)) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, buf);
    }
  }
}

after(() => {
  if (SHARED) rmSync(SHARED, { recursive: true, force: true });
});

function withTree(mutate, fn) {
  const root = sharedTree();
  const snap = snapshotOf(root);
  try {
    mutate(root);
    fn(runStatic(root), root);
  } finally {
    restoreTo(root, snap);
  }
}

const edit = (root, rel, fn) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const next = fn(before);
  assert.notEqual(next, before, `mutation of ${rel} changed nothing — the test would assert about an unmutated tree`);
  writeFileSync(p, next);
};

/** The real two-step walk's first statement, as both routes spell it.
 *
 * 🔴 THIS IS A PIN ON PRODUCTION SOURCE, SO EDITING EITHER ROUTE EXPIRES IT.
 * Measured 2026-09-05: wrapping the erasure preflight in the D1 retry helper
 * respelled the call from a bare `.prepare(` continuation to `db.prepare(`
 * inside `allRows(...)`, and every mutation keyed on this string stopped
 * applying. The suite did NOT go quietly green — `edit()` asserts the mutation
 * changed something, so it went RED with "mutation of ... changed nothing".
 * That assertion is the only reason this was caught, and it is why the pragma
 * replacements below survived untouched: `.prepare(` is still a SUBSTRING of
 * `db.prepare(`, so only the indent-anchored pin broke.
 * Re-derive this from the routes when it expires; never re-date it. */
const TWO_STEP =
  "    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)";
const replaceListing = (sql) => (root, rel = PLATFORM_ROUTE) =>
  edit(root, rel, (s) => s.replace(TWO_STEP, `    db.prepare(\`${sql}\`)`));

/** services/platform/src/backup/dump.ts's catalogue read — THE SECOND STATEMENT
 *  IN THIS REPOSITORY THAT LISTS A DATABASE'S TABLES, added 2026-09-05 with the
 *  nightly D1 export (research/revamp-2026-09-05/06 §4.2).
 *
 *  🔴 IT DID NOT ONLY MOVE A COUNT. The `only hole-free introspection is a
 *  pragma` case below works by leaving `services/platform` with NO table-listing
 *  statement, and `replaceListing` reaches `account.ts` alone — so the backup's
 *  own listing survived it and answered the question that case exists to ask.
 *  The case went red saying "no table name came back" instead of "nothing lists
 *  the tables", which is the very confusion its own comment warns about. The pin
 *  is extended rather than the expectation loosened.
 *
 *  Pinned on production source for the same reason TWO_STEP is, and it expires
 *  the same way: `edit()` asserts the mutation changed something, so respelling
 *  the statement in dump.ts turns this RED rather than quietly green. */
const BACKUP_DUMP = 'services/platform/src/backup/dump.ts';
const BACKUP_CATALOGUE =
  '      "SELECT type, name, tbl_name, sql FROM sqlite_master ' +
  "WHERE type IN ('table','index') ORDER BY type DESC, name\",";
const replaceBackupCatalogue = (sql) => (root) =>
  edit(root, BACKUP_DUMP, (s) => s.replace(BACKUP_CATALOGUE, `      "${sql}",`));
/** Adds a statement next to the real walk instead of replacing it — the right
 *  shape for asking "does R1 false-positive on this?", because replacing the
 *  listing also removes a fingerprint and answers a different question. */
const addStatement = (sql) => (root) =>
  edit(root, PLATFORM_ROUTE, (s) =>
    s.replace(TWO_STEP, `${TWO_STEP}\n    .prepare(\`${sql}\`)`),
  );

// ─────────────────────────────────────────────────────────────────────────────
describe('the real repository', () => {
  test('passes untrimmed, and says what it actually checked', () => {
    const r = spawnSync(process.execPath, [STATIC_GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /none names sqlite_master and calls a pragma_\* function in one/);
    assert.match(r.stdout, /2 database-owning service\(s\) each introspect their own schema, all 9 named/);
    assert.match(r.stdout, /cause sentence is pinned in all 3 places/);
    // The skip set is DERIVED and printed. An empty one is a COVERAGE LOST, and
    // a growing one is visible rather than quiet.
    assert.match(r.stdout, /file\(s\) carry the negative-control fixture and are outside R1 by derivation/);
  });

  test('the trimmed copy passes too, so the trimming hides nothing', () => {
    withTree(() => {}, (r) => assert.equal(r.status, 0, r.stderr));
  });

  test('🔴 the shared tree really is restored — a leaked mutation would make every later case lie', () => {
    // Every case below shares one tree. If `restoreTo` missed anything, the next
    // test would run against a mutated tree and its verdict would be about the
    // leak rather than about its own mutation — and the failure would look like
    // a real finding. So: delete a whole directory, confirm red, and confirm the
    // very next run is green again.
    withTree(
      (root) => rmSync(join(root, 'services'), { recursive: true, force: true }),
      (r) => assert.equal(r.status, 1),
    );
    assert.equal(runStatic(sharedTree()).status, 0, 'the tree did not come back');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R1 — the shapes production D1 REFUSES', () => {
  test('the pre-#256 correlated join is red', () => {
    withTree(
      replaceListing(
        "SELECT m.name AS tbl, p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
      ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R1\] services\/platform\/src\/routes\/account\.ts/);
        assert.match(r.stderr, /sends a statement D1 REFUSES TO RUN/);
      },
    );
  });

  test('the CTE rewrite — the "fix" the old wrong sentence licensed — is red', () => {
    withTree(
      replaceListing(
        "WITH t AS (SELECT name FROM sqlite_master WHERE type='table') SELECT t.name, p.name AS col FROM t JOIN pragma_table_info(t.name) p",
      ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R1\][\s\S]*WITH t AS/);
      },
    );
  });

  test('a correlated scalar subquery is red', () => {
    withTree(
      replaceListing(
        "SELECT name, (SELECT COUNT(*) FROM pragma_table_info(sqlite_master.name)) AS n FROM sqlite_master WHERE type='table'",
      ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R1\]/);
      },
    );
  });

  test('the same join spelled `sqlite_schema` is red', () => {
    withTree(
      replaceListing(
        "SELECT m.name, p.name AS col FROM sqlite_schema m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
      ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R1\]/);
      },
    );
  });
});

describe('R1 — the shapes production D1 ACCEPTS stay green', () => {
  // An over-broad prohibition gets the guard disabled, and then the illegal
  // shape walks back in behind the switch. Each of these was measured accepted
  // against both production databases on 2026-08-09.
  test('a pragma fed a VALUES list is green', () => {
    withTree(
      addStatement(
        "WITH t(name) AS (VALUES ('entitlements')) SELECT t.name, p.name AS col FROM t JOIN pragma_table_info(t.name) p",
      ),
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });

  test('a pragma fed a BOUND PARAMETER is green', () => {
    withTree(addStatement('SELECT name FROM pragma_table_info(?)'), (r) => assert.equal(r.status, 0, r.stderr));
  });

  test('a plain sqlite_master read is green', () => {
    withTree(addStatement("SELECT name, type FROM sqlite_master WHERE type = 'view'"), (r) =>
      assert.equal(r.status, 0, r.stderr),
    );
  });

  test('the rejected join in a COMMENT is green — both routes really carry one', () => {
    // The fixed files explain what was removed, verbatim. A raw grep for the
    // outage finds it in the file that no longer has it; comments come off first.
    withTree(
      (root) =>
        edit(root, SUBLY_ROUTE, (s) =>
          s.replace(
            'const account = new Hono<AppEnv>();',
            "// once: FROM sqlite_master m JOIN pragma_table_info(m.name) p\nconst account = new Hono<AppEnv>();",
          ),
        ),
      (r) => assert.equal(r.status, 0, r.stderr),
    );
    // …and the real tree's own headers are the standing case: both route files
    // contain the join in prose today and the guard passes.
    for (const rel of [PLATFORM_ROUTE, SUBLY_ROUTE]) {
      assert.match(
        readFileSync(join(REPO, rel), 'utf8'),
        /sqlite_master m JOIN pragma_table_info\(m\.name\) p/,
        `${rel} no longer carries the rejected join in prose — this test's premise is gone, not satisfied`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R2 — required coverage, both directions', () => {
  test('deleting subly-api\'s pragma step loses a NAMED statement, not just a count', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_ROUTE, (s) =>
          s.replace(
            ".prepare(`SELECT name FROM pragma_table_info('${table}')`)",
            ".prepare(`SELECT name FROM columns_cache WHERE tbl = '${table}'`)",
          ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R2 ii\][\s\S]*pragma_table_info/);
      },
    );
  });

  test('a service that owns a database and introspects nothing is red', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_ROUTE, (s) =>
          s
            .replace(
              ".prepare(`SELECT name FROM pragma_table_info('${table}')`)",
              ".prepare(`SELECT name FROM columns_cache WHERE tbl = '${table}'`)",
            )
            .replace(TWO_STEP, '    db.prepare(`SELECT tbl AS name FROM tables_cache ORDER BY tbl`)'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R2 i\] services\/subly-api owns subly_db and not one of its/);
      },
    );
  });

  test('a `.prepare` moved behind a helper is reported, never dropped', () => {
    withTree(
      (root) =>
        edit(root, PLATFORM_ROUTE, (s) =>
          s.replace(
            // Re-derived 2026-09-05. The `from` side was the bare
            // `await db` / `.prepare(` / `.all<...>()` chain. The erasure preflight
            // now goes through the D1 retry helper, so the real shape is an
            // `allRows(...)` call and the old `from` silently stopped matching --
            // caught only because `edit()` asserts the mutation changed something.
            // The intent is unchanged: put the SQL in a VARIABLE so the scanner
            // cannot read the literal, and assert it is REPORTED, not dropped.
            `  const listed = await allRows<{ name: string }>(\n${TWO_STEP},\n  );`,
            "  const listSql = `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`;\n  const listed = await allRows<{ name: string }>(db.prepare(listSql));",
          ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R2 iii\][\s\S]*its argument is not a single string or template literal/);
      },
    );
  });

  test('an empty services/ directory is COVERAGE LOST, not a pass', () => {
    withTree(
      (root) => rmSync(join(root, 'services'), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST[\s\S]*migrations_dir/);
      },
    );
  });

  test('an empty tooling domain is COVERAGE LOST — the harnesses hit the same databases', () => {
    withTree(
      (root) => {
        for (const d of ['e2e', 'ops', 'scripts', 'ci']) rmSync(join(root, 'tooling', d), { recursive: true, force: true });
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST[\s\S]*not one source file was found under/);
      },
    );
  });

  test('losing the negative-control fixture is COVERAGE LOST', () => {
    withTree(
      (root) => {
        // ALL THREE, because the skip set is derived from the IMPORTS and the
        // live half is an importer too. Deleting only the module left
        // check-d1-accepts-live-sql.mjs in the set and the guard passed — which
        // is correct, and is why this test names every member rather than the
        // one that felt like the source.
        rmSync(join(root, 'tooling', 'ci', 'd1-sql-inventory.mjs'), { force: true });
        rmSync(join(root, 'tooling', 'ci', 'assert-d1-sql-inventory.mjs'), { force: true });
        rmSync(join(root, 'tooling', 'ops', 'check-d1-accepts-live-sql.mjs'), { force: true });
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST[\s\S]*negative-control fixture lives nowhere/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R3 — interpolated identifiers are constrained', () => {
  test('dropping the identifier regex from the shared erasure route is red', () => {
    withTree(
      (root) =>
        edit(root, PLATFORM_ROUTE, (s) =>
          s.replace(/\/\^\[A-Za-z_\]\[A-Za-z0-9_\$\]\*\$\/\.test\(/g, 'Boolean('),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R3\] services\/platform\/src\/routes\/account\.ts[\s\S]*DELETE FROM/);
      },
    );
  });

  test('widening subscriptions.ts\'s closed column union to `string` is red', () => {
    withTree(
      (root) =>
        edit(root, SUBS_ROUTE, (s) =>
          s.replace(/type Column =[\s\S]*?';\n/, 'type Column = string;\n'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R3\] services\/subly-api\/src\/routes\/subscriptions\.ts/);
      },
    );
  });

  test('the passing case names the evidence rather than printing a bare ok', () => {
    withTree(() => {}, (r) => {
      assert.match(r.stdout, /\[R3\][\s\S]*the identifier regex is applied in this file/);
      assert.match(r.stdout, /\[R3\][\s\S]*the file declares a closed string-literal union/);
      assert.match(r.stdout, /\[R3\][\s\S]*is bound from an inline literal array/);
      assert.match(r.stdout, /\[R3\][\s\S]*sits inside SQL identifier quotes/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R4 — the cause sentence cannot drift from the constant', () => {
  test('changing the claim in one file is red', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_ROUTE, (s) =>
          s.replace('pragma_* table-valued function is rejected', 'pragma_* table-valued function is fine'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R4\] services\/subly-api\/src\/routes\/account\.ts/);
      },
    );
  });

  test('deleting it from the e2e verifier is red', () => {
    withTree(
      (root) =>
        edit(root, 'tooling/e2e/verify_purged.mjs', (s) =>
          s.replace('any single statement that names sqlite_master/sqlite_schema', 'the query'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /\[R4\] tooling\/e2e\/verify_purged\.mjs/);
      },
    );
  });

  test('re-wrapping it to another column width still passes — the pin is not about line breaks', () => {
    withTree(
      (root) =>
        edit(root, PLATFORM_ROUTE, (s) => {
          const one = normaliseProse(MEASURED_CAUSE);
          // Same sentence, wrapped at 40 columns instead of ~78.
          const rewrapped = one
            .split(' ')
            .reduce((acc, w) => {
              const last = acc[acc.length - 1];
              if (last.length + w.length > 40) acc.push(` * ${w}`);
              else acc[acc.length - 1] = `${last} ${w}`;
              return acc;
            }, [' *'])
            .join('\n');
          const start = s.indexOf('any single statement that names');
          const end = s.indexOf('plain sqlite_master read.') + 'plain sqlite_master read.'.length;
          return `${s.slice(0, start)}\n${rewrapped}\n *${s.slice(end)}`;
        }),
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the detector\'s own controls', () => {
  test('it flags the fixture the live check sends', () => {
    assert.equal(violatesD1Authorizer(REJECTED_FIXTURE), true);
  });

  test('it clears every shape production D1 was measured to accept', () => {
    for (const sql of [
      "SELECT name FROM pragma_table_info('subscriptions')",
      'SELECT name FROM pragma_table_info(?)',
      "WITH t(name) AS (VALUES ('x')) SELECT t.name, p.name FROM t JOIN pragma_table_info(t.name) p",
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ]) {
      assert.equal(violatesD1Authorizer(sql), false, sql);
    }
  });

  test('a broken detector is caught before any tree is read', () => {
    // The guard runs both controls at startup. Point it at an empty directory:
    // if it got as far as the domain walk it would say so, and if a control had
    // failed it would say THAT instead. This pins the ordering.
    const empty = mkdtempSync(join(tmpdir(), 'nikatru-d1-empty-'));
    try {
      const r = runStatic(empty);
      assert.equal(r.status, 1);
      assert.doesNotMatch(r.stderr, /the prohibition does not flag its own fixture/);
      assert.match(r.stderr, /COVERAGE LOST/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the extraction', () => {
  test('comments come off first, so prose cannot be mistaken for a statement', () => {
    const src = `// FROM sqlite_master m JOIN pragma_table_info(m.name) p\nconst x = 1;\n`;
    assert.equal(inventoryFile('a.ts', src).statements.length, 0);
  });

  test('a regex literal containing a backtick does not swallow the rest of the file', () => {
    const src = "const RE = /[\"'`\\[]?/;\nconst q = `SELECT name FROM sqlite_master WHERE type = 'table'`;\n";
    const found = scanSqlLiterals(src);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0].sql, /^SELECT name FROM sqlite_master/);
  });

  test('a trailing comma is not a second argument', () => {
    const calls = scanPreparedCalls('db\n  .prepare(\n    `SELECT a FROM t WHERE b = ?`,\n  )\n');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].parsed, true, JSON.stringify(calls[0]));
  });

  test('`.exec` on a REGEX is not a D1 call', () => {
    const calls = scanPreparedCalls("const m = /^Bearer\\s+(.+)$/i.exec(header);\n");
    assert.equal(calls.length, 0, JSON.stringify(calls));
  });

  test('`.exec` on a D1 handle IS a D1 call', () => {
    const calls = scanPreparedCalls('await c.env.PLATFORM_DB.exec(statements);\n');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].parsed, false);
  });

  test('`.batch` is a composition, not an unreadable statement', () => {
    const calls = scanPreparedCalls('await db.batch(ops);\n');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].composition, true);
    assert.equal(calls[0].parsed, true);
  });

  test('holes are captured in order, and the SQL keeps their positions', () => {
    const [st] = scanSqlLiterals('const q = `UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`;\n');
    assert.deepEqual(st.holes, ['table', 'column', 'column']);
    assert.equal(st.sql, 'UPDATE {{0}} SET {{1}} = NULL WHERE {{2}} = ?');
    assert.equal(classify(st.sql, st.holes), 'dynamic-identifier');
  });

  test('a pragma argument is a TABLE position even though it is quoted', () => {
    const [st] = scanSqlLiterals("const q = `SELECT name FROM pragma_table_info('${table}')`;\n");
    assert.equal(identifierRole(st.sql, 0), 'table');
    assert.equal(classify(st.sql, st.holes), 'introspective');
  });

  test('a SQL FRAGMENT is not a bare identifier, so the live half will not invent one', () => {
    assert.equal(isBareIdentifierExpression('table'), true);
    assert.equal(isBareIdentifierExpression('q.table'), true);
    assert.equal(isBareIdentifierExpression("sets.join(', ')"), false);
    assert.equal(isBareIdentifierExpression('a + b'), false);
  });

  test('an HTTP method string is not a statement', () => {
    assert.equal(scanSqlLiterals("await fetch(u, { method: 'DELETE' });\n").length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHICH INTROSPECTIVE ANSWER NAMES TABLES. Narrower than isIntrospective on
// purpose, and the gap between the two is where the 2026-08-25 regression lived.
// ─────────────────────────────────────────────────────────────────────────────
const LISTING_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";
const PAYMENT_PROBE = "SELECT name FROM pragma_table_info('payment_history')";

describe('yieldsTableNames', () => {
  test('a schema-table read names tables, both spellings', () => {
    assert.equal(yieldsTableNames(LISTING_SQL), true);
    assert.equal(yieldsTableNames('SELECT name FROM sqlite_schema'), true);
  });

  test("🔴 a pragma names ONE TABLE'S COLUMNS — the answer that was read as a schema", () => {
    // services/platform/src/renewals.ts sends this verbatim to decide whether
    // payment_history carries updated_at. Its rows are id, subscription_id,
    // user_id, amount, paid_at, updated_at. Read as a table list, they sent the
    // live half looking for a table called `updated_at`.
    assert.equal(yieldsTableNames(PAYMENT_PROBE), false);
    assert.equal(yieldsTableNames("SELECT name FROM pragma_table_info('{{0}}')"), false);
    assert.equal(yieldsTableNames('PRAGMA table_info(payment_history)'), false);
  });

  test('the statement that names BOTH is not a listing either', () => {
    assert.equal(yieldsTableNames(REJECTED_FIXTURE), false);
  });

  test('it is strictly narrower than isIntrospective, which is the whole point', () => {
    const all = [LISTING_SQL, PAYMENT_PROBE, REJECTED_FIXTURE];
    assert.deepEqual(all.map(isIntrospective), [true, true, true]);
    assert.deepEqual(all.map(yieldsTableNames), [true, false, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE HALF, driven by --fixture. Every branch that decides an exit code is
// reachable offline; what a fixture cannot prove — that D1 still answers this
// way — is exactly what the scheduled and deploy-time runs are for.
// ─────────────────────────────────────────────────────────────────────────────
const REFUSAL = { success: false, errors: [{ code: 7500, message: 'not authorized: SQLITE_AUTH' }] };
const rows = (names, changes = 0) => ({
  success: true,
  result: [{ results: names.map((name) => ({ name })), meta: { changes } }],
});

const noSuchTable = (t) => ({
  success: false,
  errors: [{ code: 7500, message: `no such table: ${t}: SQLITE_ERROR` }],
});

const LISTING = LISTING_SQL;
const COLUMNS = "SELECT name FROM pragma_table_info('subscriptions')";
/** The hole-free column probe services/platform/src/renewals.ts sends, and the
 *  six names payment_history really answers it with. 🔴 IT IS IN THE DEFAULT
 *  FIXTURE DELIBERATELY: leaving it out is what let every case below pass while
 *  the deploy job exited 2, because an unanswered key falls to `*` and returns
 *  no rows, and no rows cannot be mistaken for a schema. A fixture that does not
 *  answer what production answers is not a control. */
const PAYMENT = PAYMENT_PROBE;
const PAYMENT_COLUMNS = ['id', 'subscription_id', 'user_id', 'amount', 'paid_at', 'updated_at'];

/** A fixture that answers the way production did on 2026-08-09, with the one
 *  thing under test overridden. Keys are the NORMALISED SQL the reader looks up.
 *  `columns` must carry a `*_user_id` name or the UPDATE cannot be instantiated
 *  — which is itself a `COULD NOT LOOK`, and is its own case below. */
const liveFixture = (over = {}) => ({
  [REJECTED_FIXTURE]: REFUSAL,
  [LISTING]: rows(['subscriptions']),
  [COLUMNS]: rows(['user_id', 'claimed_user_id']),
  [PAYMENT]: rows(PAYMENT_COLUMNS),
  '*': rows([], 0),
  ...over,
});

/** The same fixture, plus the answer a REAL database gives when this checker
 *  mistakes a column for a table. Without these keys the `*` fallback reports
 *  success for `DELETE FROM updated_at`, and a bad substitution reads as a
 *  clean execution — the one outcome this whole family exists to refuse. */
const liveFixtureAnsweringNoSuchTable = (over = {}) => {
  const f = liveFixture();
  for (const c of PAYMENT_COLUMNS) {
    f[`SELECT name FROM pragma_table_info('${c}')`] = rows([]);
    f[`DELETE FROM ${c} WHERE user_id = ?`] = noSuchTable(c);
  }
  return { ...f, ...over };
};

function runLive(fixtureBody, root) {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-d1-fx-'));
  const f = join(dir, 'fixture.json');
  writeFileSync(f, JSON.stringify(fixtureBody));
  try {
    return spawnSync(process.execPath, [LIVE_GUARD, '--root', root, '--fixture', f], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const withLive = (fixtureBody, fn) => {
  const root = sharedTree();
  const snap = snapshotOf(root);
  try {
    fn(runLive(fixtureBody, root));
  } finally {
    restoreTo(root, snap);
  }
};

describe('check-d1-accepts-live-sql.mjs — the exit contract', () => {
  test('offline mode announces itself unmistakably', () => {
    withLive(liveFixture(), (r) => {
      assert.match(r.stdout, /!! {2}OFFLINE FIXTURE MODE/);
    });
  });

  test('control refused + everything accepted + changes=0 ⇒ 0', () => {
    withLive(liveFixture(), (r) => {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /step 0 — the known-refused statement IS refused/);
      assert.match(r.stdout, /PASS: every introspective and mutating statement/);
    });
  });

  test('🔴 a control that comes back ACCEPTED ⇒ 2, and nothing else is believed', () => {
    withLive(liveFixture({ [REJECTED_FIXTURE]: rows(['subscriptions']) }), (r) => {
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /NEGATIVE CONTROL WAS NOT REFUSED/);
      assert.doesNotMatch(r.stdout, /PASS: every introspective/);
    });
  });

  test('a statement D1 refuses ⇒ 1', () => {
    withLive(liveFixture({ [LISTING]: REFUSAL }), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /D1 REFUSES A STATEMENT THIS REPOSITORY DEPLOYS/);
    });
  });

  test('a guarded write that CHANGED a row ⇒ 1', () => {
    withLive(liveFixture({ '*': rows([], 3) }), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /reported 3 change\(s\)/);
    });
  });

  test('🔴 a refusal and a blind read together ⇒ 1, never 2 — the finding is not buried', () => {
    const f = liveFixture({ [LISTING]: REFUSAL });
    delete f['*'];
    withLive(f, (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /COULD NOT LOOK/);
      assert.match(r.stderr, /D1 REFUSES A STATEMENT THIS REPOSITORY DEPLOYS/);
    });
  });

  test('an answer this reader cannot interpret ⇒ 2, never 0', () => {
    withLive({ [REJECTED_FIXTURE]: REFUSAL }, (r) => {
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /COULD NOT LOOK/);
    });
  });

  test('an empty schema read ⇒ 2, not a clean sweep over nothing', () => {
    withLive(liveFixture({ [LISTING]: rows([]) }), (r) => {
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /no table name came back/);
    });
  });

  test('a mutating statement that could not be instantiated ⇒ 2, and is NAMED', () => {
    // No `*_user_id` column anywhere in the live schema, so the UPDATE cannot be
    // sent verbatim. Not executing a deployed statement is a gap, not a pass.
    withLive(liveFixture({ [COLUMNS]: rows(['id', 'name']) }), (r) => {
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /could not be instantiated against/);
    });
  });

  test('🔴 THE 2026-08-25 REGRESSION — a pragma answer must not become the candidate table set', () => {
    // services/platform/src/routes/account.ts was NOT TOUCHED by the release
    // that reddened this check (`git diff a028cc0 b8d2481 -- <that file>` is
    // empty). What the release added was a hole-free
    // `pragma_table_info('payment_history')` in renewals.ts, probing for the
    // updated_at column. This step harvested candidates from EVERY hole-free
    // introspective answer, so the six COLUMNS of payment_history became the
    // schema of subly_db: `DELETE FROM updated_at WHERE user_id = ?` came back
    // `no such table: updated_at`, both erasure statements went uninstantiated,
    // and the deploy job exited 2 over SQL that had not changed.
    withLive(liveFixtureAnsweringNoSuchTable(), (r) => {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stderr, /could not be instantiated against/);
      assert.doesNotMatch(r.stderr, /no such table: updated_at/);
      // 🔴 THE PROBE IS STILL EXECUTED. The fix narrows what its answer MEANS;
      // skipping the statement would be the loosening this file refuses.
      assert.match(r.stdout, /step 1 — services\/platform\/src\/renewals\.ts:\d+ accepted, 6 row\(s\)/);
      // …and both erasure statements ran against a REAL table.
      assert.match(r.stdout, /step 2 — services\/platform\/src\/routes\/account\.ts:\d+ executed on subscriptions, changes=0/);
      // 4, not 3, since 2026-09-05: the nightly export's catalogue read in
      // services/platform/src/backup/dump.ts is a fourth introspective statement
      // this Worker deploys, so it is a fourth one the live half must execute.
      // The number is the COUNT OF DEPLOYED STATEMENTS, so it moves whenever the
      // Worker gains or loses one — that is the pin working, not drifting.
      assert.match(r.stdout, /ok {2}platform_db — 4 introspective and 2 mutating statement\(s\) executed/);
    });
  });

  test('🔴 the fix does not loosen: a real table the authorizer refuses is still 1, not 0', () => {
    withLive(liveFixtureAnsweringNoSuchTable({ 'DELETE FROM subscriptions WHERE user_id = ?': REFUSAL }), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /D1's authorizer will not run `DELETE FROM subscriptions WHERE user_id = \?`/);
      assert.match(r.stderr, /D1 REFUSES A STATEMENT THIS REPOSITORY DEPLOYS/);
    });
  });

  test('a service whose only hole-free introspection is a pragma ⇒ 2, saying THAT, not "empty schema"', () => {
    // The two empty cases have opposite causes: a schema read that came back
    // empty is a broken read of a real database; no schema read at all is an
    // inventory that never asked. Printing the first over the second sends a
    // reader hunting a credential problem that is not there.
    const root = sharedTree();
    const snap = snapshotOf(root);
    try {
      replaceListing(COLUMNS)(root);
      // 🔴 BOTH LISTINGS, OR THE CASE IS NOT THE CASE. `services/platform` gained
      // a second table-listing statement on 2026-09-05 (the nightly export's
      // catalogue read); replacing only the route's left one behind, so the tree
      // still listed tables and this test measured a different condition.
      replaceBackupCatalogue(COLUMNS)(root);
      const r = runLive(liveFixtureAnsweringNoSuchTable(), root);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /nothing this check executed against \w+ LISTS THE DATABASE'S TABLES/);
      assert.match(r.stderr, /services\/platform sends is a pragma/);
      assert.doesNotMatch(r.stderr, /no table name came back/);
    } finally {
      restoreTo(root, snap);
    }
  });

  test('no credential and no fixture ⇒ 2 before any request, naming what is missing', () => {
    const root = sharedTree();
    const r = spawnSync(process.execPath, [LIVE_GUARD, '--root', root], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' },
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /CLOUDFLARE_API_TOKEN \/ CLOUDFLARE_ACCOUNT_ID are not both in the environment/);
  });

  test('a tree with no D1-bound service ⇒ 2, not a vacuous pass', () => {
    const root = sharedTree();
    const snap = snapshotOf(root);
    try {
      rmSync(join(root, 'services'), { recursive: true, force: true });
      const r = runLive(liveFixture(), root);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /no services\/\* Worker was found that both binds a D1 database and sends a statement/);
    } finally {
      restoreTo(root, snap);
    }
  });
});
