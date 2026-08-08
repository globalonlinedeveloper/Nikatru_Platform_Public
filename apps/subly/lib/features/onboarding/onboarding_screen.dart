import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
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

  static const List<List<String>> _slides = <List<String>>[
    <String>[
      'Every subscription,\none clean board',
      'Add what you pay for and every renewal lands on one board.',
    ],
    <String>[
      'Never get surprised\nby a renewal',
      'A reminder arrives before each renewal, and every due date sits on one calendar.',
    ],
    <String>[
      'Cut what\nyou don’t use',
      'Mark a plan unused and Subly totals up what cancelling would save.',
    ],
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
    if (_page < _slides.length - 1) {
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
    final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
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
            child: Padding(
              padding: const EdgeInsets.fromLTRB(30, 40, 30, 30),
              child: Column(
                children: <Widget>[
                  Expanded(
                    child: PageView.builder(
                      controller: _controller,
                      itemCount: _slides.length,
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
                                          _copy(cfg, 'onboarding.${i + 1}.title', _slides[i][0]),
                                          style: AppText.display.copyWith(
                                            fontSize: 40,
                                            color: Colors.white,
                                          ),
                                        ),
                                        const SizedBox(height: 16),
                                        Text(
                                          _copy(cfg, 'onboarding.${i + 1}.body', _slides[i][1]),
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
                    children: List<Widget>.generate(_slides.length, (int i) {
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
                        child: const Text(
                          'Skip',
                          style: TextStyle(
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
                            _page < _slides.length - 1 ? 'Next' : 'Get started',
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
