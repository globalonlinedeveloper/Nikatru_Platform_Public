// The reminder rows of Settings — ST-R3 (the rules), ST-R5 (permission
// honoured, one priming dialog, the sync-failure banner) and the ST-T4a client
// (email reminders and the calendar feed).
//
// A file of its own because settings_screen.dart is a chassis fork held at its
// ceiling (tooling/chassis-parity.json): it names these widgets and nothing
// here grows it. They are Subly's rows — the renewal rules and its reminder
// channels — so they stay app-side; the mechanisms under them (the seam, the
// transport, the link policy) are packages every app gets.

import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart' show StateProvider;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show ExactAlarmAccess;

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../calendar/calendar_feed_actions.dart';
import '../shared/priming.dart';
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
  final bool on = await ref
      .read(settingsControllerProvider.notifier)
      .toggle(key);
  // NO-12: the first time renewal reminders go ON on Android, offer exact
  // alarms — once per install.
  if (on && key == 'alerts' && context.mounted) {
    await maybeOfferExactAlarms(context, ref);
  }
}

/// NO-12: Android's "Alarms & reminders", offered ONCE.
///
/// SCHEDULE_EXACT_ALARM is not pre-granted from Android 13 and Android 14
/// revokes it on restore, so without it reminders arrive inside an OS window
/// rather than at the minute. The offer says so and opens the system page;
/// the answer is recorded either way, and a refusal is said in Settings
/// ("reminders may arrive a little late") where the user can come back to it.
/// Already allowed = recorded as granted, nothing shown.
Future<void> maybeOfferExactAlarms(BuildContext context, WidgetRef ref) async {
  if (!ref.read(offersExactAlarmsProvider)) return;
  final ExactAlarmAccess? access = ref.read(exactAlarmAccessProvider);
  if (access == null) return;
  final ExactAlarmOfferController offer = ref.read(
    exactAlarmOfferProvider.notifier,
  );
  if (await offer.wasOffered()) return;
  if (await access.canScheduleExact()) {
    await offer.record(ExactAlarmOfferController.granted);
    return;
  }
  if (!context.mounted) return;
  final AppLocalizations l10n = AppLocalizations.of(context);
  final bool open =
      await showDialog<bool>(
        context: context,
        builder: (BuildContext c) => AlertDialog(
          key: const Key('settings.reminder.exactOffer'),
          title: Text(l10n.exactAlarmOfferTitle),
          content: Text(l10n.exactAlarmOfferBody),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: Text(l10n.exactAlarmOfferLater),
            ),
            TextButton(
              key: const Key('settings.reminder.exactOffer.open'),
              onPressed: () => Navigator.pop(c, true),
              child: Text(l10n.exactAlarmOfferOpen),
            ),
          ],
        ),
      ) ??
      false;
  final bool granted = open && await access.requestExactAlarms();
  await offer.record(
    granted
        ? ExactAlarmOfferController.granted
        : ExactAlarmOfferController.refused,
  );
}

/// The priming dialog. True = go on to the OS prompt.
///
/// ⏱ 2026-09-29 · train ST-D8 (DW2): rendered by the design system's
/// `PermissionPrimingView` through `primeReminders` — one priming surface for
/// Settings and the first add — keeping this dialog's key and its "Not now" /
/// "Continue" words. Where the platform has no OS prompt it answers yes and
/// draws nothing.
Future<bool> primeReminderPermission(BuildContext context) =>
    primeReminders(context, key: const Key('settings.reminder.priming'));

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

/// Whether this account's E-MAIL reminders are on, as the platform last
/// answered — written by [ReminderChannelsCard] after a read or a write,
/// read by [ReminderRuleRows] so the ONE "Remind me" row is offered whenever
/// any channel uses it (SE-09). False until the platform has answered.
///
/// It belongs to the ACCOUNT, so it starts over whenever the signed-in account
/// changes: a sign-out must not leave the last account's e-mail answer
/// offering the "Remind me" row to nobody.
final StateProvider<bool> emailRemindersOnProvider = StateProvider<bool>((ref) {
  ref.watch(
    authUserProvider.select((AsyncValue<core.AuthUser?> u) => u.value?.id),
  );
  return false;
});

