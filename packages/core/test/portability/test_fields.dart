import 'package:nikatru_core/nikatru_core.dart';

/// A TEST fixture: a recurring-charge field set for the engine's tests. Core
/// ships no field set of its own (an app's synonyms are that app's vocabulary,
/// assert-no-clone-tells); the Subscription Tracker's real one is
/// `kSubscriptionImportFields` in apps/subscriptiontracker/lib/data/portability/.
abstract final class TestFields {
  static const ImportField name = ImportField(
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

  static const ImportField price = ImportField(
    'price',
    kind: ImportFieldKind.money,
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

  static const ImportField currency = ImportField(
    'currency',
    kind: ImportFieldKind.currencyCode,
    synonyms: <String>['currency', 'currency code', 'iso', 'ccy'],
  );

  static const ImportField cycle = ImportField(
    'cycle',
    kind: ImportFieldKind.choice,
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

  static const ImportField nextRenewal = ImportField(
    'next_renewal',
    kind: ImportFieldKind.date,
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

  static const ImportField category = ImportField(
    'category',
    synonyms: <String>['category', 'type', 'group', 'tag'],
  );

  static const ImportField plan = ImportField(
    'plan',
    synonyms: <String>['plan', 'tier', 'plan name', 'package'],
  );

  static const ImportField notes = ImportField(
    'notes',
    synonyms: <String>['notes', 'note', 'comment', 'comments', 'description'],
  );

  static const List<ImportField> all = <ImportField>[
    name,
    price,
    currency,
    cycle,
    nextRenewal,
    category,
    plan,
    notes,
  ];
}

/// The duplicate key these tests use: name, price and cycle.
final String Function(ImportCandidate) testKey = ImportPlan.keyOn(
  nameField: 'name',
  moneyField: 'price',
  choiceField: 'cycle',
);
