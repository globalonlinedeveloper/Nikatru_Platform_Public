import 'package:flutter_test/flutter_test.dart';
import 'package:subly/state/subscriptions_controller.dart';

/// The three settings toggles were declared in settings_controller.dart and read
/// NOWHERE, so switching them did nothing. These lock the wiring in place: if the
/// mapping from preference to action is broken again, these go red.
void main() {
  group('ReminderPlan', () {
    test('defaults: renewal reminders ON, weekly digest OFF', () {
      // A missing key must never silently turn a user's notifications ON, and
      // must never silently turn the ones they rely on OFF.
      final ReminderPlan p = ReminderPlan.from(const <String, bool>{});
      expect(p.syncRenewals, isTrue);
      expect(p.weeklyDigest, isFalse);
    });

    test('alerts=false cancels renewal reminders', () {
      final ReminderPlan p =
          ReminderPlan.from(const <String, bool>{'alerts': false});
      expect(p.syncRenewals, isFalse);
    });

    test('weekly=true schedules the digest', () {
      final ReminderPlan p =
          ReminderPlan.from(const <String, bool>{'weekly': true});
      expect(p.weeklyDigest, isTrue);
    });

    test('the two toggles are independent', () {
      final ReminderPlan p = ReminderPlan.from(
          const <String, bool>{'alerts': false, 'weekly': true});
      expect(p.syncRenewals, isFalse);
      expect(p.weeklyDigest, isTrue);
    });

    test('an unrelated pref does not disturb either', () {
      // 'priceHike' still round-trips in persisted settings even though its row
      // was removed, so it must not affect the plan.
      final ReminderPlan p =
          ReminderPlan.from(const <String, bool>{'priceHike': true});
      expect(p.syncRenewals, isTrue);
      expect(p.weeklyDigest, isFalse);
    });
  });
}
