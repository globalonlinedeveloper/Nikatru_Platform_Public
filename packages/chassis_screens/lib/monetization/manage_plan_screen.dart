import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// Manage subscription — [pipeline 5]M-9 (ROSCA) and [pipeline 5]M-10 (restore).
///
/// 🏗️ THE BODY OF `ManagePlanScreen`, MOVED HERE BY [ADR 067] decision 2. The
/// brick keeps an adapter of the same name: the confirm dialog, the
/// `PurchaseRail.requestCancellation()` call, the entitlement re-read and the
/// navigation all need a `WidgetRef` or a `GoRouter`, and this package declares
/// neither.
///
/// ## Why cancelling is ONE screen and ONE confirm, and why that number matters
/// ROSCA's rule is that cancelling must be no harder than subscribing. Buying is
/// Settings → Upgrade → pick a plan: the checkout opens on the third tap.
/// Cancelling is Settings → Manage → Cancel → confirm. The counts are derived
/// from the ROUTER by `tooling/ci/assert-purchase-path.mjs`, from the same
/// navigation source as the purchase count, so the two cannot drift apart by
/// somebody counting them differently.
///
/// ⚠️ CANCELLING DURING THE TRIAL is the path regulators scrutinise hardest, and
/// it is the same path: nothing here branches on whether the subscription is in
/// its trial. That is deliberate — a separate trial-cancel flow is a second
/// thing to get wrong, and the trial case is covered by the same test set.
///
/// 🔴 THE FIVE LABELS ARE PARAMETERS, NOT `l10n.` READS, AND THAT IS NOT A
/// PREFERENCE. `managePlanTitle`, `plan{Active,Inactive}`, `cancelPlan` and
/// `restorePurchasesHint` live in the APP's `.arb`, not in the chassis
/// catalogue, so a package that read them would be reading a file no package can
/// see. [outcomeMessage] arrives already resolved for the same reason: two of
/// its four sentences are app-owned.
///
/// ## ⏱ 2026-09-29 · train ST-D9: drawn on the ST-D0 foundation
///  * **The plan is a status card** ([AppCard]): a glyph, [planStatusLabel]
///    and an optional [planDetail] line — the server's answer, in words.
///  * **The controls are [AppListRow]s in one card**, in ROSCA order: the way
///    to a plan (free users only, and only when the adapter passes
///    [onUpgrade]), Restore, and Cancel (an active plan only). Still one tap
///    each; [restoreHint] sits under the card rather than in a one-line row,
///    because a hint cut at an ellipsis explains nothing.
///  * **The outcome is a [DecisionStrip]** in [outcomeKind]'s tone, so "your
///    cancellation is recorded, not yet executed" never reads as good news.
///  * **Loading, load failed and offline are states, not blanks** — a
///    skeleton where the plan goes, a retryable failure, a warning strip —
///    and in none of them does Restore go away: a user who cannot see their
///    plan is exactly the user who needs it.
/// Where the user PAID for the plan this screen manages, as the painter needs
/// it. ⏱ 2026-10-01 · MO-05, AB-M4-03-client. Chassis-owned, like
/// `PaywallCheckoutStyle`: this package may not depend on `nikatru_purchases`,
/// so the adapter maps the entitlement's `BillingSource` onto this.
enum PlanSourceView {
  /// Our own hosted checkout: cancelled here, through our own cancel route.
  web,

  /// Apple's App Store: cancelled there, never here.
  appStore,

  /// Google Play: cancelled there, never here.
  googlePlay;

  /// Whether this screen's own Cancel can stop the plan.
  bool get cancelsHere => this == PlanSourceView.web;
}

class ManagePlanView extends StatelessWidget {
  const ManagePlanView({
    required this.title,
    required this.isPro,
    required this.planStatusLabel,
    required this.restoreHint,
    required this.cancelLabel,
    required this.busy,
    required this.onBack,
    required this.onRestore,
    required this.onCancel,
    this.outcomeMessage,
    this.outcomeKind,
    this.planDetail,
    this.upgradeLabel,
    this.onUpgrade,
    this.loading = false,
    this.onReload,
    this.offline = false,
    this.onReconnect,
    this.source,
    this.periodEnds,
    this.onManageInStore,
    super.key,
  }) : assert(
         (upgradeLabel == null) == (onUpgrade == null),
         'the way to a plan needs both its words and its action',
       );

