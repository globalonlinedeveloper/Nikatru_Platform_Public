import 'dart:io';
import 'dart:typed_data';

// ─────────────────────────────────────────────────────────────────────────────
// brand_assets.dart — generate a stamped app's icons from its spec.
//
// [pipeline S-14] "A stamp carries the app's brand assets, not Flutter's."
//
// WHY THIS EXISTS. Measured 2026-07-29: all five icons the brick stamped were
// BYTE-IDENTICAL to stock `flutter create` output, so every app the factory
// produced shipped Flutter's default icon on its one claimed platform — DoD
// §4-G's defect reproduced in the template, where it would be inherited by all
// fifty apps at once.
//
// ── WHY NO DEPENDENCY, AND WHY NOT "STORED" PNG ─────────────────────────────
// hooks/pubspec.yaml declares only `mason`, and adding an image package to the
// STAMPING path means every stamp resolves it. `dart:io`'s ZLibCodec is real
// deflate at zero cost, so a PNG encoder is ~100 lines here. Uncompressed
// ("stored") PNG was rejected on arithmetic: 512x512 RGB is 786 KB raw, so the
// five assets would add ~2 MB PER APP to the repo — 100 MB across the portfolio,
// to ship a flat-colour mark that compresses to a few KB.
//
// ── WHY A GENERATED MARK AND NOT GENERATED ART ──────────────────────────────
// [ADR 019]'s NO-IP-PROMPTING rule binds anything the factory generates, and the
// safest way to obey a rule about model prompts is to use no model. This mark is
// pure arithmetic over `app_id` and `seed_hex`: it cannot resemble anyone's
// trademark, needs no provenance entry, and is reproducible from the spec alone
// — which is also what lets a guard re-derive it and check the stamp did not lie.
// ─────────────────────────────────────────────────────────────────────────────

/// Writes the app's web brand assets into [webDir]. Returns the paths written.
///
/// Deterministic: the same `app_id` + `seed_hex` always produce byte-identical
/// files. That is load-bearing for `[3]S-15`, whose acceptance is that a
/// re-stamp is byte-identical to the committed app.
List<String> writeWebBrandAssets({
  required Directory webDir,
  required String appId,
  required String seedHex,
}) {
  final int seed = _parseHex(seedHex);
  final List<bool> cells = _markCells(appId);
  final _Rgb bg = _Rgb.fromInt(seed);
  final _Rgb fg = _contrastOn(bg);

  final iconsDir = Directory('${webDir.path}/icons');
  if (!iconsDir.existsSync()) iconsDir.createSync(recursive: true);
  if (!webDir.existsSync()) webDir.createSync(recursive: true);

  final written = <String>[];
  void emit(String path, int size, double markFraction) {
    final png = _renderIcon(
      size: size,
      bg: bg,
      fg: fg,
      cells: cells,
      markFraction: markFraction,
    );
    File(path).writeAsBytesSync(png);
    written.add(path);
  }

  // A maskable icon may be cropped to a circle by the platform, so its mark sits
  // inside the safe zone (the middle 60%) rather than filling the canvas. The
  // plain icons are never cropped and can breathe wider. Shipping one image for
  // both is how a logo ends up with its edges shaved off on Android.
  emit('${webDir.path}/favicon.png', 32, 0.72);
  emit('${iconsDir.path}/Icon-192.png', 192, 0.72);
  emit('${iconsDir.path}/Icon-512.png', 512, 0.72);
  emit('${iconsDir.path}/Icon-maskable-192.png', 192, 0.56);
  emit('${iconsDir.path}/Icon-maskable-512.png', 512, 0.56);
  return written;
}

