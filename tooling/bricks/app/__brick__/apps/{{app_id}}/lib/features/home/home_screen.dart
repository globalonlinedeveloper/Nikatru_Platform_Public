import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';

/// The PERSISTENT navigation shell for {{{display_name}}} — the design-system
/// [NavShell] over [AppScaffold]'s adaptive chrome (NavigationBar -> Rail ->
/// Drawer), mounted by the `ShellRoute` in `core/router.dart` so that it
/// survives navigation instead of being rebuilt by whatever screen happens to
/// be on top.
///
/// 🔴 THIS CLASS IS THE FIX, AND WHAT IT REPLACED LOOKED CORRECT. The nav bar
/// used to be built INSIDE [HomeScreen] (this file, before this change), so it
/// existed only while the home route was the top of the stack. `context.go`
/// replaces that stack — which meant the one control that navigated,
/// `/settings`, DESTROYED the bar that offered it, and every route the chassis
/// declares was a dead end with no way back except the system Back gesture
/// (which web and desktop do not reliably have). The Settings tab was
/// simultaneously the only working destination and the only way to lose the
/// navigation.
///
/// ⚠️ IT LIVES IN `features/home/` BECAUSE THE NAV CHROME ALREADY DID, NOT
/// BECAUSE IT BELONGS TO HOME. `apps/subly` keeps its equivalent in
/// `features/shell/app_shell.dart`, which is the right address; moving this one
/// there is a file the change that introduced it was not allowed to create, and
/// it is the next tidy-up rather than a decision.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.location, required this.child});

  /// The location currently displayed, handed down by the `ShellRoute` builder.
  ///
  /// 🔴 PASSED IN, NEVER LOOKED UP, AND THAT IS NOT A STYLE PREFERENCE.
  /// `GoRouterState.of(context)` here registers this element as a DEPENDENT of
  /// `InheritedGoRouter`, and go_router disposes that element across a route
  /// change while the shell is still mounted. MEASURED on a stamped probe
  /// 2026-09-04: `'_dependents.isEmpty': is not true`, **73 throws in one run
  /// and 37 property tests red**, every one of them a screen that had nothing
  /// to do with navigation. The `ShellRoute` builder is handed `state` already,
  /// so the lookup buys nothing and costs that.
  ///
  /// ⚠️ go_router's own `example/lib/shell_route.dart:155` does use
  /// `GoRouterState.of(context)` inside the shell widget — which is where the
  /// first version of this came from. The sample's shell is the ROOT of its
  /// app and never sits under routes that come and go; this one does.
  final String location;

  /// The routed screen. In a `ShellRoute` this is the builder's `child`.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    // NOT static const: labels are localised, so they need a BuildContext.
    // [pipeline C-12] A const list cannot read l10n, and an unlocalised nav bar
    // is the most visible untranslated surface in the app.
    final AppLocalizations l10n = AppLocalizations.of(context);
    return NavShell(
      // The ROUTER is the single source of truth for which tab is lit. The
      // predecessor kept an `int _index` in this widget's State, so the URL and
      // the highlight were two facts that could disagree — and did: tapping
      // Settings both navigated AND set the index, on a body that never
      // switched on it.
      //
      // `state.uri.path` and not `matchedLocation`: `.path` drops the query, so
      // a gate's `?next=…` cannot change which tab is lit. It arrives as a
      // parameter rather than being read here — see [location] for the
      // measurement that forced that.
      currentLocation: location,
      tabs: <NavTab>[
        NavTab(
          destination: AppDestination(
            icon: Icons.home_outlined,
            selectedIcon: Icons.home,
            label: l10n.navHome,
          ),
          location: '/',
          onSelected: () => context.go('/'),
        ),
        NavTab(
          destination: AppDestination(
            icon: Icons.explore_outlined,
            selectedIcon: Icons.explore,
            label: l10n.navExplore,
          ),
          location: '/explore',
          onSelected: () => context.go('/explore'),
        ),
        // 🔴 THE SETTINGS DESTINATION NAVIGATES, AND NOW IT SURVIVES DOING SO.
        // Before 2026-08-01 `onDestinationSelected` only ever set an index, so
        // the Settings tab was decorative: every screen the settings register
        // row claims (profile, appearance, language, reminders, legal,
        // sign-out, delete account) sat behind a `/settings` route that NO
        // control in the chassis navigated to. `assert-screen-set.mjs` passed
        // throughout, because its `reachable` check asks whether the ROUTE
        // exists.
        //
        // That fix made the tab work and made it a trapdoor — `context.go` from
        // a bar that lived inside the home route tore the bar down on arrival.
        // The bar is now above the routes rather than inside one, so the same
        // call keeps it.
        //
        // ⚠️ THE `context.go('/settings')` LITERAL IS LOAD-BEARING TO A GUARD.
        // `assert-purchase-path.mjs:369-378` builds the navigation graph — and
        // from it the ROSCA subscribe/cancel step counts — out of
        // `context.go('…')` calls found in the file each route builds. Spelling
        // the destination per tab rather than indexing a locations table keeps
        // "Settings is one tap from Home" a MEASURED fact rather than a
        // description of one.
        NavTab(
          destination: AppDestination(
            icon: Icons.settings_outlined,
            selectedIcon: Icons.settings,
            label: l10n.navSettings,
          ),
          location: '/settings',
          // `/manage-plan` is Settings' screen, not a tab of its own: it is
          // reached from the settings register row and it is where cancelling
          // happens. Declaring the ownership is what keeps the Settings tab lit
          // while the user is on it — see `NavTab.alsoOwns`.
          alsoOwns: const <String>['/manage-plan'],
          onSelected: () => context.go('/settings'),
        ),
      ],
      child: child,
    );
  }
}

