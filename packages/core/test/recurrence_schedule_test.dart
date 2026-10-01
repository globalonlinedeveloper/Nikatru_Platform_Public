// VM-ONLY: the vectors are read off DISK through `dart:io`, which the
// `dart test -p chrome` arm of workspace_gate cannot do (see
// content_pack_fixture_test.dart for the same annotation and why it removes no
// coverage — the VM lane still runs every case below).
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// `contracts/renewals/vectors.json`. `dart test` runs with the package root
/// as cwd, and melos may run it from the repo root: try both, and FAIL LOUDLY
/// if neither exists — a vector file that silently resolves to nothing would
/// turn every expectation below into a test of an empty list.
Map<String, dynamic> _vectors() {
  for (final String p in <String>[
    '../../contracts/renewals/vectors.json',
    'contracts/renewals/vectors.json',
  ]) {
    final File f = File(p);
    if (f.existsSync()) {
      return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
    }
  }
  fail('contracts/renewals/vectors.json not found from ${Directory.current}');
}

Cadence _cadence(Map<String, dynamic> v) {
  final Cadence? c = Cadence.tryParse(v['every'], v['unit']);
  if (c == null) fail('vector has no readable cadence: $v');
  return c;
}

String _label(Map<String, dynamic> v) =>
    '${v['from'] ?? v['next']} +${v['every']} ${v['unit']}'
    '${v['anchorDay'] == null ? '' : ' anchor ${v['anchorDay']}'}'
    '${v['why'] == null ? '' : ' (${v['why']})'}';

