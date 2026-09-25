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
    super.key,
  });

  /// The [pipeline 5]M-10 control. Named so a width case can find it.
  static const Key restoreTile = Key('managePlanRestore');

  /// The ROSCA cancel entry — one tap from here, one confirm after it.
  static const Key cancelTile = Key('managePlanCancel');

  final String title;

  /// Whether the SERVER says the plan is active right now.
  final bool isPro;

  /// The sentence for [isPro] — resolved by the adapter from the app's `.arb`.
  final String planStatusLabel;

  final String restoreHint;
  final String cancelLabel;

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

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;

    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: onBack), title: Text(title)),
      // Bare `Scaffold` + `ListView` before this, the same shape as settings —
      // and this is the WORSE of the two to leave unconstrained. The screen
      // whose only job is "cancel must be no harder than subscribe" was, on a
      // desktop, a cancel row whose label sat a full window away from the icon
      // that identifies it. ROSCA is a rule about the difficulty of finding the
      // control, and layout is part of how hard something is to find.
      //
      // Same default cap as settings, for the same reason: a page of controls,
      // agreeing with the ceiling `AppScaffold` already applies.
      body: ContentPane(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            ListTile(
              leading: Icon(isPro ? Icons.verified_outlined : Icons.lock_outline),
              title: Text(planStatusLabel),
            ),
            const Divider(),
            // [pipeline 5]M-10. `onRestore` is the adapter's `_restore`: it asks
            // the rail first (the store, on a store build — Apple guideline 3.1.1
            // makes this control mandatory there), then re-reads the server,
            // whose entitlement row keyed (user_id, app_id) is the only unlock.
            // On a rail with no store the server re-read is the whole restore.
            // This view holds no rail call: package-boundaries limb C keeps
            // `nikatru_purchases` out of it.
            ListTile(
              key: restoreTile,
              leading: const Icon(Icons.refresh),
              title: Text(l10n.restorePurchases),
              subtitle: Text(restoreHint),
              enabled: !busy,
              onTap: busy ? null : onRestore,
            ),
            if (isPro)
              ListTile(
                key: cancelTile,
                leading: const Icon(Icons.cancel_outlined),
                title: Text(cancelLabel),
                enabled: !busy,
                onTap: busy ? null : onCancel,
              ),
            if (busy) const LinearProgressIndicator(),
            if (outcomeMessage != null)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text(outcomeMessage!),
              ),
          ],
        ),
      ),
    );
  }
}
