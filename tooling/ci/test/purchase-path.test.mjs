// ─────────────────────────────────────────────────────────────────────────────
// purchase-path.test.mjs — assert-purchase-path.mjs must be able to FAIL.
//
// [pipeline 5]M-6 · M-8 · M-9 · M-10 · M-15 — the CLIENT money rail.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-01, ten, on a
// scratch COPY of the repo; every restore re-verified green by the harness).
// The fixtures below encode the same failing inputs, but the fixtures are NOT
// the evidence — a fixture I wrote encodes the same misunderstanding as the
// guard I wrote, which is why the real tree was broken first.
//
//   PP1  a registered channel loses its enum row      -> caught: "does not cover
//                                                        linux-appimage"
//   PP2  EVERY row channelPermitted:false             -> caught: "NO CHANNEL CAN SELL"
//   PP3  a `false` row's `why` emptied                -> caught after a FIX (a)
//   PP4  a sellable channel dropped from the          -> caught: "CLAIMED BUT
//        launcher test                                  UNEXERCISED"
//   PP5  the staleness ceiling raised to 60 days      -> caught: "THE BOUND OUTLIVES"
//   PP6  the connectivity conjunction deleted         -> caught after a FIX (b)
//   PP7  the convergence delay list renamed away      -> caught: "declares no
//                                                        convergence delays"
//   PP8  the cancel entry removed from Settings       -> caught: "NO CANCEL PATH"
//   PP9  the Settings nav destination stops           -> caught: "THE ORIGIN IS
//        navigating (the REAL 2026-08-01 defect)        UNREACHABLE"
//   PP10 `_restore` loses its server read while       -> caught after a FIX (c)
//        `_cancel` keeps one
//
// 🔴 THREE DEFECTS THE MUTATION RUN FOUND IN THE GUARD ITSELF:
//   (a) PP3 WAS NOT CAUGHT. The `why` capture ran `[\s\S]*?` to the closing
//       `);`, so a row with `why: ''` borrowed the length of whatever field came
//       after it. Only adjacent single-quoted literals count now.
//   (b) PP6 WAS NOT CAUGHT. The check tested `/isStaleAt\(/` and
//       `/connectivityAvailable/` SEPARATELY — and the second is a PARAMETER
//       NAME, so it survived deleting the `&&` that consults it. The bound
//       became an unconditional countdown that locks a paying user out for being
//       in a tunnel, and the guard printed ok. It now requires the conjunction.
//   (c) PP10 WAS NOT CAUGHT. `refreshEntitlements(` also appears in the CANCEL
//       path, so a file-level match survived deleting the restore control's own
//       server read entirely. Scoped to `_restore`'s body now.
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
const GUARD = join(CI_DIR, 'assert-purchase-path.mjs');
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pp-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

// ─────────────────────────────────────────────────────────────────────────────
// §G's fixture — the RAIL each channel sells through ([10]D-13 · [ADR 039]).
//
// 🔴 BUILT AS AN OBJECT, MUTATED AS AN OBJECT. Every case below hands
// `registerDoc()` a dimension rather than running `.replace()` over the JSON
// text — the lesson this file already carries for the T-11 cases: a string
// mutation that stops matching is a silent no-op, and a case whose mutation
// no-ops tests the PASSING input while claiming to test the failing one.
//
// The row set mirrors the real register's shape after [ADR 039]: five paddle
// channels, Play on Play Billing, both Apple channels on Apple IAP, plus the
// PARKED `android-sideload` split — the one entry the owner's own restatement
// ("APK and iOS = own store, everything else Paddle") got backwards.
// ─────────────────────────────────────────────────────────────────────────────
const RAILS = () => ({
  paddle: 'Paddle hosted apex checkout, opened in the browser. Merchant of record; nets 7.5%.',
  'play-billing': 'Google Play Billing, 15% on the first-$1M/yr tier, integrated through RevenueCat.',
  'apple-iap': 'Apple StoreKit in-app purchase, 15% under the Small Business Program.',
  none: 'this channel sells nothing and must open no checkout of any kind at all.',
});

const railBlock = (rail, forbids) => ({
  rail,
  why: `The policy and the arithmetic that force \`${rail}\` on this channel, written out in full.`,
  forbids,
  forbidsWhy: 'MECHANICAL where the billing SDK cannot exist here, POLICY where the store forbids it.',
  source: '[ADR 039] D1',
});

const channelRows = () => [
  { id: 'web', platforms: ['web'], kind: 'web', purchaseRail: railBlock('paddle', ['play-billing', 'apple-iap']) },
  { id: 'android-play', platforms: ['android'], kind: 'store', purchaseRail: railBlock('play-billing', ['paddle', 'apple-iap']) },
  { id: 'ios-appstore', platforms: ['ios'], kind: 'store', purchaseRail: railBlock('apple-iap', ['paddle', 'play-billing']) },
  { id: 'macos-appstore', platforms: ['macos'], kind: 'store', purchaseRail: railBlock('apple-iap', ['paddle', 'play-billing']) },
  { id: 'windows-store', platforms: ['windows'], kind: 'store', purchaseRail: railBlock('paddle', ['play-billing', 'apple-iap']) },
  { id: 'windows-direct', platforms: ['windows'], kind: 'direct', purchaseRail: railBlock('paddle', ['play-billing', 'apple-iap']) },
  { id: 'linux-snap', platforms: ['linux'], kind: 'store', purchaseRail: railBlock('paddle', ['play-billing', 'apple-iap']) },
  { id: 'linux-appimage', platforms: ['linux'], kind: 'direct', purchaseRail: railBlock('paddle', ['play-billing', 'apple-iap']) },
];

const parkedRows = () => [
  {
    id: 'android-sideload',
    platforms: ['android'],
    kind: 'direct',
    railSplitsFrom: 'android-play',
    purchaseRail: railBlock('paddle', ['play-billing', 'apple-iap']),
  },
];

const registerDoc = ({ channels = channelRows(), rails = RAILS(), parked = parkedRows(), noRailsDict = false } = {}) => {
  const doc = { purchaseRails: { rails, awaitingChannelRow: parked }, channels };
  if (noRailsDict) delete doc.purchaseRails.rails;
  return JSON.stringify(doc, null, 2);
};

const CHANNELS = registerDoc();

