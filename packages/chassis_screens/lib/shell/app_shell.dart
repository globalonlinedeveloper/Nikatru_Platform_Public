import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The app ROOT every stamped app inherits — [ADR 067] decision 2.
///
/// 🏗️ THIS IS THE BODY OF THE BRICK'S `<App>App`, MOVED. The brick keeps the
/// COMPOSITION ROOT and nothing else: the stamped seed (`buildAppTheme(seed:
/// const Color(0xFF<seed_hex>))`, which is mustache and cannot leave), the
/// app's own localisation delegates, the provider reads, and the gate chain it
/// passes to [shell]. Every one of those is either per-app by construction or
/// Riverpod, which this package declares none of.
///
/// 🔴 FIVE WIDGETS IN ONE FILE, AND THAT IS A MEASUREMENT RATHER THAN A STYLE.
/// `tooling/ci/chassis-delegation.mjs` resolves a delegation only when the
/// adapter imports EXACTLY ONE `package:nikatru_chassis_screens/…` path, and it
/// expands ONE level of barrel — but its `exportRe` resolves an `export '…'`
/// against `<package>/lib/`, not against the barrel's own directory
/// (`chassis-delegation.mjs:544-546`). A barrel that lives in a SUBDIRECTORY
/// therefore expands to nothing: `export 'consent_prompt_card.dart';` in
/// `lib/shell/` resolves to `lib/consent_prompt_card.dart`, which is not on
/// disk, so the re-exported file is silently dropped from `files` while Dart
/// itself resolves it correctly. Measured on this unit: the brick's `app.dart`
/// delegated fine and `assert-consent-withdrawal-surface` still reported
/// COVERAGE LOST, because the class that renders `consentPrivacy` was in a
/// re-exported sibling the resolver never added.
///
/// The brick's `app.dart` needs [NikatruApp], [ConsentScrim],
/// [ConsentPromptCard], [OfflineBannerHost] and [AppLifecycleFlush]. One file
/// makes all five reachable from one import with no reliance on that
/// convention. They are one subject anyway — the shell an app is mounted in.
///
/// ⚠️ WHAT DID NOT MOVE, AND WHY IT IS NOT AN OVERSIGHT:
///   · `MaterialApp.router`'s `title`, `theme`, `darkTheme`, `themeMode`,
///     `locale`, `localizationsDelegates`, `supportedLocales` and
///     `routerConfig` are PARAMETERS here rather than decisions. Each is
///     anchored in the brick by `tooling/ci/assert-stamp-properties.mjs`
///     (`theme: buildAppTheme(seed:`, `darkTheme: buildAppTheme(\n seed:`,
///     `themeMode: ref.watch(themeModeProvider)`, `locale:
///     ref.watch(localeProvider)`), and each anchor is a claim about the
///     STAMPED app supplying its own value — which is exactly what a required
///     parameter forces.
///   · The force-update DESTINATION resolves in the brick
///     (`ref.watch(appConfigProvider).valueOrNull?.updateUrl ??
///     AppConfig.updateUrl`, anchored by
///     `tooling/ci/assert-vendor-portability.mjs`), and the launch itself uses
///     `url_launcher` — a plugin, which this package may not declare.
class NikatruApp extends StatelessWidget {
  const NikatruApp({
    required this.title,
    required this.localizationsDelegates,
    required this.supportedLocales,
    required this.locale,
    required this.theme,
    required this.darkTheme,
    required this.themeMode,
    required this.routerConfig,
    required this.mustUpdate,
    required this.onUpdate,
    required this.shell,
    super.key,
  });

  /// [pipeline C-14] TEXT SCALING, clamped at the ROOT so every screen in every
  /// stamped app inherits it — this is one of the invariants that is near-free
  /// here and near-impossible to retrofit across fifty shipped apps.
  ///
  /// The floor of 1.0 refuses to shrink text below the design size; the ceiling
  /// of 2.0 is what keeps a layout usable. Both stores' accessibility settings
  /// can push well past 2.0, and unbounded scaling does not degrade gracefully
  /// — it overflows, and an overflow is a screen the user cannot finish.
  /// Clamping is the honest trade: very large text still works, rather than
  /// every screen breaking at the extreme.
  static const double minTextScale = 1.0;
  static const double maxTextScale = 2.0;

  final String title;

