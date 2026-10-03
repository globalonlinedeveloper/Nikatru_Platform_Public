import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing;

import 'capture.dart';
import 'l10n/feedback_strings.g.dart';

/// Keys a test finds the editor's controls by.
abstract final class MarkupKeys {
  static const Key canvas = Key('feedback.markup.canvas');
  static const Key undo = Key('feedback.markup.undo');
  static const Key done = Key('feedback.markup.done');
}

/// Draw, highlight and blur on a captured screen (lane feedback-intake, Do 1).
///
/// The locked blur ([FeedbackShot.locked]) is painted under and over every
/// mark and is not an op: Undo removes the person's own marks only, so the
/// default blur can be added to, never removed. Pops with the final op list.
class MarkupEditorPage extends StatefulWidget {
  const MarkupEditorPage({
    super.key,
    required this.shot,
    required this.initial,
  });

  final FeedbackShot shot;
  final List<MarkupOp> initial;

  @override
  State<MarkupEditorPage> createState() => _MarkupEditorPageState();
}

class _MarkupEditorPageState extends State<MarkupEditorPage> {
  late final List<MarkupOp> _ops = List<MarkupOp>.of(widget.initial);
  MarkupTool _tool = MarkupTool.blur;
  Offset? _start;
  MarkupOp? _live;
  double _scale = 1;

  Offset _toImage(Offset local) => local / _scale;

  void _begin(Offset local) {
    _start = _toImage(local);
    _live = _tool == MarkupTool.draw
        ? MarkupStroke(<Offset>[_start!])
        : MarkupRect(_tool, Rect.fromPoints(_start!, _start!));
  }

  void _move(Offset local) {
    final Offset p = _toImage(local);
    setState(() {
      _live = switch (_live) {
        MarkupStroke(:final List<Offset> points) => MarkupStroke(<Offset>[
          ...points,
          p,
        ]),
        MarkupRect(:final MarkupTool tool) => MarkupRect(
          tool,
          Rect.fromPoints(_start!, p),
        ),
        null => null,
      };
    });
  }

  void _end() {
    final MarkupOp? op = _live;
    setState(() {
      if (op != null) _ops.add(op);
      _live = null;
      _start = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final FeedbackStrings s = FeedbackStrings.of(
      Localizations.localeOf(context),
    );
    final MarkupColors colors = MarkupColors.of(Theme.of(context));
    final ui.Image image = widget.shot.image;
    return Scaffold(
      appBar: AppBar(
        title: Text(s.markupScreenshot),
        actions: <Widget>[
          IconButton(
            key: MarkupKeys.undo,
            tooltip: s.markupUndo,
            icon: const Icon(Icons.undo),
            onPressed: _ops.isEmpty ? null : () => setState(_ops.removeLast),
          ),
          TextButton(
            key: MarkupKeys.done,
            onPressed: () => Navigator.of(context).pop(_ops),
            child: Text(s.markupDone),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(AppSpacing.sm),
              child: SegmentedButton<MarkupTool>(
                segments: <ButtonSegment<MarkupTool>>[
                  ButtonSegment<MarkupTool>(
                    value: MarkupTool.blur,
                    label: Text(s.markupBlur),
                  ),
                  ButtonSegment<MarkupTool>(
                    value: MarkupTool.highlight,
                    label: Text(s.markupHighlight),
                  ),
                  ButtonSegment<MarkupTool>(
                    value: MarkupTool.draw,
                    label: Text(s.markupDraw),
                  ),
                ],
                selected: <MarkupTool>{_tool},
                onSelectionChanged: (Set<MarkupTool> v) =>
                    setState(() => _tool = v.first),
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints c) {
                  _scale = (c.maxWidth / image.width).clamp(
                    0.01,
                    double.infinity,
                  );
                  if (image.height * _scale > c.maxHeight)
                    _scale = c.maxHeight / image.height;
                  return Center(
                    child: GestureDetector(
                      key: MarkupKeys.canvas,
                      onPanStart: (DragStartDetails d) =>
                          _begin(d.localPosition),
                      onPanUpdate: (DragUpdateDetails d) =>
                          _move(d.localPosition),
                      onPanEnd: (DragEndDetails _) => _end(),
                      child: CustomPaint(
                        size: Size(image.width * _scale, image.height * _scale),
                        painter: _ShotPainter(
                          shot: widget.shot,
                          ops: <MarkupOp>[..._ops, ?_live],
                          colors: colors,
                          scale: _scale,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints a shot with its marks through [paintMarkup], scaled to fit: the
/// preview and the sent image share one painter.
class _ShotPainter extends CustomPainter {
  _ShotPainter({
    required this.shot,
    required this.ops,
    required this.colors,
    required this.scale,
  });

  final FeedbackShot shot;
  final List<MarkupOp> ops;
  final MarkupColors colors;
  final double scale;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(scale);
    paintMarkup(canvas, shot, ops, colors);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_ShotPainter old) =>
      old.ops != ops || old.scale != scale || old.shot != shot;
}

/// A thumbnail of [shot] with [ops], as it will be sent.
class ShotPreview extends StatelessWidget {
  const ShotPreview({
    super.key,
    required this.shot,
    required this.ops,
    required this.height,
  });

  final FeedbackShot shot;
  final List<MarkupOp> ops;
  final double height;

  @override
  Widget build(BuildContext context) {
    final double scale = height / shot.image.height;
    return CustomPaint(
      size: Size(shot.image.width * scale, height),
      painter: _ShotPainter(
        shot: shot,
        ops: ops,
        colors: MarkupColors.of(Theme.of(context)),
        scale: scale,
      ),
    );
  }
}
