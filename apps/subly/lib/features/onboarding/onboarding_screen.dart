import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../shared/widgets.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _controller = PageController();
  int _page = 0;

  static const List<List<String>> _slides = <List<String>>[
    <String>[
      'Every subscription,\none clean board',
      'Add what you pay for and every renewal lands on one board.',
    ],
    <String>[
      'See every renewal\nbefore it lands',
      'A calendar of what is due and when, across every plan you track.',
    ],
    <String>[
      'Cut what\nyou don’t use',
      'Mark a plan unused and Subly totals up what cancelling would save.',
    ],
  ];

  static const List<String> _tiles = <String>['NFX', 'SPT', 'GPT', 'DIS', 'YTB', 'ADB'];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _next() {
    if (_page < _slides.length - 1) {
      _controller.nextPage(
          duration: const Duration(milliseconds: 320), curve: Curves.easeOut);
    } else {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.onboardBg,
      body: Stack(
        children: <Widget>[
          const Positioned(top: -30, right: -40, child: _Blob(220, AppColors.accent)),
          const Positioned(bottom: 160, left: -50, child: _Blob(200, AppColors.accent2)),
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
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: <Widget>[
                            Container(
                              width: 58,
                              height: 58,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color.fromRGBO(255, 255, 255, 0.1),
                                border: Border.all(
                                    color: const Color.fromRGBO(255, 255, 255, 0.18)),
                              ),
                              child: const Text('◈',
                                  style: TextStyle(fontSize: 26, color: Colors.white)),
                            ),
                            const SizedBox(height: 30),
                            Text(_slides[i][0],
                                style: AppText.display
                                    .copyWith(fontSize: 40, color: Colors.white)),
                            const SizedBox(height: 16),
                            Text(_slides[i][1],
                                style: const TextStyle(
                                    fontFamily: 'Manrope',
                                    fontSize: 16,
                                    height: 1.6,
                                    color: Color.fromRGBO(255, 255, 255, 0.68))),
                            const SizedBox(height: 30),
                            Wrap(
                              spacing: 9,
                              runSpacing: 9,
                              children: _tiles
                                  .map((String t) => Container(
                                        width: 46,
                                        height: 46,
                                        alignment: Alignment.center,
                                        decoration: BoxDecoration(
                                          borderRadius: BorderRadius.circular(13),
                                          color: const Color.fromRGBO(255, 255, 255, 0.08),
                                          border: Border.all(
                                              color: const Color.fromRGBO(
                                                  255, 255, 255, 0.14)),
                                        ),
                                        child: Text(t,
                                            style: const TextStyle(
                                                fontFamily: 'Space Grotesk',
                                                fontWeight: FontWeight.w700,
                                                fontSize: 12,
                                                color: Color.fromRGBO(
                                                    255, 255, 255, 0.9))),
                                      ))
                                  .toList(),
                            ),
                          ],
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
                        onPressed: () => context.go('/login'),
                        style: TextButton.styleFrom(
                          foregroundColor: Colors.white,
                          backgroundColor: const Color.fromRGBO(255, 255, 255, 0.08),
                          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 16),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16)),
                        ),
                        child: const Text('Skip',
                            style: TextStyle(
                                fontFamily: 'Manrope', fontWeight: FontWeight.w700)),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton(
                          onPressed: _next,
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.accent,
                            padding: const EdgeInsets.symmetric(vertical: 17),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16)),
                          ),
                          child: Text(_page < _slides.length - 1 ? 'Next' : 'Get started',
                              style: const TextStyle(
                                  fontFamily: 'Manrope',
                                  fontWeight: FontWeight.w700,
                                  fontSize: 16)),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const Center(child: NikatruWordmark(onDark: true, height: 18)),
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
