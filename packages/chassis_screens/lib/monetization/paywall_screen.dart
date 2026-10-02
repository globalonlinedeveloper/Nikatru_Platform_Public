import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// What the paywall is currently doing. [pipeline 5]M-6's "purchase states".
///
/// 🏗️ MOVED OUT OF THE BRICK BY [ADR 067] decision 2, AND THE ADAPTER STILL
/// SPELLS IT `_PaywallPhase`. `tooling/screen-register.json`'s
/// `monetization.purchase-states` row proves reachability with the literal
/// `_PaywallPhase.pending` READ IN THE BRICK FILE, and the reachability limb of
/// `assert-screen-set.mjs` (`:428`) reads that one file WITHOUT following the
/// delegation — deliberately, because "somebody can get to it" is a claim about
/// the stamped app. So the brick keeps `typedef _PaywallPhase = PaywallPhase;`
/// and there is still exactly ONE enum: an alias, not a copy. A second
/// five-value enum kept in step by hand is the drift this package exists to
/// remove.
///
/// ## The three states this screen exists to keep apart
/// A hosted checkout returns the buyer to the app the instant they press pay,
/// and the merchant of record's notification reaches our server some time after
/// that. So between the two there is a real window in which the user HAS paid
/// and the server does NOT know.
///
///   · **opening**  — we handed the purchase to the rail: a hosted page to the
///                    browser, or the store's own sheet ([PaywallCheckoutStyle]).
///   · **pending**  — they came back, we asked the server, it does not see it
///                    yet. This is NOT a failure and must never be worded as
///                    one: it is somebody's money in flight.
///   · **unlocked** — the server confirmed. Only this state grants anything.
enum PaywallPhase { choosing, opening, pending, unlocked, refused }

/// Which in-flight sentence the opening state shows: the rail's kind, reduced
/// to the one distinction the copy needs.
///
/// 🔴 A CHASSIS-OWNED VALUE, NOT `PurchaseRailKind`. This package's pubspec
/// allows no purchases dependency, so the adapter maps the rail's kind onto
/// this. [hosted] names the browser, because the page opens outside the app;
/// [store] names neither the web nor a browser, because a store build that
/// points its buyer at an outside checkout breaks that store's billing rule.
enum PaywallCheckoutStyle { hosted, store }

/// Where the buyer cancels the plan they are about to buy — the sentence the
/// terms line ends with. ⏱ 2026-10-01 · MO-04: it read "in Settings" on every
/// rail, which is false on a store build, where only the store can stop a store
/// subscription. The adapter picks it from the rail's kind; a store build never
/// names the web, and a hosted build never names a store.
enum PaywallCancelWhere {
  /// Our own cancel, in this app's Manage plan screen (the hosted rail).
  here,

  /// Apple's App Store (iOS and the Mac App Store).
  appStore,

  /// Google Play.
  googlePlay,
}

/// What a refused checkout shows. Both offer Try again ([PaywallView.onRetry]).
///
/// The adapter reduces a refusal's route to this. A cancel never gets here (it
/// returns to the plans) and a signed-out buyer is sent to sign-in, so only the
/// two sentences a buyer can be SHOWN remain.
enum PaywallRefusalView {
  /// The checkout did not open, the rail was not ready, or the account had not
  /// reached the store yet: a second try may well work.
  retryable,

  /// The store refused, or this platform cannot take a purchase. Still offers
  /// Try again, and says truthfully that buying is not available here.
  unavailable,
}

/// One purchasable plan, as the PAINTER needs it.
///
/// 🔴 PLAIN VALUES, NOT `Offering`. `nikatru_purchases` is the purchase SEAM,
/// and this package's pubspec records the standing rule that a screen body here
/// takes values and callbacks so the seam stays in the adapter. [formattedPrice]
/// keeps the field NAME `Offering.formattedPrice` carries, because
/// `assert-no-price-literals.mjs:371` looks for `.formattedPrice` over the
/// adapter UNIONED with this file and a renamed field would read as a paywall
/// that shows no rail-derived price at all — the one conclusion that limb exists
/// to make loud.
///
/// ⚠️ THERE IS NO `amount` AND NO `currency` FIELD, ON PURPOSE. A screen that
/// could format a price could also format the WRONG one; the string arrives
/// already derived from the rail's own amount + ISO currency by
/// `Offering.formattedPrice`, which is what [pipeline 5]M-11 asks for.
@immutable
class PaywallOffer {
  const PaywallOffer({
    required this.id,
    required this.formattedPrice,
    required this.term,
    this.trial,
  });

