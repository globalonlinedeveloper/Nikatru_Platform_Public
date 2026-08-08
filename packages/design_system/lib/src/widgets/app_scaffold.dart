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

  // ── CONTENT WIDTHS ─────────────────────────────────────────────────────────
  //
  // The four numbers above answer "WHICH NAVIGATION?". The three below answer a
  // different question — "how wide may this CONTENT get?" — and they are here
  // rather than in a second class because both are the same kind of decision:
  // a width the chassis owns so that fifty apps do not each pick one.
  //
  // 🔴 WHY THEY EXIST AT ALL. `420` was hand-copied into SIX separate widgets
  // (two design-system gates, the consent scrim, both auth screens, the
  // paywall's `480`). Six copies is not a shared decision — it is six private
  // ones that happen to agree today, and the first app that widens its sign-in
  // form leaves the other five behind with nothing red to say so. A named
  // constant makes the agreement checkable; a literal only makes it likely.

  /// A single-column FORM or short blocking card: sign-in, sign-up, the consent
  /// prompt, the update wall.
  ///
  /// 420 is roughly a phone's width plus its gutters, which is the point: a
  /// form wider than this puts the label and its field so far apart that the
  /// eye has to travel between them, and text inputs stop reading as a stack.
  /// It is also the number this repo had already converged on six times over,
  /// so adopting it changes no pixels — the change is that it is now ONE
  /// number.
  static const double form = 420;

  /// A CARD or side panel that holds more than a form but is still a component
  /// rather than a page: the paywall's plan list, a detail pane.
  ///
  /// 480 buys one more element per row than [form] (two buttons side by side,
  /// a price beside its label) without becoming a page in its own right.
  static const double pane = 480;

  /// Continuous PROSE — legal copy, release notes, help text, onboarding body.
  ///
  /// The typographic rule of thumb is 45–75 characters per line before the eye
  /// starts losing the line return; at this package's body size that lands near
  /// 720. This is the same reasoning as [kMaxBodyWidth] applied one level down:
  /// [kMaxBodyWidth] stops a whole PAGE sprawling, [reading] stops a PARAGRAPH
  /// sprawling inside a page that is legitimately wide.
  static const double reading = 720;
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
    this.compactNavigationBar,
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

  /// Replaces the default bottom [NavigationBar] in the COMPACT window class,
  /// and only there.
  ///
  /// 🔴 THIS IS THE SEAM, AND ITS NARROWNESS IS THE POINT. A branded app wants
  /// its own bottom bar — a custom shape, a centre docked action, a badge the
  /// chassis knows nothing about. Without a seam it has exactly two options:
  /// accept the stock bar, or stop using [AppScaffold] and hand-roll the whole
  /// adaptive shell. The second is what actually happens, and the app then owns
  /// the breakpoints too — so it inherits the 640-instead-of-600 class of bug
  /// privately, in a file nobody audits, fifty times over.
  ///
  /// So: the app supplies the compact BAR, the chassis keeps the DECISION about
  /// when a bar is the right control at all. Rail and drawer stay chassis-owned
  /// on purpose — they are the widths where the layout question is hard and the
  /// branding payoff is smallest, and leaving them open would let an app render
  /// a bottom bar at 1600px, which is the layout this class exists to prevent.
  ///
  /// Null (the default) keeps the stock [NavigationBar], so this costs nothing
  /// to ignore.
  final Widget? compactNavigationBar;

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
      // The app's own bar when it supplied one — see [compactNavigationBar].
      // Reached ONLY from here, so a custom bar cannot leak into the rail or
      // drawer classes.
      bottomNavigationBar: compactNavigationBar ??
          NavigationBar(
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
