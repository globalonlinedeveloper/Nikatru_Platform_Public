import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show debugPrint, visibleForTesting;

/// Where the Linux reminder ledger is kept — a seam so the scheduler stays
/// pure Dart and a test can hold the ledger in memory. The io implementation
/// (`linux_autostart.dart`) is a JSON file under `$XDG_DATA_HOME`.
abstract interface class ReminderLedgerStore {
  /// The stored ledger, or null when there is none yet.
  Future<String?> read();
  Future<void> write(String json);
}

/// An in-memory [ReminderLedgerStore] — tests, and a host with no data dir.
class MemoryReminderLedgerStore implements ReminderLedgerStore {
  MemoryReminderLedgerStore([this.contents]);

  String? contents;

  @override
  Future<String?> read() async => contents;

  @override
  Future<void> write(String json) async => contents = json;
}

/// Shows one reminder now — the plugin's immediate `show`, which Linux has.
typedef ShowReminder =
    Future<void> Function(int id, String title, String body, String? payload);

/// Arms a callback after a delay — `Timer.new`, injected so a FAKE CLOCK can
/// drive the scheduler from a test.
typedef ReminderTimerFactory =
    Timer Function(Duration delay, void Function() fire);

/// One reminder the Linux scheduler owes the user.
class LinuxLedgerEntry {
  const LinuxLedgerEntry({
    required this.id,
    required this.title,
    required this.body,
    required this.at,
    this.payload,
  });

  final int id;
  final String title;
  final String body;
  final DateTime at;
  final String? payload;

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'title': title,
    'body': body,
    // An instant, not a wall clock: the device zone was applied when the
    // reminder was planned, and a login-time `--remind` process must not
    // re-read it in a zone that has since changed under it.
    'at': at.toUtc().millisecondsSinceEpoch,
    if (payload != null) 'payload': payload,
  };

  /// Null for a malformed row: a corrupt ledger costs that row, never launch.
  static LinuxLedgerEntry? fromJson(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final Object? id = json['id'];
    final Object? title = json['title'];
    final Object? body = json['body'];
    final Object? at = json['at'];
    final Object? payload = json['payload'];
    if (id is! int || title is! String || body is! String || at is! int) {
      return null;
    }
    return LinuxLedgerEntry(
      id: id,
      title: title,
      body: body,
      at: DateTime.fromMillisecondsSinceEpoch(at, isUtc: true),
      payload: payload is String ? payload : null,
    );
  }
}

/// Renewal reminders on LINUX, where `flutter_local_notifications` can show
/// but has no `zonedSchedule` — NO-04.
///
/// 🔴 THREE WAYS A DUE REMINDER IS SHOWN, AND NO DAEMON.
///  1. **While the app runs** — one timer to the nearest entry; when it fires,
///     everything due is shown and the timer is re-armed.
///  2. **At launch** — [showDue] from `init()`: anything that fell due while
///     the app was closed is shown once, as a catch-up.
///  3. **At login** — the XDG autostart entry ([LinuxAutostart]) runs the
///     app's headless `--remind`, which is [showDue] and exit.
/// Every schedule is written to the [ReminderLedgerStore] first, which is what
/// lets (2) and (3) see what (1) was holding. A reminder due while the user is
/// logged out shows at the next login or launch — hence `exactTime: false`.
///
/// Shown entries leave the ledger, so a reminder is shown ONCE whichever of the
/// three reaches it first.
class LinuxReminderScheduler {
  LinuxReminderScheduler({
    required ReminderLedgerStore store,
    required ShowReminder show,
    DateTime Function()? now,
    ReminderTimerFactory? timer,
  }) : _store = store,
       _show = show,
       _now = now ?? DateTime.now,
       _timer = timer ?? Timer.new;

  final ReminderLedgerStore _store;
  final ShowReminder _show;
  final DateTime Function() _now;
  final ReminderTimerFactory _timer;
  Timer? _armed;

  /// 🔴 THE LONGEST SINGLE WAIT. A `Timer` counts monotonic time, which stops
  /// while the machine is suspended, so a timer armed for 09:00 at 22:00 and
  /// suspended overnight would fire hours late. Re-checking against the wall
  /// clock at least this often bounds that lateness; it is not a poll for
  /// work — when nothing is due it only re-arms.
  @visibleForTesting
  static const Duration maxWait = Duration(minutes: 15);

