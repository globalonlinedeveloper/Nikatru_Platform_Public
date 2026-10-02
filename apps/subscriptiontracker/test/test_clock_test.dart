// The Dart half of the test-time clock: `NIKATRU_TEST_NOW` moves what reads
// `nowProvider`'s default, moves nothing when unset, and refuses a typo.
//
// The time-travel run is evidence only while flutter_test_config.dart still
// installs the clock and `nowProvider` still reads `wallClock`; either breaking
// leaves the weekly run green on today's clock, which reads exactly like "no
// fuse found". The first case is the one that run proves itself with.

import 'dart:io' show Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/test_clock.dart';

void main() {
  const Duration day = Duration(days: 1);

  test(
    'nowProvider reads NIKATRU_TEST_NOW when it is set, the real clock when it is not',
    () {
      final DateTime? travel = parseTestNow(Platform.environment[kTestNowVar]);
      final ProviderContainer c = ProviderContainer();
      addTearDown(c.dispose);
      final DateTime read = c.read(nowProvider)();
      final DateTime expected = travel ?? DateTime.now();
      expect(
        read.difference(expected).abs() < day,
        isTrue,
        reason: 'nowProvider read $read, expected about $expected',
      );
      if (travel != null) {
        expect(
          read.isBefore(travel),
          isFalse,
          reason: 'the clock must start AT the instant and only run forward',
        );
      }
    },
  );

  test(
    'installTestClock moves wallClock to the instant, and it advances',
    () async {
      final DateTime Function() saved = wallClock;
      addTearDown(() => wallClock = saved);
      final DateTime? at = installTestClock(<String, String>{
        kTestNowVar: '2027-11-05T00:00:00Z',
      });
      expect(at, DateTime.utc(2027, 11, 5));
      final DateTime first = wallClock();
      expect(
        first.difference(DateTime.utc(2027, 11, 5)).abs() < day,
        isTrue,
        reason: '$first',
      );
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(
        wallClock().isAfter(first),
        isTrue,
        reason: 'a frozen clock hangs a deadline loop',
      );
    },
  );

  test('unset or empty moves nothing', () {
    final DateTime Function() saved = wallClock;
    addTearDown(() => wallClock = saved);
    expect(installTestClock(const <String, String>{}), isNull);
    expect(installTestClock(const <String, String>{kTestNowVar: '  '}), isNull);
    expect(identical(wallClock, saved), isTrue);
  });

  test('a typo is refused, never read as today', () {
    for (final String bad in <String>[
      '2027-11-05',
      '2027-11-05T00:00:00',
      'tomorrow',
      '2027-13-45T00:00:00Z',
      '2027-02-30T00:00:00Z',
    ]) {
      expect(() => parseTestNow(bad), throwsStateError, reason: bad);
    }
    expect(
      parseTestNow('2027-11-05T00:00:00+05:30'),
      DateTime.utc(2027, 11, 4, 18, 30),
    );
  });
}
