import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Marks [child] as PRIVATE for a "Report a problem" screenshot (lane
/// feedback-intake, Do 2): a money amount, an e-mail address, a name.
///
/// It changes nothing on screen — no paint, no layout, no semantics. What it
/// adds is a render object of its own type, [RenderSensitive], which
/// packages/feedback's capture finds by walking the render tree and paints
/// over before the image leaves the device, together with every text field's
/// content. The person can add blur on top; they cannot remove this one.
///
/// Wrap the smallest widget that holds the private value, so the rest of the
/// screen stays readable in the report.
class Sensitive extends SingleChildRenderObjectWidget {
  const Sensitive({super.key, super.child});

  @override
  RenderSensitive createRenderObject(BuildContext context) => RenderSensitive();
}

/// The render object [Sensitive] leaves in the tree: a pure proxy, found by
/// its type. See [Sensitive].
class RenderSensitive extends RenderProxyBox {
  RenderSensitive({RenderBox? child}) : super(child);
}

/// Where a "Report a problem" screenshot is taken from: the app root mounts
/// ONE [ScreenCaptureBoundary] above its Navigator (the chassis `NikatruApp`
/// does it in `MaterialApp.router`'s builder), and packages/feedback captures
/// what is under it, with every [Sensitive] widget and every text field
/// painted over before the image leaves the device.
abstract final class ScreenCapture {
  static final GlobalKey boundaryKey = GlobalKey(debugLabel: 'screen.capture');
}

/// A [RepaintBoundary] keyed [ScreenCapture.boundaryKey] (or [boundaryKey]).
/// Paints nothing of its own.
class ScreenCaptureBoundary extends StatelessWidget {
  const ScreenCaptureBoundary({super.key, required this.child, this.boundaryKey});

  final Widget child;

  /// Overrides [ScreenCapture.boundaryKey]; tests and an app with its own
  /// root boundary pass theirs.
  final GlobalKey? boundaryKey;

  @override
  Widget build(BuildContext context) =>
      RepaintBoundary(key: boundaryKey ?? ScreenCapture.boundaryKey, child: child);
}
