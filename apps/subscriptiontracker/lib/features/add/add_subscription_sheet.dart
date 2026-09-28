import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../data/models/budget_info.dart';
import '../../data/models/subscription.dart';
import '../../data/seed/demo_data.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart';

// ⏱ 2026-09-28 · train ST-D6 (Add / Edit): THIS SHEET IS BUILT FROM THE
// CHASSIS FORM COMPONENTS NOW — `AppFormSheet`, `AppFormField`,
// `AppFieldDecoration`, `AppSegmentedChoice` and `AppFormActions` in
// packages/design_system — and holds only what is Subly's own: the fields, the
// POPULAR shortcuts, the category vocabulary and the write. The `_SheetPalette`
// that stood here (a light arm of literal `AppColors` and a dark arm of scheme
// slots) is gone with the two brand-font literals: every colour, size and face
// on this sheet is a token or a theme role, in both schemes.
//
// The same sheet is the EDIT form: [showEditSubscriptionSheet] opens it
// prefilled from a row, without the POPULAR shortcuts (they name a NEW
// service), titled and labelled as an edit.

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

/// Opens the add sheet.
///
/// The presentation — root navigator, scroll-controlled, M3's 640 width cap —
/// is the chassis's [showAppFormSheet]; `width_add_sheet_test.dart` measures the
/// cap at 768 and 1280.
Future<void> showAddSubscriptionSheet(BuildContext context) {
  return showAppFormSheet<void>(
    context,
    builder: (_) => const SubscriptionFormSheet(),
  );
}

/// Opens the same sheet as an EDIT of [subscription] (train ST-D6).
///
/// Reached from the detail screen's "Edit plan" button. The row is read once,
/// when the sheet opens; the sheet writes through
/// [SubscriptionsController.updateSubscription].
Future<void> showEditSubscriptionSheet(
  BuildContext context,
  Subscription subscription,
) {
  return showAppFormSheet<void>(
    context,
    builder: (_) => SubscriptionFormSheet(editing: subscription),
  );
}

/// The add / edit form. Public for its tests; open it through
/// [showAddSubscriptionSheet] or [showEditSubscriptionSheet].
///
/// ## Its states
///  * **empty** — an add: nothing typed, the POPULAR shortcuts offered.
///  * **populated** — an edit: every field prefilled from the row.
///  * **loading** — a save in flight: fields and shortcuts disabled, the
///    primary action disabled and reading "Adding…" / "Saving…".
///  * **error** — a save that failed: a danger banner under the title, the
///    typed draft kept and the primary action re-armed, so a retry is one tap.
///  * **offline** — the app knows the network is unreachable: a warn banner
///    says so up front, before the user types anything into a form that
///    cannot save.
class SubscriptionFormSheet extends ConsumerStatefulWidget {
  const SubscriptionFormSheet({
    super.key,
    this.editing,
    @visibleForTesting this.now = DateTime.now,
  });

  /// The row being edited, or null for an add.
  final Subscription? editing;

  /// The clock "today" is read from — the add form's default renewal date and
  /// the picker's first day. A parameter only so a golden of the add form does
  /// not change every day; the app never passes it.
  final DateTime Function() now;

  @override
  ConsumerState<SubscriptionFormSheet> createState() => _AddSheetState();
}

class _AddSheetState extends ConsumerState<SubscriptionFormSheet> {
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
  late DateTime _renewal = _oneCycleFrom(widget.now(), BillingCycle.monthly);

  /// Whether [_renewal] is the user's choice rather than the derived default.
  ///
  /// The default is "one cycle from today", so it has to MOVE when the cycle
  /// toggle moves — a yearly plan defaulting to next month is the same invented
  /// date wearing a new hat. But once the user has picked a date, flipping the
  /// cycle must not overwrite it, and this flag is the entire difference
  /// between those two behaviours. An edit opens with it SET: the row's date
  /// is the user's, not a default.
  bool _renewalChosen = false;

  /// Also hardcoded before — to `'Other'`, with no field to change it. Every row
  /// added through this sheet therefore fell into one bucket, so the insights
  /// donut, the budget bars and the detail header all described it wrongly.
  String _category = _uncategorised;

  bool _saving = false;

  /// The last save failed; the danger banner shows until the next attempt.
  bool _saveFailed = false;

  /// Inline field errors, set by [_validate] on submit and cleared as the
  /// user types.
  String? _nameError;
  String? _priceError;

  bool get _isEdit => widget.editing != null;

  @override
  void initState() {
    super.initState();
    final Subscription? row = widget.editing;
    if (row != null) {
      _name.text = row.name;
      // Plain major units, as the user would type them: the field is a
      // number, and the symbol is the row's currency, which an edit keeps.
      _price.text = row.price.toMajorUnits().toStringAsFixed(
        row.price.minorUnits % 100 == 0 ? 0 : 2,
      );
      _cycle = row.cycle;
      _renewal = _dateOnly(row.nextRenewal);
      _renewalChosen = true;
      _category = row.category;
    }
  }

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
    final DateTime today = _dateOnly(widget.now());
    // An edited row may renew in the past (a stale row); the picker refuses an
    // initial date before `firstDate`, so it opens on today instead.
    final DateTime initial = _renewal.isBefore(today) ? today : _renewal;
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: initial,
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

