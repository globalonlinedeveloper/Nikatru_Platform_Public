// ─────────────────────────────────────────────────────────────────────────────
// store_frame_fold_test.dart — THE FOLD RECORD'S ARITHMETIC AND ITS REFUSALS.
//
// ⏱ 2026-09-22 (store-frame-followup). `integration_test/store_frame_fold.dart`
// turns the suite's logical geometry into the PNG rows the host reads. A wrong
// rounding direction there moves the band one device row into the shell's own
// ground, where it would pass on every frame whatever the page did. These cases
// pin the direction and the refusals without pumping anything.
//
// 🔴 MUTATIONS FOR THE WRITER (UNRUN IN THE DRAFT):
//   1. `foldDeviceY` `.floor()` -> `.ceil()`: red on "a fold inside a device
//      row is floored".
//   2. drop the opacity limb in `problems()`: red on "a translucent ground is
//      refused".
// ─────────────────────────────────────────────────────────────────────────────

import 'package:flutter_test/flutter_test.dart';

import '../integration_test/store_frame_fold.dart';

StoreFrameFold _fold({
  String frame = '01-home',
  double dpr = 3,
  double viewWidthLogical = 360,
  double foldTopLogical = 568,
  int pageGroundArgb = 0xFFF7F8FA,
  double contentLeftLogical = 0,
  double contentRightLogical = 360,
  List<List<double>> skipLogical = const <List<double>>[],
}) => StoreFrameFold(
  frame: frame,
  dpr: dpr,
  viewWidthLogical: viewWidthLogical,
  foldTopLogical: foldTopLogical,
  pageGroundArgb: pageGroundArgb,
  contentLeftLogical: contentLeftLogical,
  contentRightLogical: contentRightLogical,
  skipLogical: skipLogical,
);

void main() {
  group('device rows', () {
    test('a whole-pixel fold maps straight across', () {
      final StoreFrameFold f = _fold();
      expect(f.foldDeviceY, 1704);
      expect(f.viewWidthDevice, 1080);
      expect(f.contentLeftDevice, 0);
      expect(f.contentRightDevice, 1080);
    });

    test('a fold inside a device row is floored', () {
      // 567.5 * 3 = 1702.5: row 1702 is half page, half shell, so the band
      // must END before it, at 1702 exclusive.
      expect(_fold(foldTopLogical: 567.5).foldDeviceY, 1702);
    });

    test('the content span is taken inward on both sides', () {
      final StoreFrameFold f = _fold(
        contentLeftLogical: 80.2,
        contentRightLogical: 899.9,
        dpr: 2,
        viewWidthLogical: 900,
      );
      expect(f.contentLeftDevice, 161);
      expect(f.contentRightDevice, 1799);
    });

    test('the ground splits into r, g, b', () {
      expect(_fold(pageGroundArgb: 0xFF102030).groundRgb, <int>[
        0x10,
        0x20,
        0x30,
      ]);
    });
  });

  group('refusals', () {
    test('a sound record has no problems', () {
      expect(_fold().problems(), isEmpty);
    });

    test('a translucent ground is refused', () {
      expect(
        _fold(pageGroundArgb: 0x80F7F8FA).problems(),
        contains(contains('not opaque')),
      );
    });

    test('a frame name the host cannot match is refused', () {
      expect(
        _fold(frame: 'home').problems(),
        contains(contains('not a listing frame name')),
      );
    });

    test('a zero or missing pixel ratio is refused', () {
      expect(_fold(dpr: 0).problems(), contains(contains('dpr')));
      expect(_fold(dpr: double.nan).problems(), contains(contains('dpr')));
    });

    test('an empty content span is refused', () {
      expect(
        _fold(contentLeftLogical: 200, contentRightLogical: 200).problems(),
        contains(contains('content span')),
      );
    });

    test('a skip span that is not [left, right] is refused', () {
      expect(
        _fold(
          skipLogical: <List<double>>[
            <double>[300, 280],
          ],
        ).problems(),
        contains(contains('skip span')),
      );
    });
  });

  test('toJson carries every field the host reads', () {
    expect(_fold().toJson().keys.toSet(), <String>{
      'frame',
      'dpr',
      'viewWidthLogical',
      'foldTopLogical',
      'pageGroundArgb',
      'contentLeftLogical',
      'contentRightLogical',
      'skipLogical',
    });
  });
}
