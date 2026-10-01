// ═══════════════════════════════════════════════════════════════════════════
// THE BUDGET EDITOR — train ST-D3, label D3-2 (canvas v2 `BudgetEditor`).
//
// 🔴 UNTIL THIS FILE A BUDGET COULD NOT BE SET ANYWHERE. `ApiClient.updateBudget`
// and `SubscriptionRepository.saveBudget` were written, tested and routed, and
// nothing called them: the old Budget tab was read-only ("Budget & goals" with
// no control), so the budget every user saw was whatever the seed or the server
// already held. `saveBudget` has its first caller in `_save` below.
//
// A sheet on a phone and a 600-wide dialog from 600 dp up, through the
// design system's `showAdaptiveSheet` — Esc and back close it, focus returns to
// the Edit button that opened it.
//
// ⚠️ THE CANVAS'S "Warn me at 90%" SWITCH IS NOT DRAWN. There is no field for
// it in the budget record or the API, and a switch that stores nothing is the
// dead-control defect this app has already paid to remove twice. It arrives
// with the field.
// ═══════════════════════════════════════════════════════════════════════════

import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/category_label.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/budget_info.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart';

/// The stored budget, read through the repository. Invalidated by a save, so
/// the card on Insights re-reads what was written rather than what was typed.
final FutureProvider<BudgetInfo> budgetProvider = FutureProvider<BudgetInfo>(
  (ref) => ref.watch(subscriptionRepositoryProvider).budget(),
);

/// Opens the editor for [budget] — already in the display currency — with the
/// monthly [spent] average and the [categories] it offers caps for.
Future<void> showBudgetEditorSheet(
  BuildContext context, {
  required BudgetInfo budget,
  required MoneyBag spent,
  required List<CategoryTotal> categories,
}) => showAdaptiveSheet<void>(
  context: context,
  builder: (_) =>
      BudgetEditor(budget: budget, spent: spent, categories: categories),
);

/// The editor's body. Public so a test can pump it without a route.
class BudgetEditor extends ConsumerStatefulWidget {
  const BudgetEditor({
    super.key,
    required this.budget,
    required this.spent,
    required this.categories,
  });

  final BudgetInfo budget;
  final MoneyBag spent;
  final List<CategoryTotal> categories;

  static const Key amountField = Key('budget.editor.amount');
  static const Key saveButton = Key('budget.editor.save');
  static Key capField(String category) => Key('budget.editor.cap.$category');

  /// The "Pro" chip over the category caps — a button to the paywall where
  /// this build sells, a plain label where it does not.
  static const Key proChip = Key('budget.editor.proChip');

  @override
  ConsumerState<BudgetEditor> createState() => _BudgetEditorState();
}

class _BudgetEditorState extends ConsumerState<BudgetEditor> {
  /// Closes the sheet and opens the paywall. The router is read BEFORE the pop,
  /// while this context is still mounted; a test that pumps the editor without
  /// a router gets the pop alone.
  void _openPaywall() {
    final GoRouter? router = GoRouter.maybeOf(context);
    Navigator.of(context).maybePop();
    router?.go('/paywall');
  }

  late final TextEditingController _amount;
  late final Map<String, TextEditingController> _caps;
  bool _saving = false;
  bool _failed = false;
  bool _showErrors = false;

  String get _code => widget.budget.currencyCode;

  /// What the field starts with: the stored amount as a bare number the user
  /// can edit — no symbol (the field's prefix carries it) and no grouping, and
  /// whole units when there is no fraction ("5500", not "5500.00").
  static String _plain(Money m) {
    if (m.minorUnits <= 0) return '';
    return m.minorUnits % Money.pow10(m.minorUnitDigits) == 0
        ? '${m.wholeUnits}'
        : m.toMajorUnits().toStringAsFixed(m.minorUnitDigits);
  }

  @override
  void initState() {
    super.initState();
    _amount = TextEditingController(text: _plain(widget.budget.monthlyBudget));
    final Map<String, Money> stored = <String, Money>{
      for (final BudgetCap c in widget.budget.categories) c.name: c.cap,
    };
    _caps = <String, TextEditingController>{
      for (final CategoryTotal c in widget.categories)
        c.name: TextEditingController(
          text: stored[c.name] == null ? '' : _plain(stored[c.name]!),
        ),
    };
  }