  /// "Manage in the App Store" / "Manage in Google Play" — the row that
  /// REPLACES Cancel when the plan was bought in a store.
  static const Key manageInStoreTile = Key('managePlanManageInStore');

  /// The [pipeline 5]M-10 control. Named so a width case can find it.
  static const Key restoreTile = Key('managePlanRestore');

  /// The ROSCA cancel entry — one tap from here, one confirm after it.
  static const Key cancelTile = Key('managePlanCancel');

  /// The way to the plans, for a user without one.
  static const Key upgradeTile = Key('managePlanUpgrade');

  /// The plan's status card — the golden and e2e anchor.
  static const Key statusCard = Key('managePlanStatus');

  /// The outcome strip.
  static const Key outcomeStrip = Key('managePlanOutcome');

  final String title;

  /// Whether the SERVER says the plan is active right now.
  final bool isPro;

  /// The sentence for [isPro] — resolved by the adapter from the app's `.arb`.
  final String planStatusLabel;

  /// A second line under [planStatusLabel], or null.
  final String? planDetail;

  final String restoreHint;
  final String cancelLabel;

  /// The way to the plans for a user without one. Both or neither; the
  /// adapter passes neither where this build sells nothing.
  final String? upgradeLabel;
  final VoidCallback? onUpgrade;

  /// A request is in flight: every control is disabled and a bar is shown, so a
  /// second tap cannot start a second cancellation.
  final bool busy;

  /// Pop if there is somewhere to pop to, else go back to `/settings` — the
  /// origin `assert-purchase-path.mjs` measures the ROSCA cancel distance from.
  ///
  /// 🔴 AN EXPLICIT BACK CONTROL, BECAUSE THE AUTOMATIC ONE NEVER APPEARED.
  /// `AppBar` inserts a back button only when its `Navigator` can pop, and this
  /// screen is reached with `context.go` from the settings register row and from
  /// the promo card — `go` REPLACES the stack, so there was nothing to pop and
  /// no leading control was ever built. The result was a cancellation screen
  /// with no way out of it except the system Back gesture, which web and desktop
  /// do not reliably give: on the one screen whose whole job is "cancelling must
  /// be no harder than subscribing".
  ///
  /// `BackButton` rather than a hand-rolled `IconButton`: it carries the
  /// platform's own glyph and the tooltip/semantics label from
  /// `MaterialLocalizations`, so this adds no copy to the arb and is translated
  /// in every locale the app declares.
  final VoidCallback onBack;

  final VoidCallback onRestore;

  /// Opens the confirm, and only then calls the rail. Both halves stay in the
  /// adapter, where the provider container is.
  final VoidCallback onCancel;

  /// 🔒 FOUR OUTCOMES, FOUR SENTENCES, resolved by the adapter. Collapsing
  /// `recorded` into `executed` would have the app tell a user their
  /// subscription is cancelled on the strength of our having written down that
  /// they asked — while the merchant of record goes on billing them. That is the
  /// single most expensive sentence this screen could say.
  final String? outcomeMessage;

  /// The tone of [outcomeMessage]. Null is a warning: a sentence nobody
  /// graded is never drawn as good news.
  final StatusKind? outcomeKind;

  /// The plan has not been read yet: a placeholder where the status card goes.
  final bool loading;

  /// Non-null when the plan could NOT be read: the status card becomes a
  /// failure with this as its retry.
  final VoidCallback? onReload;

  /// The last request could not reach the network.
  final bool offline;

  /// The offline warning's Retry, or null for none.
  final VoidCallback? onReconnect;

  /// Where the active plan was bought — FROM THE ENTITLEMENT, not the build
  /// channel. Null when there is no active plan or it cannot be told; a null
  /// source keeps the screen's own Cancel, as before.
  final PlanSourceView? source;

  /// When the current paid period ends (the entitlement's expiry), or null.
  final DateTime? periodEnds;

