import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../data/seed/demo_data.dart';
import '../../l10n/app_localizations.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/widgets.dart';

/// The add sheet's own palette, resolved once per build.
///
/// 🔴 EVERY LIGHT VALUE IS THE LITERAL TOKEN THIS SHEET ALREADY PAINTED, so the
/// light sheet the owner eyeballs does not move a pixel. That is asserted
/// against the literals in `test/dark_group_sheets_test.dart` rather than
/// against the scheme, deliberately: an assertion written as
/// `p.sheet == scheme.surfaceContainerLow` would let the natural regression —
/// "tidying" the light branch to a scheme slot — pass, because both sides of
/// the comparison would move together.
///
/// 🔴 DARK IS NOT A TINT PASS, IT IS THE FIX FOR AN UNREADABLE SHEET. Changing
/// only the container fill would have been worse than doing nothing: every
/// string on here is drawn with an [AppText] style, and those styles carry a
/// HARDCODED `AppColors.ink` / `AppColors.muted`. A dark fill under
/// near-black text is invisible text, so the ink slots move with the fill or
/// neither may move. `cancel_sheet.dart` carries the same class with the fields
/// it needs; the two are siblings and must stay in step.
///
/// Slot choices, all from the scheme so the seed keeps driving what is painted:
///   · [sheet] `surfaceContainerLow` — M3's own bottom-sheet container slot, and
///     in a dark scheme it sits ABOVE `scheme.surface` (what `buildAppTheme`
///     paints the scaffold with), so the sheet lifts off the page it covers.
///   · [raised] `surfaceContainerHighest` — the same slot `cardDecoration` and
///     `RowCard` use, so a control resting on the sheet reads like a card
///     resting on a page.
///   · [accent] `scheme.primary`, NOT `AppColors.accent`. #6459F5 on a dark
///     surface measures ~3:1, which fails AA for the 13 px bold glyph text it
///     is used for; a dark scheme's `primary` is the light tonal step, derived
///     from the same seed and meant to be read on dark.
class _SheetPalette {
  const _SheetPalette({
    required this.sheet,
    required this.ink,
    required this.muted,
    required this.line,
    required this.raised,
    required this.accent,
  });

  factory _SheetPalette.of(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    if (theme.brightness == Brightness.light) {
      return const _SheetPalette(
        sheet: AppColors.bg,
        ink: AppColors.ink,
        muted: AppColors.muted,
        line: AppColors.line,
        raised: AppColors.surface,
        accent: AppColors.accent,
      );
    }
    final ColorScheme scheme = theme.colorScheme;
    return _SheetPalette(
      sheet: scheme.surfaceContainerLow,
      ink: scheme.onSurface,
      muted: scheme.onSurfaceVariant,
      line: scheme.outlineVariant,
      raised: scheme.surfaceContainerHighest,
      accent: scheme.primary,
    );
  }

  /// The sheet's own surface — the thing the drag handle sits on.
  final Color sheet;

  /// Primary text.
  final Color ink;

  /// Secondary text: the field labels, the POPULAR heading, the tile captions.
  final Color muted;

  /// Hairlines: the drag handle, field borders, the unselected cycle button.
  final Color line;

  /// A control resting ON the sheet — the text fields and the unselected cycle
  /// button.
  final Color raised;

  /// Brand ink for the POPULAR glyphs and the focused field border.
  final Color accent;
}

Future<void> showAddSubscriptionSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    // The only caller is AppShell's FAB, whose context sits ABOVE the branch
    // navigators — so this sheet already mounted on the root navigator, by
    // accident of who happened to call it. Stating it makes the root-level
    // mount a property of the sheet rather than of its caller.
    useRootNavigator: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _AddSheet(),
  );
}

class _AddSheet extends ConsumerStatefulWidget {
  const _AddSheet();

  @override
  ConsumerState<_AddSheet> createState() => _AddSheetState();
}

