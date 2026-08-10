// ─────────────────────────────────────────────────────────────────────────────
// flag-exposure.test.mjs — assert-flag-exposure.mjs must be able to FAIL.
//
// [pipeline 11]E-12 a rollout is measurable: exposure is an event that shares
// the bucketing id the decision used.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-02, THREE
// against the guard, TWO against the Dart tests). Every restore was
// byte-compared and re-run green, and every Dart mutation was
// `dart analyze`-verified clean first.
//
//   MF1 the wrapper's bucket replaced with          -> guard caught: "does not
//       `flag.hashCode % 100` (analyze clean)           call `flagBucket(`"
//                                                    -> AND the Dart test
//                                                       "carries … THE DECISION'S
//                                                       bucket" went red
//   MF2 the brick's featureFlagsProvider reverted   -> caught: "constructs a raw
//       to a raw `core.FeatureFlags`                    `FeatureFlags(` outside
//                                                       any `ObservedFeatureFlags(`"
//   MF3 the per-session dedupe removed              -> the Dart tests "exactly one
//       (`if (_exposed.add(flag))` → unconditional,     exposure per session" and
//       analyze clean)                                  "two different flags each
//                                                       get one" both went red
//
// 🔴 THE RED THIS RECORDS: `grep -rn variant_exposed` matched NOTHING in this
//   repository, in any language, while `resolveFlag` had been shipping since
//   CFG G-14. Every percentage rollout the chassis can express was unmeasurable
//   by construction, and rollout percents are not versioned — so once one is
//   ramped the treatment group cannot be reconstructed at all.
//
// ⚠️ AND THE HONEST LIMIT, asserted here rather than left implicit: `.isOn(` has
//   ZERO non-test callers today, so the "every flag read is observed" rule holds
//   VACUOUSLY on the call-site side. The guard PRINTS that on every run and a
//   test below asserts the printing, because an assertion over an empty set is
//   this repository's cardinal sin unless it is visible. What is NOT vacuous is
//   the TYPE limb: the chassis hands out an observed flag set, so the fifty-first
//   stamped app cannot read a flag silently.
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
const GUARD = join(CI_DIR, 'assert-flag-exposure.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-flag-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const WRAPPER = `
import '../analytics/analytics.dart';
import 'flag_resolver.dart';

/// A comment that says 'variant_exposed' and flagBucket( in prose only.
class ObservedFeatureFlags implements FeatureFlags {
  ObservedFeatureFlags({required FeatureFlags flags, required Analytics analytics})
      : _flags = flags, _analytics = analytics;
  final FeatureFlags _flags;
  final Analytics _analytics;
  final Set<String> _exposed = <String>{};
  @override
  bool isOn(String flag) {
    final bool value = _flags.isOn(flag);
    if (_exposed.add(flag)) { unawaited(_record(flag, value)); }
    return value;
  }
  Future<void> _record(String flag, bool value) async {
    await _analytics.log('variant_exposed', params: <String, Object?>{
      'flag': flag,
      'variant': value ? 'on' : 'off',
      'bucket': flagBucket(flag: flag, stableId: _flags.stableId),
    });
  }
}
`;

const RESOLVER = `
int flagBucket({required String flag, required String stableId}) => 0;
class FeatureFlags {
  const FeatureFlags({required this.rollouts, required this.stableId});
  final Map<String, int> rollouts;
  final String stableId;
  bool isOn(String flag) => false;
}
`;

const BARREL = "export 'src/config/flag_resolver.dart';\nexport 'src/config/observed_feature_flags.dart';\n";

const BRICK_PROVIDERS = `
// A comment naming core.FeatureFlags( in prose, which must not count.
final FutureProvider<core.ObservedFeatureFlags> featureFlagsProvider =
    FutureProvider<core.ObservedFeatureFlags>((ref) async {
      return core.ObservedFeatureFlags(
        flags: core.FeatureFlags(rollouts: cfg.flags, stableId: id),
        analytics: await ref.watch(analyticsProvider.future),
      );
    });
`;

const BRICK_REL = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart';

function makeRepo(edit = (f) => f) {
  const root = join(TMP, `r${seq++}`);
  const files = edit({
    'packages/core/lib/src/config/observed_feature_flags.dart': WRAPPER,
    'packages/core/lib/src/config/flag_resolver.dart': RESOLVER,
    'packages/core/lib/nikatru_core.dart': BARREL,
    [BRICK_REL]: BRICK_PROVIDERS,
    'apps/demo/lib/main.dart': 'void main() {}\n',
  });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const p = join(root, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-flag-exposure — the emitting wrapper is real', () => {
  test('PASSES on a wrapper that emits with the decision\'s bucket', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1\/1 raw FeatureFlags construction\(s\) wrapped/);
  });

  test('FAILS when the wrapper does not name the event in CODE', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/config/observed_feature_flags.dart':
        f['packages/core/lib/src/config/observed_feature_flags.dart'].replace(
          "'variant_exposed', params:",
          "'flag_read', params:",
        ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not name the `variant_exposed` event in code/);
  });

  test('a comment mentioning the event does not satisfy the check', () => {
    // The passing fixture's doc comment says 'variant_exposed' and flagBucket(
    // in prose. If comments counted, the two failing cases here could not fail.
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/config/observed_feature_flags.dart':
        f['packages/core/lib/src/config/observed_feature_flags.dart']
          .replace("'variant_exposed', params:", "'flag_read', params:")
          .replace('flagBucket(flag: flag, stableId: _flags.stableId)', '0'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not name the `variant_exposed` event in code/);
    assert.match(r.out, /does not call `flagBucket\(`/);
  });

  test('FAILS when the event bucket comes from a SECOND hash', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/config/observed_feature_flags.dart':
        f['packages/core/lib/src/config/observed_feature_flags.dart'].replace(
          'flagBucket(flag: flag, stableId: _flags.stableId)',
          'flag.hashCode % 100',
        ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not call `flagBucket\(`/);
  });

  // One case per param, generated: dropping any one of the three leaves an
  // exposure that cannot be joined to an arm, and all three must be able to fail.
  for (const key of ['flag', 'variant', 'bucket']) {
    test(`FAILS when the event drops its \`${key}\` param`, () => {
      const r = run(makeRepo((f) => ({
        ...f,
        'packages/core/lib/src/config/observed_feature_flags.dart':
          f['packages/core/lib/src/config/observed_feature_flags.dart'].replace(
            new RegExp(`'${key}':[^\\n]*\\n`),
            '',
          ),
      })));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, new RegExp(`carries no \\\`${key}\\\` param`));
    });
  }

  test('FAILS when the per-session dedupe is gone', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/config/observed_feature_flags.dart':
        f['packages/core/lib/src/config/observed_feature_flags.dart']
          .replace('if (_exposed.add(flag)) { unawaited(_record(flag, value)); }', 'unawaited(_record(flag, value));'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has no per-session dedupe/);
  });

  test('FAILS when the wrapper does not go through the Analytics facade', () => {
    // Consent gating lives on the facade. Anything reaching a transport
    // directly is a second path to the wire the DPDP state does not control.
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/config/observed_feature_flags.dart':
        f['packages/core/lib/src/config/observed_feature_flags.dart'].replaceAll('Analytics', 'EventTransport'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not depend on the `Analytics` facade/);
  });

  test('FAILS when the barrel stops exporting the wrapper', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/nikatru_core.dart': "export 'src/config/flag_resolver.dart';\n",
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not export the wrapper/);
  });
});

