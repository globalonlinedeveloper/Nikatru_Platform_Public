// The store capture's shutter, proven under the DEFAULT test binding.
//
// `integration_test/store_frame_shutter.dart` is what a desktop capture
// photographs with, and a desktop capture needs CI-only secrets and a live
// backend. Everything it decides before the pixels reach the host is pure or
// runs on a pumped widget, so it is proven here on every push: which platform
// gets which shutter, the geometry the runner sends, the layer rendered at that
// geometry and refused at any other, and the `{screenshotName, bytes}` entry
// the driver reads.
//
// Never `IntegrationTestWidgetsFlutterBinding.ensureInitialized()` here: this
// file runs under `flutter test`, and the sink is a hand-written fake.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';

import '../integration_test/store_frame_shutter.dart';

/// Records every call instead of photographing anything.
class _FakeSink implements StoreScreenshotSink {
  final List<String> plugins = <String>[];
  final List<(String, List<int>)> records = <(String, List<int>)>[];

  @override
  Future<void> plugin(String frame) async {
    plugins.add(frame);
  }

  @override
  void record(String name, List<int> bytes) {
    records.add((name, bytes));
  }
}

/// The entry the plugin shutter appends and the driver reads, written out.
Map<String, dynamic> _entry(String name, List<int> bytes) => <String, dynamic>{
  'screenshotName': name,
  'bytes': bytes,
};

/// A PNG's width and height, big-endian, from its IHDR chunk (bytes 16-23).
(int, int) _pngSize(List<int> png) {
  int be32(int at) =>
      (png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3];
  return (be32(16), be32(20));
}

/// The app root's layer, alone, in a view at [geometry].
Future<void> _pumpStoreFrame(
  WidgetTester tester,
  StoreViewGeometry geometry,
) async {
  imposeStoreGeometry(tester, geometry);
  await tester.pumpWidget(
    const RepaintBoundary(
      key: E2EKeys.storeFrame,
      child: ColoredBox(color: Color(0xFF2E6BD9)),
    ),
  );
}

