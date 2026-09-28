import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import 'package:nikatru_core/nikatru_core.dart' show MoneyParser;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show FocusableTap;

import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/api/api_client.dart' show ApiException;
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

// ✅ 2026-09-14 — THE TWO HARD-CODED LABELS THAT STOOD HERE ARE ARB KEYS NOW
// (O-BRICK-NO-L10N-PARITY-TEST). RENEWS and CATEGORY were `const String`s
// that rendered ENGLISH IN THE TAMIL BUILD, recorded here as a debt; they are
// `fieldLabelRenews` and `fieldLabelCategory` in both arb files, with the same
// English values, so test/l10n_parity_test.dart now covers them.
//
// The category VALUES are a different case and are correctly untranslated —
// they are data, not copy, and every other screen paints them raw for that
// reason (`scan_screen.dart:529` records it).

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
///
/// [initial] opens it as the EDIT sheet (ST-E1): prefilled from the row, and
/// saving sends one PATCH of only what changed.
Future<void> showAddSubscriptionSheet(
  BuildContext context, {
  Subscription? initial,
}) {
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
    builder: (_) => _AddSheet(initial: initial),
  );
}

/// The cadences offered as one tap; anything else is [custom].
enum _CyclePreset { weekly, monthly, quarterly, yearly, custom }

extension _CyclePresetX on _CyclePreset {
  Cadence? get cadence => switch (this) {
    _CyclePreset.weekly => Cadence.weekly,
    _CyclePreset.monthly => Cadence.monthly,
    _CyclePreset.quarterly => Cadence.quarterly,
    _CyclePreset.yearly => Cadence.yearly,
    _CyclePreset.custom => null,
  };

  static _CyclePreset of(Cadence c) => _CyclePreset.values.firstWhere(
    (_CyclePreset p) => p.cadence == c,
    orElse: () => _CyclePreset.custom,
  );
}

class _AddSheet extends ConsumerStatefulWidget {
  const _AddSheet({this.initial});

  /// The row being edited, or null for a new one.
  final Subscription? initial;

  @override
  ConsumerState<_AddSheet> createState() => _AddSheetState();
}

