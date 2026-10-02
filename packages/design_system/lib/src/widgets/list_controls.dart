import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';

/// One way a list can be ordered — a [value] the app sorts by and the
/// [label] the sort menu shows for it.
class ListSortOption<S> {
  const ListSortOption({required this.value, required this.label});

  /// What the app's comparator switches on.
  final S value;

  /// The menu item's words, and the sort button's while it is chosen.
  final String label;
}

/// One filter chip — a [value] the app's predicate reads and its [label].
class ListFilterOption<F> {
  const ListFilterOption({required this.value, required this.label});

  /// What the app's predicate switches on.
  final F value;

  /// The chip's words. It is also its accessible NAME: a chip is a toggle
  /// button, and "Paused, toggled on" is the whole announcement.
  final String label;
}

/// Search, sort and filter for a list — HO-03, the shared half.
///
/// 🔴 THE WIDGET OWNS NO LIST. It draws the three controls and reports what
/// the user chose; the app holds the query, the sort and the selected filters
/// and decides what "matches" means for its own rows. [ListControls.apply] is
/// the one pure fold that turns those three into the rows to show, so every
/// app filters and sorts the same way — stably — and a widget test can drive
/// it without a widget.
///
/// Keyboard and screen reader complete, by construction:
///
/// * the search is a real [TextField] named by [searchLabel], and a
///   [searchFocusNode] the app owns lets a shell shortcut (/, Ctrl/⌘+F) focus
///   it; its clear button appears only while there is text to clear;
/// * the sort is a [PopupMenuButton] — focusable, Enter/Space opens it, the
///   arrow keys walk it — whose name says which order is on;
/// * every filter is a TOGGLE BUTTON node: `button`, `toggled` and its own
///   label, with the tap as its action, so a screen reader reads
///   "Paused, toggle button, not checked" rather than a bare chip.
///
/// Colours, type and spacing come from the theme and the shared tokens; this
/// file adds no constant of its own.
class ListControls<S, F> extends StatelessWidget {
  const ListControls({
    super.key,
    required this.searchLabel,
    required this.query,
    required this.onQueryChanged,
    required this.sortLabel,
    required this.sortOptions,
    required this.sort,
    required this.onSortChanged,
    this.clearSearchLabel,
    this.searchController,
    this.searchFocusNode,
    this.filters = const <Never>[],
    this.selectedFilters = const <Never>{},
    this.onFilterToggled,
    this.searchFieldKey,
    this.sortButtonKey,
    this.filterLabel,
    this.filtersOpen = true,
    this.onFiltersOpenChanged,
    this.filterButtonKey,
  });

  /// The field's hint and accessible name ("Search subscriptions").
  final String searchLabel;

  /// The query now; drives the clear button.
  final String query;

  /// Called on every keystroke with the whole query.
  final ValueChanged<String> onQueryChanged;

  /// The clear button's name; null draws no clear button.
  final String? clearSearchLabel;

  /// The field's controller — the app's, so a clear or a restore is the app's.
  final TextEditingController? searchController;

  /// The field's focus — the app's, so a shortcut can focus it.
  final FocusNode? searchFocusNode;

  /// The sort button's name ("Sort"); the chosen order is read after it.
  final String sortLabel;

  /// Every order offered, in menu order.
  final List<ListSortOption<S>> sortOptions;

  /// The order on now.
  final S sort;

  /// Called with the order the user picked.
  final ValueChanged<S> onSortChanged;

  /// Every filter chip, in display order. Empty draws no chip row.
  final List<ListFilterOption<F>> filters;

  /// The chips that are on.
  final Set<F> selectedFilters;

  /// Called with the chip the user toggled.
  final ValueChanged<F>? onFilterToggled;

  /// Keys for a test or an E2E driver to find the field and the sort button.
  final Key? searchFieldKey;

  /// See [searchFieldKey].
  final Key? sortButtonKey;

  /// The filter toggle's name ("Filter"). Non-null draws a toggle button
  /// beside the sort, and the chips show only while [filtersOpen]; null draws
  /// the chips always.
  ///
  /// 🔴 WHY THE CHIPS FOLD AWAY: a list with a dozen categories wraps three
  /// rows of chips above its first row, and on a phone that pushed every row
  /// below the fold. The app owns [filtersOpen] (as it owns every other state
  /// here) and keeps it open while any chip is on, so a filter in force is
  /// never hidden.
  final String? filterLabel;

  /// Whether the chips show; read only when [filterLabel] is set.
  final bool filtersOpen;

  /// Called when the user opens or closes the chips.
  final ValueChanged<bool>? onFiltersOpenChanged;

  /// See [searchFieldKey].
  final Key? filterButtonKey;