/// The home destination: the chassis's own surface, plus the two things that
/// sit above it.
///
/// ⚠️ THE BANNER AND THE PROMO CARD ARE HOME'S NOW, AND THEY USED TO BE THE
/// SHELL'S. They were stacked in the [AppScaffold] body, so they rendered on
/// the Explore tab too. The shell now spans Settings and the CANCELLATION
/// screen as well, and an upgrade promotion above "cancel my plan" is the one
/// placement this repo would have to answer for. They follow the surface they
/// belong to rather than the chrome they happened to live in.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // The app bar is the SCREEN's, not the shell's: `AppScaffold` renders one
    // of its own when given a `title`, and a shell title over a screen title is
    // two stacked bars at every width. Same division apps/subly settled on.
    return Scaffold(
      appBar: AppBar(title: const Text(AppConfig.appName)),
      body: Column(
        children: <Widget>[
          // [pipeline T-8] The OTHER half of the reminder promise. Above the
          // paywall gate on purpose: a nudge the user paid to see is not a nudge.
          const CatchUpNudgeBanner(),
          // [research/44 §7 rung 3] The same-app upgrade card. ABOVE the paywall
          // gate for the same reason and by the same rule: it is the surface the
          // banner beside it already established, and a promotion the user paid
          // to escape is not a promotion. It renders NOTHING until
          // `features.promo_card_enabled` arrives true — which it never does in
          // a fresh stamp — so being born with it costs an app that runs no
          // campaign exactly one collapsed `SizedBox.shrink()`.
          const UpgradePromoCard(),
          const Expanded(child: WelcomePanel()),
        ],
      ),
    );
  }
}

/// The EXPLORE destination — the chassis's premium surface.
///
/// Gating one destination rather than the whole app is deliberate: a paywall a
/// user meets before they have seen anything is a wall, and it is also the
/// shape that makes the activation number meaningless.
///
/// 🔴 [pipeline 5]M-5 — THE GATE, AND ITS FIRST REAL CONSUMER.
///
/// `PaywallGate` shipped in the design system and was referenced by exactly one
/// widget test and one comment: a fail-closed seam with no proven open path,
/// which is the [pipeline C-6] shape in its purest form. This screen is the
/// open path. `paywallLockedProvider` resolves from the SERVER's entitlement
/// read (via the cache, with the M-8 staleness ceiling applied), so what
/// unlocks this surface is a row somebody paid for and nothing else.
///
/// A stamped app with `paywall.enabled: false` — which is the default — locks
/// nothing, so being born with the gate costs a fresh app nothing.
///
/// ⚠️ THE LOCK USED TO READ `_index == 1 && locked`, i.e. the gate was decided
/// by a TAB INDEX held in the home screen's State. It is now decided by the
/// route being on screen at all, which is the same rule with nothing to
/// disagree with it. `apps/subly` reached the identical shape from the other
/// direction (`_GatedInsights`, `lib/core/router/shell.dart:78`).
///
/// It shows [WelcomePanel] because the chassis ships exactly one content
/// surface — which is what the tab showed before this change too. A stamped app
/// replaces this body with its own; the gate around it is the part the chassis
/// is giving it.
class ExploreScreen extends ConsumerWidget {
  const ExploreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.navExplore)),
      body: PaywallGate(
        locked: ref.watch(paywallLockedProvider),
        onUpgrade: () => context.go('/paywall'),
        title: l10n.paywallHeadline,
        message: l10n.paywallGateMessage,
        upgradeLabel: l10n.paywallUpgrade,
        child: const WelcomePanel(),
      ),
    );
  }
}

