import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
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
    if (AppConfig.isBackendLive && !decided && !_asked) {
      _asked = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _show(context);
      });
    }
    return widget.child;
  }

  Future<void> _show(BuildContext context) async {
    final bool? granted = await showDialog<bool>(
      context: context,
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
    return AlertDialog(
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      title: Text(
        'Help improve ${AppConfig.appName}?',
        style: AppText.title.copyWith(fontSize: 19),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'We can record which features you use, so we can see what works and '
            'fix what does not.',
            style: AppText.body.copyWith(fontSize: 14),
          ),
          const SizedBox(height: 10),
          Text(
            'No name, no email, no advertising ID and no IP address. Just a '
            'random code for this installation. You can change this any time in '
            'Settings.',
            style: AppText.muted.copyWith(fontSize: 13),
          ),
          const SizedBox(height: 12),
          GestureDetector(
            onTap: () => openExternalUrl(AppConfig.privacyUrl),
            child: Text(
              'Read the privacy policy',
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
                label: 'No thanks',
                color: AppColors.ink,
                onPressed: () => Navigator.of(context).pop(false),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: SoftButton(
                label: 'Allow',
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