/// Writes the NATIVE launcher-icon SOURCES into [iconDir]. Returns the paths.
///
/// 🔴 WHY THE BRICK NEEDS THESE AT ALL, WHEN IT STAMPS NO NATIVE PLATFORM.
/// It stamps `web/` only, and `[3]S-3` holds that claim — the owner adds the
/// rest with `flutter create . --platforms=…` after the stamp. That command is
/// EXACTLY WHAT WRITES FLUTTER'S DEFAULT ICONS, which is how `apps/subly` came
/// to ship the stock logo on Android, iOS, macOS and Windows simultaneously
/// (measured 2026-08-04: 29 files, all byte-identical to `flutter create`).
/// Fixing only Subly fixes one instance of a defect the template reproduces on
/// demand, for all fifty planned apps.
///
/// So the stamp lays down the MECHANISM rather than the artefacts: these source
/// images plus the `flutter_launcher_icons:` block in the stamped pubspec mean
/// that adding platforms is followed by ONE command that brands all of them.
/// `tooling/ci/assert-launcher-icons.mjs` fails the build if the config stops
/// naming a file this function writes.
///
/// Deterministic, like the web assets: same `app_id` + `seed_hex`, same bytes,
/// which is what `[3]S-15`'s byte-identical re-stamp requires. No model is
/// involved anywhere, so [ADR 019]'s NO-IP-PROMPTING rule is obeyed by
/// construction rather than by review.
List<String> writeNativeIconSources({
  required Directory iconDir,
  required String appId,
  required String seedHex,
}) {
  final int seed = _parseHex(seedHex);
  final List<bool> cells = _markCells(appId);
  final _Rgb bg = _Rgb.fromInt(seed);
  final _Rgb fg = _contrastOn(bg);

  if (!iconDir.existsSync()) iconDir.createSync(recursive: true);

  final written = <String>[];

  // The master every non-Android platform is derived from: 1024 square, OPAQUE.
  // 1024 because that is the largest size any store asks for (App Store /
  // Play), and every smaller one is a downscale of it. Opaque because the App
  // Store REJECTS an icon with an alpha channel (ITMS-90717) — an icon that
  // uploads and then fails validation remotely is the worst place to learn it.
  final master = '${iconDir.path}/app_icon.png';
  File(master).writeAsBytesSync(
    _renderIcon(size: 1024, bg: bg, fg: fg, cells: cells, markFraction: 0.72),
  );
  written.add(master);

  // The Android ADAPTIVE FOREGROUND: the mark ALONE, on transparency, so the
  // background layer shows through whatever mask the launcher applies.
  //
  // 0.52 IS THE SAFE ZONE, NOT A TASTE CHOICE. Android composites the layer at
  // 108dp and guarantees only the centre 72dp — 66.7% — survives; the rest can
  // be cropped by a circle, squircle or teardrop depending on the OEM. A mark
  // filling 52% of the canvas sits inside that box with margin for every mask,
  // which is why the stamped config sets `adaptive_icon_foreground_inset: 0`:
  // the inset is already in the artwork, and letting the tool inset it again
  // would shrink the mark twice.
  final foreground = '${iconDir.path}/app_icon_foreground.png';
  File(foreground).writeAsBytesSync(
    _renderIcon(
      size: 1024,
      bg: bg,
      fg: fg,
      cells: cells,
      markFraction: 0.52,
      transparentBackground: true,
    ),
  );
  written.add(foreground);

  // NO background PNG is written: the adaptive background is a FLAT `seed_hex`,
  // declared as a colour in the stamped pubspec. A generated flat-colour PNG
  // would be a second place the seed lives, and two copies of one fact is how
  // the wrong one ships.
  return written;
}

int _parseHex(String hex) {
  final cleaned = hex.replaceAll('#', '').trim();
  return int.tryParse(cleaned, radix: 16) ?? 0x6459F5;
}