/// The chassis's one content surface: the brand mark and the two lines a fresh
/// stamp greets its first user with.
///
/// Public, and shared by [HomeScreen] and [ExploreScreen], because it is
/// exactly what both showed before the shell split them apart — the tab index
/// changed the GATE, never the body. Keeping one widget keeps that true rather
/// than leaving two copies to drift.
class WelcomePanel extends StatelessWidget {
  const WelcomePanel({super.key});

  @override
  Widget build(BuildContext context) {
    final AppThemeX tokens = Theme.of(context).extension<AppThemeX>()!;
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              gradient: tokens.brandGradient,
              borderRadius: BorderRadius.circular(AppRadius.lg),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(l10n.welcomeTo(AppConfig.appName), style: AppText.title),
          const SizedBox(height: AppSpacing.xs),
          Text(l10n.homeTagline, style: AppText.muted),
        ],
      ),
    );
  }
}

/// The in-app catch-up nudge — [pipeline T-8].
///
/// 🔴 WHY IT EXISTS AND WHY IT IS PERMANENT. Three of the six platforms cannot
/// schedule a repeating local notification, and **no version of the pinned
/// plugin family changes that**: its own limitations text records that Windows
/// throws on repeating notifications, Linux has no scheduler API, and browsers
/// support neither scheduled nor repeating ones. Web is the only live platform
/// today. The settings screen is already honest about it — it refuses to offer a
/// switch it cannot honour — and this is the half that actually delivers
/// something: the next time the app is opened after the reminder's moment has
/// passed, say so, once.
///
/// It is the humblest mechanism that works, on purpose: no background work, no
/// polling, no wake-up the OS refuses to grant, and nothing that needs a server.
///
/// ⚠️ IT RESPECTS THE OPT-OUT. An in-app banner is still a notification, so
/// [core.CatchUpNudge] refuses when reminders are off — routing around the
/// switch is precisely what the switch exists to prevent.
class CatchUpNudgeBanner extends ConsumerWidget {
  const CatchUpNudgeBanner({this.clock, super.key});

  /// Injectable ONLY so the due/not-due boundary is reachable from a test: a
  /// test process cannot choose what `DateTime.now()` reports, so a widget test
  /// on the real clock would assert nothing for twenty hours of every day and
  /// then start failing at 20:00. Same reasoning as `DeviceUtcOffset` in
  /// `packages/notifications`, and the same reason the decision itself is pure.
  final DateTime Function()? clock;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(
      defaultTargetPlatform,
      isWeb: kIsWeb,
    );
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DateTime now = (clock ?? DateTime.now)();
    final core.CatchUpNudgeVerdict verdict = const core.CatchUpNudge().decide(
      now: now,
      lastShownAt: ref.watch(catchUpNudgeProvider),
      reminderHour: AppConfig.reminderHour,
      reminderMinute: AppConfig.reminderMinute,
      remindersEnabled: ref.watch(remindersEnabledProvider),
      platformCanSchedule: caps.canSchedule,
    );
    if (verdict != core.CatchUpNudgeVerdict.show) {
      return const SizedBox.shrink();
    }
    final ThemeData theme = Theme.of(context);
    return MaterialBanner(
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      leading: const Icon(Icons.notifications_active_outlined),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(l10n.catchUpTitle, style: theme.textTheme.titleSmall),
          Text(l10n.catchUpBody, style: theme.textTheme.bodySmall),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () =>
              ref.read(catchUpNudgeProvider.notifier).markShown(now),
          child: Text(l10n.catchUpDismiss),
        ),
      ],
    );
  }
}

