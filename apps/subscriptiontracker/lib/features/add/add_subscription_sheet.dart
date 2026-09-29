import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import 'package:nikatru_core/nikatru_core.dart' show MoneyParser;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../data/api/api_client.dart' show ApiException;
import '../../data/models/budget_info.dart';
import '../../data/models/subscription.dart';
import '../../data/seed/demo_data.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart' show networkUnreachableProvider;
import '../../state/subscriptions_controller.dart';

// ⏱ 2026-09-29 · trains ST-T3b + ST-D6. TWO THINGS OF RECORD, ONE SHEET.
//
// ST-T3b (#1045) is the BEHAVIOUR: edit mode through [initial], every/unit
// cadences, trials, the row's own currency, 400 → field errors, no silent
// 9.99, and one PATCH of only what changed. ST-D6 is the DESIGN: the sheet is
// built from the chassis form components in packages/design_system —
// `AppFormSheet`, `AppFieldDecoration`, `AppFormField`, `AppFormActions` — and
// holds only what is Subly's own: the fields, the POPULAR shortcuts, the
// category vocabulary and the write. The `_SheetPalette` of literal light
// colours is gone with its two brand-font literals: every colour, size and
// face here is a token or a theme role, in both schemes.
//
// Each field carries its NAME as the decoration's `labelText` (ST-E2): that
// is what a screen reader announces for the control itself, so no field is
// nameless once emptied. The POPULAR block, a group rather than one control,
// keeps an `AppFormField` heading.

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
/// A third, the detail header, prints it verbatim beside the plan, so a typo is
/// user-visible too.
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

// The category VALUES are data, not copy, and are correctly untranslated —
// every other screen paints them raw for that reason (`scan_screen.dart`
// records it). The field LABELS are arb keys in both locales.

/// Opens the add sheet — or, with [initial], the EDIT sheet (ST-E1):
/// prefilled from the row, and saving sends one PATCH of only what changed.
///
/// The presentation — root navigator, scroll-controlled, M3's 640 width cap —
/// is the chassis's [showAppFormSheet]; `width_add_sheet_test.dart` measures the
/// cap at 768 and 1280.
Future<void> showAddSubscriptionSheet(
  BuildContext context, {
  Subscription? initial,
}) {
  return showAppFormSheet<void>(
    context,
    builder: (_) => SubscriptionFormSheet(initial: initial),
  );
}

/// The cadences offered as one choice; anything else is [custom].
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

/// The add / edit form. Public for its tests; open it through
/// [showAddSubscriptionSheet].
///
/// ## Its states
///  * **empty** — an add: nothing typed, the POPULAR shortcuts offered, Add
///    disabled until the form describes a real row.
///  * **populated** — an edit: every field prefilled from the row.
///  * **loading** — a save in flight: fields and shortcuts disabled, the
///    primary action disabled and reading "Adding…" / "Saving…".
///  * **error** — a save that failed: a danger banner under the title (and,
///    for a 400, the refused field marked), the typed draft kept and the
///    primary action re-armed, so a retry is one tap.
///  * **offline** — the app knows the network is unreachable: a warn banner
///    says so up front, before the user types into a form that cannot save.
class SubscriptionFormSheet extends ConsumerStatefulWidget {
  const SubscriptionFormSheet({
    super.key,
    this.initial,
    @visibleForTesting this.now = DateTime.now,
  });

  /// The row being edited, or null for a new one.
  final Subscription? initial;

  /// The clock "today" is read from — the default renewal date, the picker's
  /// range and the past-start note. A parameter only so a golden of the form
  /// does not change every day; the app never passes it.
  final DateTime Function() now;

  @override
  ConsumerState<SubscriptionFormSheet> createState() => _AddSheetState();
}

class _AddSheetState extends ConsumerState<SubscriptionFormSheet> {
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
  /// calendar exactly twelve days out.
  ///
  /// ST-T3b (ST-E4): it may be in the PAST — "I started this last month" —
  /// and the next renewal is DERIVED from it by the platform's rule
  /// ([RecurrenceSchedule]), shown under the field.
  late DateTime _renewal = _oneCycleFrom(widget.now(), Cadence.monthly);

