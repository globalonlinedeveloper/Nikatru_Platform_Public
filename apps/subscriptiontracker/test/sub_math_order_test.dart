// The order of a sorted list must not depend on the order it arrived in.
//
// `SubMath.upcoming`, `byMonthlyDesc` and `categoryTotals` each sort by one
// figure (days to renewal, monthly figure, category total). When that figure
// TIES, a sort with no further key keeps the INPUT order, and the input order
// differs by target: the phone list is append order, the signed-in list is
// the API's `ORDER BY price DESC`, and ids are random uuids. So the phone and
// the tablet capture of one seed listed tied rows in two different orders.
//
// Every case below feeds ONE set of rows in TWO orders — the store seed's
// own order, and price-descending (the API's order) — and asserts the two
// outputs are identical and name-ascending. Delete the tie-break line in any
// of the three sorts and its case goes red.
import 'package:flutter_test/flutter_test.dart';

import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

/// The store seed's six rows, names and prices only (the category is not
/// read by these sorts except by `categoryTotals`, which gets its own set).
const List<(String, int)> _seed = <(String, int)>[
  ('Video streaming', 1599),
  ('Music streaming', 1099),
  ('Cloud storage', 299),
  ('AI assistant', 2000),
  ('Fitness club', 3900),
  ('News digest', 450),
];

const List<String> _nameAscending = <String>[
  'AI assistant',
  'Cloud storage',
  'Fitness club',
  'Music streaming',
  'News digest',
  'Video streaming',
];

final DateTime _now = DateTime(2026, 3, 10);

Subscription _row(
  String id,
  String name,
  int minor, {
  String category = 'Other',
  DateTime? renews,
}) => Subscription(
  id: id,
  name: name,
  category: category,
  price: Money(minor, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: renews ?? _now.add(const Duration(days: 30)),
);

/// The seed in its own order, every row renewing on ONE day, with the price
/// the seed gives it. Ids run in the REVERSE of name order so an id-first
/// tie-break could not pass for a name-first one.
List<Subscription> _seedOrder() => <Subscription>[
  for (final (String, int) r in _seed)
    _row('id-${9 - _nameAscending.indexOf(r.$1)}', r.$1, r.$2),
];

/// The same rows in the API's order: price descending.
List<Subscription> _priceDescOrder() =>
    List<Subscription>.of(_seedOrder())..sort(
      (Subscription a, Subscription b) =>
          b.price.minorUnits.compareTo(a.price.minorUnits),
    );

List<String> _names(Iterable<Subscription> s) =>
    s.map((Subscription x) => x.name).toList();

void main() {
  test('the two input orders really differ (the cases below would be vacuous '
      'otherwise)', () {
    expect(_names(_seedOrder()), isNot(_names(_priceDescOrder())));
    expect(_names(_seedOrder()), isNot(_nameAscending));
  });

  group('upcoming — rows renewing on the same day', () {
    test('two input orders give ONE output, name-ascending', () {
      final List<String> a = _names(
        SubMath.upcoming(_seedOrder(), _now, take: 6),
      );
      final List<String> b = _names(
        SubMath.upcoming(_priceDescOrder(), _now, take: 6),
      );
      expect(a, _nameAscending);
      expect(b, _nameAscending);
    });

    test('the date still decides first; the name only breaks a tie', () {
      final List<Subscription> rows = <Subscription>[
        _row('1', 'Zeta', 100, renews: _now.add(const Duration(days: 3))),
        _row('2', 'Alpha', 100, renews: _now.add(const Duration(days: 9))),
        _row('3', 'Beta', 100, renews: _now.add(const Duration(days: 3))),
      ];
      expect(_names(SubMath.upcoming(rows, _now)), <String>[
        'Beta',
        'Zeta',
        'Alpha',
      ]);
    });

    test('case-folded first, exact name second, id last', () {
      final DateTime d = _now.add(const Duration(days: 5));
      final List<Subscription> rows = <Subscription>[
        _row('b', 'news', 100, renews: d),
        _row('z', 'News', 100, renews: d),
        _row('a', 'News', 100, renews: d),
        _row('c', 'music', 100, renews: d),
      ];
      final List<Subscription> out = SubMath.upcoming(rows, _now);
      expect(
        out.map((Subscription x) => '${x.name}#${x.id}').toList(),
        <String>['music#c', 'News#a', 'News#z', 'news#b'],
      );
      expect(
        SubMath.upcoming(
          rows.reversed.toList(),
          _now,
        ).map((Subscription x) => x.id).toList(),
        out.map((Subscription x) => x.id).toList(),
      );
    });
  });

  group('byMonthlyDesc — rows with the same monthly figure', () {
    List<Subscription> flat(List<Subscription> rows) => <Subscription>[
      for (final Subscription r in rows) _row(r.id, r.name, 999),
    ];

    test('two input orders give ONE output, name-ascending', () {
      expect(_names(SubMath.byMonthlyDesc(flat(_seedOrder()))), _nameAscending);
      expect(
        _names(SubMath.byMonthlyDesc(flat(_priceDescOrder()))),
        _nameAscending,
      );
    });

    test('the amount still decides first', () {
      expect(_names(SubMath.byMonthlyDesc(_seedOrder())), <String>[
        'Fitness club',
        'AI assistant',
        'Video streaming',
        'Music streaming',
        'News digest',
        'Cloud storage',
      ]);
    });
  });

  group('categoryTotals — categories with the same total', () {
    List<Subscription> byCategory(Iterable<String> cats) => <Subscription>[
      for (final String c in cats) _row('id-$c', 'row $c', 500, category: c),
    ];

    test('two input orders give ONE output, category-name-ascending', () {
      const List<String> cats = <String>['Streaming', 'AI tools', 'News'];
      List<String> out(Iterable<String> order) => SubMath.categoryTotals(
        byCategory(order),
      ).map((CategoryTotal t) => t.name).toList();
      expect(out(cats), <String>['AI tools', 'News', 'Streaming']);
      expect(out(cats.reversed), <String>['AI tools', 'News', 'Streaming']);
    });
  });
}