describe('assert-flag-exposure — no raw reader escapes', () => {
  test('FAILS on a raw FeatureFlags outside any wrapper', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      [BRICK_REL]: `
final FutureProvider<core.FeatureFlags> featureFlagsProvider =
    FutureProvider<core.FeatureFlags>((ref) async {
      return core.FeatureFlags(rollouts: cfg.flags, stableId: id);
    });
`,
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /constructs a raw `FeatureFlags\(` outside any `ObservedFeatureFlags\(`/);
  });

  test('FAILS on a raw one in an APP as well as in the brick', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'apps/demo/lib/flags.dart': 'final f = core.FeatureFlags(rollouts: {}, stableId: "x");\n',
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /apps\/demo\/lib\/flags\.dart:1 constructs a raw/);
  });

  test('a raw construction inside a TEST is not a violation', () => {
    // A reader whose only caller is a test is exactly the state being rejected,
    // so tests are out of scope — the same exclusion assert-seams-wired.mjs makes.
    const r = run(makeRepo((f) => ({
      ...f,
      'apps/demo/test/flags_test.dart': 'final f = core.FeatureFlags(rollouts: {}, stableId: "x");\n',
    })));
    assert.equal(r.code, 0, r.out);
  });

  test('a raw construction in a COMMENT is not a violation', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'apps/demo/lib/notes.dart': '// Do not write core.FeatureFlags(rollouts: {}, stableId: "x") here.\n',
    })));
    assert.equal(r.code, 0, r.out);
  });
});

describe('assert-flag-exposure — the vacuity is printed, not hidden', () => {
  test('PRINTS that there are zero call sites, and still exits 0', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    // Both halves: an exit-code-only assertion would pass just as happily if the
    // notice disappeared, and the notice is the whole reason this rule is
    // honest while its call-site set is empty.
    assert.match(r.out, /ZERO non-test `\.isOn\(` call sites/);
    assert.match(r.out, /VACUOUSLY TRUE today/);
    assert.match(r.out, /0 call site\(s\)/);
  });

  test('LISTS the call sites once there are any', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'apps/demo/lib/home.dart': 'final on = flags.isOn("newHome");\n',
    })));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 non-test `\.isOn\(` call site\(s\)/);
    assert.match(r.out, /apps\/demo\/lib\/home\.dart:1/);
    assert.doesNotMatch(r.out, /ZERO non-test/);
  });
});