  /// The app's own delegates, with `ChassisLocalizations.delegate` composed
  /// BESIDE them by the caller — never instead of them.
  final List<LocalizationsDelegate<dynamic>> localizationsDelegates;
  final Iterable<Locale> supportedLocales;

  /// The persisted language override. NULL is not "no value" — it is "follow the
  /// device", and `MaterialApp` already does the right thing with null.
  final Locale? locale;

  final ThemeData theme;
  final ThemeData darkTheme;

  /// The persisted user override. Without it `MaterialApp` silently defaults to
  /// `ThemeMode.system`, which follows the OS but gives the user no say.
  final ThemeMode themeMode;

  final RouterConfig<Object> routerConfig;

  /// CFG-1 force-update kill-switch: blocks the app when the running version is
  /// below the resolved `min_supported_version`. It fails open while the config
  /// and the version load, so it never blocks the UI on a slow network.
  final bool mustUpdate;

  /// Opens the resolved update destination. The RESOLUTION stays in the brick —
  /// see the class doc.
  final VoidCallback onUpdate;

  /// The app's own gate chain, wrapped around the routed screen.
  ///
  /// A builder rather than a `Widget`, because the routed screen only exists
  /// inside `MaterialApp`'s `builder` — the one place where a widget is both
  /// below the `Localizations` this app installs and above the router's
  /// `Navigator`. Everything the chain does (consent, notification taps, the
  /// offline banner) needs both of those to be true at once.
  final Widget Function(Widget routed) shell;

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: title,
      // The store screenshot capture runs through `flutter drive`, which builds
      // in DEBUG — so every captured frame would otherwise carry Flutter's red
      // DEBUG ribbon and the listing would advertise an unfinished build. It is
      // one identifier and nothing else is holding it.
      //
      // 🔴 AND NOTHING GUARDS THIS LINE TODAY. CORRECTED 2026-09-07 ([ADR 067]
      // phase 2b, unit app-shell-residues). This comment claimed that
      // `tooling/ci/assert-listing-assets.mjs` "follows the delegation from each
      // app's lib/app.dart to find it here" — WITHDRAWN. That limb iterates
      // `catalog/apps.json` (`assert-listing-assets.mjs:156`) and reads
      // `apps/<slug>/lib/app.dart` plus what THAT file delegates to; the brick
      // template, where the delegation lives, is not in its domain. The
      // catalogue holds one app, `apps/subscriptiontracker`, and it does not delegate — it
      // sets the flag inline at `apps/subscriptiontracker/lib/app.dart:44` ([ADR 065]: Subly
      // does not adopt the packages this phase). Measured, not read: deleting
      // this line from THIS file (land-check `grep -c` 1 → 0) left
      // `assert-listing-assets` at EXIT 0. Registered as an `open.json` row
      // rather than described, because widening that limb's domain to the brick
      // template edits a guard this unit does not own.
      debugShowCheckedModeBanner: false,
      localizationsDelegates: localizationsDelegates,
      supportedLocales: supportedLocales,
      locale: locale,
      theme: theme,
      darkTheme: darkTheme,
      themeMode: themeMode,
      routerConfig: routerConfig,
      builder: (BuildContext context, Widget? child) =>
          MediaQuery.withClampedTextScaling(
            minScaleFactor: minTextScale,
            maxScaleFactor: maxTextScale,
            // 🔴 THE COPY IS PASSED, AND UNTIL 2026-09-04 IT WAS NOT — in EVERY
            // app this template had ever stamped. `ForceUpdateGate` carried
            // English parameter defaults and the call site supplied none, so the
            // one screen that REPLACES THE WHOLE APP and cannot be dismissed
            // shipped English to every locale. No key for it had ever existed in
            // any arb, in either tree.
            //
            // ⚠️ `context.chassisL10n` IS AVAILABLE HERE: this is
            // `MaterialApp.router`'s `builder`, which runs BELOW the
            // `Localizations` widget the MaterialApp installs.
            child: ForceUpdateGate(
              mustUpdate: mustUpdate,
              onUpdate: onUpdate,
              title: context.chassisL10n.updateRequiredTitle,
              message: context.chassisL10n.updateRequiredMessage,
              buttonLabel: context.chassisL10n.updateRequiredAction,
              child: shell(child ?? const SizedBox.shrink()),
            ),
          ),
    );
  }
}


