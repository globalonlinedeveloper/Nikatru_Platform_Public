// SECTION G of the spine — notifications: the shared inbound tap seam, the
// chassis service, Subly's frozen fork, the daily-reminder rail and the
// catch-up nudge. Re-exported from `../providers.dart`.
//
// [notificationTapSourceProvider] stood at the tail of SECTION F (identity) and
// is carried here, with the rest of the notification wiring it belongs to.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/nikatru_notifications.dart';

import '../../core/app_config.dart';
import '../../services/notifications/notification_service.dart';
import '../analytics_providers.dart';

/// 🔴 [13]T-9 — the shared seam, present here for the INBOUND half only.
///
/// Subly's own fork ([sublyNotificationServiceProvider]) still owns every
/// outbound call Subly makes (renewal reminders, the weekly digest). This is the
/// tap channel it has never had, and it is the shared `packages/notifications`
/// adapter rather than a second fork method precisely so there is one
/// registration in the tree, not two.
///
/// 🔴 MUST BE OVERRIDDEN IN `main.dart` WITH THE INSTANCE THAT WAS `init()`ED,
/// and it is NOT the same thing as [notificationServiceProvider] below even
/// though both are `core.NotificationService`. The tap callback is registered by
/// `init()` and delivered on that instance's own stream, so a second,
/// uninitialised instance would expose a stream that is silent forever — working
/// code, no error, no tap. Merging the two providers would do exactly that. The
/// default below is therefore the NO-OP, never a live-looking service.
final Provider<core.NotificationService> notificationTapSourceProvider =
    Provider<core.NotificationService>(
      (ref) => const core.NoOpNotificationService(),
    );

// ═════════════════════════════════════════════════════════════════════════════
// SECTION G · NOTIFICATIONS + THE REMINDER RAIL
// ═════════════════════════════════════════════════════════════════════════════

/// Local notifications (G-25): the plugin-backed impl of core's
/// [core.NotificationService] seam, or a no-op where no plugin exists.
///
/// 🔴 THIS NAME NOW MEANS THE CHASSIS SERVICE. Subly's own fork kept its
/// behaviour and moved to [sublyNotificationServiceProvider] — see note 3 in the
/// file header for the three pieces of evidence that forced the direction.
///
/// [pipeline C-2/C-7] Platform reality is DECLARED, not assumed — see
/// [NotificationCapabilities]: Android/iOS/macOS show and schedule; Linux shows
/// but cannot schedule; Windows does neither on the pinned 17.x; Web has no
/// plugin at all. Unsupported calls degrade to a safe no-op, so a caller never
/// crashes on a platform that cannot do the thing — but it also never silently
/// believes a reminder was set.
final Provider<core.NotificationService> notificationServiceProvider =
    Provider<core.NotificationService>(
      (ref) => createLocalNotificationService(),
    );

/// 🪦 SUBLY'S FROZEN NOTIFICATION FORK, renamed from `notificationServiceProvider`.
///
/// Behaviour unchanged; only the name moved, because the old name is the
/// chassis's. It stays a separate provider rather than being folded into the
/// chassis one because the two have DIFFERENT INTERFACES — this one exposes
/// `requestPermissions()` (plural), `scheduleWeeklyDigest()` and the renewal
/// scheduling `subscriptions_controller.dart` drives; `core.NotificationService`
/// exposes `requestPermission()` (singular) and `scheduleDaily`.
///
/// Consumers re-pointed with this rename (7 call sites, 5 files) are listed in
/// MANIFEST.md §4. De-forking is [pipeline 2]C-3's work item, not this merge's.
final Provider<NotificationService> sublyNotificationServiceProvider =
    Provider<NotificationService>((ref) => NotificationService.instance);

const String _remindersKey = 'nikatru.reminders_enabled';

/// The id of the one daily reminder the chassis schedules.
///
/// STABLE ON PURPOSE: `scheduleDaily` replaces an existing notification with the
/// same id, so re-arming it can never accumulate duplicates, and the OFF path
/// has something specific to cancel.
const int kDailyReminderId = 1;

