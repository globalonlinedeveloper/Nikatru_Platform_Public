import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/auth/auth_models.dart';
import '../../data/models/subscription.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/due.dart';
import '../shared/widgets.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Currency currency = ref.watch(currencyProvider);
    final AuthUser? user = ref.watch(authRepositoryProvider).currentUser;
    // The `unused` setting was declared in settings_controller.dart and read
    // NOWHERE, so the switch in Settings did nothing. It now gates the surface it
    // describes: "Flag subscriptions you don't use".
    final bool showUnused =
        ref.watch(settingsControllerProvider).prefs['unused'] ?? true;
    return ref.watch(subscriptionsControllerProvider).when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object e, _) =>
              Center(child: Text('Could not load: $e', style: AppText.muted)),
          data: (List<Subscription> subs) =>
              _content(context, currency, user, subs, showUnused),
        );
  }

  Widget _content(BuildContext context, Currency currency, AuthUser? user,
      List<Subscription> subs, bool showUnused) {
    final DateTime now = DateTime.now();
    final double total = SubMath.totalMonthly(subs);
    final double dueSoon = SubMath.dueWithin(subs, now, 7);
    final List<Subscription> unused = SubMath.unused(subs);
    final double savings = SubMath.savings(subs);
    final List<Subscription> upcoming = SubMath.upcoming(subs, now);
    final List<Subscription> all = SubMath.byMonthlyDesc(subs);

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 58, 18, 108),
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(_greeting(now), style: AppText.muted.copyWith(fontSize: 12)),
                  Text(user?.displayName ?? 'Welcome',
                      style: AppText.title.copyWith(fontSize: 24)),
                ],
              ),
            ),
            _circleButton(
                icon: Icons.notifications_none_rounded,
                dot: true,
                onTap: () => context.push('/notifications')),
            const SizedBox(width: 9),
            GestureDetector(
              onTap: () => context.go('/settings'),
              child: Container(
                width: 44,
                height: 44,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                    gradient: AppColors.brandGradient,
                    borderRadius: BorderRadius.circular(14)),
                child: Text(user?.initial ?? 'A',
                    style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontWeight: FontWeight.w800,
                        color: Colors.white)),
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _heroCard(currency, total, subs.length, dueSoon,
            SubMath.dueWithin(subs, now, 30)),
        const SizedBox(height: 14),
        if (showUnused && unused.isNotEmpty)
          RowCard(
            accentBar: AppColors.warn,
            onTap: () => context.go('/insights'),
            leading: Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                  color: const Color.fromRGBO(245, 158, 11, 0.16),
                  borderRadius: BorderRadius.circular(12)),
              child: const Text('!',
                  style: TextStyle(
                      fontFamily: 'Space Grotesk',
                      fontWeight: FontWeight.w700,
                      fontSize: 19,
                      color: AppColors.warn)),
            ),
            title: '${unused.length} marked unused',
            subtitle: Text('Cancel to save ${currency.fmt(savings)}/mo',
                style: AppText.muted.copyWith(fontSize: 12)),
            trailing: const Icon(Icons.arrow_forward, color: AppColors.muted, size: 20),
          ),
        SectionHeader('Upcoming renewals',
            trailing: GestureDetector(
              onTap: () => context.go('/calendar'),
              child: Text('Calendar →',
                  style: AppText.body.copyWith(
                      color: AppColors.accent, fontWeight: FontWeight.w700, fontSize: 12)),
            )),
        ...upcoming.map((Subscription s) => Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: _subTile(context, currency, s, now, showDue: true),
            )),
        SectionHeader('All subscriptions',
            trailing: Text('${subs.length}', style: AppText.muted.copyWith(fontSize: 12))),
        ...all.map((Subscription s) => Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: _subTile(context, currency, s, now, showDue: false),
            )),
      ],
    );
  }

  Widget _heroCard(Currency currency, double total, int count, double dueSoon,
      double due30) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: AppColors.heroGradient,
        borderRadius: BorderRadius.circular(26),
        boxShadow: const <BoxShadow>[
          BoxShadow(
              color: Color.fromRGBO(42, 36, 86, 0.8),
              blurRadius: 50,
              offset: Offset(0, 24),
              spreadRadius: -24),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('MONTHLY SPEND',
              style: AppText.label
                  .copyWith(color: const Color.fromRGBO(255, 255, 255, 0.7))),
          const SizedBox(height: 4),
          Text(currency.fmt(total),
              style: AppText.fig.copyWith(fontSize: 44, color: Colors.white, height: 1)),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Pill('$count active',
                  bg: const Color.fromRGBO(255, 255, 255, 0.13), fg: Colors.white),
              const SizedBox(width: 7),
              Pill('${currency.fmt0(total * 12)} / yr',
                  bg: const Color.fromRGBO(255, 255, 255, 0.13), fg: Colors.white),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: <Widget>[
              _statBox('DUE IN 7 DAYS', currency.fmt(dueSoon), Colors.white),
              const SizedBox(width: 12),
              // Was 'VS LAST MONTH', computed as `total - 174`. 174 was the last
              // element of the fabricated six-month trend array in insights, so this
              // compared the user's real total against a number someone typed. It
              // also hardcoded a '+', so it reported an increase every single month.
              // The app stores no history, so no month-over-month figure can be
              // honest. Replaced with a 30-day horizon, which is derived.
              _statBox('DUE IN 30 DAYS', currency.fmt(due30), Colors.white),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statBox(String label, String value, Color valueColor) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
            color: const Color.fromRGBO(255, 255, 255, 0.08),
            borderRadius: BorderRadius.circular(15)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label,
                style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontWeight: FontWeight.w600,
                    fontSize: 10,
                    color: Color.fromRGBO(255, 255, 255, 0.7))),
            const SizedBox(height: 2),
            Text(value, style: AppText.fig.copyWith(fontSize: 20, color: valueColor)),
          ],
        ),
      ),
    );
  }

  Widget _subTile(BuildContext context, Currency currency, Subscription s,
      DateTime now,
      {required bool showDue}) {
    final DueInfo due = DueInfo.of(s, now);
    final Color dot = s.unused
        ? AppColors.warn
        : (s.usedPct > 60 ? AppColors.positive : const Color(0xFFC9C9D2));
    final String usage = s.unused
        ? 'Rarely used'
        : (s.usedPct > 60 ? 'Active' : 'Occasional');

    return RowCard(
      onTap: () => context.push('/sub/${s.id}'),
      leading: GlyphTile(glyph: s.glyph, statusColor: showDue ? null : dot),
      title: s.name,
      subtitle: showDue
          ? Text(due.label,
              style: TextStyle(
                  fontFamily: 'Manrope',
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                  color: due.color))
          : Text('${s.category} · $usage', style: AppText.muted.copyWith(fontSize: 12)),
      trailing: showDue
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Text(currency.fmt(s.monthlyPrice), style: AppText.fig.copyWith(fontSize: 16)),
                Text(s.cycle == BillingCycle.yearly ? 'per year' : 'per month',
                    style: AppText.muted.copyWith(fontSize: 10)),
              ],
            )
          : Text(currency.fmt(s.monthlyPrice), style: AppText.fig.copyWith(fontSize: 16)),
    );
  }

  Widget _circleButton(
      {required IconData icon, bool dot = false, VoidCallback? onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        children: <Widget>[
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.line)),
            child: Icon(icon, color: AppColors.ink, size: 20),
          ),
          if (dot)
            Positioned(
              top: 9,
              right: 10,
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                    color: AppColors.warn,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.surface, width: 2)),
              ),
            ),
        ],
      ),
    );
  }

  String _greeting(DateTime now) {
    if (now.hour < 12) return 'Good morning';
    if (now.hour < 18) return 'Good afternoon';
    return 'Good evening';
  }
}
