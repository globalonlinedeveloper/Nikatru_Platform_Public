import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ContentPane;

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import 'legal_consent_fields.dart';

/// The MATERIAL-CHANGE re-acceptance interstitial (research/43, adopted as an
/// auth-increment rider by the owner on 2026-08-09 night).
///
/// Shown when `kTermsVersion` / `kPrivacyPolicyVersion` have moved past the
/// stamp the user accepted. The router puts them here and nothing else is
/// reachable until they accept — which is why the screen is deliberately small:
/// it states what changed, links the live documents, takes one affirmative act,
/// and offers a way out that is not "agree".
///
/// 🔴 RE-ACCEPTANCE IS NOT A VERSION BUMP. Both constants are hand-edited and
/// moving either one puts this screen in front of every signed-in user in the
/// world. That is the mechanism working; it is also why a wording tidy-up must
/// not touch them.
///
/// 🔴 THE TICK ARRIVES UNTICKED HERE TOO. Carrying the previous acceptance
/// forward as a pre-ticked box would make the "acceptance" a re-render of a
/// decision taken against a document that no longer exists — the same
/// Planet49/EDPB objection as any other pre-ticked consent, and the whole
/// reason this screen is being shown at all.
///
/// ⚠️ THE MARKETING BOX IS ABSENT ON PURPOSE (`showMarketing: false`). Asking
/// for a marketing opt-in on a screen the user cannot leave is exactly the
/// conditionality research/43 declined; their existing `marketing-email`
/// artifact stands untouched, whichever way it went.
class ReacceptTermsScreen extends ConsumerStatefulWidget {
  const ReacceptTermsScreen({super.key});

  static const Key acceptButton = Key('reacceptTermsAccept');
  static const Key signOutButton = Key('reacceptTermsSignOut');
  static const Key statusLine = Key('reacceptTermsStatus');

  @override
  ConsumerState<ReacceptTermsScreen> createState() =>
      _ReacceptTermsScreenState();
}

class _ReacceptTermsScreenState extends ConsumerState<ReacceptTermsScreen> {
  /// 🔴 FALSE, ALWAYS, AND `assert-signup-consent-shape.mjs` FAILS THE BUILD IF
  /// THIS LINE EVER SAYS OTHERWISE. A pre-ticked clickwrap is not consent in any
  /// market this ships to.
  bool _accepted = false;
  bool _busy = false;
  String? _notice;

  /// 🔴 THE DECLINE PATH IS AWAITED, HOLDS THE BUSY FLAG, AND SHOWS ITS OWN
  /// FAILURE — it used to be `onPressed: () => auth.signOut()` and none of the
  /// three. On a screen whose entire premise is that there is no other way out,
  /// a sign-out that throws became an unhandled async error and the user was
  /// left looking at a button that had visibly done nothing. `VerifyEmailScreen`
  /// routes the identical call through its `_run` for exactly this reason; this
  /// is the same treatment, kept local because this screen has one such action.
  ///
  /// Inline notice rather than a SnackBar, for the same reason as everywhere
  /// else in this flow: a SUCCESSFUL sign-out replaces this page via the
  /// router's gate, and a SnackBar riding on a page being torn down is a message
  /// nobody reads ([ADR 027]).
  Future<void> _signOut() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await ref.read(authRepositoryProvider).signOut();
    } on core.AuthFailure catch (e) {
      if (mounted) setState(() => _notice = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _notice = AppLocalizations.of(context).authUnknownError);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept() async {
    if (_busy || !_accepted) return;
    setState(() => _busy = true);
    try {
      // `marketingEmail: false` here does NOT withdraw an existing opt-in: this
      // screen never shows that box, so it must not speak for it. Recording a
      // fresh `granted: false` marketing artifact would silently unsubscribe
      // somebody for accepting a terms change — see the note on
      // [applyLegalAcceptance] about why the two decisions are separate
      // artifacts in the first place.
      await ref.read(legalAcceptanceProvider.notifier).acceptTermsOnly();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    // No `context.go` — the router's gate is what moves the user, and it re-runs
    // because `routerRefreshProvider` listens to the acceptance provider. A
    // navigation here would race that gate and could land on a screen the gate
    // is about to redirect away from.
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

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
              LegalConsentFields(
                termsAccepted: _accepted,
                marketingAccepted: false,
                enabled: !_busy,
                showMarketing: false,
                onTermsChanged: (bool v) => setState(() => _accepted = v),
                onMarketingChanged: (_) {},
              ),
              if (_notice != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _notice!,
                  key: ReacceptTermsScreen.statusLine,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
              const SizedBox(height: 20),
              // 🔴 DISABLED UNTIL TICKED. The tick is the affirmative act; a
              // button that works without it makes the box decorative, which is
              // the difference between a clickwrap and a notice.
              FilledButton(
                key: ReacceptTermsScreen.acceptButton,
                onPressed: (_busy || !_accepted) ? null : _accept,
                child: Text(l10n.reacceptTermsAccept),
              ),
              const SizedBox(height: 12),
              // Declining has to be possible, and it is signing out — not a
              // silent dismissal that leaves them using the product under terms
              // they refused.
              TextButton(
                key: ReacceptTermsScreen.signOutButton,
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
