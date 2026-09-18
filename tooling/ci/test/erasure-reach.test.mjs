// ─────────────────────────────────────────────────────────────────────────────
// erasure-reach.test.mjs — the negative cases for assert-erasure-reach.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// This repository has shipped a guard whose six fixture tests all passed against
// a broken version (`assert-seams-wired.mjs`, whose caller check matched the
// function's own declaration): a fixture you write encodes the same
// misunderstanding as the guard you write. The copy below carries the real
// services/platform, the real services/subscriptiontracker-api and the real register, so every
// mutation here is a mutation somebody could actually make in a diff.
//
// The mutations are the ones this change is about: put the erasure route back
// behind the shared-secret middleware, delete the route's own refusal, spell that
// refusal fail-OPEN, un-mount the route, and restore the `no-route` declaration
// the four subly_db rows carried until 2026-08-04.
//
// ── THE TEMPLATE ROOT (added 2026-09-05, G-4) ───────────────────────────────
// 🔴 THE SECOND ROOT HAS ITS OWN `realTree`, AND THAT IS DELIBERATE. The live
// tree above copies `services/` and the register and NOTHING ELSE — no
// `tooling/ci`, so the guard's own sentinel is absent and the template floor is
// correctly skipped. `templateTree()` below copies the brick's stamped Worker AND
// the sentinel, which is what turns the template limbs on. Two fixtures, because
// one fixture carrying both roots could not show that either floor is separate.
//
// Measured before the widening, on the same tree: every one of the six
// brick-shaped mutations below exited 0 against main's version. The guard could
// not see the template at all — it read 9 migration files, and the template's was
// not one of them.
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
const SUBLY = 'services/subscriptiontracker-api';
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
  // The one home the routes re-export from. Since 2026-09-12 the derivation lives
  // there, and the template limb follows the import ONE HOP to check it really
  // derives - a fixture without it would make that limb unanswerable and the
  // template would read as a hand-kept list.
  mkdirSync(join(root, 'services', '_shared', 'src'), { recursive: true });
  cpSync(join(REPO, 'services', '_shared', 'src'), join(root, 'services', '_shared', 'src'), { recursive: true });
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

// ─────────────────────────────────────────────────────────────────────────────
// THE TEMPLATE ROOT
//
// ⚠️ THE MUSTACHE DIRECTORY IS TWO SEGMENTS ON DISK. `{{/needs_backend}}`
// contains a `/`, which is a PATH SEPARATOR: git stores
// `{{#needs_backend}}services{{` / `needs_backend}}`. It is spelled as segments
// here and joined, never handed to a matcher — braces are glob syntax.
// ─────────────────────────────────────────────────────────────────────────────
const BRICK_SEGMENTS = [
  'tooling', 'bricks', 'app', '__brick__', '{{#needs_backend}}services{{', 'needs_backend}}', '{{app_id}}-api',
];
const BRICK = BRICK_SEGMENTS.join('/');
const BRICK_INDEX = `${BRICK}/src/index.ts`;
const BRICK_ROUTE = `${BRICK}/src/routes/account.ts`;
const BRICK_ERASE_SUBJECT = `${BRICK}/src/lib/erase-subject.ts`; // [ADR 081] the APP_DB walk the route and the retry entrypoint share
const BRICK_WRANGLER = `${BRICK}/wrangler.jsonc`;
const BRICK_MIGRATION = `${BRICK}/migrations/0001_init.sql`;

/** The live tree PLUS the brick's stamped Worker PLUS this guard's own file —
 *  the sentinel that turns the template floor on. Without the sentinel the
 *  template root is skipped, which is exactly what makes `realTree()` above still
 *  a valid fixture for the live limbs. */
function templateTree() {
  const root = realTree();
  cpSync(join(REPO, ...BRICK_SEGMENTS), join(root, ...BRICK_SEGMENTS), { recursive: true });
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  cpSync(GUARD, join(root, 'tooling', 'ci', 'assert-erasure-reach.mjs'));
  return root;
}

