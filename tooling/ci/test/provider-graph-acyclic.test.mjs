// ─────────────────────────────────────────────────────────────────────────────
// provider-graph-acyclic.test.mjs — assert-provider-graph-acyclic.mjs must be
// able to FAIL, and must NOT fail on the thing it is most likely to fail on.
//
// The guard's subject is the #258 shape: `ref.read(T)` from a provider R that T
// already has as a watch/listen ancestor. Riverpod throws
// `CircularDependencyError` there — inside an `assert`, so ONLY in debug, which
// is why the defect could sit in production looking healthy while every test run
// and the whole `flutter drive` E2E hit it.
//
// ⚠️ REAL-TREE MUTATIONS CAME FIRST, BEFORE THIS FILE EXISTED (2026-08-09).
// Fixtures encode the author's understanding, so a fixture-only suite proves the
// guard agrees with the person who wrote it — the assert-seams-wired scar, where
// all six fixtures passed against a guard whose caller check matched the
// function's own declaration. Each of these ran against apps/subly itself, with
// `dart analyze` in between (27 issues, exit 0, unchanged) so a red result is a
// CAUGHT MUTATION and not a compile error:
//
//   M1  providers.dart:589 reverted to pre-#258                -> FAIL, chain
//       `ref.watch(authRepositoryProvider).currentAccessToken`     printed
//   M2  providers.dart:603's inner `ref.read` -> `ref.watch`    -> FAIL, 3 hops
//       (the ONE edge that keeps the repaired shape open)          through the fix
//   M3  `ref.read(apiClientProvider)` added inside              -> FAIL
//       authRepositoryProvider's closure, BEFORE the :1450 fix
//   M3' the SAME mutation, AFTER the :1450 fix                  -> ok (18 read
//                                                                  edges, accepted)
//
// M3/M3' are the pair that matters: they show the fix removed the hazard rather
// than moved it, which no fixture can demonstrate about the real tree.
//
// 🔴 THE FALSE POSITIVE THIS GUARD WAS ALWAYS GOING TO HAVE, and the reason case
// (d) exists: apps/subly/lib/state/providers.dart DESCRIBES THE CYCLE IN PROSE at
// :561, :570-575 and :747 — that is what the doc comments are for. A scanner over
// raw text reports the FIXED tree as broken and stays red forever, which is the
// `grep '"r2_buckets"'`-matched-the-comment-explaining-there-is-no-r2_buckets
// shape. Case (d) is the standing negative control for it.
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
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-provider-graph-acyclic.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-pgraph-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const say = (r) => `${r.stdout}\n${r.stderr}`;

/** Enough providers to clear the coverage floor, with at least one watch edge
 *  and one read edge, and no cycle. Generated rather than typed out: the floor
 *  is about the PARSER still working, so what the filler says does not matter —
 *  only that a fixture can never accidentally test the rule over three nodes. */
function filler(prefix, n = 24) {
  const out = [`final Provider<int> ${prefix}0Provider = Provider<int>((ref) => 0);`];
  for (let i = 1; i < n; i++) {
    out.push(`final Provider<int> ${prefix}${i}Provider = Provider<int>((ref) => ref.watch(${prefix}${i - 1}Provider) + 1);`);
  }
  // A read that is NOT into an ancestor — the legitimate shape, present so every
  // fixture exercises the rule's passing branch too.
  out.push(`final Provider<int> ${prefix}ReaderProvider = Provider<int>((ref) => ref.read(${prefix}0Provider));`);
  return out.join('\n');
}

/** A fixture root holding both trees the guard discovers. `app` and `brick` are
 *  maps of relative path under `lib/` → source, merged on top of the filler. */
