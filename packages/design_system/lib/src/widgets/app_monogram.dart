import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';
import 'app_list_row.dart';

/// The chassis MONOGRAM — the square mark in front of a record: two letters
/// for a named thing, or an icon for a kind of notice (train ST-D5).
///
/// ## Its rules
///  * **Decorative, always.** A monogram abbreviates the name printed beside
///    it and an icon repeats what the sentence beside it says, so announcing
///    either would make every row open with a token the reader has already
///    been given. The whole mark is excluded from semantics; the row or header
///    that holds it carries the name.
///  * **Opaque token fills, no alpha wash.** A lettered mark is
///    `primaryContainer` / `onPrimaryContainer` — the scheme's own measured
///    pair, derived from the app's seed. An icon mark with a [status] takes
///    that status's opaque tint and tone from [StatusTones], so its glyph's
///    contrast is the one number `test/status_contrast_test.dart` measures.
///  * **Two sizes, both named.** [AppListRow.leadingSize] (40) in a row, and
///    [large] (48) in a page header — never a number the caller picks.
class AppMonogram extends StatelessWidget {
  /// A lettered mark, e.g. "NF" for Netflix.
  const AppMonogram({super.key, required String this.text, this.size = small})
    : icon = null,
      status = null;

  /// An icon mark, optionally in a status's tint.
  const AppMonogram.icon(
    IconData this.icon, {
    super.key,
    this.status,
    this.size = small,
  }) : text = null;

  /// The letters, for a lettered mark.
  final String? text;

  /// The glyph, for an icon mark.
  final IconData? icon;

  /// Paints an icon mark in this status's tint and tone.
  final StatusKind? status;

  /// The mark's side.
  final double size;

  /// The row size: the same 40 px slot [AppListRow] gives its leading widget.
  static const double small = AppListRow.leadingSize;

  /// The header size.
  static const double large = AppSpacing.xxxl;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final StatusKind? kind = status;
    final StatusTones tones = StatusTones.of(context);
    final Color fill = kind == null
        ? scheme.primaryContainer
        : tones.tintOf(kind);
    final Color ink = kind == null
        ? scheme.onPrimaryContainer
        : tones.toneOf(kind);
    final String? letters = text;
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: fill,
          borderRadius: BorderRadius.circular(AppRadius.control),
        ),
        child: letters != null
            ? Text(
                letters,
                maxLines: 1,
                style:
                    (size >= large
                            ? theme.textTheme.titleMedium
                            : theme.textTheme.labelLarge)
                        ?.copyWith(color: ink, fontWeight: FontWeight.w700),
              )
            : Icon(icon, color: ink),
      ),
    );
  }
}
