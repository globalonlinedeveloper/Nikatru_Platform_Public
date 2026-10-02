// ListControls — HO-03, the shared half. Red controls: typing filters, the
// sort is stable, and every filter chip is a NAMED TOGGLE BUTTON.
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

enum _Sort { name, price }

enum _Filter { paused, yearly }

class _Row {
  const _Row(this.name, this.price, {this.paused = false});
  final String name;
  final int price;
  final bool paused;
}

const List<_Row> _rows = <_Row>[
  _Row('Netflix', 649),
  _Row('Spotify', 119, paused: true),
  _Row('Internet', 999),
  _Row('Notion', 649),
  _Row('Audible', 199, paused: true),
];

/// The widget wired the way an app wires it: state above, [ListControls.apply]
/// below, the rows rendered as plain text so the test reads what is shown.
class _Harness extends StatefulWidget {
  const _Harness();

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  String query = '';
  _Sort sort = _Sort.name;
  final Set<_Filter> on = <_Filter>{};

  @override
  Widget build(BuildContext context) {
    final List<_Row> shown = ListControls.apply<_Row>(
      _rows,
      query: query,
      matches: (_Row r, String q) =>
          ListControls.anyFieldContains(<String>[r.name], q),
      filters: <bool Function(_Row)>[
        if (on.contains(_Filter.paused)) (_Row r) => r.paused,
      ],
      compare: sort == _Sort.name
          ? (_Row a, _Row b) => a.name.compareTo(b.name)
          : (_Row a, _Row b) => a.price.compareTo(b.price),
    );
    return Column(
      children: <Widget>[
        ListControls<_Sort, _Filter>(
          searchLabel: 'Search subscriptions',
          clearSearchLabel: 'Clear search',
          query: query,
          onQueryChanged: (String q) => setState(() => query = q),
          sortLabel: 'Sort',
          sortOptions: const <ListSortOption<_Sort>>[
            ListSortOption<_Sort>(value: _Sort.name, label: 'Name'),
            ListSortOption<_Sort>(value: _Sort.price, label: 'Price'),
          ],
          sort: sort,
          onSortChanged: (_Sort s) => setState(() => sort = s),
          filters: const <ListFilterOption<_Filter>>[
            ListFilterOption<_Filter>(value: _Filter.paused, label: 'Paused'),
            ListFilterOption<_Filter>(value: _Filter.yearly, label: 'Yearly'),
          ],
          selectedFilters: on,
          onFilterToggled: (_Filter f) =>
              setState(() => on.contains(f) ? on.remove(f) : on.add(f)),
        ),
        for (final _Row r in shown) Text('row:${r.name}'),
      ],
    );
  }
}

Future<void> _pump(WidgetTester tester) => tester.pumpWidget(
  MaterialApp(
    theme: buildAppTheme(seed: const Color(0xFF6459F5)),
    home: const Scaffold(body: _Harness()),
  ),
);

List<String> _shown(WidgetTester tester) => tester
    .widgetList<Text>(find.textContaining('row:'))
    .map((Text t) => t.data!.substring(4))
    .toList();