  /// The rows to show: [items] that [matches] the trimmed, case-folded
  /// [query] and pass EVERY predicate in [filters], ordered by [compare].
  ///
  /// 🔴 STABLE. `List.sort` makes no stability promise, so two rows the
  /// comparator calls equal could swap between two builds of one list. The
  /// input position is the last key, so equal rows keep the order they came
  /// in — and the app decides that order once.
  static List<T> apply<T>(
    Iterable<T> items, {
    String query = '',
    bool Function(T item, String foldedQuery)? matches,
    Iterable<bool Function(T item)> filters = const <Never>[],
    int Function(T a, T b)? compare,
  }) {
    final String q = query.trim().toLowerCase();
    final List<bool Function(T item)> preds = filters.toList();
    final List<(int, T)> kept = <(int, T)>[];
    int i = 0;
    for (final T item in items) {
      final int at = i++;
      if (q.isNotEmpty && matches != null && !matches(item, q)) continue;
      if (!preds.every((bool Function(T) p) => p(item))) continue;
      kept.add((at, item));
    }
    kept.sort(((int, T) a, (int, T) b) {
      final int by = compare == null ? 0 : compare(a.$2, b.$2);
      return by != 0 ? by : a.$1.compareTo(b.$1);
    });
    return <T>[for (final (int, T) k in kept) k.$2];
  }

  /// Whether any of [fields] contains the already-folded [foldedQuery] — the
  /// usual [apply] `matches`, so "net" finds "Netflix" and "Internet".
  static bool anyFieldContains(Iterable<String> fields, String foldedQuery) =>
      fields.any((String f) => f.toLowerCase().contains(foldedQuery));

  String _sortName() {
    for (final ListSortOption<S> o in sortOptions) {
      if (o.value == sort) return o.label;
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String current = _sortName();
    final String? clear = clearSearchLabel;
    final String? filterName = filterLabel;
    final bool showChips =
        filters.isNotEmpty && (filterName == null || filtersOpen);
    // A transparent Material of its own: the field, the menu's ink and the
    // chips all need one, and a list body is not always inside a Scaffold.
    return Material(
      type: MaterialType.transparency,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                flex: 3,
                child: TextField(
                  key: searchFieldKey,
                  controller: searchController,
                  focusNode: searchFocusNode,
                  onChanged: onQueryChanged,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    // The hint is the field's accessible name too.
                    hintText: searchLabel,
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: (clear != null && query.isNotEmpty)
                        ? IconButton(
                            tooltip: clear,
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              searchController?.clear();
                              onQueryChanged('');
                            },
                          )
                        : null,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              // FLEXIBLE: at 200 % text the order's name gives way (an
              // ellipsis) before the row overflows; the tooltip keeps it whole.
              Flexible(
                // A NAMED BUTTON: the tooltip alone is not a name, and the
                // visible words are excluded below (the name says them).
                child: Semantics(
                  container: true,
                  button: true,
                  label: current.isEmpty ? sortLabel : '$sortLabel: $current',
                  child: PopupMenuButton<S>(
                    key: sortButtonKey,
                    tooltip: current.isEmpty
                        ? sortLabel
                        : '$sortLabel: $current',
                    initialValue: sort,
                    onSelected: onSortChanged,
                    itemBuilder: (BuildContext context) => <PopupMenuEntry<S>>[
                      for (final ListSortOption<S> o in sortOptions)
                        CheckedPopupMenuItem<S>(
                          value: o.value,
                          checked: o.value == sort,
                          child: Text(o.label),
                        ),
                    ],
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.sm,
                        vertical: AppSpacing.md,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Icon(Icons.sort, color: theme.colorScheme.onSurface),
                          const SizedBox(width: AppSpacing.xs),
                          // The words are the tooltip's too; the tooltip is the
                          // name.
                          Flexible(
                            child: ExcludeSemantics(
                              child: Text(
                                current,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.labelLarge,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              if (filterName != null && filters.isNotEmpty)
                // A TOGGLE BUTTON, named, whose state is whether the chips
                // are showing.
                Semantics(
                  container: true,
                  button: true,
                  toggled: filtersOpen,
                  label: filterName,
                  excludeSemantics: true,
                  onTap: onFiltersOpenChanged == null
                      ? null
                      : () => onFiltersOpenChanged!(!filtersOpen),
                  child: IconButton(
                    key: filterButtonKey,
                    tooltip: filterName,
                    isSelected: filtersOpen,
                    icon: const Icon(Icons.filter_list),
                    onPressed: onFiltersOpenChanged == null
                        ? null
                        : () => onFiltersOpenChanged!(!filtersOpen),
                  ),
                ),
            ],
          ),
          if (showChips) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            // A WRAP, not a scrolling row: every chip is laid out, so a
            // keyboard or a sweep reaches each one without a hidden extent.
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: <Widget>[
                for (final ListFilterOption<F> f in filters)
                  _FilterToggle(
                    label: f.label,
                    selected: selectedFilters.contains(f.value),
                    onToggle: onFilterToggled == null
                        ? null
                        : () => onFilterToggled!(f.value),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// A filter chip announced as what it is: a named toggle button.
class _FilterToggle extends StatelessWidget {
  const _FilterToggle({
    required this.label,
    required this.selected,
    required this.onToggle,
  });

  final String label;
  final bool selected;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      toggled: selected,
      enabled: onToggle != null,
      label: label,
      onTap: onToggle,
      // The chip's own node would say "selected" beside "toggled": one name,
      // one state, from here.
      excludeSemantics: true,
      child: FilterChip(
        // The 48 px target every control here meets, whatever the theme's
        // density says; the chip's visual stays its own size.
        materialTapTargetSize: MaterialTapTargetSize.padded,
        label: Text(label),
        selected: selected,
        onSelected: onToggle == null ? null : (_) => onToggle!(),
      ),
    );
  }
}