/// The first-run analytics consent question — the BODY, moved here by
/// [ADR 067] decision 2.
///
/// 🏗️ WHAT STAYED IN THE BRICK, AND WHY EACH THING DID. The adapter keeps
/// `_ConsentPrompt`, a `ConsumerWidget` that reads nothing and writes one thing:
/// `recordAnalyticsConsent(ref, granted: granted)`. That call is Riverpod, this
/// package declares none, and `tooling/ci/assert-seams-wired.mjs` asserts a
/// non-test caller of it exists — so the writer stays on the caller's side of
/// the boundary and this widget takes a callback, exactly the pattern
/// `destructive_confirm_dialog.dart` records.
///
/// 🔴 THE SCROLL VIEW IS A DEFECT REPAIR WITH A NUMBER ON IT, AND IT TRAVELLED
/// WITH THE BODY. `tooling/ci/assert-consent-withdrawal-surface.mjs` limb 4
/// derives the prompt from the tree — whichever widget class renders
/// `consentPrivacy` IS the prompt — and fails the build if that class has no
/// scroller. Since the class that renders the sentence is now THIS one, that
/// limb follows the delegation to find it. Deleting the `SingleChildScrollView`
/// below reddens the build for every root, as it did when the body lived in the
/// brick.
///
/// Deliberately plain Material so a stamped app owes the design system nothing
/// for it — restyle freely, but keep BOTH answers equally prominent (see below).
class ConsentPromptCard extends StatelessWidget {
  const ConsentPromptCard({
    required this.appName,
    required this.onAnswer,
    super.key,
  });

  /// The app's display name, which the title and the accessible label both
  /// spell. It arrives resolved: `AppConfig` is per-app and stays in the brick.
  final String appName;

