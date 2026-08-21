import 'dart:math' as math;

import 'package:flutter/material.dart';

// 🔴 NO `app_colors.dart` IMPORT ANY MORE, AND ITS ABSENCE IS THE POINT.
// `RingPainter.track` was the file's only use of it, and a painter that can
// reach the light palette is a painter that can silently bake it — which is
// what it did. Neither class here now knows a colour that is not handed to it
// by a caller that HAS a `BuildContext`. (`AppColors` is still named in the
// prose below as the value the callers pass in light.)

/// Segmented donut (category breakdown). Draws a ring; the caller stacks the
/// centre label on top.
class DonutPainter extends CustomPainter {
  DonutPainter({required this.segments, this.stroke = 19});

  /// (value, color) pairs. Values need not be normalized.
  final List<MapEntry<double, Color>> segments;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final double total =
        segments.fold(0.0, (double a, MapEntry<double, Color> s) => a + s.key);
    if (total <= 0) return;

    final Offset center = size.center(Offset.zero);
    final double radius = math.min(size.width, size.height) / 2 - stroke / 2;
    final Rect rect = Rect.fromCircle(center: center, radius: radius);

    double start = -math.pi / 2;
    final Paint p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;

    for (final MapEntry<double, Color> seg in segments) {
      final double sweep = seg.key / total * 2 * math.pi;
      p.color = seg.value;
      canvas.drawArc(rect, start, sweep, false, p);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant DonutPainter old) =>
      old.segments != segments || old.stroke != stroke;
}

/// Progress ring for the budget gauge.
class RingPainter extends CustomPainter {
  RingPainter({
    required this.progress,
    required this.color,
    required this.track,
    this.stroke = 22,
  });

  final double progress; // 0..1
  final Color color;

  /// The UNFILLED remainder of the ring — the thing [color]'s arc is drawn on
  /// top of. **Required on purpose; see below.**
  ///
  /// 🔴 IT DEFAULTED TO `AppColors.line` (#ECECF2) UNTIL 2026-08-21 AND NEITHER
  /// CALLER OVERRODE IT, so on a dark screen the ring's *background* was the
  /// brightest thing on the page. Measured against the seeded dark scheme
  /// (seed #6459F5 → surface #131318, surfaceContainerHighest #35343A,
  /// outlineVariant #47464F):
  ///   · budget, ring on a #35343A card — track #ECECF2 read **10.48:1** while
  ///     the #6459F5 arc it is the background of read only 2.52:1 on the same
  ///     card — i.e. the track sat **4.16:1 ABOVE the arc itself**, and the
  ///     gauge read inside-out: brightest where it was empty. (One fact, not
  ///     two: two ratios over a shared ground divide to the ratio between
  ///     them, so 10.48/2.52 IS the 4.16 track-vs-arc figure.)
  ///   · scan, ring on the #131318 scaffold — track **15.74:1** against a
  ///     3.78:1 arc, i.e. near the maximum contrast the screen can produce, on
  ///     the one shape a first-run user stares at while the CTA is disabled.
  /// With a theme-resolved track (`scheme.outlineVariant` #47464F, the slot the
  /// detail screen's `LinearProgressIndicator` already uses for this job):
  ///   · budget — track 1.32:1 on the card, arc **1.90:1 ABOVE the track**
  ///     (2.63:1 when the arc is `danger` #EF4D6A). The fill reads as the fill.
  ///   · scan — track 1.99:1 on the scaffold, arc 1.90:1 above it.
  /// ⚠️ These are FIGURE-ON-GROUND ratios for a 22px/14px band, NOT text: WCAG
  /// 1.4.3's 4.5 does not apply to either number. The defect was the INVERSION,
  /// not a threshold.
  /// ✅ Light is untouched — both callers still pass `AppColors.line` there, so
  /// the budget card keeps 1.18:1 on #FFFFFF and scan 1.12:1 on #FCF8FF.
  ///
  /// 🔴 REQUIRED RATHER THAN RE-DEFAULTED, and that is the actual fix. A
  /// `CustomPainter` has no `BuildContext`, so a theme-correct track cannot be
  /// resolved in here at all — every possible default is a literal that is
  /// right in one brightness and wrong in the other. That is precisely how both
  /// call sites came to paint a near-white track without either of them naming
  /// a colour: the omission was silent and looked like a choice. Requiring it
  /// makes forgetting a compile error, which is the only version of this a
  /// future caller cannot repeat.
  final Color track;

  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = size.center(Offset.zero);
    final double radius = math.min(size.width, size.height) / 2 - stroke / 2;
    final Rect rect = Rect.fromCircle(center: center, radius: radius);

    final Paint base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = track;
    canvas.drawCircle(center, radius, base);

    final Paint arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..color = color;
    canvas.drawArc(
        rect, -math.pi / 2, progress.clamp(0, 1) * 2 * math.pi, false, arc);
  }

  /// 🔴 [track] AND [stroke] ARE IN HERE NOW BECAUSE [track] BECAME THEME-BOUND.
  /// This compared [progress] and [color] only, which was survivable while the
  /// track was a compile-time constant that could never differ between two
  /// instances. It cannot survive the fix: on a live brightness flip the widget
  /// rebuilds with a new painter whose [track] has moved but whose [progress]
  /// and [color] have not, `shouldRepaint` answers false, and the ring keeps
  /// painting the OTHER theme's track — the exact defect this change removes,
  /// re-entering through the cache. [stroke] is added for the same reason
  /// [DonutPainter] already compares it: a constructor argument that changes
  /// the pixels and is not compared is a stale frame waiting for a caller.
  @override
  bool shouldRepaint(covariant RingPainter old) =>
      old.progress != progress ||
      old.color != color ||
      old.track != track ||
      old.stroke != stroke;
}
