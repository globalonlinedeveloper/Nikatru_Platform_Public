// ─────────────────────────────────────────────────────────────────────────────
// adapter-capabilities.test.mjs — assert-adapter-capabilities.mjs must FAIL.
//
// [pipeline C-7] Every adapter declares where it works, and degrades instead of
// crashing. G-17 sat unowned from the beginning; this is where it lands, and it
// is what makes the "six platforms" claim honest at the CAPABILITY level rather
// than only at the builds-green level F-4 covers.
//
// ⚠️ SECOND LINE OF EVIDENCE. Six mutations on the REAL tree first:
//   1. an adapter declaring no matrix                        → caught
//   2. the matrix losing its version pin                     → caught
//   3. a platform ROW deleted from the switch                → NOT caught at
//      first, and the reason is the repo's own recorded rule: the check was
//      grepping PROSE. Every matrix carries a human note naming its platforms
//      ("desktop Windows/Linux"), so deleting the actual row still matched the
//      sentence describing it. Comments AND STRING LITERALS are now stripped
//      before matching, and it is caught.
//   4. the matrix reading the host instead of taking a param → caught
//   5. the test no longer calling forPlatform                → caught
//   6. `\bweb\b` vs `isWeb` — the FIRST run reported the notifications matrix as
//      missing a web row it has handled since it was written. The matcher was
//      wrong, not the matrix; `isWeb` is now accepted, because web cannot be a
//      switch arm (a web build still reports a host TargetPlatform).
//
// ⚠️ Mutation 3 also failed to APPLY on the first two attempts — a perl pattern
// that did not match the formatter's line wrapping. A mutation that fails to
// apply looks exactly like a guard that caught nothing, so it was only settled
// by `grep -c` confirming the row was gone.
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
const GUARD = join(CI_DIR, 'assert-adapter-capabilities.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-caps-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

// SIX since 2026-08-01: `purchases` joined on url_launcher when [pipeline 5]M-13
// moved the money rail out of apps/subly. The list has to track the guard's
// MIN_ADAPTERS floor, or every case below runs against a COVERAGE LOST.
const ADAPTERS = [
  'api_client',
  'auth_supabase',
  'notifications',
  'platform_storage',
  'purchases',
  'telemetry',
];

/** A capability source covering all six platforms, taking the platform as a param.
 *
 *  `schedules` adds a `canSchedule` field, which is the DERIVED DOMAIN of the
 *  [pipeline 13]T-7 schedule-contract limb: a descriptor that promises a
 *  platform can schedule owes the register a contract naming the OS arguments
 *  that make the promise true. Only the notifications fixture sets it, exactly
 *  as only one real adapter does. */
const capsSrc = (symbol, { dropLinux = false, hostOnly = false, schedules = false } = {}) => `
import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// Doc mentioning desktop Windows/Linux and web in PROSE — deliberately, because
/// this is what made the first version of the guard pass a deleted row.
@immutable
class ${symbol} {
  const ${symbol}({required this.works, required this.note});
  final bool works;
  final String note;
${schedules ? '  bool get canSchedule => works;\n' : ''}
  static ${symbol} ${hostOnly ? 'current' : 'forPlatform'}(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) return const ${symbol}(works: false, note: 'web is different');
    return switch (platform) {
      TargetPlatform.android || TargetPlatform.iOS => const ${symbol}(works: true, note: ''),
      TargetPlatform.macOS => const ${symbol}(works: true, note: ''),
      TargetPlatform.windows${dropLinux ? '' : ' || TargetPlatform.linux'} => const ${symbol}(works: false, note: 'desktop Windows/Linux degrade'),
      ${dropLinux ? "TargetPlatform.linux => const " + symbol + "(works: false, note: ''),\n      " : ''}TargetPlatform.fuchsia => const ${symbol}(works: false, note: 'not a target'),
    };
  }
}
`;

const testSrc = (symbol, { callsForPlatform = true } = {}) => `
import 'package:flutter_test/flutter_test.dart';
void main() {
  test('matrix', () {
    final caps = ${symbol}.${callsForPlatform ? 'forPlatform' : 'somethingElse'}(TargetPlatform.linux, isWeb: false);
    expect(caps.works, isFalse);
  });
}
`;

/** A test whose `forPlatform` call lives in a top-level helper the cases call —
 *  the real review_capabilities_test.dart shape, which must stay GREEN. */
const helperTestSrc = (symbol) => `
import 'package:flutter_test/flutter_test.dart';

${symbol} _caps(TargetPlatform p, {bool isWeb = false}) =>
    ${symbol}.forPlatform(p, isWeb: isWeb);

void main() {
  group('${symbol}', () {
    for (final p in TargetPlatform.values) {
      test('row for \$p', () {
        expect(_caps(p).note, isNotNull);
      });
    }
  });
}
`;

/** The scheduling adapter's implementation file. The doc comment NAMES both
 *  pinned arguments in prose — deliberately, because that is what makes a
 *  raw-text scan green against a file where the arguments themselves are gone.
 *  `dropMode` / `dropRepeat` delete the real argument and leave the prose. */
const schedImplSrc = ({
  dropMode = false,
  dropRepeat = false,
  exact = false,
  secondChannel = false,
  noChannel = false,
  channelComment = false,
} = {}) => `
${noChannel ? '' : `const details = AndroidNotificationDetails(
  ${channelComment ? "// A promo channel would be AndroidNotificationDetails('nikatru_promos', ...).\n  " : ''}'nikatru_reminders',
  'Reminders',
);
`}${secondChannel ? `const promo = AndroidNotificationDetails(
  'nikatru_promos',
  'Offers',
);
` : ''}
/// Schedules with androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle
/// and matchDateTimeComponents: DateTimeComponents.time — described here in a
/// comment, which must NOT satisfy the contract on its own.
Future<void> scheduleDaily(int id, Object when) => plugin.zonedSchedule(
      id,
      when,
${dropMode ? '' : `      androidScheduleMode: AndroidScheduleMode.${exact ? 'exact' : 'inexact'}AllowWhileIdle,\n`}${dropRepeat ? '' : '      matchDateTimeComponents: DateTimeComponents.time,\n'}    );
`;

const SCHED_CONTRACT = {
  file: 'packages/notifications/lib/src/impl.dart',
  unobservable: 'set below the port; no fake plugin can observe it',
  requires: [
    { code: 'androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle', why: 'inexact needs no SCHEDULE_EXACT_ALARM' },
    { code: 'matchDateTimeComponents: DateTimeComponents.time', why: 'without it the daily reminder fires once' },
  ],
};

function tree({ mutateRegister = (r) => r, capsOverride = {}, testOverride = {}, schedImpl = schedImplSrc(), capReader = null } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};

  const capabilities = ADAPTERS.map((a) => {
    const symbol = `${a.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())}Capabilities`;
    return {
      id: a,
      owner: `packages/${a}`,
      package: `nikatru_${a}`,
      capabilityMatrix: {
        file: `packages/${a}/lib/src/caps.dart`,
        symbol,
        test: `packages/${a}/test/caps_test.dart`,
        pinnedTo: 'some_sdk 1.x',
        degradesOn: 'web differs',
        ...(a === 'notifications' ? { scheduleContract: JSON.parse(JSON.stringify(SCHED_CONTRACT)) } : {}),
      },
    };
  });
  let register = { capabilities };
  register = mutateRegister(register);
  files['tooling/capability-register.json'] = JSON.stringify(register, null, 2);

  for (const a of ADAPTERS) {
    const symbol = `${a.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())}Capabilities`;
    // Each adapter needs a third-party dep or the derivation will not see it.
    files[`packages/${a}/pubspec.yaml`] = `name: nikatru_${a}\ndependencies:\n  flutter:\n    sdk: flutter\n  some_sdk: ^1.0.0\n`;
    files[`packages/${a}/lib/src/caps.dart`] =
      capsOverride[a] ?? capsSrc(symbol, { schedules: a === 'notifications' });
    files[`packages/${a}/test/caps_test.dart`] = testOverride[a] ?? testSrc(symbol);
  }
  files['packages/notifications/lib/src/impl.dart'] = schedImpl;
  // [13]T-6's tripwire: a file that READS the promo cap. `null` is the honest
  // default, because nothing in the real tree reads it either.
  if (capReader !== null) files['packages/notifications/lib/src/promo.dart'] = capReader;
  // core and design_system are excluded from the adapter derivation by name.
  files['packages/core/pubspec.yaml'] = 'name: nikatru_core\ndependencies:\n  crypto: ^3.0.0\n';
  files['packages/design_system/pubspec.yaml'] = 'name: nikatru_design_system\ndependencies:\n  flutter:\n    sdk: flutter\n';

  for (const [f, body] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-adapter-capabilities', () => {
  // 🔴 TWO CAPABILITIES CAN SHARE ONE OWNER, and the guard used to key its
  // register lookup on a Map — so the LAST entry silently replaced the earlier
  // one and its matrix stopped being checked, while the guard printed
  // `ok N matrices exercised`. Found 2026-07-29 on the REAL tree, by adding the
  // `review` capability to packages/platform_storage and watching
  // StorageCapabilities vanish from the checked set.
  //
  // The register has always allowed this (`core` owns both `core` and
  // `analytics_funnel`), so it was a latent bug waiting for the first adapter to
  // grow a second capability.
  test('checks BOTH matrices when one package owns two capabilities', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        const first = r.capabilities.find((c) => c.owner === 'packages/api_client');
        r.capabilities.push({
          ...JSON.parse(JSON.stringify(first)),
          id: 'api_client_second',
          capability: 'a second capability on the same package',
        });
        return r;
      },
    }));
    assert.equal(code, 0);
    assert.match(
      out,
      /7 adapter matrix\/matrices exercised per-platform/,
      'the second capability on the same owner was not examined — it reports as covered while nothing checks it',
    );
  });

  test('passes when every adapter declares and proves its matrix', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /6 adapter\(s\) derived from the tree/);
    assert.match(out, /6 adapter matrix\/matrices exercised per-platform/);
    // The gaps must PRINT — a platform gap nobody sees becomes a support ticket.
    assert.match(out, /Where each adapter DEGRADES/);
  });

  test('FAILS when an adapter declares no matrix at all', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        delete r.capabilities.find((c) => c.id === 'telemetry').capabilityMatrix;
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /declares NO capability matrix/);
  });

  // A matrix with no version pin silently rots at the next dependency bump —
  // the notifications one names 17.x for exactly this reason.
  test('FAILS when the matrix loses its version pin', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        delete r.capabilities.find((c) => c.id === 'telemetry').capabilityMatrix.pinnedTo;
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /missing `pinnedTo`/);
  });

  // 🔴 THE MUTATION THAT EXPOSED A PROSE-GREPPING BUG IN THIS GUARD. The row is
  // deleted from the switch while the note still SAYS "Windows/Linux".
  test('FAILS when a platform row is deleted but the prose still names it', () => {
    const { code, out } = run(tree({
      capsOverride: { telemetry: capsSrc('TelemetryCapabilities', { dropLinux: true }).replace(/TargetPlatform\.linux => const TelemetryCapabilities\(works: false, note: ''\),\n      /, '') },
    }));
    assert.equal(code, 1);
    assert.match(out, /does not mention linux/);
    assert.match(out, /INCOMPLETE matrix is worse than none/);
  });

  test('FAILS when the matrix reads the host instead of taking a platform', () => {
    const { code, out } = run(tree({
      capsOverride: { telemetry: capsSrc('TelemetryCapabilities', { hostOnly: true }) },
    }));
    assert.equal(code, 1);
    assert.match(out, /has no `forPlatform\(\.\.\.\)` entry point/);
  });

  test('FAILS when the test never exercises the per-platform rows', () => {
    const { code, out } = run(tree({
      testOverride: { telemetry: testSrc('TelemetryCapabilities', { callsForPlatform: false }) },
    }));
    assert.equal(code, 1);
    assert.match(out, /never calls `forPlatform`/);
  });

  // ── 🔴 THE SEVENTH MUTATION: the test half was still grepping PROSE ────────
  // Mutation 3 above taught this guard to strip comments and string literals
  // before scanning the DESCRIPTOR. The TEST scan, eight lines further down, was
  // left reading the raw file — for months, under a note explaining why that is
  // wrong. Proven on a copy of the real tree 2026-08-01: replacing
  // packages/telemetry/test/telemetry_capabilities_test.dart with three comment
  // lines mentioning `TelemetryCapabilities` and `forPlatform(` plus
  // `void main() {}` left the guard printing `ok 6 adapter matrix/matrices
  // exercised per-platform by their own tests`, exit 0 — and `dart test` stays
  // green too, because the file compiles and declares no failing case.
  test('FAILS when the test is gutted to prose that merely MENTIONS the symbol', () => {
    const { code, out } = run(tree({
      testOverride: {
        telemetry:
          '// This file no longer exercises anything.\n' +
          '// It merely mentions TelemetryCapabilities and forPlatform( in prose.\n' +
          'void main() {}\n',
      },
    }));
    assert.equal(code, 1, 'a comment is not a test');
    assert.match(out, /never references `TelemetryCapabilities` in CODE/);
  });

  test('FAILS when the symbol survives only inside a string literal', () => {
    const { code, out } = run(tree({
      testOverride: {
        telemetry:
          "import 'package:flutter_test/flutter_test.dart';\n" +
          "void main() {\n  test('placeholder', () {\n" +
          "    expect('TelemetryCapabilities.forPlatform(…) is coming', isNotEmpty);\n" +
          '  });\n}\n',
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /never references `TelemetryCapabilities` in CODE/);
  });

  test('FAILS when every case is commented out, leaving real code that asserts nothing', () => {
    const { code, out } = run(tree({
      testOverride: {
        telemetry:
          "import 'package:flutter_test/flutter_test.dart';\n\n" +
          'TelemetryCapabilities _caps(TargetPlatform p) =>\n' +
          '    TelemetryCapabilities.forPlatform(p, isWeb: false);\n\n' +
          'void main() {\n' +
          "  // test('rows', () {\n" +
          '  //   expect(_caps(TargetPlatform.linux).works, isFalse);\n' +
          '  // });\n' +
          '  print(_caps(TargetPlatform.android));\n' +
          '}\n',
      },
    }));
    assert.equal(code, 1, 'the symbol and forPlatform are real code, but nothing runs');
    assert.match(out, /declares no `test\(`\/`testWidgets\(` case at all/);
  });

  test('FAILS when the cases call forPlatform but assert nothing', () => {
    const { code, out } = run(tree({
      testOverride: {
        telemetry:
          "import 'package:flutter_test/flutter_test.dart';\n" +
          "void main() {\n  test('matrix', () {\n" +
          '    TelemetryCapabilities.forPlatform(TargetPlatform.linux, isWeb: false);\n' +
          '  });\n}\n',
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /asserts nothing/);
  });

  // ⚠️ …and the legitimate shape the tightening could have broken. Requiring
  // `forPlatform(` INSIDE a `test(` body was tried and REJECTED: the real
  // review_capabilities_test.dart calls it from a top-level `_caps()` helper, so
  // the strict version falsely accused a correct test — the guard would have
  // been the thing that was wrong.
  test('PASSES when forPlatform is called through a top-level helper', () => {
    const { code, out } = run(tree({
      testOverride: { telemetry: helperTestSrc('TelemetryCapabilities') },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /6 adapter matrix\/matrices exercised per-platform/);
  });

  test('FAILS when the named capability file does not exist', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        r.capabilities.find((c) => c.id === 'telemetry').capabilityMatrix.file = 'packages/telemetry/lib/src/gone.dart';
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /which does not exist/);
  });

  // ── [pipeline 13]T-7 · the OS rules a `canSchedule` row schedules under ────
  //
  // Proven against the REAL tree first (2026-08-02), five mutations, each
  // restored from memory and byte-compared:
  //   1. inexactAllowWhileIdle → exactAllowWhileIdle                 → caught
  //   2. matchDateTimeComponents deleted                             → caught
  //   3. BOTH deleted, leaving only the comment that names them      → caught
  //      (this is the one that matters: the doc comment directly above those
  //      arguments spells both of them out, so a raw-text scan is green here)
  //   4. `scheduleContract` renamed out of the register              → caught
  //      — i.e. deleting the declaration makes the build RED, not quieter,
  //      which is the whole point of T-9a's sibling finding
  //   5. a `requires` entry that pins a `codeX` instead of a `code`  → caught
  test('FAILS when the pinned Android schedule MODE is flipped to exact', () => {
    const { code, out } = run(tree({ schedImpl: schedImplSrc({ exact: true }) }));
    assert.equal(code, 1);
    assert.match(out, /no longer passes `androidScheduleMode: AndroidScheduleMode\.inexactAllowWhileIdle`/);
    assert.match(out, /SCHEDULE_EXACT_ALARM/);
  });

  test('FAILS when the daily REPEAT argument is deleted (fires once, looks fine for a day)', () => {
    const { code, out } = run(tree({ schedImpl: schedImplSrc({ dropRepeat: true }) }));
    assert.equal(code, 1);
    assert.match(out, /no longer passes `matchDateTimeComponents: DateTimeComponents\.time`/);
  });

  // The mutation that separates a structural assertion from a prose grep. Both
  // arguments are gone; the doc comment that NAMES both of them is untouched.
  test('FAILS when only the COMMENT describing the arguments survives', () => {
    const { code, out } = run(tree({ schedImpl: schedImplSrc({ dropMode: true, dropRepeat: true }) }));
    assert.equal(code, 1);
    assert.match(out, /no longer passes `androidScheduleMode/);
    assert.match(out, /no longer passes `matchDateTimeComponents/);
  });

  // A descriptor that promises scheduling and declares no contract. The domain
  // is DERIVED from the descriptor's own `canSchedule` field, so a second
  // scheduling adapter cannot arrive without one either.
  test('FAILS when a canSchedule descriptor declares no scheduleContract', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        delete r.capabilities.find((c) => c.id === 'notifications').capabilityMatrix.scheduleContract;
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /declares a `canSchedule` row but its capabilityMatrix has no `scheduleContract`/);
  });

  test('FAILS when the contract exists but pins nothing', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        r.capabilities.find((c) => c.id === 'notifications').capabilityMatrix.scheduleContract.requires = [];
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /non-empty `requires`/);
  });

  // 🔴 THE LIMB'S OWN EMPTY-DOMAIN CASE. Drop `canSchedule` from the descriptor
  // and every assertion above ranges over nothing — which without this check is
  // indistinguishable from every assertion holding.
  test('FAILS with COVERAGE LOST when no descriptor declares canSchedule at all', () => {
    const { code, out } = run(tree({
      capsOverride: { notifications: capsSrc('NotificationsCapabilities', { schedules: false }) },
      mutateRegister: (r) => {
        delete r.capabilities.find((c) => c.id === 'notifications').capabilityMatrix.scheduleContract;
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no capability descriptor declares a `canSchedule` field/);
  });

  // ── [pipeline 13]T-6 · the promo tripwire, whose domain is empty today ─────
  //
  // The requirement's second conjunct ("the promo send path refuses to exceed
  // the cap") quantifies over a subsystem that does not exist and is not being
  // built, so a rate limiter here would be an assertion with no writable
  // failing input. What IS assertable is that a promotional touch and its cap
  // must arrive TOGETHER, and that a promo may not ride the reminders channel.
  //
  // Mutation-proven on the REAL tree first (2026-08-02): a second channel with
  // no cap reader → caught; a cap reader with one channel → caught; the channel
  // constructor renamed → COVERAGE LOST; a COMMENT naming a second channel →
  // stayed green. That last one was NOT green on the first attempt: reading the
  // channel ID out of the raw source broke when a comment sat between the
  // constructor and its first argument, and the guard blamed the adapter for
  // its own scanner bug. Hence `stripDartCommentsOnly`.
  const capReaderSrc = 'int budget(dynamic cfg) => cfg.maxPromosPerWeek;\n';

  test('PRINTS an armed tripwire with an empty domain when nothing sends', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /TRIPWIRE ARMED, DOMAIN EMPTY/);
    // The honest state has to be legible, not merely non-failing.
    assert.match(out, /There is no promo sender/);
  });

  test('FAILS when a second notification channel arrives with no cap reader', () => {
    const { code, out } = run(tree({ schedImpl: schedImplSrc({ secondChannel: true }) }));
    assert.equal(code, 1);
    assert.match(out, /a second notification channel exists \(nikatru_promos\)/);
  });

  // The other direction, and the one that stops a promo riding the reminders
  // channel: block promos and you would lose your reminders with them.
  test('FAILS when something reads the cap and reminders is still the only channel', () => {
    const { code, out } = run(tree({ capReader: capReaderSrc }));
    assert.equal(code, 1);
    assert.match(out, /is still the only notification channel/);
    assert.match(out, /separately\s+opt-outable channel/);
  });

  test('PASSES when the cap reader and a separate channel arrive together', () => {
    const { code, out } = run(tree({
      capReader: capReaderSrc,
      schedImpl: schedImplSrc({ secondChannel: true }),
    }));
    assert.equal(code, 0, out);
    assert.match(out, /promo cap read on 1 path\(s\), delivered on a channel separate from nikatru_reminders/);
  });

  test('a COMMENT naming a second channel is prose, not a channel', () => {
    const { code, out } = run(tree({ schedImpl: schedImplSrc({ channelComment: true }) }));
    assert.equal(code, 0, out);
    assert.match(out, /TRIPWIRE ARMED, DOMAIN EMPTY/);
    assert.match(out, /nikatru_reminders/);
  });

  test('FAILS with COVERAGE LOST when no channel declaration is found at all', () => {
    const { code, out } = run(tree({ schedImpl: schedImplSrc({ noChannel: true }) }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no notification channel declaration/);
  });

  // Coverage self-check: a derivation that finds almost nothing reads exactly
  // like "every adapter is compliant".
  test('FAILS rather than reporting clean when the derivation goes thin', () => {
    const root = tree();
    for (const a of ['telemetry', 'notifications', 'platform_storage']) {
      rmSync(join(root, 'packages', a), { recursive: true, force: true });
    }
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — derived only \d+ adapter\(s\)/);
  });
});
