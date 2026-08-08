// ═════════════════════════════════════════════════════════════════════════════
// P2.6a DRAFT — apps/subly/lib/app.dart
//
// The stamped chassis spine wrapped AROUND the live Subly shell. Not applied,
// not committed: this is the reviewed draft the integrating session edits into
// place. See ../MANIFEST.md and ./boot-order.md for the per-decision evidence.
//
// PRECONDITIONS (this file does not compile before all four are true):
//   1. P2.4a — `flutter_localizations` + `generate: true`      ✅ merged (#212)
//   2. P2.3  — `lib/l10n/{l10n.yaml,app_en.arb,app_ta.arb}`    ⬜ pending
//              → `lib/l10n/app_localizations.dart` is GENERATED, never carried
//   3. P2.5  — `lib/core/router.dart` (stamped path wins) and
//              `lib/core/app_config.dart` (stamped path wins)  ⬜ pending
//   4. P2.6a — the merged `lib/state/providers.dart`, which must ALSO absorb
//              `lib/state/analytics_providers.dart` (14 importers) or every
//              name below is an ambiguous import.                ⬜ this rung
// ═════════════════════════════════════════════════════════════════════════════
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/app_config.dart';
import 'core/router.dart';
import 'l10n/app_localizations.dart';
import 'state/analytics_funnel.dart';
import 'state/notification_tap_observer.dart';
import 'state/providers.dart';

/// Root widget for Subly — Subscription Tracker.
class SublyApp extends ConsumerWidget {
  const SublyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    // CFG-1 force-update kill-switch: blocks the app when the running version is
    // below the resolved min_supported_version. Watching this resolves the config
    // at launch too; it fails open while config/version load (never blocks the UI).
    final bool mustUpdate = ref.watch(mustForceUpdateProvider);

