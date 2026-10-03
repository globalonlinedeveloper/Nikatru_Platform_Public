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
/// APPEND-ONLY: a column an earlier export had never moves; a new one goes last.
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
  // ST-AD12 (0009_tags.sql): the row's labels in ONE cell, `; `-separated —
  // a spreadsheet filters on a cell, and a JSON array is not one a person
  // reads.
  'tags',
  ..._kTrialAnswerColumns,
];

/// The `tags` cell: the labels joined by `; `, empty for none.
String subscriptionTagsCell(Subscription s) => s.tags.join('; ');

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

// ⏱ 2026-10-01 · train T11 (0010): what a trial converts to, in minor units
// of this row's `currency` — the wire's own exact amount, as `toJson` writes
// it — and the user's "Still using?" answer with the server's stamp. Appended
// after `tags`, so no column an earlier export had moves.
const List<String> _kTrialAnswerColumns = <String>[
  'price_after_trial_minor',
  'still_using',
  'still_using_at',
];

/// [s]'s [columns] cells, read off `toJson()` so the file and the wire cannot
/// spell a field two ways; empty for null.
List<String> _modelCells(Subscription s, List<String> columns) {
  final Map<String, dynamic> j = s.toJson();
  return <String>[for (final String k in columns) '${j[k] ?? ''}'];
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
    ..._modelCells(s, _kModelColumns),
    subscriptionTagsCell(s),
    ..._modelCells(s, _kTrialAnswerColumns),
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

// ── OTHER TRACKERS' EXPORTS (IM-05) ─────────────────────────────────────────
// MAPPING ONLY: each preset is a header signature and the field each of its
// columns fills — no copied text, no logo, no claim of affiliation. A file is
// RECOGNISED by its header (`core.ColumnPreset.recognise`), so nobody has to
// know which app a file came from. Columns a preset does not name still go
// through the synonyms above, and the mapping step can override any of them.
//
// ⚠️ THE SIGNATURES ARE THE COLUMN NAMES THESE APPS' CSV EXPORTS ARE KNOWN TO
// CARRY AS OF 2026-10. An export that renames a column is simply not
// recognised and falls back to the synonym inference — never a wrong mapping,
// because a preset only applies when EVERY header it names is present.
// `test/import_hub_test.dart` holds each one to "every column maps".

/// The CSV exports of other subscription trackers this import recognises.
const List<core.ColumnPreset> kTrackerPresets = <core.ColumnPreset>[
  core.ColumnPreset(
    name: 'Bobby',
    fieldByHeader: <String, String>{
      'Title': 'name',
      'Price': 'price',
      'Currency': 'currency',
      'Cycle Period': 'cycle',
      'Next Bill': 'next_renewal',
      'Description': 'notes',
    },
  ),
  core.ColumnPreset(
    name: 'TrackMySubs',
    fieldByHeader: <String, String>{
      'Subscription Name': 'name',
      'Cost': 'price',
      'Currency': 'currency',
      'Billing Frequency': 'cycle',
      'Next Bill Date': 'next_renewal',
      'Category': 'category',
      'Notes': 'notes',
    },
  ),
  core.ColumnPreset(
    name: 'Subby',
    fieldByHeader: <String, String>{
      'Service': 'name',
      'Price': 'price',
      'Currency': 'currency',
      'Renewal Period': 'cycle',
      'Renewal Date': 'next_renewal',
      'Category': 'category',
    },
  ),
  core.ColumnPreset(
    name: 'Rocket Money',
    fieldByHeader: <String, String>{
      'Merchant': 'name',
      'Amount': 'price',
      'Frequency': 'cycle',
      'Next Charge Date': 'next_renewal',
      'Category': 'category',
    },
  ),
];

/// The five fields the mapping step asks about, in the order it asks.
const List<String> kImportMappedFieldIds = <String>[
  'name',
  'price',
  'currency',
  'cycle',
  'next_renewal',
];

/// Where `core.ReceiptParser` puts what it reads off a pasted receipt.
const core.ReceiptFieldIds kSubscriptionReceiptIds = core.ReceiptFieldIds(
  seller: 'name',
  amount: 'price',
  currency: 'currency',
  date: 'next_renewal',
  period: 'cycle',
);

/// One reviewed import row as a NEW subscription draft — the shape the add
/// sheet hands `addSubscription`, so an import goes through the same add route
/// and nothing else.
///
/// A date in the past (a receipt's charge date, a stale sheet) is rolled
/// forward by the row's cadence to the next renewal on or after [today]; with
/// no cadence it is kept as given. No date is today. No category is `Other`,
/// the add sheet's own fallback.
Subscription subscriptionFromCandidate(
  core.ImportCandidate c, {
  required DateTime today,
}) {
  final String name = c.text('name') ?? '';
  final core.Cadence? cadence = core.Cadence.fromLegacy(c.text('cycle'));
  final DateTime day = DateTime(today.year, today.month, today.day);
  final DateTime? given = c.date('next_renewal');
  final DateTime first = given == null
      ? day
      : DateTime(given.year, given.month, given.day);
  final DateTime next = cadence == null
      ? first
      : core.RecurrenceSchedule.nextOnOrAfter(first, cadence, day);
  final String category = (c.text('category') ?? '').trim();
  return Subscription(
    id: '',
    name: name,
    category: category.isEmpty ? 'Other' : category,
    price: c.money('price')!,
    cycle: cadence,
    nextRenewal: next,
    plan: c.text('plan') ?? '',
    glyph: Subscription.glyphFor(name),
    firstChargeOn: given == null ? null : first,
    notes: c.text('notes') ?? '',
  );
}

// ── BACKUP AND RESTORE (IM-03) ──────────────────────────────────────────────

/// The `appId` a backup is stamped with, and the only one this app restores.
const String kBackupAppId = 'subscriptiontracker';

/// The whole list as a `core.BackupEnvelope` — each row exactly as
/// `Subscription.toJson()` writes it, so a restore reads back what the wire
/// reads.
core.ExportFile subscriptionsBackupFile(
  Iterable<Subscription> subs, {
  required DateTime now,
}) => core.ExportFile(
  bytes: core.BackupEnvelope(
    appId: kBackupAppId,
    exportedAt: now,
    records: <Map<String, Object?>>[
      for (final Subscription s in subs) Map<String, Object?>.of(s.toJson()),
    ],
  ).encodeBytes(),
  fileName: 'subscriptions-backup.json',
  mimeType: core.BackupEnvelope.mimeType,
);