const CAPS = `
enum PurchaseChannel {
  web('web'),
  androidPlay('android-play'),
  iosAppStore('ios-appstore'),
  macosAppStore('macos-appstore'),
  windowsStore('windows-store'),
  windowsDirect('windows-direct'),
  linuxSnap('linux-snap'),
  linuxAppImage('linux-appimage');

  const PurchaseChannel(this.registerId);
  final String registerId;
}

class PurchaseCapabilities {
  static PurchaseCapabilities forChannel(PurchaseChannel channel) {
    switch (channel) {
      case PurchaseChannel.web:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why: 'Our own site. No store sits between us and the buyer.',
        );
      case PurchaseChannel.androidPlay:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,
          why: 'Google Play requires Play Billing for in-app digital purchases.',
        );
      case PurchaseChannel.iosAppStore:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,
          why: 'App Store Review Guideline 3.1.1 requires in-app purchase.',
        );
      case PurchaseChannel.macosAppStore:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,
          why: 'Same 3.1.1 family as iOS, for a Mac App Store build.',
        );
      case PurchaseChannel.windowsStore:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why: 'Microsoft Store Policies §10.8.1/§10.8.6 permit a third-party rail.',
        );
      case PurchaseChannel.windowsDirect:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why: 'Direct download. No store commerce policy applies at all.',
        );
      case PurchaseChannel.linuxSnap:
      case PurchaseChannel.linuxAppImage:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why: 'Neither imposes a commerce policy on the publisher here.',
        );
    }
  }

  // The PLATFORM→CHANNEL COLLAPSE. A build does not know at runtime which
  // channel installed it, so one channel answers for the whole platform — which
  // is the exact place the APK/Play confusion lands, and why §G parses it.
  static PurchaseCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) return forChannel(PurchaseChannel.web);
    switch (platform) {
      case TargetPlatform.android:
        return forChannel(PurchaseChannel.androidPlay);
      case TargetPlatform.iOS:
        return forChannel(PurchaseChannel.iosAppStore);
      case TargetPlatform.macOS:
        return forChannel(PurchaseChannel.macosAppStore);
      case TargetPlatform.windows:
        return forChannel(PurchaseChannel.windowsStore);
      case TargetPlatform.linux:
        return forChannel(PurchaseChannel.linuxSnap);
      case TargetPlatform.fuchsia:
        return const PurchaseCapabilities(
          technicallySupported: false,
          channelPermitted: false,
          why: 'Fuchsia is not a distribution target for this factory at all.',
        );
    }
  }
}
`;

// §G0's premise: ONE PurchaseRail in the tree, and it is the Paddle hosted
// checkout. That is what makes `channelPermitted: true` mean "this build opens
// PADDLE here" and therefore comparable to the register's rail.
const HOSTED_RAIL = `
class HostedCheckoutRail implements PurchaseRail {
  const HostedCheckoutRail();
}
`;

const RAIL_TEST = `
void main() {
  for (final PurchaseChannel channel in <PurchaseChannel>[
    PurchaseChannel.web,
    PurchaseChannel.windowsStore,
    PurchaseChannel.windowsDirect,
    PurchaseChannel.linuxSnap,
    PurchaseChannel.linuxAppImage,
  ]) {
    test('opens', () async {});
  }
}
`;

const CACHE = `
class EntitlementCache {
  bool isStaleAt(Entitlements cached, DateTime now) => true;
  Future<Entitlements> readValid({DateTime? now, bool connectivityAvailable = true}) async {
    final bool stale = connectivityAvailable && isStaleAt(cached, at);
    return cached;
  }
}
const Duration kEntitlementStalenessCeiling = Duration(days: 7);
`;

// [pipeline 4]B-2 — THE RAIL CONFIG IS DATA NOW, AND SO IS THIS FIXTURE. It was
// a TypeScript literal (`export const DEFAULT_CONFIGS = { subly: { paywall: … } }`)
// that the guard regexed. B-2 moved the served values into
// `services/platform/src/app-config-data.json` so onboarding an app needs no
// Worker source edit; the guard `JSON.parse`s it and reads structure.
//
// 🔴 THE CASES BELOW MUTATE AN OBJECT, NOT A STRING. Every T-11 case used to be
// a `.replace('enabled: false', 'enabled: true')` against source text — which
// silently does nothing the day the source is reformatted, and a fixture whose
// mutation is a no-op tests the PASSING case while claiming to test the failing
// one. `railData()` takes the dimension as an argument, so a case that stops
// mutating cannot look like one that does.
const OFFERINGS = [
  { product_id: 'pro_monthly', amount_minor: 499, currency_code: 'USD', term: 'month', trial_days: 30 },
  { product_id: 'pro_yearly', amount_minor: 1999, currency_code: 'USD', term: 'year', trial_days: 30 },
];
const railData = ({ enabled = false, offerings = OFFERINGS, paywallExtra = {} } = {}) =>
  JSON.stringify(
    {
      sharedApiBaseUrl: 'https://platform.nikatru.com/v1',
      // An app with no entry of its own resolves to these, so the guard's domain
      // is `defaults` ∪ every per-app entry. Empty here on purpose: a portfolio
      // default that sold something would make every stamped app a seller.
      defaults: { paywall: { enabled: false, offerings: [] }, update_url: null },
      apps: { subly: { paywall: { enabled, offerings, ...paywallExtra } } },
    },
    null,
    2,
  );
const SERVER_CONFIG = railData();

// [pipeline 13]T-11. The config CONTRACT, which is where a renewal-notice
// declaration would have to be typed. Deliberately without one, because that is
// the tree's real state.
const SERVER_TYPES = `
export interface AppConfig {
  paywall: PaywallConfig;
  max_promos_per_week: number;
}
`;

const CONVERGENCE = `
const List<Duration> kCheckoutConvergenceDelays = <Duration>[
  Duration(seconds: 2),
  Duration(seconds: 4),
  Duration(seconds: 8),
];
enum ConvergenceOutcome { unlocked, stillPending, couldNotAsk }
`;

const ROUTER = `
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    routes: <RouteBase>[
      GoRoute(path: '/', builder: (BuildContext context, GoRouterState state) => const HomeScreen()),
      GoRoute(path: '/sign-in', builder: (BuildContext context, GoRouterState state) => const SignInScreen()),
      GoRoute(path: '/sign-up', builder: (BuildContext context, GoRouterState state) => const SignUpScreen()),
      GoRoute(path: '/settings', builder: (BuildContext context, GoRouterState state) => const SettingsScreen()),
      GoRoute(path: '/paywall', builder: (BuildContext context, GoRouterState state) => const PaywallScreen()),
      GoRoute(path: '/manage-plan', builder: (BuildContext context, GoRouterState state) => const ManagePlanScreen()),
    ],
  );
});
`;