describe('assert-flag-exposure — coverage self-checks', () => {
  test('COVERAGE LOST when the wrapper file is gone', () => {
    const r = run(makeRepo((f) => ({ ...f, 'packages/core/lib/src/config/observed_feature_flags.dart': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*observed_feature_flags\.dart does not exist/s);
  });

  test('COVERAGE LOST when flagBucket no longer exists to compare against', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/config/flag_resolver.dart':
        f['packages/core/lib/src/config/flag_resolver.dart'].replace('int flagBucket(', 'int bucketOf('),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*no longer declares `flagBucket`/s);
  });

  test('COVERAGE LOST when no FeatureFlags construction exists to police', () => {
    const r = run(makeRepo((f) => ({ ...f, [BRICK_REL]: '// nothing here\n' })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no `FeatureFlags\(` construction was found/);
  });

  test('COVERAGE LOST when the consumer scan reaches no Dart at all', () => {
    const r = run(makeRepo((f) => ({ ...f, [BRICK_REL]: null, 'apps/demo/lib/main.dart': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no \.dart file under/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMB 4 — the RAW `resolveFlag(`/`flagBucket(` reader, counted and capped.
//
// 🔴 ADDED 2026-08-10 AFTER AN ADVERSARIAL REVIEW POINTED OUT THAT THE LIMB
// SHIPPED WITH NO CHECKED-IN CASE. It had been negative-tested by mutating the
// real tree — this repo's stronger standard — but a mutation nobody records is
// one the next edit does not have to survive, and `assert-guard-coverage.mjs`
// cannot see the gap because its coverage is FILE-level, not limb-level: the
// file had cases, so the new limb inside it was invisible.
//
// The rows below cover the three states the limb has — at the ceiling
// (printed), over it (failed), and empty (still printed) — plus the two
// exclusions, because a limb that counted prose would report a ceiling breach
// for the paragraph explaining the ceiling.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-flag-exposure — the raw-reader ceiling can FAIL', () => {
  const raw = (n) =>
    Array.from(
      { length: n },
      (_, i) => `final bool v${i} = core.resolveFlag(flag: 'f${i}', rolloutPercent: 0, stableId: id);`,
    ).join('\n') + '\n';

  test('AT the ceiling: two raw reads are printed with file:line, exit 0', () => {
    const r = run(makeRepo((f) => ({ ...f, 'apps/demo/lib/promo.dart': raw(2) })));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2\/2 UNMEASURED rollout read\(s\)/);
    assert.match(r.out, /apps\/demo\/lib\/promo\.dart:1 \(resolveFlag\)/);
    assert.match(r.out, /apps\/demo\/lib\/promo\.dart:2 \(resolveFlag\)/);
  });

  test('OVER the ceiling: a third raw read FAILS the build', () => {
    // The state the ceiling exists for — "one deliberate exception" becoming
    // the way rollouts are read. The message must NAME the sites, or the fix is
    // a hunt through 600 files.
    const r = run(makeRepo((f) => ({ ...f, 'apps/demo/lib/promo.dart': raw(3) })));
    assert.equal(r.code, 1, r.out);
    assert.match(
      r.out,
      /3 raw `resolveFlag\(`\/`flagBucket\(` call site\(s\) in non-test code, and the checked-in ceiling is 2/,
    );
    assert.match(r.out, /apps\/demo\/lib\/promo\.dart:3/);
  });

  test('`flagBucket(` counts toward the same ceiling as `resolveFlag(`', () => {
    // Both doors, one counter: bucketing on-device and deciding on-device are
    // the same unmeasured read wearing different names.
    const r = run(makeRepo((f) => ({
      ...f,
      'apps/demo/lib/promo.dart':
        "final int b = core.flagBucket(flag: 'a', stableId: id);\n" +
        "final int c = flagBucket(flag: 'b', stableId: id);\n" +
        "final int d = core.flagBucket(flag: 'c', stableId: id);\n",
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /3 raw `resolveFlag\(`\/`flagBucket\(` call site\(s\)/);
    assert.match(r.out, /\(flagBucket\)/);
  });

  test('ZERO raw readers is PRINTED, not silent', () => {
    // The day owner decision D6 says measure, this is the line that has to
    // appear. An empty set reported as nothing at all is indistinguishable from
    // a scanner that stopped scanning.
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ZERO raw `resolveFlag\(`\/`flagBucket\(` call sites \(ceiling 2\)/);
  });

  test('raw reads in COMMENTS and in TESTS do not count', () => {
    // Six mentions that must all be invisible — including two in a block
    // comment, because this guard's own explanation of the rule is written in
    // the words the rule matches.
    const r = run(makeRepo((f) => ({
      ...f,
      'apps/demo/lib/notes.dart':
        '// Never call core.resolveFlag(flag: x) or flagBucket(flag: x) here.\n' +
        '/* resolveFlag( twice, flagBucket( twice */\n',
      'apps/demo/test/promo_test.dart': raw(2),
    })));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ZERO raw `resolveFlag\(`\/`flagBucket\(` call sites/);
  });
});