class _AddSheetState extends ConsumerState<_AddSheet> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _price = TextEditingController();
  final TextEditingController _plan = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  final TextEditingController _website = TextEditingController();

  /// The custom cadence's count ("every [N] …").
  final TextEditingController _every = TextEditingController(text: '1');

  _CyclePreset _preset = _CyclePreset.monthly;
  CycleUnit _unit = CycleUnit.month;

  /// The date the Calendar and the "Due in 7 days" figure are computed from.
  ///
  /// 🔴 IT USED TO BE INVENTED, AND NOTHING ON SCREEN SAID SO. `_save` passed
  /// `DateTime.now().add(const Duration(days: 12))` and the user was never
  /// asked — so every subscription added through this sheet landed on the
  /// calendar exactly twelve days out, and home's due-soon count was a
  /// statement about that constant rather than about the user's money.
  ///
  /// ⏱ 2026-09-28 · ST-T3b (ST-E4): it may be in the PAST now — "I started
  /// this last month" — and the next renewal is DERIVED from it by the
  /// platform's rule ([RecurrenceSchedule]), shown under the field.
  DateTime _renewal = _oneCycleFrom(DateTime.now(), Cadence.monthly);

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

  /// The row's own currency (ST-E2). Defaults to Settings for a new row, and
  /// to the row's for an edit.
  late String _currency;

  /// A free trial (ST-E5): the date field is then the day it ENDS, which is
  /// also the first charge, at the price typed above.
  bool _trial = false;

  bool _saving = false;

  /// The price field was typed in and then emptied: blank is then an error
  /// the field names (ST-E2), rather than a silent 9.99 — but a sheet that
  /// has just opened does not greet the user with one.
  bool _priceEmptied = false;

  /// Field errors the API named in a 400 (ST-E2), by field. Cleared when the
  /// field is edited.
  final Map<String, String> _serverErrors = <String, String>{};

  bool get _editing => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final Subscription? s = widget.initial;
    _currency =
        s?.currencyCode ??
        ref.read(subscriptionsControllerProvider.notifier).newRowCurrencyCode;
    if (s != null) {
      _name.text = s.name;
      _price.text = _plainAmount(s.price);
      _plan.text = s.plan;
      _notes.text = s.notes;
      _website.text = s.cancelUrl ?? '';
      final Cadence c = s.billingCadence;
      _preset = _CyclePresetX.of(c);
      _unit = c.unit;
      _every.text = '${c.every}';
      _trial = s.status == SubscriptionStatus.trialing && s.trialEndsOn != null;
      _renewal = _dateOnly(_trial ? s.trialEndsOn! : s.nextRenewal);
      _renewalChosen = true;
      _category = _categories.contains(s.category)
          ? s.category
          : _uncategorised;
    }
    for (final (TextEditingController c, String key)
        in <(TextEditingController, String)>[
          (_name, 'name'),
          (_price, 'price'),
          (_plan, 'plan'),
          (_notes, 'notes'),
          (_website, 'cancel_url'),
          (_every, 'cycle_every'),
        ]) {
      c.addListener(() {
        _serverErrors.remove(key);
        if (identical(c, _price)) _priceEmptied = _price.text.trim().isEmpty;
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    _plan.dispose();
    _notes.dispose();
    _website.dispose();
    _every.dispose();
    super.dispose();
  }

  /// A stored amount as the digits a person would type — no grouping, no sign.
  static String _plainAmount(Money m) {
    final int digits = m.minorUnitDigits;
    final String whole = '${m.minorUnits ~/ Money.pow10(digits)}';
    if (digits == 0) return whole;
    final String frac = '${m.minorUnits % Money.pow10(digits)}'.padLeft(
      digits,
      '0',
    );
    return '$whole.$frac';
  }

  /// Midnight local. The sheet stores and compares whole days, and
  /// `Subscription.daysUntil` truncates both of its operands to a day anyway —
  /// carrying a time-of-day would only make two equal dates compare unequal.
  static DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  /// One billing cycle after [from] — `packages/core`'s [RecurrenceSchedule], the
  /// rule the platform Worker rolls the stored date by, so the default the
  /// sheet offers is a date the server would also have produced.
  ///
  /// ⚠️ `DateTime(2026, 2, 31)` DOES NOT THROW — it rolls forward to 3 March,
  /// which is why this is not `DateTime(y, m + 1, d)`: the rule clamps to the
  /// last day of the month, and covers 29 February on a yearly cycle too.
  static DateTime _oneCycleFrom(DateTime from, Cadence cycle) =>
      RecurrenceSchedule.advance(_dateOnly(from), cycle);

  /// The cadence the controls describe, or null while the custom count is
  /// not a whole number 1..366.
  Cadence? get _cadence {
    final Cadence? preset = _preset.cadence;
    if (preset != null) return preset;
    final int? every = int.tryParse(_every.text.trim());
    if (every == null) return null;
    final Cadence c = Cadence(every, _unit);
    return c.isValid ? c : null;
  }

  /// The price as typed, in this row's currency and the UI's locale — or
  /// null when it is not a price (ST-E2: blank, negative, zero, or more
  /// decimals than the currency has).
  Money? _parsedPrice(String localeName) {
    final Money? m = MoneyParser.parse(
      _price.text,
      currencyCode: _currency,
      localeName: localeName,
    );
    return m == null || m.minorUnits <= 0 ? null : m;
  }

  /// Empty is fine (no website); anything else must be an http(s) address
  /// with a host — the API refuses the rest, since the app will OPEN it.
  bool get _websiteOk {
    final String t = _website.text.trim();
    if (t.isEmpty) return true;
    final Uri? u = Uri.tryParse(t);
    return u != null &&
        (u.scheme == 'https' || u.scheme == 'http') &&
        u.host.isNotEmpty;
  }

  bool _canSave(String localeName) =>
      !_saving &&
      _parsedPrice(localeName) != null &&
      _cadence != null &&
      _websiteOk;

  /// The next charge the platform rule derives from [_renewal] — the date
  /// itself when it is today or later, or its next occurrence when the user
  /// gave a past start date (ST-E4).
  DateTime _nextRenewal(Cadence c) =>
      RecurrenceSchedule.nextOnOrAfter(_renewal, c, _dateOnly(DateTime.now()));

  Future<void> _pickRenewal() async {
    final DateTime today = _dateOnly(DateTime.now());
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _renewal,
      // ⏱ 2026-09-28 · ST-T3b (ST-E4). This was `firstDate: today` ("a
      // renewal is in the future by definition"), so a user who started a
      // plan last month could not say so. A past date is the START; the next
      // renewal is derived from it and shown under the field. A trial's end
      // is still a future date.
      firstDate: _trial ? today : DateTime(today.year - 10, today.month, 1),
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

  Subscription _draft(Money price, Cadence cadence) {
    final Subscription? was = widget.initial;
    final String name = _name.text.trim();
    final String website = _website.text.trim();
    final DateTime next = _nextRenewal(cadence);
    // The FIRST charge: the date the user gave, when they gave one in the
    // past or for a trial; an edit that did not move the date keeps its own.
    final bool moved = was == null || !_sameDay(_renewal, was.nextRenewal);
    return Subscription(
      id: was?.id ?? '',
      name: name,
      category: _category,
      price: price,
      cycle: cadence,
      nextRenewal: next,
      plan: _plan.text.trim(),
      // Derived BEFORE POST by the one helper the seed client also uses, so
      // a live row carries the same mark a demo row does (ST-E2).
      glyph: was?.glyph ?? Subscription.glyphFor(name),
      usedPct: was?.usedPct ?? 0,
      usageNote: was?.usageNote ?? '',
      unused: was?.unused ?? false,
      status: _trial
          ? SubscriptionStatus.trialing
          : (was?.status == SubscriptionStatus.trialing
                ? SubscriptionStatus.active
                : (was?.status ?? SubscriptionStatus.active)),
      firstChargeOn: moved ? _renewal : was.firstChargeOn,
      trialEndsOn: _trial ? _renewal : null,
      cancelledOn: was?.cancelledOn,
      deletedAt: was?.deletedAt,
      notes: _notes.text.trim(),
      cancelUrl: website.isEmpty ? null : website,
    );
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  Future<void> _save() async {
    // Resolved BEFORE the await. Reaching through `context` after an async gap
    // is only safe while the element is still mounted, and the failure branch
    // below is precisely the case where that is in doubt.
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    // Same rule, same reason, and it is easy to miss that it applies:
    // `AppLocalizations.of` is an `InheritedWidget` lookup, so reading the
    // failure copy is a `context` read and belongs on THIS side of the await
    // exactly as the messenger does.
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Money? price = _parsedPrice(l10n.localeName);
    final Cadence? cadence = _cadence;
    // 🔴 THE 9.99 FALLBACK IS GONE (ST-E2). A price that did not parse used
    // to be saved as 9.99 without a word; now the button is disabled and the
    // field says why, so this is only reached with a real amount.
    if (price == null || cadence == null || !_websiteOk) return;
    setState(() => _saving = true);
    final Subscription draft = _draft(price, cadence);
    final SubscriptionsController ctl = ref.read(
      subscriptionsControllerProvider.notifier,
    );
    try {
      final Subscription? was = widget.initial;
      if (was == null) {
        await ctl.addSubscription(draft);
      } else {
        await ctl.updateSubscription(was.id, draft.changesFrom(was));
      }
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
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
      // A 400 names the field it refused (`validate` in the API's
      // routes/subscriptions.ts: "price must be …"). That is the user's to
      // fix, so it is shown ON the field, not as a network failure (ST-E2).
      final String? field = e is ApiException && e.statusCode == 400
          ? _fieldOf(e.detail ?? e.message)
          : null;
      setState(() {
        _saving = false;
        if (field != null) _serverErrors[field] = l10n.checkHighlightedFields;
      });
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException && e.statusCode == 400
                ? l10n.checkHighlightedFields
                : (_editing
                      ? l10n.updateSubscriptionFailed
                      : l10n.addSubscriptionFailed),
          ),
        ),
      );
    }
  }

  /// The sheet field a 400's detail names, or null. The API's details open
  /// with the column (`price must be …`, `cancel_url must be …`).
  static String? _fieldOf(String detail) {
    for (final (String prefix, String field) in <(String, String)>[
      ('price', 'price'),
      ('currency', 'price'),
      ('name', 'name'),
      ('plan', 'plan'),
      ('notes', 'notes'),
      ('cancel_url', 'cancel_url'),
      ('cycle', 'cycle_every'),
    ]) {
      if (detail.contains(prefix)) return field;
    }
    return null;
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
                _editing
                    ? l10n.editSubscriptionTitle
                    : l10n.addSubscriptionTitle,
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
                      // ⏱ ST-T3b (ST-E2): FocusableTap, not a bare
                      // GestureDetector — Tab and Enter reach the tile. Its
                      // own merge is off: this MergeSemantics is the node.
                      child: FocusableTap(
                        mergeDescendants: false,
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
              // The field's own `labelText` is what a screen reader reads now
              // (ST-E2); the visible heading is excluded so it is read once.
              ExcludeSemantics(
                child: Text(
                  l10n.fieldLabelName,
                  style: AppText.label.copyWith(color: p.muted),
                ),
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
                        ExcludeSemantics(
                          child: Text(
                            l10n.fieldLabelPrice,
                            style: AppText.label.copyWith(color: p.muted),
                          ),
                        ),
                        const SizedBox(height: 6),
                        // ⏱ ST-T3b (ST-E2): no '9.99' hint any more — it read
                        // as a value, and a blank field SAVED as 9.99. The
                        // field says what is wrong instead, and Add waits.
                        _input(
                          _price,
                          null,
                          keyboard: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          fieldKey: E2EKeys.addPrice,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: _currencyField(l10n)),
                ],
              ),
              const SizedBox(height: 12),
              _cycleField(l10n),
              if (_preset == _CyclePreset.custom) ...<Widget>[
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(
                      child: _input(
                        _every,
                        null,
                        keyboard: TextInputType.number,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: _unitField(l10n)),
                  ],
                ),
              ],
              const SizedBox(height: 4),
              // One merged node — "Free trial, switch, off" — rather than a
              // ListTile, whose ink needs a Material the sheet's DecoratedBox
              // fill would hide, and whose switch announced a second, nameless
              // control beside its title.
              MergeSemantics(
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        l10n.fieldLabelTrial,
                        style: AppText.label.copyWith(color: p.muted),
                      ),
                    ),
                    Switch(
                      value: _trial,
                      onChanged: (bool v) => setState(() {
                        _trial = v;
                        // A trial ends in the future; a past start is not one.
                        final DateTime today = _dateOnly(DateTime.now());
                        if (v && _renewal.isBefore(today)) {
                          _renewal = _oneCycleFrom(today, Cadence.monthly);
                        }
                      }),
                    ),
                  ],
                ),
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
              ExcludeSemantics(
                child: Text(
                  _trial ? l10n.fieldLabelTrialEnds : l10n.fieldLabelRenews,
                  style: AppText.label.copyWith(color: p.muted),
                ),
              ),
              const SizedBox(height: 6),
              _renewalField(l10n),
              ..._nextRenewalNote(l10n),
              const SizedBox(height: 12),
              Text(
                l10n.fieldLabelCategory,
                style: AppText.label.copyWith(color: p.muted),
              ),
              const SizedBox(height: 6),
              _categoryField(),
              const SizedBox(height: 12),
              _input(_plan, null),
              const SizedBox(height: 12),
              _input(_website, null, keyboard: TextInputType.url),
              const SizedBox(height: 12),
              _input(_notes, null, keyboard: TextInputType.multiline),
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
                          ? (_editing
                                ? l10n.savingEllipsis
                                : l10n.addingEllipsis)
                          : (_editing ? l10n.save : l10n.addSubscriptionTitle),
                      // Disabled until the form describes a real row (ST-E2):
                      // a price, a cadence, and a website that is a website.
                      onPressed: _canSave(l10n.localeName) ? _save : null,
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

  /// The cadence, as a stock dropdown (ST-E4, ST-E2). It replaced a pair of
  /// hand-rolled Monthly / Yearly `GestureDetector`s: two cadences could not
  /// describe a weekly or quarterly plan, and neither button was reachable
  /// by Tab. A dropdown is one focus stop with its value announced.
  Widget _cycleField(AppLocalizations l10n) {
    final _SheetPalette p = _SheetPalette.of(context);
    return DropdownButtonFormField<_CyclePreset>(
      initialValue: _preset,
      decoration: _fieldDecoration(p, label: l10n.fieldLabelCycle),
      dropdownColor: p.raised,
      isExpanded: true,
      items: <DropdownMenuItem<_CyclePreset>>[
        for (final (_CyclePreset v, String label) in <(_CyclePreset, String)>[
          (_CyclePreset.weekly, l10n.cycleWeekly),
          (_CyclePreset.monthly, l10n.cycleMonthly),
          (_CyclePreset.quarterly, l10n.cycleQuarterly),
          (_CyclePreset.yearly, l10n.cycleYearly),
          (_CyclePreset.custom, l10n.cycleCustom),
        ])
          DropdownMenuItem<_CyclePreset>(value: v, child: Text(label)),
      ],
      // The derived renewal default is "one cycle from today", so it has to
      // follow the cycle — otherwise picking Yearly leaves next month's date
      // sitting under it, which is the invented-date defect with a user
      // gesture in front of it. `_renewalChosen` is what stops this from
      // stamping over a date the user picked on purpose.
      onChanged: (_CyclePreset? v) => setState(() {
        _preset = v ?? _CyclePreset.monthly;
        final Cadence? c = _cadence;
        if (!_renewalChosen && c != null) {
          _renewal = _oneCycleFrom(DateTime.now(), c);
        }
      }),
    );
  }

  /// The custom cadence's unit.
  Widget _unitField(AppLocalizations l10n) {
    final _SheetPalette p = _SheetPalette.of(context);
    return DropdownButtonFormField<CycleUnit>(
      initialValue: _unit,
      decoration: _fieldDecoration(p, label: l10n.fieldLabelUnit),
      dropdownColor: p.raised,
      isExpanded: true,
      items: <DropdownMenuItem<CycleUnit>>[
        for (final (CycleUnit u, String label) in <(CycleUnit, String)>[
          (CycleUnit.day, l10n.unitDays),
          (CycleUnit.week, l10n.unitWeeks),
          (CycleUnit.month, l10n.unitMonths),
          (CycleUnit.year, l10n.unitYears),
        ])
          DropdownMenuItem<CycleUnit>(value: u, child: Text(label)),
      ],
      onChanged: (CycleUnit? u) => setState(() => _unit = u ?? _unit),
    );
  }

  /// The row's currency (ST-E2): the Settings choice for a new row, the row's
  /// own for an edit, from the one table every formatter reads
  /// (`Money.symbols`).
  Widget _currencyField(AppLocalizations l10n) {
    final _SheetPalette p = _SheetPalette.of(context);
    final List<String> codes = <String>{
      ...Money.symbols.keys,
      _currency,
    }.toList();
    return DropdownButtonFormField<String>(
      initialValue: _currency,
      decoration: _fieldDecoration(p, label: l10n.fieldLabelCurrency),
      dropdownColor: p.raised,
      isExpanded: true,
      items: <DropdownMenuItem<String>>[
        for (final String c in codes)
          DropdownMenuItem<String>(value: c, child: Text(c)),
      ],
      onChanged: (String? c) => setState(() => _currency = c ?? _currency),
    );
  }

  /// "Next renewal Oct 3" under a PAST date: the charge the platform rule
  /// derives from the start the user gave (ST-E4). Nothing under a future
  /// date — that date IS the next renewal.
  List<Widget> _nextRenewalNote(AppLocalizations l10n) {
    final Cadence? c = _cadence;
    if (_trial || c == null) return const <Widget>[];
    if (!_renewal.isBefore(_dateOnly(DateTime.now()))) {
      return const <Widget>[];
    }
    final _SheetPalette p = _SheetPalette.of(context);
    return <Widget>[
      const SizedBox(height: 6),
      Text(
        l10n.addNextRenewal(
          DateFormat.yMMMd(l10n.localeName).format(_nextRenewal(c)),
        ),
        style: AppText.label.copyWith(color: p.muted),
      ),
    ];
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
        // The field's name for a reader (ST-E2): the heading above is
        // excluded, so it is not read twice.
        label: _trial ? l10n.fieldLabelTrialEnds : l10n.fieldLabelRenews,
        // ⏱ ST-T3b (ST-E2): FocusableTap, not a bare GestureDetector — Tab
        // reaches the date and Enter opens the picker. Its own merge is off:
        // this MergeSemantics is the node.
        child: FocusableTap(
          mergeDescendants: false,
          key: E2EKeys.addRenewal,
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
  ///
  /// ⏱ ST-T3b (ST-E2): [label] is the field's `labelText` — its NAME to a
  /// screen reader and in the field — and [error] its `errorText`. The fields
  /// were hint-only, so an emptied field had no name at all.
  InputDecoration _fieldDecoration(
    _SheetPalette p, {
    String? hint,
    String? label,
    String? error,
  }) {
    return InputDecoration(
      hintText: hint,
      labelText: label,
      errorText: error,
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
    String? hint, {
    TextInputType keyboard = TextInputType.text,
    Key? fieldKey,
  }) {
    final _SheetPalette p = _SheetPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final (String label, String? error) = _labelAndError(c, l10n);
    return TextField(
      key: fieldKey,
      controller: c,
      keyboardType: keyboard,
      maxLines: keyboard == TextInputType.multiline ? null : 1,
      // The colour is spelled out because `AppText.body` carries a hardcoded
      // `AppColors.ink`: a white-filled field with near-black text is what this
      // widget painted on a dark sheet before, and `copyWith` is the only way a
      // const style with a colour in it can be re-pointed at the scheme.
      style: AppText.body.copyWith(fontWeight: FontWeight.w600, color: p.ink),
      decoration: _fieldDecoration(p, hint: hint, label: label, error: error),
    );
  }

  /// Each text field's NAME and, when it has one, what is wrong with it.
  /// Keyed by controller so the call sites stay one line — the name field's
  /// call is a line a sworn store declaration cites, by its text.
  (String, String?) _labelAndError(
    TextEditingController c,
    AppLocalizations l10n,
  ) {
    if (identical(c, _price)) {
      final bool bad =
          _price.text.isNotEmpty && _parsedPrice(l10n.localeName) == null;
      return (
        l10n.fieldLabelPrice,
        _serverErrors['price'] ??
            (bad || _priceEmptied ? l10n.priceErrorInvalid : null),
      );
    }
    if (identical(c, _website)) {
      return (
        l10n.fieldLabelWebsite,
        _serverErrors['cancel_url'] ??
            (_websiteOk ? null : l10n.websiteErrorInvalid),
      );
    }
    if (identical(c, _every)) {
      return (
        l10n.fieldLabelEvery,
        _serverErrors['cycle_every'] ??
            (_cadence == null ? l10n.everyErrorInvalid : null),
      );
    }
    if (identical(c, _plan)) {
      return (l10n.fieldLabelPlan, _serverErrors['plan']);
    }
    if (identical(c, _notes)) {
      return (l10n.fieldLabelNotes, _serverErrors['notes']);
    }
    return (l10n.fieldLabelName, _serverErrors['name']);
  }
}