  /// The rail's product id — passed back through [PaywallView.onBuy] so the
  /// adapter can find the `Offering` this row was rendered from.
  final String id;

  /// Already formatted from an amount and an ISO currency by the rail.
  final String formattedPrice;

  /// The billing term's wire code (`month` or `year`), rendered through l10n
  /// as ONE whole sentence per term. ⏱ 2026-10-01 · MO-04: this used to be
  /// spliced into "Billed per {term}", so Tamil showed the English wire token
  /// mid-sentence. A term with no sentence (a one-time plan, which never reaches
  /// an app — `RailConfig.fromPaywallExtra`) draws no line rather than a code.
  final String term;

  /// The free trial, or null when the plan has none.
  ///
  /// A COUNT AND A UNIT, NOT A DAY COUNT. A store sells "1 month free", and a
  /// month is not a fixed number of days, so the row says what the seller says.
  /// The unit is a wire code (`day`, `week`, `month`, `year`) rendered through
  /// l10n. ONE nullable value rather than a count defaulting to 0 beside a unit
  /// defaulting to a word: "no trial" is then unrepresentable as "0 days", and
  /// no English default sits in the widget for the hardcoded-string guard to find.
  final ({int count, String unit})? trial;
}

/// One line of what a plan includes, as the PAINTER needs it (train ST-D9).
///
/// 🔴 ALREADY LOCALISED, AND CHOSEN BY THE ADAPTER FROM CONFIG. Which features
/// Pro adds is a product decision that moves without a release (the D-11
/// ruling: sync is free, Pro is plan and save), so the adapter reads the codes
/// from the served `paywall` block and resolves each through the app's own
/// catalogue. A feature list typed into this package would be one app's
/// pitch shipped to every stamp.
@immutable
class PaywallFeature {
  const PaywallFeature({required this.icon, required this.title, this.body});

  /// A decorative glyph; excluded from semantics, the words carry it.
  final IconData icon;

  /// The feature, in a few words.
  final String title;

  /// One sentence saying what it does for the user, or null.
  final String? body;
}

/// The paywall — [pipeline 5]M-6, and the consumer `PaywallGate` never had.
///
/// 🏗️ THE BODY OF `PaywallScreen`, MOVED HERE BY [ADR 067] decision 2. The
/// brick keeps an adapter of the same name: the phase machine, the funnel
/// emissions, `PurchaseRail.startCheckout` and the bounded convergence wait all
/// need a `WidgetRef` or a `GoRouter`, and this package declares neither.
///
/// The screen never grants access on its own, and it never spins: the poller is
/// bounded by the adapter and lands in a stated terminal state, which arrives
/// here as a [PaywallPhase].
///
/// ## ⏱ 2026-09-29 · train ST-D9: drawn on the ST-D0 foundation
///  * **What Pro adds, then the plans, then the terms** — [proFeatures] and
///    [freeFeatures] are the adapter's, from config; an empty list draws no
///    section, so the brick (which passes neither) keeps a plans-only paywall.
///  * **A plan is an [AppCard]**: the rail's price as the figure (tabular), the
///    billing term under it and its own Upgrade control — one tap from the
///    plan to its checkout, as before.
///  * **The in-flight and terminal phases are [DecisionStrip]s** on an opaque
///    status tint: pending is a warning, never a failure; unlocked is good
///    news; a refusal is a warning with Try again as its one answer.
///  * **From [AppBreakpoints.expanded] up, two columns** — the features beside
///    the plans, capped at [wideMaxWidth] — when there are features to show.
///    Below that, one column at [AppBreakpoints.pane], as before.
///  * **No trial copy unless [showTrial]** (the D-25 ruling): a configured
///    trial on an offering is not a promise until the store sells it, so the
///    trial wording of a plan's term and of the terms line stays behind the
///    adapter's config flag.
///
/// ⚠️ [pipeline C-13] THE WORDING of the pending state is a `human` decision. A
/// green lane here proves the mechanism, not the copy.
class PaywallView extends StatelessWidget {
  const PaywallView({
    required this.phase,
    required this.offers,
    required this.canStartCheckout,
    required this.checkoutStyle,
    required this.refusalView,
    required this.onBuy,
    required this.onCheckAgain,
    required this.onGoHome,
    required this.onRetry,
    this.onBack,
    this.proFeatures = const <PaywallFeature>[],
    this.freeFeatures = const <PaywallFeature>[],
    this.showTrial = false,
    this.loadingOffers = false,
    this.offline = false,
    this.onReconnect,
    this.cancelWhere = PaywallCancelWhere.here,
    this.onRestore,
    this.restoring = false,
    this.onOpenTerms,
    this.onOpenPrivacy,
    this.onOpenEula,
    super.key,
  });

