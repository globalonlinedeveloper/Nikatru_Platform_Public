import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/format/currency.dart';
import '../core/format/sub_math.dart';
import '../data/models/subscription.dart';
import '../services/notifications/notification_service.dart';
import 'analytics_funnel.dart';
import 'providers.dart';
import 'settings_controller.dart';

/// What the reminder wiring should do for a given set of preferences.
///
/// Extracted so the DECISION is testable without a platform: the plugin calls
/// themselves need a real device and are correctly out of scope, but "which
/// toggle causes which action" is exactly where a wiring bug hides -- and all
/// three of these toggles were previously read nowhere at all.
class ReminderPlan {
  const ReminderPlan({required this.syncRenewals, required this.weeklyDigest});

  /// Schedule per-renewal reminders (true) or cancel them all (false).
  final bool syncRenewals;

  /// Schedule the repeating weekly digest (true) or cancel it (false).
  final bool weeklyDigest;

  /// `alerts` defaults ON, `weekly` defaults OFF -- matching SettingsState, so a
  /// missing key can never silently flip a user's notifications on.
  factory ReminderPlan.from(Map<String, bool> prefs) => ReminderPlan(
        syncRenewals: prefs['alerts'] ?? true,
        weeklyDigest: prefs['weekly'] ?? false,
      );
}

/// Owns the subscription list and keeps on-device reminders in sync with it.
class SubscriptionsController extends AsyncNotifier<List<Subscription>> {
  @override
  Future<List<Subscription>> build() async {
    final List<Subscription> subs = await ref
        .watch(subscriptionRepositoryProvider)
        .fetchAll();
    _syncReminders(subs);
    return subs;
  }

  Future<void> addSubscription(Subscription draft) async {
    final List<Subscription> before =
        state.valueOrNull ?? const <Subscription>[];
    final Subscription created = await ref
        .read(subscriptionRepositoryProvider)
        .add(draft);
    final List<Subscription> list = <Subscription>[...before, created];
    state = AsyncData<List<Subscription>>(list);
    _syncReminders(list);

    // G-12 ACTIVATION. Subly's "aha" is the FIRST subscription added — the
    // single strongest predictor of retention and of paying. Fired only when
    // the list was empty, so it stays a once-per-install signal rather than a
    // per-add counter, and only after the write succeeded.
    if (before.isEmpty) {
      ref.read(analyticsFunnelProvider).valueOrNull?.onActivation();
    }
  }

  Future<void> cancelSubscription(String id) async {
    await ref.read(subscriptionRepositoryProvider).cancel(id);
    final List<Subscription> list =
        (state.valueOrNull ?? const <Subscription>[])
            .where((Subscription s) => s.id != id)
            .toList();
    state = AsyncData<List<Subscription>>(list);
    _syncReminders(list);
  }

  void _syncReminders(List<Subscription> subs) {
    final SettingsState settings = ref.read(settingsControllerProvider);
    final NotificationService notifier = ref.read(notificationServiceProvider);
    final ReminderPlan plan = ReminderPlan.from(settings.prefs);

    // Fire-and-forget; NotificationService is a no-op on web.
    //
    // ORDER MATTERS: syncAll() begins with cancelAll(), which would take the
    // weekly digest with it. The digest is therefore (re)scheduled AFTER, never
    // before. Getting this backwards would leave the toggle on while the
    // notification silently never fired -- the exact shape of bug this wiring
    // exists to remove.
    if (plan.syncRenewals) {
      notifier.syncAll(subs);
    } else {
      notifier.cancelAll();
    }

    if (plan.weeklyDigest) {
      final Currency currency = ref.read(currencyProvider);
      notifier.scheduleWeeklyDigest(
        count: subs.length,
        formattedTotal: currency.fmt(SubMath.totalMonthly(subs)),
      );
    } else {
      notifier.cancelWeeklyDigest();
    }
  }
}

final AsyncNotifierProvider<SubscriptionsController, List<Subscription>>
subscriptionsControllerProvider =
    AsyncNotifierProvider<SubscriptionsController, List<Subscription>>(
      SubscriptionsController.new,
    );
