// 🔴 A MONTHLY SHARE IS NEVER PRINTED AS A CHARGE (O-MONTHLY-SHARE-SHOWN-AS-A-CHARGE).
//
// `Subscription` used to expose its normalised monthly share as a plain
// `Money`, the same type as the charge, so `money.format` took either and five
// surfaces printed the share where a user reads what leaves the account:
//
//   * Home rows: "$10.04 per year" for a $120.53-a-year plan.
//   * The Home hero pill: twelve ROUNDED twelfths ($300) for $300.53 a year.
//   * The Calendar month total: the twelfth of a yearly plan renewing that
//     month, 12x short in the month the money actually goes.
//   * Calendar and Scan rows: the share, bare or beside a cycle it is not.
//   * The cancel sheet's "/yr" figure: twelve rounded twelfths again.
//
// The share is now `MonthlyShare`, an extension type with no `implements
// Money`, so `money.format(share)` does not compile. Each surface prints
// `price` with its own cycle label, and each yearly figure is summed from the
// charges (`Subscription.yearlyCharge`, `SubMath.totalYearly`).
//
// FIXTURE: one yearly plan at $120.53 (share $10.04, since 12053 / 12 = 1004.4)
// and one monthly plan at $15.00. Both renew today, so both fall in the month
// the calendar opens on. Every expected string is composed from the same
// `MoneyFormatter` and `AppLocalizations` the screens use; none is typed in.
//
// RED CONTROL (run 2026-09-23, one site at a time): put the old expressions
// back at each fix site (`share as Money` for a row, `total.times(12)` for the
// pill, the share sum for the calendar total, the share times 12 for the cancel
// sheet) and that site's widget case goes red at all three widths. Each cast
// also turns the cast scan red; the pill and the calendar total have no cast,
// and their widget cases go red on their own.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/monthly_share.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/cancel/cancel_sheet.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/scan/scan_screen.dart';
import 'package:subscriptiontracker/features/shared/widgets.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

const MoneyFormatter _money = MoneyFormatter('en');

/// The seeded chain with only the list replaced, so budget, history and
/// entitlements keep resolving exactly as they do in every width test.
class _FixedRepository extends SubscriptionRepository {
  _FixedRepository(this._subs) : super(SeedApiClient());
  final List<Subscription> _subs;

  @override
  Future<List<Subscription>> fetchAll() async => _subs;
}

DateTime _today() {
  final DateTime now = DateTime.now();
  return DateTime(now.year, now.month, now.day);
}

Subscription _yearly({DateTime? renews}) => Subscription(
  id: 'yearly-1',
  name: 'Cloudvault',
  category: 'Storage',
  price: const Money(12053, 'USD'),
  cycle: BillingCycle.yearly,
  nextRenewal: renews ?? _today(),
);