void main() {
  testWidgets('typing filters the rows, case-folded, and clear restores', (
    WidgetTester tester,
  ) async {
    await _pump(tester);
    expect(_shown(tester), hasLength(5));

    await tester.enterText(find.byType(TextField), 'NET');
    await tester.pump();
    expect(_shown(tester), <String>['Internet', 'Netflix']);

    await tester.tap(find.byTooltip('Clear search'));
    await tester.pump();
    expect(_shown(tester), hasLength(5));
    expect(find.byTooltip('Clear search'), findsNothing);
  });

  test('the sort is STABLE: rows the comparator ties keep input order', () {
    final List<_Row> byPrice = ListControls.apply<_Row>(
      _rows,
      compare: (_Row a, _Row b) => a.price.compareTo(b.price),
    );
    // Netflix and Notion both cost 649, and Netflix came first.
    expect(byPrice.map((_Row r) => r.name), <String>[
      'Spotify',
      'Audible',
      'Netflix',
      'Notion',
      'Internet',
    ]);
    final List<_Row> reversedInput = ListControls.apply<_Row>(
      _rows.reversed,
      compare: (_Row a, _Row b) => a.price.compareTo(b.price),
    );
    expect(
      reversedInput.where((_Row r) => r.price == 649).map((_Row r) => r.name),
      <String>['Notion', 'Netflix'],
    );
  });

  testWidgets('the sort menu changes the order and names the order on', (
    WidgetTester tester,
  ) async {
    await _pump(tester);
    expect(find.byTooltip('Sort: Name'), findsOneWidget);
    await tester.tap(find.byTooltip('Sort: Name'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(CheckedPopupMenuItem<_Sort>, 'Price'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Sort: Price'), findsOneWidget);
    expect(_shown(tester).first, 'Spotify');
  });

  testWidgets('every filter chip is a named toggle button that toggles', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await _pump(tester);

    final Finder paused = find.bySemanticsLabel('Paused');
    expect(paused, findsOneWidget);
    SemanticsNode node = tester.getSemantics(paused);
    SemanticsData data = node.getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.flagsCollection.isToggled, Tristate.isFalse);
    expect(data.hasAction(SemanticsAction.tap), isTrue);
    expect(data.label, 'Paused', reason: 'the name is the label alone');

    await tester.tap(find.byType(FilterChip).first);
    await tester.pump();
    expect(_shown(tester), <String>['Audible', 'Spotify']);
    node = tester.getSemantics(paused);
    data = node.getSemanticsData();
    expect(data.flagsCollection.isToggled, Tristate.isTrue);

    expect(find.bySemanticsLabel('Yearly'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the search field takes a focus node the app owns', (
    WidgetTester tester,
  ) async {
    final FocusNode focus = FocusNode();
    addTearDown(focus.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListControls<_Sort, _Filter>(
            searchLabel: 'Search',
            query: '',
            onQueryChanged: (_) {},
            searchFocusNode: focus,
            sortLabel: 'Sort',
            sortOptions: const <ListSortOption<_Sort>>[
              ListSortOption<_Sort>(value: _Sort.name, label: 'Name'),
            ],
            sort: _Sort.name,
            onSortChanged: (_) {},
          ),
        ),
      ),
    );
    expect(find.byType(FilterChip), findsNothing, reason: 'no filters, no row');
    focus.requestFocus();
    await tester.pump();
    expect(focus.hasFocus, isTrue);
  });

  testWidgets('a filter toggle is a named toggle button that shows the chips', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    bool open = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (BuildContext context, StateSetter set) =>
                ListControls<_Sort, _Filter>(
                  searchLabel: 'Search',
                  query: '',
                  onQueryChanged: (_) {},
                  sortLabel: 'Sort',
                  sortOptions: const <ListSortOption<_Sort>>[
                    ListSortOption<_Sort>(value: _Sort.name, label: 'Name'),
                  ],
                  sort: _Sort.name,
                  onSortChanged: (_) {},
                  filters: const <ListFilterOption<_Filter>>[
                    ListFilterOption<_Filter>(
                      value: _Filter.paused,
                      label: 'Paused',
                    ),
                  ],
                  onFilterToggled: (_) {},
                  filterLabel: 'Filter',
                  filtersOpen: open,
                  onFiltersOpenChanged: (bool v) => set(() => open = v),
                ),
          ),
        ),
      ),
    );
    expect(find.byType(FilterChip), findsNothing);
    SemanticsData data = tester
        .getSemantics(find.bySemanticsLabel('Filter'))
        .getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.flagsCollection.isToggled, Tristate.isFalse);

    await tester.tap(find.byTooltip('Filter'));
    await tester.pump();
    expect(find.byType(FilterChip), findsOneWidget);
    data = tester
        .getSemantics(find.bySemanticsLabel('Filter'))
        .getSemanticsData();
    expect(data.flagsCollection.isToggled, Tristate.isTrue);

    // The sort is a NAMED button too, saying which order is on.
    final SemanticsData sort = tester
        .getSemantics(find.bySemanticsLabel('Sort: Name'))
        .getSemanticsData();
    expect(sort.flagsCollection.isButton, isTrue);
    expect(sort.hasAction(SemanticsAction.tap), isTrue);
    handle.dispose();
  });
}