  /// The upgrade control on a plan row. One per offer, so a width test can find
  /// the row it measured.
  static const Key upgradeButton = Key('paywallUpgrade');

  /// "Check again" — the only control the pending state offers.
  static const Key checkAgainButton = Key('paywallCheckAgain');

  /// The way out once the server has confirmed.
  static const Key goHomeButton = Key('paywallGoHome');

  /// "Try again" — the control every refusal the buyer is shown offers.
  static const Key tryAgainButton = Key('paywallTryAgain');

  /// A plan's card, by the rail's product id — the width and golden anchor.
  static Key offerCard(String id) => ValueKey<String>('paywallOffer.$id');

  /// The "What Pro adds" card.
  static const Key featuresCard = Key('paywallFeatures');

  /// The terms line ABOVE the plans: how it renews and where it is cancelled.
  static const Key termsLine = Key('paywallTerms');

  /// The store-compliance links under the plans (MO-03).
  static const Key restoreLink = Key('paywallRestore');
  static const Key termsLink = Key('paywallTermsLink');
  static const Key privacyLink = Key('paywallPrivacyLink');
  static const Key eulaLink = Key('paywallEulaLink');

  /// The live region that announces each phase change (MO-08).
  static const Key phaseRegion = Key('paywallPhase');

  /// The widest the two-column layout grows: two panes and the gap between.
  static const double wideMaxWidth = AppBreakpoints.pane * 2 + AppSpacing.xl;

  final PaywallPhase phase;

  /// The plans, already formatted. Empty is a real state and is rendered as
  /// "unavailable" rather than as an empty list — unless [loadingOffers].
  final List<PaywallOffer> offers;

  /// Whether the rail can open a checkout on THIS platform at all.
  final bool canStartCheckout;

  /// The in-flight sentence the opening state shows.
  final PaywallCheckoutStyle checkoutStyle;

  /// The sentence the refused state shows. A refusal's engineering `detail` is
  /// not a field here ON PURPOSE: it is English and names mechanisms, so the
  /// adapter sends it to the log and the buyer is shown one of these.
  final PaywallRefusalView refusalView;

  final void Function(PaywallOffer offer) onBuy;
  final VoidCallback onCheckAgain;
  final VoidCallback onGoHome;

  /// Leaves a refusal for the plans, so a purchase can be started again.
  final VoidCallback onRetry;

  /// ST-U2 (audit C34): the way OFF the paywall. Every entry is a `go` onto a
  /// root route, so there is nothing to pop and a bare AppBar draws no arrow —
  /// a user whose rail sells nothing was trapped. Null draws none.
  final VoidCallback? onBack;

  /// What a plan adds, already localised and chosen from config by the
  /// adapter. Empty draws no features card.
  final List<PaywallFeature> proFeatures;

  /// What stays free without a plan. Drawn under [proFeatures], so a buyer
  /// sees what they are NOT being asked to pay for.
  final List<PaywallFeature> freeFeatures;

  /// Whether a trial may be worded at all (D-25). False draws every plan as
  /// its plain term and the plain terms line, whatever [PaywallOffer.trial]
  /// says.
  final bool showTrial;

