// The reminder rows of Settings — ST-R3 (the rules), ST-R5 (permission
// honoured, one priming dialog, the sync-failure banner) and the ST-T4a client
// (email reminders and the calendar feed).
//
// A file of its own because settings_screen.dart is a chassis fork held at its
// ceiling (tooling/chassis-parity.json): it names these widgets and nothing
// here grows it. They are Subly's rows — the renewal rules and its reminder
// channels — so they stay app-side; the mechanisms under them (the seam, the
// transport, the link policy) are packages every app gets.

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/widgets.dart' show cardDecoration;

/// Turn the pref [key] — asking first, for a reminder-bearing one going ON.
///
/// 🔴 ONE PRIMING DIALOG FOR EVERY REMINDER-BEARING SWITCH (audit D9). The OS
/// prompt is one-shot on most platforms, and Android 13+ makes a second denial
/// permanent, so the app says WHY before the OS asks, and "Not now" spends
/// nothing. Off is never an ask.
Future<void> toggleReminderPref(
  BuildContext context,
  WidgetRef ref,
  String key,
) async {
  final bool turningOn =
      !(ref.read(settingsControllerProvider).prefs[key] ?? false);
  if (turningOn && SettingsController.reminderBearing.contains(key)) {
    final bool go = await primeReminderPermission(context);
    if (!go || !context.mounted) return;
  }
  await ref.read(settingsControllerProvider.notifier).toggle(key);
}

/// The priming dialog. True = go on to the OS prompt.
Future<bool> primeReminderPermission(BuildContext context) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return await showDialog<bool>(
        context: context,
        builder: (BuildContext c) => AlertDialog(
          key: const Key('settings.reminder.priming'),
          title: Text(l10n.permissionPrimingTitle),
          content: Text(l10n.permissionPrimingBody),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: Text(l10n.notNow),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: Text(l10n.continueLabel),
            ),
          ],
        ),
      ) ??
      false;
}

/// The line under a preference switch: why it is OFF when the OS refused it
/// (ST-R5), the rule it applies when it is ON (ST-R3), else [desc].
String reminderPrefSubtitle(
  BuildContext context,
  SettingsState s,
  String key,
  String desc,
) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  if (s.blocked.contains(key)) return l10n.notificationsBlocked;
  if (key == 'alerts' && (s.prefs['alerts'] ?? false)) {
    return l10n.reminderRuleSummary(
      l10n.reminderLeadValue(s.reminderLeadDays),
      _time(context, s.reminderMinuteOfDay),
    );
  }
  return desc;
}

String _time(BuildContext context, int minuteOfDay) =>
    MaterialLocalizations.of(context).formatTimeOfDay(
      TimeOfDay(hour: minuteOfDay ~/ 60, minute: minuteOfDay % 60),
      alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
    );

/// ST-R3 (audit C26): the default lead and the time of day, under "Renewal
/// alerts" while it is ON on a target that can schedule.
class ReminderRuleRows extends ConsumerWidget {
  const ReminderRuleRows({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SettingsState s = ref.watch(settingsControllerProvider);
    final bool deliverable = ref
        .watch(renewalRemindersProvider)
        .capabilities
        .canSchedule;
    if (!deliverable || !(s.prefs['alerts'] ?? false)) {
      return const SizedBox.shrink();
    }
    final AppLocalizations l10n = AppLocalizations.of(context);
    final SettingsController c = ref.read(settingsControllerProvider.notifier);
    return Material(
      type: MaterialType.transparency,
      child: Column(
        children: <Widget>[
          ListTile(
            key: const Key('settings.reminder.lead'),
            leading: const Icon(Icons.notifications_active_outlined),
            title: Text(l10n.reminderLeadTitle),
            subtitle: Text(l10n.reminderLeadValue(s.reminderLeadDays)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final int? d = await chooseLeadDays(
                context,
                title: l10n.reminderLeadChooseTitle,
                current: s.reminderLeadDays,
              );
              if (d != null) await c.setReminderLead(d);
            },
          ),
          ListTile(
            key: const Key('settings.reminder.time'),
            leading: const Icon(Icons.schedule),
            title: Text(l10n.reminderTimeTitle),
            subtitle: Text(_time(context, s.reminderMinuteOfDay)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final TimeOfDay? t = await showTimePicker(
                context: context,
                initialTime: TimeOfDay(
                  hour: s.reminderMinuteOfDay ~/ 60,
                  minute: s.reminderMinuteOfDay % 60,
                ),
              );
              if (t != null) await c.setReminderTime(t.hour, t.minute);
            },
          ),
        ],
      ),
    );
  }
}

/// A chooser over [SettingsState.leadChoices]; null = dismissed. With
/// [clearLabel], a first option that answers -1 ("use my default").
Future<int?> chooseLeadDays(
  BuildContext context, {
  required String title,
  required int? current,
  String? clearLabel,
  List<int> choices = SettingsState.leadChoices,
  String Function(int days)? label,
}) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final String Function(int) name = label ?? l10n.reminderLeadValue;
  return showDialog<int>(
    context: context,
    builder: (BuildContext c) => SimpleDialog(
      title: Text(title),
      children: <Widget>[
        RadioGroup<int>(
          groupValue: current ?? -1,
          onChanged: (int? v) => Navigator.pop(c, v),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (clearLabel != null)
                RadioListTile<int>(value: -1, title: Text(clearLabel)),
              for (final int d in choices)
                RadioListTile<int>(
                  key: Key('settings.reminder.lead.$d'),
                  value: d,
                  title: Text(name(d)),
                ),
            ],
          ),
        ),
      ],
    ),
  );
}

