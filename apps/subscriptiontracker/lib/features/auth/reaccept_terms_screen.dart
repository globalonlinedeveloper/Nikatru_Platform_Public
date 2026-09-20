import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/auth/reaccept_terms_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import 'legal_consent_fields.dart';

/// The MATERIAL-CHANGE re-acceptance interstitial — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 067] decision 2 /
/// [ADR 071]), and the consent flag went with the box it belongs to:
/// `assert-signup-consent-shape.mjs` reads this surface as its own code UNIONED
/// with the chassis file it delegates to, so the unticked `_accepted`
/// initialiser is still asserted — where it now lives.
///
/// ⚠️ AND THE DECLARATION IS DELIBERATELY NOT QUOTED VERBATIM ABOVE. Naming it
/// in prose here would leave the exact bytes
/// `tooling/ci/test/signup-consent-shape.test.mjs` mutates sitting in a comment
/// the guard strips before matching — so a mutation aimed at the flag would
/// land in this doc, change nothing the guard reads, and report the guard as
/// broken when it is not. That decoy cost a false red on 2026-09-20; the
/// land-check in that file's `edit` helper is what caught it, and the case now
/// mutates the chassis file where the flag actually lives.
///
/// ⏱ 2026-09-20 · [ADR 086] ONE PIECE AT A TIME — the first whole SCREEN of
/// `tooling/chassis-parity.json`'s smallest-first plan for this app to be
/// adopted (the plan's smaller first entry, check_inbox, was built, measured and
/// then DEFERRED; that row says why, and it is a guard-test reason rather than a
/// screen one). The measured before/after is in that row's `adopted` entry, not
/// here, because a line count written in prose is a measurement that stopped
/// being taken. The
/// strings are the same strings (`reacceptTermsTitle` / `reacceptTermsBody` /
/// `reacceptTermsAccept` are byte-identical in `chassis_en.arb` /
/// `chassis_ta.arb` and `app_en.arb` / `app_ta.arb`), all three key constants
/// forward to the same literals, and the app's own [LegalConsentFields] stays
/// MOUNTED, so the published URLs and the `url_launcher` call still live here.
///
/// 🔴 THE DECLINE PATH GOES THROUGH [signOutAndForgetUser], AND THAT IS WHY IT
/// STAYED HERE. This was `ref.read(authRepositoryProvider).signOut()`, so the
/// entitlement cache and the notification schedule survived it — and this is
/// the sign-out a PAYING user is most likely to reach, because a `kTermsVersion`
/// bump puts this interstitial in front of every signed-in account in the world
/// and Decline is the only way past it that is not "agree".
///
/// ⚠️ THE UNKNOWN-ERROR FALLBACK IS RE-RAISED HERE RATHER THAN LOST. The chassis
/// view renders `'$e'` for a non-[core.AuthFailure] throw, because the chassis
/// owns no generic auth string; this app has one (`authUnknownError`) and
/// rendered it before this move. Wrapping the throw as a [core.AuthFailure]
/// with that message lands it on the view's `on core.AuthFailure` branch, so the
/// inline notice reads exactly what it read before — a behaviour PRESERVED, not
/// a behaviour the delegation quietly dropped.
class ReacceptTermsScreen extends ConsumerWidget {
  const ReacceptTermsScreen({super.key});

  static const Key acceptButton = ReacceptTermsView.acceptButton;
  static const Key signOutButton = ReacceptTermsView.signOutButton;
  static const Key statusLine = ReacceptTermsView.statusLine;

  @override
  Widget build(BuildContext context, WidgetRef ref) => ReacceptTermsView(
    // `acceptTermsOnly`, never `accept(marketingEmail: false)`: this screen
    // shows no marketing box, so it must not speak for that decision.
    // Recording a fresh `granted: false` marketing artifact would silently
    // unsubscribe somebody for accepting a terms change.
    onAccept: () =>
        ref.read(legalAcceptanceProvider.notifier).acceptTermsOnly(),
    onSignOut: () async {
      // Read BEFORE the await, never across it. `flutter_lints`' `flutter.yaml`
      // — which `packages/analysis` includes, so every app and every stamp
      // inherits it — carries `use_build_context_synchronously`, and a context
      // read in the catch arm is exactly the gap it names.
      final String unknown = AppLocalizations.of(context).authUnknownError;
      try {
        await signOutAndForgetUser(ref);
      } on core.AuthFailure {
        rethrow;
      } catch (_) {
        throw core.AuthFailure(unknown);
      }
    },
    // This app's own consent widget, still MOUNTED — it owns the published URLs
    // and the platform call that opens them, and the chassis view owns the
    // flag. `showMarketing: false`: this screen re-takes the TERMS and nothing
    // else, so it must not speak for a marketing decision.
    consentFields:
        ({
          required bool termsAccepted,
          required bool marketingAccepted,
          required bool enabled,
          required ValueChanged<bool> onTermsChanged,
          required ValueChanged<bool> onMarketingChanged,
        }) => LegalConsentFields(
          termsAccepted: termsAccepted,
          marketingAccepted: marketingAccepted,
          enabled: enabled,
          showMarketing: false,
          onTermsChanged: onTermsChanged,
          onMarketingChanged: onMarketingChanged,
        ),
  );
}
