// AppSpacing / AppRadius ARE MIRRORED BY contracts/tokens/dtcg — train ST-D0.
//
// The emitter's header (`packages/tokens/style-dictionary.config.mjs`) records
// the exposure this closes: "`AppSpacing` and `scale.json` can drift, because
// nothing compares a Dart literal with a JSON one." This compares them. The
// websites and the extensions read the JSON; every stamped app reads the Dart;
// one scale is now one scale in fact and not only in a comment.
//
// `flutter test` runs with the package directory as the working directory, so
// the contract is two levels up. A missing file FAILS rather than skipping:
// a mirror test that cannot find its mirror is a test that checks nothing.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

Map<String, dynamic> _read(String name) {
  final File f = File('../../contracts/tokens/dtcg/$name');
  expect(f.existsSync(), isTrue, reason: 'contract not found at ${f.path}');
  return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
}

double _px(Map<String, dynamic> group, String key) {
  final Object? token = group[key];
  expect(token, isNotNull, reason: 'token $key is missing from the contract');
  final String v = (token! as Map<String, dynamic>)[r'$value'] as String;
  expect(v, endsWith('px'), reason: '$key: $v');
  return double.parse(v.substring(0, v.length - 2));
}

void main() {
  late Map<String, dynamic> scale;
  late Map<String, dynamic> size;
  setUpAll(() {
    scale = _read('scale.json');
    size = _read('size.json');
  });

  test('AppSpacing steps equal space.1..7', () {
    final Map<String, dynamic> space = scale['space'] as Map<String, dynamic>;
    const Map<String, double> dart = <String, double>{
      '1': AppSpacing.xs,
      '2': AppSpacing.sm,
      '3': AppSpacing.md,
      '4': AppSpacing.lg,
      '5': AppSpacing.xl,
      '6': AppSpacing.xxl,
      '7': AppSpacing.xxxl,
    };
    dart.forEach((String k, double v) {
      expect(_px(space, k), v, reason: 'space.$k');
    });
  });

  test('AppSpacing gutters equal space.gutter-*', () {
    final Map<String, dynamic> space = scale['space'] as Map<String, dynamic>;
    expect(_px(space, 'gutter-sm'), AppSpacing.gutterCompact);
    expect(_px(space, 'gutter'), AppSpacing.gutterExpanded);
    expect(_px(space, 'gutter-lg'), AppSpacing.gutterLarge);
  });

  test('AppRadius equals radius.* and size.radius', () {
    final Map<String, dynamic> radius = scale['radius'] as Map<String, dynamic>;
    expect(_px(radius, 'sm'), AppRadius.sm);
    expect(_px(radius, 'md'), AppRadius.md);
    expect(_px(radius, 'xl'), AppRadius.xl);
    expect(_px(radius, 'pill'), AppRadius.pill);
    // `radius.lg` is absent from scale.json on purpose; `size.radius` is it.
    expect(_px(size['size'] as Map<String, dynamic>, 'radius'), AppRadius.lg);
    expect(BrandTokens.radius, AppRadius.lg);
  });

  test('the component roles are aliases of steps, never new numbers', () {
    const List<double> steps = <double>[
      AppRadius.sm,
      AppRadius.md,
      AppRadius.lg,
      AppRadius.xl,
      AppRadius.pill,
    ];
    expect(steps, contains(AppRadius.card));
    expect(steps, contains(AppRadius.control));
    expect(steps, contains(AppRadius.fab));
  });
}
