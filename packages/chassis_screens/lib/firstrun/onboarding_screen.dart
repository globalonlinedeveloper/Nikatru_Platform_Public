import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// One carousel card. The WORDS are per-app and arrive already resolved — see
/// [OnboardingView] for why the resolution stays in the adapter.
///
/// [art] is the page's picture, drawn above the title (train ST-D8). It is the
/// one per-app VISUAL slot: an app that has nothing to show passes none and
/// the page is words alone. The view never paints it with anything of its own,
/// so the app's art takes the scheme the view sits under.
@immutable
class OnboardingPage {
  const OnboardingPage({required this.title, required this.body, this.art});

  final String title;
  final String body;
  final Widget? art;
}

/// First-run onboarding — [pipeline C-13].
///
/// 🏗️ THE BODY OF `OnboardingScreen`, MOVED HERE BY [ADR 067] decision 2. The
/// brick keeps an adapter of the same name, and TWO things stayed there:
/// `onboardingSeenProvider` (Riverpod, which this package declares none of) and
/// the `AppConfig.copy` override read with its l10n fallback — which
/// `assert-config-registry.mjs` (`:947-990`) and
/// `assert-stamp-properties.mjs:1094` both anchor in the brick file by the
/// literal `_copy(cfg, 'onboarding.1.title', l10n.onboarding1Title)`.
///
/// 🔴 THE REFUSAL THIS REPLACES was "the content is app-specific", which is true
/// of the WORDS and false of the MECHANISM. `AppConfig.copy` is a runtime
/// copy-override map that already existed, so the carousel is CHASSIS and the
/// words are per-app config. Every stamped app gets a working first run without
/// writing one, and an app that has something better to say overrides three
/// strings in its config — no code, no release.
///
/// ⚠️ THE SPLASH HALF IS NOT HERE AND IS NOT COMING. A splash screen is native
/// platform configuration (a launch storyboard on iOS, a launch drawable on
/// Android); a Dart one renders AFTER the native splash has already been shown
/// and therefore adds a SECOND flash rather than removing the first. That
/// refusal survived checking and stands.
class OnboardingView extends StatefulWidget {
  const OnboardingView({
    required this.pages,
    required this.onFinish,
    this.footer,
    super.key,
  });

  /// SKIP is present on every page and equally reachable — see the control.
  static const Key skipButton = Key('onboardingSkip');

  /// "Next" on every page but the last, "Start" on the last. One key, because
  /// it is one control with two labels.
  static const Key advanceButton = Key('onboardingAdvance');

  /// The position row — ONE semantics node carrying "Page 2 of 3".
  static const Key pageIndicator = Key('onboardingPageIndicator');

  /// The dot for page [i], so a test can read which one is the long one.
  static Key dot(int i) => Key('onboardingDot$i');

  /// The dot sizes, from the spacing ladder: the current page is a pill
  /// [AppSpacing.xl] long, the rest are [AppSpacing.sm] rounds, all
  /// [dotHeight] tall.
  static const double dotActive = AppSpacing.xl;
  static const double dotIdle = AppSpacing.sm;
  static const double dotHeight = AppSpacing.sm;

  final List<OnboardingPage> pages;

  /// Called by SKIP and by the last page's primary action alike: onboarding is
  /// SEEN either way, and the flag write plus the navigation both need the
  /// adapter's `ref` and `GoRouter`.
  final VoidCallback onFinish;

  /// Drawn under the controls, centred — an app's wordmark, say (train
  /// ST-D8). Inside the reading cap with everything else.
  final Widget? footer;

  @override
  State<OnboardingView> createState() => _OnboardingViewState();
}

