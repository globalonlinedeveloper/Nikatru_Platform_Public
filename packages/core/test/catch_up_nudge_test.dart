import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// [pipeline T-8] The catch-up nudge's arithmetic.
///
/// 🔴 THE WEB ROW IS THE REASON THIS IS A PURE PREDICATE. `kIsWeb` is a
/// compile-time constant, so a widget test cannot enter the web branch at all —
/// and web is the only live platform this factory ships to today. Keeping the
/// decision here means every row, including the one that matters most, is
/// decidable on a normal `dart test` run.
void main() {
  const CatchUpNudge gate = CatchUpNudge();

  // 20:00 is the chassis default (`AppConfig.reminderHour`), used here only as
  // a concrete input — nothing below depends on the value.
  const int hour = 20;
  const int minute = 0;

  CatchUpNudgeVerdict decide({
    required DateTime now,
    DateTime? lastShownAt,
    bool remindersEnabled = true,
    bool platformCanSchedule = false,
  }) =>
      gate.decide(
        now: now,
        lastShownAt: lastShownAt,
        reminderHour: hour,
        reminderMinute: minute,
        remindersEnabled: remindersEnabled,
        platformCanSchedule: platformCanSchedule,
      );

  group('CatchUpNudge — the platform rows', () {
    test('a platform that CAN schedule never gets an in-app nudge', () {
      expect(
        decide(now: DateTime(2026, 8, 3, 23), platformCanSchedule: true),
        CatchUpNudgeVerdict.platformSchedules,
        reason: 'the OS notification and an in-app banner would be the same '
            'message twice',
      );
    });

    test('a platform that cannot schedule gets one', () {
      expect(
        decide(now: DateTime(2026, 8, 3, 23)),
        CatchUpNudgeVerdict.show,
      );
    });
  });

  group('CatchUpNudge — the opt-out is honoured', () {
    test('reminders OFF means no nudge, even long past the hour', () {
      expect(
        decide(now: DateTime(2026, 8, 3, 23, 59), remindersEnabled: false),
        CatchUpNudgeVerdict.remindersOff,
        reason: 'an in-app surface is still a notification; routing around the '
            'switch is what the switch exists to prevent',
      );
    });
  });

  group('CatchUpNudge — the boundary', () {
    test('just BEFORE the reminder time is not due', () {
      expect(
        decide(now: DateTime(2026, 8, 3, 19, 59, 59)),
        CatchUpNudgeVerdict.notDueYet,
      );
    });

    test('EXACTLY at the reminder time is due', () {
      expect(
        decide(now: DateTime(2026, 8, 3, hour, minute)),
        CatchUpNudgeVerdict.show,
        reason: 'a reminder promised at 20:00 has happened at 20:00',
      );
    });

    test('just AFTER the reminder time is due', () {
      expect(
        decide(now: DateTime(2026, 8, 3, 20, 0, 1)),
        CatchUpNudgeVerdict.show,
      );
    });
  });

  group('CatchUpNudge — once per occurrence', () {
    test('already shown after today\'s reminder time ⇒ not again', () {
      expect(
        decide(
          now: DateTime(2026, 8, 3, 22),
          lastShownAt: DateTime(2026, 8, 3, 20, 5),
        ),
        CatchUpNudgeVerdict.alreadyShownToday,
      );
    });

    test('shown at exactly the due instant still counts as shown', () {
      expect(
        decide(
          now: DateTime(2026, 8, 3, 22),
          lastShownAt: DateTime(2026, 8, 3, hour, minute),
        ),
        CatchUpNudgeVerdict.alreadyShownToday,
      );
    });

    test('YESTERDAY\'s nudge does not suppress today\'s', () {
      expect(
        decide(
          now: DateTime(2026, 8, 3, 21),
          lastShownAt: DateTime(2026, 8, 2, 21),
        ),
        CatchUpNudgeVerdict.show,
        reason:
            'the reminder is daily, so its catch-up is daily; a check against '
            '"ever shown" would fire once in the life of the install',
      );
    });

    test('a nudge shown EARLIER today, before the hour, does not suppress it',
        () {
      // The only way to reach this state is a clock change or a reminder time
      // moved later in the day. The rule is still "once per occurrence", and
      // this morning's stamp belongs to yesterday's occurrence.
      expect(
        decide(
          now: DateTime(2026, 8, 3, 21),
          lastShownAt: DateTime(2026, 8, 3, 7),
        ),
        CatchUpNudgeVerdict.show,
      );
    });
  });

  group('CatchUpNudge — precedence', () {
    // The order matters: a platform that schedules must not be told "reminders
    // are off", because the two lead to different fixes.
    test('platform capability is decided before the opt-out', () {
      expect(
        decide(
          now: DateTime(2026, 8, 3, 23),
          remindersEnabled: false,
          platformCanSchedule: true,
        ),
        CatchUpNudgeVerdict.platformSchedules,
      );
    });

    test('the opt-out is decided before the clock', () {
      expect(
        decide(now: DateTime(2026, 8, 3, 6), remindersEnabled: false),
        CatchUpNudgeVerdict.remindersOff,
      );
    });
  });
}
