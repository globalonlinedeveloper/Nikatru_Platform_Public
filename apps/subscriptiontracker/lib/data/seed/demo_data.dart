import '../models/budget_info.dart';
import '../models/subscription.dart';

/// The exact seed set from the Subly design, so demo mode renders identically
/// to the mockup.
///
/// 🔴 EVERY AMOUNT IS AN INTEGER COUNT OF MINOR UNITS UNDER [demoCurrency],
/// not a decimal. The figures are the mockup's to the cent; what changed is
/// that a demo row now says what unit it is in, exactly as a real one does —
/// so the demo exercises the same code path a real user's data does rather
/// than a currency-free one that could hide a defect.
class DemoData {
  DemoData._();

  /// The design's own currency. The demo set is deliberately single-currency:
  /// it has to render identically to the mockup, and a mixed set would be a
  /// different screen. The MIXED case is exercised by the tests instead.
  static const String demoCurrency = 'USD';

  /// ⏱ 2026-09-28 · ST-T3b (ST-E1). Every demo row carries a first charge
  /// four cycles before its stored renewal, so the payment history the seed
  /// client DERIVES from it (`SeedApiClient.getPaymentHistory`, by the
  /// platform's renewal rule) is a real sequence of charge dates — it used to
  /// be four monthly rows fabricated for every row, yearly ones included.
  static List<Subscription> subscriptions() =>
      _rows().map(_withFirstCharge).toList();

  static Subscription _withFirstCharge(Subscription s) {
    // Four cycles before the row's NEXT REAL charge, so the derived history is
    // exactly the four most recent charges on any day the demo is opened —
    // the length the detail layout (and its a11y sweeps) was measured at.
    final Cadence c = s.billingCadence;
    final DateTime next = s.nextCharge(DateTime.now());
    final int months = c.unit == CycleUnit.year ? c.every * 48 : c.every * 4;
    final DateTime month = DateTime(next.year, next.month - months, 1);
    final int last = DateTime(month.year, month.month + 1, 0).day;
    final DateTime first = DateTime(
      month.year,
      month.month,
      next.day < last ? next.day : last,
    );
    return s.patched(<String, dynamic>{
      'first_charge_on': Subscription.dateOnly(first),
    });
  }

  static List<Subscription> _rows() => <Subscription>[
    Subscription(
      id: '1',
      name: 'Netflix',
      category: 'Streaming',
      price: Money(1549, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 7, 22),
      plan: 'Premium 4K',
      glyph: 'NFX',
      usedPct: 78,
      usageNote: 'Watched 14 hrs this month.',
    ),
    Subscription(
      id: '2',
      name: 'Spotify',
      category: 'Music',
      price: Money(1199, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 7, 19),
      plan: 'Premium',
      glyph: 'SPT',
      usedPct: 92,
      usageNote: 'Streamed almost daily.',
    ),
    Subscription(
      id: '3',
      name: 'ChatGPT Plus',
      category: 'AI tools',
      price: Money(2000, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 7, 20),
      plan: 'Plus',
      glyph: 'GPT',
      usedPct: 88,
      usageNote: 'Used most workdays.',
    ),
    Subscription(
      id: '4',
      name: 'iCloud+',
      category: 'Cloud',
      price: Money(299, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 7, 25),
      plan: '200 GB',
      glyph: 'ICL',
      usedPct: 64,
      usageNote: 'Storage 61% full.',
    ),
    Subscription(
      id: '5',
      name: 'GitHub Copilot',
      category: 'Developer',
      price: Money(1000, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 7, 24),
      plan: 'Individual',
      glyph: 'CPL',
      usedPct: 70,
      usageNote: 'Active in editor daily.',
    ),
    Subscription(
      id: '6',
      name: 'Adobe CC',
      category: 'Creative',
      price: Money(5999, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 7, 28),
      plan: 'All apps',
      glyph: 'ADB',
      usedPct: 8,
      usageNote: 'Not opened in 47 days.',
      unused: true,
    ),
    Subscription(
      id: '7',
      name: 'Disney+',
      category: 'Streaming',
      price: Money(1399, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 8, 3),
      plan: 'Standard',
      glyph: 'DIS',
      usedPct: 6,
      usageNote: 'Not opened in 61 days.',
      unused: true,
    ),
    Subscription(
      id: '8',
      name: 'Notion',
      category: 'Productivity',
      price: Money(1000, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 8, 1),
      plan: 'Plus',
      glyph: 'NTN',
      usedPct: 55,
      usageNote: 'Opened 12 times.',
    ),
    Subscription(
      id: '9',
      name: 'NYTimes',
      category: 'News',
      price: Money(425, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 7, 30),
      plan: 'Digital',
      glyph: 'NYT',
      usedPct: 34,
      usageNote: 'Read 5 articles.',
    ),
    Subscription(
      id: '10',
      name: 'Equinox',
      category: 'Fitness',
      price: Money(25500, demoCurrency),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 8, 1),
      plan: 'Destination',
      glyph: 'EQX',
      usedPct: 22,
      usageNote: '2 visits this month.',
      unused: true,
    ),
    Subscription(
      id: '11',
      name: 'YouTube Premium',
      category: 'Streaming',
      price: Money(13999, demoCurrency),
      cycle: BillingCycle.yearly,
      nextRenewal: DateTime(2026, 8, 10),
      plan: 'Individual (annual)',
      glyph: 'YTB',
      usedPct: 81,
      usageNote: 'Watched daily.',
    ),
    Subscription(
      id: '12',
      name: '1Password',
      category: 'Security',
      price: Money(3588, demoCurrency),
      cycle: BillingCycle.yearly,
      nextRenewal: DateTime(2026, 9, 2),
      plan: 'Individual (annual)',
      glyph: '1PW',
      usedPct: 60,
      usageNote: 'Used at every login.',
    ),
  ];

  static BudgetInfo budget() => const BudgetInfo(
    monthlyBudget: Money(32000, demoCurrency),
    categories: <BudgetCap>[
      BudgetCap('Streaming', Money(6000, demoCurrency)),
      BudgetCap('Music', Money(1500, demoCurrency)),
      BudgetCap('AI tools', Money(2500, demoCurrency)),
      BudgetCap('Creative', Money(6500, demoCurrency)),
      BudgetCap('Fitness', Money(25000, demoCurrency)),
      BudgetCap('Developer', Money(2000, demoCurrency)),
      BudgetCap('Productivity', Money(1500, demoCurrency)),
      BudgetCap('Cloud', Money(1000, demoCurrency)),
      BudgetCap('News', Money(1000, demoCurrency)),
      BudgetCap('Security', Money(500, demoCurrency)),
    ],
  );

  /// Popular quick-add options from the "Add subscription" sheet.
  static const List<List<String>> popular = <List<String>>[
    <String>['Hulu', 'HUL'],
    <String>['HBO Max', 'HBO'],
    <String>['Dropbox', 'DBX'],
    <String>['Figma', 'FIG'],
    <String>['Slack', 'SLK'],
    <String>['Audible', 'AUD'],
    <String>['Peloton', 'PEL'],
    <String>['Canva', 'CNV'],
  ];
}
