// ─────────────────────────────────────────────────────────────────────────────
// store_frame_fold.dart — WHERE THE PAGE ENDS IN A STORE FRAME, IN THE UNITS THE
// HOST'S PNG IS WRITTEN IN.
//
// ⏱ 2026-09-22 (store-frame-followup). The row-edge check on the host
// (`tooling/store/capture-row-edge.mjs`) reads a PNG and nothing else, so it
// cannot know where the page stops. The suite measures that here, per frame,
// and publishes it through `binding.reportData` under `folds`; the driver
// writes `reportData` whole, so no driver edit is needed.
//
// PURE DART ON PURPOSE. The measuring (which widget, which rect) lives in the
// suite, where a `WidgetTester` exists. What lives here is the arithmetic that
// turns logical pixels into PNG rows and the checks that refuse a record the
// host could not read, so `test/store_frame_fold_test.dart` can pin both
// without pumping anything.
//
// The host reads the three device rows just ABOVE `foldDeviceY`, across the
// content span minus `skipLogical`, and fails the set on any pixel off
// `pageGroundArgb` by more than its tolerance: a card cut by the frame edge
// with no fade over it.
// ─────────────────────────────────────────────────────────────────────────────

/// The fold of one written store frame.
class StoreFrameFold {
  const StoreFrameFold({
    required this.frame,
    required this.dpr,
    required this.viewWidthLogical,
    required this.foldTopLogical,
    required this.pageGroundArgb,
    required this.contentLeftLogical,
    required this.contentRightLogical,
    this.skipLogical = const <List<double>>[],
  });

  /// How far past an overlay's rect its shadow can reach, in logical pixels.
  /// The suite inflates the FAB's rect by this before recording it as a skip,
  /// the same margin `test/width_shell_fab_test.dart` skips around it.
  static const double shadowPad = 16;

  /// How many device rows above the fold the host reads.
  static const int rowsRead = 3;

  /// The frame name exactly as the PNG is named, without `.png`.
  final String frame;

  /// Device pixels per logical pixel in the frame's view.
  final double dpr;

  /// The view's width in logical pixels. The host checks
  /// `round(viewWidthLogical * dpr)` against the PNG's width: a mismatch means
  /// the PNG is not at this scale and every row index below would be wrong.
  final double viewWidthLogical;

  /// The body's bottom edge: the last logical y that is still page.
  final double foldTopLogical;

  /// The page ground, `0xAARRGGBB`. Must be opaque: the PNG is flattened, and
  /// a translucent ground has no single colour to compare a pixel against.
  final int pageGroundArgb;

  /// The page's horizontal span. On the rail layout it starts right of the
  /// rail, which is not page and is not read.
  final double contentLeftLogical;
  final double contentRightLogical;

  /// Horizontal spans `[left, right]` NOT read: overlays that sit on the fold
  /// line (the FAB on the rail layout), padded for their shadow.
  final List<List<double>> skipLogical;

  /// The first device row that is NOT page. The host reads rows
  /// `[foldDeviceY - rowsRead, foldDeviceY)`. Floored, so a fold that falls
  /// inside a device row leaves that shared row out of the band rather than
  /// reading half-page, half-shell pixels.
  int get foldDeviceY => (foldTopLogical * dpr).floor();

  /// The first device column read. Ceiled, for the same reason as above.
  int get contentLeftDevice => (contentLeftLogical * dpr).ceil();

  /// One past the last device column read.
  int get contentRightDevice => (contentRightLogical * dpr).floor();

  /// The expected PNG width.
  int get viewWidthDevice => (viewWidthLogical * dpr).round();

  /// The ground as `[r, g, b]`.
  List<int> get groundRgb => <int>[
    (pageGroundArgb >> 16) & 0xff,
    (pageGroundArgb >> 8) & 0xff,
    pageGroundArgb & 0xff,
  ];

  /// Everything that would make the record unreadable or meaningless on the
  /// host. Empty means publishable.
  List<String> problems() {
    final List<String> out = <String>[];
    if (!RegExp(r'^\d{2}-[a-z]+$').hasMatch(frame)) {
      out.add('frame "$frame" is not a listing frame name like 01-home');
    }
    if (!dpr.isFinite || dpr <= 0) out.add('dpr $dpr is not a positive number');
    if (!viewWidthLogical.isFinite || viewWidthLogical <= 0) {
      out.add('view width $viewWidthLogical is not a positive number');
    }
    if (!foldTopLogical.isFinite || foldTopLogical <= rowsRead) {
      out.add('fold $foldTopLogical leaves no rows above it to read');
    }
    if (((pageGroundArgb >> 24) & 0xff) != 0xff) {
      out.add(
        'ground 0x${pageGroundArgb.toRadixString(16)} is not opaque, so a '
        'flattened PNG has no single colour to match it against',
      );
    }
    if (!(contentLeftLogical < contentRightLogical) ||
        contentLeftLogical < 0 ||
        contentRightLogical > viewWidthLogical + 0.5) {
      out.add(
        'content span $contentLeftLogical..$contentRightLogical is empty or '
        'outside the view width $viewWidthLogical',
      );
    }
    for (final List<double> span in skipLogical) {
      if (span.length != 2 || !(span[0] < span[1])) {
        out.add('skip span $span is not [left, right]');
      }
    }
    return out;
  }

  Map<String, Object> toJson() => <String, Object>{
    'frame': frame,
    'dpr': dpr,
    'viewWidthLogical': viewWidthLogical,
    'foldTopLogical': foldTopLogical,
    'pageGroundArgb': pageGroundArgb,
    'contentLeftLogical': contentLeftLogical,
    'contentRightLogical': contentRightLogical,
    'skipLogical': skipLogical,
  };
}