/// The SAME-APP upgrade card — [research/44 §7 rung 3].
///
/// 🔴 SAME-APP IS THE WHOLE DECLARATION ARGUMENT, NOT A PRODUCT CHOICE. This
/// card promotes the app the user is already inside. Google Play's third
/// ads-declaration trigger — the one that needs no SDK — is worded *"House ads:
/// My app renders a small ad banner, interstitial ad, ad wall, and/or widget"*
/// **to promote my other apps**, and this matches none of the three, so no ads
/// label and no "Contains ads" badge follow from it (research/44 V2). The
/// cross-app version is a SEPARATE component with a SEPARATE config key,
/// deferred until app #2 exists (rung 6); the two may never share a widget or a
/// flag, because their declaration consequences differ.
///
/// ## What it reads, and what each read is for
/// * `features.promo_card_enabled` — the on-switch. **Absent reads FALSE**
///   (`AppConfig.feature`'s `orElse`), so a stamped app that has never reached
///   the network shows nothing. This is the state of every app in the portfolio
///   today.
/// * `AppConfig.copy` — the words, so a campaign is a config edit and not a
///   release. Falls back to l10n and **never to the key**: `AppConfig.text`
///   returns the key itself when unset, and a fresh stamp has no overrides, so
///   a purely config-driven card would greet its first user with
///   `promo.card.title`. Same trap, same fix, as the onboarding carousel.
/// * `flags.promo_card_variant` — which wording this install sees, bucketed on
///   the SAME `installIdProvider` value the analytics cohort uses. Two
///   independently minted ids makes every experiment permanently unanalysable.
/// * the rail's `Offering` — the price, DERIVED. There is no price literal in
///   this file and `tooling/ci/assert-no-price-literals.mjs` fails the build if
///   one appears.
/// * `PurchaseRail.canStartCheckout` — whether to offer to sell at all. False
///   on `ios-appstore`, `macos-appstore` and `android-play` (ADR 039 D3 ·
///   research/44 V13), where the card still renders and simply carries no buy
///   button. Steering to an external checkout on those three is a documented
///   rejection cause.
/// * `paywallLockedProvider` — a user who has already paid is not promoted to.
///   The rule the `CatchUpNudgeBanner` beside it established, applied to money:
///   a nudge the user paid to see is not a nudge.
///
/// ## What it deliberately does NOT do
/// **It opens no URL.** The buy control navigates to `/paywall`, which is where
/// the ONE hosted rail lives; every offer link therefore resolves to the apex
/// buy surface (ADR 038) through the merchant of record this portfolio is
/// locked to. A second checkout — a `pay.rev.cat` link, a per-app subdomain,
/// anything this widget launched itself — would be a second merchant of record
/// with its own VAT/GST posture (research/44 V14). `assert-purchase-path.mjs`
/// fails the build if this file grows a launcher.
///
/// **It emits no impression or click event.** research/44 §4.4 is explicit that
/// v1 ships UNMEASURED and that this is the one irreversible decision in the
/// programme: the locked taxonomy carries no cross-promo event, adding one
/// takes a portfolio session-capacity cut of 25–50% against the binding D1
/// rows-written ceiling, and the choice is owner decision D6. So the variant is
/// resolved with the PURE `core.resolveFlag` rather than through
/// `featureFlagsProvider`, whose `ObservedFeatureFlags` wrapper would emit
/// `variant_exposed` on first read. That read is a genuine gap and it is
/// PRINTED on every run by `assert-flag-exposure.mjs` rather than left to be
/// discovered — when D6 says measure, this line moves to the observed reader
/// and the guard's ceiling comes back down.
class UpgradePromoCard extends ConsumerStatefulWidget {
  const UpgradePromoCard({this.clock, super.key});

  /// Injectable ONLY so the cooldown boundary is reachable from a test — a test
  /// process cannot choose what `DateTime.now()` reports. Same reasoning as
  /// [CatchUpNudgeBanner]'s, and the same reason `core.PromoGate` takes `now`.
  final DateTime Function()? clock;

  @override
  ConsumerState<UpgradePromoCard> createState() => _UpgradePromoCardState();
}

class _UpgradePromoCardState extends ConsumerState<UpgradePromoCard> {
  /// 🔴 THE DECISION IS LATCHED FOR THE LIFE OF THIS PRESENTATION, AND WITHOUT
  /// IT THE CARD DELETES ITSELF ON THE FRAME AFTER IT APPEARS.
  ///
  /// `PromoGate.decide` is pure and idempotent, and the impression is recorded
  /// by PERSISTING its returned state. That write republishes
  /// `promoCardStateProvider`, which rebuilds this widget, which re-decides —
  /// now from a record that says "shown just now" — and gets
  /// `shownTooRecently`. So a card that correctly decided to show would vanish
  /// within one frame, on every device, and nothing about the gate or the
  /// persistence would look wrong.
  bool _showing = false;

