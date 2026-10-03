// The detail screen's reminder rows: this subscription's own reminder days
// (ST-R3, audit C26 — the API's `reminder_days`) and its notice period
// (ST-R8, audit F30 — `notice_days`). Behaviour only: existing ListTiles on the
// existing card, no new token (ST-D restyles every screen next).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/subscription.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart' show renewalRemindersProvider;
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../settings/reminder_settings.dart' show chooseLeadDays;
import '../shared/failure_copy.dart';
import '../shared/widgets.dart' show cardDecoration;

/// The notice periods the chooser offers, in days.
const List<int> kNoticeChoices = <int>[1, 3, 7, 14, 30];

class SubscriptionReminderRows extends ConsumerWidget {
  const SubscriptionReminderRows({required this.sub, super.key});

  final Subscription sub;

  Future<void> _save(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> changes,
  ) async {
    try {
      await ref
          .read(subscriptionsControllerProvider.notifier)
          .updateReminderFields(sub.id, changes);
    } on Object catch (e) {
      if (!context.mounted) return;
      // DE-09 (audit B09): what failed is the SUBSCRIPTION SAVE — this used to
      // read "Could not reach the reminder service", a service this write
      // never touches. By cause first; the fallback names the row.
      final AppLocalizations l10n = AppLocalizations.of(context);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          key: const Key('reminder-save-failed'),
          content: Text(
            writeFailureMessage(
              l10n,
              e,
              fallback: l10n.reminderSaveFailed(sub.name),
            ),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final int defaultLead = ref.watch(
      settingsControllerProvider.select(
        (SettingsState s) => s.reminderLeadDays,
      ),
    );
    final List<int>? own = sub.reminderDays;
    final String reminders = own == null
        ? l10n.detailRemindersDefault(l10n.reminderLeadValue(defaultLead))
        : own.map(l10n.reminderLeadValue).join(', ');
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: DecoratedBox(
        decoration: cardDecoration(context, radius: 18),
        child: Material(
          type: MaterialType.transparency,
          child: Column(
            children: <Widget>[
              ListTile(
                key: const Key('detail.reminders'),
                leading: const Icon(Icons.notifications_active_outlined),
                title: Text(l10n.detailRemindersTitle),
                subtitle: Text(reminders),
                trailing: const Icon(Icons.chevron_right),
                onTap: () async {
                  final List<int>? days = await _chooseDays(context, own);
                  if (days == null || !context.mounted) return;
                  // An empty choice is "use my default" — NULL on the wire.
                  await _save(context, ref, <String, dynamic>{
                    'reminder_days': days.isEmpty ? null : days,
                  });
                },
              ),
              // The API emits `notice_days` from 0004 on. Before that the field
              // would be dropped on write, so it is not offered at all.
              if (sub.noticeDaysSupported)
                ListTile(
                  key: const Key('detail.notice'),
                  leading: const Icon(Icons.event_busy_outlined),
                  title: Text(l10n.detailNoticeTitle),
                  subtitle: Text(
                    sub.noticeDays == null
                        ? l10n.detailNoticeNone
                        : l10n.detailNoticeValue(sub.noticeDays!),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    final int? d = await chooseLeadDays(
                      context,
                      title: l10n.detailNoticeChooseTitle(sub.name),
                      current: sub.noticeDays,
                      clearLabel: l10n.detailNoticeNone,
                      choices: kNoticeChoices,
                      label: l10n.detailNoticeValue,
                    );
                    if (d == null || !context.mounted) return;
                    await _save(context, ref, <String, dynamic>{
                      'notice_days': d < 0 ? null : d,
                    });
                  },
                ),
              // ⏱ ST truth pass (DE-03): on a target that cannot schedule a
              // notification (web, Linux, Windows without its identity) the
              // two rows above set days for a reminder THIS DEVICE never
              // posts. Said here, with the way to the channels that do.
              if (!ref.watch(renewalRemindersProvider).capabilities.canSchedule)
                ListTile(
                  key: const Key('detail.reminders.noDeviceNotifications'),
                  leading: const Icon(Icons.info_outline),
                  title: Text(l10n.detailRemindersNoDeviceNotifications),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/settings'),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// Several days at once (e.g. a week before AND the day before). Null =
  /// dismissed; empty = use the default.
  Future<List<int>?> _chooseDays(BuildContext context, List<int>? own) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Set<int> picked = <int>{...?own};
    return showDialog<List<int>>(
      context: context,
      builder: (BuildContext c) => StatefulBuilder(
        builder: (BuildContext c, StateSetter set) => AlertDialog(
          title: Text(l10n.detailRemindersChooseTitle(sub.name)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                for (final int d in SettingsState.leadChoices)
                  CheckboxListTile(
                    key: Key('detail.reminders.$d'),
                    value: picked.contains(d),
                    title: Text(l10n.reminderLeadValue(d)),
                    onChanged: (bool? on) => set(
                      () => on == true ? picked.add(d) : picked.remove(d),
                    ),
                  ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              key: const Key('detail.reminders.default'),
              onPressed: () => Navigator.pop(c, <int>[]),
              child: Text(l10n.detailRemindersUseDefault),
            ),
            FilledButton(
              key: const Key('detail.reminders.save'),
              onPressed: () => Navigator.pop(
                c,
                picked.toList()..sort((int a, int b) => b - a),
              ),
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );
  }
}