class _OnboardingViewState extends State<OnboardingView> {
  final PageController _pages = PageController();
  int _index = 0;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  void _advance() {
    if (_index == widget.pages.length - 1) {
      widget.onFinish();
      return;
    }
    _pages.nextPage(
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final List<OnboardingPage> pages = widget.pages;
    final bool isLast = _index == pages.length - 1;

    return Scaffold(
      body: SafeArea(
        // 🔴 THE CAP IS ON THE WHOLE COLUMN, NOT PER PAGE (train ST-D8). It
        // was per page — `ContentPane.reading` inside the `itemBuilder` — so
        // the body read at 720 on a 1280 px window while SKIP sat alone in the
        // far top-right corner and the primary button ran the full width of
        // the display, 1232 px of it. The dots, the controls and the footer
        // are part of the same reading column as the words they belong to, so
        // they share its cap. Subly's carousel measured this and capped the
        // whole column; its `width_onboarding_test.dart` "the controls below
        // the pages are capped too" is the property, and it now holds here
        // for every stamped app.
        //
        // `.reading` (720) because this is continuous PROSE. The padding stays
        // INSIDE the cap, so at any width below 720 the line length is the
        // window less the two [AppSpacing.xxl] gutters, as before.
        //
        // ⚠️ `ContentPane` aligns to topCenter and hands its child LOOSENED
        // constraints; a `Column` with the default `mainAxisSize.max` still
        // takes the full height, so the `Expanded` below has a bounded height
        // to divide.
        child: ContentPane.reading(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.xxl,
            AppSpacing.xl,
            AppSpacing.xxl,
            AppSpacing.xl,
          ),
          child: Column(
            children: <Widget>[
              Expanded(
                child: PageView.builder(
                  controller: _pages,
                  itemCount: pages.length,
                  onPageChanged: (int i) => setState(() => _index = i),
                  // SCALE-SAFE, per the chassis text-scaling invariant (1.0 to
                  // 2.0 at the app root). At 1.0 the `minHeight` makes the
                  // column fill the page, so the centring is unchanged; at 2.0
                  // the page grows past the viewport and SCROLLS instead of
                  // overflowing. The PageView pans horizontally and this scroll
                  // view vertically, so the two gestures never compete.
                  itemBuilder: (BuildContext context, int i) => LayoutBuilder(
                    builder: (BuildContext context, BoxConstraints viewport) =>
                        SingleChildScrollView(
                          child: ConstrainedBox(
                            constraints: BoxConstraints(
                              minWidth: viewport.maxWidth,
                              minHeight: viewport.maxHeight,
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                if (pages[i].art
                                    case final Widget art) ...<Widget>[
                                  art,
                                  const SizedBox(height: AppSpacing.xxl),
                                ],
                                Semantics(
                                  header: true,
                                  child: Text(
                                    pages[i].title,
                                    style: text.headlineLarge?.copyWith(
                                      color: scheme.onSurface,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.lg),
                                Text(
                                  pages[i].body,
                                  style: text.bodyLarge?.copyWith(
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              // 🔴 THE DOTS ENCODE POSITION IN WIDTH AND NOTHING ELSE, so the
              // ROW carries the position as a sentence — one node, because
              // "2 of 3" is a property of the group, and three labelled dots
              // would be three stops saying almost the same thing.
              // `container: true` so the label is not absorbed upward into the
              // page copy, where it could not be found as a position.
              Semantics(
                key: OnboardingView.pageIndicator,
                container: true,
                label: l10n.onboardingPageIndicator(_index + 1, pages.length),
                child: ExcludeSemantics(
                  child: Row(
                    children: <Widget>[
                      for (int i = 0; i < pages.length; i++)
                        AnimatedContainer(
                          key: OnboardingView.dot(i),
                          duration: const Duration(milliseconds: 250),
                          margin: const EdgeInsetsDirectional.only(
                            end: AppSpacing.xs,
                          ),
                          width: i == _index
                              ? OnboardingView.dotActive
                              : OnboardingView.dotIdle,
                          height: OnboardingView.dotHeight,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(AppRadius.pill),
                            color: i == _index
                                ? scheme.primary
                                : scheme.outlineVariant,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              // SKIP is present on every page, BESIDE the primary and as easy
              // to reach. An onboarding a user cannot leave is a wall, not an
              // introduction, and both stores treat an unskippable first run as
              // a dark pattern.
              Row(
                children: <Widget>[
                  TextButton(
                    key: OnboardingView.skipButton,
                    onPressed: widget.onFinish,
                    child: Text(l10n.onboardingSkip),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: FilledButton(
                      key: OnboardingView.advanceButton,
                      onPressed: _advance,
                      child: Text(
                        isLast ? l10n.onboardingStart : l10n.onboardingNext,
                      ),
                    ),
                  ),
                ],
              ),
              if (widget.footer case final Widget footer) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                Center(child: footer),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
