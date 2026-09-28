import 'package:flutter/foundation.dart'
    show
        TargetPlatform,
        defaultTargetPlatform,
        immutable,
        kIsWeb,
        visibleForTesting;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show NotificationCapabilities;

import '../../core/windows_notification_identity.g.dart';
import '../../data/models/subscription.dart';

/// Every user-visible string this service hands to the OS, already rendered in
/// the language the app is currently showing.
///
/// 🔴 THIS EXISTS BECAUSE THE SERVICE HAS NO `BuildContext` AND MUST NOT GET ONE.
/// Its scheduling runs from a Riverpod notifier — there is no element tree to
/// read `AppLocalizations.of(context)` from. So the CALLER renders and the
/// service posts. The closures are closures rather than strings because their
/// arguments are only known per notification, and they carry the locale's
/// `DateFormat` with them — the date belongs to the same sentence as the words
/// around it, so it is formatted where the words are.
@immutable
class ReminderCopy {
  const ReminderCopy({
    required this.channelName,
    required this.reminderTitle,
    required this.reminderBody,
    required this.digestTitle,
    required this.digestBody,
    required this.cancelByTitle,
    required this.cancelByBody,
    this.channelDescription = 'Alerts before a charge',
  });

  /// The Android notification CHANNEL name — visible in the OS settings app,
  /// long after the notification itself is gone.
  final String channelName;

  /// 👤 STILL ENGLISH: there is no .arb key for it yet (audit C28/D16, label
  /// ST-Y4). It now crosses the seam as data, so that fix is one key.
  final String channelDescription;

  final String reminderTitle;

  /// `(name, renewal date) → body`. The caller owns the date format.
  final String Function(String name, DateTime renewal) reminderBody;

  final String digestTitle;

  /// `(count due this week, formatted total) → body`. PLURAL on [count].
  final String Function(int count, String formattedTotal) digestBody;

  /// ST-R8: the "Cancel by" reminder at next renewal − notice days.
  final String Function(DateTime cancelBy) cancelByTitle;
  final String Function(String name, DateTime cancelBy) cancelByBody;
}

/// WHEN renewal reminders fire — the user's rules (ST-R3, audit C23/C26).
///
/// [leadDays] is the account default (Settings); a row's own `reminder_days`
/// replaces it for that row. [hour]:[minute] is the local time of day every
/// reminder fires at.
@immutable
class ReminderRules {
  const ReminderRules({
    this.leadDays = const <int>[2],
    this.hour = 9,
    this.minute = 0,
  });

  final List<int> leadDays;
  final int hour;
  final int minute;
}

/// Why this platform cannot schedule a renewal reminder — the key a settings
/// screen turns into a sentence. Only ever non-null where the capability
/// matrix says so; the app never OFFERS what it cannot deliver.
enum ReminderUnavailability {
  /// No notification plugin at all on this target (web; Windows without the
  /// app's identity).
  noNotifications,

  /// Immediate notifications work but nothing can be scheduled (Linux).
  noScheduling,
}

/// Subly's renewal reminders — the DOMAIN half, over the chassis seam.
///
/// ⏱ 2026-09-28 (ST-R4): THIS USED TO BE A THIRD IMPLEMENTATION OF THE SEAM —
/// a 764-line `NotificationService` singleton wrapping
/// `flutter_local_notifications` itself, beside the shared adapter that wrapped
/// the SAME process-singleton plugin. The plugin half (one-off schedules, the
/// exact-alarm degradation, the OS pending list, the Windows identity) moved
/// into `packages/notifications` as `scheduleAt` / `reconcile`, where every
/// stamped app gets it; what is left here is only what is Subly's: which
/// subscription gets which reminder, on which day, in which words. It imports
/// no plugin and no `timezone` — `assert-package-boundaries` now refuses both.
class RenewalReminders {
  RenewalReminders({
    required core.NotificationService service,
    required this.capabilities,
    TargetPlatform? platform,
    DateTime Function()? now,
  }) : _service = service,
       _platform = platform,
       _now = now ?? DateTime.now;

