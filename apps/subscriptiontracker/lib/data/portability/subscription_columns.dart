// ST-X1 (audit D2, D31, F35) — the CSV column map for the user's own list.
//
// 🔴 EVERY FIELD OF `Subscription`, and `test/settings_export_test.dart` holds
// the header to `Subscription.toJson()`'s keys, so a field added to the model
// without a column here fails a test instead of silently leaving the export.
// `price_minor` is the one key with no column of its own: it is the same
// amount as `price`, and the file carries the amount ONCE, as decimal major
// units beside its ISO-4217 code (`CsvCodec.moneyCells`) — never a formatted
// symbol, which a spreadsheet cannot add up and another app cannot read back.

import 'package:nikatru_core/nikatru_core.dart' as core;

import '../models/subscription.dart';

/// The header row, in file order. The names are `Subscription.toJson()`'s keys,
/// so the core import engine's synonyms read this file back without a mapping.
const List<String> kSubscriptionCsvHeader = <String>[
  'id',
  'name',
  'category',
  'price',
  'currency',
  'cycle',
  'next_renewal',
  'plan',
  'glyph',
  'used_pct',
  'usage_note',
  'unused',
  // ⏱ 2026-09-29 · ST-T3b: the ADR no.077 §5 fields, each written as
  // `Subscription.toJson()` writes it (see [_modelCells]).
  ..._kModelColumns,
];

/// The ADR no.077 §5 columns (ST-T3b), cell = the wire value, empty for null.
const List<String> _kModelColumns = <String>[
  'cycle_every',
  'cycle_unit',
  'status',
  'first_charge_on',
  'trial_ends_on',
  'cancelled_on',
  'deleted_at',
  'notes',
  'cancel_url',
];

/// [s]'s [_kModelColumns] cells, read off `toJson()` so the file and the wire
/// cannot spell a field two ways.
List<String> _modelCells(Subscription s) {
  final Map<String, dynamic> j = s.toJson();
  return <String>[for (final String k in _kModelColumns) '${j[k] ?? ''}'];
}

/// One subscription as one row, in [kSubscriptionCsvHeader] order. Cells are
/// raw strings: `CsvCodec` does the quoting and the formula neutralising.
List<String> subscriptionCsvRow(Subscription s) {
  final List<String> money = core.CsvCodec.moneyCells(s.price);
  return <String>[
    s.id,
    s.name,
    s.category,
    money[0],
    money[1],
    subscriptionCycleCell(s),
    Subscription.dateOnly(s.nextRenewal),
    s.plan,
    s.glyph,
    '${s.usedPct}',
    s.usageNote,
    '${s.unused}',
    ..._modelCells(s),
  ];
}

/// The whole list as the file the export row hands to the platform.
core.ExportFile subscriptionsCsvFile(Iterable<Subscription> subs) =>
    core.ExportFile(
      bytes: const core.CsvCodec().encodeBytes(
        kSubscriptionCsvHeader,
        subs.map(subscriptionCsvRow),
      ),
      fileName: 'subscriptions.csv',
      mimeType: core.CsvCodec.mimeType,
    );

// ── THE WAY BACK IN (ST-X2) ─────────────────────────────────────────────────
// The import engine is core's and names no field; the fields a subscription
// list is read INTO, and the synonyms other apps' exports and hand-kept sheets
// use for them, are this app's. `test/settings_export_test.dart` proves this
// app's own export maps onto them with nothing left to guess.

// The fields, each with the headers other exports use for it.
const core.ImportField _name = core.ImportField(
  'name',
  isRequired: true,
  synonyms: <String>[
    'name',
    'service',
    'subscription',
    'subscription name',
    'merchant',
    'title',
    'app',
    'vendor',
  ],
);

const core.ImportField _price = core.ImportField(
  'price',
  kind: core.ImportFieldKind.money,
  isRequired: true,
  currencyFieldId: 'currency',
  synonyms: <String>[
    'price',
    'amount',
    'cost',
    'price (major)',
    'fee',
    'charge',
    'monthly cost',
  ],
);

const core.ImportField _currency = core.ImportField(
  'currency',
  kind: core.ImportFieldKind.currencyCode,
  synonyms: <String>['currency', 'currency code', 'iso', 'ccy'],
);

const core.ImportField _cycle = core.ImportField(
  'cycle',
  kind: core.ImportFieldKind.choice,
  synonyms: <String>[
    'cycle',
    'billing cycle',
    'frequency',
    'period',
    'billing period',
    'interval',
    'recurrence',
  ],
  // Only the cycles the tracker models; anything else is a row error that
  // names these, never a silent coercion to monthly.
  choices: <String, List<String>>{
    'monthly': <String>['monthly', 'month', 'mo', 'm', 'per month', '1 month'],
    'yearly': <String>[
      'yearly',
      'year',
      'annual',
      'annually',
      'yr',
      'y',
      'per year',
      '12 months',
    ],
  },
);

const core.ImportField _nextRenewal = core.ImportField(
  'next_renewal',
  kind: core.ImportFieldKind.date,
  synonyms: <String>[
    'next renewal',
    'renewal date',
    'renews on',
    'next payment',
    'next payment date',
    'next billing date',
    'due date',
    'billing date',
    'next charge',
  ],
);

const core.ImportField _category = core.ImportField(
  'category',
  synonyms: <String>['category', 'type', 'group', 'tag'],
);

const core.ImportField _plan = core.ImportField(
  'plan',
  synonyms: <String>['plan', 'tier', 'plan name', 'package'],
);

const core.ImportField _notes = core.ImportField(
  'notes',
  synonyms: <String>['notes', 'note', 'comment', 'comments', 'description'],
);

/// Every field an import can fill, in the order a mapping screen lists them.
const List<core.ImportField> kSubscriptionImportFields = <core.ImportField>[
  _name,
  _price,
  _currency,
  _cycle,
  _nextRenewal,
  _category,
  _plan,
  _notes,
];

/// The duplicate key: one normalised name, price and cycle is one subscription.
/// The existing list's side is `core.ImportPlan.keyFor` over the same three.
final String Function(core.ImportCandidate) subscriptionImportKey =
    core.ImportPlan.keyOn(
      nameField: 'name',
      moneyField: 'price',
      choiceField: 'cycle',
    );

/// [s] under [subscriptionImportKey], for `ImportPlan.build(existingKeys:)`.
String subscriptionExistingKey(Subscription s) => core.ImportPlan.keyFor(
  name: s.name,
  price: s.price,
  cycle: subscriptionCycleCell(s),
);

/// The `cycle` cell for [s]. ⏱ 2026-09-29 · ST-T3b (ST-E4): a row's cycle is a
/// `Cadence` (every, unit), not the two-value `BillingCycle` this sheet was
/// written against. A monthly or yearly row still writes `monthly`/`yearly`
/// — the two values the import side reads back — and any other cadence
/// writes `<every> <unit>` ("2 week"), which an import refuses by name rather
/// than coercing to monthly. A row with no cadence writes an empty cell.
String subscriptionCycleCell(Subscription s) {
  final core.Cadence? c = s.cycle;
  if (c == null) return '';
  return c.legacyCycle ?? '${c.every} ${c.unit.name}';
}
