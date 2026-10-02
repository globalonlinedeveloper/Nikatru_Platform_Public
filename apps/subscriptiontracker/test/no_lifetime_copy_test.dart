// ⏱ 2026-10-01 · MO-02 — THE COPY GUARD. [ADR 093] §11.2: no in-app surface
// sells or names a lifetime plan. The served config lists `pro_lifetime` for the
// web apex pricing page, and `RailConfig.fromPaywallExtra` drops every one-time
// plan before a rail sees it (packages/purchases chassis_billing_test). This is
// the COPY half: no string an app can draw — this app's arb, the chassis arb
// every app inherits, the brick's arb every stamp starts from — may word one,
// so a later screen cannot pitch what the rail will never sell.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// "lifetime", "one-time"/"one time", "forever", "pay once"; Tamil "வாழ்நாள்"
/// (lifetime). NOT "ஒருமுறை" ("once"): it is how Tamil says "every N days" for
/// the user's own subscriptions (`perEveryDays`), which names no plan of ours.
final RegExp _lifetime = RegExp(
  r'lifetime|one[- ]time|forever|pay once|வாழ்நாள்',
  caseSensitive: false,
);

void main() {
  final List<Directory> roots = <Directory>[
    Directory('lib/l10n'),
    Directory('../../packages/design_system/lib/src/l10n'),
    Directory('../../tooling/bricks/app/__brick__/apps/{{app_id}}/lib/l10n'),
  ];

  test('no app-drawable string words a lifetime plan', () {
    int files = 0;
    final List<String> hits = <String>[];
    for (final Directory d in roots) {
      if (!d.existsSync()) continue;
      for (final FileSystemEntity f in d.listSync()) {
        if (f is! File || !f.path.endsWith('.arb')) continue;
        files++;
        final Map<String, Object?> arb =
            (jsonDecode(f.readAsStringSync()) as Map<String, Object?>);
        arb.forEach((String key, Object? value) {
          // Descriptions (`@key`) are for translators and may NAME the rule.
          if (key.startsWith('@') || value is! String) return;
          if (_lifetime.hasMatch(value)) hits.add('${f.path}: $key = $value');
        });
      }
    }
    // COVERAGE: the app's two arbs and the chassis's two at least, or this
    // ranged over nothing and proves nothing.
    expect(files, greaterThanOrEqualTo(4), reason: 'arb files read: $files');
    expect(hits, isEmpty);
  });

  test('the pattern can fail — the guard is not vacuous', () {
    expect(_lifetime.hasMatch('Pro for a lifetime'), isTrue);
    expect(_lifetime.hasMatch('Pay once, keep it forever'), isTrue);
    expect(_lifetime.hasMatch('Billed monthly'), isFalse);
  });
}