  @override
  void dispose() {
    _amount.dispose();
    for (final TextEditingController c in _caps.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Empty is a real answer — "no budget", "no cap" — and parses to zero.
  /// Anything else must be money in the budget's currency, or null.
  Money? _parse(String text) => text.trim().isEmpty
      ? Money.zero(_code)
      : Money.parseLocalized(text, _code);

  Future<void> _save() async {
    final Money? amount = _parse(_amount.text);
    final Map<String, Money?> caps = <String, Money?>{
      for (final MapEntry<String, TextEditingController> e in _caps.entries)
        e.key: _parse(e.value.text),
    };
    if (amount == null || caps.values.any((Money? m) => m == null)) {
      setState(() => _showErrors = true);
      return;
    }
    // Caps for categories the user no longer holds are KEPT: deleting the
    // last plan in a category must not silently delete the cap they set on it.
    final Set<String> shown = caps.keys.toSet();
    final List<BudgetCap> kept = <BudgetCap>[
      for (final BudgetCap c in widget.budget.categories)
        if (!shown.contains(c.name)) c,
    ];
    final BudgetInfo next = BudgetInfo(
      monthlyBudget: amount,
      categories: <BudgetCap>[
        ...kept,
        for (final MapEntry<String, Money?> e in caps.entries)
          if (e.value!.minorUnits > 0) BudgetCap(e.key, e.value!),
      ],
    );
    setState(() {
      _saving = true;
      _failed = false;
    });
    try {
      await ref.read(subscriptionRepositoryProvider).saveBudget(next);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _failed = true;
      });
      return;
    }
    if (!mounted) return;
    ref.invalidate(budgetProvider);
    // ST-I2 (audit C14): a new budget can put the SAME subscriptions over it,
    // so the reminders are re-synced, which re-reads the budget and arms or
    // cancels the over-budget alert. Only when the list is already alive:
    // reading `.notifier` otherwise would start a fetch for a save.
    if (ref.exists(subscriptionsControllerProvider)) {
      unawaited(
        ref.read(subscriptionsControllerProvider.notifier).resyncReminders(),
      );
    }
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final MoneyFormatter money = MoneyFormatter(
      l10n.localeName,
      emptyCurrencyCode: _code,
    );
    final bool capsLocked = ref.watch(paywallLockedProvider);
    final String prefix = Money.symbolFor(_code) ?? _code;
    final bool amountBad = _showErrors && _parse(_amount.text) == null;

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.md,
          AppSpacing.lg,
          AppSpacing.lg,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Semantics(
                    header: true,
                    child: Text(
                      l10n.budgetCardTitle,
                      style: text.titleLarge?.copyWith(color: scheme.onSurface),
                    ),
                  ),
                ),
                // The NAME is the icon's semantic label, so the button node
                // itself says "Close"; the tooltip is for the pointer and is
                // kept out of the tree so the word is not read twice.
                Tooltip(
                  message: l10n.close,
                  excludeFromSemantics: true,
                  child: IconButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: Icon(Icons.close, semanticLabel: l10n.close),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            TextField(
              key: BudgetEditor.amountField,
              controller: _amount,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,\s]')),
              ],
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _saving ? null : _save(),
              onChanged: (_) {
                if (_showErrors) setState(() {});
              },
              decoration: InputDecoration(
                labelText: l10n.budgetAmountLabel,
                prefixText: '$prefix ',
                helperText: l10n.budgetAverageHint(
                  money.formatBagRounded(widget.spent),
                ),
                helperMaxLines: 2,
                errorText: amountBad ? l10n.budgetAmountInvalid : null,
                border: const OutlineInputBorder(),
              ),
            ),
            if (widget.categories.isNotEmpty) ...<Widget>[
              const SizedBox(height: AppSpacing.xl),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      l10n.budgetCapsTitle,
                      style: text.labelLarge?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  // ⏱ 2026-10-01 · MO-07: the chip is the way to what it
                  // marks. Where this build sells it closes the sheet and
                  // opens the paywall with `router.go`, which REPLACES the
                  // location (as every other paywall entry does), so the
                  // paywall's own back control is the way out, not a pop to
                  // Insights; where it cannot sell, it stays a label rather
                  // than a dead button.
                  if (capsLocked)
                    ProChip(
                      key: BudgetEditor.proChip,
                      label: l10n.proBadge,
                      onPressed: ref.watch(sellingEnabledProvider)
                          ? _openPaywall
                          : null,
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              for (final CategoryTotal c in widget.categories)
                _capRow(context, l10n, money, c, locked: capsLocked),
            ],
            if (_failed) ...<Widget>[
              const SizedBox(height: AppSpacing.md),
              Semantics(
                liveRegion: true,
                child: Text(
                  l10n.budgetSaveFailed,
                  style: text.bodyMedium?.copyWith(
                    color: StatusTones.of(context).danger,
                  ),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
            FilledButton(
              key: BudgetEditor.saveButton,
              onPressed: _saving ? null : _save,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(AppSpacing.xxxl),
              ),
              child: Text(l10n.budgetSave),
            ),
          ],
        ),
      ),
    );
  }

  Widget _capRow(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    CategoryTotal c, {
    required bool locked,
  }) {
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final TextEditingController controller = _caps[c.name]!;
    final bool bad = _showErrors && _parse(controller.text) == null;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    categoryLabel(l10n, c.name),
                    style: text.titleMedium?.copyWith(color: scheme.onSurface),
                  ),
                  Text(
                    l10n.budgetCapUsed(money.formatBagRounded(c.value)),
                    style: text.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          SizedBox(
            width: AppBreakpoints.form / 3,
            child: Semantics(
              label: l10n.budgetCapLabel(categoryLabel(l10n, c.name)),
              child: TextField(
                key: BudgetEditor.capField(c.name),
                controller: controller,
                enabled: !locked && !_saving,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,\s]')),
                ],
                textInputAction: TextInputAction.next,
                onChanged: (_) {
                  if (_showErrors) setState(() {});
                },
                decoration: InputDecoration(
                  hintText: l10n.budgetNoCap,
                  errorText: bad ? l10n.budgetAmountInvalid : null,
                  errorMaxLines: 2,
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The small "Pro" marker on a part of a screen that a plan unlocks: the
/// scheme's secondary container pair, the ramp's 12 px label.
class ProChip extends StatelessWidget {
  const ProChip({super.key, required this.label, this.onPressed});

  final String label;

  /// Opens what the chip marks a way to — the paywall. Null draws a label, not
  /// a button: a control that does nothing is worse than no control.
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final Widget chip = _chip(context);
    final VoidCallback? tap = onPressed;
    if (tap == null) return chip;
    return Semantics(
      button: true,
      child: InkWell(
        onTap: tap,
        customBorder: const StadiumBorder(),
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minWidth: kMinInteractiveDimension,
            minHeight: kMinInteractiveDimension,
          ),
          child: Center(widthFactor: 1, child: chip),
        ),
      ),
    );
  }

  Widget _chip(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.secondaryContainer,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.xs,
        ),
        child: Text(
          label,
          style: theme.textTheme.labelMedium?.copyWith(
            color: scheme.onSecondaryContainer,
          ),
        ),
      ),
    );
  }
}