class _AddSheetState extends ConsumerState<_AddSheet> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _price = TextEditingController();
  BillingCycle _cycle = BillingCycle.monthly;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final Subscription draft = Subscription(
      id: '',
      name: _name.text.trim(),
      category: 'Other',
      price: double.tryParse(_price.text.trim()) ?? 9.99,
      cycle: _cycle,
      nextRenewal: DateTime.now().add(const Duration(days: 12)),
    );
    // Resolved BEFORE the await. Reaching through `context` after an async gap
    // is only safe while the element is still mounted, and the failure branch
    // below is precisely the case where that is in doubt.
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    // Same rule, same reason, and it is easy to miss that it applies:
    // `AppLocalizations.of` is an `InheritedWidget` lookup, so reading the
    // failure copy is a `context` read and belongs on THIS side of the await
    // exactly as the messenger does.
    final AppLocalizations l10n = AppLocalizations.of(context);
    try {
      await ref
          .read(subscriptionsControllerProvider.notifier)
          .addSubscription(draft);
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      // 🔴 THIS FAILURE PATH DID NOT EXIST. `addSubscription` goes through the
      // repository to the network, so one offline moment threw out of an
      // unawaited future: nothing caught it, `_saving` was never cleared, and
      // the button sat disabled on 'Adding…' forever with no message. The only
      // way out was to swipe the sheet away and retype everything.
      //
      // Same surface the sign-in screen uses (ScaffoldMessenger + SnackBar), and
      // the sheet deliberately STAYS UP so the typed draft survives — a retry
      // costs one tap, not a re-entry.
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.addSubscriptionFailed)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final _SheetPalette p = _SheetPalette.of(context);
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.86,
        ),
        decoration: BoxDecoration(
          color: p.sheet,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        ),
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: p.line,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                l10n.addSubscriptionTitle,
                style: AppText.title.copyWith(fontSize: 22, color: p.ink),
              ),
              const SizedBox(height: 14),
              Text(
                l10n.addPopularHeading,
                style: AppText.label.copyWith(color: p.muted),
              ),
              const SizedBox(height: 9),
              // 🔴 THE COLUMN COUNT IS DERIVED, NOT DECLARED. This was
              // `GridView.count(crossAxisCount: 4)` — four columns is a PHONE
              // decision, and the sheet is not phone-only: M3 caps a modal
              // sheet at 640, so from a small tablet upward the same four
              // columns split 604 px of content into 144 px tiles. These are
              // glyph chips drawn at 78 px on a phone; at 144 they render at
              // nearly double size and push the POPULAR block to ~361 px of
              // sheet height before the form starts.
              //
              // `maxCrossAxisExtent: 96` keeps the tile chip-sized at every
              // width and lets the count follow: at 375 the content is 339 →
              // ceil(339 / (96 + 9)) = 4 columns of exactly 78 px, so the
              // PHONE RENDERING IS PIXEL-IDENTICAL TO WHAT SHIPPED — that is
              // the property, and any extent in (84.75, 113] preserves it. At
              // 640 the content is 604 → 6 columns of 93.2.
              //
              // Contrast the calendar grid, where `crossAxisCount: 7` is
              // SEMANTIC (days of the week) and must stay fixed.
              // `width_add_sheet_test.dart` pins 96 and both endpoints.
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  maxCrossAxisExtent: 96,
                  mainAxisSpacing: 9,
                  crossAxisSpacing: 9,
                  childAspectRatio: 0.82,
                ),
                itemCount: DemoData.popular.length,
                itemBuilder: (BuildContext context, int i) {
                  // Renamed from `p` when the palette took that name — the two
                  // are one letter apart and both are read inside this builder.
                  final List<String> service = DemoData.popular[i];
                  // `service[1]` is the abbreviation ("NF"), `service[0]` the
                  // name ("Netflix"), and they are stacked one above the other —
                  // so unmerged this tile announced "NF" then "Netflix" as two
                  // separate stops, and neither of them as a control. Merged and
                  // with the mark excluded, it is one node: "Netflix, button".
                  // The same decorative rule [GlyphTile] records, applied to the
                  // hand-rolled twin of it that this grid draws.
                  return MergeSemantics(
                    child: Semantics(
                      button: true,
                      child: GestureDetector(
                        onTap: () => _name.text = service[0],
                        child: Column(
                          children: <Widget>[
                            Expanded(
                              child: ExcludeSemantics(
                                child: Container(
                                  width: double.infinity,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(13),
                                    gradient: const LinearGradient(
                                      colors: <Color>[
                                        Color.fromRGBO(100, 89, 245, 0.13),
                                        Color.fromRGBO(155, 107, 255, 0.13),
                                      ],
                                    ),
                                  ),
                                  child: Text(
                                    service[1],
                                    style: TextStyle(
                                      fontFamily: 'Space Grotesk',
                                      fontWeight: FontWeight.w700,
                                      fontSize: 13,
                                      color: p.accent,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              service[0],
                              style: AppText.muted.copyWith(
                                fontSize: 10,
                                color: p.muted,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
              const SizedBox(height: 16),
              Text(
                l10n.fieldLabelName,
                style: AppText.label.copyWith(color: p.muted),
              ),
              const SizedBox(height: 6),
              _input(_name, l10n.addNameHint, fieldKey: E2EKeys.addName),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          l10n.fieldLabelPrice,
                          style: AppText.label.copyWith(color: p.muted),
                        ),
                        const SizedBox(height: 6),
                        _input(
                          _price,
                          // NOT a key: an example NUMBER, and a translator has
                          // nothing to do to it. The digits localize through
                          // the keyboard and the formatter, not the arb.
                          '9.99',
                          keyboard: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          fieldKey: E2EKeys.addPrice,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          l10n.fieldLabelCycle,
                          style: AppText.label.copyWith(color: p.muted),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: <Widget>[
                            _cycleBtn(l10n.cycleMonthly, BillingCycle.monthly),
                            const SizedBox(width: 6),
                            _cycleBtn(l10n.cycleYearly, BillingCycle.yearly),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: <Widget>[
                  SoftButton(
                    label: l10n.cancel,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: GradientButton(
                      key: E2EKeys.addSubmit,
                      label: _saving
                          ? l10n.addingEllipsis
                          : l10n.addSubscriptionTitle,
                      onPressed: _saving ? null : _save,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _cycleBtn(String label, BillingCycle cycle) {
    final bool sel = _cycle == cycle;
    final _SheetPalette p = _SheetPalette.of(context);
    // Monthly / Yearly is a two-way choice whose ONLY indication of which arm is
    // active is the gradient fill — the same colour-only state the settings
    // currency chips carried, one screen over. `selected:` is the whole fix; the
    // label is the button's own `Text` and is not restated.
    return Expanded(
      child: MergeSemantics(
        child: Semantics(
          button: true,
          selected: sel,
          child: GestureDetector(
            onTap: () => setState(() => _cycle = cycle),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 15),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                // 🔴 THE SELECTED BRANCH IS BRIGHTNESS-INDEPENDENT ON PURPOSE.
                // It is the brand gradient, and white on that gradient is the
                // same decision in both themes — the gradient IS the background,
                // so it does not inherit one. Every white in this file that
                // survives dark survives for that reason and no other.
                gradient: sel ? AppColors.brandGradient : null,
                color: sel ? null : p.raised,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: sel ? Colors.transparent : p.line),
              ),
              child: Text(
                label,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: sel ? Colors.white : p.ink,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _input(
    TextEditingController c,
    String hint, {
    TextInputType keyboard = TextInputType.text,
    Key? fieldKey,
  }) {
    final _SheetPalette p = _SheetPalette.of(context);
    return TextField(
      key: fieldKey,
      controller: c,
      keyboardType: keyboard,
      // The colour is spelled out because `AppText.body` carries a hardcoded
      // `AppColors.ink`: a white-filled field with near-black text is what this
      // widget painted on a dark sheet before, and `copyWith` is the only way a
      // const style with a colour in it can be re-pointed at the scheme.
      style: AppText.body.copyWith(fontWeight: FontWeight.w600, color: p.ink),
      decoration: InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: p.raised,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 15,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: p.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: p.accent, width: 1.5),
        ),
      ),
    );
  }
}
