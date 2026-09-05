// ─────────────────────────────────────────────────────────────────────────────
// seams-wired.test.mjs — PACK CONSUMER LIMB (c) of assert-seams-wired.mjs must
// be able to fail, and must fail for the right reason.
//
// WHY A SECOND FILE. `assert-seams-wired.mjs` is already exercised by
// guards.test.mjs's `describe('assert-seams-wired')`, and that is where the
// seam-by-seam `needs` cases live. This file is deliberately narrow: it covers
// the limb added 2026-08-21, whose whole subject is that the seam's `needs`
// anchors could not tell a CALL from a lazily-evaluated DECLARATION, and whose
// print branch is the one the real tree takes. A limb that has only ever printed
// one branch is a limb whose other branches are unrun — this repo's own rule —
// so every branch below is entered against a throwaway tree rather than trusted.
//
// WHAT THE LIMB CLAIMS, restated so a failure here is legible:
//   · a Riverpod provider BODY is a declaration; `.load(expectPackId:)` matching
//     inside it proves a call site exists, not that anything runs it;
//   · a READ through a ref (`ref.watch/read/listen(contentPackProvider)`) in a
//     shipped, non-test chassis file is what proves a consumer;
//   · with the pack SHELF unbuilt ([4]B-18: no `r2_buckets` in
//     services/platform/wrangler.jsonc) the gap is OWNER work, so it PRINTS;
//   · once a bucket is bound the gap is agent work, so it FAILS.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-seams-'));
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** Build a throwaway fixture tree. `null` contents means the file is ABSENT. */
function fixture(name, files) {
  const dir = join(ROOT, name);
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run the guard as CI runs it: real subprocess, real exit code. */
function run(cwd) {
  const r = spawnSync(process.execPath, [join(CI_DIR, 'assert-seams-wired.mjs')], {
    cwd,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('assert-seams-wired · pack consumer limb (c)', () => {
  const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

  // ── the baseline tree ──────────────────────────────────────────────────────
  // 🔴 EVERY OTHER SEAM IN THE GUARD HAS TO BE SATISFIED HERE, or these cases
  // pass on a red run for a reason that has nothing to do with limb (c) and the
  // exit-code assertions below mean nothing. That is why this file carries a
  // whole valid tree and opens with a case asserting the BASELINE IS GREEN: if
  // the guard grows a seam, that case fails loudly instead of the rest of the
  // file silently agreeing with a broken fixture.
  const PACK_LOADER = `
final Provider<core.ContentPackLoader> contentPackLoaderProvider =
    Provider<core.ContentPackLoader>(
      (ref) =>
          core.ContentPackLoader(verifier: ref.watch(packVerifierProvider)),
    );
`;
  // The DECLARATION and nothing else — the exact shape of the real tree, and the
  // shape an identifier match would have called a consumer.
  const PACK_LOAD_DECL = `
final FutureProvider<core.ContentPack?> contentPackProvider =
    FutureProvider<core.ContentPack?>((ref) async {
      final core.Result<core.ContentPack> r = await ref
          .watch(contentPackLoaderProvider)
          .load(expectPackId: AppConfig.appId, remote: source);
      return r.fold((core.ContentPack p) => p, (core.Failure _) => null);
    });
`;

  const brickProviders = `const String kPrivacyPolicyVersion = '2026-07-26';
Future<bool> applyReminderChoice({required bool on}) async {
  await svc.init();
  await svc.scheduleDaily(core.DailyReminder(id: kDailyReminderId));
  return true;
}
Future<void> maybeAsk() async {
  if (decision.shouldAsk) {
    await prompter.requestReview();
  }
}
${PACK_LOADER}${PACK_LOAD_DECL}
Future<void> markShown(core.PromoGateState decided) async {
  await kv.write(_promoCardKey, decided.encode());
}
List<UserStateDrop> userStateDrops(WidgetRef ref) => <UserStateDrop>[
  ref.read(entitlementCacheProvider).clear,
  ref.read(notificationServiceProvider).cancelAll,
];
Future<void> signOutAndForgetUser(WidgetRef ref) async {
  final core.AuthRepository auth = ref.read(authRepositoryProvider);
  final List<UserStateDrop> drops = userStateDrops(ref);
  await auth.signOut();
  await forgetSignedInUser(drops);
}
`;

  const brickHome = `
Widget build(BuildContext context) => PaywallGate(
  locked: ref.watch(paywallLockedProvider),
  child: const SizedBox.shrink(),
);
children: <Widget>[const UpgradePromoCard()],
final core.PromoGateDecision decision = core.PromoObjection(consent)
    .decide(
      ref.watch(promoGateProvider),
      stored,
      now: DateTime.now(),
      featureEnabled: cfg?.feature(kPromoCardFeature) ?? false,
      hasContent: offerings.isNotEmpty,
    );
ref.read(promoCardStateProvider.notifier).markShown(decision.state);
`;

  const brickSettings = `onChanged: (bool on) => c.applyReminderChoice(on: on),
onTap: () => _signOut(context, ref, l10n),
Future<void> _signOut(BuildContext context, WidgetRef ref, AppLocalizations l10n) async {
  await signOutAndForgetUser(ref);
}
`;

  const DSN = 'run: flutter build web --release --dart-define=GLITCHTIP_DSN=${{ secrets.GLITCHTIP_DSN }}\n';
  const jobWith = (name, body) =>
    `  ${name}:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: build\n        ${body
      .trimEnd()
      .split('\n')
      .join('\n        ')}\n`;
  const workflow = (...jobs) => `name: fixture\non: [push]\njobs:\n${jobs.join('')}`;

  const CHANNEL_REGISTER = JSON.stringify(
    {
      channels: [
        { id: 'web', lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' } },
        { id: 'android-play', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
        { id: 'windows-store', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'windows' } },
        { id: 'linux-snap', lane: { workflow: '.github/workflows/submit-snap.yml', job: 'dry-run' } },
      ],
    },
    null,
    2,
  );

  /**
   * @param homeExtra   appended to the brick's home screen — the CHASSIS consumer slot.
   * @param subly       an extra apps/subly lib file — a consumer OUTSIDE the chassis.
   * @param brickTest   a file under the brick's `test/` tree — the excluded witness.
   * @param wrangler    services/platform/wrangler.jsonc, or null for absent.
   */
  const build = (
    name,
    { homeExtra = '', subly = null, brickTest = null, wrangler = null, keys = '' } = {},
  ) => {
    const files = {};
    // 14 filler files: the guard fails COVERAGE LOST below 12 scanned dart files,
    // which would redden every case here for the wrong reason.
    for (let i = 0; i < 14; i++) files[`apps/subly/lib/filler_${i}.dart`] = '// filler\n';
    Object.assign(files, {
      'packages/core/lib/src/content/ed25519_pack_verifier.dart':
        'class Ed25519PackVerifier implements PackVerifier {\n  verify() async { if (x == null) return false; return await _ed.verify(m); }\n}\n',
      'packages/core/lib/nikatru_core.dart': "export 'src/content/ed25519_pack_verifier.dart';\n",
      // Empty key map by default: half (b) then takes its OWNER-GATED print, so
      // no case here depends on a key being pinned. `keys` fills it for the two
      // cases that prove the print's key count is READ rather than written down.
      'packages/core/lib/src/content/pack_verifier.dart':
        `const Map<String, String> kContentPackPublicKeys = <String, String>{${keys}};\n`,
      [`${BRICK}/lib/state/providers.dart`]: brickProviders,
      [`${BRICK}/lib/features/settings/settings_screen.dart`]: brickSettings,
      [`${BRICK}/lib/state/money_providers.dart`]: `
final FutureProvider<core.Entitlements> entitlementsProvider =
    FutureProvider<core.Entitlements>((ref) async {
      final core.Result<core.Entitlements> fresh = await ref
          .watch(entitlementTransportProvider)
          .fetch(
            appId: AppConfig.appId,
            accessToken: await ref.read(authRepositoryProvider).currentAccessToken(),
          );
      return fresh.fold((core.Entitlements e) => e, (core.Failure _) => core.Entitlements.none);
    });
`,
      [`${BRICK}/lib/features/home/home_screen.dart`]: brickHome + homeExtra,
      [`${BRICK}/lib/features/monetization/paywall_screen.dart`]: `
Future<void> _buy(Offering offering) async {
  final CheckoutStart start = await rail.startCheckout(offering);
}
`,
      [`${BRICK}/lib/main.dart`]: `
Future<void> main() async {
  await initNikatruAuth(
    url: AppConfig.supabaseUrl,
    publishableKey: AppConfig.supabaseAnonKey,
    secureStore: FlutterSecureStore(),
  );
}
`,
      'apps/subly/lib/state/analytics_providers.dart': `
final x = () async {
  await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
  );
};
Future<void> applyConsentDecision({
  core.ConsentPurpose purpose = core.ConsentPurpose.analytics,
}) async {}
Future<void> recordAnalyticsConsent(
  WidgetRef ref, {
  required bool granted,
}) async {}
const String kPrivacyPolicyVersion = '2026-07-26';
`,
      'apps/subly/lib/features/consent/consent_prompt.dart':
        'onPressed: () => recordAnalyticsConsent(ref, granted: true),',
      'apps/subly/lib/main.dart': "final dsn = String.fromEnvironment('GLITCHTIP_DSN');\n",
      'packages/telemetry/lib/src/telemetry_bootstrap.dart':
        'options.enableAutoSessionTracking = false;\n',
      'sites/nikatru/privacy.html': '<p class="updated" data-policy-version="2026-07-26">x</p>',
      'tooling/channel-register.json': CHANNEL_REGISTER,
      '.github/workflows/deploy-web.yml': workflow(jobWith('deploy-web', DSN)),
      '.github/workflows/build-platforms.yml': workflow(
        jobWith('linux_web_android', DSN),
        jobWith('windows', DSN),
      ),
      '.github/workflows/submit-snap.yml': workflow(jobWith('dry-run', DSN)),
      'apps/subly/lib/pack_consumer.dart': subly,
      [`${BRICK}/test/chassis_properties_test.dart`]: brickTest,
      'services/platform/wrangler.jsonc': wrangler,
    });
    return fixture(name, files);
  };

  // The chassis consumer: a real read through a ref, the shape a home screen
  // that actually served pack content would have.
  const READS = 'final core.ContentPack? pack = ref.watch(contentPackProvider).valueOrNull;\n';
  const SHELF_BOUND =
    '{\n  "name": "platform",\n  "r2_buckets": [\n    { "binding": "PACKS", "bucket_name": "nikatru-packs" }\n  ]\n}\n';

  // ── the baseline ───────────────────────────────────────────────────────────
  test('BASELINE — the fixture is otherwise GREEN, and limb (c) prints the gap', () => {
    const { code, out } = run(build('pack-baseline'));
    assert.equal(code, 0, `the baseline fixture must satisfy every OTHER seam, else every case below is meaningless\n${out}`);
    // The two `needs` anchors are satisfied by the declaration alone …
    assert.match(out, /ok {3}pack_verifier — something that actually asks the loader for a pack/);
    // … and limb (c) is what says so.
    assert.match(out, /⬜ pack_verifier limb \(c\): ZERO of \d+ shipped non-test Dart file\(s\)/);
    assert.match(out, /printed, not failed \(owner-gated: \[4\]B-18, the pack shelf\)/);
  });

  test('THE DECLARATION ALONE IS NOT A CONSUMER — an identifier match would have said ok', () => {
    const { out } = run(build('pack-decl-only'));
    // `contentPackProvider` IS present in the tree — in its own declaration.
    // The limb still reports zero, which is the entire point of anchoring on the
    // read through a ref rather than on the name.
    assert.match(out, /⬜ pack_verifier limb \(c\): ZERO of/);
    assert.doesNotMatch(out, /ok {3}pack_verifier limb \(c\)/);
  });

  // ── the ok branch ──────────────────────────────────────────────────────────
  test('A REAL CHASSIS READ FLIPS IT TO ok, and the run stays green', () => {
    const { code, out } = run(build('pack-consumer', { homeExtra: READS }));
    assert.equal(code, 0, out);
    assert.match(out, /ok {3}pack_verifier limb \(c\) — 1 shipped chassis file\(s\) READ/);
    assert.match(out, /home_screen\.dart/);
    assert.doesNotMatch(out, /⬜ pack_verifier limb \(c\)/);
  });

  test('COMMENTING THE READ OUT PUTS IT BACK — one `//` is the edit this guard was blind to before', () => {
    const { code, out } = run(build('pack-commented', { homeExtra: `// ${READS}` }));
    assert.equal(code, 0, out);
    assert.match(out, /⬜ pack_verifier limb \(c\): ZERO of/);
    assert.doesNotMatch(out, /ok {3}pack_verifier limb \(c\)/);
  });

  test('AN OVERRIDE IS NOT A READ — it supplies a value, it does not consume one', () => {
    const { out } = run(
      build('pack-override', {
        homeExtra: 'contentPackProvider.overrideWith((ref) async => null),\n',
      }),
    );
    assert.match(out, /⬜ pack_verifier limb \(c\): ZERO of/);
  });

  // ── a test is not a consumer, and the witness proves the pattern is live ───
  test('A READ IN A test/ FILE DOES NOT COUNT, but it IS reported as the witness', () => {
    const { code, out } = run(
      build('pack-test-only', { brickTest: `void main() { ${READS} }\n` }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /⬜ pack_verifier limb \(c\): ZERO of/);
    assert.match(out, /1 file\(s\) in the EXCLUDED test trees do read it/);
    assert.match(out, /the pack rail's only readers are tests/);
    assert.doesNotMatch(out, /UNWITNESSED/);
  });

  test('WITH NO TEST READER AT ALL the print says the zero is UNWITNESSED, and still does not fail', () => {
    const { code, out } = run(build('pack-unwitnessed'));
    assert.equal(code, 0, out);
    assert.match(out, /this zero is UNWITNESSED/);
    assert.doesNotMatch(out, /EXCLUDED test trees do read it/);
  });

  // ── the shelf gate ─────────────────────────────────────────────────────────
  test('BINDING A BUCKET LIFTS THE GATE AND THE LIMB FAILS — it cannot only ever print', () => {
    const { code, out } = run(build('pack-shelf-bound', { wrangler: SHELF_BOUND }));
    assert.notEqual(code, 0, `a bound shelf with no consumer must RED the build\n${out}`);
    assert.match(out, /FAIL pack_verifier limb \(c\)/);
    assert.match(out, /declares 1 object-storage binding\(s\), so the pack shelf EXISTS/);
    assert.match(out, /The owner gate that justified printing this gap is LIFTED/);
  });

  test('SHELF BOUND *AND* A CHASSIS READER IS ok — the failure is about the reader, not the shelf', () => {
    const { code, out } = run(
      build('pack-shelf-and-consumer', { wrangler: SHELF_BOUND, homeExtra: READS }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /ok {3}pack_verifier limb \(c\) — 1 shipped chassis file\(s\) READ/);
  });

  test('🔴 "r2_buckets" IN A COMMENT IS NOT A SHELF — the real wrangler.jsonc says exactly that', () => {
    // This is not a hypothetical: services/platform/wrangler.jsonc's closing
    // comment is the literal sentence `NO "r2_buckets" YET`. A grep for the key
    // would find it, decide the shelf exists, and turn the correct print into a
    // false FAIL on the real tree.
    const { code, out } = run(
      build('pack-shelf-commented', {
        wrangler: '{\n  "name": "platform"\n  // NO "r2_buckets" YET — nothing reads object storage today.\n}\n',
      }),
    );
    assert.equal(code, 0, out);
    // The wording moved on 2026-09-05 with the predicate behind it: "no r2_buckets"
    // stopped being the same claim as "no pack shelf" the day a BACKUP bucket was
    // bound, so the message names the shelf rather than the key. Both cases below
    // still assert the SHUT gate, which is what they were written for.
    assert.match(out, /declares no r2_bucket that is a PACK SHELF/);
    assert.doesNotMatch(out, /FAIL pack_verifier limb \(c\)/);
  });

  test('AN EMPTY "r2_buckets": [] IS A SHUT GATE TOO — the array BODY is what is counted', () => {
    const { code, out } = run(
      build('pack-shelf-empty', { wrangler: '{\n  "name": "platform",\n  "r2_buckets": []\n}\n' }),
    );
    assert.equal(code, 0, out);
    // The wording moved on 2026-09-05 with the predicate behind it: "no r2_buckets"
    // stopped being the same claim as "no pack shelf" the day a BACKUP bucket was
    // bound, so the message names the shelf rather than the key. Both cases below
    // still assert the SHUT gate, which is what they were written for.
    assert.match(out, /declares no r2_bucket that is a PACK SHELF/);
  });

  test('AN UNREADABLE wrangler.jsonc IS UNKNOWN, NOT A MEASURED SHELF — so it prints', () => {
    // `wrangler: null` means the file is absent. A missing file must not be read
    // as "a shelf exists" (which would fail) and the print says so in as many
    // words, rather than silently borrowing the shut-gate wording.
    const { code, out } = run(build('pack-shelf-absent', { wrangler: null }));
    assert.equal(code, 0, out);
    assert.match(out, /could not be read, so the shelf gate is UNKNOWN/);
  });

  // ── the key phrase in the print is MEASURED, not a sentence ────────────────
  // The print states that the S-3 keypair gate is closed and the SHELF is the one
  // still shut. Written as prose that is true today and silently false later;
  // written as a count read from the map, it moves with the tree. These two cases
  // are the whole proof that it IS the count — "never invent a number".
  test('THE KEY COUNT IN THE PRINT IS READ FROM THE MAP — an empty map reads as zero', () => {
    const { out } = run(build('pack-keys-none'));
    assert.match(out, /NOT the S-3 key gate: 0 signing key\(s\) are pinned\./);
    assert.doesNotMatch(out, /that gate is CLOSED/);
  });

  test("…and a pinned key reads as pinned — the real tree's state, re-derived not recalled", () => {
    const { out } = run(build('pack-keys-one', { keys: "'k1': 'zcrBolFZ='" }));
    assert.match(out, /NOT the S-3 key gate: 1 signing key\(s\) are pinned, so that gate is CLOSED/);
  });

  // ── scope ──────────────────────────────────────────────────────────────────
  test('A READER OUTSIDE THE CHASSIS DOES NOT SATISFY IT, and the failure names that', () => {
    // The chassis is the subject: a reader in apps/ says nothing about the
    // template every stamped app is born from, and would keep this green with
    // the brick's own consumer deleted.
    const { code, out } = run(
      build('pack-subly-only', { wrangler: SHELF_BOUND, subly: READS }),
    );
    assert.notEqual(code, 0, out);
    assert.match(out, /FAIL pack_verifier limb \(c\)/);
    assert.match(out, /apps\/subly\/lib\/pack_consumer\.dart/);
    assert.match(out, /none in the chassis, so no stamped app inherits a consumer/);
  });

  test('…and such a reader is still REPORTED beside a chassis one, never silently dropped', () => {
    const { code, out } = run(
      build('pack-both', { homeExtra: READS, subly: READS }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /plus 1 outside the chassis/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A SEAM'S CALLER THAT MOVED INTO THE CHASSIS PACKAGE — [ADR 067] decision 2
  //
  // 🔴 THIS BLOCK EXISTS BECAUSE THE EXTENSION SHIPPED DEAD. On 2026-09-05 the
  // +83 lines that follow a delegation were added to this guard with NO test,
  // and an independent review then measured them: the import regex ran over the
  // `bodies` map, which is `stripDart(...)`, and stripDart BLANKS EVERY STRING
  // LITERAL — which is what an import path is.
  //     RAW      first line: "import 'package:nikatru_chassis_screens/x.dart';"
  //     STRIPPED first line: "import                                       ;"
  //     matches in RAW: 1 · matches in STRIPPED: 0
  // With an unresolvable delegation injected, TEN sibling guards exited 1 and
  // this one exited 0 printing nothing at all. The resolver, its COVERAGE LOST
  // refusal and its `scope` filter were unreachable code that read as shipped.
  //
  // DL1 is the case that would have caught it: a RESOLVABLE delegation must
  // print the follow line. Nothing else in this file asserts that any of those
  // lines can execute at all.
  // ───────────────────────────────────────────────────────────────────────────
  describe('a caller that moved into the chassis package', () => {
    const CHASSIS_REL = 'packages/chassis_screens/lib/settings_body.dart';
    let delegSeq = 0;

    /** The baseline tree, plus a chassis package and a brick settings file that
     *  delegates to it.
     *
     *  `onDisk` false is the unresolvable delegation · `used` false is the
     *  import the adapter never references, which since 2026-09-05 is a refusal
     *  rather than a widening · `callInPackage` moves the sign-out caller across
     *  the boundary, which is the whole point of following the delegation. */
    const delegating = ({ onDisk = true, used = true, callInPackage = false } = {}) => {
      const name = `pack-deleg-${(delegSeq += 1)}`;
      const dir = build(name);
      const settings = join(dir, BRICK, 'lib/features/settings/settings_screen.dart');
      const body = readFileSync(settings, 'utf8');
      writeFileSync(
        settings,
        "import 'package:nikatru_chassis_screens/settings_body.dart';\n\n" +
          (callInPackage ? body.split('await signOutAndForgetUser(ref);').join('// moved') : body) +
          (used ? 'Widget shell(BuildContext c) => const SettingsBody();\n' : ''),
      );
      if (onDisk) {
        const target = join(dir, CHASSIS_REL);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(
          target,
          'class SettingsBody {\n' +
            '  Future<void> signOut(WidgetRef ref) async {\n' +
            (callInPackage ? '    await signOutAndForgetUser(ref);\n' : '    await nothing();\n') +
            '  }\n}\n',
        );
      }
      return dir;
    };

    // 🔴 THE CASE THAT WOULD HAVE CAUGHT THE DEAD ASSERTION.
    test('DL1 · a RESOLVABLE delegation is followed, and the guard SAYS SO', () => {
      const { code, out } = run(delegating());
      assert.equal(code, 0, out);
      assert.match(out, /scan follows 1 chassis delegation target\(s\)/);
      assert.match(out, /packages\/chassis_screens\/lib\/settings_body\.dart/);
    });

    // The union is REAL: the sign-out caller crosses the boundary and is still
    // found. Without this, DL1 is consistent with a resolver that reads the file
    // and does nothing with what it read.
    test('DL2 · the caller itself moves into the package and the seam stays wired', () => {
      const { code, out } = run(delegating({ callInPackage: true }));
      assert.equal(code, 0, out);
      assert.match(out, /scan follows 1 chassis delegation target\(s\)/);
    });

    // COVERAGE LOST, which is what EXIT 0 was standing in for.
    test('DL3 · 🔴 an UNRESOLVABLE delegation is COVERAGE LOST, not silence', () => {
      const { code, out } = run(delegating({ onDisk: false }));
      assert.equal(code, 1, out);
      assert.match(out, /a chassis delegation could not be followed/);
      assert.match(out, /that file is not on disk/);
    });

    // An import alone is not evidence that behaviour went anywhere.
    test('DL4 · 🔴 an import the adapter never uses is refused, not followed', () => {
      const { code, out } = run(delegating({ used: false }));
      assert.equal(code, 1, out);
      assert.match(out, /never references anything it declares \(SettingsBody\)/);
      assert.match(out, /a reference is evidence/);
    });
  });

});
