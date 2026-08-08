// ─────────────────────────────────────────────────────────────────────────────
// WIDTH HARNESS — the shared rig for every "how wide did this get?" test.
//
// Extracted from `test/responsive_width_test.dart`, which proved these idioms
// against the real tree before they were worth sharing. Everything here is
// load-bearing; each helper below carries the reason it is shaped the way it is,
// because the failure mode of a width test is not a red pixel or an exception —
// it is an assertion that quietly stops being able to fail.
//
// 🔴 WHY THE ASSERTION IS ON `constraints`, NOT ON `size`.
// A `Column` of centred text SHRINK-WRAPS: at 1280 px unconstrained it reports
// the width of its longest line — about 260 px for the chassis's default
// onboarding copy — so `getSize(...).width <= 720` would PASS with the cap
// deleted, and go on passing until somebody shipped a longer sentence. The
// property under test is what width the content was OFFERED, and that is the
// child's incoming `BoxConstraints.maxWidth`. It is the same number whatever the
// copy says, so a width test built on this harness cannot be quietly disarmed by
// editing an .arb. See [offeredWidth].
//
// ⚠️ EVERY CASE PINS THE SURFACE — `tester.binding.setSurfaceSize` with an
// `addTearDown(null)`, which is the chassis idiom (see
// `packages/design_system/test/content_pane_test.dart`). flutter_test's default
// surface is 800×600, and 800 resolves to `medium`, i.e. a RAIL — so an unpinned
// width test measures a layout nobody asked about. [pumpAt] and [setSurface] pin
// it for you; never write a width case that does neither.
//
// ⚠️ AND THE DESKTOP CASE FOR A `kMaxBodyWidth` SCREEN IS 1920, NOT 1280.
// The default `ContentPane` cap IS 1280, so `contentWidth <= 1280` measured on a
// 1280 px surface is true whether or not the pane is there — an assertion that
// cannot fail, which this repo treats as worse than no assertion at all. Keep
// [kDesktop] for the ordinary desktop window (it pins the no-op behaviour); the
// case that can actually go red is [kWide].
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/services/notifications/notification_service.dart';
import 'package:subly/state/providers.dart';

/// In-memory storage seam — `PrefsKeyValueStore` needs a platform channel that
/// does not exist in a widget test. Same shape as `chassis_properties_test`'s.
class MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A [NotificationService] that schedules nothing.
///
/// The real one reaches `flutter_local_notifications` through a platform
/// channel, so a screen that syncs reminders on build throws in a widget test
/// before it has laid anything out. `NotificationService.forTesting()` is the
/// constructor that skips plugin init; the overrides below then make every
/// outbound call a no-op, because a width test has no opinion about reminders —
/// it only needs the screen to reach its layout.
class SilentNotifications extends NotificationService {
  SilentNotifications() : super.forTesting();
  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

/// The phone, the small tablet and the ordinary desktop window. Named so a
/// failure says WHICH window class was being measured rather than a bare pair
/// of numbers.
const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 900);

/// Wider than every cap in [AppBreakpoints], so a screen capped at
/// [AppBreakpoints.kMaxBodyWidth] has a surface its cap can be distinguished
/// from. See the header.
const Size kWide = Size(1920, 1080);

/// The overrides every width test needs, and no more.
///
/// Two seams, both of them platform channels that do not exist under
/// flutter_test: storage ([MemStore]) and notifications ([SilentNotifications]).
///
/// 🔴 `subscriptionRepositoryProvider` IS DELIBERATELY NOT OVERRIDDEN. Left
/// alone, the unconfigured chain resolves `SeedApiClient` — the demo data the
/// app ships with — so a list screen renders its POPULATED branch. Overriding
/// the repository with an empty fake would put every one of these screens in its
/// empty state, and an empty state is exactly the shape whose width nobody
/// cares about: no rows to stretch, no chevrons at the far edge, nothing the
/// cap is there to prevent. A width test that measures an empty list is an
/// assertion that cannot fail.
List<Override> defaultWidthOverrides() => <Override>[
  keyValueStoreProvider.overrideWith((_) async => MemStore()),
  sublyNotificationServiceProvider.overrideWithValue(SilentNotifications()),
];