function fixture({ app = {}, brick = {}, omitApp = false, omitBrick = false } = {}) {
  const root = join(TMP, `case-${seq++}`);
  const write = (base, files, prefix) => {
    mkdirSync(join(base, 'state'), { recursive: true });
    writeFileSync(join(base, 'state', 'providers.dart'), `${filler(prefix)}\n`);
    for (const [rel, src] of Object.entries(files)) {
      mkdirSync(dirname(join(base, rel)), { recursive: true });
      writeFileSync(join(base, rel), src);
    }
  };
  if (!omitApp) write(join(root, 'apps', 'demo', 'lib'), app, 'a');
  if (!omitBrick) write(join(root, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib'), brick, 'b');
  return root;
}

describe('the closed cycle', () => {
  // (a) THE #258 PAIR, verbatim in shape: the erasure closure reads the client,
  //     the client watches the repository. This is what shipped.
  test('(a) the #258 pair — read into a provider that watches the reader', () => {
    const root = fixture({
      app: {
        'state/auth.dart': `
final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>(
  (ref) => SupabaseAuthRepository(
    requestServerDeletion: () =>
        requestAccountDeletion(ref.read(platformRestClientProvider)),
  ),
);

final Provider<RestClient> platformRestClientProvider = Provider<RestClient>(
  (ref) => RestClient(
    baseUrl: 'https://example.invalid/v1',
    tokenProvider: ref.watch(authRepositoryProvider).currentAccessToken,
  ),
);
`,
      },
    });
    const r = run(root);
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /CIRCULAR PROVIDER DEPENDENCY/);
    assert.match(say(r), /authRepositoryProvider --read--> platformRestClientProvider/);
    assert.match(say(r), /platformRestClientProvider --watch--> authRepositoryProvider/);
    // The brick tree is untouched and must still be reported clean, so a failure
    // cannot be a blanket "everything is broken".
    assert.match(say(r), /ok\s+brick\/app/);
  });

  // (b) THE MUST-STAY-READ SITE. authTokenProvider is the whole repair: it
  //     `read`s the repository, and a read registers no dependency. Flip that
  //     one word and the loop closes THROUGH the fix, two files away from where
  //     anyone would look.
  test('(b) authTokenProvider read->watch re-closes the loop through the fix', () => {
    const root = fixture({
      app: {
        'state/auth.dart': `
final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>(
  (ref) => SupabaseAuthRepository(
    requestServerDeletion: () =>
        requestAccountDeletion(ref.read(platformRestClientProvider)),
  ),
);

final Provider<Future<String?> Function()> authTokenProvider =
    Provider<Future<String?> Function()>(
      (ref) => () => ref.watch(authRepositoryProvider).currentAccessToken(),
    );

final Provider<RestClient> platformRestClientProvider = Provider<RestClient>(
  (ref) => RestClient(tokenProvider: ref.watch(authTokenProvider)),
);
`,
      },
    });
    const r = run(root);
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /platformRestClientProvider --watch--> authTokenProvider/);
    assert.match(say(r), /authTokenProvider --watch--> authRepositoryProvider/);
  });

  // (c) CROSS-FILE, and in the BRICK — because a cycle that spans two files is
  //     the one a reviewer cannot see, and because this proves the brick tree is
  //     genuinely scanned rather than counted. A per-file guard is green here.
  test('(c) a cycle spanning two files, in the brick tree', () => {
    const root = fixture({
      brick: {
        'state/one.dart': 'final Provider<int> alphaProvider = Provider<int>((ref) => ref.read(betaProvider));',
        'core/two.dart': 'final Provider<int> betaProvider = Provider<int>((ref) => ref.watch(alphaProvider));',
      },
    });
    const r = run(root);
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /brick\/app — CIRCULAR PROVIDER DEPENDENCY/);
    assert.match(say(r), /alphaProvider --read--> betaProvider/);
    assert.match(say(r), /betaProvider --watch--> alphaProvider/);
    assert.match(say(r), /ok\s+apps\/demo/);
  });

  test('a provider that reads ITSELF is circular too', () => {
    const root = fixture({
      app: { 'state/self.dart': 'final Provider<int> loopProvider = Provider<int>((ref) => ref.read(loopProvider));' },
    });
    const r = run(root);
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /loopProvider reads ITSELF/);
  });
});

