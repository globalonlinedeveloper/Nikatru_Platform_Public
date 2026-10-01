import 'package:flutter/foundation.dart'
    show
        TargetPlatform,
        defaultTargetPlatform,
        immutable,
        kIsWeb,
        visibleForTesting;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show NotificationCapabilities, QuietHours;

import '../../core/windows_notification_identity.g.dart';
import '../../data/models/budget_info.dart';
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
    required this.channelDescription,
    this.trialTitle,
    this.trialBody,
    this.overBudgetTitle,
    this.overBudgetBody,
    this.markPaidAction,
    this.snoozeAction,
    this.testTitle,
    this.testBody,
  });

  /// The Android notification CHANNEL name — visible in the OS settings app,
  /// long after the notification itself is gone.
  final String channelName;

  /// The line under the channel name in the OS settings app — as visible as
  /// the name, so it is translated like it (audit C28/D16).
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

  /// ST-T3b (ST-E5): the free-trial-ending reminder. Null falls back to the
  /// renewal copy, which still names the right day.
  final String? trialTitle;
  final String Function(String name, DateTime trialEnds)? trialBody;

  /// ST-I2 (audit C14): the over-budget alert. `(spent, budget) → body`, both
  /// already formatted. Null posts no over-budget alert at all — there is no
  /// English fallback for a sentence the caller did not render.
  final String? overBudgetTitle;
  final String Function(String spent, String budget)? overBudgetBody;

  /// NO-10: the two buttons on a renewal reminder. Null = no buttons.
  final String? markPaidAction;
  final String? snoozeAction;

  /// NO-13: the "Send a test reminder" notification. Null = the reminder title.
  final String? testTitle;
  final String? testBody;
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
    this.quiet,
    this.cycles = RenewalReminders.cyclesPerPlan,
  });

  final List<int> leadDays;
  final int hour;
  final int minute;

  /// NO-11: how many charges ahead each plan is armed for, this one first.
  final int cycles;

  /// NO-13: a window no local reminder fires in; one planned inside it fires
  /// at its end. Null = none.
  final QuietHours? quiet;
}

/// Why this platform cannot schedule a renewal reminder — the key a settings
/// screen turns into a sentence. Only ever non-null where the capability
/// matrix says so; the app never OFFERS what it cannot deliver.
enum ReminderUnavailability {
  /// No notification plugin at all on this target (web; Windows without the
  /// app's identity).
  noNotifications,

  /// Immediate notifications work but nothing can be scheduled.
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

  /// Android keys the user's per-channel choices by this id: stable forever.
  static const String _channelId = 'renewals';

  core.NotificationChannel _channel(ReminderCopy copy) =>
      core.NotificationChannel(
        id: _channelId,
        name: copy.channelName,
        description: copy.channelDescription,
        important: true,
      );

  /// The payload every reminder about [sub] carries: a tap opens `/sub/{id}`
  /// (state/notification_tap_observer.dart, ST-R5).
  static String payloadFor(String subscriptionId) => 'sub:$subscriptionId';

  /// NO-10: the action ids a renewal reminder's buttons hand back.
  static const String markPaidActionId = 'paid';
  static const String snoozeActionId = 'snooze';

  /// How far "Snooze 1 day" moves a reminder.
  static const Duration snoozeFor = Duration(days: 1);

  /// The buttons on a RENEWAL reminder (not a cancel-by: "mark as paid" there
  /// would answer a question it does not ask). Empty when [copy] names none.
  static List<core.NotificationAction> actionsFor(ReminderCopy copy) {
    final String? paid = copy.markPaidAction;
    final String? snooze = copy.snoozeAction;
    if (paid == null || snooze == null) {
      return const <core.NotificationAction>[];
    }
    return <core.NotificationAction>[
      core.NotificationAction(id: markPaidActionId, title: paid),
      core.NotificationAction(id: snoozeActionId, title: snooze),
    ];
  }

  /// NO-11: how many charges ahead each plan is armed for where the OS has no
  /// pending pool — this cycle and the next two, so a user who does not open
  /// the app for a quarter is still reminded.
  static const int cyclesPerPlan = 3;