function withTemplateTree(mutate, fn) {
  const root = templateTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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
        assert.ok(index.includes('erasureAuth'), 'subscriptiontracker-api must really mount the strict boundary');
        const auth = readFileSync(join(REPO, SUBLY_AUTH), 'utf8');
        assert.ok(auth.includes('SUPABASE_JWT_SECRET'), 'subscriptiontracker-api must really still carry the fallback');
        const route = readFileSync(join(REPO, SUBLY_ROUTE), 'utf8');
        assert.ok(route.includes('tokenAssurance'), 'the route must really carry its own refusal');
      },
    );
  });
});

// ⏱ 2026-09-15 · [ADR 081] LIMB 4b — every app in APP_ERASURE_ENDPOINTS can be
// RETRIED over a Service Binding into its `ErasureEntrypoint`. Each mutation is
// declared on its own (assert-no-loop-cases).
describe('limb 4b — the erasure retry binding', () => {
  test('FAILS when the platform declares no ERASURE_<APP> binding for a listed app', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace(/"services": \[[\s\S]*?\],\n\s*"d1_databases"/, '"d1_databases"')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /declares no Service Binding `ERASURE_SUBSCRIPTIONTRACKER` for "subscriptiontracker"/);
      },
    );
  });

  test('FAILS when the binding names another entrypoint', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace('"entrypoint": "ErasureEntrypoint"', '"entrypoint": "Default"')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /binding ERASURE_SUBSCRIPTIONTRACKER names entrypoint "Default"/);
      },
    );
  });

  test('FAILS when the binding names a Worker that is not the app', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace('"service": "subscriptiontracker-api"', '"service": "someone-else"')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /names service "someone-else"/);
      },
    );
  });

  test('FAILS when the app Worker stops exporting ErasureEntrypoint', () => {
    withTree(
      (root) => edit(root, SUBLY_INDEX, (s) => s.replace("export { ErasureEntrypoint } from './erasure-entrypoint';", '')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /src\/index\.ts does not export `ErasureEntrypoint`/);
      },
    );
  });
});