const HOME = `
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
}
class _HomeScreenState extends ConsumerState<HomeScreen> {
  Widget build(BuildContext context) => AppScaffold(
    onDestinationSelected: (int i) {
      if (i == 2) {
        context.go('/settings');
        return;
      }
    },
  );
}
`;

const SETTINGS = `
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});
  Widget build(BuildContext context, WidgetRef ref) => ListView(children: <Widget>[
    ListTile(onTap: () => context.go('/paywall')),
    ListTile(onTap: () => context.go('/manage-plan')),
  ]);
}
`;

const MANAGE = `
class ManagePlanScreen extends ConsumerStatefulWidget {
  const ManagePlanScreen({super.key});
}
class _ManagePlanScreenState extends ConsumerState<ManagePlanScreen> {
  Future<void> _cancel() async {
    await ref.read(purchaseRailProvider).requestCancellation();
    await refreshEntitlements(ref);
  }

  Future<void> _restore() async {
    setState(() => _busy = true);
    await refreshEntitlements(ref);
    if (!mounted) return;
    setState(() => _busy = false);
  }

  Widget build(BuildContext context) => ListTile(title: Text(l10n.restorePurchases));
}
`;

const PAYWALL = `
class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key});
}
`;

function write(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function run(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  write(root, 'tooling/channel-register.json', o.channels ?? CHANNELS);
  write(root, 'packages/purchases/lib/src/purchase_capabilities.dart', o.caps ?? CAPS);
  if (o.hostedRail !== null) write(root, 'packages/purchases/lib/src/hosted_checkout_rail.dart', o.hostedRail ?? HOSTED_RAIL);
  if (o.extraRailImpl) write(root, 'packages/purchases/lib/src/second_rail.dart', o.extraRailImpl);
  if (o.morPaddle !== null) write(root, 'services/platform/src/lib/mor/paddle.ts', o.morPaddle ?? 'export const paddle = {};\n');
  write(root, 'packages/purchases/test/purchase_capabilities_test.dart', 'void main() {}');
  if (o.railTest !== null) write(root, 'packages/purchases/test/hosted_checkout_rail_test.dart', o.railTest ?? RAIL_TEST);
  write(root, 'packages/purchases/lib/src/entitlement_convergence.dart', o.convergence ?? CONVERGENCE);
  write(root, 'packages/core/lib/src/entitlement_cache.dart', o.cache ?? CACHE);
  write(root, 'services/platform/src/app-config-data.json', o.serverConfig ?? SERVER_CONFIG);
  if (o.serverTypes !== null) write(root, 'services/platform/src/types.ts', o.serverTypes ?? SERVER_TYPES);
  write(root, `${BRICK}/lib/core/router.dart`, o.router ?? ROUTER);
  write(root, `${BRICK}/lib/features/home/home_screen.dart`, o.home ?? HOME);
  write(root, `${BRICK}/lib/features/settings/settings_screen.dart`, o.settings ?? SETTINGS);
  write(root, `${BRICK}/lib/features/monetization/manage_plan_screen.dart`, o.manage ?? MANAGE);
  write(root, `${BRICK}/lib/features/monetization/paywall_screen.dart`, PAYWALL);
  // Extra fixture files — the chassis package a delegating screen points at.
  if (o.extraFiles) for (const [rel, body] of Object.entries(o.extraFiles)) write(root, rel, body);
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('assert-purchase-path — the client money rail', () => {
  test('PASSES on a correctly wired rail', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /assert-purchase-path: ok/);
  });

  // ── [5]M-15 · the matrix ──────────────────────────────────────────────────
  test('FAILS when a registered channel has no capability row', () => {
    const r = run({ caps: CAPS.replace("linuxAppImage('linux-appimage')", "linuxGone('linux-gone')") });
    assert.equal(r.code, 1);
    assert.match(r.out, /does not cover linux-appimage/);
  });

  test('FAILS when the matrix declares a channel nobody ships through', () => {
    const r = run({ channels: JSON.stringify({ channels: JSON.parse(CHANNELS).channels.slice(0, 7) }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares linux-appimage, which/);
  });

  test('🔴 FAILS when EVERY row is forbidden — six rows of false is a DEAD rail, not a complete matrix', () => {
    // This is the case M-15's ORIGINAL wording scored as a pass: a rail that is
    // dead everywhere degrades perfectly.
    const r = run({ caps: CAPS.replaceAll('channelPermitted: true', 'channelPermitted: false') });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO CHANNEL CAN SELL/);
  });

  test('FAILS when a capability row loses its reason', () => {
    const r = run({ caps: CAPS.replace("why: 'Our own site. No store sits between us and the buyer.',", "why: '',") });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no substantive `why`/);
  });

  test('COVERAGE LOST when the channel register yields almost nothing', () => {
    const r = run({ channels: JSON.stringify({ channels: [{ id: 'web' }] }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — the channel register yields only 1/);
  });

  // ── [5]M-6(a) · claimed is exercised ──────────────────────────────────────
  test('FAILS when a sellable channel is never exercised by the launcher test', () => {
    const r = run({ railTest: RAIL_TEST.replace('    PurchaseChannel.linuxAppImage,\n', '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /CLAIMED BUT UNEXERCISED/);
    assert.match(r.out, /linux-appimage/);
  });

  test('FAILS when the launcher test does not exist at all', () => {
    const r = run({ railTest: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /no channel's launcher has ever been exercised/);
  });

  // ── [5]M-8 · the revocation bound ─────────────────────────────────────────
  test('FAILS when the bound outlives the shortest BILLING PERIOD', () => {
    // 29d clears the 30-day trial and NOT the 28-day month, so this input
    // isolates the billing-period limb from the trial limb.
    const r = run({ cache: CACHE.replace('Duration(days: 7)', 'Duration(days: 29)') });
    assert.equal(r.code, 1);
    assert.match(r.out, /THE BOUND OUTLIVES THE BILLING PERIOD/);
  });

  test('FAILS when the bound outlives the TRIAL', () => {
    // 14d clears the 28-day month; only a SHORTER trial makes the trial limb
    // the one that fires, which is what keeps the two limbs distinguishable.
    const r = run({
      cache: CACHE.replace('Duration(days: 7)', 'Duration(days: 14)'),
      serverConfig: railData({ offerings: OFFERINGS.map((o) => ({ ...o, trial_days: 7 })) }),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /THE BOUND OUTLIVES THE TRIAL/);
  });

  test('🔴 FAILS when the bound stops consulting CONNECTIVITY (the parameter name survives)', () => {
    // The defect the mutation run exposed in this guard: `connectivityAvailable`
    // is a parameter name, so it stayed present when the `&&` that consults it
    // was deleted — turning the bound into a countdown that locks a paying user
    // out for being in a tunnel.
    const r = run({ cache: CACHE.replace('connectivityAvailable && isStaleAt', 'isStaleAt') });
    assert.equal(r.code, 1);
    assert.match(r.out, /gated on `connectivityAvailable`/);
  });

  test('FAILS when the bound is not a readable named constant', () => {
    const r = run({ cache: CACHE.replace('kEntitlementStalenessCeiling = Duration(days: 7);', 'kEntitlementStalenessCeiling = someRuntimeValue;') });
    assert.equal(r.code, 1);
    assert.match(r.out, /must be a NAMED CONSTANT/);
  });

  test('COVERAGE LOST when the rail config declares no trial or term to compare against', () => {
    const r = run({ serverConfig: railData({ offerings: [] }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — no `trial_days`/);
  });

  // ── [5]M-6(b) · the bounded wait ──────────────────────────────────────────
  test('FAILS when the post-checkout poll is unbounded', () => {
    const r = run({ convergence: CONVERGENCE.replace('kCheckoutConvergenceDelays', 'kGone') });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no convergence delays/);
  });

  test('FAILS when the plan is over-generous — a shared 100k/day ceiling is the constraint', () => {
    const many = `const List<Duration> kCheckoutConvergenceDelays = <Duration>[${'Duration(seconds: 1),'.repeat(12)}];\nenum ConvergenceOutcome { unlocked, stillPending, couldNotAsk }`;
    const r = run({ convergence: many });
    assert.equal(r.code, 1);
    assert.match(r.out, /convergence attempts/);
  });

  test('FAILS when "still pending" and "could not ask" are collapsed', () => {
    const r = run({ convergence: CONVERGENCE.replace('couldNotAsk', 'alsoPending') });
    assert.equal(r.code, 1);
    assert.match(r.out, /does not distinguish `stillPending` from `couldNotAsk`/);
  });

  // ── [5]M-9 · ROSCA ────────────────────────────────────────────────────────
  test('🔴 FAILS when there is NO cancel path — the `0 <= 0` case that used to pass', () => {
    const r = run({ settings: SETTINGS.replace("ListTile(onTap: () => context.go('/manage-plan')),", 'ListTile(),') });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO CANCEL PATH from \/settings/);
  });

  test('FAILS when there is no PURCHASE path either — both counts are floored', () => {
    const r = run({ settings: SETTINGS.replace("ListTile(onTap: () => context.go('/paywall')),", 'ListTile(),') });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO PURCHASE PATH from \/settings/);
  });

  test('🔴 FAILS when the ORIGIN itself is unreachable (the real 2026-08-01 chassis defect)', () => {
    // The Settings nav destination set an index and navigated nowhere, so every
    // screen behind /settings was unreachable while assert-screen-set printed ok.
    const r = run({ home: HOME.replace("context.go('/settings');", 'return;') });
    assert.equal(r.code, 1);
    assert.match(r.out, /THE ORIGIN IS UNREACHABLE/);
  });

  test('FAILS when the cancel entry is moved OUT of the surface that offers Upgrade', () => {
    // Equal hop counts do not stop the cancel entry moving to a screen a user
    // has to know exists, so "same surface" is its own limb.
    const r = run({
      settings: SETTINGS.replace("ListTile(onTap: () => context.go('/manage-plan')),", 'ListTile(),'),
      paywall: undefined,
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /THE TWO ENTRY POINTS ARE NOT IN THE SAME SURFACE/);
  });

  test('COVERAGE LOST when the router has almost no routes', () => {
    const r = run({ router: "GoRoute(path: '/', builder: (c, s) => const HomeScreen());" });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — the router declares only/);
  });

  // ── [5]M-10 · restore ─────────────────────────────────────────────────────
  test('🔴 FAILS when `_restore` loses its server read while `_cancel` keeps one', () => {
    // The defect the mutation run exposed: a file-level `refreshEntitlements(`
    // match was satisfied by the CANCEL path, so the restore control could be
    // gutted with the guard printing ok.
    const r = run({
      manage: MANAGE.replace(
        '  Future<void> _restore() async {\n    setState(() => _busy = true);\n    await refreshEntitlements(ref);',
        '  Future<void> _restore() async {\n    setState(() => _busy = true);',
      ),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO RESTORE CONTROL/);
  });

  // ── [13]T-11 · the renewal-notice tripwire ────────────────────────────────
  // ⚠️ Mutation-proven on the REAL tree first (2026-08-03): flipping
  // `paywall.enabled` to true in services/platform/src/config.ts turned CI red
  // with the message below; deleting both offering literals produced BOTH
  // COVERAGE LOST lines (M-8's and T-11's). The fixtures re-encode those inputs;
  // they are not the evidence.
  test('🔴 FAILS when a qualifying SKU goes LIVE with no declared notice mechanism', () => {
    const r = run({ serverConfig: railData({ enabled: true }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /QUALIFYING AUTO-RENEWING SKU IS LIVE/);
    assert.match(r.out, /2 of 2 offering\(s\)/);
    assert.match(r.out, /pro_monthly: term=month, trial=30d/);
  });

  test('PASSES live once the notice mechanism is declared on both sides', () => {
    // The tripwire must be SATISFIABLE, or it is a permanent block rather than a
    // gate — and a permanent block is one somebody deletes.
    const r = run({
      serverConfig: railData({ enabled: true, paywallExtra: { renewal_notice: { medium: 'email' } } }),
      serverTypes: `${SERVER_TYPES}\nexport interface PaywallConfig { renewal_notice: RenewalNotice | null; }\n`,
    });
    assert.equal(r.code, 0, r.out);
  });

  test('a live paywall selling only ONE-TIME, trial-free products does not trip it', () => {
    // The classifier must not fire on every product that exists. A genuine
    // one-off purchase carries no renewal to give notice of.
    const r = run({
      serverConfig: railData({
        enabled: true,
        offerings: [{ product_id: 'lifetime', amount_minor: 4999, currency_code: 'USD', term: 'one_time', trial_days: 0 }],
      }),
      // M-8's bound is relative to the shortest trial, and this catalogue has no
      // trial at all — so the ceiling has to come down with it or that
      // (unrelated) limb fires and the case stops isolating T-11.
      cache: CACHE.replace('Duration(days: 7)', 'Duration(days: 0)'),
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no declared offering renews automatically or carries a trial/);
  });

  test('a trial on a one-time product still qualifies', () => {
    // "Free now, charged later" is the other half of the shape, and a rule
    // keyed only on `term` would miss it.
    const r = run({
      serverConfig: railData({
        enabled: true,
        offerings: [{ product_id: 'lifetime', amount_minor: 4999, currency_code: 'USD', term: 'one_time', trial_days: 14 }],
      }),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 of 1 offering\(s\)/);
  });

  test('PRINTS the gap, and the COUNT, while the paywall is off', () => {
    // The reason T-11 was deferred: "0 of 0 SKUs match" and "2 of 2 SKUs match"
    // read identically from a verdict alone.
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⬜ \[13\]T-11 — 2 of 2 declared offering\(s\)/);
    assert.match(r.out, /K-13/);
  });

  test('COVERAGE LOST when the config contract itself is missing', () => {
    const r = run({ serverTypes: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /the qualifying-SKU domain was computed over nothing/);
  });

  test('COVERAGE LOST when no offering can be parsed at all', () => {
    const r = run({ serverConfig: railData({ offerings: [] }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /no offering could be parsed/);
  });

  test('COVERAGE LOST when the capability declaration is gone entirely', () => {
    const root = join(TMP, `bare-${(seq += 1)}`);
    write(root, 'tooling/channel-register.json', CHANNELS);
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §E2 — THE PROMOTIONAL SURFACE'S ROSCA PARITY AND ITS ONE-RAIL RULE.
//
// 🔴 ADDED 2026-08-10 AFTER AN ADVERSARIAL REVIEW POINTED OUT THAT THE LIMB
// SHIPPED WITH NO CHECKED-IN CASE. Its three branches HAD been negative-tested
// by mutating the real tree — this repo's stronger standard, and the reviewer
// independently reproduced one of them — but a mutation nobody records is one
// the next edit does not have to survive, and `assert-guard-coverage.mjs` could
// not see the gap: its coverage is FILE-level, so a brand-new limb inside a
// file that already had cases is invisible to it.
//
// The FIFTH row is the one that keeps the other four honest. This clause ranges
// over "every file that constructs a `PromoCard(`", and the day nothing does,
// all four failure branches become unreachable while the guard still prints ok.
// That is the empty-antecedent shape this repository has been bitten by; the
// guard answers it with a printed note, and the note is asserted here.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-purchase-path — §E2 the promo surface', () => {
  const PROMO_HOME = `
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
}
class _HomeScreenState extends ConsumerState<HomeScreen> {
  Widget build(BuildContext context) => AppScaffold(
    onDestinationSelected: (int i) {
      if (i == 2) {
        context.go('/settings');
        return;
      }
    },
  );
}
class _UpgradePromoCardState extends ConsumerState<UpgradePromoCard> {
  Widget build(BuildContext context) => PromoCard(
    show: true,
    onPrimaryAction: () => context.go('/paywall'),
    onManageAction: () => context.go('/manage-plan'),
  );
}
`;

  test('PASSES on a promo surface that offers both, and SAYS it found one', () => {
    // Both halves. An exit-code-only assertion passes just as happily on a scan
    // that reached no promo file at all, which is the failure this whole clause
    // is built around.
    const r = run({ home: PROMO_HOME });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 promo surface\(s\): each offers \/paywall AND \/manage-plan/);
  });

  test('FAILS when the promo surface has no /manage-plan — ROSCA parity', () => {
    // `PromoCard` makes `onManageAction` REQUIRED, so this cannot be an absent
    // control; it is a present control that navigates nowhere, which is what a
    // type cannot catch and this limb can.
    const r = run({
      home: PROMO_HOME.replace("onManageAction: () => context.go('/manage-plan'),", 'onManageAction: () {},'),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PROMO SURFACE WITHOUT A CANCEL ENTRY/);
  });

  test('FAILS when the promo surface has no buy path either', () => {
    const r = run({
      home: PROMO_HOME.replace("onPrimaryAction: () => context.go('/paywall'),", 'onPrimaryAction: null,'),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PROMO SURFACE WITH NO BUY PATH/);
  });

  test('FAILS when the promo surface opens a checkout of its own', () => {
    // ADR 038/039 lock ONE merchant of record. A second rail here is either a
    // second MoR — with its own EU VAT/OSS, UK VAT and Indian GST posture for a
    // sole proprietorship — or an external checkout steer on an Apple/Play
    // build, which guideline 3.1.1 makes a documented rejection cause.
    const r = run({
      home: PROMO_HOME.replace(
        "onPrimaryAction: () => context.go('/paywall'),",
        "onPrimaryAction: () => launchUrl(Uri.parse('https://pay.example.invalid/x')),",
      ),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /SECOND CHECKOUT RAIL ON A PROMO SURFACE/);
  });

  test('a `PromoCard(` in a COMMENT is not a promo surface', () => {
    // The r2_buckets lesson: this guard's own explanation of the rule contains
    // the token the rule matches. A prose match here would demand a cancel
    // entry from a paragraph.
    const r = run({ home: `${HOME}\n// Never build a PromoCard( without a manage entry.\n` });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /note DOMAIN EMPTY/);
  });

  test('with NO promo surface anywhere the emptiness is PRINTED, not passed over', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /note DOMAIN EMPTY — no file under the stamped chassis constructs a `PromoCard\(`/);
    // …and the ok line for the clause must NOT appear, or "ranged over nothing"
    // and "checked and found good" would read identically in the log.
    assert.doesNotMatch(r.out, /promo surface\(s\): each offers/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §G — THE RAIL EACH CHANNEL SELLS THROUGH, AND THE SHIPPED CODE AGREES.
// [10]D-13 · [ADR 039] (LOCKED 2026-08-09, owner-locked twice)
//
// 🔴 WHY THIS SECTION EXISTS AT ALL, AND IT IS NOT HYPOTHETICAL. On 2026-08-13
// the OWNER — five days after locking [ADR 039] themselves — read their own
// corpus and restated it as "APK and iOS = own store, everything else Paddle."
// That is WRONG ON APK: the same Android artifact takes PADDLE when sideloaded
// and PLAY BILLING when shipped through Play, because the rail follows the
// CHANNEL, not the platform and not the artifact. If the person who locked the
// decision misreads it in five days, prose does not hold it.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, AS ALWAYS (2026-08-13, fourteen, against a
// sparse byte-copy of the live tree — the real `channel-register.json`, the real
// `purchase_capabilities.dart`; the live files' sha256 verified identical before
// and after). The fixtures below re-encode those inputs. They are not the
// evidence, for the reason this file already states twice: a fixture I wrote
// encodes the same misunderstanding as the guard I wrote.
//
//   G1  a channel row loses `purchaseRail`        -> "COVERAGE LOST — channel `linux-snap`"
//   G2  rail = 'stripe'                           -> "not one of paddle | play-billing | …"
//   G3  `rails.none` deleted from the dictionary  -> "THE RAIL VOCABULARY LOST `none`"
//   G4  `rails.stripe` added                      -> "AN UNDECIDED RAIL"
//   G5  forbids ['braintree']                     -> "forbids `braintree`, which is not one of"
//   G6  android-play forbids play-billing         -> "CONTRADICTORY ROW"
//   G7  windows-store -> play-billing, forbids    -> "THE SHIPPED CODE OFFERS A RAIL THE
//       paddle, code untouched                       REGISTER FORBIDS — channel `windows-store`"
//   G8  🔴 CODE: androidPlay flipped to           -> "…OFFERS A RAIL THE REGISTER FORBIDS —
//       channelPermitted: true, REGISTER              channel `android-play` declares rail
//       UNTOUCHED                                     `play-billing`"
//   G9  android-play -> paddle                    -> "THE REGISTER CLAIMS A RAIL THE SHIPPED
//                                                     CODE REFUSES"
//   G10 🔴 CODE: forPlatform(iOS) -> web          -> "THE PLATFORM MAP TAKES THE PERMISSIVE
//                                                     ANSWER" (the APK trap, generalised)
//   G11 CODE: the forPlatform map made unparsable -> "COVERAGE LOST — no `case TargetPlatform"
//   G12 CODE: a second `implements PurchaseRail`  -> "COVERAGE LOST — §G reasons from"
//   G13 parked android-sideload -> play-billing   -> "SPLITS FROM `android-play` AND TAKES THE
//       (i.e. "the rail follows the artifact")       SAME RAIL"
//   G14 parked entry copied into `channels`       -> "TWO RAIL ANSWERS FOR `android-sideload`"
//
// G8, G10, G11 and G12 are the four that make limb (d) a CODE check rather than
// a register talking to itself: in each of them the register is byte-identical
// to the real one and only Dart moved.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-purchase-path — §G the rail follows the CHANNEL', () => {
  /** A replacement that cannot silently no-op. */
  const mutate = (src, from, to) => {
    const out = src.replace(from, to);
    assert.notEqual(out, src, 'the mutation was a NO-OP, so the case would test the passing input');
    return out;
  };

  // A ninth channel, in code: the enum member + its capability row + the
  // launcher test naming it. Used both for "a new channel must not default into
  // silence" and for the promotion case that proves §G is satisfiable.
  const capsWithSideload = () =>
    mutate(
      mutate(CAPS, "  androidPlay('android-play'),", "  androidPlay('android-play'),\n  androidSideload('android-sideload'),"),
      '      case PurchaseChannel.iosAppStore:',
      `      case PurchaseChannel.androidSideload:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why: 'A sideloaded APK is not a Play distribution, so no Play commerce policy reaches it.',
        );
      case PurchaseChannel.iosAppStore:`,
    );
  const railTestWithSideload = () =>
    mutate(RAIL_TEST, '    PurchaseChannel.web,', '    PurchaseChannel.web,\n    PurchaseChannel.androidSideload,');
  const sideloadLiveRow = () => ({
    id: 'android-sideload',
    platforms: ['android'],
    kind: 'direct',
    purchaseRail: railBlock('paddle', ['play-billing', 'apple-iap']),
  });

  test('PASSES, and SAYS the register and the shipped matrix agree', () => {
    // Both halves. An exit-code-only assertion passes just as happily on a §G
    // that compared nothing at all, which is the whole failure mode here.
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /8 channel\(s\): the register's rail and the shipped capability matrix agree/);
  });

  // ── (a) EVERY CHANNEL DECLARES A RAIL ────────────────────────────────────
  test('FAILS when a channel declares no `purchaseRail` at all', () => {
    const rows = channelRows();
    delete rows.find((c) => c.id === 'linux-snap').purchaseRail;
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — channel `linux-snap` declares no `purchaseRail`/);
  });

  test('🔴 FAILS when a NEW channel arrives with no rail — coverage must not default into silence', () => {
    // The failure this limb is built for: a ninth channel lands, everything else
    // still passes, and "which rail?" is answered by absence — which a reader
    // fills in with "the usual one". On APK the owner filled it in wrong.
    const row = sideloadLiveRow();
    delete row.purchaseRail;
    const r = run({
      channels: registerDoc({ channels: [...channelRows(), row], parked: [] }),
      caps: capsWithSideload(),
      railTest: railTestWithSideload(),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — channel `android-sideload` declares no `purchaseRail`/);
  });

  test('PASSES once that channel is promoted properly — the gate is satisfiable, not a permanent block', () => {
    // A guard that cannot be satisfied is a guard somebody deletes. This is the
    // whole promotion: the register row, the enum member, the launcher test.
    const r = run({
      channels: registerDoc({ channels: [...channelRows(), sideloadLiveRow()], parked: [] }),
      caps: capsWithSideload(),
      railTest: railTestWithSideload(),
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /9 channel\(s\): the register's rail and the shipped capability matrix agree/);
    // …and the printed APK gap has to STOP printing, or the note is decoration.
    assert.doesNotMatch(r.out, /ASSIGNS APK SIDELOAD TO `paddle`, AND NO LIVE CHANNEL ROW CARRIES IT/);
  });

  // ── (b) THE VALUE IS ONE THE REGISTER'S OWN DICTIONARY DEFINES ───────────
  test('FAILS when the declared rail is outside the vocabulary', () => {
    const rows = channelRows();
    rows.find((c) => c.id === 'windows-store').purchaseRail.rail = 'stripe';
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /channel `windows-store` declares rail `stripe`, which is not one of/);
  });

  test('FAILS when the vocabulary LOSES a rail [ADR 039] locked', () => {
    // Deleting `none` does not remove a rail — it removes the ability to write
    // it down, and a rail that cannot be named cannot be forbidden either.
    const rails = RAILS();
    delete rails.none;
    const r = run({ channels: registerDoc({ rails }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /THE RAIL VOCABULARY LOST `none`/);
  });

  test('FAILS when a FIFTH rail is added as a data edit', () => {
    const r = run({ channels: registerDoc({ rails: { ...RAILS(), stripe: 'Stripe, with no ADR behind it at all.' } }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /AN UNDECIDED RAIL/);
  });

  test('FAILS when a `forbids` entry names a rail that does not exist', () => {
    const rows = channelRows();
    rows.find((c) => c.id === 'ios-appstore').purchaseRail.forbids.push('braintree');
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /forbids `braintree`, which is not one of/);
  });

  test('COVERAGE LOST when the rails dictionary is missing entirely', () => {
    // Without it the guard would be checking every value against a list it
    // carries itself — which stops covering the file the day the file changes.
    const r = run({ channels: registerDoc({ noRailsDict: true }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no `purchaseRails.rails` dictionary/);
  });

  test('FAILS when a rail dictionary entry carries no description', () => {
    const r = run({ channels: registerDoc({ rails: { ...RAILS(), paddle: '' } }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /rail `paddle` in `purchaseRails.rails` carries no description/);
  });

  // ── (c) A ROW MAY NOT CANCEL ITSELF ─────────────────────────────────────
  test('🔴 FAILS when a row forbids its OWN rail', () => {
    const rows = channelRows();
    rows.find((c) => c.id === 'android-play').purchaseRail.forbids.push('play-billing');
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /CONTRADICTORY ROW — channel `android-play` declares rail `play-billing` and also forbids/);
  });

  test('FAILS when a row forbids something and says nothing about WHY', () => {
    // `forbids` is NOT the complement of `rail`: on `web` Play Billing is absent
    // MECHANICALLY, on `android-play` Paddle is absent because Google FORBIDS
    // it. Same list, different owners, different remedies.
    const rows = channelRows();
    rows.find((c) => c.id === 'web').purchaseRail.forbidsWhy = '';
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /says nothing about WHY/);
  });

  test('FAILS when the rail assignment carries no substantive `why`', () => {
    const rows = channelRows();
    rows.find((c) => c.id === 'ios-appstore').purchaseRail.why = 'because';
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no substantive `why`/);
  });

  test('FAILS when the rail assignment cites no `source`', () => {
    const rows = channelRows();
    rows.find((c) => c.id === 'macos-appstore').purchaseRail.source = '';
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /cites no `source`/);
  });

  // ── (d) THE SHIPPED CODE AGREES WITH THE REGISTER ───────────────────────
  test('🔴 FAILS when the CODE offers a rail the register forbids — register untouched, only Dart moved', () => {
    // THE ONE WITH THE MONEY ON IT. `HostedCheckoutRail` is the only PurchaseRail
    // in the tree, so `technicallySupported && channelPermitted` IS an
    // instruction to open Paddle — on `android-play` that is an anti-steering
    // violation, and on an Apple channel a documented rejection cause.
    const r = run({
      caps: mutate(
        CAPS,
        `      case PurchaseChannel.androidPlay:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,`,
        `      case PurchaseChannel.androidPlay:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,`,
      ),
      railTest: mutate(RAIL_TEST, '    PurchaseChannel.web,', '    PurchaseChannel.web,\n    PurchaseChannel.androidPlay,'),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /THE SHIPPED CODE OFFERS A RAIL THE REGISTER FORBIDS — channel `android-play` declares rail `play-billing`/);
  });

  test('FAILS when the REGISTER moves a channel off Paddle and the code keeps opening it', () => {
    const rows = channelRows();
    const pr = rows.find((c) => c.id === 'windows-store').purchaseRail;
    pr.rail = 'play-billing';
    pr.forbids = ['paddle', 'apple-iap'];
    const r = run({ channels: registerDoc({ channels: rows }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /THE SHIPPED CODE OFFERS A RAIL THE REGISTER FORBIDS — channel `windows-store`/);
  });

  test('FAILS when the register claims a rail the shipped code REFUSES — the mirror', () => {
    // Without this half, the cheapest way to green a §G failure is to flip the
    // matrix to `false` everywhere, and a rail nobody ships passes as compliant.
    const rows = channelRows();
    const pr = rows.find((c) => c.id === 'android-play').purchaseRail;
    pr.rail = 'paddle';
    pr.forbids = ['apple-iap'];
    const parked = parkedRows();
    parked[0].purchaseRail.rail = 'none'; // keep the split limb out of this case
    const r = run({ channels: registerDoc({ channels: rows, parked }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /THE REGISTER CLAIMS A RAIL THE SHIPPED CODE REFUSES — channel `android-play`/);
  });

  test('🔴 FAILS when the platform map takes the PERMISSIVE answer — the APK trap, generalised', () => {
    // A build cannot tell at runtime which channel installed it, so one channel
    // answers for the whole platform. Point that answer at a Paddle channel and
    // every sibling on the platform inherits a rail its own row forbids — which
    // is exactly "same artifact, different channel, different rail" read
    // backwards.
    const r = run({
      caps: mutate(
        CAPS,
        'case TargetPlatform.iOS:\n        return forChannel(PurchaseChannel.iosAppStore);',
        'case TargetPlatform.iOS:\n        return forChannel(PurchaseChannel.web);',
      ),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /THE PLATFORM MAP TAKES THE PERMISSIVE ANSWER — `forPlatform\(TargetPlatform.iOS\)` resolves to `web`/);
  });

  test('COVERAGE LOST when the platform map cannot be parsed at all', () => {
    const r = run({
      caps: CAPS.replace(
        /case TargetPlatform\.(\w+):\s*\n\s*return forChannel\(PurchaseChannel\.(\w+)\);/g,
        'case TargetPlatform.$1:\n        return _resolve($2);',
      ),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `case TargetPlatform.X: return forChannel\(PurchaseChannel.Y\);` could be parsed/);
  });

  test('🔴 COVERAGE LOST when a SECOND PurchaseRail implementation lands — the premise, not the conclusion', () => {
    // The day a Play Billing rail ships, `channelPermitted: true` stops meaning
    // "opens Paddle" and every comparison in §G silently changes subject. The
    // guard must say it has stopped being able to reason.
    const r = run({ extraRailImpl: 'class PlayBillingRail implements PurchaseRail {\n  const PlayBillingRail();\n}\n' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — §G reasons from "the only PurchaseRail this repo ships is HostedCheckoutRail/);
    assert.match(r.out, /now implements \[HostedCheckoutRail, PlayBillingRail\]/);
  });

  test('COVERAGE LOST when the `paddle` rail id resolves to no code', () => {
    const r = run({ morPaddle: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the `paddle` rail id is supposed to resolve to real code/);
  });

  test('COVERAGE LOST when the client rail implementation is gone', () => {
    const r = run({ hostedRail: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — §G reasons from/);
  });

  // ── THE PARKED SPLITS — the APK trap as data ────────────────────────────
  test('🔴 FAILS when the parked APK split takes the SAME rail as Play — the exact misreading', () => {
    // "APK and iOS = own store, everything else Paddle" written into the
    // register: the sideload row follows the ARTIFACT instead of the CHANNEL,
    // and the split it exists to record disappears.
    const parked = parkedRows();
    parked[0].purchaseRail = railBlock('play-billing', ['apple-iap']);
    const r = run({ channels: registerDoc({ parked }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`android-sideload` SPLITS FROM `android-play` AND TAKES THE SAME RAIL \(`play-billing`\)/);
  });

  test('FAILS when a parked entry is ALSO a live channel row', () => {
    const r = run({ channels: registerDoc({ channels: [...channelRows(), sideloadLiveRow()] }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TWO RAIL ANSWERS FOR `android-sideload`/);
  });

  test('FAILS when a parked entry names no `railSplitsFrom`', () => {
    const parked = parkedRows();
    delete parked[0].railSplitsFrom;
    const r = run({ channels: registerDoc({ parked }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /awaiting channel `android-sideload` declares no `railSplitsFrom`/);
  });

  test('FAILS when a parked entry splits from a channel that does not exist', () => {
    const parked = parkedRows();
    parked[0].railSplitsFrom = 'android-gone';
    const r = run({ channels: registerDoc({ parked }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /splits from `android-gone`, which is not a channel with a declared rail/);
  });

  test('FAILS when a PARKED channel already has an enum row in the shipped code', () => {
    // §A fails when the enum is MISSING a registered channel; this is the
    // mirror — the matrix answering for a channel the register has not decided
    // is real, which is an answer that came from nowhere.
    const r = run({ caps: capsWithSideload(), railTest: railTestWithSideload() });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`android-sideload` IS PARKED IN THE REGISTER AND ALREADY LIVE IN THE CODE/);
  });

  test('a parked entry is validated like a live row, not parked and forgotten', () => {
    const parked = parkedRows();
    parked[0].purchaseRail.source = '';
    const r = run({ channels: registerDoc({ parked }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /awaiting channel `android-sideload`'s `purchaseRail` cites no `source`/);
  });

  test('PRINTS the APK-sideload gap on every run while no live row carries it', () => {
    // The limb that cannot fail today is the one that must SAY so. ADR 039
    // assigns APK sideload to Paddle; with no live row and no enum member the
    // code refuses (the safe direction) but not the decided one, and a silent
    // pass here would read exactly like agreement.
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ASSIGNS APK SIDELOAD TO `paddle`, AND NO LIVE CHANNEL ROW CARRIES IT/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A SCREEN ON THE MONEY PATH THAT MOVED INTO THE CHASSIS PACKAGE
// ([ADR 067] decision 2)
//
// §E counts the steps between the home screen and a completed purchase, and it
// builds that count from the `context.go` edges in the template's own files.
// [ADR 066] step 4 moves a screen body into
// `package:nikatru_chassis_screens` — and an edge in a file this walk cannot
// reach is not a shorter path, it is an invisible one.
//
// 🔴 THE EXTENSION SHIPPED WITH NO TEST. It gained 73 lines on 2026-09-05 and
// this file gained none. UP3 is the case that matters: an import nothing
// references must not pull a package file into the step count.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-purchase-path — a screen whose body moved into the chassis', () => {
  const CHASSIS_REL = 'packages/chassis_screens/lib/home_body.dart';
  const IMPORT = "import 'package:nikatru_chassis_screens/home_body.dart';\n";

  /** The home screen with a PANE lifted into the chassis package, adapter left
   *  behind at the same path. §E's edges stay where the route is; what the
   *  resolver has to prove is that the package file JOINS the walk at all —
   *  which is what the printed line asserts, and what it could not do before.
   *
   *  `used` false is the same file with the import kept and the reference gone:
   *  the shape a review turned into EXIT 0 on the real tree. */
  const adapter = (used) =>
    IMPORT +
    HOME +
    `Widget _pane(BuildContext context) => ${used ? 'const HomeBody()' : 'const SizedBox()'};\n`;

  const packageBody =
    'class HomeBody extends StatelessWidget {\n  const HomeBody({super.key});\n' +
    '  Widget build(BuildContext context) => const SizedBox.shrink();\n}\n';

  // GREEN CONTROL — the delegation resolves, the package file joins the scan,
  // and the guard says so. Without this every red below is consistent with a
  // resolver that refuses every delegation.
  test('UP1 · the delegation is followed and REPORTED, and the rail stays whole', () => {
    const r = run({ home: adapter(true), extraFiles: { [CHASSIS_REL]: packageBody } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /§E also read 1 chassis file\(s\) the template delegates to/);
    assert.match(r.out, /home_body\.dart/);
  });

  test('UP2 · 🔴 a delegation to a file that is not on disk is COVERAGE LOST', () => {
    const r = run({ home: adapter(true) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /that file is not on disk/);
  });

  // 🔴 THE EXPLOIT: an import alone is not evidence that a screen went anywhere.
  test('UP3 · 🔴 an import the adapter never uses is refused, not followed', () => {
    const r = run({ home: adapter(false), extraFiles: { [CHASSIS_REL]: packageBody } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never references anything it declares \(HomeBody\)/);
  });
});