describe('what must NOT fail', () => {
  // (d) THE PROSE CONTROL. The cycle is spelled out in doc comments — exactly as
  //     the real providers.dart does — while the code carries the REPAIRED
  //     wiring. Without the comment/string reduction this case is red, and the
  //     guard would have been reverted within a day.
  test('(d) a cycle described in doc comments and strings only stays GREEN', () => {
    const root = fixture({
      app: {
        'state/auth.dart': `
/// 🔴 IT TAKES [authTokenProvider], NOT \`ref.watch(authRepositoryProvider)
/// .currentAccessToken\`. The old line made authRepositoryProvider's
/// \`ref.read(platformRestClientProvider)\` throw CircularDependencyError,
/// because platformRestClientProvider was then an ancestor of the reader.
final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>(
  (ref) => SupabaseAuthRepository(
    requestServerDeletion: () =>
        requestAccountDeletion(ref.read(platformRestClientProvider)),
  ),
);

/* A block comment repeating it:
   tokenProvider: ref.watch(authRepositoryProvider).currentAccessToken, */
final Provider<Future<String?> Function()> authTokenProvider =
    Provider<Future<String?> Function()>(
      (ref) => () => ref.read(authRepositoryProvider).currentAccessToken(),
    );

final Provider<RestClient> platformRestClientProvider = Provider<RestClient>(
  (ref) => RestClient(
    // The old line, left commented out INSIDE the body — the exact edit somebody
    // makes while debugging, and the one place prose can still reach a span:
    // tokenProvider: ref.watch(authRepositoryProvider).currentAccessToken,
    debugHint: 'ref.watch(authRepositoryProvider).currentAccessToken',
    tokenProvider: ref.watch(authTokenProvider),
  ),
);
`,
      },
    });
    const r = run(root);
    assert.equal(r.status, 0, say(r));
    assert.match(say(r), /ok\s+apps\/demo/);
    assert.doesNotMatch(say(r), /CIRCULAR/);
  });

  // A widget's `ref.watch` is a WidgetRef and forms NO provider ancestor edge.
  // Attributing it to a provider is how a file-level scanner invents cycles.
  test('ref calls in a widget build are not provider edges', () => {
    const root = fixture({
      app: {
        'state/auth.dart': `
final Provider<int> leafProvider = Provider<int>((ref) => 0);
final Provider<int> rootProvider = Provider<int>((ref) => ref.read(leafProvider));
`,
        'features/home_screen.dart': `
class HomeScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int a = ref.watch(leafProvider);
    final int b = ref.watch(rootProvider);
    return Text('\$a \$b');
  }
}
`,
      },
    });
    const r = run(root);
    assert.equal(r.status, 0, say(r));
  });

  // The positive control. Without it every red above is equally consistent with
  // a guard that fails on all input, and the fixtures would prove nothing about
  // the repository they are meant to protect.
  test('the REAL repository is green', () => {
    const r = run(REPO);
    assert.equal(r.status, 0, say(r));
    assert.match(say(r), /ok\s+apps\/subly/);
    assert.match(say(r), /ok\s+brick\/app/);
  });
});

describe('the coverage self-check', () => {
  // (e) The scan reaching nothing is the failure this repo hits most often, and
  //     it is the one that looks exactly like success.
  test('(e) an empty root is COVERAGE LOST, not a pass', () => {
    const root = join(TMP, `empty-${seq++}`);
    mkdirSync(root, { recursive: true });
    const r = run(root);
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /COVERAGE LOST/);
    assert.match(say(r), /provider tree\(s\)/);
  });

  test('one tree without the other is COVERAGE LOST', () => {
    const r = run(fixture({ omitBrick: true }));
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /COVERAGE LOST/);
    assert.match(say(r), /found 1 provider tree/);
  });

  // The limb that actually caught a defect while this guard was being written:
  // the first declaration matcher could not match the bare identifier
  // `Provider`, and the floor is what surfaced it (18 parsed in the brick).
  test('a tree whose declarations stop parsing is COVERAGE LOST', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'apps', 'demo', 'lib', 'state', 'providers.dart'),
      'final Provider<int> loneProvider = Provider<int>((ref) => ref.read(otherProvider));\n' +
        'final Provider<int> otherProvider = Provider<int>((ref) => 0);\n',
    );
    const r = run(root);
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /COVERAGE LOST/);
    assert.match(say(r), /provider declaration\(s\)/);
  });

  test('a tree with providers but no read edge is COVERAGE LOST', () => {
    const root = fixture();
    const only = [];
    for (let i = 0; i < 30; i++) {
      only.push(i === 0
        ? 'final Provider<int> w0Provider = Provider<int>((ref) => 0);'
        : `final Provider<int> w${i}Provider = Provider<int>((ref) => ref.watch(w${i - 1}Provider));`);
    }
    writeFileSync(join(root, 'apps', 'demo', 'lib', 'state', 'providers.dart'), `${only.join('\n')}\n`);
    const r = run(root);
    assert.equal(r.status, 1, say(r));
    assert.match(say(r), /COVERAGE LOST/);
    assert.match(say(r), /read edge\(s\)/);
  });
});

describe('what the guard deliberately does NOT claim', () => {
  // Stated as an executable assertion rather than a header sentence, because a
  // limit that only lives in prose is one the next reader assumes away. The
  // two-hop watch tear-off — `ref.watch(repoProvider).someMethod` — is the
  // ANTI-PATTERN, and while the loop is open it is legal Riverpod. A guard that
  // failed here would fail on correct code and be switched off by whoever hit it.
  test('an OPEN anti-pattern (watch tear-off, no read back) is green', () => {
    const root = fixture({
      app: {
        'state/auth.dart': `
final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>((ref) => SupabaseAuthRepository());
final Provider<ApiClient> apiClientProvider = Provider<ApiClient>(
  (ref) => DioApiClient(
    tokenProvider: ref.watch(authRepositoryProvider).currentAccessToken,
  ),
);
`,
      },
    });
    const r = run(root);
    assert.equal(r.status, 0, say(r));
  });
});
