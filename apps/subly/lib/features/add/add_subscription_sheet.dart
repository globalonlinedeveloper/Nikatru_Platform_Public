import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/budget_info.dart';
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

/// The bucket a subscription lands in when the user does not classify it.
///
/// The SAME literal `Subscription.fromJson` already falls back to, deliberately:
/// a row that arrives from the API with no category and a row added here with no
/// choice must land in ONE bucket, not in two that read alike on screen and
/// group separately in `SubMath.categoryTotals`.
const String _uncategorised = 'Other';

/// The category vocabulary this sheet offers.
///
/// 🔴 DERIVED, NOT DECLARED, AND THAT IS THE WHOLE POINT. The app already had a
/// vocabulary before this field existed — the budget caps `seed_api_client`
/// serves out of `DemoData.budget()` — and two surfaces are keyed on it BY
/// STRING: `budget_screen.dart` matches a cap to a category by name, and
/// `SubMath.categoryTotals` groups the insights donut by the string on the row.
/// A third, the detail header, prints it verbatim beside the plan
/// (`subscription_detail_screen.dart:188`), so a typo is user-visible too.
///
/// A hand-written list here would therefore be a SECOND vocabulary, and any
/// entry differing by one character would produce a subscription with no budget
/// bar and its own one-item donut slice. Deriving it means a category a user can
/// pick is one the rest of the app already knows.
///
/// ⚠️ PROVISIONAL only in where it comes FROM: the caps are seed data today, so
/// the day the vocabulary is served by the API this list follows it there rather
/// than being re-typed. [_uncategorised] is appended instead of being seeded
/// into the caps — it is the model's fallback, not a budgeted category, and
/// giving it a cap would invent a budget line the owner never set.
final List<String> _categories = <String>[
  ...DemoData.budget().categories.map((BudgetCap c) => c.name),
  _uncategorised,
];

// ⚠️ THE ONLY TWO STRINGS ON THIS SHEET THAT DO NOT COME FROM THE ARB, AND THEY
// ARE A DEBT RATHER THAN A DECISION. Every other label here is an `l10n.*` key
// (`fieldLabelName`, `fieldLabelPrice`, `fieldLabelCycle`); these two have none
// because `lib/l10n/app_en.arb` and `app_ta.arb` sit outside this change's file
// ownership and minting a key requires editing both plus the generated set.
// So they render ENGLISH IN THE TAMIL BUILD until `fieldLabelRenews` and
// `fieldLabelCategory` are added with exactly the values below and these two
// constants are deleted. Do NOT translate them here: a second translation seam
// beside the arb is worse than one visible, named gap.
//
// The category VALUES are a different case and are correctly untranslated —
// they are data, not copy, and every other screen paints them raw for that
// reason (`scan_screen.dart:529` records it).
const String _fieldLabelRenewsPendingArb = 'RENEWS';
const String _fieldLabelCategoryPendingArb = 'CATEGORY';