/// ST-R3 (audit C26): the default lead and the time of day, under "Renewal
/// alerts" while it is ON on a target that can schedule.
///
/// ⏱ 2026-10-01 · train ST-SETTINGS (SE-09): THE ONE "Remind me" ROW. The
/// e-mail card used to draw a second row with the same title for the
/// server's own lead, so a person who set "3 days" in one place got e-mails
/// on another schedule. Now this row is the account's lead for every
/// channel: the e-mail card follows it ([ReminderChannelsCard] writes it to
/// the platform), and the row is offered when local alerts can fire OR when
/// e-mail reminders are on — the web, where nothing local can, included.
class ReminderRuleRows extends ConsumerWidget {
  const ReminderRuleRows({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SettingsState s = ref.watch(settingsControllerProvider);
    final bool deliverable = ref
        .watch(renewalRemindersProvider)
        .capabilities
        .canSchedule;
    final bool local = deliverable && (s.prefs['alerts'] ?? false);
    // NO-12 / NO-13: the tools rows follow the rules on both paths, mounted
    // from here so settings_screen.dart, a chassis fork at its ceiling, does
    // not grow by them. SE-09: the one "Remind me" row is drawn when local
    // alerts can fire OR e-mail reminders are on; otherwise only the tools.
    if (!local && !ref.watch(emailRemindersOnProvider)) {
      return const ReminderToolsRows();
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
          if (local)
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
          const ReminderToolsRows(),
        ],
      ),
    );
  }
}

/// NO-12 / NO-13: quiet hours, the test reminder, and the exact-alarm line —
/// under the rule rows.
class ReminderToolsRows extends ConsumerWidget {
  const ReminderToolsRows({super.key});

