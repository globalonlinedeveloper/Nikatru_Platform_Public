// ─────────────────────────────────────────────────────────────────────────────
// erasure-reach.test.mjs — the negative cases for assert-erasure-reach.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// This repository has shipped a guard whose six fixture tests all passed against
// a broken version (`assert-seams-wired.mjs`, whose caller check matched the
// function's own declaration): a fixture you write encodes the same
// misunderstanding as the guard you write. The copy below carries the real
// services/platform, the real services/subly-api and the real register, so every
// mutation here is a mutation somebody could actually make in a diff.
//
// The mutations are the ones this change is about: put the erasure route back
// behind the shared-secret middleware, delete the route's own refusal, spell that
// refusal fail-OPEN, un-mount the route, and restore the `no-route` declaration
// the four subly_db rows carried until 2026-08-04.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-erasure-reach.mjs');

const REGISTER = 'tooling/legal/data-inventory.json';
const SUBLY = 'services/subly-api';
const PLATFORM = 'services/platform';
const SUBLY_INDEX = `${SUBLY}/src/index.ts`;
const SUBLY_ROUTE = `${SUBLY}/src/routes/account.ts`;
const SUBLY_AUTH = `${SUBLY}/src/middleware/auth.ts`;
const PLATFORM_WRANGLER = `${PLATFORM}/wrangler.jsonc`;