  /// The inline validation: a name, and an amount that parses to money at or
  /// above zero. Returns whether the form may be written.
  ///
  /// 🔴 THE AMOUNT IS NO LONGER INVENTED EITHER. An empty or unparseable price
  /// used to be saved as 9.99 in silence — the renewal date's defect, one
  /// field over. It is now an error under the field, in words.
  bool _validate(AppLocalizations l10n) {
    final bool nameOk = _name.text.trim().isNotEmpty;
    final bool priceOk = _enteredPrice() != null;
    setState(() {
      _nameError = nameOk ? null : l10n.formNameRequired;
      _priceError = priceOk ? null : l10n.formPriceInvalid;
    });
    return nameOk && priceOk;
  }

  Future<void> _save() async {
    // `AppLocalizations.of` is an `InheritedWidget` lookup, so reading the copy
    // is a `context` read and belongs on THIS side of the await.
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (_saving || !_validate(l10n)) return;
    setState(() {
      _saving = true;
      _saveFailed = false;
    });
    final Money price = _enteredPrice()!;
    final SubscriptionsController controller = ref.read(
      subscriptionsControllerProvider.notifier,
    );
    try {
      final Subscription? row = widget.editing;
      if (row == null) {
        await controller.addSubscription(
          Subscription(
            id: '',
            name: _name.text.trim(),
            category: _category,
            price: price,
            cycle: _cycle,
            nextRenewal: _renewal,
          ),
        );
      } else {
        await controller.updateSubscription(
          row
              .copyWith(
                name: _name.text.trim(),
                category: _category,
                cycle: _cycle,
                nextRenewal: _renewal,
              )
              .withPrice(price),
        );
      }
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
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
      setState(() => _saving = false);
      setState(() => _saveFailed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool offline = ref.watch(networkUnreachableProvider);
    final VoidCallback? submit = _saving ? null : _save;
    return AppFormSheet(
      title: _isEdit ? l10n.editSubscriptionTitle : l10n.addSubscriptionTitle,
      onSubmit: submit,
      banner: _banner(l10n, offline: offline),
      actions: AppFormActions(
        cancelKey: E2EKeys.addCancel,
        cancelLabel: l10n.cancel,
        onCancel: () => Navigator.of(context).pop(),
        submitKey: E2EKeys.addSubmit,
        submitLabel: _isEdit ? l10n.saveChanges : l10n.addSubscriptionTitle,
        busyLabel: _isEdit ? l10n.savingEllipsis : l10n.addingEllipsis,
        busy: _saving,
        onSubmit: _save,
      ),
      children: <Widget>[
        if (!_isEdit)
          AppFormField(label: l10n.addPopularHeading, child: _popular()),
        AppFormField(
          label: l10n.fieldLabelName,
          child: _input(_name, l10n.addNameHint, fieldKey: E2EKeys.addName),
        ),
        // ⚠️ PRICE AND CYCLE SHARE A ROW, THE DATE AND CATEGORY DO NOT, and the
        // reason is text scaling rather than taste: a formatted date plus its
        // icon, or the longest category, fills a half-width box at 1.0 and
        // ellipsizes to nothing at 1.5. The sheet scrolls, so height is the
        // cheap axis here and width is not.
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: AppFormField(
                label: l10n.fieldLabelPrice,
                child: _input(
                  _price,
                  // NOT a key: an example NUMBER, and a translator has nothing
                  // to do to it. The digits localize through the keyboard and
                  // the formatter, not the arb.
                  '9.99',
                  keyboard: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  fieldKey: E2EKeys.addPrice,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: AppFormField(
                label: l10n.fieldLabelCycle,
                child: AppSegmentedChoice<BillingCycle>(
                  choices: <AppChoice<BillingCycle>>[
                    AppChoice<BillingCycle>(
                      value: BillingCycle.monthly,
                      label: l10n.cycleMonthly,
                    ),
                    AppChoice<BillingCycle>(
                      value: BillingCycle.yearly,
                      label: l10n.cycleYearly,
                    ),
                  ],
                  selected: _cycle,
                  onChanged: _saving ? null : _chooseCycle,
                ),
              ),
            ),
          ],
        ),
        AppFormField(label: l10n.fieldLabelRenews, child: _renewalField(l10n)),
        AppFormField(label: l10n.fieldLabelCategory, child: _categoryField()),
      ],
    );
  }

  /// The one banner the form is in, most urgent first: a failed save outranks
  /// being offline, because it is about something the user just did.
  Widget? _banner(AppLocalizations l10n, {required bool offline}) {
    if (_saveFailed) {
      return DecisionStrip(
        key: E2EKeys.addBanner,
        kind: StatusKind.danger,
        message: _isEdit
            ? l10n.editSubscriptionFailed
            : l10n.addSubscriptionFailed,
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

  /// The derived renewal default is "one cycle from today", so it has to follow
  /// the cycle — otherwise picking Yearly leaves next month's date sitting under
  /// it. `_renewalChosen` is what stops this from stamping over a date the user
  /// picked on purpose.
  void _chooseCycle(BillingCycle cycle) => setState(() {
    _cycle = cycle;
    if (!_renewalChosen) {
      _renewal = _oneCycleFrom(widget.now(), cycle);
    }
  });

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
        // stop that Enter or Space activates.
        final List<String> service = DemoData.popular[i];
        return FocusableTap(
          borderRadius: BorderRadius.circular(AppRadius.control),
          onTap: _saving
              ? null
              : () => setState(() {
                  _name.text = service[0];
                  _nameError = null;
                }),
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

  /// The renewal date, as a field the user can open a calendar from.
  ///
  /// It is an [InputDecorator] wearing [AppFieldDecoration.of] rather than a
  /// hand-rolled `Container`, so it IS the text fields' skin instead of merely
  /// resembling it.
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
        decoration: AppFieldDecoration.of(context),
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

  /// What the user typed in the amount field, as money that knows what it is —
  /// or null when it is not an amount (empty, not a number, below zero).
  ///
  /// 🔴 THE ROW IS ENTERED IN THE USER'S CHOSEN CURRENCY AND IT KEEPS IT. An
  /// add takes the currency from [SubscriptionsController.newRowCurrencyCode]
  /// — the controller WRITES rows, so "which currency a new row is created in"
  /// is its question. An edit keeps the row's own currency: re-stating an
  /// amount is not a currency change.
  ///
  /// ⚠️ AND IT LIVES DOWN HERE, BELOW THE FIELDS, ON PURPOSE.
  /// `store/android-play/data-safety.json` cites the LINE NUMBER of the name
  /// field's `_input(...)` as the evidence for its free-text declaration, and
  /// `assert-sworn-store-files.mjs` re-measures that citation on every run.
  Money? _enteredPrice() {
    final String code =
        widget.editing?.price.currencyCode ??
        ref.read(subscriptionsControllerProvider.notifier).newRowCurrencyCode;
    try {
      final Money? m = Money.tryParseMajor(_price.text.trim(), code);
      return m == null || m.minorUnits < 0 ? null : m;
    } on Object {
      // `num.tryParse` accepts "Infinity" and "NaN", and a non-finite amount
      // cannot become minor units. It is not an amount, so it is an error.
      return null;
    }
  }

  /// The category, chosen from [_categories].
  ///
  /// A dropdown rather than a row of chips: eleven chips would add eleven tap
  /// targets to a sheet already capped in height, and the vocabulary is closed,
  /// so the compact control is the honest one. An edited row whose category is
  /// outside the vocabulary (one the API served) keeps it as an item, or the
  /// dropdown would have no item for its own value.
  Widget _categoryField() {
    final ThemeData theme = Theme.of(context);
    final TextStyle? style = AppFieldDecoration.valueStyle(context);
    final List<String> items = <String>[
      ..._categories,
      if (!_categories.contains(_category)) _category,
    ];
    return DropdownButtonFormField<String>(
      key: E2EKeys.addCategory,
      initialValue: _category,
      decoration: AppFieldDecoration.of(context),
      style: style,
      // 🔴 THE MENU IS AN OVERLAY WITH ITS OWN GROUND, AND LEFT ALONE IT PAINTS
      // `ThemeData.canvasColor` — the LIGHT surface even under the dark scheme,
      // so the dark build showed near-white items under a dark sheet. The
      // field's own fill is the slot the menu opens from.
      dropdownColor: AppCard.fillOf(theme),
      borderRadius: BorderRadius.circular(AppRadius.control),
      icon: Icon(Icons.expand_more, color: theme.colorScheme.onSurfaceVariant),
      // Without this the button shrink-wraps the widest item and the chevron
      // sits mid-field instead of at the trailing edge.
      isExpanded: true,
      items: items
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
      onChanged: _saving
          ? null
          : (String? v) => setState(() => _category = v ?? _uncategorised),
    );
  }

  /// A text field on this sheet — the name or the amount.
  ///
  /// Which one is read off the controller rather than passed, so the name
  /// field's call stays the one-line call that
  /// `store/android-play/data-safety.json` cites by line.
  Widget _input(
    TextEditingController c,
    String hint, {
    TextInputType keyboard = TextInputType.text,
    Key? fieldKey,
  }) {
    final bool isName = identical(c, _name);
    final String? error = isName ? _nameError : _priceError;
    return TextField(
      key: fieldKey,
      controller: c,
      enabled: !_saving,
      keyboardType: keyboard,
      // Next from the name, Done from the amount: the keyboard walks the form
      // in reading order and the last text field submits it.
      textInputAction: isName ? TextInputAction.next : TextInputAction.done,
      onSubmitted: isName ? null : (_) => _save(),
      // Typing clears that field's error: it was about the old text.
      onChanged: (_) {
        if (error == null) return;
        setState(() {
          if (isName) {
            _nameError = null;
          } else {
            _priceError = null;
          }
        });
      },
      style: AppFieldDecoration.valueStyle(context),
      decoration: AppFieldDecoration.of(context, hint: hint, errorText: error),
    );
  }
}