  /// The rail has not answered yet (a store rail before the store has been
  /// asked). Draws placeholders where the plans go, not "unavailable".
  final bool loadingOffers;

  /// The last request could not reach the network. Draws a warning above the
  /// plans; the plans stay usable, because the signal is a past failure and
  /// the checkout is the rail's to refuse.
  final bool offline;

  /// The offline warning's Retry, or null for none.
  final VoidCallback? onReconnect;

  /// Where the buyer cancels — the end of the terms line.
  final PaywallCancelWhere cancelWhere;

  /// ⏱ 2026-10-01 · MO-03 — THE LINKS A STORE REVIEWER LOOKS FOR, each drawn
  /// only when its callback is given, so the brick's plans-only paywall is
  /// unchanged until its adapter opts in. Restore is the adapter's
  /// `restorePurchasesOf` + server re-read (Apple 3.1.1 makes it mandatory on a
  /// StoreKit build); Terms and Privacy open the app's legal pages through its
  /// `ExternalLinkLauncher`; [onOpenEula] is Apple's standard EULA, passed only
  /// on an Apple rail (Apple requires a link to the terms of use for an
  /// auto-renewable subscription).
  final VoidCallback? onRestore;
  final VoidCallback? onOpenTerms;
  final VoidCallback? onOpenPrivacy;
  final VoidCallback? onOpenEula;

  /// ⏱ 2026-10-01 · review 1 of #1114: a restore is in flight. Restore stays
  /// drawn and is DISABLED, so a second tap cannot start a second store ask —
  /// the same busy rule as Manage plan's controls.
  final bool restoring;