  /// For test fakes ONLY: a no-op seam under the real matrix for [platform],
  /// so a subclass can override the scheduling methods to record calls. The
  /// default seam GRANTS permission, so a switch a test turns on stays on; a
  /// test of the refusal (ST-R5) passes a [service] that refuses.
  @visibleForTesting
  RenewalReminders.forTesting({
    TargetPlatform? platform,
    bool? isWeb,
    core.NotificationService service = const _GrantingNoOp(),
    DateTime Function()? now,
  }) : this(
         service: service,
         capabilities: NotificationCapabilities.resolve(
           platform ?? defaultTargetPlatform,
           isWeb: isWeb ?? kIsWeb,
           windows: kWindowsNotificationIdentity,
         ),
         platform: platform,
         now: now,
       );

  final core.NotificationService _service;
  final TargetPlatform? _platform;
  final DateTime Function() _now;

  /// What THIS platform can deliver — the same object the chassis adapter was
  /// built from (`notificationCapabilitiesProvider`), so the settings rows and
  /// the scheduler can never disagree.
  final NotificationCapabilities capabilities;

  /// The reason, for a settings screen, that this platform schedules nothing
  /// — `null` where it does.
  ReminderUnavailability? get unavailability {
    final NotificationCapabilities c = capabilities;
    if (c.canSchedule) return null;
    if (!c.canNotify) return ReminderUnavailability.noNotifications;
    return ReminderUnavailability.noScheduling;
  }

  /// Asks the OS for notification permission. Returns whether we may post.
  ///
  /// CALL THIS FROM A USER GESTURE ONLY — the moment the user turns on a
  /// reminder-bearing feature. Never from a provider `build()` or `initState`:
  /// `tooling/ci/assert-stamp-properties.mjs` walks the call graph from
  /// `main()` and fails the build if any path reaches here. Android 13+ makes
  /// a SECOND denial permanent, so a launch-time ask can burn the permission
  /// for the life of the install.
  Future<bool> requestPermissions() async {
    if (!capabilities.canNotify) return false;
    return _service.requestPermission();
  }

  static const core.NotificationChannel _channelFor = core.NotificationChannel(
    id: 'renewals',
    name: 'Renewal reminders',
    description: 'Alerts before a charge',
    important: true,
  );

  core.NotificationChannel _channel(ReminderCopy copy) =>
      core.NotificationChannel(
        id: _channelFor.id,
        name: copy.channelName,
        description: copy.channelDescription,
        important: true,
      );

  /// The payload every reminder about [sub] carries: a tap opens `/sub/{id}`
  /// (state/notification_tap_observer.dart, ST-R5).
  static String payloadFor(String subscriptionId) => 'sub:$subscriptionId';

  /// The reminders [sub] is owed this cycle, nearest first — ST-R3.
  ///
  /// One per lead day in the row's `reminder_days` (else [rules]' default),
  /// at [rules]' time of day, skipping any instant already past. If EVERY lead
  /// has passed but the charge has not (a row added the day before it renews,
  /// with a two-day lead), one SAME-DAY FALLBACK: the time of day today if it
  /// is still ahead, else on the renewal day itself. A user whose lead passed
  /// is exactly the user a reminder is for; the old code gave them nothing.
  ///
  /// ⚠️ ONE CYCLE. "Arm the next N cycles" needs the cadence engine
  /// (`RecurrenceSchedule`, ST-T3b / ST-M3), which is not on this base; a
  /// second date engine here is the thing the brief forbids. It re-arms on
  /// every sync, and the cycle after this one is ST-T3b's follow-up.
  @visibleForTesting
  List<core.ScheduledNotification> plannedFor(
    Subscription sub, {
    required ReminderCopy copy,
    required ReminderRules rules,
  }) {
    final DateTime now = _now();
    final DateTime renewal = sub.nextRenewal;
    final List<int> days = sub.reminderDays ?? rules.leadDays;
    final List<core.ScheduledNotification> out = <core.ScheduledNotification>[];
    DateTime at(DateTime day) =>
        DateTime(day.year, day.month, day.day, rules.hour, rules.minute);

    final String body = copy.reminderBody(sub.name, renewal);
    final List<int> leads = <int>{...days}.toList()
      ..sort((int a, int b) => a - b);
    for (final int d in leads) {
      final DateTime when = at(
        DateTime(renewal.year, renewal.month, renewal.day - d),
      );
      if (!when.isAfter(now)) continue;
      out.add(
        core.ScheduledNotification(
          id: renewalIdFor('${sub.id}|$d'),
          title: copy.reminderTitle,
          body: body,
          at: when,
          payload: payloadFor(sub.id),
          channel: _channel(copy),
        ),
      );
    }
    if (out.isEmpty && leads.isNotEmpty) {
      final DateTime today = at(now);
      final DateTime onTheDay = at(renewal);
      final DateTime? fallback = today.isAfter(now) && !today.isAfter(onTheDay)
          ? today
          : (onTheDay.isAfter(now) ? onTheDay : null);
      if (fallback != null) {
        out.add(
          core.ScheduledNotification(
            id: renewalIdFor('${sub.id}|today'),
            title: copy.reminderTitle,
            body: body,
            at: fallback,
            payload: payloadFor(sub.id),
            channel: _channel(copy),
          ),
        );
      }
    }

    // ST-R8: "Cancel by {date}" at next renewal − notice days, when the plan
    // names a notice period. No fallback: past that day it is too late, and a
    // reminder that says so helps nobody.
    final DateTime? cancelBy = sub.cancelBy;
    if (cancelBy != null) {
      final DateTime when = at(cancelBy);
      if (when.isAfter(now)) {
        out.add(
          core.ScheduledNotification(
            id: renewalIdFor('${sub.id}|cancel'),
            title: copy.cancelByTitle(cancelBy),
            body: copy.cancelByBody(sub.name, cancelBy),
            at: when,
            payload: payloadFor(sub.id),
            channel: _channel(copy),
          ),
        );
      }
    }
    out.sort(
      (core.ScheduledNotification a, core.ScheduledNotification b) =>
          a.at.compareTo(b.at),
    );
    return out;
  }

