import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
// The io half is not exported from the barrel (web stays compilable); tests
// run natively, where `dart:io` exists.
import 'package:nikatru_notifications/src/linux_autostart.dart';

void main() {
  group('LinuxAutostart (NO-04: the login-time --remind entry)', () {
    late Directory home;

    setUp(() => home = Directory.systemTemp.createTempSync('autostart_'));
    tearDown(() => home.deleteSync(recursive: true));

    LinuxAutostart entry() => LinuxAutostart(
      appId: 'in.nikatru.subly',
      appName: 'Subly',
      executable: '/opt/subly dir/subly',
      configHome: '${home.path}/.config',
    );

    test(
      'RED CONTROL: the file appears on opt-in and disappears on opt-out',
      () async {
        final LinuxAutostart a = entry();
        final File f = File(
          '${home.path}/.config/autostart/in.nikatru.subly.desktop',
        );
        expect(a.path, f.path);
        expect(f.existsSync(), isFalse);
        expect(await a.isEnabled(), isFalse);

        await a.enable();
        expect(f.existsSync(), isTrue);
        expect(await a.isEnabled(), isTrue);
        final String text = f.readAsStringSync();
        expect(text, startsWith('[Desktop Entry]\n'));
        expect(text, contains('Type=Application'));
        // The binary is quoted (a space in the path still runs) and passed the
        // headless argument — no daemon, nothing that stays resident.
        expect(text, contains('Exec="/opt/subly dir/subly" --remind'));
        expect(text, contains('NoDisplay=true'));

        await a.disable();
        expect(f.existsSync(), isFalse);
        expect(await a.isEnabled(), isFalse);
        // Opting out twice is not an error.
        await a.disable();
      },
    );

    test('XDG_CONFIG_HOME wins; else ~/.config; else nothing', () {
      expect(
        xdgConfigHome(<String, String>{'XDG_CONFIG_HOME': '/x', 'HOME': '/h'}),
        '/x',
      );
      expect(xdgConfigHome(<String, String>{'HOME': '/h'}), '/h/.config');
      expect(xdgConfigHome(<String, String>{}), isNull);
      expect(xdgDataHome(<String, String>{'HOME': '/h'}), '/h/.local/share');
    });

    test('the file ledger round-trips and survives a second process', () async {
      final String path = '${home.path}/data/app/reminders.json';
      final List<int> shown = <int>[];
      LinuxReminderScheduler s(DateTime now) => LinuxReminderScheduler(
        store: FileReminderLedgerStore(path),
        show: (int id, String t, String b, String? p) async => shown.add(id),
        now: () => now,
      );
      await s(
        DateTime.utc(2026, 10, 1, 8),
      ).schedule(1, 't', 'b', DateTime.utc(2026, 10, 1, 9));
      // Another process (the login-time --remind) reads the same file.
      expect(await s(DateTime.utc(2026, 10, 1, 8, 59)).showDue(), 0);
      expect(await s(DateTime.utc(2026, 10, 1, 9)).showDue(), 1);
      expect(shown, <int>[1]);
      expect(await s(DateTime.utc(2026, 10, 1, 9)).pendingIds(), isEmpty);
    });

    test('a corrupt ledger costs nothing at launch', () async {
      final MemoryReminderLedgerStore store = MemoryReminderLedgerStore(
        '{not json',
      );
      final LinuxReminderScheduler s = LinuxReminderScheduler(
        store: store,
        show: (int id, String t, String b, String? p) async {},
      );
      expect(await s.showDue(), 0);
      expect(await s.pendingIds(), isEmpty);
    });
  });

  group('QuietHours (NO-13)', () {
    const QuietHours night = QuietHours(
      startMinute: 22 * 60,
      endMinute: 7 * 60,
    );

    test('RED CONTROL: 23:00 inside 22:00-07:00 fires at 07:00 next day', () {
      expect(night.defer(DateTime(2026, 10, 1, 23)), DateTime(2026, 10, 2, 7));
    });

    test('after midnight, the same morning', () {
      expect(
        night.defer(DateTime(2026, 10, 2, 3, 15)),
        DateTime(2026, 10, 2, 7),
      );
    });

    test('outside the window, unchanged; the end itself is outside', () {
      expect(night.defer(DateTime(2026, 10, 1, 9)), DateTime(2026, 10, 1, 9));
      expect(night.defer(DateTime(2026, 10, 2, 7)), DateTime(2026, 10, 2, 7));
      expect(
        night.defer(DateTime(2026, 10, 1, 21, 59)),
        DateTime(2026, 10, 1, 21, 59),
      );
      expect(night.defer(DateTime(2026, 10, 1, 22)), DateTime(2026, 10, 2, 7));
    });

    test('a window that does not wrap midnight', () {
      const QuietHours lunch = QuietHours(
        startMinute: 12 * 60,
        endMinute: 13 * 60,
      );
      expect(
        lunch.defer(DateTime(2026, 10, 1, 12, 30)),
        DateTime(2026, 10, 1, 13),
      );
      expect(
        lunch.defer(DateTime(2026, 10, 1, 13, 30)),
        DateTime(2026, 10, 1, 13, 30),
      );
    });

    test('an empty window defers nothing', () {
      const QuietHours none = QuietHours(startMinute: 600, endMinute: 600);
      expect(none.defer(DateTime(2026, 10, 1, 10)), DateTime(2026, 10, 1, 10));
    });
  });
}