  /// Opens the store's own subscriptions page. Drawn in place of Cancel when
  /// [source] is a store: 🔴 a store purchase NEVER posts our cancel route,
  /// which cannot stop a subscription only the store bills.
  final VoidCallback? onManageInStore;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: onBack),
        title: Text(title),
      ),
      // Bare `Scaffold` + `ListView` before this, the same shape as settings —
      // and this is the WORSE of the two to leave unconstrained. The screen
      // whose only job is "cancel must be no harder than subscribe" was, on a
      // desktop, a cancel row whose label sat a full window away from the icon
      // that identifies it. ROSCA is a rule about the difficulty of finding the
      // control, and layout is part of how hard something is to find.
      //
      // ⏱ ST-D9: `reading` (720), the cap the shipping app already chose for
      // this screen — a page of controls, and a narrower one is easier to scan.
      body: ContentPane.reading(
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[
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
            // ST-U7 (C42)'s anchors, kept: "still asking" and "could not ask"
            // are found by the keys [PlanStatusTile] gives the same two states.
            if (loading)
              SkeletonList(
                key: PlanStatusTile.checkingKey,
                label: l10n.managePlanLoading,
                rows: 1,
              )
            else if (onReload != null)
              KeyedSubtree(
                key: PlanStatusTile.failedKey,
                child: DataStateView.failed(
                  title: l10n.managePlanLoadFailed,
                  retryLabel: l10n.retry,
                  onRetry: onReload!,
                ),
              )
            else
              _StatusCard(
                key: statusCard,
                isPro: isPro,
                label: planStatusLabel,
                details: <String>[
                  ?planDetail,
                  if (isPro)
                    ?switch (source) {
                      PlanSourceView.web => l10n.planBoughtOnWeb,
                      PlanSourceView.appStore => l10n.planBoughtInAppStore,
                      PlanSourceView.googlePlay => l10n.planBoughtInGooglePlay,
                      null => null,
                    },
                  if (isPro && periodEnds != null)
                    l10n.planPeriodEnds(periodEnds!),
                ],
              ),
            const SizedBox(height: AppSpacing.lg),
            // [pipeline 5]M-10. `onRestore` is the adapter's `_restore`: it asks
            // the rail first (the store, on a store build — Apple guideline 3.1.1
            // makes this control mandatory there), then re-reads the server,
            // whose entitlement row keyed (user_id, app_id) is the only unlock.
            // On a rail with no store the server re-read is the whole restore.
            // This view holds no rail call: package-boundaries limb C keeps
            // `nikatru_purchases` out of it.
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (!isPro && onUpgrade != null) ...<Widget>[
                    AppListRow(
                      key: upgradeTile,
                      title: upgradeLabel!,
                      leading: const Icon(Icons.workspace_premium_outlined),
                      onTap: busy ? null : onUpgrade,
                    ),
                    const Divider(height: 1),
                  ],
                  AppListRow(
                    key: restoreTile,
                    title: l10n.restorePurchases,
                    leading: const Icon(Icons.refresh),
                    showChevron: false,
                    onTap: busy ? null : onRestore,
                  ),
                  // ⏱ 2026-10-01 · MO-05: cancel WHERE THE USER PAID. A
                  // store plan gets the store's own page and no Cancel; our
                  // Cancel stays for a web plan (and an unknown source).
                  if (isPro && !(source?.cancelsHere ?? true)) ...<Widget>[
                    if (onManageInStore != null) ...<Widget>[
                      const Divider(height: 1),
                      AppListRow(
                        key: manageInStoreTile,
                        title: source == PlanSourceView.googlePlay
                            ? l10n.manageInGooglePlay
                            : l10n.manageInAppStore,
                        leading: const Icon(Icons.open_in_new),
                        onTap: busy ? null : onManageInStore,
                      ),
                    ],
                  ] else if (isPro) ...<Widget>[
                    const Divider(height: 1),
                    AppListRow(
                      key: cancelTile,
                      title: cancelLabel,
                      leading: const Icon(Icons.cancel_outlined),
                      showChevron: false,
                      onTap: busy ? null : onCancel,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Text(
                restoreHint,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            if (busy) ...<Widget>[
              const SizedBox(height: AppSpacing.lg),
              const LinearProgressIndicator(),
            ],
            if (outcomeMessage != null) ...<Widget>[
              const SizedBox(height: AppSpacing.lg),
              DecisionStrip(
                key: outcomeStrip,
                kind: outcomeKind ?? StatusKind.warn,
                message: outcomeMessage!,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// What a plan-status row can truthfully say — ST-U7 (C42).
///
/// "You do not have a plan" is an ANSWER, and it was shown while the
/// entitlement was still loading and when it could not be fetched: a paying
/// user saw themselves as unpaid on every slow open. [checking] and [failed]
/// are states of the question, never answers to it.
enum PlanStatus {
  checking,
  failed,
  active,
  inactive;

  /// The status of an entitlement read. [loaded] wins over [failed], so a
  /// refresh that fails keeps the last answer on screen.
  static PlanStatus of({
    required bool loaded,
    required bool failed,
    required bool pro,
  }) {
    if (loaded) return pro ? PlanStatus.active : PlanStatus.inactive;
    return failed ? PlanStatus.failed : PlanStatus.checking;
  }
}

/// The words a [PlanStatusTile] shows, handed in by the app — none is
/// defaulted to English.
class PlanStatusLabels {
  const PlanStatusLabels({
    required this.active,
    required this.inactive,
    required this.checking,
    required this.failed,
    required this.retry,
  });
  final String active;
  final String inactive;
  final String checking;
  final String failed;
  final String retry;
}

/// The plan-status row in each of [PlanStatus]'s four states. The failed
/// state carries [onRetry]; the checking state a labelled spinner.
class PlanStatusTile extends StatelessWidget {
  const PlanStatusTile({
    required this.status,
    required this.labels,
    required this.onRetry,
    super.key,
  });

  final PlanStatus status;
  final PlanStatusLabels labels;
  final VoidCallback onRetry;

  static const Key checkingKey = Key('manage-plan-status-loading');
  static const Key failedKey = Key('manage-plan-status-failed');
  static const Key answerKey = Key('manage-plan-status');

  @override
  Widget build(BuildContext context) => switch (status) {
    PlanStatus.checking => ListTile(
      key: checkingKey,
      leading: const SizedBox.square(
        dimension: 24,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
      title: Text(labels.checking),
    ),
    PlanStatus.failed => ListTile(
      key: failedKey,
      leading: const Icon(Icons.cloud_off),
      title: Text(labels.failed),
      trailing: TextButton(onPressed: onRetry, child: Text(labels.retry)),
    ),
    PlanStatus.active || PlanStatus.inactive => ListTile(
      key: answerKey,
      leading: Icon(
        status == PlanStatus.active
            ? Icons.verified_outlined
            : Icons.lock_outline,
      ),
      title: Text(
        status == PlanStatus.active ? labels.active : labels.inactive,
      ),
    ),
  };
}

/// The plan, as the server last reported it: a glyph tile, the status sentence
/// and an optional detail line.
///
/// 🔴 EACH LINE IS ITS OWN SEMANTICS NODE, ON PURPOSE. Merged, the node's label
/// is both lines joined, `find.text` matches no single `Text`, and flutter_test's
/// text-contrast guideline silently stops measuring the status sentence — the
/// app's manage-plan contrast sweep went red on exactly that. Two stops for a
/// screen reader is the price of a sentence whose contrast is still checked.
class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.isPro,
    required this.label,
    required this.details,
    super.key,
  });

  final bool isPro;
  final String label;

  /// The lines under the label: what the plan does, where it was bought, when
  /// the period ends. Each its own semantics node (see the feature lines).
  final List<String> details;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final StatusTones tones = StatusTones.of(context);
    return AppCard(
      child: Row(
        children: <Widget>[
          ExcludeSemantics(
            child: Container(
              width: AppListRow.leadingSize,
              height: AppListRow.leadingSize,
              decoration: BoxDecoration(
                color: isPro
                    ? tones.positiveTint
                    : scheme.surfaceContainerHighest,
                shape: BoxShape.circle,
              ),
              child: Icon(
                isPro ? Icons.verified_outlined : Icons.lock_outline,
                color: isPro ? tones.positive : scheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Semantics(
                  container: true,
                  child: Text(label, style: theme.textTheme.titleMedium),
                ),
                for (final String detail in details) ...<Widget>[
                  const SizedBox(height: AppSpacing.xs),
                  Semantics(
                    container: true,
                    child: Text(
                      detail,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