Subscription _monthly({DateTime? renews}) => Subscription(
  id: 'monthly-1',
  name: 'Streamly',
  category: 'Streaming',
  price: const Money(1500, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: renews ?? _today(),
);

List<Subscription> _subs() => <Subscription>[_yearly(), _monthly()];

List<Override> _overrides() => <Override>[
  subscriptionRepositoryProvider.overrideWithValue(_FixedRepository(_subs())),
];

/// The yearly plan's charge, and the share that must never stand in for it.
final String _charge = _money.format(const Money(12053, 'USD'));
final String _share = _money.formatShareFigure(_yearly().monthlyShare);

/// A phone, a tablet (hero in the list column) and a desktop (hero in its own
/// aside), each tall enough that every row is built. 360 is the narrowest
/// phone the row's closing condition names, so the figure and its cycle label
/// are proven to fit there, not at a kinder 375.
const List<Size> _widths = <Size>[
  Size(360, 2400),
  Size(900, 2400),
  Size(1280, 2400),
];

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

/// Every `RowCard` that holds [name], asserted to show the charge with the
/// per-year label and never the share.
void _expectRowsShowTheCharge(String name, AppLocalizations l10n) {
  final Finder rows = find.ancestor(
    of: find.text(name),
    matching: find.byType(RowCard),
  );
  expect(rows, findsWidgets, reason: 'the yearly row did not render');
  for (final Element row in rows.evaluate()) {
    final Finder inRow = find.byElementPredicate((Element e) => e == row);
    expect(
      find.descendant(of: inRow, matching: find.text(_charge)),
      findsOneWidget,
      reason: 'a row shows what the plan charges: $_charge',
    );
    expect(
      find.descendant(of: inRow, matching: find.text(l10n.perYear)),
      findsOneWidget,
      reason: 'the charge carries its own cycle',
    );
    expect(
      find.descendant(of: inRow, matching: find.text(_share)),
      findsNothing,
      reason: '$_share is a twelfth of the charge, never the charge',
    );
  }
}

void main() {
  group('the share and the charge are different figures', () {
    test('a yearly share rounds half away from zero', () {
      expect(_share, _money.format(const Money(1004, 'USD')));
      final Subscription half = _yearly().withPrice(const Money(12006, 'USD'));
      expect(
        _money.formatShareFigure(half.monthlyShare),
        _money.format(const Money(1001, 'USD')),
      );
    });

    test('yearlyCharge is the price, or twelve monthly charges', () {
      expect(_yearly().yearlyCharge, const Money(12053, 'USD'));
      expect(_monthly().yearlyCharge, const Money(18000, 'USD'));
    });

    test('totalYearly sums the charges, not twelve rounded shares', () {
      expect(SubMath.totalYearly(_subs()).single, const Money(30053, 'USD'));
      expect(
        SubMath.totalMonthly(_subs()).times(12).single,
        const Money(30048, 'USD'),
        reason: 'the figure the hero pill used to print, 5 cents short',
      );
    });

    test('chargedInMonth takes the whole charge of each renewal in it', () {
      final List<Subscription> s = <Subscription>[
        _yearly(renews: DateTime(2026, 3, 10)),
        _monthly(renews: DateTime(2026, 3, 20)),
        _monthly(renews: DateTime(2026, 4, 1)),
      ];
      expect(
        SubMath.chargedInMonth(s, 2026, 3).single,
        const Money(13553, 'USD'),
      );
      expect(
        SubMath.chargedInMonth(s, 2026, 4).single,
        const Money(1500, 'USD'),
      );
      expect(SubMath.chargedInMonth(s, 2027, 3).isEmpty, isTrue);
    });

    test('byMonthlyDesc still orders by share, currency groups first', () {
      Subscription monthly(String id, int minor, [String code = 'USD']) =>
          Subscription(
            id: id,
            name: id,
            category: 'Other',
            price: Money(minor, code),
            cycle: BillingCycle.monthly,
            nextRenewal: DateTime(2026, 1, 1),
          );
      final List<Subscription> ordered = SubMath.byMonthlyDesc(<Subscription>[
        monthly('inr', 99900, 'INR'),
        monthly('below', 1003),
        _yearly(),
        monthly('above', 1005),
      ]);
      expect(ordered.map((Subscription x) => x.id).toList(), <String>[
        'inr',
        'above',
        'yearly-1',
        'below',
      ]);
    });
  });

  group('Home rows and the hero print charges', () {
    for (final Size size in _widths) {
      testWidgets('at ${size.width.toInt()}', (WidgetTester tester) async {
        await pumpAt(tester, size, const HomeScreen(), overrides: _overrides());
        final AppLocalizations l10n = await _en();

        _expectRowsShowTheCharge(_yearly().name, l10n);
        expect(
          find.text(
            l10n.perYearTotal(
              _money.formatBagRounded(
                MoneyBag.sum(const <Money>[
                  Money(12053, 'USD'),
                  Money(18000, 'USD'),
                ]),
              ),
            ),
          ),
          findsOneWidget,
          reason: 'the pill sums the yearly charges: 300.53 rounds to 301',
        );
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('the Calendar month total is what leaves the account', () {
    for (final Size size in _widths) {
      testWidgets('at ${size.width.toInt()}', (WidgetTester tester) async {
        await pumpAt(
          tester,
          size,
          const CalendarScreen(),
          overrides: _overrides(),
        );
        final AppLocalizations l10n = await _en();
        final String total = _money.formatBag(
          MoneyBag.sum(const <Money>[Money(12053, 'USD'), Money(1500, 'USD')]),
        );

        expect(
          find.textContaining(total),
          findsWidgets,
          reason: 'both renewals fall this month: $total, not a twelfth',
        );
        expect(find.text(_charge), findsWidgets);
        expect(find.text(l10n.perYear), findsWidgets);
        expect(find.text(_share), findsNothing);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('Scan results print charges', () {
    for (final Size size in _widths) {
      testWidgets('at ${size.width.toInt()}', (WidgetTester tester) async {
        await pumpAt(tester, size, const ScanScreen(), overrides: _overrides());
        // Past the 560 ms dwell of every step; see `width_scan_test.dart`.
        for (int i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 560));
        }
        final AppLocalizations l10n = await _en();

        expect(
          find.text(l10n.scanResultsHeading),
          findsOneWidget,
          reason: 'the phase sentinel: the results list is built',
        );
        _expectRowsShowTheCharge(_yearly().name, l10n);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('the cancel sheet', () {
    for (final Size size in _widths) {
      testWidgets('at ${size.width.toInt()} says the plan\'s own yearly '
          'charge', (WidgetTester tester) async {
        await setSurface(tester, size);
        await tester.pumpWidget(
          ProviderScope(
            overrides: defaultWidthOverrides(),
            child: MaterialApp(
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: Scaffold(
                body: Builder(
                  builder: (BuildContext context) => Center(
                    child: TextButton(
                      onPressed: () => showCancelSheet(context, _yearly()),
                      child: const Text('open'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        final AppLocalizations l10n = await _en();
        final Subscription s = _yearly();

        final String sentence = l10n.cancelStep1Body(
          _share,
          _money.formatRounded(const Money(12053, 'USD')),
          DateFormat.MMMMd(l10n.localeName).format(s.nextRenewal),
        );
        expect(
          find.textContaining(sentence),
          findsOneWidget,
          reason:
              'the "/mo" slot takes the share and the "/yr" slot the yearly '
              'charge, rounded: $sentence',
        );
        expect(
          find.textContaining(
            l10n.cancelStep1Body(
              _share,
              _money.formatRounded(const Money(12048, 'USD')),
              DateFormat.MMMMd(l10n.localeName).format(s.nextRenewal),
            ),
          ),
          findsNothing,
          reason: 'twelve rounded twelfths are not the yearly charge',
        );
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('the share stays unprintable', () {
    List<File> libSources() => Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((File f) => f.path.endsWith('.dart'))
        .toList();

    String rel(File f) => f.path.replaceAll(r'\', '/');

    test('nothing in lib/ casts to Money', () {
      final List<String> casts = <String>[
        for (final File f in libSources())
          if (RegExp(r'\bas\s+Money\b').hasMatch(f.readAsStringSync())) rel(f),
      ];
      expect(
        casts,
        isEmpty,
        reason:
            '`share as Money` compiles (an extension type casts to its '
            'representation) and is the one way back to printing a share as '
            'a charge',
      );
    });

    test('formatShareFigure has exactly the callers it documents', () {
      final List<String> callers = <String>[
        for (final File f in libSources())
          if (f.readAsStringSync().contains('formatShareFigure(')) rel(f),
      ]..sort();
      expect(callers, <String>[
        'lib/core/format/monthly_share.dart',
        'lib/features/cancel/cancel_sheet.dart',
      ]);
    });

    test('the old Money-typed getter is gone', () {
      final List<String> hits = <String>[
        for (final File f in libSources())
          if (f.readAsStringSync().contains('monthlyPrice')) rel(f),
      ];
      expect(hits, isEmpty);
    });
  });
}