/// Pins the surface to [size] and hosts [screen] on its own `MaterialApp`.
///
/// No router: none of these properties is about navigation, and a router would
/// drag the redirect guards in with it.
///
/// [overrides] are appended AFTER [defaultWidthOverrides], and on riverpod
/// 2.6.1 the later entry for a provider is the one that takes effect — measured,
/// not assumed. So a test that genuinely needs a fake repository (an empty
/// state, a failing fetch) or a pre-seeded store can say so without losing the
/// two seams above, and without restating them.
Future<void> pumpAt(
  WidgetTester tester,
  Size size,
  Widget screen, {
  List<Override> overrides = const <Override>[],
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[...defaultWidthOverrides(), ...overrides],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: screen,
      ),
    ),
  );
  // Several provider futures resolve in sequence; `pumpAndSettle` would be a
  // lie about why we are waiting. A bare `pump()` also advances NO timers, which
  // is what lets a screen with a periodic/debounced timer (scan) be measured
  // here at all — `pumpAndSettle` would run those timers to quiescence, or spin
  // forever on one that never quiesces.
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

/// Pins the surface to [size] and nothing else — for tests that build their own
/// host (the sheet cases, which need a launcher button and a real
/// `ProviderScope` rather than a screen dropped into `home:`).
///
/// The `addTearDown(null)` is the half that is easy to forget and impossible to
/// notice: a leaked surface size does not fail the test that leaked it, it
/// fails some later test in the same file, at whatever width was left behind.
///
/// 🔴 IT PINS THE LAYOUT, NOT `MediaQuery`. `setSurfaceSize` reconfigures the
/// render view, so the incoming `BoxConstraints` — which is what [offeredWidth]
/// reads and what `AppScaffold`'s `LayoutBuilder` branches on — become [size].
/// The `FlutterView` is untouched, so `MediaQuery.sizeOf` still reports the
/// flutter_test default of 800×600 at any pinned surface. Measured here, both
/// halves, because the two disagree silently.
///
/// That is fine for every cap assertion, and it is a TRAP for anything sized off
/// `MediaQuery` directly — in this app that is
/// `add_subscription_sheet.dart`'s `maxHeight: …size.height * 0.86`, which will
/// keep computing 516 (86% of 600) however wide or tall the surface is pinned.
/// A test that means to move that number must set `tester.view.physicalSize` and
/// `devicePixelRatio` as well, with their own `addTearDown(…reset())`.
Future<void> setSurface(WidgetTester tester, Size size) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
}

/// The width the widget found by [of] was OFFERED — its incoming
/// `BoxConstraints.maxWidth`. See the header for why this and not `getSize`.
double offeredWidth(WidgetTester tester, Finder of) {
  final RenderBox box = tester.renderObject<RenderBox>(of);
  return (box.constraints).maxWidth;
}

/// The screen's own content box, found THROUGH the pane rather than by a
/// global type search — so a second `ListView` appearing elsewhere on the
/// screen cannot silently become the thing being measured.
///
/// ⚠️ THE `findsWidgets` CHECK IS THE ERROR MESSAGE, not an extra assertion.
/// Scoping through `ContentPane` means the whole-pane-deleted case reaches
/// `.first` on an empty iterable and dies with `Bad state: No element` — red,
/// correctly, but pointing at `Iterable.first` in the framework rather than
/// at the screen. Verified against the real tree: stripping the pane out of
/// the onboarding screen produced exactly that. This turns the commonest
/// regression into a sentence that names it.
Finder inPane(Type contentType) {
  expect(
    find.byType(ContentPane),
    findsWidgets,
    reason:
        'this screen has no ContentPane at all, so there is no width cap to '
        'measure — it was removed rather than mis-set',
  );
  return find
      .descendant(
        of: find.byType(ContentPane),
        matching: find.byType(contentType),
      )
      .first;
}

/// [inPane] for a screen with MORE THAN ONE pane.
///
/// `find.byType(ContentPane)` cannot tell a list pane from a detail pane on a
/// two-pane layout, and `.first` would silently pick whichever the element tree
/// happened to visit first — a measurement that is right by accident and wrong
/// the day the panes are reordered. Such screens give their panes a `Key`; pass
/// `find.byKey(...)` here and the same whole-pane-deleted guard applies to THAT
/// pane rather than to "any pane on the screen".
Finder inPaneOf(Finder pane, Type contentType) {
  expect(
    pane,
    findsWidgets,
    reason:
        'this screen has no ContentPane at all, so there is no width cap to '
        'measure — it was removed rather than mis-set',
  );
  return find.descendant(of: pane, matching: find.byType(contentType)).first;
}