void main() {
  test('storeShutterKindFor: web is the plugin on every platform, and the '
      'three desktops are the layer', () {
    const Map<TargetPlatform, StoreShutterKind> native =
        <TargetPlatform, StoreShutterKind>{
          TargetPlatform.android: StoreShutterKind.plugin,
          TargetPlatform.iOS: StoreShutterKind.plugin,
          TargetPlatform.linux: StoreShutterKind.layer,
          TargetPlatform.windows: StoreShutterKind.layer,
          TargetPlatform.macOS: StoreShutterKind.layer,
        };
    // Every value, so a platform added to the enum is a failure here.
    expect(native.length + 1, TargetPlatform.values.length);
    for (final TargetPlatform p in TargetPlatform.values) {
      expect(
        storeShutterKindFor(isWeb: true, platform: p),
        StoreShutterKind.plugin,
        reason: 'web on $p',
      );
      if (p == TargetPlatform.fuchsia) {
        expect(
          () => storeShutterKindFor(isWeb: false, platform: p),
          throwsArgumentError,
        );
      } else {
        expect(
          storeShutterKindFor(isWeb: false, platform: p),
          native[p],
          reason: '$p',
        );
      }
    }
  });

  test('StoreViewGeometry.parse reads the runner\'s 1280x800@2 and refuses '
      'every other shape', () {
    final StoreViewGeometry g = StoreViewGeometry.parse('1280x800@2');
    expect(g.logicalWidth, 1280);
    expect(g.logicalHeight, 800);
    expect(g.dpr, 2.0);
    expect(() => StoreViewGeometry.parse(''), throwsArgumentError);
    expect(() => StoreViewGeometry.parse('1280x800'), throwsArgumentError);
    expect(() => StoreViewGeometry.parse('axb@2'), throwsArgumentError);
  });

  testWidgets('captureStoreLayer renders the imposed 1280x800@2 as a '
      '2560x1600 PNG', (WidgetTester tester) async {
    final StoreViewGeometry g = StoreViewGeometry.parse('1280x800@2');
    await _pumpStoreFrame(tester, g);
    final List<int>? png = await tester.runAsync(
      () => captureStoreLayer(tester, g),
    );
    expect(png, isNotNull, reason: 'the layer could not be read back');
    expect(png!.sublist(1, 4), 'PNG'.codeUnits);
    expect(_pngSize(png), (2560, 1600));
  });

  testWidgets('captureStoreLayer REFUSES a layer that is not the geometry '
      'it was handed', (WidgetTester tester) async {
    await _pumpStoreFrame(tester, StoreViewGeometry.parse('1280x800@2'));
    final Object? error = await tester.runAsync<Object?>(() async {
      try {
        await captureStoreLayer(tester, StoreViewGeometry.parse('1000x700@2'));
        return null;
      } on StateError catch (e) {
        return e;
      }
    });
    expect(error, isA<StateError>());
    expect('$error', contains('1280.0x800.0 logical'));
    expect('$error', contains('1000x700@2.0'));
  });

  testWidgets('storeShutter refuses a geometry on the plugin shutter and a '
      'missing one on the layer shutter', (WidgetTester tester) async {
    final _FakeSink sink = _FakeSink();
    expect(
      () => storeShutter(
        tester: tester,
        sink: sink,
        kind: StoreShutterKind.plugin,
        geometry: StoreViewGeometry.parse('1280x800@2'),
      ),
      throwsArgumentError,
    );
    expect(
      () => storeShutter(
        tester: tester,
        sink: sink,
        kind: StoreShutterKind.layer,
      ),
      throwsArgumentError,
    );
    expect(sink.plugins, isEmpty);
    expect(sink.records, isEmpty);
  });

  testWidgets('storeShutter(kind: plugin) hands the frame name to the '
      'sink\'s plugin once, and records nothing', (WidgetTester tester) async {
    final _FakeSink sink = _FakeSink();
    final StoreShutter shutter = storeShutter(
      tester: tester,
      sink: sink,
      kind: StoreShutterKind.plugin,
    );
    await shutter('01-home');
    expect(sink.plugins, <String>['01-home']);
    expect(sink.records, isEmpty);
  });

  testWidgets('storeShutter(kind: layer) records ONE 2560x1600 PNG under '
      'the frame name, and never calls the plugin', (
    WidgetTester tester,
  ) async {
    final StoreViewGeometry g = StoreViewGeometry.parse('1280x800@2');
    await _pumpStoreFrame(tester, g);
    final _FakeSink sink = _FakeSink();
    final StoreShutter shutter = storeShutter(
      tester: tester,
      sink: sink,
      kind: StoreShutterKind.layer,
      geometry: g,
    );
    await tester.runAsync(() => shutter('02-calendar'));
    expect(sink.plugins, isEmpty);
    expect(sink.records, hasLength(1));
    expect(sink.records.single.$1, '02-calendar');
    expect(_pngSize(sink.records.single.$2), (2560, 1600));
  });

  test('withStoreScreenshot on null starts the list with the one entry', () {
    const List<int> bytes = <int>[1, 2];
    final Map<String, dynamic> out = withStoreScreenshot(null, 'a', bytes);
    expect(out, <String, dynamic>{
      'screenshots': <dynamic>[_entry('a', bytes)],
    });
  });

  test('withStoreScreenshot on a map without screenshots keeps its keys', () {
    const List<int> bytes = <int>[7];
    final Map<String, dynamic> before = <String, dynamic>{'consent': 'x'};
    final Map<String, dynamic> out = withStoreScreenshot(before, 'a', bytes);
    expect(out, <String, dynamic>{
      'consent': 'x',
      'screenshots': <dynamic>[_entry('a', bytes)],
    });
    expect(before, <String, dynamic>{'consent': 'x'});
  });

  test('withStoreScreenshot appends after an existing screenshot and keeps '
      'every other key', () {
    const List<int> first = <int>[1];
    const List<int> second = <int>[2, 3];
    final Map<String, dynamic> before = <String, dynamic>{
      'consent': 'x',
      'errors': <String>['e'],
      'screenshots': <dynamic>[_entry('a', first)],
    };
    final Map<String, dynamic> out = withStoreScreenshot(before, 'b', second);
    expect(out, <String, dynamic>{
      'consent': 'x',
      'errors': <String>['e'],
      'screenshots': <dynamic>[_entry('a', first), _entry('b', second)],
    });
    expect(before['screenshots'], hasLength(1), reason: 'a NEW map');
  });
}
