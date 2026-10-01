// SECTION G of the spine — notifications: the shared inbound tap seam, the
// chassis service, Subly's renewal reminders over it, the daily-reminder rail
// and the catch-up nudge. Re-exported from `../providers.dart`.
//
// [notificationTapSourceProvider] stood at the tail of SECTION F (identity) and
// is carried here, with the rest of the notification wiring it belongs to.

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show PersistedValue;
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show DioReminderChannelsTransport;
import 'package:nikatru_notifications/nikatru_notifications.dart';

import '../../core/app_config.dart';
import '../../core/windows_notification_identity.g.dart';
import '../../services/notifications/notification_service.dart';
import '../subscriptions_controller.dart' show reminderCopyFor;
import '../analytics_providers.dart';
import 'analytics_envelope.dart' show kPlatformBaseUrl;

/// 🔴 [13]T-9 — the shared seam's INBOUND half: the taps.
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
/// behaviour and moved to [renewalRemindersProvider] — see note 3 in the
/// file header for the three pieces of evidence that forced the direction.
///
/// [pipeline C-2/C-7] Platform reality is DECLARED, not assumed — see
/// [NotificationCapabilities]: Android/iOS/macOS show and schedule; Linux
/// shows and schedules inexactly through the package's ledger (NO-04); Windows
/// needs the app's identity; Web has no plugin at all. Unsupported calls degrade to a safe no-op, so a caller never
/// crashes on a platform that cannot do the thing — but it also never silently
/// believes a reminder was set.
/// The ONE adapter `main()` initialises (ST-R4): the chassis call, plus what
/// Subly adds to it. [kWindowsNotificationIdentity] is the toast identity from
/// app.yaml (without it Windows has no notifications at all); [AppConfig.appId]
/// names the Linux ledger (NO-04); and Apple registers a notification's buttons
/// by category once, at initialize, so their words are rendered here in the
/// language the app opens in — an in-app language change reaches iOS/macOS at
/// the next launch, while Android and Windows carry them per notification
/// (NO-10). Here rather than in `main.dart`, a chassis fork held at its
/// ceiling (tooling/chassis-parity.json).
core.NotificationService createLaunchNotificationService() =>
    createLocalNotificationService(
      windows: kWindowsNotificationIdentity,
      linuxAppId: AppConfig.appId,
      darwinActions: RenewalReminders.actionsFor(reminderCopyFor(null)),
    );

final Provider<core.NotificationService> notificationServiceProvider =
    Provider<core.NotificationService>(
      (ref) =>
          createLocalNotificationService(windows: kWindowsNotificationIdentity),
    );

/// What THIS build can deliver on THIS platform — the chassis matrix, less
/// Windows when the app carries no identity. The same inputs the adapter above
/// was built from, so the settings rows and the scheduler cannot disagree. A
/// provider so a test can pin a platform.
final Provider<NotificationCapabilities> notificationCapabilitiesProvider =
    Provider<NotificationCapabilities>(
      (ref) => NotificationCapabilities.resolve(
        defaultTargetPlatform,
        isWeb: kIsWeb,
        windows: kWindowsNotificationIdentity,
      ),
    );

/// Subly's renewal reminders — the domain half, over the ONE chassis adapter.
///
/// ⏱ 2026-09-28 (ST-R4): this was `renewalRemindersProvider`,
/// a 764-line fork of the seam that wrapped the notification plugin a second
/// time. It now schedules THROUGH [notificationServiceProvider] — the instance
/// `main.dart` initialised and overrode — so there is one plugin registration
/// in the process and the reminders it posts are tappable by construction.
final Provider<RenewalReminders> renewalRemindersProvider =
    Provider<RenewalReminders>(
      (ref) => RenewalReminders(
        service: ref.watch(notificationServiceProvider),
        capabilities: ref.watch(notificationCapabilitiesProvider),
      ),
    );

/// Whether the email and calendar rows exist in this build: they need the
/// platform Worker, so a live backend. A provider so a widget test can show them.
final Provider<bool> reminderChannelsAvailableProvider = Provider<bool>(
  (ref) => AppConfig.isBackendLive,
);

/// The ST-T4a client — email reminder prefs and the calendar feed, on the
/// shared platform Worker. Discards to the unavailable transport off a live
/// backend, so a demo build and every widget test are hermetic.
final Provider<core.ReminderChannelsTransport>
reminderChannelsTransportProvider = Provider<core.ReminderChannelsTransport>(
  (ref) => AppConfig.isBackendLive
      ? DioReminderChannelsTransport(platformBaseUrl: kPlatformBaseUrl)
      : const core.UnavailableReminderChannelsTransport(),
);

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
/// `subscriptions_controller.dart` over [renewalRemindersProvider]). Both rails now exist in this
/// tree. That is a REAL product question, not a merge artifact — MANIFEST.md §7
/// carries it as an open question for P2.6b, where the settings surface merges
/// and one of the two toggles has to be the one the user sees.
class RemindersEnabledController extends Notifier<bool> {
  /// Hydration never overwrites a live choice: [PersistedValue] says why.
  late final PersistedValue<core.KeyValueStore, bool> _stored =
      PersistedValue<core.KeyValueStore, bool>(
        open: () => ref.read(keyValueStoreProvider.future),
        read: (kv) => kv.read(_remindersKey),
        write: (kv, raw) => kv.write(_remindersKey, raw),
        decode: (raw) => raw == 'true',
        encode: (on) => on ? 'true' : 'false',
        apply: (on) => state = on,
        mounted: () => ref.mounted,
      );

