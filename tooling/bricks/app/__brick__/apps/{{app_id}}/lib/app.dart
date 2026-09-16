import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/app_config.dart';
import 'core/router.dart';
import 'l10n/app_localizations.dart';
import 'state/notification_tap_observer.dart';
import 'state/providers.dart';

/// Root widget for {{{display_name}}} — the COMPOSITION ROOT half.
///
/// 🏗️ THE SHELL IS IN `package:nikatru_chassis_screens/shell/app_shell.dart`
/// ([ADR 067] decision 2): [NikatruApp] owns `MaterialApp.router`, the clamped
/// text scaling and the force-update gate; [ConsentScrim], [ConsentPromptCard],
/// [OfflineBannerHost] and [AppLifecycleFlush] own the surfaces the gates below
/// render. What stayed here is what a package declaring no Riverpod, no
/// go_router and no plugin cannot carry: the stamped seed, this app's own
/// localisation delegates, every provider read, the `url_launcher` call, and the
/// one writer that records a consent answer.
class {{app_id.pascalCase()}}App extends ConsumerWidget {
  const {{app_id.pascalCase()}}App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    // ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE. WATCHED FOR ITS EFFECT:
    // the provider subscribes to the identity stream so Apple's refresh token can
    // be captured the once it is offered. A provider nobody watches is never
    // created, so without this line the listener does not exist.
    ref.watch(appleTokenKeeperProvider);
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
    return NikatruApp(
      title: AppConfig.appName,
      // [ADR 067] decision 2 — the CHASSIS delegate is composed BESIDE the
      // app's own, never instead of it. `AppLocalizations` carries the keys
      // this app owns (its title, and any copy naming what it sells);
      // `ChassisLocalizations` carries the 149 shared keys, so one
      // translation fix reaches every app the factory stamps. Both lists
      // resolve against the SAME `supportedLocales` below.
      localizationsDelegates: <LocalizationsDelegate<dynamic>>[
        ...AppLocalizations.localizationsDelegates,
        ChassisLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // [pipeline C-13] The persisted language override. NULL is not "no value"
      // — it is "follow the device", and MaterialApp already does the right
      // thing with null. Without this line the picker would store a choice the
      // app never reads, which is the dead-control shape [pipeline C-6] exists
      // to catch.
      locale: ref.watch(localeProvider),
      theme: buildAppTheme(seed: const Color(0xFF{{{seed_hex}}})),
      darkTheme: buildAppTheme(
        seed: const Color(0xFF{{{seed_hex}}}),
        brightness: Brightness.dark,
      ),
      // [pipeline C-16] The persisted user override. Without this MaterialApp
      // silently defaults to ThemeMode.system, which follows the OS but gives the
      // user no say — and `test/chassis_properties_test.dart` asserts all THREE
      // of theme/darkTheme/themeMode are supplied, so deleting this line fails
      // the build of every stamped app, not just this one.
      themeMode: ref.watch(themeModeProvider),
      routerConfig: router,
      mustUpdate: mustUpdate,
      onUpdate: () => _openUpdate(updateUrl),
      // The gate chain, wrapped around the routed screen by NikatruApp's
      // builder. Every one of the three is a ConsumerWidget, which is why the
      // chain is written here and not in the package.
      shell: (Widget routed) => AnalyticsGate(
        child: _NotificationTapGate(child: _OfflineBanner(child: routed)),
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

/// The offline banner's ADAPTER half — [pipeline C-13].
///
/// 🏗️ The banner itself is [OfflineBannerHost]. Two things stayed: the
/// `networkUnreachableProvider` read and the retry, which re-runs the config
/// resolution rather than "checking the network" — the only honest test of
/// reachability is the request the app wanted to make in the first place. Both
/// are Riverpod.
class _OfflineBanner extends ConsumerWidget {
  const _OfflineBanner({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return OfflineBannerHost(
      unreachable: ref.watch(networkUnreachableProvider),
      onRetry: () => ref.invalidate(appConfigProvider),
      child: child,
    );
  }
}

/// 🔑 THE ON-SWITCH FOR THE ENTIRE ANALYTICS RAIL ([pipeline C-6] / stage 11).
///
/// The recorder, the transport, the platform Worker and the D1 table are all
/// fail-closed: with no consent artifact they discard, and discarding is the
/// CORRECT behaviour, so nothing goes red. That is how the rail sat dead in
/// apps/subscriptiontracker for months while every test passed. This widget is the one place
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
///     twentieth event — a rail that looks wired and delivers nothing. The four
///     lifecycle edges that mean "on the way out" live in [AppLifecycleFlush];
///     the `flush()` itself is a provider read and stays here.
class AnalyticsGate extends ConsumerStatefulWidget {
  const AnalyticsGate({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<AnalyticsGate> createState() => _AnalyticsGateState();
}

class _AnalyticsGateState extends ConsumerState<AnalyticsGate> {
  bool _launchLogged = false;

  @override
  void initState() {
    super.initState();
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
      final ChassisLocalizations l10n = context.chassisL10n;
      await ref
          .read(remindersEnabledProvider.notifier)
          .resyncOnStart(title: l10n.reminderTitle, body: l10n.reminderBody);
    });
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
      logLaunchLifecycle(ref);
    }

    final bool asking = enabled && !decided;
    return AppLifecycleFlush(
      // Fire-and-forget: the framework will not wait, and a failed send just
      // leaves the batch queued for next launch. The guarantee lives in core's
      // `kFlushInterval` deadline; this only makes the common case earlier.
      onBackground: () => ref.read(analyticsProvider).valueOrNull?.flush(),
      child: ConsentScrim(
        asking: asking,
        prompt: const _ConsentPrompt(),
        child: widget.child,
      ),
    );
  }
}

/// [13]T-9 — THE TAP→`notification_opened` SUBSCRIPTION, INHERITED BY EVERY
/// STAMPED APP.
///
/// 🔴 THE GAP THIS CLOSES. The tap loop shipped in `apps/subscriptiontracker` and stopped
/// there, so the template carried the whole OUTBOUND rail (schedule, re-arm,
/// cancel, the platform matrix) and NOTHING on the way back. App #2 would have
/// been born able to wake a user at 09:00 and unable to notice they answered.
/// See [NotificationTapObserver] for why nothing went red.
///
/// 🔴 WHY A SEPARATE WIDGET RATHER THAN THREE LINES INSIDE [AnalyticsGate].
/// They are two different subjects with two different owners: the launch trio is
/// core's ([core.AnalyticsLifecycle] via `logLaunchLifecycle`) and fires once per
/// launch off a latch; this is a SUBSCRIPTION that lives as long as the app and
/// must be cancelled in `dispose`. Folding a stream subscription into the widget
/// that owns the consent scrim would make both harder to reason about and neither
/// easier to test.
///
/// Three constraints, each load-bearing:
///  · SAME CONSENT GATE as every other emitter: `notification_opened` is an
///    observation about a person and must not be recorded before they said yes.
///  · IT AWAITS `analyticsProvider.future` rather than reading `.valueOrNull`,
///    for the reason `logEvent` states in providers.dart — at launch the recorder
///    is still resolving, and a `valueOrNull` read silently drops exactly the
///    events it was subscribed to collect. Worse here than there: the consent
///    decision INVALIDATES the recorder, so `valueOrNull` during that window
///    hands back the previous, already-disposed one and the subscription is
///    latched onto a sink that ships nothing.
///  · ONE-SHOT: `_observing` latches BEFORE the await and `start()` is itself
///    idempotent, so neither a rebuild nor a re-entry can stack subscriptions and
///    double-log a tap.
///
/// The instance it subscribes to is [notificationServiceProvider] — the SAME one
/// the reminder rail schedules through, and the one `main.dart` overrides with
/// the adapter it actually `init()`ed. That single-instance discipline is the
/// whole wiring: taps are delivered on the initialised object's own stream, so a
/// second, uninitialised instance would expose a stream that is silent forever.
class _NotificationTapGate extends ConsumerStatefulWidget {
  const _NotificationTapGate({required this.child});

  final Widget child;

  @override
  ConsumerState<_NotificationTapGate> createState() =>
      _NotificationTapGateState();
}

class _NotificationTapGateState extends ConsumerState<_NotificationTapGate> {
  /// Held so it can be cancelled. Null until consent is granted and the recorder
  /// has resolved.
  NotificationTapObserver? _taps;

  /// Latched before the await, never after — see the class doc.
  bool _observing = false;

  @override
  void dispose() {
    _taps?.stop();
    super.dispose();
  }

  Future<void> _observe() async {
    try {
      final core.Analytics analytics = await ref.read(analyticsProvider.future);
      // The gate can be torn down while the recorder resolves. Subscribing after
      // that would build an observer `dispose` has already run past, i.e. a
      // subscription nothing will ever cancel.
      if (!mounted) return;
      final NotificationTapObserver observer = NotificationTapObserver(
        service: ref.read(notificationServiceProvider),
        analytics: analytics,
      );
      _taps = observer;
      observer.start();
    } catch (_) {
      // A recorder that cannot resolve means no measurement, never a broken
      // launch. Deliberately NOT retried: `_observing` stays latched, because a
      // build-triggered retry loop is a worse failure than a missing event.
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_observing &&
        ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted) {
      _observing = true;
      // Fire-and-forget, exactly as AnalyticsGate launches the trio: this is a
      // build, and nothing in the tree may wait on a recorder.
      _observe();
    }
    return widget.child;
  }
}

/// The consent question's ADAPTER half.
///
/// 🏗️ The card is [ConsentPromptCard]. What stayed is the one WRITER:
/// `recordAnalyticsConsent(ref, granted:)`, which `assert-seams-wired.mjs`
/// requires a non-test caller for and which is Riverpod besides. Not awaited:
/// the decision applies in memory immediately and the upload is best-effort, so
/// blocking the button on a network round trip would only make a declined choice
/// feel like a broken one.
class _ConsentPrompt extends ConsumerWidget {
  const _ConsentPrompt();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ConsentPromptCard(
      appName: AppConfig.appName,
      onAnswer: ({required bool granted}) =>
          recordAnalyticsConsent(ref, granted: granted),
    );
  }
}