  /// Whether [_renewal] is the user's choice rather than the derived default.
  ///
  /// The default is "one cycle from today", so it has to MOVE when the cadence
  /// moves — a yearly plan defaulting to next month is the same invented date
  /// wearing a new hat. But once the user has picked a date, changing the
  /// cadence must not overwrite it, and this flag is the entire difference.
  bool _renewalChosen = false;

  /// Hardcoded to `'Other'` once, with no field to change it, so every row
  /// added here fell into one bucket.
  String _category = _uncategorised;

  /// The row's own currency (ST-E2). Defaults to Settings for a new row, and
  /// to the row's for an edit.
  late String _currency;

  /// A free trial (ST-E5): the date field is then the day it ENDS, which is
  /// also the first charge, at the price typed above.
  bool _trial = false;

  bool _saving = false;

  /// What the last failed save said, shown in the danger banner until the
  /// next attempt (ST-D6: on the sheet, never under its barrier).
  String? _failure;

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

  DateTime get _today => _dateOnly(widget.now());

  /// One billing cycle after [from] — `packages/core`'s [RecurrenceSchedule],
  /// the rule the platform Worker rolls the stored date by, so the default the
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
      RecurrenceSchedule.nextOnOrAfter(_renewal, c, _today);

  Future<void> _pickRenewal() async {
    final DateTime today = _today;
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _renewal,
      // ST-T3b (ST-E4): a past date is the START; the next renewal is derived
      // from it and shown under the field. A trial's end is still a future
      // date.
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
    // `AppLocalizations.of` is an `InheritedWidget` lookup, so reading the
    // failure copy is a `context` read and belongs on THIS side of the await.
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Money? price = _parsedPrice(l10n.localeName);
    final Cadence? cadence = _cadence;
    // 🔴 THE 9.99 FALLBACK IS GONE (ST-E2). A price that did not parse used
    // to be saved as 9.99 without a word; now the button is disabled and the
    // field says why, so this is only reached with a real amount.
    if (_saving || price == null || cadence == null || !_websiteOk) return;
    setState(() {
      _saving = true;
      _failure = null;
    });
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
      // 🔴 THIS FAILURE PATH DID NOT EXIST. The write goes through the
      // repository to the network, so one offline moment threw out of an
      // unawaited future: nothing caught it, `_saving` was never cleared, and
      // the button sat disabled on 'Adding…' forever with no message.
      //
      // ⏱ train ST-D6: the message is a danger banner ON the sheet rather than
      // a SnackBar. A SnackBar lands on the scaffold UNDER the modal barrier,
      // so on a tall sheet it was painted behind the very surface the user was
      // looking at. The sheet deliberately STAYS UP so the typed draft
      // survives — a retry costs one tap, not a re-entry.
      if (!mounted) return;
      // A 400 names the field it refused (`validate` in the API's
      // routes/subscriptions.ts: "price must be …"). That is the user's to
      // fix, so it is shown ON the field, not as a network failure (ST-E2).
      final bool refused = e is ApiException && e.statusCode == 400;
      final String? field = refused ? _fieldOf(e.detail ?? e.message) : null;
      setState(() {
        _saving = false;
        if (field != null) _serverErrors[field] = l10n.checkHighlightedFields;
        _failure = refused
            ? l10n.checkHighlightedFields
            : (_editing
                  ? l10n.updateSubscriptionFailed
                  : l10n.addSubscriptionFailed);
      });
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
    final bool offline = ref.watch(networkUnreachableProvider);
    final VoidCallback? submit = _canSave(l10n.localeName) ? _save : null;
    return AppFormSheet(
      title: _editing ? l10n.editSubscriptionTitle : l10n.addSubscriptionTitle,
      onSubmit: submit,
      banner: _banner(l10n, offline: offline),
      actions: AppFormActions(
        cancelKey: E2EKeys.addCancel,
        cancelLabel: l10n.cancel,
        onCancel: () => Navigator.of(context).pop(),
        submitKey: E2EKeys.addSubmit,
        submitLabel: _editing ? l10n.save : l10n.addSubscriptionTitle,
        busyLabel: _editing ? l10n.savingEllipsis : l10n.addingEllipsis,
        busy: _saving,
        // Disabled until the form describes a real row (ST-E2): a price, a
        // cadence, and a website that is a website.
        onSubmit: submit,
      ),
      children: <Widget>[
        if (!_editing)
          AppFormField(label: l10n.addPopularHeading, child: _popular()),
        _input(_name, l10n.addNameHint, fieldKey: E2EKeys.addName),
        // ⚠️ THE PRICE AND ITS CURRENCY SHARE A ROW; the date and category do
        // not, and the reason is text scaling rather than taste: a formatted
        // date plus its icon, or the longest category, fills a half-width box
        // at 1.0 and ellipsizes to nothing at 1.5. The sheet scrolls, so
        // height is the cheap axis here and width is not.
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              // ST-T3b (ST-E2): no '9.99' hint any more — it read as a value,
              // and a blank field SAVED as 9.99. The field says what is wrong
              // instead, and Add waits.
              child: _input(
                _price,
                null,
                keyboard: const TextInputType.numberWithOptions(decimal: true),
                fieldKey: E2EKeys.addPrice,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(child: _currencyField(l10n)),
          ],
        ),
        _cycleField(l10n),
        if (_preset == _CyclePreset.custom)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: _input(_every, null, keyboard: TextInputType.number),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(child: _unitField(l10n)),
            ],
          ),
        _trialSwitch(l10n),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[_renewalField(l10n), ..._nextRenewalNote(l10n)],
        ),
        _categoryField(l10n),
        _input(_plan, null),
        _input(_website, null, keyboard: TextInputType.url),
        _input(_notes, null, keyboard: TextInputType.multiline),
      ],
    );
  }

  /// The one banner the form is in, most urgent first: a failed save outranks
  /// being offline, because it is about something the user just did.
  Widget? _banner(AppLocalizations l10n, {required bool offline}) {
    final String? failure = _failure;
    if (failure != null) {
      return DecisionStrip(
        key: E2EKeys.addBanner,
        kind: StatusKind.danger,
        message: failure,
      );
    }
    if (offline) {
      return DecisionStrip(
        key: E2EKeys.addBanner,
        kind: StatusKind.warn,
        message: l10n.formOfflineNotice,
      );
    }
    return null;
  }

  /// The POPULAR shortcuts: one tap fills the name.
  ///
  /// 🔴 THE COLUMN COUNT IS DERIVED, NOT DECLARED. Four columns is a PHONE
  /// decision and the sheet is not phone-only: M3 caps a modal sheet at 640, so
  /// `maxCrossAxisExtent` keeps the tile chip-sized at every width and lets the
  /// count follow — 4 columns at 375, 6 at 640. `width_add_sheet_test.dart`
  /// pins both endpoints. Contrast the calendar grid, where
  /// `crossAxisCount: 7` is SEMANTIC (days of the week) and must stay fixed.
  Widget _popular() {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: AppSpacing.xxxl * 2,
        mainAxisSpacing: AppSpacing.sm,
        crossAxisSpacing: AppSpacing.sm,
        childAspectRatio: 0.82,
      ),
      itemCount: DemoData.popular.length,
      itemBuilder: (BuildContext context, int i) {
        // `service[1]` is the abbreviation ("NF"), `service[0]` the name
        // ("Netflix"). The mark is excluded and the tile merged, so it is ONE
        // node — "Netflix, button" — and, being a `FocusableTap`, a keyboard
        // stop that Enter or Space activates (ST-E2).
        final List<String> service = DemoData.popular[i];
        return FocusableTap(
          borderRadius: BorderRadius.circular(AppRadius.control),
          onTap: _saving ? null : () => _name.text = service[0],
          child: Column(
            children: <Widget>[
              Expanded(
                child: ExcludeSemantics(
                  child: Container(
                    width: double.infinity,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer,
                      borderRadius: BorderRadius.circular(AppRadius.control),
                    ),
                    child: Text(
                      service[1],
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: scheme.onPrimaryContainer,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                service[0],
                style: theme.textTheme.labelSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        );
      },
    );
  }

  /// A dropdown on this sheet, on the one field skin. The menu is an overlay
  /// with its own ground, and left alone it paints `ThemeData.canvasColor` —
  /// the LIGHT surface even under the dark scheme — so it takes the field's
  /// own fill, the slot it opens from.
  Widget _dropdown<T>({
    Key? key,
    required String label,
    required T value,
    required List<(T, String)> items,
    required ValueChanged<T?> onChanged,
  }) {
    final ThemeData theme = Theme.of(context);
    final TextStyle? style = AppFieldDecoration.valueStyle(context);
    return DropdownButtonFormField<T>(
      key: key,
      initialValue: value,
      decoration: AppFieldDecoration.of(context, label: label),
      style: style,
      dropdownColor: AppCard.fillOf(theme),
      borderRadius: BorderRadius.circular(AppRadius.control),
      icon: Icon(Icons.expand_more, color: theme.colorScheme.onSurfaceVariant),
      // Without this the button shrink-wraps the widest item and the chevron
      // sits mid-field instead of at the trailing edge.
      isExpanded: true,
      items: <DropdownMenuItem<T>>[
        for (final (T v, String text) in items)
          DropdownMenuItem<T>(
            value: v,
            child: Text(
              text,
              style: style,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: _saving ? null : onChanged,
    );
  }

  /// The cadence (ST-E4, ST-E2). It replaced a Monthly / Yearly pair: two
  /// cadences could not describe a weekly or quarterly plan. A dropdown is one
  /// focus stop with its value announced.
  ///
  /// The derived renewal default is "one cycle from today", so it follows the
  /// cadence — otherwise picking Yearly leaves next month's date sitting under
  /// it. `_renewalChosen` is what stops this from stamping over a date the
  /// user picked on purpose.
  Widget _cycleField(AppLocalizations l10n) => _dropdown<_CyclePreset>(
    label: l10n.fieldLabelCycle,
    value: _preset,
    items: <(_CyclePreset, String)>[
      (_CyclePreset.weekly, l10n.cycleWeekly),
      (_CyclePreset.monthly, l10n.cycleMonthly),
      (_CyclePreset.quarterly, l10n.cycleQuarterly),
      (_CyclePreset.yearly, l10n.cycleYearly),
      (_CyclePreset.custom, l10n.cycleCustom),
    ],
    onChanged: (_CyclePreset? v) => setState(() {
      _preset = v ?? _CyclePreset.monthly;
      final Cadence? c = _cadence;
      if (!_renewalChosen && c != null) {
        _renewal = _oneCycleFrom(widget.now(), c);
      }
    }),
  );

  /// The custom cadence's unit.
  Widget _unitField(AppLocalizations l10n) => _dropdown<CycleUnit>(
    label: l10n.fieldLabelUnit,
    value: _unit,
    items: <(CycleUnit, String)>[
      (CycleUnit.day, l10n.unitDays),
      (CycleUnit.week, l10n.unitWeeks),
      (CycleUnit.month, l10n.unitMonths),
      (CycleUnit.year, l10n.unitYears),
    ],
    onChanged: (CycleUnit? u) => setState(() => _unit = u ?? _unit),
  );

  /// The row's currency (ST-E2): the Settings choice for a new row, the row's
  /// own for an edit, from the one table every formatter reads
  /// (`Money.symbols`).
  Widget _currencyField(AppLocalizations l10n) => _dropdown<String>(
    label: l10n.fieldLabelCurrency,
    value: _currency,
    items: <(String, String)>[
      for (final String c in <String>{...Money.symbols.keys, _currency}) (c, c),
    ],
    onChanged: (String? c) => setState(() => _currency = c ?? _currency),
  );

  /// The category, chosen from [_categories].
  ///
  /// A dropdown rather than a row of chips: eleven chips would add eleven tap
  /// targets to a sheet already capped in height, and the vocabulary is closed,
  /// so the compact control is the honest one.
  Widget _categoryField(AppLocalizations l10n) => _dropdown<String>(
    key: E2EKeys.addCategory,
    label: l10n.fieldLabelCategory,
    value: _category,
    items: <(String, String)>[for (final String c in _categories) (c, c)],
    onChanged: (String? v) => setState(() => _category = v ?? _uncategorised),
  );

  /// A free trial (ST-E5). One merged node — "Free trial, switch, off" —
  /// rather than a ListTile, whose ink needs a Material the sheet's fill would
  /// hide, and whose switch announced a second, nameless control beside it.
  Widget _trialSwitch(AppLocalizations l10n) {
    final ThemeData theme = Theme.of(context);
    return MergeSemantics(
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              l10n.fieldLabelTrial,
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Switch(
            value: _trial,
            onChanged: _saving
                ? null
                : (bool v) => setState(() {
                    _trial = v;
                    // A trial ends in the future; a past start is not one.
                    final DateTime today = _today;
                    if (v && _renewal.isBefore(today)) {
                      _renewal = _oneCycleFrom(today, Cadence.monthly);
                    }
                  }),
          ),
        ],
      ),
    );
  }

  /// "Next renewal Oct 3" under a PAST date: the charge the platform rule
  /// derives from the start the user gave (ST-E4). Nothing under a future
  /// date — that date IS the next renewal.
  List<Widget> _nextRenewalNote(AppLocalizations l10n) {
    final Cadence? c = _cadence;
    if (_trial || c == null) return const <Widget>[];
    if (!_renewal.isBefore(_today)) return const <Widget>[];
    final ThemeData theme = Theme.of(context);
    return <Widget>[
      const SizedBox(height: AppSpacing.sm),
      Text(
        l10n.addNextRenewal(
          DateFormat.yMMMd(l10n.localeName).format(_nextRenewal(c)),
        ),
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    ];
  }

  /// The renewal date — or, for a trial, the day it ends — as a field the
  /// user can open a calendar from.
  ///
  /// It is an [InputDecorator] wearing [AppFieldDecoration.of] rather than a
  /// hand-rolled `Container`, so it IS the text fields' skin. The label is the
  /// field's name; the tap wrapper merges it with the date into one button.
  Widget _renewalField(AppLocalizations l10n) {
    final ThemeData theme = Theme.of(context);
    // `l10n.localeName`, never the ambient default: `DateFormat` with no locale
    // reads `Intl.defaultLocale`, a process-wide global that nothing on this
    // sheet sets. `intl` ships the month names and the field ORDER for both
    // locales — "Sep 22, 2026" in en, the reordered form in ta.
    final String formatted = DateFormat.yMMMd(l10n.localeName).format(_renewal);
    return FocusableTap(
      key: E2EKeys.addRenewal,
      borderRadius: BorderRadius.circular(AppRadius.control),
      onTap: _saving ? null : _pickRenewal,
      child: InputDecorator(
        decoration: AppFieldDecoration.of(
          context,
          label: _trial ? l10n.fieldLabelTrialEnds : l10n.fieldLabelRenews,
        ),
        isEmpty: false,
        child: Row(
          children: <Widget>[
            Expanded(
              child: Text(
                formatted,
                style: AppFieldDecoration.valueStyle(context),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            // No `semanticLabel`, so it contributes no node at all: the date
            // beside it is the entire content, and the control is already
            // announced as a button by the tap wrapper.
            Icon(
              Icons.calendar_today_outlined,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }

  /// A text field on this sheet. Its name and error are read off the
  /// controller rather than passed, so the name field's call stays the
  /// one-line call that `store/android-play/data-safety.json` cites by line.
  Widget _input(
    TextEditingController c,
    String? hint, {
    TextInputType keyboard = TextInputType.text,
    Key? fieldKey,
  }) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final (String label, String? error) = _labelAndError(c, l10n);
    return TextField(
      key: fieldKey,
      controller: c,
      enabled: !_saving,
      keyboardType: keyboard,
      maxLines: keyboard == TextInputType.multiline ? null : 1,
      // Next from the name: the keyboard walks the form in reading order.
      textInputAction: identical(c, _name) ? TextInputAction.next : null,
      style: AppFieldDecoration.valueStyle(context),
      decoration: AppFieldDecoration.of(
        context,
        hint: hint,
        label: label,
        errorText: error,
      ),
    );
  }

  /// Each text field's NAME and, when it has one, what is wrong with it.
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
