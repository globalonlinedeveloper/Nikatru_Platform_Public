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

const CHANNELS = JSON.stringify({
  channels: [
    { id: 'web' },
    { id: 'android-play' },
    { id: 'ios-appstore' },
    { id: 'macos-appstore' },
    { id: 'windows-store' },
    { id: 'windows-direct' },
    { id: 'linux-snap' },
    { id: 'linux-appimage' },
  ],
});

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
          channelPermitted: false,
          why: 'UNVERIFIED: Microsoft Store commerce policy is unchecked here.',
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
}
`;

const RAIL_TEST = `
void main() {
  for (final PurchaseChannel channel in <PurchaseChannel>[
    PurchaseChannel.web,
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

const SERVER_CONFIG = `
export const DEFAULT_CONFIGS = {
  subly: {
    paywall: {
      enabled: false,
      offerings: [
        { product_id: 'pro_monthly', amount_minor: 499, currency_code: 'USD', term: 'month', trial_days: 30 },
        { product_id: 'pro_yearly', amount_minor: 1999, currency_code: 'USD', term: 'year', trial_days: 30 },
      ],
    },
  },
};
`;

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
  write(root, 'packages/purchases/test/purchase_capabilities_test.dart', 'void main() {}');
  if (o.railTest !== null) write(root, 'packages/purchases/test/hosted_checkout_rail_test.dart', o.railTest ?? RAIL_TEST);
  write(root, 'packages/purchases/lib/src/entitlement_convergence.dart', o.convergence ?? CONVERGENCE);
  write(root, 'packages/core/lib/src/entitlement_cache.dart', o.cache ?? CACHE);
  write(root, 'services/platform/src/config.ts', o.serverConfig ?? SERVER_CONFIG);
  if (o.serverTypes !== null) write(root, 'services/platform/src/types.ts', o.serverTypes ?? SERVER_TYPES);
  write(root, `${BRICK}/lib/core/router.dart`, o.router ?? ROUTER);
  write(root, `${BRICK}/lib/features/home/home_screen.dart`, o.home ?? HOME);
  write(root, `${BRICK}/lib/features/settings/settings_screen.dart`, o.settings ?? SETTINGS);
  write(root, `${BRICK}/lib/features/monetization/manage_plan_screen.dart`, o.manage ?? MANAGE);
  write(root, `${BRICK}/lib/features/monetization/paywall_screen.dart`, PAYWALL);
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
      serverConfig: SERVER_CONFIG.replaceAll('trial_days: 30', 'trial_days: 7'),
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
    const r = run({ serverConfig: 'export const DEFAULT_CONFIGS = { subly: { paywall: { enabled: false } } };' });
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
    const r = run({ serverConfig: SERVER_CONFIG.replace('enabled: false', 'enabled: true') });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /QUALIFYING AUTO-RENEWING SKU IS LIVE/);
    assert.match(r.out, /2 of 2 offering\(s\)/);
    assert.match(r.out, /pro_monthly: term=month, trial=30d/);
  });

  test('PASSES live once the notice mechanism is declared on both sides', () => {
    // The tripwire must be SATISFIABLE, or it is a permanent block rather than a
    // gate — and a permanent block is one somebody deletes.
    const r = run({
      serverConfig: SERVER_CONFIG.replace('enabled: false', 'enabled: true').replace(
        'offerings: [',
        "renewal_notice: { medium: 'email' },\n      offerings: [",
      ),
      serverTypes: `${SERVER_TYPES}\nexport interface PaywallConfig { renewal_notice: RenewalNotice | null; }\n`,
    });
    assert.equal(r.code, 0, r.out);
  });

  test('a live paywall selling only ONE-TIME, trial-free products does not trip it', () => {
    // The classifier must not fire on every product that exists. A genuine
    // one-off purchase carries no renewal to give notice of.
    const r = run({
      serverConfig: SERVER_CONFIG.replace('enabled: false', 'enabled: true').replace(
        /offerings: \[[\s\S]*?\],/,
        "offerings: [\n        { product_id: 'lifetime', amount_minor: 4999, currency_code: 'USD', term: 'one_time', trial_days: 0 },\n      ],",
      ),
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
      serverConfig: SERVER_CONFIG.replace('enabled: false', 'enabled: true').replace(
        /offerings: \[[\s\S]*?\],/,
        "offerings: [\n        { product_id: 'lifetime', amount_minor: 4999, currency_code: 'USD', term: 'one_time', trial_days: 14 },\n      ],",
      ),
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
    const r = run({ serverConfig: SERVER_CONFIG.replace(/\{ product_id:[\s\S]*?\},\n/g, '') });
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
