import 'dart:io';

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform;

import 'linux_reminders.dart';

/// The `dart:io` half of NO-04 — never exported from the barrel, so a web
/// build never sees `dart:io`; reached through `createLinuxAutostart` and the
/// io notification factory.

/// `$XDG_CONFIG_HOME`, else `~/.config` — the XDG base-directory default.
String? xdgConfigHome([Map<String, String>? env]) {
  final Map<String, String> e = env ?? Platform.environment;
  final String? config = e['XDG_CONFIG_HOME'];
  if (config != null && config.isNotEmpty) return config;
  final String? home = e['HOME'];
  return home == null || home.isEmpty ? null : '$home/.config';
}

/// `$XDG_DATA_HOME`, else `~/.local/share`.
String? xdgDataHome([Map<String, String>? env]) {
  final Map<String, String> e = env ?? Platform.environment;
  final String? data = e['XDG_DATA_HOME'];
  if (data != null && data.isNotEmpty) return data;
  final String? home = e['HOME'];
  return home == null || home.isEmpty ? null : '$home/.local/share';
}

/// The reminder ledger as a JSON file — `<data home>/<appId>/reminders.json`.
class FileReminderLedgerStore implements ReminderLedgerStore {
  FileReminderLedgerStore(this.path);

  final String path;

  @override
  Future<String?> read() async {
    final File f = File(path);
    return await f.exists() ? f.readAsString() : null;
  }

  @override
  Future<void> write(String json) async {
    final File f = File(path);
    await f.parent.create(recursive: true);
    // Write-then-rename: a login-time `--remind` reading while the app writes
    // sees the old ledger or the new one, never half of one.
    final File tmp = File('$path.tmp');
    await tmp.writeAsString(json, flush: true);
    await tmp.rename(path);
  }
}

/// The XDG autostart entry (freedesktop "Desktop Application Autostart"
/// spec): `<config home>/autostart/<appId>.desktop`, whose `Exec` runs the
/// app with [kRemindArgument]. Created on opt-in and removed on opt-out, so a
/// user who turns reminders off leaves nothing behind that runs at login.
class LinuxAutostart implements LinuxAutostartControl {
  LinuxAutostart({
    required this.appId,
    required this.appName,
    required this.executable,
    required String configHome,
  }) : path = '$configHome/autostart/$appId.desktop';

  /// A file-name-safe id, e.g. `in.nikatru.subly`.
  final String appId;
  final String appName;

  /// The absolute path of the app's binary.
  final String executable;

  @override
  final String path;

  /// The entry's text. `Exec` quotes the binary (the spec's quoting rules)
  /// so a path with a space still runs; `NoDisplay` keeps it out of menus.
  String get desktopEntry => <String>[
    '[Desktop Entry]',
    'Type=Application',
    'Name=$appName reminders',
    'Exec="${executable.replaceAll(r'\', r'\\').replaceAll('"', r'\"')}" '
        '$kRemindArgument',
    'NoDisplay=true',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');

  @override
  Future<void> enable() async {
    final File f = File(path);
    await f.parent.create(recursive: true);
    await f.writeAsString(desktopEntry, flush: true);
  }

  @override
  Future<void> disable() async {
    final File f = File(path);
    if (await f.exists()) await f.delete();
  }

  @override
  Future<bool> isEnabled() => File(path).exists();
}

/// Whether THIS process is the login-time `--remind` run (NO-04): the Linux
/// runner sets [kRemindEnvironment] for it.
bool ioIsRemindLaunch() =>
    Platform.isLinux && Platform.environment[kRemindEnvironment] == '1';

/// The running binary's name — the default app id where none is given.
String defaultLinuxAppId() {
  final String exe = Platform.resolvedExecutable;
  final int slash = exe.lastIndexOf('/');
  return slash < 0 ? exe : exe.substring(slash + 1);
}

/// Whether this process is a `flutter test` run (the tool sets FLUTTER_TEST).
///
/// 🔴 A WIDGET TEST ON A LINUX HOST UNDER `TargetPlatform.linux` (the a11y
/// sweeps' platform variants) would otherwise reach the REAL home directory:
/// write the developer's or the runner's `~/.config/autostart`, and await
/// file I/O inside the fake-async zone, which never completes and leaves
/// every screen on its skeleton. Tests that mean to exercise the disk inject
/// a [FileReminderLedgerStore] or a [LinuxAutostart] over a temp directory.
bool get isFlutterTest => Platform.environment.containsKey('FLUTTER_TEST');

/// The ledger the service and the `--remind` entry share, or null where the
/// host names no data directory. In memory under `flutter test`.
ReminderLedgerStore? defaultLinuxLedger(String appId) {
  if (isFlutterTest) return MemoryReminderLedgerStore();
  final String? data = xdgDataHome();
  return data == null
      ? null
      : FileReminderLedgerStore('$data/$appId/reminders.json');
}

/// The autostart entry for THIS process on Linux, or null anywhere else.
LinuxAutostartControl? createIoLinuxAutostart({
  String? appId,
  required String appName,
}) {
  // BOTH: the host is Linux AND Flutter targets Linux. A widget test runs on
  // a Linux host under `TargetPlatform.android`, and must never write to the
  // real ~/.config/autostart.
  if (!Platform.isLinux ||
      defaultTargetPlatform != TargetPlatform.linux ||
      isFlutterTest) {
    return null;
  }
  final String? config = xdgConfigHome();
  if (config == null) return null;
  return LinuxAutostart(
    appId: appId ?? defaultLinuxAppId(),
    appName: appName,
    executable: Platform.resolvedExecutable,
    configHome: config,
  );
}