void main() {
  final Map<String, dynamic> vectors = _vectors();
  final List<Map<String, dynamic>> advance =
      (vectors['advance'] as List<dynamic>).cast<Map<String, dynamic>>();
  final List<Map<String, dynamic>> roll =
      (vectors['rollForward'] as List<dynamic>).cast<Map<String, dynamic>>();

  test('the vector file is not empty — a suite over nothing proves nothing', () {
    // COVERAGE: every unit appears in both sections' union, and the counts are
    // floors, not exact, so adding a vector never reds this.
    expect(advance.length, greaterThanOrEqualTo(40));
    expect(roll.length, greaterThanOrEqualTo(10));
    final Set<Object?> units = <Object?>{
      ...advance.map((Map<String, dynamic> v) => v['unit']),
      ...roll.map((Map<String, dynamic> v) => v['unit']),
    };
    expect(units, containsAll(<String>['day', 'week', 'month', 'year']));
  });

  group('advance — every vector in contracts/renewals/vectors.json', () {
    for (final Map<String, dynamic> v in advance) {
      test(_label(v), () {
        final DateTime got = RecurrenceSchedule.advance(
          RecurrenceSchedule.parseYmd(v['from'] as String),
          _cadence(v),
          anchorDay: v['anchorDay'] as int?,
        );
        expect(RecurrenceSchedule.ymd(got), v['to']);
      });
    }
  });

  group('rollForward — every vector in contracts/renewals/vectors.json', () {
    for (final Map<String, dynamic> v in roll) {
      test(_label(v), () {
        final RecurrenceRoll r = RecurrenceSchedule.rollForward(
          RecurrenceSchedule.parseYmd(v['next'] as String),
          _cadence(v),
          RecurrenceSchedule.parseYmd(v['today'] as String),
          anchorDay: v['anchorDay'] as int?,
        );
        expect(RecurrenceSchedule.ymd(r.next), v['expectNext']);
        expect(
          r.crossings.map(RecurrenceSchedule.ymd).toList(),
          v['crossings'],
        );
      });
    }
  });

  group('properties the vectors cannot enumerate', () {
    test('12 monthly advances from any real date land back on it', () {
      final List<String> bad = <String>[];
      int checked = 0;
      for (final int year in <int>[2024, 2026]) {
        for (int month = 1; month <= 12; month++) {
          for (int day = 1; day <= 31; day++) {
            final DateTime start = DateTime.utc(year, month, day);
            if (start.month != month) continue;
            checked++;
            DateTime cur = DateTime(year, month, day);
            for (int i = 0; i < 12; i++) {
              cur = RecurrenceSchedule.advance(
                cur,
                Cadence.monthly,
                anchorDay: day,
              );
            }
            final bool leapDay = month == 2 && day == 29;
            final String want = leapDay
                ? '${year + 1}-02-28'
                : RecurrenceSchedule.ymd(DateTime(year + 1, month, day));
            if (RecurrenceSchedule.ymd(cur) != want) {
              bad.add('${RecurrenceSchedule.ymd(start)} x12 -> $cur');
            }
          }
        }
      }
      expect(bad, isEmpty);
      expect(checked, 731);
    });

    test('the backlog guard caps a pathological gap at the Worker\'s 240', () {
      final RecurrenceRoll r = RecurrenceSchedule.rollForward(
        DateTime(1900, 1, 31),
        Cadence.monthly,
        DateTime(2026, 7, 21),
      );
      expect(r.crossings, hasLength(RecurrenceSchedule.maxCrossings));
      expect(RecurrenceSchedule.maxCrossings, 240);
    });

    test('an out-of-range cadence is refused, never guessed', () {
      expect(
        () => RecurrenceSchedule.advance(
          DateTime(2026, 1, 1),
          const Cadence(0, CycleUnit.month),
        ),
        throwsRangeError,
      );
      expect(Cadence.tryParse(0, 'month'), isNull);
      expect(Cadence.tryParse(1, 'fortnight'), isNull);
      expect(Cadence.tryParse('1', 'month'), isNull);
      expect(
        () => RecurrenceSchedule.parseYmd('2026-02-30'),
        throwsFormatException,
      );
    });

    test('the legacy cycle maps both ways, and only for every-1', () {
      expect(Cadence.fromLegacy('monthly'), Cadence.monthly);
      expect(Cadence.fromLegacy('yearly'), Cadence.yearly);
      expect(Cadence.fromLegacy('weekly'), isNull);
      expect(Cadence.monthly.legacyCycle, 'monthly');
      expect(Cadence.yearly.legacyCycle, 'yearly');
      expect(Cadence.weekly.legacyCycle, isNull);
      expect(Cadence.quarterly.legacyCycle, isNull);
    });
  });

  group('occurrencesBetween — the charges a window holds', () {
    List<String> ymds(List<DateTime> ds) =>
        ds.map(RecurrenceSchedule.ymd).toList();

    test('a weekly plan charges four or five times in a month', () {
      expect(
        ymds(
          RecurrenceSchedule.occurrencesBetween(
            DateTime(2026, 10, 1),
            Cadence.weekly,
            DateTime(2026, 10, 1),
            DateTime(2026, 10, 31),
          ),
        ),
        <String>[
          '2026-10-01',
          '2026-10-08',
          '2026-10-15',
          '2026-10-22',
          '2026-10-29',
        ],
      );
    });

    test('a stale stored date rolls into the window on its own day', () {
      // Stored three months back; the chain carries day 14 into October.
      expect(
        ymds(
          RecurrenceSchedule.occurrencesBetween(
            DateTime(2026, 7, 14),
            Cadence.monthly,
            DateTime(2026, 10, 1),
            DateTime(2026, 10, 31),
          ),
        ),
        <String>['2026-10-14'],
      );
    });

    test('a quarterly plan charges four times in twelve months', () {
      expect(
        RecurrenceSchedule.occurrencesBetween(
          DateTime(2026, 11, 5),
          Cadence.quarterly,
          DateTime(2026, 10, 1),
          DateTime(2027, 9, 30),
        ).length,
        4,
      );
    });

    test('the clamp anchor is the stored day, as rollForward keeps it', () {
      expect(
        ymds(
          RecurrenceSchedule.occurrencesBetween(
            DateTime(2027, 1, 31),
            Cadence.monthly,
            DateTime(2027, 1, 1),
            DateTime(2027, 3, 31),
          ),
        ),
        <String>['2027-01-31', '2027-02-28', '2027-03-31'],
      );
    });

    test('nothing before the stored date is invented', () {
      expect(
        RecurrenceSchedule.occurrencesBetween(
          DateTime(2026, 10, 20),
          Cadence.weekly,
          DateTime(2026, 10, 1),
          DateTime(2026, 10, 19),
        ),
        isEmpty,
      );
    });
  });
}