  /// The reminders [sub] is owed this cycle, nearest first — ST-R3.
  ///
  /// One per lead day in the row's `reminder_days` (else [rules]' default),
  /// at [rules]' time of day, skipping any instant already past. If EVERY lead
  /// has passed but the charge has not (a row added the day before it renews,
  /// with a two-day lead), one SAME-DAY FALLBACK: the time of day today if it
  /// is still ahead, else on the renewal day itself. A user whose lead passed
  /// is exactly the user a reminder is for; the old code gave them nothing.
  ///
  /// The charge is [Subscription.nextCharge] — the stored date ROLLED by its
  /// cadence (ST-T3b's RecurrenceSchedule), so a row whose stored date has
  /// passed is reminded of its real next charge, never of a day gone by.
  ///
  /// NO-11: [cyclesPerPlan] CHARGES are armed, nearest first — the next one
  /// and the ones after it, by the row's cadence — so a reminder still comes
  /// when the app is not opened between charges. A row with no cadence has
  /// one. Ids for the first cycle are what they always were, so an update
  /// re-arms rather than duplicates.
  ///
  /// A TRIALING row is also reminded before its trial ends (ST-T3b, ST-E5),
  /// at the same leads and time of day.
  /// When the next reminder for [sub] fires — the first entry of the schedule
  /// [plannedFor] arms — or null when none will: the platform cannot schedule
  /// ([unavailability]), the row is not charging, or every lead has passed.
  /// The detail screen's "Next reminder" row (DE-11) reads THIS, so it can
  /// never name a reminder the device is not going to post.
  DateTime? nextReminderAt(
    Subscription sub, {
    required ReminderCopy copy,
    required ReminderRules rules,
  }) {
    if (unavailability != null || !sub.isCharging) return null;
    final List<core.ScheduledNotification> plan = plannedFor(
      sub,
      copy: copy,
      rules: rules,
    );
    return plan.isEmpty ? null : plan.first.at;
  }

