import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/currency.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/payment_record.dart';
import '../../data/models/subscription.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../cancel/cancel_sheet.dart';
import '../shared/due.dart';
import '../shared/widgets.dart';

class SubscriptionDetailScreen extends ConsumerWidget {
  const SubscriptionDetailScreen({super.key, required this.id});
  final String id;

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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    Subscription? sub;
    for (final Subscription s in subs) {
      if (s.id == id) {
        sub = s;
        break;
      }
    }
    if (sub == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        appBar: AppBar(backgroundColor: AppColors.bg, elevation: 0),
        body: const Center(child: Text('Subscription not found')),
      );
    }
    final Subscription s = sub;
    final DueInfo due = DueInfo.of(s, DateTime.now());

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Container(
            decoration: const BoxDecoration(gradient: AppColors.heroGradient),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: <Widget>[
                        _iconButton(
                          Icons.arrow_back,
                          'Back',
                          () => context.pop(),
                        ),
                        _iconButton(Icons.more_horiz, 'More options', () {}),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Container(
                      width: 56,
                      height: 56,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        color: const Color.fromRGBO(255, 255, 255, 0.14),
                        border: Border.all(
                          color: const Color.fromRGBO(255, 255, 255, 0.2),
                        ),
                      ),
                      child: Text(
                        s.glyph,
                        style: const TextStyle(
                          fontFamily: 'Space Grotesk',
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      s.name,
                      style: AppText.title.copyWith(
                        fontSize: 30,
                        color: Colors.white,
                      ),
                    ),
                    Text(
                      '${s.category} · ${s.plan}',
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                        color: Color.fromRGBO(255, 255, 255, 0.82),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: _miniCard(
                        'PRICE',
                        currency.fmt(s.price),
                        s.cycle == BillingCycle.yearly
                            ? 'per year'
                            : 'per month',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _miniCard(
                        'NEXT CHARGE',
                        '${_shortMon(s.nextRenewal.month)} ${s.nextRenewal.day}',
                        due.label,
                        valueSub: due.color,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: cardDecoration(radius: 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: <Widget>[
                          Text(
                            'Usage this month',
                            style: AppText.body.copyWith(
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                          ),
                          Text(
                            s.unused ? 'Rarely used' : 'Active',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontWeight: FontWeight.w700,
                              fontSize: 12,
                              color: s.unused
                                  ? AppColors.warn
                                  : AppColors.positive,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: LinearProgressIndicator(
                          value: s.usedPct / 100,
                          minHeight: 8,
                          backgroundColor: AppColors.line,
                          color: s.unused ? AppColors.warn : AppColors.positive,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        s.usageNote,
                        style: AppText.muted.copyWith(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.fromLTRB(2, 18, 2, 10),
                  child: Text(
                    'Payment history',
                    style: TextStyle(
                      fontFamily: 'Space Grotesk',
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                _history(ref, currency, s.id),
                const SizedBox(height: 20),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: SoftButton(
                        label: 'Edit plan',
                        onPressed: () => context.pop(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: SizedBox(
                        height: 50,
                        child: FilledButton(
                          onPressed: () async {
                            await showCancelSheet(context, s);
                            if (context.mounted) context.pop();
                          },
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.danger,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          child: const Text(
                            'Cancel plan',
                            style: TextStyle(
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
            ),
          ),
        ],
      ),
    );
  }

  Widget _history(WidgetRef ref, Currency currency, String subId) {
    return FutureBuilder<List<PaymentRecord>>(
      future: ref.read(subscriptionRepositoryProvider).history(subId),
      builder: (BuildContext context, AsyncSnapshot<List<PaymentRecord>> snap) {
        final List<PaymentRecord> hist = snap.data ?? const <PaymentRecord>[];
        if (hist.isEmpty) {
          return Text(
            'No payments yet.',
            style: AppText.muted.copyWith(fontSize: 12),
          );
        }
        return Column(
          children: hist
              .map(
                (PaymentRecord h) => Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: <Widget>[
                      Text(
                        '${_months[h.date.month - 1]} ${h.date.day}, ${h.date.year}',
                        style: AppText.muted.copyWith(fontSize: 13),
                      ),
                      Text(
                        currency.fmt(h.amount),
                        style: AppText.fig.copyWith(fontSize: 14),
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }

  Widget _miniCard(String label, String value, String sub, {Color? valueSub}) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: cardDecoration(radius: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: AppText.label.copyWith(fontSize: 10)),
          const SizedBox(height: 2),
          Text(value, style: AppText.fig.copyWith(fontSize: 21)),
          Text(
            sub,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontWeight: FontWeight.w700,
              fontSize: 10,
              color: valueSub ?? AppColors.muted,
            ),
          ),
        ],
      ),
    );
  }

  // 48px + a label: the chassis floor for icon-only controls, and what a
  // screen reader announces (P2.6b route-walk findings).
  Widget _iconButton(IconData icon, String semanticLabel, VoidCallback onTap) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 48,
          height: 48,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: const Color.fromRGBO(255, 255, 255, 0.16),
            borderRadius: BorderRadius.circular(13),
          ),
          child: Icon(icon, color: Colors.white, size: 19),
        ),
      ),
    );
  }

  String _shortMon(int m) {
    const List<String> s = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return s[m - 1];
  }
}