/// ST-R5 (audit C25): a failed reminder sync is a STATE the user can see.
/// [reminderSyncFailureProvider] was written and read by nothing.
class ReminderSyncBanner extends ConsumerWidget {
  const ReminderSyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(reminderSyncFailureProvider) == null) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: cardDecoration(context),
        child: Material(
          type: MaterialType.transparency,
          child: ListTile(
            key: const Key('settings.reminder.syncFailed'),
            leading: const Icon(Icons.sync_problem),
            title: Text(AppLocalizations.of(context).reminderSyncFailedBanner),
          ),
        ),
      ),
    );
  }
}

/// The ST-T4a client: email reminders and the private calendar feed — the
/// reminders that reach EVERY target, web included, because the platform
/// Worker sends them. Shown to a signed-in account on a live backend only.
class ReminderChannelsCard extends ConsumerStatefulWidget {
  const ReminderChannelsCard({super.key});

  @override
  ConsumerState<ReminderChannelsCard> createState() =>
      _ReminderChannelsCardState();
}

class _ReminderChannelsCardState extends ConsumerState<ReminderChannelsCard> {
  core.ReminderPrefs? _prefs;
  bool _busy = false;
  bool _asked = false;

  Future<String?> _token() =>
      ref.read(authRepositoryProvider).currentAccessToken();

  core.ReminderChannelsTransport get _transport =>
      ref.read(reminderChannelsTransportProvider);

  Future<void> _load() async {
    _asked = true;
    final core.Result<core.ReminderPrefs> r = await _transport.readPrefs(
      appId: AppConfig.appId,
      accessToken: await _token(),
    );
    if (!mounted) return;
    setState(
      () => _prefs = r is core.Ok<core.ReminderPrefs>
          ? r.value
          : core.ReminderPrefs.defaults,
    );
  }

  /// Every call goes through here: one at a time, and a failure is SAID.
  /// Null while another call is in flight.
  Future<core.Result<T>?> _run<T>(
    Future<core.Result<T>> Function(String? token) call,
  ) async {
    if (_busy) return null;
    setState(() => _busy = true);
    final core.Result<T> r = await call(await _token());
    if (!mounted) return r;
    setState(() => _busy = false);
    if (!r.isOk) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).reminderChannelsFailed),
        ),
      );
    }
    return r;
  }

  Future<void> _write({bool? emailOptIn, int? leadDays}) async {
    final core.ReminderPrefs now = _prefs ?? core.ReminderPrefs.defaults;
    final core.Result<core.ReminderPrefs>? r = await _run(
      (String? t) => _transport.writePrefs(
        appId: AppConfig.appId,
        accessToken: t,
        emailOptIn: emailOptIn ?? now.emailOptIn,
        leadDays: leadDays,
      ),
    );
    if (r is core.Ok<core.ReminderPrefs> && mounted) {
      setState(() => _prefs = r.value);
    }
  }

  Future<void> _addToCalendar() async {
    final core.Result<core.CalendarFeed>? r = await _run(
      (String? t) =>
          _transport.mintCalendarFeed(appId: AppConfig.appId, accessToken: t),
    );
    if (r is! core.Ok<core.CalendarFeed>) return;
    final core.CalendarFeed feed = r.value;
    // A calendar app subscribes by webcal:; a browser tab cannot, so web
    // downloads the same feed as a file (the route's ?download=1).
    final Uri open = kIsWeb
        ? feed.httpsUrl.replace(
            queryParameters: <String, String>{
              ...feed.httpsUrl.queryParameters,
              'download': '1',
            },
          )
        : feed.webcalUrl;
    await ref.read(calendarLinkLauncherProvider).open(open);
  }

  Future<void> _reset() async {
    final core.Result<void>? r = await _run(
      (String? t) =>
          _transport.revokeCalendarFeed(appId: AppConfig.appId, accessToken: t),
    );
    if (r == null || !r.isOk || !mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text(AppLocalizations.of(context).calendarResetDone)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final core.AuthUser? user = ref.watch(authUserProvider).value;
    if (!ref.watch(reminderChannelsAvailableProvider) || user == null) {
      return const SizedBox.shrink();
    }
    if (!_asked) _load();
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.ReminderPrefs p = _prefs ?? core.ReminderPrefs.defaults;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: DecoratedBox(
        decoration: cardDecoration(context),
        child: Material(
          type: MaterialType.transparency,
          child: Column(
            children: <Widget>[
              SwitchListTile.adaptive(
                key: const Key('settings.reminder.email'),
                title: Text(l10n.emailRemindersTitle),
                subtitle: Text(
                  l10n.emailRemindersDesc(l10n.reminderLeadValue(p.leadDays)),
                ),
                value: p.emailOptIn,
                onChanged: _prefs == null || _busy
                    ? null
                    : (bool on) => _write(emailOptIn: on),
              ),
              if (p.emailOptIn)
                ListTile(
                  key: const Key('settings.reminder.email.lead'),
                  title: Text(l10n.reminderLeadTitle),
                  subtitle: Text(l10n.reminderLeadValue(p.leadDays)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: _busy
                      ? null
                      : () async {
                          final int? d = await chooseLeadDays(
                            context,
                            title: l10n.reminderLeadChooseTitle,
                            current: p.leadDays,
                          );
                          if (d != null) await _write(leadDays: d);
                        },
                ),
              ListTile(
                key: const Key('settings.reminder.calendar'),
                leading: const Icon(Icons.event_available_outlined),
                title: Text(l10n.calendarAddTitle),
                subtitle: Text(l10n.calendarAddDesc),
                onTap: _busy ? null : _addToCalendar,
              ),
              ListTile(
                key: const Key('settings.reminder.calendar.reset'),
                leading: const Icon(Icons.link_off),
                title: Text(l10n.calendarResetTitle),
                onTap: _busy ? null : _reset,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