  /// The app's override for [key], then its variant override, then the chassis
  /// default.
  ///
  /// Empty is treated as absent: a config shipping `""` is a config somebody
  /// half-edited, and a blank card is worse than the default one.
  String _copy(core.AppConfig? cfg, String key, {required String fallback}) {
    final String? override = cfg?.copy[key];
    return (override == null || override.trim().isEmpty) ? fallback : override;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
    // ── THE HYDRATION BARRIER, AND IT IS THE FIRST DECISION FOR A REASON
    // 🔴 A RECORD WE HAVE NOT READ YET IS NOT A RECORD THAT SAYS "NOBODY
    // OBJECTED". The first version of this widget read a SYNCHRONOUS
    // `PromoGateState` that started at the empty default and hydrated behind
    // it, so a device holding `"suppressed": true` was shown a promotional
    // card for the whole duration of the disk read — measured on the real
    // tree at t+0, t+5, t+10 and t+20 ms against a 40 ms store, off screen
    // only by t+60. Nothing failed, because every widget test in this repo
    // calls `pumpAndSettle()` first and that is exactly the window being
    // skipped. Art 21(3) — "the personal data shall no longer be processed
    // for such purposes" — has no grace period in it, so neither does this.
    //
    // `valueOrNull == null` states the rule ONCE for both shapes of
    // not-knowing — still reading, and could not read — which is the whole
    // reason the controller is an `AsyncNotifier`: a barrier that lives in the
    // TYPE cannot be forgotten by the next caller of this provider.
    final core.PromoGateState? stored = ref
        .watch(promoCardStateProvider)
        .valueOrNull;
    if (stored == null) return const SizedBox.shrink();

    // ── THE SECOND HALF OF THE SAME BARRIER — THE CONSENT RAIL ─────────────
    // `PromoGateState.suppressed` is a PROJECTION of `ConsentPurpose.promo`,
    // never an independent fact (`PromoObjection`'s library comment). So the
    // record above is only half the input: a person who objected on this
    // device, or whose browser is sending a GPC signal this session, is
    // "objected" whether or not the latch on disk has caught up. Reading the
    // record without the rail is the two-stores defect — both halves report
    // healthy while the card keeps rendering to somebody who exercised an
    // absolute right to stop it (Art 21(2)/(3)).
    //
    // Same fail-closed shape as the record barrier immediately above, and for
    // the same measured reason: a rail we have not finished reading is not a
    // rail that says nobody objected.
    final core.ConsentController? consent = ref
        .watch(consentControllerProvider)
        .valueOrNull;
    if (consent == null) return const SizedBox.shrink();

    // ── THE LATCHES OUTRANK THE LATCH ──────────────────────────────────────
    // Checked before `_showing`, deliberately: a dismissal or a GDPR Art 21
    // objection raised while the card is on screen must take it off the screen,
    // not wait for the next launch. Art 21(3) — "the personal data shall no
    // longer be processed for such purposes" — has no grace period in it.
    if (stored.dismissed || stored.suppressed) return const SizedBox.shrink();

    // A user who has already paid is not promoted to. `paywallLockedProvider`
    // is only meaningful for an app that HAS a paywall; for one that sells
    // nothing it is false for everyone, which must not read as "everybody has
    // paid".
    if ((cfg?.paywall.enabled ?? false) && !ref.watch(paywallLockedProvider)) {
      return const SizedBox.shrink();
    }

    final PurchaseRail rail = ref.watch(purchaseRailProvider);
    final List<Offering> offerings = rail.offerings;

    if (!_showing) {
      // 🔴 THROUGH `PromoObjection`, NEVER STRAIGHT AT THE GATE. It projects
      // the rail onto the record first and cannot be skipped — a GPC objection
      // (Art 21(5)) writes no artifact at all and reaches the gate by no other
      // route. `assert-consent-withdrawal-surface.mjs` limb 5 fails the build
      // for any `.decide(` on a promo gate whose expression does not name it.
      final core.PromoGateDecision decision = core.PromoObjection(consent)
          .decide(
            ref.watch(promoGateProvider),
            stored,
            now: (widget.clock ?? DateTime.now)(),
            featureEnabled: cfg?.feature(kPromoCardFeature) ?? false,
            // 🔴 THE [pipeline C-6] LIMB. An eligible user and nothing to
            // promote is `nothingToShow`, not `show` — research/44's
            // DO-NOT-BUILD list opens with the empty portfolio directory:
            // "wired, guarded, green and useless". A card with no price to
            // quote is that shape one size down.
            hasContent: offerings.isNotEmpty,
          );
      if (!decision.show) return const SizedBox.shrink();
      _showing = true;
      // Persisted on RENDER, not on decide. The gate is pure, so the write is
      // the moment of truth — and it is deferred to after this frame because a
      // provider mutation during build is a rebuild inside a build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(promoCardStateProvider.notifier).markShown(decision.state);
      });
    }

    // Belt and braces after the latch: a config that loses its offerings mid
    // session leaves nothing to quote, and `offerings.first` on an empty list
    // is a crash on the home screen.
    if (offerings.isEmpty) return const SizedBox.shrink();
    // The rail's OWN order, the same order the paywall lists them in. Picking
    // "the cheapest" would need a currency comparison this repo cannot make —
    // amounts are minor units of whatever currency the rail sent.
    final Offering offering = offerings.first;

    // ── THE VARIANT ────────────────────────────────────────────────────────
    // Absent id (the disk read has not landed) or absent flag ⇒ variant A.
    // Never a coin flip: `resolveFlag` is deterministic per install, so a user
    // does not see a different card on every launch.
    final String? installId = ref.watch(installIdProvider).valueOrNull;
    final bool variantB =
        installId != null &&
        core.resolveFlag(
          flag: kPromoCardVariantFlag,
          rolloutPercent: cfg?.rolloutPercent(kPromoCardVariantFlag) ?? 0,
          stableId: installId,
        );
    final String suffix = variantB ? '.b' : '';

    String copy(String key, String fallback) => _copy(
      cfg,
      'promo.card.$key$suffix',
      fallback: _copy(cfg, 'promo.card.$key', fallback: fallback),
    );

    final bool canSell = rail.canStartCheckout;

    // ── THE FRAME, AND THE CREATIVE INSIDE IT ──────────────────────────────
    // `PromoSurface` carries the two things that attach to the FIRST
    // promotional communication and that a creative increment forgets because
    // they are not part of the creative: the promotional label (Apple 2.5.18 ·
    // Microsoft 10.10.4 · Play's native-ads trigger · India's Disguised
    // Advertisement) and the Art 21(4) on-card objection, "presented clearly
    // and separately", where somebody meeting their first offer will actually
    // see it. It offers no constructor argument that switches either off, so
    // the card cannot render without them — which is the whole reason it is a
    // frame rather than two more parameters on `PromoCard`.
    return PromoSurface(
      show: true,
      objected: ref.watch(promoObjectedProvider),
      onObjectionChanged: (bool objected) =>
          recordPromoObjection(ref, objected: objected),
      promotionalLabel: l10n.promoLabel,
      stopLabel: l10n.promoStopOffers,
      resumeLabel: l10n.promoResumeOffers,
      objectedNotice: l10n.promoOffersOff,
      child: PromoCard(
        show: true,
        label: copy('label', l10n.promoCardLabel),
        title: copy('title', l10n.promoCardTitle),
        message: copy('body', l10n.promoCardBody),
        // DERIVED from the rail's own amount and currency. Absolute, always: no
        // percentage, no "was", no countdown — see the class doc and
        // research/44 V6.
        priceLabel: l10n.promoCardPrice(
          offering.formattedPrice,
          offering.term.wire,
        ),
        primaryActionLabel: canSell ? l10n.paywallUpgrade : null,
        onPrimaryAction: canSell ? () => context.go('/paywall') : null,
        // 🔒 ROSCA PARITY, IN THIS CARD, NOT A LEVEL DOWN. `PromoCard` makes
        // both of these `required`, so a promo surface that offers a way to
        // start paying and no equally-adjacent way to stop does not compile —
        // and `assert-purchase-path.mjs` asserts this file really navigates to
        // the cancel surface, because a required callback can still be `() {}`.
        manageLabel: l10n.managePlanTitle,
        onManageAction: () => context.go('/manage-plan'),
        // Neutral decline copy. "Not now" — never "No thanks, I don't want to
        // save", which is the confirm-shaming India's CCPA Dark Patterns
        // Guidelines 2023 name outright.
        dismissLabel: l10n.notNow,
        onDismiss: () => ref.read(promoCardStateProvider.notifier).dismiss(),
        dismissSemanticLabel: l10n.promoCardDismissA11y,
      ),
    );
  }
}