    // [pipeline C-8] RUNTIME first, compiled-in default as the fallback. The
    // wall's destination must be repointable without a release: it is the
    // emergency exit, and an emergency exit you can only move by shipping a new
    // build is not one. `valueOrNull` and the `??` are both load-bearing —
    // while the config resolves, or with no network at all, the compiled-in
    // default still gives the button somewhere to go.
    // Indentation here matches `dart format`'s output exactly. The template is
    // mustache, so nothing can format it — only a real stamp can, and the
    // app_brick lane runs `dart format --set-exit-if-changed` on that stamp.
    final String updateUrl =
        ref.watch(appConfigProvider).valueOrNull?.updateUrl ??
        AppConfig.updateUrl;
    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      // [pipeline C-13] The persisted language override. NULL is not "no value"
      // — it is "follow the device", and MaterialApp already does the right
      // thing with null. Without this line the picker would store a choice the
      // app never reads, which is the dead-control shape [pipeline C-6] exists
      // to catch.
      locale: ref.watch(localeProvider),
      // 🔴 P2.6a THEME FORK — READ BEFORE MERGING. THIS REPAINTS SUBLY.
      //
      // The live app shipped `theme: AppTheme.light()` and NO darkTheme and NO
      // themeMode. `AppTheme.light()` is documented in
      // packages/design_system/lib/src/theme/build_app_theme.dart:79-90 as "the
      // ORIGINAL Subly palette, pinned exactly … deliberately NOT the chassis
      // path", because apps/subly is a frozen legacy rail-prover (39-CHASSIS
      // cut 1) whose colours must not move when the shared builder became
      // seed-driven. So these three lines are a DELIBERATE reversal of a
      // written design-system decision, not a mechanical carry.
      //
      // Two measured costs, neither of which any guard or test reports:
      //  · `AppTheme.light()` pins primary/secondary/surface AND the const
      //    `AppThemeX.light` tokens. `buildAppTheme(seed:)` derives all of them
      //    from an M3 tonal palette, so `primary` stops being #6459F5 exactly
      //    and the brand gradient + category ramp change. Every Subly screen
      //    repaints.
      //  · `themeMode` defaults to `ThemeMode.system` (ThemeModeController.build).
      //    Supplying `darkTheme` therefore flips every user on a dark-mode OS to
      //    dark ON THE FIRST LAUNCH AFTER THIS SHIPS — no switch touched. And
      //    126 `AppColors.*` references across 17 files under apps/subly/lib
      //    paint the LIGHT palette unconditionally (settings 16, home 13,
      //    login 12, detail 11, add-sheet 10 …). Dark mode would render dark
      //    chassis chrome under light-hardcoded screens.
      //
      // Anchored by assert-stamp-properties.mjs:582 / :597 / :598 — which
      // apps/subly is EXEMPT from today (EXEMPT_APPS, :109) and stops being
      // exempt in Phase 5. So this is schedulable: ./theme-fork.md carries the
      // exact three-line replacement that ships the spine WITHOUT the repaint
      // and lands the theme with the P2.6b screen merge instead.
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      darkTheme: buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: Brightness.dark,
      ),
      // [pipeline C-16] The persisted user override. Without this MaterialApp
      // silently defaults to ThemeMode.system, which follows the OS but gives the
      // user no say — and `test/chassis_properties_test.dart` asserts all THREE
      // of theme/darkTheme/themeMode are supplied, so deleting this line fails
      // the build of every stamped app, not just this one.
      themeMode: ref.watch(themeModeProvider),
      routerConfig: router,
      // [pipeline C-14] TEXT SCALING, clamped at the ROOT so every screen in
      // every stamped app inherits it — this is one of the invariants that is
      // near-free here and near-impossible to retrofit across 50 shipped apps.
      //
      // The floor of 1.0 refuses to shrink text below the design size; the
      // ceiling of 2.0 is what keeps a layout usable. Both stores' accessibility
      // settings can push well past 2.0, and unbounded scaling does not degrade
      // gracefully — it overflows, and an overflow is a screen the user cannot
      // finish. Clamping is the honest trade: very large text still works,
      // rather than every screen breaking at the extreme.
      //
      // 🔴 THE BUILDER'S WIDGET IS INSERTED ABOVE THE ROUTER'S NAVIGATOR (the
      // Navigator lives inside `child`), so nothing in this chain can host a
      // dialog. That is why the consent question is an INLINE scrim inside
      // AnalyticsGate rather than a `showDialog`, and it is why the live
      // `ConsentGate` — which borrowed the root Navigator's context via
      // `rootNavigatorKey` — is retired here. See MANIFEST decision D-4.
      builder: (BuildContext context, Widget? child) =>
          MediaQuery.withClampedTextScaling(
            minScaleFactor: 1.0,
            maxScaleFactor: 2.0,
            child: ForceUpdateGate(
              mustUpdate: mustUpdate,
              onUpdate: () => _openUpdate(updateUrl),
              child: AnalyticsGate(
                child: _NotificationTapGate(
                  child: _OfflineBanner(
                    child: child ?? const SizedBox.shrink(),
                  ),
                ),
              ),
            ),
          ),
    );
  }

  Future<void> _openUpdate(String url) async {
    final Uri uri = Uri.parse(url);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Best-effort — never crash the update screen.
    }
  }
}

/// 🔴 [pipeline C-13] `OfflineNotice`'s ONLY CALL SITE — and until 2026-08-06
/// there was none, anywhere in the repository.
///
/// The widget shipped in the design system on 2026-07-28, `offlineMessage` and
/// `retry` shipped in both ARB files, the register recorded the screen as
/// `present` with a valid anchor, and **no user of any stamped app could ever
/// have seen it**. That is the [pipeline C-6] shape: the register asked whether
/// the screen EXISTED and never whether anything reached it, so an absent
/// consumer read exactly like a satisfied one.
///
/// 🔴 IT RETURNS THE CHILD UNTOUCHED WHEN REACHABLE, and that is deliberate
/// rather than incidental: inserting a `Column` above the router on every
/// launch would re-parent every screen in every stamped app in order to
/// display nothing. The tree is byte-identical to the pre-banner one until a
/// request has actually failed.
///
/// The retry re-runs the config resolution rather than "checking the network",
/// because the only honest test of reachability is the request the app wanted
/// to make in the first place.
class _OfflineBanner extends ConsumerWidget {
  const _OfflineBanner({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(networkUnreachableProvider)) return child;
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Column(
      children: <Widget>[
        OfflineNotice(
          message: l10n.offlineMessage,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(appConfigProvider),
        ),
        Expanded(child: child),
      ],
    );
  }
}