class _Rgb {
  const _Rgb(this.r, this.g, this.b);
  factory _Rgb.fromInt(int v) =>
      _Rgb((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF);
  final int r, g, b;

  /// Relative luminance, sRGB weights. Used only to choose a legible foreground.
  double get luminance => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
}

/// White on a dark seed, near-black on a light one. A fixed foreground would be
/// invisible for half the possible seeds, and `seed_hex` is founder input.
_Rgb _contrastOn(_Rgb bg) =>
    bg.luminance < 0.55 ? const _Rgb(255, 255, 255) : const _Rgb(23, 23, 28);

/// A 5x5 horizontally-mirrored on/off grid derived from `app_id`.
///
/// Mirrored because an asymmetric random grid reads as noise while a symmetric
/// one reads as a deliberate mark — the same reason identicons are symmetric.
List<bool> _markCells(String appId) {
  int h = 0xcbf29ce484222325; // FNV-1a 64, deterministic and dependency-free
  for (final int c in appId.codeUnits) {
    h ^= c;
    h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF;
  }
  // 15 independent cells (3 columns x 5 rows); columns 3 and 4 mirror 1 and 0.
  final half = List<bool>.generate(15, (i) => ((h >> i) & 1) == 1);

  // A grid that is nearly empty or nearly full is not a mark, it is a blank or a
  // block. Nudge the degenerate tails rather than re-rolling, so the result stays
  // a pure function of app_id.
  int on = half.where((b) => b).length;
  for (int i = 0; on < 4; i++) {
    if (!half[i % 15]) {
      half[i % 15] = true;
      on++;
    }
  }
  for (int i = 0; on > 11; i++) {
    if (half[i % 15]) {
      half[i % 15] = false;
      on--;
    }
  }

  final cells = List<bool>.filled(25, false);
  for (int y = 0; y < 5; y++) {
    for (int x = 0; x < 3; x++) {
      final v = half[y * 3 + x];
      cells[y * 5 + x] = v;
      cells[y * 5 + (4 - x)] = v;
    }
  }
  return cells;
}

/// [transparentBackground] switches the output from opaque RGB to RGBA with the
/// field fully transparent — the shape an Android adaptive FOREGROUND layer must
/// take, and the only place alpha is wanted. Everything else stays opaque: a
/// maskable icon is cropped by the platform and must be full-bleed, and a
/// transparent favicon disappears into dark browser chrome.
Uint8List _renderIcon({
  required int size,
  required _Rgb bg,
  required _Rgb fg,
  required List<bool> cells,
  required double markFraction,
  bool transparentBackground = false,
}) {
  final int channels = transparentBackground ? 4 : 3;
  final px = Uint8List(size * size * channels);
  for (int i = 0; i < size * size; i++) {
    final int o = i * channels;
    px[o] = bg.r;
    px[o + 1] = bg.g;
    px[o + 2] = bg.b;
    // alpha 0 — the byte is already 0 from the zero-filled Uint8List, but
    // writing it makes the intent legible rather than incidental.
    if (transparentBackground) px[o + 3] = 0;
  }
  final double mark = size * markFraction;
  final double cell = mark / 5.0;
  final double originX = (size - mark) / 2.0;
  final double originY = (size - mark) / 2.0;

  for (int gy = 0; gy < 5; gy++) {
    for (int gx = 0; gx < 5; gx++) {
      if (!cells[gy * 5 + gx]) continue;
      final int x0 = (originX + gx * cell).round();
      final int y0 = (originY + gy * cell).round();
      final int x1 = (originX + (gx + 1) * cell).round();
      final int y1 = (originY + (gy + 1) * cell).round();
      for (int y = y0; y < y1 && y < size; y++) {
        for (int x = x0; x < x1 && x < size; x++) {
          if (x < 0 || y < 0) continue;
          final int i = (y * size + x) * channels;
          px[i] = fg.r;
          px[i + 1] = fg.g;
          px[i + 2] = fg.b;
          if (transparentBackground) px[i + 3] = 0xFF;
        }
      }
    }
  }
  return _encodePng(size, size, px, channels: channels);
}

// ── minimal PNG writer: 8-bit, one IDAT, no interlacing ──────────────────────
// Colour type 2 (RGB) by default; type 6 (RGBA) only for the adaptive
// foreground, which is the one asset that MUST be transparent.

Uint8List _encodePng(
  int width,
  int height,
  Uint8List pixels, {
  int channels = 3,
}) {
  final int stride = width * channels;
  final raw = BytesBuilder(copy: false);
  for (int y = 0; y < height; y++) {
    raw.addByte(
      0,
    ); // filter type 0 (None) — flat colour gains nothing from more
    raw.add(Uint8List.sublistView(pixels, y * stride, (y + 1) * stride));
  }
  // zlib (not raw deflate): PNG's IDAT carries a zlib stream, header and Adler
  // included. ZLibCodec defaults to that; passing raw:true here would produce a
  // file every decoder rejects.
  final compressed = Uint8List.fromList(
    ZLibCodec(level: 9).encode(raw.toBytes()),
  );

  final out = BytesBuilder(copy: false)
    ..add(const <int>[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  final ihdr = BytesBuilder(copy: false)
    ..add(_u32(width))
    ..add(_u32(height))
    // depth 8; colour type 2 (RGB) or 6 (RGBA).
    ..add(<int>[8, channels == 4 ? 6 : 2, 0, 0, 0]);
  out.add(_chunk('IHDR', ihdr.toBytes()));
  out.add(_chunk('IDAT', compressed));
  out.add(_chunk('IEND', Uint8List(0)));
  return out.toBytes();
}

Uint8List _u32(int v) => Uint8List.fromList(<int>[
      (v >> 24) & 0xFF,
      (v >> 16) & 0xFF,
      (v >> 8) & 0xFF,
      v & 0xFF,
    ]);

Uint8List _chunk(String type, Uint8List data) {
  final typeBytes = Uint8List.fromList(type.codeUnits);
  final body = BytesBuilder(copy: false)
    ..add(typeBytes)
    ..add(data);
  final bodyBytes = body.toBytes();
  return (BytesBuilder(copy: false)
        ..add(_u32(data.length))
        ..add(bodyBytes)
        ..add(_u32(_crc32(bodyBytes))))
      .toBytes();
}

List<int>? _crcTable;
int _crc32(Uint8List bytes) {
  _crcTable ??= List<int>.generate(256, (n) {
    int c = n;
    for (int k = 0; k < 8; k++) {
      c = (c & 1) != 0 ? (0xEDB88320 ^ (c >> 1)) : (c >> 1);
    }
    return c;
  });
  int crc = 0xFFFFFFFF;
  for (final int b in bytes) {
    crc = _crcTable![(crc ^ b) & 0xFF] ^ (crc >> 8);
  }
  return (crc ^ 0xFFFFFFFF) & 0xFFFFFFFF;
}