// ⏱ 2026-09-15 · [ADR 087] LIMB 5 — `signups` is keyed by address and reached through the
// account's CONFIRMED email, before the identity is deleted. Each red control is a real
// mutation of the shipped code, declared on its own (assert-no-loop-cases).
const PLATFORM_ERASURE = `${PLATFORM}/src/lib/platform-erasure.ts`;
const PLATFORM_ROUTE = `${PLATFORM}/src/routes/account.ts`;
const PLATFORM_SCHEDULED = `${PLATFORM}/src/scheduled.ts`;
describe('limb 5 — the signup list is reached by confirmed email, before the identity goes', () => {
  test('the real tree passes and says what limb 5 checked', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /1 address-keyed table\(s\) reached by CONFIRMED email .* all 2 identity delete\(s\) in services\/platform\/src call the purge/);
      },
    );
  });

  test('FAILS when the purge no longer deletes from signups', () => {
    withTree(
      (root) => edit(root, PLATFORM_ERASURE, (t) => t.replace("'DELETE FROM signups WHERE email = ?'", "'SELECT 1 FROM signups WHERE email = ?'")),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /has no top-level function that runs `DELETE FROM signups WHERE email = \?`/);
      },
    );
  });

  test('FAILS when the purge deletes without checking email_confirmed_at', () => {
    withTree(
      (root) =>
        edit(root, PLATFORM_ERASURE, (t) =>
          t.replace("  if (typeof user.email_confirmed_at !== 'string' || user.email_confirmed_at === '') {\n    return { kind: 'skipped', why: 'unconfirmed' };\n  }\n", ''),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /`purgeVerifiedSignups` deletes from signups on email without first reading `email_confirmed_at`/);
      },
    );
  });

  test('FAILS when the route purges AFTER deleting the identity', () => {
    withTree(
      (root) =>
        edit(root, PLATFORM_ROUTE, (t) =>
          t
            .replace('const signupPurge = await purgeVerifiedSignups(c.env.PLATFORM_DB, c.env.SUPABASE_URL, serviceRoleKey, userId);', "const signupPurge = { kind: 'skipped', why: 'no_email' } as const;")
            .replace("  deleted['identity'] = 1;\n", "  deleted['identity'] = 1;\n  await purgeVerifiedSignups(c.env.PLATFORM_DB, c.env.SUPABASE_URL, serviceRoleKey, userId);\n"),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /src\/routes\/account\.ts:\d+ deletes the identity and its block does not call `purgeVerifiedSignups` before it/);
      },
    );
  });

  test('FAILS when the nightly retry deletes a pending identity without purging first', () => {
    withTree(
      (root) =>
        edit(root, PLATFORM_SCHEDULED, (t) =>
          t.replace(
            'const signupPurge = await purgeVerifiedSignups(env.PLATFORM_DB, env.SUPABASE_URL, serviceRoleKey, subject);',
            "const signupPurge = { kind: 'skipped', why: 'no_email' } as const;",
          ),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /src\/scheduled\.ts:\d+ deletes the identity and its block does not call `purgeVerifiedSignups` before it/);
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
        assert.equal(r.status, 2);
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

  // ⏱ 2026-09-11 · REVIEW-guards-vacuous-2026-09-10 #2, replayed on the real
  // Worker. Each case deletes the strict boundary AND respells the secret read in
  // auth.ts. Before the fix the bracket spelling went rc=0 and printed "never
  // uses SUPABASE_JWT_SECRET" over a Worker that still used it.
  const DELETE_BOUNDARY = (s) => s.replace("app.use('/v1/account', erasureAuth);", '');
  const SECRET_SPELLINGS = [
    ['a single-quoted bracket read — M8 replayed', "env['SUPABASE_JWT_SECRET']"],
    ['a double-quoted bracket read', 'env["SUPABASE_JWT_SECRET"]'],
    ['a template-literal bracket read', 'env[`SUPABASE_JWT_SECRET`]'],
    ['an optional-chained read', 'env?.SUPABASE_JWT_SECRET'],
    ['a destructured read', '(({ SUPABASE_JWT_SECRET: s }) => s)(env)'],
    ['a name assembled from pieces', "env['SUPABASE_' + 'JWT_SECRET']"],
    ['a computed key the scan cannot name', "env[['SUPABASE', 'JWT', 'SECRET'].join('_')]"],
  ];
  for (const [label, spelling] of SECRET_SPELLINGS) {
    test(`FAILS when the boundary is deleted and the secret is read as ${label}`, () => {
      withTree(
        (root) => {
          edit(root, SUBLY_INDEX, DELETE_BOUNDARY);
          edit(root, SUBLY_AUTH, (s) => s.replace(/env\.SUPABASE_JWT_SECRET/g, spelling));
        },
        (r) => {
          assert.equal(r.status, 1, r.stdout + r.stderr);
          assert.match(r.stderr, /no path-scoped `use\('…account…', …\)` guards it/);
          assert.doesNotMatch(r.stdout, /subscriptiontracker-api — src\/middleware\/auth\.ts never uses SUPABASE_JWT_SECRET/);
        },
      );
    });
  }

  test('FAILS when the secret is read by a HELPER that is passed the environment, and the boundary is gone', () => {
    withTree(
      (root) => {
        edit(root, SUBLY_INDEX, DELETE_BOUNDARY);
        edit(root, SUBLY_AUTH, (s) =>
          `${s.replace(/env\.SUPABASE_JWT_SECRET/g, "pickSecret(env, ['SUPABASE', 'JWT', 'SECRET'].join('_'))")}\n` +
          'function pickSecret(bag: Record<string, string | undefined>, k: string) {\n  return bag[k];\n}\n',
        );
      },
      (r) => {
        assert.equal(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stderr, /no path-scoped `use\('…account…', …\)` guards it/);
      },
    );
  });

  test('with the boundary IN PLACE, a bracket-spelled secret still passes — the respelling alone is not punished', () => {
    withTree(
      (root) => edit(root, SUBLY_AUTH, (s) => s.replace(/env\.SUPABASE_JWT_SECRET/g, "env['SUPABASE_JWT_SECRET']")),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /1 erasure route\(s\) sit on a Worker whose default middleware CAN fall back/);
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
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });

  test('a walk that stops following calls is COVERAGE LOST', () => {
    // ⏱ 2026-09-11 · the walk follows REFERENCES now, not only calls (an alias
    // `const verify = verifySupabaseToken` is the same function); the mutation
    // still switches the whole step off.
    withMutatedGuard(
      (s) => s.replace('new RegExp(`(?<![\\\\w$])${escapeRe(other)}(?![\\\\w$])`).test(code)', 'false'),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /did not follow `outer` . `inner`/);
      },
    );
  });

  test('a walk that always answers yes is COVERAGE LOST — it would fail correct code', () => {
    withMutatedGuard(
      (s) => s.replace('if (readsEnvName(body, needle, seeds)) return true;', 'return true;'),
      (r) => {
        assert.equal(r.status, 2);
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
  test('FAILS when a subscriptiontracker_db row goes back to `no-route`', () => {
    // The exact state the register carried until this change: four honest rows
    // saying nothing reaches these tables, and every guard green.
    withTree(
      (root) =>
        edit(root, REGISTER, (s) => {
          const j = JSON.parse(s);
          const row = j.stores.find((x) => x.id === 'table:subscriptiontracker_db.subscriptions');
          row.erasure = { kind: 'no-route', blockedBy: 'nothing reaches subscriptiontracker_db' };
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
          j.stores = j.stores.filter((x) => x.id !== 'table:subscriptiontracker_db.budgets');
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
        assert.equal(r.status, 2);
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
        assert.match(r.stderr, /APP_ERASURE_ENDPOINTS does not name "subscriptiontracker"/);
      },
    );
  });

  test('FAILS on a non-https endpoint — the relay forwards a live bearer token', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace('subscriptiontracker=https://', 'subscriptiontracker=http://')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /is not a bare https origin/);
      },
    );
  });

  test('FAILS when the list names an app no Worker declares — the other direction', () => {
    withTree(
      (root) => edit(root, PLATFORM_WRANGLER, (s) => s.replace('subscriptiontracker=https://', 'ghost=https://')),
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
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /service\(s\) own a database/);
      },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE TEMPLATE ROOT — the Worker every future backend app is stamped from.
//
// 🔴 EVERY CASE HERE EXITED 0 AGAINST THE PRE-G-4 GUARD. The subject was
// `services/` and the register; the brick stamps a whole Worker — wrangler.jsonc
// with a migrations_dir, a starter migration creating a user-owned table,
// index.ts, middleware/auth.ts carrying the shared-secret fallback, and
// routes/account.ts — and not a byte of it was read. A defect stamped here is
// not one app's orphaned rows, it is every app the factory ever produces.
// ═════════════════════════════════════════════════════════════════════════════
describe('the template root', () => {
  test('passes over the real brick, and SAYS the template floor was applied', () => {
    // The branch taken is printed rather than implied: a reader must be able to
    // tell a covered template from a skipped one without reading this file.
    withTemplateTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /TEMPLATE ROOT: 1 stamped-Worker template\(s\) owning a database/);
        assert.match(r.stdout, /1 user-owned table\(s\) proven reachable/);
        assert.match(r.stdout, /FULL CHECKOUT — the template floor was APPLIED/);
      },
    );
  });

  test('the live fixture does NOT silently claim template coverage', () => {
    // 🔴 THE OTHER HALF OF THE SENTINEL. If `realTree()` (no tooling/ci, no
    // brick) reported the template root as covered, the floor would be
    // decorative — and every live-limb test above would be quietly asserting
    // about a root that is not there.
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /NOT a full checkout/);
        assert.match(r.stdout, /the template floor and the git cross-check were SKIPPED/);
      },
    );
  });

  // ⏱ 2026-09-12 - THE TEMPLATE DERIVES NOW, so the pair below is inverted from
  // what it was. It used to assert that the template's hand-kept
  // `const appTables = ['records'];` failed when the starter schema grew a table, and
  // that deriving was a clean pass. The template stopped carrying a list: its route
  // imports the one home both Workers re-export. So the FAILING case is the
  // regression - a template that goes BACK to a list - and the PASSING case needs no
  // mutation at all.
  test('T1 FAILS if the template goes BACK to a hand-kept list and the schema grows past it', () => {
    // 🔴 THE DRIFT BOTH SHIPPED ROUTES DOCUMENT AND NOTHING ENFORCED UNTIL NOW. A
    // table added to the starter migration without the same diff editing that list is
    // orphaned personal data in every stamped app, and the route still answers ok.
    withTemplateTree(
      (root) => {
        edit(root, BRICK_MIGRATION, (s) => `${s}\nCREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);\n`);
        // ⏱ 2026-09-15 · [ADR 081]: the route no longer calls userOwnedTables
        // itself — it calls `eraseSubjectRows` from src/lib/erase-subject.ts — so
        // "back to a list" now means dropping THAT import and listing tables.
        edit(root, BRICK_ROUTE, (s) =>
          s
            .replace(/import \{ eraseSubjectRows \} from '\.\.\/lib\/erase-subject';/, '')
            .replace(
              'const walked = await eraseSubjectRows(c.env.APP_DB, userId);',
              "const appTables = ['records']; const walked = { ok: true as const, deleted: {}, unlinked: {}, error: '', reason: String(appTables) };",
            ),
        );
      },
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /does not reach `notes`, which the template's own migrations give a `user_id`/);
      },
    );
  });

  // ⏱ 2026-09-15 · [ADR 081]: the LOCAL hop is verified too. The route imports
  // src/lib/erase-subject.ts; if that module stops delegating to the shared
  // derivation, the route no longer derives, and T1 must say so.
  test('T1 FAILS when the template\'s local erase-subject module stops delegating to the shared derivation', () => {
    withTemplateTree(
      (root) => {
        edit(root, BRICK_MIGRATION, (s) => `${s}\nCREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);\n`);
        // ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS: the module now imports ONE
        // derivation (`erasureTargets`) and ONE batched write (`eraseTargets`).
        // The old target line no longer existed, so `replace` became a no-op, the
        // "mutant" was the original, and this case went red on a green guard —
        // correctly. It now REFUSES to run if its target moves again, so a future
        // rename fails here by name instead of as a confusing guard verdict.
        edit(root, BRICK_ERASE_SUBJECT, (s) => {
          const target = "import { erasureTargets, eraseTargets, type ErasureTargets } from '../../../_shared/src/erasure';";
          assert.ok(s.includes(target), `T1's mutation target is gone from ${BRICK_ERASE_SUBJECT} - re-point it, or this case mutates nothing`);
          return s.replace(
            target,
            "type ErasureTargets = { tables: string[]; references: Array<{ table: string; column: string }> };" +
              " const erasureTargets = async (_d: unknown): Promise<ErasureTargets> => ({ tables: ['records'], references: [] });" +
              " const eraseTargets = async (_d: unknown, _u: string, _t: ErasureTargets) => ({ deleted: {}, unlinked: {} });",
          );
        });
      },
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /does not reach `notes`/);
      },
    );
  });

  test('T1 PASSES as the template stands - deriving through the one home is the cure, not a finding', () => {
    // A check that failed on the cure is a check somebody deletes. The template names
    // no table at all, so a new one in the starter schema must be a clean pass.
    withTemplateTree(
      (root) =>
        edit(root, BRICK_MIGRATION, (s) => `${s}\nCREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);\n`),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
      },
    );
  });

  // 🔴 THE HOP IS VERIFIED, NOT ASSUMED, and this is what says so. An import of a
  // module that does NOT derive is not a derivation - otherwise the limb could be
  // satisfied by importing anything at all.
  test('T1 FAILS when the imported module stops deriving, even though the import is still there', () => {
    withTemplateTree(
      (root) => {
        edit(root, BRICK_MIGRATION, (s) => `${s}\nCREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);\n`);
        edit(root, 'services/_shared/src/erasure.ts', (s) => s.replace(/FROM sqlite_master/g, 'FROM not_the_schema'));
      },
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /does not reach `notes`/);
      },
    );
  });
  test('T2 FAILS when the template stops mounting its erasure route', () => {
    withTemplateTree(
      (root) => edit(root, BRICK_INDEX, (s) => s.replace("app.route('/v1/account', account);", '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /mounts no `\.route\('…account…', …\)`/);
      },
    );
  });

  test('T3 FAILS when the template mounts erasure behind the shared-secret middleware', () => {
    // One identifier in one line of the template, and every app ever stamped from
    // it serves account deletion behind a symmetric secret.
    withTemplateTree(
      (root) =>
        edit(root, BRICK_INDEX, (s) =>
          s.replace("app.use('/v1/account', erasureAuth);", "app.use('/v1/account', supabaseAuth);"),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /guards DELETE \/v1\/account with `supabaseAuth`, which reaches SUPABASE_JWT_SECRET/);
      },
    );
  });

  test('T3 FAILS when the stamped handler loses its own token-assurance refusal', () => {
    withTemplateTree(
      (root) => edit(root, BRICK_ROUTE, (s) => s.replaceAll('tokenAssurance', 'someOtherThing')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not check `tokenAssurance`/);
      },
    );
  });

  test('T3 FAILS on a SUFFIXED rename — the shape a find-and-replace produces', () => {
    // 🔴 THIS ONE PASSED WHILE THE LIMB WAS BEING WRITTEN. An unanchored
    // /tokenAssurance/ is satisfied by `tokenAssuranceXX`, so the route had no
    // refusal left and the check was green. Both this limb and the live one are
    // word-anchored now; found by mutation, not by reading.
    withTemplateTree(
      (root) => edit(root, BRICK_ROUTE, (s) => s.replaceAll('tokenAssurance', 'tokenAssuranceXX')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not check `tokenAssurance`/);
      },
    );
  });

  test("T3 FAILS on the fail-OPEN spelling `!== 'symmetric'`, stamped", () => {
    withTemplateTree(
      (root) => edit(root, BRICK_ROUTE, (s) => s.replace("assurance !== 'asymmetric'", "assurance !== 'symmetric'")),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not refuse on `!== 'asymmetric'`/);
      },
    );
  });

  test('T4 FAILS when the template declares no vars.APP_ID', () => {
    // Limb 4 matches an app Worker to APP_ERASURE_ENDPOINTS by its APP_ID. Without
    // the hook in the template, every stamped backend fails limb 4 on arrival.
    withTemplateTree(
      (root) => edit(root, BRICK_WRANGLER, (s) => s.replace('"APP_ID": "{{app_id}}",', '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /declares no `vars\.APP_ID`/);
      },
    );
  });

  test('COVERAGE LOST when the template stops owning a database — its own floor, not the live one', () => {
    // 🔴 A UNION FLOOR WOULD STAY SATISFIED HERE. Two live owners remain, so a
    // combined "at least three database-owning Workers" would be down to two and
    // a combined "at least two" would still pass. The floors are separate.
    withTemplateTree(
      (root) => edit(root, BRICK_WRANGLER, (s) => s.replace('"migrations_dir": "migrations"', '"unused": ""')),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /no wrangler config under tooling\/bricks\/ declares a `migrations_dir`/);
      },
    );
  });

  test('COVERAGE LOST when the template schema has no user-owned table left', () => {
    withTemplateTree(
      (root) => edit(root, BRICK_MIGRATION, (s) => s.replaceAll('user_id', 'owner_ref')),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /NOT ONE user-owned table was found/);
      },
    );
  });
});