  /// 🔴 APPLE'S PENDING-NOTIFICATION POOL — 64 PER APP, ENFORCED BY DISCARDING.
  /// `UNUserNotificationCenter` keeps only the 64 soonest pending requests and
  /// silently drops the rest (macOS too). The digest lives in the same pool, so
  /// the budget stops four short of it.
  static const int _darwinPendingLimit = 64;

  /// The most renewal reminders [syncAll] will schedule on a platform that caps
  /// them — every lead, fallback and cancel-by reminder counts, one slot each.
  static const int renewalReminderBudget = _darwinPendingLimit - 4;

  /// Whether [platform] silently discards pending notifications past a cap.
  /// Android (AlarmManager) has no pool, and budgeting there would delete
  /// working reminders to solve a problem that platform does not have.
  @visibleForTesting
  static bool platformCapsPendingNotifications(TargetPlatform platform) =>
      platform == TargetPlatform.iOS || platform == TargetPlatform.macOS;

  /// Every reminder [syncAll] will schedule, nearest first, inside the budget.
  ///
  /// On a capped platform the set is narrowed on purpose: soonest first, then
  /// [renewalReminderBudget] — the reminders a user could still act on, and
  /// the same overflow the OS was going to impose anyway, except chosen and
  /// countable ([remindersDroppedByBudget]).
  @visibleForTesting
  List<core.ScheduledNotification> plannedReminders(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
    TargetPlatform? platform,
  }) {
    final List<core.ScheduledNotification> all =
        <core.ScheduledNotification>[
          for (final Subscription s in subs)
            ...plannedFor(s, copy: copy, rules: rules),
        ]..sort(
          (core.ScheduledNotification a, core.ScheduledNotification b) =>
              a.at.compareTo(b.at),
        );
    final TargetPlatform target =
        platform ?? _platform ?? defaultTargetPlatform;
    if (kIsWeb ||
        !platformCapsPendingNotifications(target) ||
        all.length <= renewalReminderBudget) {
      return List<core.ScheduledNotification>.unmodifiable(all);
    }
    return List<core.ScheduledNotification>.unmodifiable(
      all.take(renewalReminderBudget),
    );
  }

  /// How many reminders the last [syncAll] left out because the budget bit.
  /// Exactly 0 on Android and on any account inside the budget.
  int get remindersDroppedByBudget => _droppedByBudget;
  int _droppedByBudget = 0;

  /// Rebuilds the full renewal reminder set (call after edits, or on resume).
  ///
  /// 🔴 OWNED IDS ONLY — `reconcile(owns: isRenewalReminderId)`, never
  /// `cancelAll()`. The chassis daily reminder shares this plugin, and each
  /// cancels what it owns.
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
  }) async {
    if (!capabilities.canSchedule) return;
    final int wanted = <core.ScheduledNotification>[
      for (final Subscription s in subs)
        ...plannedFor(s, copy: copy, rules: rules),
    ].length;
    final List<core.ScheduledNotification> planned = plannedReminders(
      subs,
      copy: copy,
      rules: rules,
    );
    _droppedByBudget = wanted - planned.length;
    await _service.reconcile(planned, owns: isRenewalReminderId);
  }

  /// Cancel every RENEWAL reminder this service owns, and nothing else.
  Future<void> cancelOwnedRenewals() async {
    if (!capabilities.canSchedule) return;
    await _service.reconcile(
      const <core.ScheduledNotification>[],
      owns: isRenewalReminderId,
    );
  }

  /// The weekly digest, behind the `weekly` setting — ST-R7 (audit C24).
  ///
  /// ONE-OFF at the next Sunday 18:00, re-armed on every sync. It used to be a
  /// REPEATING notification with a FROZEN body, so it re-posted the same
  /// sentence every Sunday until the app was reopened — the exact reason
  /// renewals were never repeated. [count] and [formattedTotal] are the
  /// renewals due in the seven days from that Sunday ([digestDay]).
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {
    if (!capabilities.canSchedule) return;
    await _service.reconcile(<core.ScheduledNotification>[
      core.ScheduledNotification(
        id: digestId,
        title: copy.digestTitle,
        body: copy.digestBody(count, formattedTotal),
        at: digestDay(_now()),
        channel: _channel(copy),
      ),
    ], owns: (int id) => id == digestId);
  }

  /// The next Sunday 18:00 strictly after [now] — the digest's instant, and
  /// the day its "this week" is counted from.
  static DateTime digestDay(DateTime now) {
    DateTime when = DateTime(now.year, now.month, now.day, 18);
    while (when.weekday != DateTime.sunday || !when.isAfter(now)) {
      when = DateTime(when.year, when.month, when.day + 1, 18);
    }
    return when;
  }

  Future<void> cancelWeeklyDigest() async {
    if (!capabilities.canNotify) return;
    await _service.cancel(digestId);
  }

  /// EVERYTHING the plugin holds — the chassis daily reminder included.
  /// ⚠️ SIGN-OUT AND ACCOUNT DELETION ONLY (`userStateDrops`).
  Future<void> cancelAll() async {
    if (!capabilities.canNotify) return;
    await _service.cancelAll();
  }

  /// Fixed id for the digest, outside the renewal namespace below.
  static const int digestId = 0x7ffffffe;

  /// The RENEWAL id namespace: [renewalIdBase, renewalIdBase + renewalIdRange).
  ///
  /// 🔴 DISJOINT BY CONSTRUCTION from every other id on the shared plugin:
  /// the chassis daily reminder is `kDailyReminderId` (1), the chassis
  /// immediate bucket is 0x7f000000, the digest is 0x7ffffffe — which is what
  /// lets [syncAll] reconcile by membership rather than by `cancelAll()`.
  /// Ids scheduled by builds before ST-R3 (one per subscription) are in the
  /// same namespace, so the first sync after an update cancels them.
  static const int renewalIdBase = 0x10000000;
  static const int renewalIdRange = 0x40000000;

  /// Whether [id] is a renewal reminder this service owns.
  static bool isRenewalReminderId(int id) =>
      id >= renewalIdBase && id < renewalIdBase + renewalIdRange;

  /// A STABLE id for a key (`<subscription id>|<lead>`).
  ///
  /// FNV-1a over the UTF-16 code units rather than `String.hashCode`: Dart
  /// documents `hashCode` as an implementation detail that may change between
  /// VM versions, and an id that moves with an SDK bump orphans every alarm
  /// the previous build scheduled.
  @visibleForTesting
  static int renewalIdFor(String key) {
    int h = 0x811c9dc5;
    for (final int unit in key.codeUnits) {
      h ^= unit;
      h = (h * 0x01000193) & 0xffffffff;
    }
    return renewalIdBase + (h % renewalIdRange);
  }
}

/// [RenewalReminders.forTesting]'s default seam: schedules nothing, and says
/// yes when asked, like a device where the user allowed notifications.
class _GrantingNoOp extends core.NoOpNotificationService {
  const _GrantingNoOp();

  @override
  Future<bool> requestPermission() async => true;
}