/// Whether the user has turned the CHASSIS reminder on, persisted.
///
/// [pipeline C-13] Separate from the OS permission on purpose. The OS can revoke
/// permission at any time from system settings, and the app finds out only when
/// it next tries — so this stores the user's INTENT, and the platform's answer
/// is asked for fresh each time it matters. Conflating the two is how a toggle
/// reads ON while every notification is silently dropped.
///
/// ⚠️ SUBLY HAS ITS OWN REMINDER RAIL (`settings_controller.dart` +
/// `subscriptions_controller.dart` over the fork). Both rails now exist in this
/// tree. That is a REAL product question, not a merge artifact — MANIFEST.md §7
/// carries it as an open question for P2.6b, where the settings surface merges
/// and one of the two toggles has to be the one the user sees.
class RemindersEnabledController extends Notifier<bool> {
  bool _userChose = false;

  @override
  bool build() {
    _hydrate();
    return false;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final bool stored = (await kv.read(_remindersKey)) == 'true';
      if (_userChose) return; // the user got there first — never clobber
      state = stored;
    } catch (_) {
      // Unreadable store ⇒ reminders off. Never throw at launch.
    }
  }

  Future<void> set(bool on) async {
    _userChose = true;
    state = on;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_remindersKey, on ? 'true' : 'false');
    } catch (_) {
      // Best-effort: a failed write only means the choice resets next launch.
    }
    // 🔴 OFF IS A PROMISE ABOUT THE OS, NOT ABOUT A BOOLEAN. Until this line the
    // only route to `cancelAll` was `applyReminderChoice`, reachable from exactly
    // one `SwitchListTile.onChanged` — so ANY second writer of the flag set the
    // switch to OFF and left every schedule armed. The reconciler hangs off the
    // STORED INTENT now, so whoever writes it, the OS is told.
    //
    // The ON direction deliberately does NOT schedule here: a reminder carries
    // USER-FACING text that only `AppLocalizations` can supply, and this layer
    // has no `BuildContext`. Under-scheduling is the safe failure — the boot-path
    // reconciler ([resyncOnStart]) closes it on the very next launch, and the
    // opposite mistake is notifying somebody who asked you not to.
    if (!on) await _cancelSchedules();
  }

  /// The one place anything is cancelled. Never throws: it is reached from a
  /// settings write and from the boot path, and neither may take the app down.
  Future<void> _cancelSchedules() async {
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    try {
      // `init()` first: cancel is undefined before the plugin is initialised.
      await svc.init();
      // cancelAll, not cancel(kDailyReminderId): "reminders off" is a promise
      // about all of them, including any an app schedules on top of the chassis.
      await svc.cancelAll();
    } catch (_) {
      // A platform channel that is not there must not become a crash.
    }
  }

  /// Reconcile the OS schedule with the PERSISTED intent, at start-up.
  ///
  /// 🔴 THIS IS THE REBOOT, DST AND TIMEZONE-CHANGE REPAIR PATH, and it is why
  /// no native `RECEIVE_BOOT_COMPLETED` receiver is stamped: the brick ships no
  /// native folders, so the only portable repair is to re-arm from the app's own
  /// start-up. An Android reboot drops every pending alarm; a DST transition or a
  /// flight moves the wall-clock hour a fixed-offset schedule was built against.
  ///
  /// It is also the OFF repair path — an intent of `false` re-asserts the cancel,
  /// so a store restored from a backup that carries OFF cannot leave a schedule
  /// alive from the install that made it.
  ///
  /// ⚠️ IT NEVER CALLS `requestPermission()`, and the property test asserts the
  /// count is zero across a full boot. Android 13+ makes a SECOND denial
  /// permanent (`USER_FIXED`, non-promptable), so spending the ask on a launch
  /// the user did not initiate can burn the permission for the life of the
  /// install.
  ///
  /// Idempotent: `scheduleDaily` replaces by [kDailyReminderId], so re-arming on
  /// every launch can never accumulate a second pending notification.
  Future<void> resyncOnStart({
    required String title,
    required String body,
  }) async {
    final bool intent;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      intent = (await kv.read(_remindersKey)) == 'true';
    } catch (_) {
      // An unreadable store is NOT a reason to cancel: it is a reason to change
      // nothing. Cancelling here would turn a transient disk error into a
      // silently disabled feature.
      return;
    }
    if (!intent) {
      await _cancelSchedules();
      return;
    }
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    try {
      await svc.init();
      await svc.scheduleDaily(
        core.DailyReminder(
          id: kDailyReminderId,
          title: title,
          body: body,
          hour: AppConfig.reminderHour,
          minute: AppConfig.reminderMinute,
        ),
      );
    } catch (_) {
      // Never throw on the boot path.
    }
  }

  /// Apply the user's choice FOR REAL: the persisted intent AND the OS schedule.
  ///
  /// 🔴 THIS METHOD IS THE DEFECT THAT WAS FIXED. The toggle used to call
  /// `requestPermission()` and store the answer, and nothing else — so every
  /// stamped app primed the user, spent the ONE OS permission prompt most
  /// platforms ever grant, showed the switch as ON, and then never scheduled a
  /// single notification. It was invisible to the suite because the tests
  /// asserted flag persistence, which was working perfectly.
  ///
  /// [title] and [body] are parameters because the notification is USER-FACING
  /// text and must come from `AppLocalizations`, which needs a `BuildContext`
  /// this layer does not have.
  ///
  /// Returns what actually happened, which is NOT the same as what was asked
  /// for: the OS can refuse permission, and the switch must then read OFF.
  Future<bool> applyReminderChoice({
    required bool on,
    required String title,
    required String body,
  }) async {
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    // `init()` first in BOTH directions: it loads the timezone database and
    // initialises the plugin, and every other call — cancel included — is
    // undefined without it. It is idempotent, so calling it twice costs nothing.
    await svc.init();
    if (!on) {
      // The cancel lives in `set`, not here, ON PURPOSE — see the comment there.
      await set(false);
      return false;
    }
    final bool granted = await svc.requestPermission();
    if (granted) {
      await svc.scheduleDaily(
        core.DailyReminder(
          id: kDailyReminderId,
          title: title,
          body: body,
          hour: AppConfig.reminderHour,
          minute: AppConfig.reminderMinute,
        ),
      );
    }
    // The OS decides, not the switch. Storing `true` after a refusal is the
    // toggle-lies-about-the-feature shape the class doc above is about.
    await set(granted);
    return granted;
  }
}