/// 🔑 THE ON-SWITCH FOR THE ENTIRE ANALYTICS RAIL ([pipeline C-6] / stage 11).
///
/// The recorder, the transport, the platform Worker and the D1 table are all
/// fail-closed: with no consent artifact they discard, and discarding is the
/// CORRECT behaviour, so nothing goes red. That is how the rail sat dead in
/// apps/subly for months while every test passed. This widget is the one place
/// that turns it on, and `tooling/ci/assert-seams-wired.mjs` asserts a non-test
/// caller of `recordAnalyticsConsent` exists precisely so deleting it fails the
/// build instead of quietly silencing every stamped app.
///
/// It does three things and each is load-bearing:
///  1. asks the consent question, once, when it has never been answered;
///  2. logs the LAUNCH TRIO — `first_launch` · `app_open` · `return_visit` —
///     but ONLY once consent is granted, so the funnel's own denominator is
///     never an event collected without permission;
///  3. flushes on background. The recorder batches at 20 events, so an app that
///     logs a handful per session would otherwise ship NOTHING until the
///     twentieth event — a rail that looks wired and delivers nothing.
class AnalyticsGate extends ConsumerStatefulWidget {
  const AnalyticsGate({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<AnalyticsGate> createState() => _AnalyticsGateState();
}

class _AnalyticsGateState extends ConsumerState<AnalyticsGate>
    with WidgetsBindingObserver {
  bool _launchLogged = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // 🔴 [pipeline C-13] THE REVIEW PROMPT'S ONLY CALL SITE. A seam with no
    // caller is the [pipeline C-6] shape, and this one would be invisible: the
    // gate refuses on almost every launch by design, so "nothing happened" is
    // the correct outcome nearly always and tells you nothing.
    //
    // Counting the launch and asking are deliberately SEPARATE: the count must
    // advance every time, and the ask must be considered every time, but the
    // gate is what decides — never this widget.
    //
    // ⚠️ THIS IS THE CHASSIS DEFAULT, NOT THE BEST MOMENT. Both stores'
    // guidance is to ask after something has gone well for the user, which only
    // the app knows. An app with a real success moment should call
    // `maybeAsk()` there instead of relying on launch count alone — the gate
    // protects either way.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final ReviewPromptController review = ref.read(
        reviewPromptProvider.notifier,
      );
      await review.recordLaunch();
      if (!mounted) return;
      await review.maybeAsk();
      if (!mounted) return;

      // 🔴 [pipeline T-5/T-7] THE REMINDER REPAIR PATH, and the reason it is a
      // start-up call rather than a native boot receiver: the brick stamps no
      // native folders, so `RECEIVE_BOOT_COMPLETED` is not available to it. An
      // Android reboot drops every pending alarm, and a DST shift or a flight
      // moves the wall-clock hour the schedule was built against — after either,
      // a switch that reads ON is attached to nothing. Re-arming from the
      // PERSISTED intent on every launch repairs all three, and `scheduleDaily`
      // replaces by a stable id so it can never accumulate a second pending
      // notification.
      //
      // It also re-asserts the OFF direction, which is what makes "reminders
      // off" survive a restore from a backup taken while they were on.
      //
      // ⚠️ It must NEVER ask for permission — this is the boot path, and Android
      // 13+ makes a second denial permanent. `resyncOnStart` does not, and
      // `chassis_properties_test.dart` asserts the count is zero across a full
      // boot so it cannot start to.
      //
      // 🔴 P2.6a — AND IT REACHES THE NOTIFICATION PLUGIN, WHICH IS WHY
      // `main.dart` MUST OVERRIDE `notificationServiceProvider` WITH THE SAME
      // INSTANCE IT OVERRODE `notificationTapSourceProvider` WITH.
      // `resyncOnStart` does `ref.read(notificationServiceProvider)` then
      // `svc.init()`. `LocalNotificationService._initialized` is PER INSTANCE
      // and `_plugin.initialize(_taps.add)` hands the OS callback THIS
      // instance's stream controller
      // (packages/notifications/lib/src/local_notification_service_io.dart:74,
      // :86-87, :100-113). `FlutterLocalNotificationsPlugin()` is a process
      // singleton and the LAST `initialize` wins — so an unoverridden provider
      // builds a SECOND adapter here, in a post-frame callback that runs after
      // main(), and silently re-points every future tap away from the [13]T-9
      // observer's stream. No error, no red test, taps go nowhere.
      final AppLocalizations l10n = AppLocalizations.of(context);
      await ref
          .read(remindersEnabledProvider.notifier)
          .resyncOnStart(title: l10n.reminderTitle, body: l10n.reminderBody);
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // 🔴 FOUR STATES, AND `inactive` IS THE ONE THAT COVERS DESKTOP — [11]E-4a.
  //
  // Read off dart:ui's own documentation of the enum, not off habit:
  //   · `paused`  — "This state is only entered on iOS and Android."
  //   · `detached`— entered on iOS, Android and web.
  //   · `hidden`  — on non-web desktop this means MINIMIZED or moved to a
  //                 desktop that is no longer visible. Closing a window is not
  //                 minimizing it.
  //   · `inactive`— on non-web desktop, "an application that is not in the
  //                 foreground, but still has visible windows".
  // So on Windows, macOS and Linux the previous three-state set fired on exactly
  // one path — minimize — and never on the way out of the app. `inactive` is the
  // last edge a desktop app reliably reports before the process ends.
  //
  // ⚠️ THE MOBILE COST, MEASURED RATHER THAN WAVED AWAY. On iOS and Android
  // `inactive` also fires on transient interruptions: the notification shade,
  // the app switcher, a phone call, a system dialog, split screen. Two things
  // bound what that costs:
  //   1. `flush()` returns immediately on an empty queue, so an interruption
  //      with nothing queued costs nothing at all — no request, no wakeup.
  //   2. When there IS something queued, the worst case is one request per
  //      event, which is the same ceiling `batchSize: 1` would have. Each event
  //      still ships at most once; the sink dedups on `event_id` regardless.
  // Against that: on mobile the framework synthesizes `inactive` → `hidden` →
  // `paused` on every backgrounding, so for the ordinary background transition
  // this does not ADD a request — it moves the same one earlier, before the OS
  // has a chance to freeze the process mid-POST.
  //
  // Not gated behind a platform check on purpose. A `Platform.isWindows` branch
  // in the chassis would buy a bounded saving on transient mobile interruptions
  // at the price of a per-platform behaviour in the one file every stamped app
  // inherits — the same trade `AnalyticsRecorder` records for refusing a
  // connectivity probe: one behaviour on all six platforms, no plugin, no
  // branch.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      // Fire-and-forget: the framework will not wait, and a failed send just
      // leaves the batch queued for next launch.
      //
      // This is the BEST-EFFORT half of delivery, and it is not sufficient on
      // its own — a page unload beats an unawaited POST, and a killed process
      // reports nothing at all. The guarantee lives in core's
      // `kFlushInterval` deadline; this only makes the common case earlier.
      ref.read(analyticsProvider).valueOrNull?.flush();
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool enabled = ref.watch(analyticsEnabledProvider);
    final bool decided = ref.watch(consentDecidedProvider);

    if (enabled &&
        !_launchLogged &&
        ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted) {
      _launchLogged = true;
      // 🔴 ALL THREE LAUNCH EVENTS, not just `app_open` ([pipeline 11]E-5). The
      // trio and its persisted first-launch marker live in
      // `core.AnalyticsLifecycle`; this line is the consent-gated call site, and
      // it is the ONLY one — see `logLaunchLifecycle`.
      //
      // 🔴 P2.6a — THIS REPLACES `AnalyticsFunnel.onLaunch()`, IT DOES NOT JOIN
      // IT. Both implement the same trio against the SAME two storage keys:
      // core's `kFirstLaunchEmittedKey`/`kLastOpenKey` and Subly's
      // `_kFirstLaunchDone`/`_kLastOpen` are byte-identical strings
      // ('nikatru.analytics.first_launch_done' / 'nikatru.analytics.last_open').
      // Keeping both call sites would emit `app_open` TWICE on every launch —
      // doubling the denominator every retention and activation ratio is
      // divided by — and would race on `first_launch`. `AnalyticsFunnel.onLaunch`
      // and its `_bucketDays` therefore lose their last caller and must be
      // deleted with this change; the funnel's app-specific events
      // (`onActivation`, `onNotificationOpened`, the money four) stay.
      logLaunchLifecycle(ref);
    }

    // Rendered INLINE rather than via showDialog: this gate sits in
    // MaterialApp's `builder`, which is ABOVE the router's Navigator, so
    // `showDialog` here has no Navigator to push onto. An inline scrim also
    // disappears reactively the moment the decision is recorded, with no
    // post-frame callback and no "did I already ask?" bookkeeping to get wrong.
    return Stack(
      children: <Widget>[
        widget.child,
        if (enabled && !decided) const _ConsentPrompt(),
      ],
    );
  }
}

