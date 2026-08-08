import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final double savings = SubMath.savings(subs);

    // 2026-07-27 - this list was FIVE HARDCODED entries naming real brands and
    // inventing facts about the user's own accounts: "Adobe CC and Disney+
    // haven't been opened in weeks", "Netflix price increased from 13.99 to
    // 15.49", renewals for plans the user may not even track. It rendered
    // identically for everyone, because none of it came from their data.
    //
    // The app has no usage tracking and no price history, so neither claim could
    // ever have been derived. Every row below is now computed from the
    // subscriptions actually held, and anything that cannot be computed is not
    // shown at all.
    final DateTime now = DateTime.now();

    final List<Subscription> dueSoon =
        subs.where((Subscription x) {
          final int d = x.daysUntil(now);
          return d >= 0 && d <= 7;
        }).toList()..sort(
          (Subscription a, Subscription b) =>
              a.daysUntil(now).compareTo(b.daysUntil(now)),
        );

    final List<Subscription> flaggedUnused = subs
        .where((Subscription x) => x.unused)
        .toList();

    final List<_Notif> items = <_Notif>[
      for (final Subscription x in dueSoon)
        _Notif(
          Icons.notifications_none,
          AppColors.accent,
          const Color.fromRGBO(100, 89, 245, 0.12),
          x.daysUntil(now) == 0
              ? '${x.name} renews today'
              : '${x.name} renews in ${x.daysUntil(now)} '
                    '${x.daysUntil(now) == 1 ? "day" : "days"}',
          '${currency.fmt(x.price)} on '
              '${x.nextRenewal.day}/${x.nextRenewal.month}/${x.nextRenewal.year}',
          '',
        ),
      if (flaggedUnused.isNotEmpty)
        _Notif(
          Icons.priority_high,
          AppColors.warn,
          const Color.fromRGBO(245, 158, 11, 0.13),
          '${flaggedUnused.length} '
              '${flaggedUnused.length == 1 ? "plan is" : "plans are"} marked unused',
          'Cancelling ${flaggedUnused.length == 1 ? "it" : "them"} would save '
              '${currency.fmt(savings)}/mo.',
          '',
        ),
    ];

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text(
                    'Notifications',
                    style: AppText.title.copyWith(fontSize: 22),
                  ),
                  Semantics(
                    button: true,
                    label: 'Close',
                    child: GestureDetector(
                      onTap: () => context.pop(),
                      child: Container(
                        width: 48,
                        height: 48,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: AppColors.line),
                        ),
                        child: const Icon(
                          Icons.close,
                          size: 18,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.line),
            Expanded(
              child: items.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text(
                          'Nothing due in the next 7 days.',
                          textAlign: TextAlign.center,
                          style: AppText.body.copyWith(color: AppColors.muted),
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(18),
                      itemCount: items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (BuildContext context, int i) =>
                          _card(items[i]),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(_Notif n) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: n.bg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(n.icon, color: n.color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  n.title,
                  style: AppText.body.copyWith(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  n.body,
                  style: AppText.muted.copyWith(fontSize: 13, height: 1.45),
                ),
                const SizedBox(height: 6),
                Text(
                  n.time.toUpperCase(),
                  style: AppText.label.copyWith(fontSize: 10),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Notif {
  const _Notif(
    this.icon,
    this.color,
    this.bg,
    this.title,
    this.body,
    this.time,
  );
  final IconData icon;
  final Color color;
  final Color bg;
  final String title;
  final String body;
  final String time;
}