final NotifierProvider<RemindersEnabledController, bool>
remindersEnabledProvider = NotifierProvider<RemindersEnabledController, bool>(
  RemindersEnabledController.new,
);

const String _lastNudgeShownKey = 'nikatru.last_nudge_shown_at';

/// When the in-app catch-up nudge was last shown, persisted — [pipeline T-8].
///
/// 🔴 THE HALF OF THE REMINDER PROMISE THE OS CANNOT KEEP. Three of the six
/// platforms cannot schedule a repeating local notification and **no version of
/// the pinned plugin family can** — Windows throws on repeating notifications,
/// Linux has no scheduler API, browsers support neither — and web is the only
/// live platform today.
///
/// It is a STANDING part of the chassis, not a bridge to a plugin release, and
/// the mechanism is deliberately the humblest one that works: no background
/// work, no polling, no wake-up the OS refuses to grant.
///
/// Null means "never shown", and the decision itself lives in
/// [core.CatchUpNudge] so every platform row — including the web row, which
/// `kIsWeb` makes unreachable from a widget test — is decidable from a unit test.
class CatchUpNudgeController extends Notifier<DateTime?> {
  bool _marked = false;

  @override
  DateTime? build() {
    _hydrate();
    return null;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(_lastNudgeShownKey);
      if (_marked) return; // a nudge shown while we were reading wins
      if (raw == null) return;
      final DateTime? parsed = DateTime.tryParse(raw);
      if (parsed != null) state = parsed;
    } catch (_) {
      // Unreadable store ⇒ "never shown". The worst case is one extra nudge,
      // which is strictly better than crashing at launch.
    }
  }

  /// Record that the nudge has been shown for the current occurrence.
  Future<void> markShown(DateTime at) async {
    _marked = true;
    state = at;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      // Stored in UTC and compared in local time by [core.CatchUpNudge]: an
      // ISO-8601 string without a zone is ambiguous the moment the device
      // travels, and this is exactly the family of bug that made a 09:00
      // reminder fire at 14:30 IST.
      await kv.write(_lastNudgeShownKey, at.toUtc().toIso8601String());
    } catch (_) {
      // Best-effort: a failed write means at most one repeated nudge.
    }
  }
}

final NotifierProvider<CatchUpNudgeController, DateTime?> catchUpNudgeProvider =
    NotifierProvider<CatchUpNudgeController, DateTime?>(
      CatchUpNudgeController.new,
    );
