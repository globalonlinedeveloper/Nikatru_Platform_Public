// ─────────────────────────────────────────────────────────────────────────────
// no-seam-forks.test.mjs — assert-no-seam-forks.mjs must be able to FAIL.
//
// [pipeline C-3] no capability exists twice · [pipeline C-9] no seam
// implementation in the brick template. Both named this guard and both were
// marked VERIFIED while it did not exist.
//
// ⚠️ These fixtures are the SECOND line of evidence. Five mutations were run
// against the REAL repository first and all five behaved correctly: a same-name
// fork in the template, a renamed implementer in the template, a renamed
// implementer in an app, the real Subly fork left undeclared — all caught; and a
// legitimate test double correctly did NOT fire.
//
// The guard needed three fixes during those runs, none of which a fixture I wrote
// first would have exposed:
//   1. it reported `class works implements AuthRepository` — the pattern spanned
//      out of a doc comment. Comments are now stripped before matching.
//   2. it missed the one real fork in the tree, because that fork is a same-named
//      class with NO implements clause. Both detection modes are now required.
//   3. it counted `abstract class AuthRepository` — the contract's own declaration
//      — as a shared implementation, turning two homeless classes into "forks".
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
const GUARD = join(CI_DIR, 'assert-no-seam-forks.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-forks-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A tree with: core declaring two contracts, packages/ implementing ONE of them
 *  (so the other is deliberately homeless), plus whatever `extra` files a case
 *  needs. MIN_CONTRACTS is 5, so the register declares five. */
function tree({ extra = {}, violations = null } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};

  const CONTRACTS = ['NotificationService', 'KeyValueStore', 'Analytics', 'PackVerifier', 'AuthRepository'];
  files[join(root, 'packages/core/lib/seams.dart')] =
    CONTRACTS.map((c) => `abstract interface class ${c} {}`).join('\n') + '\n';

  // one real shared implementation — so NotificationService is "homed"
  files[join(root, 'packages/notifications/lib/impl.dart')] =
    'import "../../core/lib/seams.dart";\nclass LocalNotificationService implements NotificationService {}\n';
  // AuthRepository deliberately has NO shared implementation → homeless
  // padding so the file floor (10) is cleared
  for (let i = 0; i < 10; i++) files[join(root, `packages/core/lib/pad${i}.dart`)] = '// pad\n';

  const capabilities = [{
    id: 'core',
    owner: 'packages/core',
    package: 'nikatru_core',
    seams: CONTRACTS.map((c) => ({ file: 'packages/core/lib/seams.dart', symbol: c })),
    consumers: [],
    unconsumedReason: 'fixture',
  }];
  if (violations) capabilities[0].violations = violations;
  files[join(root, 'tooling/capability-register.json')] =
    JSON.stringify({ consumerRoots: ['apps/app1'], capabilities }, null, 2);

  for (const [rel, body] of Object.entries(extra)) files[join(root, rel)] = body;

  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the passing path', () => {
  test('a clean tree passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no seam forks/);
  });

  test('a shared implementation in packages/ is never a fork', () => {
    const { code } = run(tree());
    assert.equal(code, 0);
  });
});

describe('[C-9] a fork in the BRICK TEMPLATE — every stamped app inherits it', () => {
  test('same-name fork fails, and says the template is worse', () => {
    const { code, out } = run(tree({
      extra: { 'tooling/bricks/app/__brick__/apps/x/lib/f.dart': 'class NotificationService {}\n' },
    }));
    assert.equal(code, 1);
    assert.match(out, /THE TEMPLATE — every stamped app inherits this/);
  });

  test('RENAMED implementer in the template fails', () => {
    const { code, out } = run(tree({
      extra: { 'tooling/bricks/app/__brick__/apps/x/lib/f.dart': 'class MyOwn implements NotificationService {}\n' },
    }));
    assert.equal(code, 1);
    assert.match(out, /class MyOwn re-implements `NotificationService`/);
  });
});