  Future<void> _sendTest(BuildContext context, WidgetRef ref) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final bool armed = await ref
        .read(renewalRemindersProvider)
        .sendTest(copy: reminderCopyFor(ref.read(localeProvider)));
    if (!armed) return;
    messenger?.showSnackBar(
      SnackBar(content: Text(l10n.testReminderSentLocal)),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final SettingsState s = ref.watch(settingsControllerProvider);
    final SettingsController c = ref.read(settingsControllerProvider.notifier);
    final bool local = ref
        .watch(renewalRemindersProvider)
        .capabilities
        .canSchedule;
    final bool quietOn = s.prefs['quiet'] ?? false;
    Future<void> pick(bool start) async {
      final int m = start ? s.quietStartMinute : s.quietEndMinute;
      final TimeOfDay? t = await showTimePicker(
        context: context,
        initialTime: TimeOfDay(hour: m ~/ 60, minute: m % 60),
      );
      if (t == null) return;
      final int v = t.hour * 60 + t.minute;
      await c.setQuietHours(
        startMinute: start ? v : null,
        endMinute: start ? null : v,
      );
    }

    return Material(
      type: MaterialType.transparency,
      child: Column(
        children: <Widget>[
          if (local && (s.prefs['alerts'] ?? false)) ...<Widget>[
            SwitchListTile.adaptive(
              key: const Key('settings.reminder.quiet'),
              secondary: const Icon(Icons.bedtime_outlined),
              title: Text(l10n.quietHoursTitle),
              subtitle: Text(
                l10n.quietHoursSubtitle(
                  _time(context, s.quietStartMinute),
                  _time(context, s.quietEndMinute),
                ),
              ),
              value: quietOn,
              onChanged: (_) => c.toggle('quiet'),
            ),
            if (quietOn)
              Row(
                children: <Widget>[
                  Expanded(
                    child: ListTile(
                      key: const Key('settings.reminder.quiet.start'),
                      title: Text(_time(context, s.quietStartMinute)),
                      onTap: () => pick(true),
                    ),
                  ),
                  Expanded(
                    child: ListTile(
                      key: const Key('settings.reminder.quiet.end'),
                      title: Text(_time(context, s.quietEndMinute)),
                      onTap: () => pick(false),
                    ),
                  ),
                ],
              ),
          ],
          if (ref.watch(exactAlarmOfferProvider) ==
              ExactAlarmOfferController.refused)
            ListTile(
              key: const Key('settings.reminder.exactRefused'),
              leading: const Icon(Icons.alarm_off_outlined),
              title: Text(l10n.exactAlarmRefused),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                final ExactAlarmAccess? access = ref.read(
                  exactAlarmAccessProvider,
                );
                if (access == null) return;
                if (await access.requestExactAlarms()) {
                  await ref
                      .read(exactAlarmOfferProvider.notifier)
                      .record(ExactAlarmOfferController.granted);
                }
              },
            ),
          // Only where a local test can fire. Web waits for a host route that
          // would spend the shared daily reminder-mail share (an owner call),
          // and a row that can only fail is not offered.
          if (local)
            ListTile(
              key: const Key('settings.reminder.test'),
              leading: const Icon(Icons.notification_add_outlined),
              title: Text(l10n.settingsSendTestReminder),
              onTap: () => _sendTest(context, ref),
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
  const ReminderChannelsCard({this.embedded = false, super.key});

  /// SE-09: drawn as rows inside the caller's Reminders card rather than as a
  /// card of its own — Settings has ONE Reminders section.
  final bool embedded;

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
    _publish();
    _reconcile();
  }

  /// Tells [ReminderRuleRows] whether e-mail uses the one "Remind me" row.
  void _publish() {
    if (!mounted) return;
    ref.read(emailRemindersOnProvider.notifier).state =
        _prefs?.emailOptIn ?? false;
  }

  /// The account's lead, as the platform may hold it — null when the local
  /// choice is outside the platform's range, which then keeps its own.
  int? _accountLead() {
    final int lead = ref.read(settingsControllerProvider).reminderLeadDays;
    return core.ReminderPrefs.isValidLead(lead) ? lead : null;
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
      _publish();
      _reconcile(sent: leadDays);
    }
  }

  /// ⏱ review of #1129, finding 6 — ONE schedule for every channel, kept so:
  /// after each read and each write the platform's lead is brought to the one
  /// "Remind me" row's. A change made while a write was in flight (dropped by
  /// [_run]) and a lead set before SE-09 both converge. Not when the platform
  /// just answered another number for the lead it was SENT — it keeps its own
  /// range, and insisting would loop.
  void _reconcile({int? sent}) {
    final core.ReminderPrefs? p = _prefs;
    final int? lead = _accountLead();
    if (p == null || !p.emailOptIn || lead == null || p.leadDays == lead) {
      return;
    }
    if (sent != null && p.leadDays != sent) return;
    unawaited(_write(leadDays: lead));
  }

  /// ⏱ T12 (CA-06): the SAME calls the calendar screen's feed controls make
  /// (`calendar_feed_actions.dart`) — the session's feed, minted once.
  Future<void> _addToCalendar() async {
    final core.Result<core.CalendarFeed>? r = await _run(
      (String? _) => ref.read(calendarFeedProvider.notifier).ensure(),
    );
    if (r is! core.Ok<core.CalendarFeed>) return;
    // A calendar app subscribes by webcal:; a browser tab cannot, so web
    // downloads the same feed as a file (the route's ?download=1).
    await ref
        .read(calendarLinkLauncherProvider)
        .open(
          calendarFeedUri(
            r.value,
            kIsWeb ? CalendarFeedAction.download : CalendarFeedAction.subscribe,
          ),
        );
  }

  /// RESET is a ROTATION: POST /v1/calendar/feed replaces the token, so the
  /// old URL (a leaked or shared one) stops working at once. The new URL is
  /// not opened — the person asked to cut the old one off, not to subscribe.
  Future<void> _reset() async {
    final core.Result<core.CalendarFeed>? r = await _run(
      (String? _) => ref.read(calendarFeedProvider.notifier).rotate(),
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
    // SE-09: the ONE "Remind me" row is the account's lead; when it changes
    // and e-mail reminders are on, the platform is told the same number.
    ref.listen<int>(
      settingsControllerProvider.select(
        (SettingsState s) => s.reminderLeadDays,
      ),
      (int? before, int now) {
        final core.ReminderPrefs? p = _prefs;
        final int? lead = _accountLead();
        if (p != null && p.emailOptIn && lead != null && p.leadDays != lead) {
          _write(leadDays: lead);
        }
      },
    );
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.ReminderPrefs p = _prefs ?? core.ReminderPrefs.defaults;
    final Widget rows = Material(
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
            // Switching e-mail ON sends the account's lead with it, so
            // the two channels start on the one schedule.
            onChanged: _prefs == null || _busy
                ? null
                : (bool on) => _write(
                    emailOptIn: on,
                    leadDays: on ? _accountLead() : null,
                  ),
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
    );
    if (widget.embedded) return rows;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: DecoratedBox(decoration: cardDecoration(context), child: rows),
    );
  }
}
