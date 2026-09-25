import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'auth_error_text.dart';
import 'legal_consent_fields.dart';

/// The MATERIAL-CHANGE re-acceptance interstitial (research/43, adopted as an
/// auth-increment rider by the owner on 2026-08-09 night).
///
/// 🏗️ THE BODY OF `ReacceptTermsScreen`, MOVED HERE BY [ADR 067] decision 2 /
/// [ADR 071]. The consent FLAG lives here with the box it belongs to, and
/// `assert-signup-consent-shape.mjs` follows the delegation to find it — the
/// surface is read as the adapter's code UNIONED with this file, so limb 1
/// (the unticked `_accepted` initialiser) and limb 2 (the early-return guard
/// AND the button disable) are both asserted over exactly the text that decides
/// them.
///
/// Shown when `kTermsVersion` / `kPrivacyPolicyVersion` have moved past the
/// stamp the user accepted. The router puts them here and nothing else is
/// reachable until they accept — which is why the screen is deliberately small:
/// it states what changed, links the live documents, takes one affirmative act,
/// and offers a way out that is not "agree".
///
/// 🔴 RE-ACCEPTANCE IS NOT A VERSION BUMP. Both constants are hand-edited and
/// moving either one puts this screen in front of every signed-in user of every
/// stamped app. That is the mechanism working; it is also why a wording tidy-up
/// must not touch them.
///
/// 🔴 THE TICK ARRIVES UNTICKED HERE TOO. Carrying the previous acceptance
/// forward as a pre-ticked box makes the "acceptance" a re-render of a decision
/// taken against a document that no longer exists — the same Planet49/EDPB
/// objection as any other pre-ticked consent, and the whole reason this screen
/// is being shown at all.
///
/// ⚠️ THE MARKETING BOX IS ABSENT ON PURPOSE (`showMarketing: false`). Asking
/// for a marketing opt-in on a screen the user cannot leave is exactly the
/// conditionality research/43 declined; their existing `marketing-email`
/// artifact stands untouched, whichever way it went.
class ReacceptTermsView extends StatefulWidget {
  const ReacceptTermsView({
    required this.onAccept,
    required this.onSignOut,
    required this.consentFields,
    super.key,
  });

  static const Key acceptButton = Key('reacceptTermsAccept');
  static const Key signOutButton = Key('reacceptTermsSignOut');
  static const Key statusLine = Key('reacceptTermsStatus');

  /// Records the acceptance. `acceptTermsOnly` in the adapter, never
  /// `accept(marketingEmail: false)` — see there.
  final Future<void> Function() onAccept;

  /// Declining, which is signing out. Goes through the SPINE in the adapter.
  final Future<void> Function() onSignOut;

  /// Renders the tick boxes. The ADAPTER builds them, so the brick's own
  /// `LegalConsentFields` — which owns the published URLs and the platform call
  /// that opens them — stays mounted. See [ConsentFieldsBuilder].
  final ConsentFieldsBuilder consentFields;

  @override
  State<ReacceptTermsView> createState() => _ReacceptTermsViewState();
}

class _ReacceptTermsViewState extends State<ReacceptTermsView> {
  /// 🔴 FALSE, ALWAYS, AND `assert-signup-consent-shape.mjs` FAILS THE BUILD IF
  /// THIS LINE EVER SAYS OTHERWISE. A pre-ticked clickwrap is not consent in any
  /// market this factory ships to.
  bool _accepted = false;
  bool _busy = false;
  String? _notice;

  /// 🔴 THE DECLINE PATH IS AWAITED, HOLDS THE BUSY FLAG, AND SHOWS ITS OWN
  /// FAILURE — it was `onPressed: () => auth.signOut()` and none of the three.
  /// On a screen whose entire premise is that there is no other way out, a
  /// sign-out that throws became an unhandled async error and the user was left
  /// looking at a button that had visibly done nothing.
  ///
  /// Inline notice rather than a SnackBar: a SUCCESSFUL sign-out replaces this
  /// page via the router's gate, and a SnackBar riding on a page being torn
  /// down is a message nobody reads ([ADR 027]).
  Future<void> _signOut() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await widget.onSignOut();
    } catch (e) {
      // ⏱ 2026-09-24 — through the mapper, like every auth view. This was
      // `'$e'` "rather than a localized fallback" because the chassis had no
      // generic auth-error string; it has `authUnknownError` now, which the
      // shared mapper needed anyway, so that reason is gone.
      if (mounted) {
        setState(() => _notice = authErrorText(context.chassisL10n, e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept() async {
    if (_busy || !_accepted) return;
    setState(() => _busy = true);
    try {
      await widget.onAccept();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    // No navigation — the router's gate moves the user, and it re-runs because
    // `routerRefreshProvider` listens to the acceptance provider. Navigating
    // here would race that gate, which is also why this widget takes no
    // navigation callback at all.
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.reacceptTermsTitle),
        // No back button: there is nowhere behind this. The router put the user
        // here from wherever they were, and popping would return to a route the
        // gate immediately redirects out of.
        automaticallyImplyLeading: false,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                l10n.reacceptTermsBody,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 20),
              widget.consentFields(
                termsAccepted: _accepted,
                marketingAccepted: false,
                enabled: !_busy,
                onTermsChanged: (bool v) => setState(() => _accepted = v),
                onMarketingChanged: (_) {},
              ),
              if (_notice != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _notice!,
                  key: ReacceptTermsView.statusLine,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
              const SizedBox(height: 20),
              // 🔴 DISABLED UNTIL TICKED. The tick is the affirmative act; a
              // button that works without it makes the box decorative, which is
              // the difference between a clickwrap and a notice.
              FilledButton(
                key: ReacceptTermsView.acceptButton,
                onPressed: (_busy || !_accepted) ? null : _accept,
                child: Text(l10n.reacceptTermsAccept),
              ),
              const SizedBox(height: 12),
              // Declining has to be possible, and it is signing out — not a
              // silent dismissal that leaves them using the product under terms
              // they refused.
              TextButton(
                key: ReacceptTermsView.signOutButton,
                onPressed: _busy ? null : _signOut,
                child: Text(l10n.signOut),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
