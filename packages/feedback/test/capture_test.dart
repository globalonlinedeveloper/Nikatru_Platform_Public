import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ScreenCaptureBoundary, Sensitive;
import 'package:nikatru_feedback/nikatru_feedback.dart';

final GlobalKey _boundary = GlobalKey();
final GlobalKey _field = GlobalKey();
final GlobalKey _secret = GlobalKey();

Widget _screen() => MaterialApp(
  home: ScreenCaptureBoundary(
    boundaryKey: _boundary,
    child: Scaffold(
      body: Column(
        children: <Widget>[
          const SizedBox(
            height: 40,
            child: Center(child: Text('Public heading')),
          ),
          SizedBox(
            width: 300,
            child: TextField(
              key: _field,
              controller: TextEditingController(
                text: 'asha@example.com 4111 1111',
              ),
            ),
          ),
          Sensitive(key: _secret, child: const Text('₹12,345.00')),
        ],
      ),
    ),
  ),
);

Future<ByteData> _rgba(ui.Image image) async =>
    (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;

/// The pixels of [r] (logical, ratio 1) in [data] of an image [width] wide.
List<int> _region(ByteData data, int width, Rect r) {
  final List<int> out = <int>[];
  for (int y = r.top.ceil(); y < r.bottom.floor(); y++) {
    for (int x = r.left.ceil(); x < r.right.floor(); x++) {
      out.add(data.getUint32((y * width + x) * 4));
    }
  }
  return out;
}

Rect _rectOf(WidgetTester tester, GlobalKey key) {
  final RenderBox box = key.currentContext!.findRenderObject()! as RenderBox;
  final RenderBox root =
      _boundary.currentContext!.findRenderObject()! as RenderBox;
  return MatrixUtils.transformRect(
    box.getTransformTo(root),
    Offset.zero & box.size,
  );
}

void main() {
  testWidgets(
    '🔴 [Do 2] a TextField\'s region in the sent image differs from the unredacted render; the Sensitive one too',
    (WidgetTester tester) async {
      await tester.pumpWidget(_screen());
      await tester.runAsync(() async {
        final FeedbackShot shot = (await captureScreen(
          boundaryKey: _boundary,
        ))!;
        expect(
          shot.locked,
          hasLength(2),
          reason: 'the field\'s editable text and the Sensitive amount',
        );
        final ui.Image raw = shot.image;
        final ui.Image sent = await renderShot(
          shot,
          const <MarkupOp>[],
          const MarkupColors(cover: Colors.black, ink: Colors.red),
        );
        final ByteData before = await _rgba(raw);
        final ByteData after = await _rgba(sent);
        final Rect field = _rectOf(tester, _field);
        final Rect secret = _rectOf(tester, _secret);
        expect(
          _region(after, sent.width, field),
          isNot(equals(_region(before, raw.width, field))),
        );
        expect(
          _region(after, sent.width, secret),
          isNot(equals(_region(before, raw.width, secret))),
        );
        // The locked cover is one solid colour across the text: no glyph shows through.
        final Rect text = shot.locked.first.deflate(1);
        expect(_region(after, sent.width, text).toSet(), hasLength(1));
        // A public part of the screen is left exactly as it was.
        const Rect heading = Rect.fromLTWH(0, 0, 200, 40);
        expect(
          _region(after, sent.width, heading),
          equals(_region(before, raw.width, heading)),
        );
        // And the PNG that is uploaded is that image.
        final Uint8List png = await pngBytes(sent);
        expect(png.sublist(1, 4), <int>[0x50, 0x4e, 0x47]);
      });
    },
  );

  testWidgets(
    'a person can add blur, and Undo cannot take the default blur away',
    (WidgetTester tester) async {
      await tester.pumpWidget(_screen());
      late FeedbackShot shot;
      await tester.runAsync(() async {
        shot = (await captureScreen(boundaryKey: _boundary))!;
      });
      List<MarkupOp>? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (BuildContext context) => TextButton(
              onPressed: () async =>
                  result = await Navigator.of(context).push<List<MarkupOp>>(
                    MaterialPageRoute<List<MarkupOp>>(
                      builder: (_) => MarkupEditorPage(
                        shot: shot,
                        initial: const <MarkupOp>[],
                      ),
                    ),
                  ),
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      final TestGesture g = await tester.startGesture(
        tester.getTopLeft(find.byKey(MarkupKeys.canvas)) + const Offset(5, 5),
      );
      await g.moveBy(const Offset(60, 30));
      await g.up();
      await tester.pump();
      await tester.tap(find.byKey(MarkupKeys.undo));
      await tester.pump();
      expect(
        tester.widget<IconButton>(find.byKey(MarkupKeys.undo)).onPressed,
        isNull,
        reason: 'only the person\'s own mark was undoable',
      );
      await tester.tap(find.byKey(MarkupKeys.done));
      await tester.pumpAndSettle();
      expect(result, isEmpty);
      expect(
        shot.locked,
        hasLength(2),
        reason: 'the default blur is not an op and survives',
      );
    },
  );
}
