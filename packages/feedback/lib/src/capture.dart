import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show RenderSensitive, ScreenCapture;

/// 🔴 THE DEFAULT BLUR, decided BEFORE anything leaves the device (lane
/// feedback-intake, Do 2): every text field's content ([RenderEditable]) and
/// every widget the app marked private ([RenderSensitive], design_system's
/// `Sensitive`), as rectangles in [boundary]'s logical coordinates. A matched
/// object's children are covered by its own rectangle and are not walked.
List<Rect> redactionRects(RenderBox boundary) {
  final List<Rect> rects = <Rect>[];
  void visit(RenderObject o) {
    if (o is RenderEditable || o is RenderSensitive) {
      final RenderBox box = o as RenderBox;
      if (box.attached && box.hasSize) {
        rects.add(
          MatrixUtils.transformRect(
            box.getTransformTo(boundary),
            Offset.zero & box.size,
          ),
        );
      }
      return;
    }
    o.visitChildren(visit);
  }

  boundary.visitChildren(visit);
  return rects;
}

/// A captured screen: the raw pixels, the LOCKED redaction rectangles (in image
/// pixels), and the scale from logical pixels to image pixels.
class FeedbackShot {
  const FeedbackShot({
    required this.image,
    required this.locked,
    required this.pixelRatio,
  });

  final ui.Image image;
  final List<Rect> locked;
  final double pixelRatio;
}

/// Captures the screen under [boundaryKey] (default design_system's
/// [ScreenCapture.boundaryKey], which the chassis app root mounts)
/// with its redaction rectangles, or null when nothing is mounted there. The
/// returned [FeedbackShot.image] is NOT yet redacted: [renderShot] paints the
/// locked rectangles over it, and is the only way out of this package.
Future<FeedbackShot?> captureScreen({
  GlobalKey? boundaryKey,
  double pixelRatio = 1,
}) async {
  final RenderObject? ro = (boundaryKey ?? ScreenCapture.boundaryKey)
      .currentContext
      ?.findRenderObject();
  if (ro is! RenderRepaintBoundary || !ro.hasSize) return null;
  final ui.Image image = await ro.toImage(pixelRatio: pixelRatio);
  final List<Rect> locked = redactionRects(ro)
      .map(
        (Rect r) => Rect.fromLTRB(
          r.left * pixelRatio,
          r.top * pixelRatio,
          r.right * pixelRatio,
          r.bottom * pixelRatio,
        ),
      )
      .toList(growable: false);
  return FeedbackShot(image: image, locked: locked, pixelRatio: pixelRatio);
}

/// What the person added on top of the screenshot.
enum MarkupTool { blur, highlight, draw }

/// One mark, in image pixels. A blur or a highlight is a rectangle; a drawing
/// is a stroke.
sealed class MarkupOp {
  const MarkupOp();
}

class MarkupRect extends MarkupOp {
  const MarkupRect(this.tool, this.rect) : assert(tool != MarkupTool.draw);
  final MarkupTool tool;
  final Rect rect;
}

class MarkupStroke extends MarkupOp {
  const MarkupStroke(this.points);
  final List<Offset> points;
}

/// The colours a shot is marked in: [cover] fills every blur (the locked ones
/// and the person's), [ink] draws highlights and strokes. Both come from the
/// app's theme, never a constant here.
class MarkupColors {
  const MarkupColors({required this.cover, required this.ink});

  factory MarkupColors.of(ThemeData theme) => MarkupColors(
    cover: theme.colorScheme.inverseSurface,
    ink: theme.colorScheme.error,
  );

  final Color cover;
  final Color ink;
}

/// Paints [shot]'s locked blur and then [ops] on a canvas of the image's size.
/// Shared by the on-screen editor and [renderShot], so what the person sees is
/// what is sent.
void paintMarkup(
  Canvas canvas,
  FeedbackShot shot,
  List<MarkupOp> ops,
  MarkupColors colors,
) {
  canvas.drawImage(shot.image, Offset.zero, Paint());
  final Paint cover = Paint()..color = colors.cover.withValues(alpha: 1);
  for (final Rect r in shot.locked) {
    canvas.drawRect(r, cover);
  }
  final double stroke = 3 * shot.pixelRatio;
  final Paint ink = Paint()
    ..color = colors.ink
    ..style = PaintingStyle.stroke
    ..strokeWidth = stroke
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;
  for (final MarkupOp op in ops) {
    switch (op) {
      case MarkupRect(tool: MarkupTool.blur, :final Rect rect):
        canvas.drawRect(rect, cover);
      case MarkupRect(:final Rect rect):
        canvas.drawRect(rect, ink);
      case MarkupStroke(:final List<Offset> points):
        if (points.length < 2) continue;
        final Path path = Path()..moveTo(points.first.dx, points.first.dy);
        for (final Offset p in points.skip(1)) {
          path.lineTo(p.dx, p.dy);
        }
        canvas.drawPath(path, ink);
    }
  }
  // The locked blur is painted AGAIN on top: no highlight or stroke may show
  // through a rectangle the person is not allowed to un-blur.
  for (final Rect r in shot.locked) {
    canvas.drawRect(r, cover);
  }
}

/// The image that is sent: [shot] with its locked blur and [ops] painted in.
Future<ui.Image> renderShot(
  FeedbackShot shot,
  List<MarkupOp> ops,
  MarkupColors colors,
) async {
  final ui.PictureRecorder recorder = ui.PictureRecorder();
  paintMarkup(Canvas(recorder), shot, ops, colors);
  final ui.Picture picture = recorder.endRecording();
  try {
    return await picture.toImage(shot.image.width, shot.image.height);
  } finally {
    picture.dispose();
  }
}

/// [image] as PNG bytes.
Future<Uint8List> pngBytes(ui.Image image) async {
  final ByteData? data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data!.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
}
