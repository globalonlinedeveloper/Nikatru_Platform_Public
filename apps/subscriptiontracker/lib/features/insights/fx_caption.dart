// ═══════════════════════════════════════════════════════════════════════════
// "CONVERTED AT ECB RATES OF {date}" — T12, IN-06.
//
// The line under every Insights total that folded another currency into the
// home one, and the one control that lets the user put their OWN rate on one
// pair (`FxOverrideController`). A converted figure always says what it was
// converted with and when: the ECB's own date for the fix, or "your rate".
//
// Shown only when the plans are in more than one currency: a single-currency
// user converts nothing and is owed no caption.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter/services.dart'
    show FilteringTextInputFormatter, TextInputFormatter;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' show FxTable, MoneyBag;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/home_totals.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';

/// The caption for [bag], the screen's headline total before conversion.
class FxCaption extends ConsumerWidget {
  const FxCaption({super.key, required this.bag});

  /// The UNCONVERTED total (grouped by currency) the screen's figures fold.
  final MoneyBag bag;

  static const Key caption = Key('insights.fx.caption');
  static const Key setRate = Key('insights.fx.setRate');
  static const Key useEcb = Key('insights.fx.useEcb');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final HomeTotals totals = homeTotalsOf(ref);
    final Map<String, num> override = ref.watch(fxOverrideProvider);
    final List<String> foreign = <String>[
      for (final String c in bag.byCurrency.keys)
        if (c != totals.home) c,
    ];
    if (foreign.isEmpty) return const SizedBox.shrink();

    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final TextStyle? style = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final FxTable? fx = totals.fx;
    final String line = !totals.converts(bag)
        ? l10n.fxNotConverted
        : (fx!.source.isEmpty
              ? l10n.fxConvertedAtYourRate
              : l10n.fxConvertedAt(
                  DateFormat.yMMMd(l10n.localeName).format(fx.asOf),
                ));
    final MapEntry<String, num>? mine = override.entries.isEmpty
        ? null
        : override.entries.first;

    return Column(
      key: caption,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(line, style: style),
        if (mine != null)
          Text(
            l10n.fxYourRate(
              mine.key.substring(0, 3),
              NumberFormat.decimalPattern(l10n.localeName).format(mine.value),
              mine.key.substring(4),
            ),
            style: style,
          ),
        Wrap(
          spacing: AppSpacing.sm,
          children: <Widget>[
            TextButton(
              key: setRate,
              onPressed: () => _editRate(context, ref, foreign.first, totals),
              child: Text(l10n.fxSetRate),
            ),
            if (mine != null)
              TextButton(
                key: useEcb,
                onPressed: () => ref.read(fxOverrideProvider.notifier).clear(),
                child: Text(l10n.fxUseEcbRate),
              ),
          ],
        ),
      ],
    );
  }

  Future<void> _editRate(
    BuildContext context,
    WidgetRef ref,
    String from,
    HomeTotals totals,
  ) async {
    final num? rate = await showDialog<num>(
      context: context,
      builder: (BuildContext c) => _RateDialog(from: from, to: totals.home),
    );
    if (rate != null) {
      await ref.read(fxOverrideProvider.notifier).set(from, totals.home, rate);
    }
  }
}

/// One field: how many [to] one [from] buys.
class _RateDialog extends StatefulWidget {
  const _RateDialog({required this.from, required this.to});

  final String from;
  final String to;

  @override
  State<_RateDialog> createState() => _RateDialogState();
}

class _RateDialogState extends State<_RateDialog> {
  final TextEditingController _c = TextEditingController();
  bool _invalid = false;

  static const Key field = Key('insights.fx.rateField');

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _save() {
    final num? v = num.tryParse(_c.text.trim().replaceAll(',', '.'));
    if (v == null || !v.isFinite || v <= 0) {
      setState(() => _invalid = true);
      return;
    }
    Navigator.pop(context, v);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.fxRateDialogTitle),
      content: TextField(
        key: field,
        controller: _c,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: <TextInputFormatter>[
          FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
        ],
        decoration: InputDecoration(
          labelText: l10n.fxRateField(widget.to, widget.from),
          errorText: _invalid ? l10n.fxRateInvalid : null,
        ),
        onSubmitted: (_) => _save(),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: const Key('insights.fx.save'),
          onPressed: _save,
          child: Text(l10n.save),
        ),
      ],
    );
  }
}
