// NO READER OF `usedPct` / `unused` SURVIVES ON INSIGHTS — train ST-D3, D3-4.
//
// Nothing in this app WRITES `Subscription.usedPct`, `.unused` or `.usageNote`:
// the add sheet never collects them and the API never returns them. Every
// reader is therefore either dead (real rows) or presenting invented demo
// usage as fact. D3-4 retired the Insights readers (the savings card); this
// file holds that line by READING THE SOURCE, and ratchets the rest:
//
//   1. no file under lib/features/insights/ reads any of them — the D3-4
//      verify ("grep test: no reader of usedPct / unused survives");
//   2. the readers that remain elsewhere are NAMED below with the train that
//      owns their file, and the set may only SHRINK: a new reader anywhere
//      fails here by file name.
//
// Comments are stripped before matching, so a sentence ABOUT the field (this
// codebase writes many) is not a reader.
//
// MUTATION PROOF: add `s.usedPct` to insights_screen.dart and case 1 goes red
// naming the file; add it to calendar_screen.dart and case 2 goes red.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

final RegExp _reader = RegExp(
  r'\.usedPct\b|\.unused\b|\.usageNote\b|SubMath\.(?:unused|savings)\(',
);

/// Files that still read the fields, each with the train that owns it. The
/// model, its codec, the seed and SubMath DEFINE them; the three screens are
/// retired in their own trains (ST-D1 home, ST-D5 detail and notifications).
const Map<String, String> _remaining = <String, String>{
  'lib/core/format/sub_math.dart': 'defines SubMath.unused / savings',
  'lib/data/models/subscription.dart': 'defines the fields',
  'lib/data/portability/subscription_columns.dart': 'export columns',
  'lib/features/detail/subscription_detail_screen.dart': 'ST-D5',
  'lib/features/home/home_screen.dart': 'ST-D1',
  'lib/features/notifications/notifications_screen.dart': 'ST-D5',
};

String _code(File f) => f
    .readAsStringSync()
    .split('\n')
    .map((String l) {
      final int c = l.indexOf('//');
      return c < 0 ? l : l.substring(0, c);
    })
    .join('\n');

Map<String, bool> _readersUnder(String dir) => <String, bool>{
  for (final FileSystemEntity e in Directory(dir).listSync(recursive: true))
    if (e is File && e.path.endsWith('.dart'))
      e.path.replaceAll(r'\', '/'): _reader.hasMatch(_code(e)),
};

void main() {
  test('COVERAGE — the scan reads the real lib/ tree', () {
    final Map<String, bool> all = _readersUnder('lib');
    expect(all.length, greaterThan(60), reason: 'the scan read almost nothing');
    expect(
      all.entries.where((MapEntry<String, bool> e) => e.value),
      isNotEmpty,
      reason:
          'no reader found anywhere: the pattern stopped matching, so '
          'case 1 below would pass over anything',
    );
  });

  test('no file under lib/features/insights reads usedPct / unused', () {
    final List<String> readers = <String>[
      for (final MapEntry<String, bool> e in _readersUnder(
        'lib/features/insights',
      ).entries)
        if (e.value) e.key,
    ];
    expect(readers, isEmpty, reason: 'retired in ST-D3 D3-4: $readers');
  });

  test(
    'the readers elsewhere are the named ones, and the set only shrinks',
    () {
      final List<String> readers = <String>[
        for (final MapEntry<String, bool> e in _readersUnder('lib').entries)
          if (e.value) e.key,
      ]..sort();
      for (final String r in readers) {
        expect(
          _remaining.keys,
          contains(r),
          reason: '$r reads a usage field nothing writes — a NEW reader',
        );
      }
      for (final String named in _remaining.keys) {
        expect(
          readers,
          contains(named),
          reason:
              '$named no longer reads the fields — delete its entry so the '
              'ratchet tightens',
        );
      }
    },
  );
}