/// [13]T-9 — THE TAP→`notification_opened` SUBSCRIPTION, and the only part of
/// this file that is Subly's rather than the chassis's.
///
/// 🔴 WHY IT IS A SEPARATE WIDGET RATHER THAN THREE LINES INSIDE
/// [AnalyticsGate]. The live app hung this off the same `_launchLogged` latch
/// that fired the launch trio, because in the live file the funnel WAS the
/// launch path. Post-merge the launch path is `logLaunchLifecycle` (chassis,
/// core-owned) and the tap path is the funnel (app-owned) — two different
/// objects with two different owners. Folding Subly's provider into the chassis
/// widget would be drift the Phase-5 text-fidelity pass then has to unpick, and
/// it would make `AnalyticsGate` un-stampable for app #2.
///
/// It carries the live file's three constraints unchanged:
///  · SAME CONSENT GATE, same reason: `notification_opened` is an observation
///    about a person and must not be recorded before they have said yes.
///  · STARTED HERE RATHER THAN IN `main()` because the funnel is what a tap has
///    to reach, and the funnel resolves asynchronously — subscribing earlier
///    would mean holding taps for an object that does not exist yet.
///  · ONE-SHOT: `start()` is idempotent AND the observer is latched on null, so
///    a rebuild cannot stack subscriptions and double-log a tap.
///
/// The instance it subscribes to is [notificationTapSourceProvider], which
/// `main.dart` overrides with the adapter it actually `init()`ed. Overriding
/// with anything else gives the app a stream that is silent forever.
class _NotificationTapGate extends ConsumerStatefulWidget {
  const _NotificationTapGate({required this.child});