/// Opens the add sheet.
///
/// ⚠️ NO WIDTH CAP IS APPLIED HERE, AND THAT IS CHECKED RATHER THAN ASSUMED.
/// This is one of only two Subly surfaces that does not sit inside a
/// `ContentPane`, so the obvious worry is that it stretches on desktop — it does
/// not. M3's `_BottomSheetDefaultsM3` supplies `BoxConstraints(maxWidth: 640)`
/// and no `bottomSheetTheme` override exists anywhere in the design system, so
/// the host already caps it: `width_add_sheet_test.dart` measures 640 at both
/// 768 and 1280 (and the surface centred, dx 64 and 320). Adding a
/// `ConstrainedBox` of our own would be a second cap that silently disagrees
/// with the framework's the day either number moves.
Future<void> showAddSubscriptionSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    // Load-bearing for short viewports, not just for the keyboard inset: it
    // removes `showModalBottomSheet`'s default 9/16-of-window height cap, which
    // is the cap the cancel sheet was clipping against until 2026-08-21. Together
    // with the `SingleChildScrollView` in `_AddSheetState.build` it is why this
    // sheet measured clean where that one did not — the measurement, and the
    // rule against "fixing" it by copying the cancel sheet's shape, are recorded
    // at the action row in `build`.
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

  /// The date the Calendar and the "Due in 7 days" figure are computed from.
  ///
  /// 🔴 IT USED TO BE INVENTED, AND NOTHING ON SCREEN SAID SO. `_save` passed
  /// `DateTime.now().add(const Duration(days: 12))` and the user was never
  /// asked — so every subscription added through this sheet landed on the
  /// calendar exactly twelve days out, and home's due-soon count was a
  /// statement about that constant rather than about the user's money.
  DateTime _renewal = _oneCycleFrom(DateTime.now(), BillingCycle.monthly);

  /// Whether [_renewal] is the user's choice rather than the derived default.
  ///
  /// The default is "one cycle from today", so it has to MOVE when the cycle
  /// toggle moves — a yearly plan defaulting to next month is the same invented
  /// date wearing a new hat. But once the user has picked a date, flipping the
  /// cycle must not overwrite it, and this flag is the entire difference
  /// between those two behaviours.
  bool _renewalChosen = false;

  /// Also hardcoded before — to `'Other'`, with no field to change it. Every row
  /// added through this sheet therefore fell into one bucket, so the insights
  /// donut, the budget bars and the detail header all described it wrongly.
  String _category = _uncategorised;

  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    super.dispose();
  }

  /// Midnight local. The sheet stores and compares whole days, and
  /// `Subscription.daysUntil` truncates both of its operands to a day anyway —
  /// carrying a time-of-day would only make two equal dates compare unequal.
  static DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  /// One billing cycle after [from], clamped to a day that exists.
  ///
  /// ⚠️ `DateTime(2026, 2, 31)` DOES NOT THROW — it rolls forward to 3 March.
  /// So a monthly plan added on the 31st would have defaulted to the 3rd of the
  /// month AFTER next, which is not a plausible renewal date for anything.
  /// Clamping to the last day of the target month is what a billing date
  /// actually does, and it costs one line: day 0 of month n+1 IS the last day
  /// of month n. The same rule covers 29 February on a yearly cycle.
  static DateTime _oneCycleFrom(DateTime from, BillingCycle cycle) {
    final DateTime day = _dateOnly(from);
    final bool yearly = cycle == BillingCycle.yearly;
    final int year = yearly ? day.year + 1 : day.year;
    final int month = yearly ? day.month : day.month + 1;
    final int lastDayOfMonth = DateTime(year, month + 1, 0).day;
    return DateTime(
      year,
      month,
      day.day <= lastDayOfMonth ? day.day : lastDayOfMonth,
    );
  }

  Future<void> _pickRenewal() async {
    final DateTime today = _dateOnly(DateTime.now());
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _renewal,
      // A renewal is in the future by definition, and every surface fed by this
      // date only draws forward — a past date adds a row nothing ever shows.
      firstDate: today,
      lastDate: DateTime(today.year + 10, today.month, today.day),
    );
    // The picker is a route, so this is an async gap and `setState` after it is
    // a live-element assumption — the same rule `_save` states below.
    if (!mounted || picked == null) return;
    setState(() {
      _renewal = _dateOnly(picked);
      _renewalChosen = true;
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final Subscription draft = Subscription(
      id: '',
      name: _name.text.trim(),
      category: _category,
      price: double.tryParse(_price.text.trim()) ?? 9.99,
      cycle: _cycle,
      nextRenewal: _renewal,
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
              // ⚠️ FULL-WIDTH ROWS, NOT A PAIR LIKE PRICE/CYCLE ABOVE, and the
              // reason is text scaling rather than taste. Half of the phone
              // content box is 164 px; a formatted date ("Sep 22, 2026") plus
              // its icon already fills most of that at 1.0, and the longest
              // category ("Productivity") fills the rest — at a 1.5 text scale
              // both would ellipsize down to something a user cannot read the
              // date off. The sheet already scrolls, so height is the cheap
              // axis here and width is not.
              const SizedBox(height: 12),
              Text(
                _fieldLabelRenewsPendingArb,
                style: AppText.label.copyWith(color: p.muted),
              ),
              const SizedBox(height: 6),
              _renewalField(l10n),
              const SizedBox(height: 12),
              Text(
                _fieldLabelCategoryPendingArb,
                style: AppText.label.copyWith(color: p.muted),
              ),
              const SizedBox(height: 6),
              _categoryField(),
              const SizedBox(height: 20),
              // ✅ MEASURED CLEAN 2026-08-21 — THE CANCEL SHEET'S CLIPPED-BUTTON
              // DEFECT DOES NOT EXIST HERE. `cancel_sheet.dart` was repaired the
              // same day and its note calls this file "the sibling modal built
              // the same way, already carrying a fixed-height submit button".
              // It is NOT built the same way, and the lead was measured rather
              // than inherited. Six windows, `takeException()` null in every one
              // and no line of the row squeezed:
              //   740×360 @1.3 — sheet 309.6 tall, content 807.4, scrolls 533.8
              //   740×360 @2.0 — sheet 309.6 tall, scrolls 766.6
              //   375×812 @1.0 — sheet 698.3 tall, scrolls 97.9
              //   375×812 @1.3 · @2.0 and 320×568 @1.3 · @2.0 — same, all clean
              // The row is 52 px tall at EVERY scale (both buttons carry their
              // own `SizedBox` height, 50 and 52) and after `ensureVisible` it
              // lands at y 284–336 inside the 360-tall window — wholly on
              // screen. Horizontally it never overflowed either: at 320 @2.0,
              // the narrowest case, 'Cancel' takes 192.6 px and the `Expanded`
              // submit the remaining 81.4.
              //
              // THE TWO THINGS THE CANCEL SHEET LACKED, THIS SHEET HAS HAD ALL
              // ALONG, which is the whole reason the numbers differ:
              // `showAddSubscriptionSheet` already passes
              // `isScrollControlled: true`, so there is no 9/16-of-window cap to
              // run out of; and the WHOLE column — this row included — sits
              // inside the `SingleChildScrollView` in `build`. Height that runs
              // out therefore becomes scroll, not clip.
              //
              // ⚠️ SO DO NOT HOIST THIS ROW OUT OF THE SCROLL VIEW to match the
              // cancel sheet's shape. That sheet keeps its buttons outside for a
              // reason that does not apply here — `MinimumTapTargetGuideline`
              // skips targets under an implicitly-scrolling ancestor — and
              // `a11y_semantics_test.dart`'s 48×48 sweep of this sheet records
              // 6 subjects as it stands, so nothing is going uninspected.
              //
              // ⚠️ AND PINNING `setSurfaceSize` ALONE WOULD HAVE MEASURED
              // NOTHING: it moves layout constraints but not `MediaQuery`, and
              // the cap above is `MediaQuery…size.height * 0.86` — the first run
              // of this measurement read a 516 px sheet at every window because
              // the view stayed 800×600. The numbers above come from
              // `tester.view.physicalSize`. Same trap `width_add_sheet_test.dart`
              // records in its header.
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
            // The derived renewal default is "one cycle from today", so it has
            // to follow the cycle — otherwise picking Yearly leaves next
            // month's date sitting under it, which is the invented-date defect
            // with a user gesture in front of it. `_renewalChosen` is what stops
            // this from stamping over a date the user picked on purpose.
            onTap: () => setState(() {
              _cycle = cycle;
              if (!_renewalChosen) {
                _renewal = _oneCycleFrom(DateTime.now(), cycle);
              }
            }),
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

  /// The renewal date, as a field the user can open a calendar from.
  ///
  /// It is an [InputDecorator] wearing [_fieldDecoration] rather than a
  /// hand-rolled `Container` so that it IS the text fields' skin instead of
  /// merely resembling it — the two cannot drift when one of them is edited.
  Widget _renewalField(AppLocalizations l10n) {
    final _SheetPalette p = _SheetPalette.of(context);
    // `l10n.localeName`, never the ambient default: `DateFormat` with no locale
    // reads `Intl.defaultLocale`, a process-wide global that nothing on this
    // sheet sets. `cancel_sheet.dart:189-193` carries the same two lines for
    // the same reason, and `intl` already ships the month names and the field
    // ORDER for both locales — "Sep 22, 2026" in en, the reordered form in ta.
    final String formatted = DateFormat.yMMMd(l10n.localeName).format(_renewal);
    return MergeSemantics(
      child: Semantics(
        button: true,
        child: GestureDetector(
          // Opaque, or the ~16 px of padding between the border and the date is
          // dead to touch and the field reads as intermittently broken. The
          // POPULAR tiles avoid this by having a full-bleed child; this one has
          // a decoration, so it has to say it.
          behavior: HitTestBehavior.opaque,
          onTap: _pickRenewal,
          child: InputDecorator(
            decoration: _fieldDecoration(p),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    formatted,
                    // Same `copyWith` as [_input], and for the same reason: the
                    // const `AppText.body` bakes in `AppColors.ink`.
                    style: AppText.body.copyWith(
                      fontWeight: FontWeight.w600,
                      color: p.ink,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                // No `semanticLabel`, so it contributes no node at all: the
                // date beside it is the entire content, and the control is
                // already announced as a button by the wrapper above.
                Icon(Icons.calendar_today_outlined, size: 16, color: p.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// The category, chosen from [_categories].
  ///
  /// A dropdown rather than a row of chips: eleven chips would add eleven tap
  /// targets and roughly 120 px to a sheet already capped at 86% of the window
  /// height, and the vocabulary is closed, so the compact control is the honest
  /// one. `DropdownButtonFormField` wears the same [_fieldDecoration] as the
  /// text fields, and supplies `isDense` and the `InputDecoration` plumbing
  /// itself — a bare `DropdownButton` inside an `InputDecorator` renders 78 px
  /// tall against the fields' 50.
  Widget _categoryField() {
    final _SheetPalette p = _SheetPalette.of(context);
    final TextStyle style = AppText.body.copyWith(
      fontWeight: FontWeight.w600,
      color: p.ink,
    );
    return DropdownButtonFormField<String>(
      initialValue: _category,
      decoration: _fieldDecoration(p),
      style: style,
      // 🔴 THE MENU IS AN OVERLAY WITH ITS OWN GROUND, AND LEFT ALONE IT PAINTS
      // `ThemeData.canvasColor` — which is the LIGHT surface even under the dark
      // scheme. That is the unreadable-sheet defect this file's palette exists
      // to fix, one layer up: `style` above is `p.ink`, so on the default canvas
      // the dark build would show near-black items on near-white while the sheet
      // behind them is dark. `p.raised` is the slot the fields already rest on,
      // so the menu reads as the field opening rather than as a stray card.
      dropdownColor: p.raised,
      borderRadius: BorderRadius.circular(16),
      icon: Icon(Icons.expand_more, color: p.muted),
      // Without this the button shrink-wraps the widest item and the chevron
      // sits mid-field instead of at the trailing edge, which is the one visual
      // tell that would give it away as not-a-field.
      isExpanded: true,
      items: _categories
          .map(
            (String c) => DropdownMenuItem<String>(
              value: c,
              child: Text(
                c,
                style: style,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          )
          .toList(),
      onChanged: (String? v) => setState(() => _category = v ?? _uncategorised),
    );
  }

  /// The one field skin on this sheet — the two text inputs, the renewal button
  /// and the category dropdown all wear it, so the four cannot drift apart.
  ///
  /// 🔴 RADIUS 16 IS LOAD-BEARING BEYOND TASTE. `dark_group_sheets_test.dart`
  /// finds the Monthly/Yearly pair by "the only two radius-14 decorations in the
  /// sheet" — every other corner here is 4 (handle), 13 (glyph tiles), 16
  /// (fields, submit) or 28 (the sheet). A new field that borrowed 14 would
  /// break a test about a different widget, in a way that reads as unrelated.
  InputDecoration _fieldDecoration(_SheetPalette p, {String? hint}) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: p.raised,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: p.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: p.accent, width: 1.5),
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
      decoration: _fieldDecoration(p, hint: hint),
    );
  }
}
