// store_frame_shutter.dart: the store capture's shutter, chosen per platform.
//
// 🔴 THE DEFECT (O-DESKTOP-CAPTURE-HAS-NO-SHUTTER). The capture suite used to
// pass `binding.takeScreenshot` to every frame. That asks the PLATFORM for its
// pixels through the integration_test plugin, and on linux, windows and macOS
// the capture has no such platform shutter to ask. The native window is also
// whatever size the runner's desktop gives it, which is not a size the
// register chose.
//
// So the desktop targets photograph a LAYER instead: the `RepaintBoundary`
// keyed `E2EKeys.storeFrame` that `lib/app.dart` puts at the app root, rendered
// to a PNG at the geometry the suite imposed from `STORE_CAPTURE_VIEW` (the
// runner builds that define from the register's `capture` block). A root layer
// that is not the imposed size is REFUSED rather than photographed, so a frame
// at the wrong size never becomes bytes. Web, android and iOS keep the plugin
// shutter, through the same `storeShutter` function.
//
// The layer's PNG reaches the host the way the plugin's does: appended to
// `binding.reportData['screenshots']` as `{screenshotName, bytes}`, the entry
// `IntegrationTestWidgetsFlutterBinding.takeScreenshot` appends and
// `test_driver/store_screenshots.dart` writes out.
//
// `tooling/store/capture-suite-scan.mjs` reads this file as text: limb 5 needs
// one `TargetPlatform.<desktop> => StoreShutterKind.layer,` arm per desktop
// device the register captures on, and limb 4 needs the suite to bind ONE
// `storeShutter(` and pass it as every frame's `take:`.

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';

/// Photographs the frame now on screen under the name [frame]. The type
/// `captureFrame`'s `take:` parameter has.
typedef StoreShutter = Future<void> Function(String frame);

/// Which shutter a platform's capture uses.
enum StoreShutterKind {
  /// `IntegrationTestWidgetsFlutterBinding.takeScreenshot`: the platform's
  /// own pixels.
  plugin,

  /// The app root's `RepaintBoundary`, rendered at the imposed geometry.
  layer,
}

/// The shutter for a platform. Web is the plugin whatever the host OS is.
StoreShutterKind storeShutterKindFor({
  required bool isWeb,
  required TargetPlatform platform,
}) {
  if (isWeb) {
    return StoreShutterKind.plugin;
  }
  return switch (platform) {
    TargetPlatform.android => StoreShutterKind.plugin,
    TargetPlatform.iOS => StoreShutterKind.plugin,
    TargetPlatform.linux => StoreShutterKind.layer,
    TargetPlatform.windows => StoreShutterKind.layer,
    TargetPlatform.macOS => StoreShutterKind.layer,
    TargetPlatform.fuchsia => throw ArgumentError.value(
      platform,
      'platform',
      'no store channel captures on fuchsia, so it has no shutter',
    ),
  };
}

/// The shutter for the platform this test is running on. The one place the
/// capture reads `kIsWeb` and `defaultTargetPlatform`.
StoreShutterKind currentStoreShutterKind() =>
    storeShutterKindFor(isWeb: kIsWeb, platform: defaultTargetPlatform);

final RegExp _storeViewDefine = RegExp(r'^(\d+)x(\d+)@(\d+(?:\.\d+)?)$');

/// A capture geometry: logical width and height, and the device pixel ratio.
/// Written `1280x800@2` in `STORE_CAPTURE_VIEW`.
class StoreViewGeometry {
  const StoreViewGeometry({
    required this.logicalWidth,
    required this.logicalHeight,
    required this.dpr,
  });

  /// Reads `<width>x<height>@<dpr>`, and refuses anything else with the value.
  factory StoreViewGeometry.parse(String define) {
    final RegExpMatch? m = _storeViewDefine.firstMatch(define);
    if (m == null) {
      throw ArgumentError.value(
        define,
        'STORE_CAPTURE_VIEW',
        'expected <width>x<height>@<dpr>, as the runner sends 1280x800@2',
      );
    }
    final StoreViewGeometry geometry = StoreViewGeometry(
      logicalWidth: int.parse(m.group(1)!),
      logicalHeight: int.parse(m.group(2)!),
      dpr: double.parse(m.group(3)!),
    );
    if (geometry.logicalWidth == 0 ||
        geometry.logicalHeight == 0 ||
        geometry.dpr <= 0) {
      throw ArgumentError.value(
        define,
        'STORE_CAPTURE_VIEW',
        'a zero width, height or pixel ratio is no frame at all',
      );
    }
    return geometry;
  }

  final int logicalWidth;
  final int logicalHeight;
  final double dpr;