/** A real-tree copy carrying exactly what the guard reads: both Workers' src +
 *  migrations + wrangler config, and the register. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-erasure-reach-'));
  mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
  cpSync(join(REPO, REGISTER), join(root, REGISTER));
  for (const svc of [PLATFORM, SUBLY]) {
    mkdirSync(join(root, svc), { recursive: true });
    cpSync(join(REPO, svc, 'src'), join(root, svc, 'src'), { recursive: true });
    cpSync(join(REPO, svc, 'migrations'), join(root, svc, 'migrations'), { recursive: true });
    cpSync(join(REPO, svc, 'wrangler.jsonc'), join(root, svc, 'wrangler.jsonc'));
  }
  return root;
}

function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const edit = (root, rel, fn) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, `mutation of ${rel} changed nothing — the test would assert about the real tree`);
  writeFileSync(p, after);
};

describe('the real tree', () => {
  test('passes, and says what it actually checked', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /user-owned table\(s\) across 2 database-owning service\(s\)/);
        assert.match(r.stdout, /1 erasure route\(s\) sit on a Worker whose default middleware CAN fall back/);
        assert.match(r.stdout, /the entry point \(services\/platform\)/);
      },
    );
  });

  test('the copy the other tests mutate really is the shipped code', () => {
    // Without this every "mutation caught" below could be an artefact of a
    // stand-in rather than evidence about the deployed Workers.
    withTree(
      () => {},
      () => {
        const index = readFileSync(join(REPO, SUBLY_INDEX), 'utf8');
        assert.ok(index.includes('erasureAuth'), 'subly-api must really mount the strict boundary');
        const auth = readFileSync(join(REPO, SUBLY_AUTH), 'utf8');
        assert.ok(auth.includes('SUPABASE_JWT_SECRET'), 'subly-api must really still carry the fallback');
        const route = readFileSync(join(REPO, SUBLY_ROUTE), 'utf8');
        assert.ok(route.includes('tokenAssurance'), 'the route must really carry its own refusal');
      },
    );
  });
});

describe('LIMB 3 — the erasure route must not be reachable through the shared secret', () => {
  test('FAILS when the erasure route is guarded by the fallback-capable middleware', () => {
    // 🔴 THE MUTATION THIS GUARD EXISTS FOR. One identifier, in one line of
    // index.ts, and account deletion is behind a symmetric secret.
    withTree(
      (root) => edit(root, SUBLY_INDEX, (s) => s.replace("'/v1/account', erasureAuth", "'/v1/account', supabaseAuth")),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /guarded by `supabaseAuth`, which reaches SUPABASE_JWT_SECRET/);
      },
    );
  });

  test('FAILS when nothing path-scoped guards the erasure route at all', () => {
    withTree(
      (root) => edit(root, SUBLY_INDEX, (s) => s.replace("app.use('/v1/account', erasureAuth);", '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no path-scoped `use\('…account…', …\)` guards it/);
      },
    );
  });

  test('FAILS when the route drops its OWN token-assurance refusal', () => {
    // The mounting is a line in another file. Without this second limb, moving it
    // is a silent downgrade.
    withTree(
      (root) => edit(root, SUBLY_ROUTE, (s) => s.replace(/tokenAssurance/g, 'someOtherThing')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not check `tokenAssurance`/);
      },
    );
  });

  test("FAILS on the fail-OPEN spelling `!== 'symmetric'`", () => {
    // Admits `undefined` — a route reached with no auth middleware at all.
    withTree(
      (root) => edit(root, SUBLY_ROUTE, (s) => s.replace("!== 'asymmetric'", "!== 'symmetric'")),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not refuse on `!== 'asymmetric'`/);
      },
    );
  });

  test('COVERAGE LOST when no top-level declaration can be parsed from auth.ts', () => {
    // Indenting the module puts every declaration off column zero, which is
    // exactly what a layout change or a wrapping refactor would do. The walk then
    // finds nothing and would judge every middleware fallback-free.
    withTree(
      (root) =>
        edit(root, SUBLY_AUTH, (s) =>
          s
            .split('\n')
            .map((l) => (l.trim() === '' ? l : `  ${l}`))
            .join('\n'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /no top-level declaration was parsed/);
      },
    );
  });

  test('PASSES cleanly when the fallback is removed entirely — the fix is not punished', () => {
    // 🔴 A SELF-CHECK THAT FAILS ON THE CURE IS ONE SOMEBODY DELETES. Removing
    // the shared-secret path is the end state this guard pushes towards, and it
    // must be a clean pass rather than COVERAGE LOST for "nothing to check".
    withTree(
      (root) => edit(root, SUBLY_AUTH, (s) => s.replace(/env\.SUPABASE_JWT_SECRET/g, 'undefined')),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /never uses SUPABASE_JWT_SECRET/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE GUARD'S OWN ALGORITHM, MUTATED. Limb 3's answer comes from following
// calls between top-level declarations, and that walk cannot be self-checked
// against the real tree — "no middleware reaches the secret" is also what a
// repository that REMOVED the fallback looks like. So the guard runs a
// constructed probe on every invocation, and these three cases prove the probe
// bites: each mutates the guard's own regexes in a temp copy.
//
// The first is not hypothetical. It is the bug this file caught: without the
// column-zero anchor an inner `const issuer = …` split the enclosing function's
// body, `supabaseAuth` stopped reaching `SUPABASE_JWT_SECRET`, and the guard
// PASSED on a tree with the erasure route mounted behind the shared secret —
// while still printing a non-zero "fallback-capable" count, because a junk inner
// name was carrying the hit.
// ─────────────────────────────────────────────────────────────────────────────
describe("the guard's own reachability walk", () => {
  function withMutatedGuard(mutate, fn) {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-erasure-guard-'));
    try {
      cpSync(join(REPO, 'tooling', 'ci'), join(dir, 'ci'), { recursive: true });
      const g = join(dir, 'ci', 'assert-erasure-reach.mjs');
      const before = readFileSync(g, 'utf8');
      const after = mutate(before);
      assert.notEqual(after, before, 'the guard mutation changed nothing');
      writeFileSync(g, after);
      fn(spawnSync(process.execPath, [g, REPO], { cwd: REPO, encoding: 'utf8' }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('the UNmutated copy passes against the real repo — so the three below are about the mutation', () => {
    withMutatedGuard(
      (s) => `${s}\n// mutation-test marker\n`,
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });

  test('losing the column-zero anchor is COVERAGE LOST, not a pass', () => {
    withMutatedGuard(
      (s) => s.replace('/^(?:export\\s+)?(?:const|let|async\\s+function|function)', '/(?:export\\s+)?(?:const|let|async\\s+function|function)'),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });

  test('a walk that stops following calls is COVERAGE LOST', () => {
    withMutatedGuard(
      (s) => s.replace('new RegExp(`\\\\b${other}\\\\s*\\\\(`).test(body)', 'false'),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /did not follow `outer` . `inner`/);
      },
    );
  });

  test('a walk that always answers yes is COVERAGE LOST — it would fail correct code', () => {
    withMutatedGuard(
      (s) => s.replace('if (body.includes(needle)) return true;', 'return true;'),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /a needle that is in no declaration/);
      },
    );
  });
});

describe('LIMB 2 — a route file that nothing mounts is a dead seam', () => {
  test('FAILS when index.ts never imports the erasure route', () => {
    withTree(
      (root) => edit(root, SUBLY_INDEX, (s) => s.replace("import account from './routes/account';", '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never imports its erasure route/);
      },
    );
  });

  test('FAILS when it imports the route and never mounts it', () => {
    withTree(
      (root) => edit(root, SUBLY_INDEX, (s) => s.replace("app.route('/v1', account);", '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never mounts it with/);
      },
    );
  });
});

describe('LIMB 1 — a table with a user_id may not declare itself unreachable', () => {
  test('FAILS when a subly_db row goes back to `no-route`', () => {
    // The exact state the register carried until this change: four honest rows
    // saying nothing reaches these tables, and every guard green.
    withTree(
      (root) =>
        edit(root, REGISTER, (s) => {
          const j = JSON.parse(s);
          const row = j.stores.find((x) => x.id === 'table:subly_db.subscriptions');
          row.erasure = { kind: 'no-route', blockedBy: 'nothing reaches subly_db' };
          return JSON.stringify(j, null, 2);
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /declares `erasure: no-route` and its schema gives it a `user_id`/);
      },
    );
  });

  test('FAILS when a user-owned table has no register row at all', () => {
    withTree(
      (root) =>
        edit(root, REGISTER, (s) => {
          const j = JSON.parse(s);
          j.stores = j.stores.filter((x) => x.id !== 'table:subly_db.budgets');
          return JSON.stringify(j, null, 2);
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /has a `user_id` column and NO row in tooling\/legal\/data-inventory\.json/);
      },
    );
  });

  test('COVERAGE LOST when no migration file can be read', () => {
    withTree(
      (root) => {
        for (const svc of [PLATFORM, SUBLY]) {
          for (const f of ['0001_init.sql', '0001_entitlements.sql']) {
            try {
              unlinkSync(join(root, svc, 'migrations', f));
            } catch {
              /* only one of the two names exists per service */
            }
          }
        }
        rmSync(join(root, SUBLY, 'migrations'), { recursive: true, force: true });
        rmSync(join(root, PLATFORM, 'migrations'), { recursive: true, force: true });
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });
});

describe('LIMB 4 — the ONE erasure call the client makes must reach every app', () => {
  test('FAILS when the entry point declares no endpoint for an app that owns a database', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace(/"APP_ERASURE_ENDPOINTS": "[^"]*"/, '"UNUSED": "x"')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /APP_ERASURE_ENDPOINTS does not name "subly"/);
      },
    );
  });

  test('FAILS on a non-https endpoint — the relay forwards a live bearer token', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace('subly=https://', 'subly=http://')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /is not a bare https origin/);
      },
    );
  });

  test('FAILS when the list names an app no Worker declares — the other direction', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace('subly=https://', 'ghost=https://')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /and no services\/\* Worker with an erasure route declares that APP_ID/);
      },
    );
  });

  test('COVERAGE LOST when only one service still owns a database', () => {
    withTree(
      (root) => edit(root, `${SUBLY}/wrangler.jsonc`, (s) => s.replace('"migrations_dir": "migrations"', '"unused": ""')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /service\(s\) own a database/);
      },
    );
  });
});
