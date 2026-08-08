import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_config.dart';
import '../../core/router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../l10n/app_localizations.dart';
import '../../state/analytics_providers.dart';
import '../shared/widgets.dart';

/// Wraps the app and asks the analytics-consent question exactly once, when it
/// has never been answered.
///
/// 🔑 THIS WIDGET IS THE ON-SWITCH FOR THE ENTIRE ANALYTICS RAIL. The recorder,
/// the transport, the Worker and the D1 table were all built and live-verified
/// before it existed — and because the recorder is fail-closed, every event was
/// silently discarded for want of one dialog. If this is ever removed, the rail
/// goes quiet again without a single test going red, which is why
/// `tooling/ci/assert-seams-wired.mjs` asserts a real call site for
/// `ConsentController.record` exists.
class ConsentGate extends ConsumerStatefulWidget {
  const ConsentGate({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<ConsentGate> createState() => _ConsentGateState();
}

class _ConsentGateState extends ConsumerState<ConsentGate> {
  bool _asked = false;

  @override
  Widget build(BuildContext context) {
    // Never ask when there is nothing to collect. Demo builds and widget tests
    // have no backend, so analytics is a no-op there — prompting would be both
    // pointless and misleading, and it would make every widget test wait on a
    // modal it never asked for.
    final bool decided = ref.watch(consentDecidedProvider);
    if (ref.watch(backendLiveProvider) && !decided && !_asked) {
      _asked = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _show(context);
      });
    }
    return widget.child;
  }

  Future<void> _show(BuildContext context) async {
    // [pipeline C-6] This widget sits ABOVE the router's Navigator (it is
    // installed via MaterialApp.router's `builder`, and Flutter inserts the
    // builder's widget between the app and its Navigator), so `showDialog`
    // with our own context throws "no Navigator" — and, launched unawaited
    // from a post-frame callback with `_asked` already latched, it threw
    // SILENTLY: the DPDP prompt simply never appeared and the fail-closed
    // recorder discarded every event. The dialog therefore borrows the root
    // Navigator's context via [rootNavigatorKey]; the fallback to our own
    // context keeps the gate usable when a test mounts it below a plain
    // Navigator instead of the app router.
    final BuildContext dialogContext =
        rootNavigatorKey.currentContext ?? context;
    final bool? granted = await showDialog<bool>(
      context: dialogContext,
      // Not dismissible: a tap outside is not an answer, and treating it as one
      // would record a decision the user never made.
      barrierDismissible: false,
      builder: (BuildContext ctx) => const _ConsentDialog(),
    );
    if (granted == null) return;
    await recordAnalyticsConsent(ref, granted: granted);
  }
}

class _ConsentDialog extends StatelessWidget {
  const _ConsentDialog();

  @override
  Widget build(BuildContext context) {
    // 🔴 EVERY STRING BELOW IS A REUSE OF AN EXISTING ARB KEY EXCEPT TWO, AND
    // THE EXCEPTIONS ARE THE POINT.
    //
    //  · `consentPrivacyLive` is MINTED, and the arb's older `consentPrivacy`
    //    is deliberately left alone. The two texts differ: `consentPrivacy`
    //    stops at "…just a random code for this installation", while the words
    //    THIS DIALOG HAS BEEN SHOWING also promise "You can change this any
    //    time in Settings." Users consented under the live sentence, so
    //    swapping it for the shorter arb value would silently retract a promise
    //    — an owner/legal call, not a refactor. (WORKORDER §8 decision 2; the
    //    owner still has to reconcile the two against privacy.html.)
    //  · `consentReadPolicy` is minted because no link key existed.
    //
    // Everything else — title, body, both buttons — resolves to a value that is
    // byte-identical to the literal it replaces, which is why the four tests
    // that pin "Allow" / "No thanks" needed no edit.
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AlertDialog(
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      title: Text(
        l10n.consentTitle(AppConfig.appName),
        style: AppText.title.copyWith(fontSize: 19),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(l10n.consentBody, style: AppText.body.copyWith(fontSize: 14)),
          const SizedBox(height: 10),
          Text(
            l10n.consentPrivacyLive,
            style: AppText.muted.copyWith(fontSize: 13),
          ),
          const SizedBox(height: 12),
          GestureDetector(
            onTap: () => openExternalUrl(AppConfig.privacyUrl),
            child: Text(
              l10n.consentReadPolicy,
              style: AppText.body.copyWith(
                fontSize: 13,
                color: AppColors.accent,
                decoration: TextDecoration.underline,
              ),
            ),
          ),
        ],
      ),
      // Both choices get the same size and weight on purpose. A prominent
      // "Allow" beside a faint "No thanks" is the dark pattern the consent rules
      // exist to stop, and it would also poison the data with pressured yeses.
      actions: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: SoftButton(
                label: l10n.consentDecline,
                color: AppColors.ink,
                onPressed: () => Navigator.of(context).pop(false),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: SoftButton(
                label: l10n.consentAllow,
                color: AppColors.accent,
                onPressed: () => Navigator.of(context).pop(true),
              ),
            ),
          ],
        ),
      ],
      actionsPadding: const EdgeInsets.fromLTRB(20, 4, 20, 18),
    );
  }
}