  ui.Size get logicalSize =>
      ui.Size(logicalWidth.toDouble(), logicalHeight.toDouble());

  ui.Size get physicalSize => ui.Size(logicalWidth * dpr, logicalHeight * dpr);

  @override
  String toString() => '${logicalWidth}x$logicalHeight@$dpr';
}

/// Lays the app out at [geometry] whatever size the native window is. Reset
/// when the test ends.
void imposeStoreGeometry(WidgetTester tester, StoreViewGeometry geometry) {
  tester.view.devicePixelRatio = geometry.dpr;
  tester.view.physicalSize = geometry.physicalSize;
  addTearDown(tester.view.reset);
}

/// Renders the `E2EKeys.storeFrame` layer to PNG bytes at [geometry].
///
/// REFUSES (a `StateError`, never an `assert`, which a release-mode drive would
/// skip) when the layer is missing, when it is not the imposed logical size,
/// and when the engine hands back no PNG. The size refusal is the one that
/// matters: a layer at another size would come out at another size, and the
/// listing guard would refuse the frame only after the whole run.
Future<Uint8List> captureStoreLayer(
  WidgetTester tester,
  StoreViewGeometry geometry,
) async {
  final Finder root = find.byKey(E2EKeys.storeFrame);
  final int found = root.evaluate().length;
  if (found != 1) {
    throw StateError(
      'store capture REFUSED: $found widget(s) carry E2EKeys.storeFrame, '
      'and the layer shutter photographs exactly one (the RepaintBoundary '
      "at the root of lib/app.dart's builder).",
    );
  }
  final RenderRepaintBoundary boundary = tester
      .renderObject<RenderRepaintBoundary>(root);
  if (boundary.size != geometry.logicalSize) {
    throw StateError(
      'store capture REFUSED: the root layer is '
      '${boundary.size.width}x${boundary.size.height} logical and '
      'STORE_CAPTURE_VIEW imposed $geometry. A frame photographed at this '
      'size is not the size the register declares.',
    );
  }
  final ui.Image image = await boundary.toImage(pixelRatio: geometry.dpr);
  try {
    final ByteData? png = await image.toByteData(
      format: ui.ImageByteFormat.png,
    );
    if (png == null) {
      throw StateError(
        'store capture REFUSED: the engine returned no PNG bytes for the '
        '$geometry layer.',
      );
    }
    return png.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes);
  } finally {
    image.dispose();
  }
}

/// [reportData] with one more screenshot, in the `{screenshotName, bytes}`
/// shape the plugin shutter appends and the driver reads. A NEW map: every
/// existing key is kept and the argument is not modified.
Map<String, dynamic> withStoreScreenshot(
  Map<String, dynamic>? reportData,
  String name,
  List<int> bytes,
) {
  final List<dynamic> screenshots = <dynamic>[
    ...?(reportData?['screenshots'] as List<dynamic>?),
    <String, dynamic>{'screenshotName': name, 'bytes': bytes},
  ];
  return <String, dynamic>{...?reportData, 'screenshots': screenshots};
}

/// Where a shutter's pixels go. The binding in the suite; a recorder in a test.
abstract class StoreScreenshotSink {
  /// The platform's own shutter.
  Future<void> plugin(String frame);

  /// Keeps bytes the layer shutter produced, under [name].
  void record(String name, List<int> bytes);
}

/// The one sink the suite uses.
class BindingScreenshotSink implements StoreScreenshotSink {
  BindingScreenshotSink(this.binding);

  final IntegrationTestWidgetsFlutterBinding binding;

  @override
  Future<void> plugin(String frame) async {
    await binding.takeScreenshot(frame);
  }

  @override
  void record(String name, List<int> bytes) {
    binding.reportData = withStoreScreenshot(binding.reportData, name, bytes);
  }
}

/// The shutter for [kind]. `plugin` takes no geometry, since it photographs the
/// platform's surface as it is; `layer` requires one.
StoreShutter storeShutter({
  required WidgetTester tester,
  required StoreScreenshotSink sink,
  required StoreShutterKind kind,
  StoreViewGeometry? geometry,
}) {
  if (kind == StoreShutterKind.plugin) {
    if (geometry != null) {
      throw ArgumentError.value(
        geometry,
        'geometry',
        'the plugin shutter photographs the surface as it is; nothing imposed',
      );
    }
    return (String frame) => sink.plugin(frame);
  }
  if (geometry == null) {
    throw ArgumentError.value(
      geometry,
      'geometry',
      'the layer shutter needs the imposed geometry to check the layer against',
    );
  }
  final StoreViewGeometry imposed = geometry;
  return (String frame) async {
    sink.record(frame, await captureStoreLayer(tester, imposed));
  };
}
