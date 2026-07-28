import 'package:flutter/material.dart';

/// A single navigation destination for [AppScaffold].
@immutable
class AppDestination {
  const AppDestination({
    required this.icon,
    required this.label,
    IconData? selectedIcon,
  }) : selectedIcon = selectedIcon ?? icon;

  /// Icon shown when the destination is not selected.
  final IconData icon;

  /// Icon shown when the destination is selected (defaults to [icon]).
  final IconData selectedIcon;

  /// Human-readable label.
  final String label;
}

/// Material 3's FIVE window size classes, at their exact boundaries.
///
/// 🔴 [pipeline C-14] THIS FIXES A LIVE BUG. `medium` was **640**, which is not
/// a Material breakpoint at all — the standard's boundary is **600**. Every
/// window from 600 to 639 logical pixels therefore got the phone layout: a
/// bottom navigation bar on a device wide enough for a rail. That is a real
/// range (a small tablet in portrait, a split-screen pane, a resized desktop
/// window), and nothing in the tree said 640 was deliberate — the class doc
/// said "loosely follows Material 3", which is how a made-up number survives.
///
/// Three classes were also never five. DoD §4-C asked for five and the standard
/// defines five; the tree covered three (compact / medium / expanded).
///
/// Each boundary is the LOWER bound of its class, so the comparison is always
/// `width < X` for the class below it.
class AppBreakpoints {
  AppBreakpoints._();

  /// Phone portrait and split-screen panes. Below this → bottom [NavigationBar].
  static const double medium = 600;

  /// Small tablets, half-screen desktop. → collapsed [NavigationRail].
  static const double expanded = 840;

  /// Large tablets, ordinary desktop windows. → extended [NavigationRail].
  static const double large = 1200;

  /// Desktop maximised. → permanent [NavigationDrawer].
  static const double extraLarge = 1600;

  /// Ultra-wide. Still a drawer, but the body stops growing — see
  /// [kMaxBodyWidth]. A line of text 1400 px wide is unreadable, so "more
  /// pixels" stops meaning "wider content" somewhere, and this is where.
  static const double kMaxBodyWidth = 1280;
}

/// The five window classes, so callers (and tests) can name one rather than
/// pass a magic width.
enum WindowClass { compact, medium, expanded, large, extraLarge }

/// Resolve a width to its Material window class.
///
/// Public and pure on purpose: it makes the breakpoint set independently
/// testable at its exact edges, without pumping a widget at five sizes.
WindowClass windowClassFor(double width) {
  if (width < AppBreakpoints.medium) return WindowClass.compact;
  if (width < AppBreakpoints.expanded) return WindowClass.medium;
  if (width < AppBreakpoints.large) return WindowClass.expanded;
  if (width < AppBreakpoints.extraLarge) return WindowClass.large;
  return WindowClass.extraLarge;
}

/// Hand-rolled adaptive navigation scaffold. Chooses, by available width:
/// a bottom [NavigationBar] (compact), a side [NavigationRail] (medium) or a
/// permanent [NavigationDrawer] (expanded). Replaces the discontinued
/// `flutter_adaptive_scaffold` package with a tiny, dependency-free primitive.
class AppScaffold extends StatelessWidget {
  const AppScaffold({
    super.key,
    required this.destinations,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.body,
    this.title,
    this.floatingActionButton,
  }) : assert(destinations.length >= 2,
            'AppScaffold needs at least 2 destinations');

  /// The navigation destinations (>= 2).
  final List<AppDestination> destinations;

  /// Index of the currently selected destination.
  final int selectedIndex;

  /// Called with the tapped destination's index.
  final ValueChanged<int> onDestinationSelected;

  /// The primary content.
  final Widget body;

  /// Optional app-bar title widget.
  final Widget? title;

  /// Optional floating action button.
  final Widget? floatingActionButton;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        // Five classes, and each one must be OBSERVABLY different or the
        // requirement is unfalsifiable — a class that renders identically to its
        // neighbour is a number in a doc, not a layout.
        switch (windowClassFor(constraints.maxWidth)) {
          case WindowClass.compact:
            return _compact();
          case WindowClass.medium:
            return _rail(extended: false);
          case WindowClass.expanded:
            return _rail(extended: true);
          case WindowClass.large:
            return _drawer(capBodyWidth: false);
          case WindowClass.extraLarge:
            return _drawer(capBodyWidth: true);
        }
      },
    );
  }

  PreferredSizeWidget? _appBar() => title == null ? null : AppBar(title: title);

  // Compact: bottom NavigationBar.
  Widget _compact() {
    return Scaffold(
      appBar: _appBar(),
      body: SafeArea(child: body),
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: onDestinationSelected,
        destinations: <Widget>[
          for (final AppDestination d in destinations)
            NavigationDestination(
              icon: Icon(d.icon),
              selectedIcon: Icon(d.selectedIcon),
              label: d.label,
            ),
        ],
      ),
    );
  }

  // MEDIUM (600–839): collapsed rail. EXPANDED (840–1199): the same rail,
  // extended — labels beside the icons rather than under them, which is what
  // the extra width buys.
  Widget _rail({required bool extended}) {
    return Scaffold(
      appBar: _appBar(),
      floatingActionButton: floatingActionButton,
      body: SafeArea(
        child: Row(
          children: <Widget>[
            NavigationRail(
              selectedIndex: selectedIndex,
              onDestinationSelected: onDestinationSelected,
              extended: extended,
              // `labelType` must be null when extended — Flutter asserts on the
              // combination, and the assert only fires at the width that
              // triggers it, which is exactly the kind of thing that ships.
              labelType: extended ? null : NavigationRailLabelType.all,
              destinations: <NavigationRailDestination>[
                for (final AppDestination d in destinations)
                  NavigationRailDestination(
                    icon: Icon(d.icon),
                    selectedIcon: Icon(d.selectedIcon),
                    label: Text(d.label),
                  ),
              ],
            ),
            const VerticalDivider(width: 1, thickness: 1),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }

  // LARGE (1200–1599) and EXTRA-LARGE (>=1600): permanent NavigationDrawer.
  //
  // The two differ in one real way rather than a cosmetic one: past 1600 the
  // body stops growing. A paragraph measured 1400 px wide is genuinely hard to
  // read — the eye loses the line return — so beyond some width "more pixels"
  // must stop meaning "wider text". That is the whole reason extra-large is a
  // class of its own and not just "large, but more".
  Widget _drawer({required bool capBodyWidth}) {
    final Widget content = capBodyWidth
        ? Align(
            alignment: Alignment.topLeft,
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: AppBreakpoints.kMaxBodyWidth,
              ),
              child: body,
            ),
          )
        : body;
    return _drawerScaffold(content);
  }

  Widget _drawerScaffold(Widget content) {
    return Scaffold(
      appBar: _appBar(),
      floatingActionButton: floatingActionButton,
      body: SafeArea(
        child: Row(
          children: <Widget>[
            SizedBox(
              width: 360,
              child: NavigationDrawer(
                selectedIndex: selectedIndex,
                onDestinationSelected: onDestinationSelected,
                children: <Widget>[
                  const SizedBox(height: 12),
                  for (final AppDestination d in destinations)
                    NavigationDrawerDestination(
                      icon: Icon(d.icon),
                      selectedIcon: Icon(d.selectedIcon),
                      label: Text(d.label),
                    ),
                ],
              ),
            ),
            const VerticalDivider(width: 1, thickness: 1),
            Expanded(child: content),
          ],
        ),
      ),
    );
  }
}