  Future<List<LinuxLedgerEntry>> _read() async {
    final String? raw;
    try {
      raw = await _store.read();
    } on Object catch (e) {
      debugPrint('[notifications] linux ledger unreadable: $e');
      return <LinuxLedgerEntry>[];
    }
    if (raw == null || raw.isEmpty) return <LinuxLedgerEntry>[];
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! List<Object?>) return <LinuxLedgerEntry>[];
      return <LinuxLedgerEntry>[
        for (final Object? row in decoded)
          if (LinuxLedgerEntry.fromJson(row) case final LinuxLedgerEntry e) e,
      ];
    } on FormatException {
      return <LinuxLedgerEntry>[];
    }
  }

  Future<void> _write(List<LinuxLedgerEntry> entries) => _store.write(
    jsonEncode(<Map<String, Object?>>[
      for (final LinuxLedgerEntry e in entries) e.toJson(),
    ]),
  );

  /// Holds [id] for [at], replacing any entry with the same id, and re-arms.
  Future<void> schedule(
    int id,
    String title,
    String body,
    DateTime at, {
    String? payload,
  }) async {
    final List<LinuxLedgerEntry> entries = await _read()
      ..removeWhere((LinuxLedgerEntry e) => e.id == id);
    entries.add(
      LinuxLedgerEntry(
        id: id,
        title: title,
        body: body,
        at: at,
        payload: payload,
      ),
    );
    await _write(entries);
    await _rearm(entries);
  }

  Future<void> cancel(int id) async {
    final List<LinuxLedgerEntry> entries = await _read();
    final int before = entries.length;
    entries.removeWhere((LinuxLedgerEntry e) => e.id == id);
    if (entries.length != before) await _write(entries);
    await _rearm(entries);
  }

  Future<void> cancelAll() async {
    await _write(const <LinuxLedgerEntry>[]);
    _armed?.cancel();
    _armed = null;
  }

  /// The ids the ledger holds — what `reconcile` diffs against.
  Future<List<int>> pendingIds() async => <int>[
    for (final LinuxLedgerEntry e in await _read()) e.id,
  ];

  /// Shows every entry due by now, nearest first, removes them from the
  /// ledger, and returns how many were shown. The launch catch-up and the
  /// headless `--remind` entry are both this.
  Future<int> showDue() async {
    final DateTime now = _now();
    final List<LinuxLedgerEntry> entries = await _read();
    final List<LinuxLedgerEntry> due =
        entries.where((LinuxLedgerEntry e) => !e.at.isAfter(now)).toList()
          ..sort(
            (LinuxLedgerEntry a, LinuxLedgerEntry b) => a.at.compareTo(b.at),
          );
    if (due.isEmpty) return 0;
    // Out of the ledger FIRST: a show that throws half-way must not leave a
    // reminder to be shown again at every launch.
    await _write(
      entries.where((LinuxLedgerEntry e) => e.at.isAfter(now)).toList(),
    );
    for (final LinuxLedgerEntry e in due) {
      try {
        await _show(e.id, e.title, e.body, e.payload);
      } on Object catch (err) {
        debugPrint('[notifications] linux reminder ${e.id} not shown: $err');
      }
    }
    return due.length;
  }

  /// Arms the in-process timer from the ledger — call once after [showDue] at
  /// launch.
  Future<void> start() async => _rearm(await _read());

  Future<void> _rearm(List<LinuxLedgerEntry> entries) async {
    _armed?.cancel();
    _armed = null;
    if (entries.isEmpty) return;
    final DateTime next = entries
        .map((LinuxLedgerEntry e) => e.at)
        .reduce((DateTime a, DateTime b) => a.isBefore(b) ? a : b);
    Duration wait = next.difference(_now());
    if (wait.isNegative) wait = Duration.zero;
    if (wait > maxWait) wait = maxWait;
    _armed = _timer(wait, () {
      _armed = null;
      unawaited(_fire());
    });
  }

  Future<void> _fire() async {
    await showDue();
    await start();
  }

  /// Stops the in-process timer. The ledger stays: login and the next launch
  /// still show what it holds.
  void dispose() {
    _armed?.cancel();
    _armed = null;
  }
}

/// The XDG autostart entry that shows due reminders at login — the opt-in half
/// of NO-04. A pure interface so the app can hold one on every target (null
/// off Linux) without importing `dart:io` into a web build.
abstract interface class LinuxAutostartControl {
  /// Where the `.desktop` entry lives (`~/.config/autostart/<app>.desktop`).
  String get path;

  /// Creates the entry. Called when the user turns reminders ON.
  Future<void> enable();

  /// Removes it. Called when the user turns reminders OFF.
  Future<void> disable();

  Future<bool> isEnabled();
}

/// The argument the autostart entry passes: show due reminders, then exit.
const String kRemindArgument = '--remind';

/// The environment variable the Linux runner sets for a [kRemindArgument]
/// launch, so the Dart side can tell without `main()` taking arguments.
const String kRemindEnvironment = 'NIKATRU_REMIND';
