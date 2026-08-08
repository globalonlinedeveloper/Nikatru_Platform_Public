import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format/currency.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/widgets.dart';

Future<void> showCancelSheet(BuildContext context, Subscription sub) {
  return showModalBottomSheet<void>(
    context: context,
    // 🔴 THE SHEET HAS TWO CALLERS ON DIFFERENT NAVIGATOR LEVELS, and without
    // this they mount on different navigators. `insights_screen.dart` calls
    // from inside a shell BRANCH navigator, so the modal scrim covered only the
    // branch — AppShell's floating pill is a later `Stack` child and drew OVER
    // the scrim, and under the chassis rail/drawer the same call would dim only
    // the body pane beside the rail. `subscription_detail_screen.dart` calls
    // from the ROOT and scrims the whole window. One destructive confirmation
    // that dims different amounts of the app depending on where it was opened
    // from is not a style difference: the scrim is what says "answer this
    // first", and a nav bar left live above it is a way out of the question.
    //
    // Pinning it to the root unifies both. The dismiss paths are unaffected —
    // `Navigator.of(context)` inside the sheet resolves from the SHEET's own
    // route context, which is now the root route, so 'Keep it' and 'Done' still
    // pop exactly the sheet. That is asserted, not argued: see the two
    // mount-level cases in `test/width_cancel_sheet_test.dart`.
    useRootNavigator: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CancelSheet(sub: sub),
  );
}

class _CancelSheet extends ConsumerStatefulWidget {
  const _CancelSheet({required this.sub});
  final Subscription sub;

  @override
  ConsumerState<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends ConsumerState<_CancelSheet> {
  int _step = 0;
  bool _busy = false;

  static const List<String> _months = <String>[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  Future<void> _confirm() async {
    setState(() => _busy = true);
    // Resolved BEFORE the await — see the note in add_subscription_sheet.dart.
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(subscriptionsControllerProvider.notifier)
          .cancelSubscription(widget.sub.id);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _step = 1;
      });
    } catch (_) {
      // 🔴 THIS FAILURE PATH DID NOT EXIST, and the stakes here are higher than
      // in the add sheet: the awaited call reaches the network, so offline it
      // threw out of an unawaited future and the button stayed disabled on
      // 'Cancelling…' forever. Advancing to step 1 regardless would have been
      // worse still — that screen congratulates the user on savings from a
      // cancellation that never happened.
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Could not cancel just now — check your connection and try again.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final Currency currency = ref.watch(currencyProvider);
    final Subscription s = widget.sub;
    final String monthly = currency.fmt(s.monthlyPrice);

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bg,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: const EdgeInsets.fromLTRB(22, 26, 22, 30),
      child: _step == 0
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Container(
                  width: 64,
                  height: 64,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color.fromRGBO(239, 77, 106, 0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(
                    Icons.close,
                    color: AppColors.danger,
                    size: 28,
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  'Cancel ${s.name}?',
                  style: AppText.title.copyWith(fontSize: 22),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text.rich(
                  TextSpan(
                    style: AppText.muted.copyWith(fontSize: 14, height: 1.55),
                    children: <InlineSpan>[
                      const TextSpan(text: 'You’ll save '),
                      TextSpan(
                        text: '$monthly/mo',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: AppColors.positive,
                        ),
                      ),
                      TextSpan(
                        text:
                            ' · ${currency.fmt0(s.monthlyPrice * 12)}/yr. Access continues until ${_months[s.nextRenewal.month - 1]} ${s.nextRenewal.day}.',
                      ),
                    ],
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 22),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: SoftButton(
                        label: 'Keep it',
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: SizedBox(
                        height: 50,
                        child: FilledButton(
                          onPressed: _busy ? null : _confirm,
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.danger,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          child: Text(
                            _busy ? 'Cancelling…' : 'Confirm cancel',
                            style: const TextStyle(
                              fontFamily: 'Manrope',
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Container(
                  width: 70,
                  height: 70,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color.fromRGBO(16, 185, 129, 0.14),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    color: AppColors.positive,
                    size: 34,
                  ),
                ),
                const SizedBox(height: 16),
                Text('Cancelled', style: AppText.title.copyWith(fontSize: 23)),
                const SizedBox(height: 8),
                Text.rich(
                  TextSpan(
                    style: AppText.muted.copyWith(fontSize: 14, height: 1.55),
                    children: <InlineSpan>[
                      const TextSpan(text: 'You’re now saving '),
                      TextSpan(
                        text: '$monthly/mo',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: AppColors.positive,
                        ),
                      ),
                      const TextSpan(text: '. Nicely done.'),
                    ],
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: GradientButton(
                    label: 'Done',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ],
            ),
    );
  }
}
