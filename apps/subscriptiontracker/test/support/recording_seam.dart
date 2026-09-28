import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart' as core;

/// A core notification seam that models the OS queue: what is pending, by id.
///
/// ⏱ 2026-09-28 (ST-R4): the app no longer wraps the plugin, so its reminder
/// tests stop at the seam — [RenewalReminders] is proven against THIS, and the
/// plugin half (exact alarms, the pending list, the Windows identity) is
/// proven in packages/notifications/test against a fake port.
class RecordingSeam implements core.NotificationService {
  RecordingSeam({this.granted = true});

  /// What [requestPermission] answers.
  bool granted;
  int permissionAsks = 0;

  /// The one-offs the "OS" holds, by id.
  final Map<int, core.ScheduledNotification> pending =
      <int, core.ScheduledNotification>{};

  /// Ids someone ELSE scheduled on the same plugin (the chassis daily reminder).
  final Set<int> foreign = <int>{};
  final List<String> calls = <String>[];

  final StreamController<core.NotificationTap> taps =
      StreamController<core.NotificationTap>.broadcast();

  /// The tap that "launched" the process, handed out once.
  core.NotificationTap? launch;

  Set<int> get allIds => <int>{...pending.keys, ...foreign};

  @override
  Future<void> init() async => calls.add('init');

  @override
  Future<bool> requestPermission() async {
    permissionAsks++;
    return granted;
  }

  @override
  Future<void> showNow({required String title, required String body}) async {}

  @override
  Future<void> scheduleDaily(core.DailyReminder reminder) async =>
      foreign.add(reminder.id);

  @override
  Future<void> scheduleAt(core.ScheduledNotification notification) async =>
      pending[notification.id] = notification;

  @override
  Future<void> reconcile(
    List<core.ScheduledNotification> wanted, {
    required bool Function(int id) owns,
  }) async {
    calls.add('reconcile');
    pending.removeWhere((int id, _) => owns(id));
    foreign.removeWhere(owns);
    for (final core.ScheduledNotification n in wanted) {
      pending[n.id] = n;
    }
  }

  @override
  Future<void> cancel(int id) async {
    calls.add('cancel:$id');
    pending.remove(id);
    foreign.remove(id);
  }

  @override
  Future<void> cancelAll() async {
    calls.add('cancelAll');
    pending.clear();
    foreign.clear();
  }

  @override
  Stream<core.NotificationTap> notificationTaps() => taps.stream;

  @override
  Future<core.NotificationTap?> takeLaunchTap() async {
    final core.NotificationTap? t = launch;
    launch = null;
    return t;
  }
}
