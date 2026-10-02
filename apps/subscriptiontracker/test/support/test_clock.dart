// THE DART HALF OF THE TEST-TIME CLOCK — read by test/flutter_test_config.dart.
//
// The weekly `.github/workflows/time-travel.yml` runs every suite with
// `NIKATRU_TEST_NOW` set ~400 days ahead and at the year boundary, so a date
// fuse fires there and not on every pull request on the day it was set for.
// The Worker half is services/_shared/test/test-clock.ts, the node half
// tooling/scripts/test-clock.mjs; this file reads the SAME variable with the
// SAME grammar, and moves `wallClock`, the seam behind `nowProvider`.
//
// Unset or empty → nothing moves. An instant without a zone, or anything that
// is not an instant, THROWS: a typo must never run the suite on today and call
// it a time-travel run.

import 'package:subscriptiontracker/state/providers.dart' show wallClock;

/// The variable all three halves read.
const String kTestNowVar = 'NIKATRU_TEST_NOW';

final RegExp _instant = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$',
);

/// [raw] as an instant, null when unset or empty; throws on anything else.
DateTime? parseTestNow(String? raw) {
  final String v = (raw ?? '').trim();
  if (v.isEmpty) return null;
  final DateTime? at = _instant.hasMatch(v) ? DateTime.tryParse(v) : null;
  // DateTime.tryParse rolls 2027-02-30 over into 2 March; a date the calendar
  // does not have is not the instant it names.
  if (at == null || !_realCalendarDay(v)) {
    throw StateError(
      '$kTestNowVar="$raw" is not an ISO-8601 instant with a zone (for example '
      '2027-11-05T00:00:00Z). Refusing to run on the real clock and call it a '
      'time-travel run (apps/subscriptiontracker/test/support/test_clock.dart).',
    );
  }
  return at;
}

bool _realCalendarDay(String v) {
  final int y = int.parse(v.substring(0, 4));
  final int m = int.parse(v.substring(5, 7));
  final int d = int.parse(v.substring(8, 10));
  final DateTime day = DateTime.utc(y, m, d);
  return day.year == y && day.month == m && day.day == d;
}

/// Moves [wallClock] so it STARTS at [environment]'s `NIKATRU_TEST_NOW` and
/// advances in real time. Returns the instant, or null when nothing moved.
DateTime? installTestClock(Map<String, String> environment) {
  final DateTime? at = parseTestNow(environment[kTestNowVar]);
  if (at == null) return null;
  final Duration offset = at.difference(DateTime.now());
  wallClock = () => DateTime.now().add(offset);
  return at;
}