describe('[C-3] a fork in an app', () => {
  test('renamed implementer in an app fails', () => {
    const { code, out } = run(tree({ extra: { 'apps/a/lib/f.dart': 'class Sneaky implements NotificationService {}\n' } }));
    assert.equal(code, 1);
    assert.match(out, /inside an app/);
  });

  test('a DECLARED fork passes but is printed every run', () => {
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/f.dart': 'class NotificationService {}\n' },
      violations: [{ path: 'apps/a/lib/f.dart', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 0, out);
    assert.match(out, /declared fork of `NotificationService`/);
  });
});

describe('the distinction that makes the guard usable', () => {
  test('HOMELESS is not a fork — the sole implementation must not fail the build', () => {
    // AuthRepository has no shared implementation in the fixture.
    const { code, out } = run(tree({ extra: { 'apps/a/lib/auth.dart': 'class SupabaseAuth implements AuthRepository {}\n' } }));
    assert.equal(code, 0, out);
    assert.match(out, /Not a fork: it is the only one that exists/);
    assert.match(out, /\[2\]C-15/);
  });

  test('test doubles and probes are exempt', () => {
    for (const dir of ['test', 'integration_test', 'live_probe']) {
      const { code, out } = run(tree({ extra: { [`apps/a/${dir}/d.dart`]: 'class _Fake implements NotificationService {}\n' } }));
      assert.equal(code, 0, `${dir}: ${out}`);
    }
  });

  test('an ABSTRACT class is a contract, not an implementation', () => {
    // Regression: `abstract class AuthRepository` was being counted as a shared
    // implementation of itself, which reclassified every real one as a fork.
    const { code, out } = run(tree({ extra: { 'apps/a/lib/x.dart': 'abstract class AuthRepository {}\n' } }));
    assert.equal(code, 0, out);
  });
});

describe('parse structure, not prose', () => {
  test('a contract named in a COMMENT creates no finding', () => {
    // Regression: the pattern once spanned out of a doc comment and reported a
    // class called "works".
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/c.dart': '// NotificationService implements the thing, and the class works well.\nclass Unrelated {}\n' },
    }));
    assert.equal(code, 0, out);
  });

  test('a block comment mentioning a contract creates no finding', () => {
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/c.dart': '/* class NotificationService {} */\nclass Other {}\n' },
    }));
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A WAIVER THAT MATCHES NOTHING (limb added 2026-08-10, with the cut-1 reversal)
//
// The reversal deleted `apps/subly/lib/data/auth/supabase_auth_repository.dart`
// and its violation entry stayed behind — matching nothing, printing nothing,
// failing nothing, because the waiver loop only ever speaks when a suspect is
// FOUND. Stale is silent by construction, which is this repository's recurring
// shape: a check that quietly stopped checking. Worse than untidy, it is a
// standing re-entry permit — put a fork back at that path and it is waived on
// sight with nobody deciding to.
//
// 🔬 THE FIRST VERSION OF THIS LIMB FAILED ON THE REAL TREE FOR THE WRONG
// REASON, and the last case here is that bug. `AnalyticsFunnel` is declared as a
// `capability-implemented-in-app` violation; it is not a registered SEAM, so the
// scan cannot see it at all and "not a suspect" says nothing about it. A guard
// reporting the limits of its own reach as a defect in the tree is exactly what
// the register's coverage rules exist to stop.
// ─────────────────────────────────────────────────────────────────────────────
describe('a declared violation must still describe something', () => {
  test('a waiver whose FILE is gone fails, and names the path', () => {
    const { code, out } = run(tree({
      violations: [{ path: 'apps/a/lib/deleted.dart', symbol: 'NotificationService', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/a\/lib\/deleted\.dart — the file does not exist/);
    assert.match(out, /match NOTHING in the tree/);
  });

  test('a waiver whose file survived but no longer implements the seam fails', () => {
    const { code, out } = run(tree({
      // The file is real; the fork was extracted out of it and something else
      // was left behind. The waiver now covers a file that is not a fork.
      extra: { 'apps/a/lib/f.dart': 'class SomethingElse {}\n' },
      violations: [{ path: 'apps/a/lib/f.dart', symbol: 'NotificationService', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 1, out);
    assert.match(out, /nothing in it declares or re-implements `NotificationService` any more/);
  });

  test('a waiver for a NON-SEAM capability is left alone — the scan cannot see it', () => {
    // `AnalyticsFunnel` is not in the register's `seams`, so it is not a
    // contract and never appears in `suspects`. Failing here would be the guard
    // measuring its own blind spot. The file must exist; that half still applies.
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/funnel.dart': 'class AnalyticsFunnel {}\n' },
      violations: [{ path: 'apps/a/lib/funnel.dart', symbol: 'AnalyticsFunnel', kind: 'capability-implemented-in-app', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /match NOTHING in the tree/);
  });
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when the register yields too few contracts', () => {
    const root = tree();
    writeFileSync(join(root, 'tooling/capability-register.json'),
      JSON.stringify({ consumerRoots: ['apps/app1'], capabilities: [{ id: 'x', owner: 'packages/core', seams: [] }] }));
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register is absent', () => {
    const root = tree();
    rmSync(join(root, 'tooling/capability-register.json'));
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no capability register/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 FIX (1) IN THE HEADER — "comments are now stripped" — WAS TWO REGEXES, AND
// TWO REGEXES ARE NOT A TOKENIZER (2026-08-07).
//
// The block pattern ran FIRST, so a `/*` inside a `//` line comment opened a
// phantom block that ran to the next `*​/` and blanked everything between it —
// including a `class X implements <Contract>` declaration. The guard then found
// no fork and printed ok, which is this file's own subject one level up: a check
// that silently stopped checking. ZERO of the 217 real Dart files were affected,
// so only a mutation could find it. Same defect and same repair as
// assert-ops-register.mjs (which lost 103 lines of a real file) and
// assert-no-clone-tells.mjs; all three now share text-reductions.mjs.
// ─────────────────────────────────────────────────────────────────────────────
describe('the stripper is a tokenizer — a comment cannot hide a fork', () => {
  test('🔴 a fork AFTER a line comment containing `/*` is still found', () => {
    const { code, out } = run(tree({
      extra: {
        'apps/app1/lib/f.dart':
          // NotificationService, not AuthRepository: the latter is deliberately
          // homeless in this fixture, and a homeless class is reported as
          // [2]C-15 work at exit 0 — which would have made this assertion pass
          // for the wrong reason and prove nothing about the stripper.
          '// worker sources live under services/*/src/ — unrelated to this file\n' +
          'class MyNotifier implements NotificationService {}\n' +
          "const doc = 'the span above would close here */';\n",
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /MyNotifier/);
  });

  test('a declaration inside a REAL comment is still not a fork', () => {
    const { code, out } = run(tree({
      extra: { 'apps/app1/lib/f.dart': '// class Ghost implements AuthRepository {}\n/* class Ghost2 implements Analytics {} */\nclass B {}\n' },
    }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /Ghost/);
  });
});