describe('the roots are DERIVED, so a Worker in neither is not a silent skip', () => {
  test('COVERAGE LOST on a wrangler.jsonc outside both roots', () => {
    // 🔴 TWO NAMED ROOTS ARE STILL A LIST. A Worker that lands under `packages/`
    // or at the repo root joins the portfolio with an unswept database while both
    // floors stay satisfied — a root never derived is never empty.
    withTemplateTree(
      (root) => {
        mkdirSync(join(root, 'packages', 'stray-worker'), { recursive: true });
        writeFileSync(
          join(root, 'packages', 'stray-worker', 'wrangler.jsonc'),
          JSON.stringify({
            name: 'stray',
            d1_databases: [{ database_name: 'stray_db', migrations_dir: 'migrations' }],
          }),
        );
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /belong to neither root: packages\/stray-worker\/wrangler\.jsonc/);
      },
    );
  });

  test('COVERAGE LOST when a services/ Worker is nested deeper than the walk reaches', () => {
    // The live walk takes DIRECT children of `services/`; the glob takes every
    // depth. They must agree, or a Worker one level in owns databases no limb
    // ranges over while the two-owner floor is satisfied by the two above it.
    withTemplateTree(
      (root) => {
        mkdirSync(join(root, 'services', 'group', 'nested'), { recursive: true });
        writeFileSync(
          join(root, 'services', 'group', 'nested', 'wrangler.jsonc'),
          JSON.stringify({
            name: 'nested',
            d1_databases: [{ database_name: 'nested_db', migrations_dir: 'migrations' }],
          }),
        );
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /never opened: services\/group\/nested\/wrangler\.jsonc/);
      },
    );
  });
});