  /// The one decision this surface can produce. Not awaited by the caller
  /// either: the choice applies in memory immediately and the upload is
  /// best-effort, so blocking the button on a network round trip would only make
  /// a declined choice feel like a broken one.
  final void Function({required bool granted}) onAnswer;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ChassisLocalizations l10n = context.chassisL10n;
    return Positioned.fill(
      // 🔴 THE DIALOG ROLE, RESTORED BY HAND. `ModalRoute` sets `scopesRoute`
      // on every pushed route; an inline scrim is not a route and gets none of
      // it, so a screen reader had no way to say a decision was being asked
      // for. With the background excluded by [ConsentScrim], this node is the
      // whole accessible tree while the question is open.
      child: Semantics(
        scopesRoute: true,
        namesRoute: true,
        explicitChildNodes: true,
        label: l10n.consentTitle(appName),
        child: ColoredBox(
          color: Colors.black54,
          // KEEPS `Center`, takes only the WIDTH from the chassis. This is a
          // modal scrim over a dimmed app: sitting in the middle of the screen
          // is the design, not an accident, so `ContentPane` (which pins to the
          // top) would be the wrong primitive here. The 420 literal is gone
          // either way — that was the copy, repeated in five other files.
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
                child: Material(
                  color: theme.colorScheme.surface,
                  borderRadius: BorderRadius.circular(20),
                  // Clipped because the content scrolls: without it the first
                  // and last lines paint over the rounded corners as they pass
                  // under them.
                  clipBehavior: Clip.antiAlias,
                  // 🔴 SCROLLABLE, AND THIS IS A DEFECT REPAIR WITH A NUMBER ON
                  // IT — NOT DEFENSIVE PADDING. `Column(mainAxisSize: min)`
                  // inside `Center` is unbounded in the way that matters: it
                  // takes the height it wants and overflows the screen when the
                  // text is large. Measured on the real app at the largest text
                  // this chassis PERMITS (`NikatruApp.maxTextScale` is 2.0 — in
                  // range by design, not an extreme):
                  //   · 360×640 @2.0 en → RenderFlex overflowed by 644 px
                  //   · 360×640 @2.0 ta → 1180 px
                  // and the "Allow" button's rect came back at y 1140→1220 on a
                  // 640-tall screen, i.e. entirely below the fold with no way to
                  // reach it. The control was clean at the same size with the
                  // scrim off, so the overflowing box was this Column and not a
                  // screen beneath it. An unanswerable modal is worse than an
                  // ugly one: `ColoredBox` is hit-test-opaque, so the app was
                  // unusable, and because the recorder is fail-closed the
                  // silence would have looked exactly like a user who declined.
                  //
                  // KEEP THE SCROLL VIEW. A stamped app is free to restyle this
                  // card; deleting the scroll view re-opens the defect, and
                  // `assert-consent-withdrawal-surface.mjs` limb 4 fails the
                  // build for every root if it goes.
                  child: SingleChildScrollView(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            l10n.consentTitle(appName),
                            style: theme.textTheme.titleLarge,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            l10n.consentBody,
                            style: theme.textTheme.bodyMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            l10n.consentPrivacy,
                            style: theme.textTheme.bodySmall,
                          ),
                          const SizedBox(height: 16),
                          // Both answers get the same size and weight ON
                          // PURPOSE. A prominent "Allow" beside a faint "No
                          // thanks" is the dark pattern consent rules exist to
                          // stop, and it also poisons the data with pressured
                          // yeses.
                          Row(
                            children: <Widget>[
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: () => onAnswer(granted: false),
                                  child: Text(l10n.consentDecline),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: FilledButton(
                                  onPressed: () => onAnswer(granted: true),
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
        ),
      ),
    );
  }
}

/// The scrim's MODALITY — the two lines that buy back what `ModalRoute` used to
/// give free.
///
/// 🔴 AN INLINE SCRIM IS NOT MODAL BY ITSELF, AND THIS WIDGET IS WHY IT IS —
/// measured on the stamped app, not assumed. Before `ExcludeSemantics` and
/// `ExcludeFocus`, with the prompt up, a walk of the compiled semantics tree
/// found the screen BEHIND the scrim fully exposed, its buttons still carrying
/// live tap actions. Semantic taps dispatch straight to the widget and DO NOT
/// hit-test, so an opaque `ColoredBox` stops a finger and stops nothing for
/// TalkBack or VoiceOver: a screen-reader user could drive the app underneath a
/// modal they were never told they were inside.
///
/// `excluding:` rather than conditionally WRAPPING, on purpose: the widget types
/// stay in the tree across the answer, so recording the decision does not
/// remount the whole app subtree and throw away the router's state.
///
/// Rendered INLINE rather than via `showDialog` because the gate that mounts
/// this sits in [NikatruApp]'s `builder`, which is ABOVE the router's Navigator,
/// so `showDialog` there has no Navigator to push onto. An inline scrim also
/// disappears reactively the moment the decision is recorded, with no post-frame
/// callback and no "did I already ask?" bookkeeping to get wrong.
class ConsentScrim extends StatelessWidget {
  const ConsentScrim({
    required this.asking,
    required this.prompt,
    required this.child,
    super.key,
  });

  /// True while the question is open. The caller decides — that judgement reads
  /// two providers and stays in the brick adapter.
  final bool asking;

  /// The question itself, supplied by the caller so the writer that records the
  /// answer never has to cross this package's boundary.
  final Widget prompt;

  /// The app, which stays mounted and merely stops being reachable.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: <Widget>[
        ExcludeFocus(
          excluding: asking,
          child: ExcludeSemantics(excluding: asking, child: child),
        ),
        if (asking) prompt,
      ],
    );
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
/// 🏗️ MOVED HERE BY [ADR 067] decision 2. The brick keeps `_OfflineBanner`, a
/// `ConsumerWidget` that supplies the two things this package cannot see:
/// `networkUnreachableProvider` and the `ref.invalidate(appConfigProvider)` the
/// retry runs. Both are Riverpod.
///
/// 🔴 IT RETURNS THE CHILD UNTOUCHED WHEN REACHABLE, and that is deliberate
/// rather than incidental: inserting a `Column` above the router on every
/// launch would re-parent every screen in every stamped app in order to
/// display nothing. The tree is byte-identical to the pre-banner one until a
/// request has actually failed.
///
/// The retry re-runs the config resolution rather than "checking the network",
/// because the only honest test of reachability is the request the app wanted
/// to make in the first place — which is why [onRetry] is a callback and not a
/// connectivity probe this package could have run for itself.
class OfflineBannerHost extends StatelessWidget {
  const OfflineBannerHost({
    required this.unreachable,
    required this.onRetry,
    required this.child,
    super.key,
  });

  /// Whether the last config resolution failed to reach the network.
  final bool unreachable;

  /// Re-runs the request that failed. See the class doc for why this is not a
  /// connectivity check.
  final VoidCallback onRetry;

  /// The app below the banner.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!unreachable) return child;
    final ChassisLocalizations l10n = context.chassisL10n;
    // 🔴 THE NOTICE IS PAINTED AFTER THE ROUTED CHILD, AND THAT ORDER IS THE
    // A11Y FIX, NOT A LAYOUT CHOICE (O-CHASSIS-OFFLINE-BANNER-UNANNOUNCED,
    // 2026-09-14). Until then this was a `Column` with the notice FIRST. The
    // router's page route wraps its page in `BlockSemantics` (its
    // `ModalBarrier`), and `BlockSemantics` drops the semantics of everything
    // painted BEFORE it. So the banner was mounted and visible and a screen
    // reader was told nothing, not even the Retry control. Measured
    // 2026-09-07: `find.text('Retry')` -> 1 widget,
    // `find.bySemanticsLabel('Retry')` -> 0 nodes.
    //
    // `VerticalDirection.up` keeps the picture identical (the notice still
    // sits on top and the app fills the rest below it). What changes is that
    // the child list, which is PAINT order, now puts the notice last, so no
    // BlockSemantics inside the routed child can reach it.
    return Flex(
      direction: Axis.vertical,
      verticalDirection: VerticalDirection.up,
      children: <Widget>[
        Expanded(child: child),
        OfflineNotice(
          message: l10n.offlineMessage,
          retryLabel: l10n.retry,
          onRetry: onRetry,
        ),
      ],
    );
  }
}


/// Calls [onBackground] on every edge that means "this app is on its way out".
///
/// 🏗️ MOVED HERE BY [ADR 067] decision 2 from the brick's `AnalyticsGate`,
/// which no longer needs to be a `WidgetsBindingObserver` at all. The adapter
/// keeps the one Riverpod line the callback runs —
/// `ref.read(analyticsProvider).valueOrNull?.flush()` — because the recorder is
/// a provider and this package declares no Riverpod.
///
/// 🔴 FOUR STATES, AND `inactive` IS THE ONE THAT COVERS DESKTOP — [11]E-4a.
///
/// Read off dart:ui's own documentation of the enum, not off habit:
///   · `paused`  — "This state is only entered on iOS and Android."
///   · `detached`— entered on iOS, Android and web.
///   · `hidden`  — on non-web desktop this means MINIMIZED or moved to a
///                 desktop that is no longer visible. Closing a window is not
///                 minimizing it.
///   · `inactive`— on non-web desktop, "an application that is not in the
///                 foreground, but still has visible windows".
/// So on Windows, macOS and Linux the previous three-state set fired on exactly
/// one path — minimize — and never on the way out of the app. `inactive` is the
/// last edge a desktop app reliably reports before the process ends.
///
/// ⚠️ THE MOBILE COST, MEASURED RATHER THAN WAVED AWAY. On iOS and Android
/// `inactive` also fires on transient interruptions: the notification shade,
/// the app switcher, a phone call, a system dialog, split screen. Two things
/// bound what that costs:
///   1. `flush()` returns immediately on an empty queue, so an interruption
///      with nothing queued costs nothing at all — no request, no wakeup.
///   2. When there IS something queued, the worst case is one request per
///      event, which is the same ceiling `batchSize: 1` would have. Each event
///      still ships at most once; the sink dedups on `event_id` regardless.
/// Against that: on mobile the framework synthesizes `inactive` → `hidden` →
/// `paused` on every backgrounding, so for the ordinary background transition
/// this does not ADD a request — it moves the same one earlier, before the OS
/// has a chance to freeze the process mid-POST.
///
/// Not gated behind a platform check on purpose. A `Platform.isWindows` branch
/// in the chassis would buy a bounded saving on transient mobile interruptions
/// at the price of a per-platform behaviour in the one file every stamped app
/// inherits — the same trade `AnalyticsRecorder` records for refusing a
/// connectivity probe: one behaviour on all six platforms, no plugin, no
/// branch.
class AppLifecycleFlush extends StatefulWidget {
  const AppLifecycleFlush({
    required this.onBackground,
    required this.child,
    super.key,
  });

  /// Fire-and-forget by contract: the framework will not wait, and a failed send
  /// just leaves the batch queued for next launch.
  ///
  /// This is the BEST-EFFORT half of delivery, and it is not sufficient on its
  /// own — a page unload beats an unawaited POST, and a killed process reports
  /// nothing at all. The guarantee lives in core's `kFlushInterval` deadline;
  /// this only makes the common case earlier.
  final VoidCallback onBackground;

  final Widget child;

  @override
  State<AppLifecycleFlush> createState() => _AppLifecycleFlushState();
}

class _AppLifecycleFlushState extends State<AppLifecycleFlush>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      widget.onBackground();
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