  /// The only phase in which there is anything to pitch: plans on screen.
  bool get _choosingWithPlans =>
      phase == PaywallPhase.choosing && canStartCheckout && offers.isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);
    final List<Widget> body = _body(context, l10n, theme);
    // ⏱ 2026-10-01 · MO-08: the in-flight and terminal phases (opening →
    // pending → unlocked / refused) are a LIVE REGION, so a screen reader hears
    // the purchase move on without hunting for what changed. The choosing phase
    // is not: a list of plans announcing itself on every repaint is noise.
    final List<Widget> plans = phase == PaywallPhase.choosing
        ? body
        : <Widget>[
            Semantics(
              key: phaseRegion,
              container: true,
              liveRegion: true,
              child: _column(body),
            ),
          ];
    final Widget? features = _choosingWithPlans ? _features(l10n, theme) : null;

    return Scaffold(
      appBar: AppBar(
        leading: onBack == null ? null : BackButton(onPressed: onBack),
        title: Text(l10n.paywallTitle),
      ),
      // 🔴 THE `Center` IS GONE, AND THIS IS THE SCREEN THAT NAMES THE BUG.
      // `_body` returns a DIFFERENT NUMBER OF WIDGETS per [PaywallPhase] —
      // choosing, opening, pending, unlocked, refused — so the ListView's
      // extent changes every time the phase does. Under a `Center`, that
      // re-centres the whole scroller: press "Buy" and the plan list you were
      // looking at slides, for a reason the user did not cause. Pinned to the
      // top it stays where it was and only the new rows appear. `.pane` is the
      // 480 the brick file used to hold privately.
      //
      // ⏱ ST-D9: the two-column decision reads the width the BODY was given,
      // not the window — the body is what the columns must fit, and beside a
      // navigation rail it is narrower than the window by the rail. It is read
      // OUTSIDE the `ContentPane`, whose cap would otherwise answer for it.
      body: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints body) {
          final bool wide =
              features != null && body.maxWidth >= AppBreakpoints.expanded;
          return ContentPane(
            maxWidth: wide ? wideMaxWidth : AppBreakpoints.pane,
            child: ListView(
              padding: const EdgeInsets.all(AppSpacing.xl),
              shrinkWrap: true,
              children: <Widget>[
                const _Emblem(icon: Icons.workspace_premium_outlined),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  l10n.paywallHeadline,
                  style: theme.textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.xl),
                if (wide)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(child: features),
                      const SizedBox(width: AppSpacing.xl),
                      Expanded(child: _column(plans)),
                    ],
                  )
                else ...<Widget>[
                  if (features != null) ...<Widget>[
                    features,
                    const SizedBox(height: AppSpacing.xl),
                  ],
                  ...plans,
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  static Widget _column(List<Widget> children) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    mainAxisSize: MainAxisSize.min,
    children: children,
  );

  Widget? _features(ChassisLocalizations l10n, ThemeData theme) {
    if (proFeatures.isEmpty && freeFeatures.isEmpty) return null;
    final ColorScheme scheme = theme.colorScheme;
    return AppCard(
      key: featuresCard,
      child: _column(<Widget>[
        if (proFeatures.isNotEmpty) ...<Widget>[
          Semantics(
            container: true,
            header: true,
            child: Text(l10n.paywallProAdds, style: theme.textTheme.titleSmall),
          ),
          for (final PaywallFeature f in proFeatures) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            _FeatureLine(feature: f, tone: scheme.primary, emphasis: true),
          ],
        ],
        if (proFeatures.isNotEmpty && freeFeatures.isNotEmpty) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          const Divider(height: 1),
          const SizedBox(height: AppSpacing.lg),
        ],
        if (freeFeatures.isNotEmpty) ...<Widget>[
          Semantics(
            container: true,
            header: true,
            child: Text(
              l10n.paywallAlwaysFree,
              style: theme.textTheme.titleSmall,
            ),
          ),
          for (final PaywallFeature f in freeFeatures) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            _FeatureLine(
              feature: f,
              tone: StatusTones.forBrightness(theme.brightness).positive,
              emphasis: false,
            ),
          ],
        ],
      ]),
    );
  }

  /// Restore, Terms, Privacy and (on an Apple rail) the EULA, as a wrap of
  /// text buttons under the plans. Each is drawn only when its callback is.
  List<Widget> _links(ChassisLocalizations l10n) {
    final List<Widget> links = <Widget>[
      if (onRestore != null)
        TextButton(
          key: restoreLink,
          onPressed: restoring ? null : onRestore,
          child: Text(l10n.restorePurchases),
        ),
      if (onOpenTerms != null)
        TextButton(
          key: termsLink,
          onPressed: onOpenTerms,
          child: Text(l10n.termsOfService),
        ),
      if (onOpenEula != null)
        TextButton(
          key: eulaLink,
          onPressed: onOpenEula,
          child: Text(l10n.paywallAppleEula),
        ),
      if (onOpenPrivacy != null)
        TextButton(
          key: privacyLink,
          onPressed: onOpenPrivacy,
          child: Text(l10n.privacyPolicy),
        ),
    ];
    if (links.isEmpty) return const <Widget>[];
    return <Widget>[
      Wrap(
        alignment: WrapAlignment.center,
        spacing: AppSpacing.sm,
        children: links,
      ),
    ];
  }

  List<Widget> _body(
    BuildContext context,
    ChassisLocalizations l10n,
    ThemeData theme,
  ) {
    switch (phase) {
      case PaywallPhase.opening:
        return <Widget>[
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: AppSpacing.lg),
          Text(
            switch (checkoutStyle) {
              PaywallCheckoutStyle.hosted => l10n.paywallOpeningHosted,
              PaywallCheckoutStyle.store => l10n.paywallOpeningStore,
            },
            style: theme.textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ];
      case PaywallPhase.pending:
        return <Widget>[
          // 🔴 NEVER THE WORD "FAILED", AND NEVER THE DANGER TONE. The user
          // may well have paid.
          DecisionStrip(
            kind: StatusKind.warn,
            message: l10n.paywallPending,
            actions: <DecisionAction>[
              DecisionAction(
                key: checkAgainButton,
                label: l10n.paywallCheckAgain,
                onPressed: onCheckAgain,
                primary: true,
              ),
            ],
          ),
        ];
      case PaywallPhase.unlocked:
        return <Widget>[
          DecisionStrip(
            kind: StatusKind.positive,
            message: l10n.paywallUnlocked,
            actions: <DecisionAction>[
              DecisionAction(
                key: goHomeButton,
                label: l10n.goHome,
                onPressed: onGoHome,
                primary: true,
              ),
            ],
          ),
        ];
      case PaywallPhase.refused:
        // A sentence the buyer can act on, and the control to act with. The
        // refusal's engineering reason is logged by the adapter and never
        // painted: it is English on a Tamil screen, and on a store build it
        // could name the web.
        return <Widget>[
          DecisionStrip(
            kind: StatusKind.warn,
            message: switch (refusalView) {
              PaywallRefusalView.retryable => l10n.paywallRetryMessage,
              PaywallRefusalView.unavailable => l10n.paywallUnavailable,
            },
            actions: <DecisionAction>[
              DecisionAction(
                key: tryAgainButton,
                label: l10n.paywallTryAgain,
                onPressed: onRetry,
                primary: true,
              ),
            ],
          ),
        ];
      case PaywallPhase.choosing:
        // NOT gated on [canStartCheckout]: a store rail answers false until
        // its plans arrive, which is exactly the window this state is for.
        if (loadingOffers && offers.isEmpty) {
          // ST-U7 (C38)'s anchor, kept: the "still being asked" state is found
          // by the same key the spinner it replaced carried.
          return <Widget>[
            SkeletonList(
              key: PlansLoading.loadingKey,
              label: l10n.paywallLoadingPlans,
              rows: 2,
            ),
          ];
        }
        if (!canStartCheckout || offers.isEmpty) {
          return <Widget>[
            Text(
              l10n.paywallUnavailable,
              style: theme.textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
          ];
        }
        final bool anyTrial =
            showTrial && offers.any((PaywallOffer o) => o.trial != null);
        // ⏱ 2026-10-01 · MO-04: the terms line sits ABOVE the plans, so the
        // buyer reads how it renews and where it is cancelled BEFORE the
        // control that buys it — not under the last Upgrade, where it was.
        final String cancelSentence = switch (cancelWhere) {
          PaywallCancelWhere.here => l10n.paywallCancelHere,
          PaywallCancelWhere.appStore => l10n.paywallCancelInAppStore,
          PaywallCancelWhere.googlePlay => l10n.paywallCancelInGooglePlay,
        };
        return <Widget>[
          Text(
            '${anyTrial ? l10n.paywallTermsTrial : l10n.paywallTerms} '
            '$cancelSentence',
            key: termsLine,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.lg),
          if (offline) ...<Widget>[
            DecisionStrip(
              kind: StatusKind.warn,
              message: l10n.offlineMessage,
              actions: <DecisionAction>[
                if (onReconnect != null)
                  DecisionAction(label: l10n.retry, onPressed: onReconnect!),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
          ],
          for (final PaywallOffer o in offers) ...<Widget>[
            _PlanCard(
              key: offerCard(o.id),
              offer: o,
              showTrial: showTrial,
              onBuy: () => onBuy(o),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          ..._links(l10n),
        ];
    }
  }
}

/// The round badge above the headline: the scheme's primary container, so it
/// follows the app's seed in both schemes.
class _Emblem extends StatelessWidget {
  const _Emblem({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return ExcludeSemantics(
      child: Center(
        child: Container(
          width: AppSpacing.xxxl + AppSpacing.lg,
          height: AppSpacing.xxxl + AppSpacing.lg,
          decoration: BoxDecoration(
            color: scheme.primaryContainer,
            shape: BoxShape.circle,
          ),
          child: Icon(
            icon,
            size: AppSpacing.xxl,
            color: scheme.onPrimaryContainer,
          ),
        ),
      ),
    );
  }
}

/// One feature: a glyph in [tone], the title, and an optional sentence. The
/// text WRAPS — a feature cut off at an ellipsis is a promise half-made.
///
/// Each line is its own semantics node, not a merged pair: a merged label is
/// both lines joined, which no single `Text` matches, so the text-contrast
/// guideline would stop measuring either (see the manage-plan status card).
class _FeatureLine extends StatelessWidget {
  const _FeatureLine({
    required this.feature,
    required this.tone,
    required this.emphasis,
  });

  final PaywallFeature feature;
  final Color tone;

  /// Title weight: a Pro feature is the pitch, a free one is reassurance.
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        ExcludeSemantics(
          child: Icon(feature.icon, color: tone, size: AppSpacing.xl),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Semantics(
                container: true,
                child: Text(
                  feature.title,
                  style: emphasis
                      ? theme.textTheme.titleMedium
                      : theme.textTheme.bodyMedium,
                ),
              ),
              if (feature.body != null)
                Semantics(
                  container: true,
                  child: Text(
                    feature.body!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// One plan: the rail's price as the figure, the billing term under it, and
/// the control that opens THIS plan's checkout.
class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.offer,
    required this.showTrial,
    required this.onBuy,
    super.key,
  });

  final PaywallOffer offer;
  final bool showTrial;
  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);
    const List<FontFeature> tabular = <FontFeature>[
      FontFeature.tabularFigures(),
    ];
    final ({int count, String unit})? trial = showTrial ? offer.trial : null;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // 🔒 [pipeline 5]M-11. FORMATTED FROM THE RAIL'S OWN AMOUNT AND
          // CURRENCY. There is no price literal anywhere in this file, and
          // `tooling/ci/assert-no-price-literals.mjs` fails the build if
          // one appears — in the adapter or here.
          Text(
            offer.formattedPrice,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontFeatures: tabular,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          if (_termLine(l10n, offer.term, trial) case final String line)
            Text(
              line,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          const SizedBox(height: AppSpacing.lg),
          FilledButton(
            key: PaywallView.upgradeButton,
            onPressed: onBuy,
            child: Text(l10n.paywallUpgrade),
          ),
        ],
      ),
    );
  }
}

/// One whole sentence per billing term, or null for a term with none — never
/// the wire code spliced into a sentence (MO-04: Tamil showed `month`).
String? _termLine(
  ChassisLocalizations l10n,
  String term,
  ({int count, String unit})? trial,
) => switch ((term, trial)) {
  ('month', null) => l10n.paywallTermMonthly,
  ('year', null) => l10n.paywallTermYearly,
  ('month', final ({int count, String unit}) t) =>
    l10n.paywallTermMonthlyWithTrial(t.count, t.unit),
  ('year', final ({int count, String unit}) t) =>
    l10n.paywallTermYearlyWithTrial(t.count, t.unit),
  _ => null,
};

/// Asks for a paywall's plans once, and tells its [builder] whether the
/// question is still open — ST-U7 (C38).
///
/// A store rail's plans are EMPTY until the store answers, and a paywall that
/// reads that as "Purchases are not available here." says something false for
/// the first second or more of every open. [load] is the adapter's refresh
/// (for a web rail, whose plans are its config, it completes at once), asked
/// for here so an open paywall shows today's price and this buyer's trial.
/// [changes] repaints the paywall when a store rail's plans arrive or change;
/// a web rail's never do.
class PlansLoadGate extends StatefulWidget {
  const PlansLoadGate({
    required this.load,
    required this.builder,
    this.changes,
    super.key,
  });

  final Future<void> Function() load;
  final Listenable? changes;
  final Widget Function(BuildContext context, bool loading) builder;

  @override
  State<PlansLoadGate> createState() => _PlansLoadGateState();
}

class _PlansLoadGateState extends State<PlansLoadGate> {
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    widget.load().whenComplete(() {
      if (mounted) setState(() => _loading = false);
    });
  }

  @override
  Widget build(BuildContext context) => widget.changes == null
      ? widget.builder(context, _loading)
      : ListenableBuilder(
          listenable: widget.changes!,
          builder: (BuildContext context, Widget? _) =>
              widget.builder(context, _loading),
        );
}

/// The paywall's "plans are still being asked for" state: a spinner whose
/// [label] a screen reader announces.
class PlansLoading extends StatelessWidget {
  const PlansLoading({required this.label, super.key});

  final String label;

  static const Key loadingKey = Key('paywall-offerings-loading');

  @override
  Widget build(BuildContext context) => Center(
    key: loadingKey,
    child: CircularProgressIndicator(semanticsLabel: label),
  );
}