  final Widget child;

  @override
  ConsumerState<_NotificationTapGate> createState() =>
      _NotificationTapGateState();
}

class _NotificationTapGateState extends ConsumerState<_NotificationTapGate> {
  /// Held so it can be cancelled. Null until consent is granted and the funnel
  /// has resolved.
  NotificationTapObserver? _taps;

  @override
  void dispose() {
    _taps?.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_taps == null &&
        ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted) {
      final AnalyticsFunnel? funnel = ref
          .watch(analyticsFunnelProvider)
          .valueOrNull;
      if (funnel != null) {
        _taps = NotificationTapObserver(
          service: ref.read(notificationTapSourceProvider),
          funnel: funnel,
        )..start();
      }
    }
    return widget.child;
  }
}

/// The consent question. Deliberately plain Material so a stamped app owes the
/// design system nothing for it — restyle freely, but keep BOTH answers equally
/// prominent (see below).
class _ConsentPrompt extends ConsumerWidget {
  const _ConsentPrompt();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeData theme = Theme.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.black54,
        // KEEPS `Center`, takes only the WIDTH from the chassis. This is a
        // modal scrim over a dimmed app: sitting in the middle of the screen is
        // the design, not an accident, so `ContentPane` (which pins to the top)
        // would be the wrong primitive here. The 420 literal is gone either
        // way — that was the copy, repeated in five other files.
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
              child: Material(
                color: theme.colorScheme.surface,
                borderRadius: BorderRadius.circular(20),
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        l10n.consentTitle(AppConfig.appName),
                        style: theme.textTheme.titleLarge,
                      ),
                      const SizedBox(height: 12),
                      Text(l10n.consentBody, style: theme.textTheme.bodyMedium),
                      const SizedBox(height: 8),
                      Text(
                        l10n.consentPrivacy,
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 16),
                      // Both answers get the same size and weight ON PURPOSE. A
                      // prominent "Allow" beside a faint "No thanks" is the dark
                      // pattern consent rules exist to stop, and it also poisons
                      // the data with pressured yeses.
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => _answer(ref, granted: false),
                              child: Text(l10n.consentDecline),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton(
                              onPressed: () => _answer(ref, granted: true),
                              child: Text(l10n.consentAllow),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _answer(WidgetRef ref, {required bool granted}) {
    // Not awaited: the decision applies in memory immediately and the upload is
    // best-effort, so blocking the button on a network round trip would only
    // make a declined choice feel like a broken one.
    recordAnalyticsConsent(ref, granted: granted);
  }
}