  @override
  bool build() {
    // Unreadable store ⇒ reminders off. Never throw at launch.
    _stored.hydrate();
    return false;
  }

  Future<void> set(bool on) async {
    await _stored.set(on);
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
  ///
  /// 🔴 `cancel(kDailyReminderId)`, NOT `cancelAll()`. This used to say the
  /// opposite — "reminders off is a promise about all of them, including any
  /// an app schedules on top" — and that sentence was the defect: the chassis
  /// service and the app's own `RenewalReminders` share ONE
  /// `FlutterLocalNotificationsPlugin` singleton, so this `cancelAll()` took
  /// every renewal reminder with it. And it ran at EVERY launch: the stored
  /// intent defaults to false, so [resyncOnStart] reached here on a fresh
  /// install and wiped the renewal set the controller had just scheduled.
  /// The app's renewal reminders have their own switch ("Renewal alerts")
  /// and their own owner; this one cancels the one id it schedules.
  Future<void> _cancelSchedules() async {
    // Riverpod 3: a provider gone by now cannot reach the service; the stored
    // OFF is what [resyncOnStart] cancels from at the next launch.
    if (!ref.mounted) return;
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    try {
      // `init()` first: cancel is undefined before the plugin is initialised.
      await svc.init();
      await svc.cancel(kDailyReminderId);
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
  /// A nudge shown while the read is in flight wins: see [PersistedValue].
  late final PersistedValue<core.KeyValueStore, DateTime?> _stored =
      PersistedValue<core.KeyValueStore, DateTime?>(
        open: () => ref.read(keyValueStoreProvider.future),
        read: (kv) => kv.read(_lastNudgeShownKey),
        write: (kv, raw) => kv.write(_lastNudgeShownKey, raw),
        decode: (raw) => raw == null ? null : DateTime.tryParse(raw),
        // Stored in UTC and compared in local time by [core.CatchUpNudge]: an
        // ISO-8601 string without a zone is ambiguous the moment the device
        // travels, and this is exactly the family of bug that made a 09:00
        // reminder fire at 14:30 IST.
        encode: (at) => at!.toUtc().toIso8601String(),
        apply: (at) => state = at,
        mounted: () => ref.mounted,
      );

  @override
  DateTime? build() {
    // Unreadable store ⇒ "never shown": at worst one extra nudge.
    _stored.hydrate();
    return null;
  }

  /// Record that the nudge has been shown for the current occurrence.
  Future<void> markShown(DateTime at) => _stored.set(at);
}

final NotifierProvider<CatchUpNudgeController, DateTime?> catchUpNudgeProvider =
    NotifierProvider<CatchUpNudgeController, DateTime?>(
      CatchUpNudgeController.new,
    );

// ── NO-04 · NO-12 ────────────────────────────────────────────────────────────

/// NO-04: the XDG autostart entry that shows due reminders at login — Linux
/// only, null everywhere else (web included). "Renewal alerts" ON creates it
/// and OFF removes it (SettingsController.toggle). A provider so a test can
/// hand in one over a temp directory.
final Provider<LinuxAutostartControl?> linuxAutostartProvider =
    Provider<LinuxAutostartControl?>(
      (ref) => createLinuxAutostart(
        appId: AppConfig.appId,
        appName: AppConfig.appName,
      ),
    );

/// NO-12: Android's "Alarms & reminders" access, or null where the service
/// has none (the no-op seam, web).
final Provider<ExactAlarmAccess?> exactAlarmAccessProvider =
    Provider<ExactAlarmAccess?>((ref) {
      final core.NotificationService svc = ref.watch(
        notificationServiceProvider,
      );
      return svc is ExactAlarmAccess ? svc as ExactAlarmAccess : null;
    });

/// Whether this target has an exact-alarm permission to offer: Android only.
/// A provider so a widget test can stand on Android.
final Provider<bool> offersExactAlarmsProvider = Provider<bool>(
  (ref) => !kIsWeb && defaultTargetPlatform == TargetPlatform.android,
);

const String _exactAlarmOfferKey = 'nikatru.exact_alarm_offer';

/// NO-12: the answer to the ONE "Alarms & reminders" offer — null = never
/// offered, else `granted` or `refused`. Persisted, because "once" is per
/// install, not per launch; a refusal is what Settings says "reminders may
/// arrive a little late" about.
class ExactAlarmOfferController extends Notifier<String?> {
  static const String granted = 'granted';
  static const String refused = 'refused';

  late final PersistedValue<core.KeyValueStore, String?> _stored =
      PersistedValue<core.KeyValueStore, String?>(
        open: () => ref.read(keyValueStoreProvider.future),
        read: (kv) => kv.read(_exactAlarmOfferKey),
        write: (kv, raw) => kv.write(_exactAlarmOfferKey, raw),
        decode: (raw) => raw,
        encode: (answer) => answer ?? '',
        apply: (answer) => state = answer,
        mounted: () => ref.mounted,
      );

  @override
  String? build() {
    _stored.hydrate();
    return null;
  }

  /// Whether the offer was ever answered — read from the store, so a launch
  /// whose hydration is still in flight cannot offer it twice.
  Future<bool> wasOffered() async {
    if (state != null) return true;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(_exactAlarmOfferKey);
      return raw != null && raw.isNotEmpty;
    } catch (_) {
      // An unreadable store: do not nag; offering is a nicety.
      return true;
    }
  }

  Future<void> record(String answer) => _stored.set(answer);
}

final NotifierProvider<ExactAlarmOfferController, String?>
exactAlarmOfferProvider = NotifierProvider<ExactAlarmOfferController, String?>(
  ExactAlarmOfferController.new,
);
