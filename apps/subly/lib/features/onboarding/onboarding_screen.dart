import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ContentPane;

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../shared/widgets.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final PageController _controller = PageController();
  int _page = 0;

  /// How many slides the carousel has.
  ///
  /// A CONSTANT rather than `_slides.length`, because the slides themselves are
  /// no longer constant: their words come from the arb, which needs a
  /// [BuildContext]. [_next] and [dispose] run outside `build`, so the count has
  /// to be knowable without one. Three is a structural fact about this carousel
  /// (three dots, three pages, `sublyOnboarding1..3`), not a property of the
  /// copy — the l10n keys are numbered, so adding a fourth is an arb change and
  /// a code change together, and the parity test in `l10n_parity_test.dart`
  /// would catch a key added in only one locale.
  static const int _slideCount = 3;

  /// The designed copy, from the arb.
  ///
  /// 🔴 THESE ARE `sublyOnboarding*`, NOT the chassis `onboarding1Title` FAMILY,
  /// and the distinction is load-bearing. The chassis keys carry the STAMPED
  /// app's generic first run ("Welcome" / "A quick tour, and then you are
  /// done"), which `features/firstrun/onboarding_screen.dart` renders; these
  /// three carry Subly's own pitch. Overwriting the chassis keys with Subly's
  /// words would rewrite the first run of every app the factory stamps.
  ///
  /// ⚠️ THE EMBEDDED `\n` IS GONE ON PURPOSE (WORKORDER §1). A hard break placed
  /// for an English phrase lands mid-word in a language whose translation is
  /// longer or shorter, and at text scale 2.0 it fights the wrap the layout
  /// already does correctly. The value is now one line and the `Text` wraps it.
  List<List<String>> _slides(AppLocalizations l10n) => <List<String>>[
    <String>[l10n.sublyOnboarding1Title, l10n.sublyOnboarding1Body],
    <String>[l10n.sublyOnboarding2Title, l10n.sublyOnboarding2Body],
    <String>[l10n.sublyOnboarding3Title, l10n.sublyOnboarding3Body],
  ];

  static const List<String> _tiles = <String>[
    'NFX',
    'SPT',
    'GPT',
    'DIS',
    'YTB',
    'ADB',
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _next() {
    if (_page < _slideCount - 1) {
      _controller.nextPage(
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOut,
      );
    } else {
      _finish();
    }
  }

  /// P2.6b: finishing onboarding must RECORD the fact, or the union router's
  /// gate sends the user straight back — the once-ever property the chassis
  /// test asserts. In memory first (the redirect reads it synchronously),
  /// then persisted by the controller.
  Future<void> _finish() async {
    await ref.read(onboardingSeenProvider.notifier).set(true);
    if (!mounted) return;
    context.go('/login');
  }

  /// [O3] An override REPLACES designed copy; designed copy is the FALLBACK —
  /// never the raw key. Empty/blank overrides fall through too.
  String _copy(core.AppConfig? cfg, String key, String fallback) {
    final String? override = cfg?.copy[key];
    return (override == null || override.trim().isEmpty) ? fallback : override;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
    final List<List<String>> slides = _slides(l10n);
    return Scaffold(
      backgroundColor: AppColors.onboardBg,
      body: Stack(
        children: <Widget>[
          const Positioned(
            top: -30,
            right: -40,
            child: _Blob(220, AppColors.accent),
          ),
          const Positioned(
            bottom: 160,
            left: -50,
            child: _Blob(200, AppColors.accent2),
          ),
          SafeArea(
            // 🔴 THE CAP, AND THE `Padding` IT ABSORBED. This was a bare
            // `Padding(fromLTRB(30, 40, 30, 30))`, so on a 1280 px window the
            // slide body ran 1220 px lines — about 200 characters against the
            // 45–75 the eye can track — and the Skip/Next row stretched from
            // one edge of the display to the other. Same defect and same fix as
            // the stamped twin (`features/firstrun/onboarding_screen.dart:138`):
            // `.reading` (720), because this is continuous PROSE and
            // [AppBreakpoints.reading] is the constant that says so.
            //
            // ⚠️ THE PADDING MOVED INSIDE THE CAP, which is what `ContentPane`'s
            // own `padding` is for. That keeps every width below 720 rendering
            // pixel-identical to before (a `ConstrainedBox` may only tighten
            // within what it was handed), and above 720 it takes the 30/30
            // gutters out of the CAP rather than out of the surface — the
            // arithmetic `test/width_onboarding_test.dart` pins.
            //
            // ⚠️ THE WHOLE COLUMN, NOT JUST THE CAROUSEL. The stamped twin caps
            // per PAGE because its dots and button live outside the PageView's
            // own padding; here the dots row, the Skip/Next row and the wordmark
            // share this Padding with the carousel, so capping only the pages
            // would leave a 720 px slide under a 1280 px button.
            //
            // ⚠️ `Align(topCenter)` HANDS THE COLUMN LOOSENED CONSTRAINTS, not
            // tight ones — and a `Column` with the default `mainAxisSize.max`
            // takes the full height it is offered, so the `Expanded` below still
            // has a bounded height to divide and the layout is unchanged
            // vertically. Only the horizontal half moved.
            child: ContentPane.reading(
              padding: const EdgeInsets.fromLTRB(30, 40, 30, 30),
              child: Column(
                children: <Widget>[
                  Expanded(
                    child: PageView.builder(
                      controller: _controller,
                      itemCount: _slideCount,
                      onPageChanged: (int i) => setState(() => _page = i),
                      itemBuilder: (BuildContext context, int i) {
                        // P2.6b: scale-safe per the chassis text-scaling
                        // invariant (clamped 1.0–2.0 at the app root). At 1.0
                        // the ConstrainedBox minHeight makes the Column fill
                        // the page, so the centring renders pixel-identical;
                        // at 2.0 the content grows past the viewport and
                        // SCROLLS instead of overflowing (measured: 359px
                        // over in an 800x600 pump). PageView pans on the
                        // horizontal axis, this scroll view on the vertical —
                        // no gesture conflict.
                        return LayoutBuilder(
                          builder:
                              (BuildContext context, BoxConstraints viewport) {
                                return SingleChildScrollView(
                                  child: ConstrainedBox(
                                    constraints: BoxConstraints(
                                      minWidth: viewport.maxWidth,
                                      minHeight: viewport.maxHeight,
                                    ),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: <Widget>[
                                        Container(
                                          width: 58,
                                          height: 58,
                                          alignment: Alignment.center,
                                          decoration: BoxDecoration(
                                            borderRadius: BorderRadius.circular(
                                              18,
                                            ),
                                            color: const Color.fromRGBO(
                                              255,
                                              255,
                                              255,
                                              0.1,
                                            ),
                                            border: Border.all(
                                              color: const Color.fromRGBO(
                                                255,
                                                255,
                                                255,
                                                0.18,
                                              ),
                                            ),
                                          ),
                                          child: const Text(
                                            '◈',
                                            style: TextStyle(
                                              fontSize: 26,
                                              color: Colors.white,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 30),
                                        Text(
                                          _copy(
                                            cfg,
                                            'onboarding.${i + 1}.title',
                                            slides[i][0],
                                          ),
                                          style: AppText.display.copyWith(
                                            fontSize: 40,
                                            color: Colors.white,
                                          ),
                                        ),
                                        const SizedBox(height: 16),
                                        Text(
                                          _copy(
                                            cfg,
                                            'onboarding.${i + 1}.body',
                                            slides[i][1],
                                          ),
                                          style: const TextStyle(
                                            fontFamily: 'Manrope',
                                            fontSize: 16,
                                            height: 1.6,
                                            color: Color.fromRGBO(
                                              255,
                                              255,
                                              255,
                                              0.68,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 30),
                                        Wrap(
                                          spacing: 9,
                                          runSpacing: 9,
                                          children: _tiles
                                              .map(
                                                (String t) => Container(
                                                  width: 46,
                                                  height: 46,
                                                  alignment: Alignment.center,
                                                  decoration: BoxDecoration(
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                          13,
                                                        ),
                                                    color: const Color.fromRGBO(
                                                      255,
                                                      255,
                                                      255,
                                                      0.08,
                                                    ),
                                                    border: Border.all(
                                                      color:
                                                          const Color.fromRGBO(
                                                            255,
                                                            255,
                                                            255,
                                                            0.14,
                                                          ),
                                                    ),
                                                  ),
                                                  child: Text(
                                                    t,
                                                    style: const TextStyle(
                                                      fontFamily:
                                                          'Space Grotesk',
                                                      fontWeight:
                                                          FontWeight.w700,
                                                      fontSize: 12,
                                                      color: Color.fromRGBO(
                                                        255,
                                                        255,
                                                        255,
                                                        0.9,
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              )
                                              .toList(),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                        );
                      },
                    ),
                  ),
                  Row(
                    children: List<Widget>.generate(_slideCount, (int i) {
                      final bool active = i == _page;
                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        margin: const EdgeInsets.only(right: 6),
                        width: active ? 24 : 7,
                        height: 6,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(6),
                          color: active
                              ? Colors.white
                              : const Color.fromRGBO(255, 255, 255, 0.3),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: <Widget>[
                      TextButton(
                        onPressed: _finish,
                        style: TextButton.styleFrom(
                          foregroundColor: Colors.white,
                          backgroundColor: const Color.fromRGBO(
                            255,
                            255,
                            255,
                            0.08,
                          ),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 22,
                            vertical: 16,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        child: Text(
                          l10n.onboardingSkip,
                          style: const TextStyle(
                            fontFamily: 'Manrope',
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton(
                          onPressed: _next,
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.accent,
                            padding: const EdgeInsets.symmetric(vertical: 17),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          child: Text(
                            _page < _slideCount - 1
                                ? l10n.onboardingNext
                                : l10n.onboardingStart,
                            style: const TextStyle(
                              fontFamily: 'Manrope',
                              fontWeight: FontWeight.w700,
                              fontSize: 16,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const Center(
                    child: NikatruWordmark(onDark: true, height: 18),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Blob extends StatelessWidget {
  const _Blob(this.size, this.color);
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        boxShadow: <BoxShadow>[
          BoxShadow(color: color, blurRadius: 60, spreadRadius: 10),
        ],
      ),
      foregroundDecoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: Color.fromRGBO(18, 17, 28, 0.35),
      ),
    );
  }
}