  @visibleForTesting
  List<core.ScheduledNotification> plannedFor(
    Subscription sub, {
    required ReminderCopy copy,
    required ReminderRules rules,
  }) {
    final DateTime now = _now();
    final DateTime renewal = sub.nextCharge(now);
    final List<int> days = sub.reminderDays ?? rules.leadDays;
    final List<core.ScheduledNotification> out = <core.ScheduledNotification>[];
    DateTime at(DateTime day) =>
        DateTime(day.year, day.month, day.day, rules.hour, rules.minute);

    final String body = copy.reminderBody(sub.name, renewal);
    final List<core.NotificationAction> actions = actionsFor(copy);
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
          actions: actions,
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
            actions: actions,
          ),
        );
      }
    }

    // NO-11: the charges after this one, by the row's own cadence — AFTER
    // the fallback above, which is about THIS charge only: a row renewing
    // tomorrow still gets its same-day reminder although next month's lead
    // is ahead.
    final Cadence? cadence = sub.cycle;
    if (cadence != null && cadence.isValid) {
      DateTime charge = renewal;
      for (int c = 1; c < rules.cycles; c++) {
        // The STORED day is the anchor, so a 31st plan returns to the 31st
        // after a short month rather than drifting to the 28th for good.
        charge = RecurrenceSchedule.advance(
          charge,
          cadence,
          anchorDay: sub.nextRenewal.day,
        );
        final DateTime day = DateTime(charge.year, charge.month, charge.day);
        for (final int d in leads) {
          final DateTime when = at(DateTime(day.year, day.month, day.day - d));
          if (!when.isAfter(now)) continue;
          out.add(
            core.ScheduledNotification(
              id: renewalIdFor('${sub.id}|$d|c$c'),
              title: copy.reminderTitle,
              body: copy.reminderBody(sub.name, day),
              at: when,
              payload: payloadFor(sub.id),
              channel: _channel(copy),
              actions: actions,
            ),
          );
        }
      }
    }

    // ST-R8: "Cancel by {date}" at next renewal − notice days, when the plan
    // names a notice period. No fallback: past that day it is too late, and a
    // reminder that says so helps nobody.
    final DateTime? ends = sub.trialEndsOn;
    if (ends != null && sub.status == SubscriptionStatus.trialing) {
      for (final int d in leads) {
        final DateTime when = at(DateTime(ends.year, ends.month, ends.day - d));
        if (!when.isAfter(now)) continue;
        out.add(
          core.ScheduledNotification(
            id: renewalIdFor('${sub.id}|trial|$d'),
            title: copy.trialTitle ?? copy.reminderTitle,
            body: (copy.trialBody ?? copy.reminderBody)(sub.name, ends),
            at: when,
            payload: payloadFor(sub.id),
            channel: _channel(copy),
          ),
        );
      }
    }

    final DateTime? cancelBy = sub.cancelByFor(now);
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
    final QuietHours? quiet = rules.quiet;
    final List<core.ScheduledNotification> placed = quiet == null
        ? out
        : <core.ScheduledNotification>[
            for (final core.ScheduledNotification n in out)
              _at(n, quiet.defer(n.at)),
          ];
    placed.sort(
      (core.ScheduledNotification a, core.ScheduledNotification b) =>
          a.at.compareTo(b.at),
    );
    return placed;
  }

  static core.ScheduledNotification _at(
    core.ScheduledNotification n,
    DateTime at,
  ) => identical(at, n.at)
      ? n
      : core.ScheduledNotification(
          id: n.id,
          title: n.title,
          body: n.body,
          at: at,
          payload: n.payload,
          channel: n.channel,
          actions: n.actions,
        );

  /// 🔴 APPLE'S PENDING-NOTIFICATION POOL — 64 PER APP, ENFORCED BY DISCARDING.
  /// `UNUserNotificationCenter` keeps only the 64 soonest pending requests and
  /// silently drops the rest (macOS too). The digest lives in the same pool, so
  /// the budget stops four short of it. The capability matrix carries the
  /// number (`NotificationCapabilities.pendingLimit`); this is its Darwin row.
  static const int _darwinPendingLimit =
      NotificationCapabilities.darwinPendingLimit;

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
    final bool capped = platform != null || _platform != null
        ? platformCapsPendingNotifications(target)
        : capabilities.pendingLimit != null;
    if (kIsWeb || !capped || all.length <= renewalReminderBudget) {
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

  /// NO-10: "Snooze 1 day" — a reminder about [sub] again in [snoozeFor],
  /// under [snoozeIdFor] (so a second snooze replaces, never doubles), and the
  /// shown one [dismissId] taken down. Quiet hours still apply.
  ///
  /// 🔴 NOT UNDER THE TAPPED ID. That id is in the renewal namespace, and the
  /// sync that runs when the press opens the app reconciles the namespace to
  /// the planned set — which no longer holds a reminder whose moment passed —
  /// so a snooze armed under it would be cancelled within the second.
  Future<void> snooze(
    Subscription sub, {
    required ReminderCopy copy,
    QuietHours? quiet,
    int? dismissId,
  }) async {
    if (dismissId != null && capabilities.canNotify) {
      await _service.cancel(dismissId);
    }
    if (!capabilities.canSchedule) return;
    final DateTime raw = _now().add(snoozeFor);
    await _service.scheduleAt(
      core.ScheduledNotification(
        id: snoozeIdFor(sub.id),
        title: copy.reminderTitle,
        body: copy.reminderBody(sub.name, sub.nextCharge(_now())),
        at: quiet?.defer(raw) ?? raw,
        payload: payloadFor(sub.id),
        channel: _channel(copy),
        actions: actionsFor(copy),
      ),
    );
  }

  /// The id of the test reminder — inside the renewal namespace's range is
  /// NOT safe ([syncAll] would cancel it), so it sits beside the digest and
  /// the over-budget alert, and is neither: a test must never replace a real
  /// alert that is showing.
  static const int testReminderId = 0x7ffffffc;

  /// How long after the tap a test reminder arrives.
  static const Duration testDelay = Duration(seconds: 10);

  /// NO-13: "Send a test reminder" — a local notification in [testDelay] where
  /// this target schedules; true when one was armed. Quiet hours do not apply:
  /// the user asked for it now.
  ///
  /// ⚠️ Where nothing schedules (web) there is no test: the e-mail leg needs a
  /// host route that spends the portfolio's shared daily reminder-mail share
  /// (platform `MAX_REMINDER_MAILS_PER_DAY`), which is the owner's to grant,
  /// so Settings does not offer the row there and this answers false.
  Future<bool> sendTest({required ReminderCopy copy}) async {
    if (capabilities.canSchedule) {
      await _service.scheduleAt(
        core.ScheduledNotification(
          id: testReminderId,
          title: copy.testTitle ?? copy.reminderTitle,
          body: copy.testBody ?? copy.reminderTitle,
          at: _now().add(testDelay),
          channel: _channel(copy),
        ),
      );
      return true;
    }
    return false;
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

  /// The over-budget alert [budget] and [spent] call for — ST-I2 (audit C14)
  /// — or null when none is owed.
  ///
  /// Owed only when a budget is SET (a zero budget is "none", not "every
  /// charge is over it" — `BudgetInfo.usageOf` alone would call any spend
  /// over zero) and the monthly average in the budget's currency passes it:
  /// the same `usageOf` reading the Insights budget card paints as
  /// "… over budget", so the notification and the card never disagree.
  ///
  /// ⏱ AT THE REMINDER TIME OF DAY, the next one ahead — the user's own
  /// "when to bother me" rule — not the instant the budget was crossed: the
  /// person crossing it is looking at the card that already says so. One
  /// pending alert at most, re-armed on each sync, so while spending stays
  /// over it recurs at most once a day, and only after the app has run.
  @visibleForTesting
  core.ScheduledNotification? plannedOverBudget({
    required BudgetInfo budget,
    required core.MoneyBag spent,
    required ReminderCopy copy,
    required ReminderRules rules,
    required core.MoneyFormatter money,
  }) {
    final String? title = copy.overBudgetTitle;
    final String Function(String, String)? body = copy.overBudgetBody;
    if (title == null || body == null) return null;
    if (budget.monthlyBudget.minorUnits <= 0) return null;
    final BudgetUsage usage = budget.usageOf(spent);
    if (!usage.over) return null;
    final DateTime now = _now();
    DateTime at = DateTime(
      now.year,
      now.month,
      now.day,
      rules.hour,
      rules.minute,
    );
    if (!at.isAfter(now)) {
      at = DateTime(now.year, now.month, now.day + 1, rules.hour, rules.minute);
    }
    return core.ScheduledNotification(
      id: overBudgetId,
      title: title,
      body: body(
        money.format(usage.spentHere),
        money.formatRounded(budget.monthlyBudget),
      ),
      at: at,
      payload: overBudgetPayload,
      channel: _channel(copy),
    );
  }

  /// Arm the over-budget alert [plannedOverBudget] calls for, or cancel it
  /// when none is owed ([budget] null: the alert is off). OWNED ID ONLY —
  /// [overBudgetId] — so the renewals and the digest are never touched.
  Future<void> syncOverBudget({
    required BudgetInfo? budget,
    required core.MoneyBag spent,
    required ReminderCopy copy,
    required ReminderRules rules,
    required core.MoneyFormatter money,
  }) async {
    if (!capabilities.canSchedule) return;
    final core.ScheduledNotification? planned = budget == null
        ? null
        : plannedOverBudget(
            budget: budget,
            spent: spent,
            copy: copy,
            rules: rules,
            money: money,
          );
    await _service.reconcile(<core.ScheduledNotification>[
      if (planned != null) planned,
    ], owns: (int id) => id == overBudgetId);
  }

  /// Cancel every reminder [subscriptionId] can hold, now — belt and braces
  /// for a delete (ST-T3b), where the next [syncAll] also drops them. The ids
  /// are the ones [plannedFor] mints: one per lead the app offers, the
  /// same-day fallback, the cancel-by, each trial lead, and the one id a build
  /// before ST-R3 used per row.
  Future<void> cancelForSubscription(String subscriptionId) async {
    if (!capabilities.canNotify) return;
    for (final String key in <String>[
      subscriptionId,
      '$subscriptionId|today',
      '$subscriptionId|cancel',
      for (final int d in leadChoices) '$subscriptionId|$d',
      for (final int d in leadChoices) '$subscriptionId|trial|$d',
      for (int c = 1; c < cyclesPerPlan; c++)
        for (final int d in leadChoices) '$subscriptionId|$d|c$c',
    ]) {
      await _service.cancel(renewalIdFor(key));
    }
    await _service.cancel(snoozeIdFor(subscriptionId));
  }

  /// The lead days a reminder can be armed at — Settings' and the detail
  /// chooser's one list (SettingsState.leadChoices mirrors it).
  static const List<int> leadChoices = <int>[0, 1, 2, 3, 7, 14];

  /// EVERYTHING the plugin holds — the chassis daily reminder included.
  /// ⚠️ SIGN-OUT AND ACCOUNT DELETION ONLY (`userStateDrops`).
  Future<void> cancelAll() async {
    if (!capabilities.canNotify) return;
    await _service.cancelAll();
  }

  /// Fixed id for the digest, outside the renewal namespace below.
  static const int digestId = 0x7ffffffe;

  /// Fixed id for the over-budget alert (ST-I2), beside the digest and
  /// outside the renewal namespace for the same reason.
  static const int overBudgetId = 0x7ffffffd;

  /// The over-budget alert's payload: a tap opens Insights, where the budget
  /// card is (`routeForNotificationPayload`).
  static const String overBudgetPayload = 'budget';

  /// The RENEWAL id namespace: [renewalIdBase, renewalIdBase + renewalIdRange).
  ///
  /// 🔴 DISJOINT BY CONSTRUCTION from every other id on the shared plugin:
  /// the chassis daily reminder is `kDailyReminderId` (1), the chassis
  /// immediate bucket is 0x7f000000, the digest is 0x7ffffffe, the
  /// over-budget alert 0x7ffffffd and the test reminder 0x7ffffffc — which is what
  /// lets [syncAll] reconcile by membership rather than by `cancelAll()`.
  /// Ids scheduled by builds before ST-R3 (one per subscription) are in the
  /// same namespace, so the first sync after an update cancels them.
  static const int renewalIdBase = 0x10000000;
  static const int renewalIdRange = 0x40000000;

  /// The SNOOZE namespace, directly above the renewal one and disjoint from it
  /// and from every fixed id: [syncAll] never reconciles it away.
  static const int snoozeIdBase = renewalIdBase + renewalIdRange;
  static const int snoozeIdRange = 0x10000000;

  /// The one snooze id [subscriptionId] can hold.
  static int snoozeIdFor(String subscriptionId) =>
      snoozeIdBase +
      (renewalIdFor('$subscriptionId|snooze') - renewalIdBase) % snoozeIdRange;

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
