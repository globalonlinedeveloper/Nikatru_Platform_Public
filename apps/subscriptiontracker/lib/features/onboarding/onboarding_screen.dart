import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show NotificationCapabilities;

import '../../core/windows_notification_identity.g.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../shared/widgets.dart';

/// Subly's first run — an ADAPTER over the chassis [OnboardingView] (train
/// ST-D8).
///
/// 🏗️ PIPELINE-FIRST. This file used to be the whole carousel: ~450 lines, a
/// forced-dark stage and some forty colour, size and type literals, while the
/// chassis carried a second carousel that every stamped app renders. The
/// MECHANISM — the reading cap on the whole column, the scale-safe pages, the
/// spoken "Page 2 of 3", Skip beside the primary on every page — now lives
/// once in `package:nikatru_chassis_screens`, and this adapter keeps only what
/// is Subly's: its WORDS (with the [O3] `AppConfig.copy` override), the
/// seen-flag and the hand-off to `/sign-in`, and the tile art on the first
/// page.
///
/// ⚠️ THE STAGE FOLLOWS THE THEME NOW. It was painted `AppColors.onboardBg`
/// with white-alpha literals in BOTH themes; it now takes the scheme the user
/// chose, like every other screen, and both halves are photographed in
/// `test/onboarding_golden_test.dart`.
class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key});

  /// How many slides the carousel has — a structural fact about THIS
  /// carousel (the l10n keys are numbered `subscriptiontrackerOnboarding1..3`),
  /// not a property of the copy.
  static const int slideCount = 3;

  /// ⏱ 2026-10-01 · EN-11 — the neutral frame painted while the flags hydrate.
  static const Key bootFrame = Key('onboardingBootFrame');

  /// The designed copy, from the arb.
  ///
  /// 🔴 THESE ARE `subscriptiontrackerOnboarding*`, NOT the chassis `onboarding1Title` FAMILY,
  /// and the distinction is load-bearing. The chassis keys carry the STAMPED
  /// app's generic first run ("Welcome" / "A quick tour, and then you are
  /// done"), which the brick's own `features/firstrun/onboarding_screen.dart`
  /// renders; these three carry Subly's own pitch. Overwriting the chassis keys
  /// with Subly's words would rewrite the first run of every app the factory
  /// stamps. (Subly's unrouted copy of that twin was deleted 2026-08-09 — the
  /// keys stay distinct because the CHASSIS still renders them.)
  ///
  /// ⚠️ THE EMBEDDED `\n` IS GONE ON PURPOSE (WORKORDER §1). A hard break placed
  /// for an English phrase lands mid-word in a language whose translation is
  /// longer or shorter, and at text scale 2.0 it fights the wrap the layout
  /// already does correctly. The value is now one line and the `Text` wraps it.
  ///
  /// 🔴 ST-U3 (C30) — SLIDE 2 IS CAPABILITY-AWARE. It promised "A reminder
  /// arrives before each renewal" on every platform, and web, Windows and Linux
  /// cannot schedule one ([NotificationCapabilities.canSchedule] is false
  /// there, and the app gates every reminder on it). [canSchedule] picks the
  /// sentence, so a first run promises only what that platform can deliver.
  /// Slide 3 no longer promises a "mark unused" control that does not exist.
  static List<List<String>> _slides(
    AppLocalizations l10n, {
    required bool canSchedule,
  }) => <List<String>>[
    <String>[
      l10n.subscriptiontrackerOnboarding1Title,
      l10n.subscriptiontrackerOnboarding1Body,
    ],
    <String>[
      l10n.subscriptiontrackerOnboarding2Title,
      canSchedule
          ? l10n.subscriptiontrackerOnboarding2Body
          : l10n.subscriptiontrackerOnboarding2BodyNoReminders,
    ],
    <String>[
      l10n.subscriptiontrackerOnboarding3Title,
      l10n.subscriptiontrackerOnboarding3Body,
    ],
  ];

  /// P2.6b: finishing onboarding must RECORD the fact, or the union router's
  /// gate sends the user straight back — the once-ever property the chassis
  /// test asserts. In memory first (the redirect reads it synchronously),
  /// then persisted by the controller.
  static Future<void> _finish(BuildContext context, WidgetRef ref) async {
    await ref.read(onboardingSeenProvider.notifier).set(true);
    if (!context.mounted) return;
    // The CANONICAL auth path (owner, 2026-08-09). `/login` still resolves —
    // it redirects here — but a first-run hand-off that has to be rewritten by
    // a redirect is a second answer to a settled question living in the app.
    context.go('/sign-in');
  }

  /// [O3] An override REPLACES designed copy; designed copy is the FALLBACK —
  /// never the raw key. Empty/blank overrides fall through too.
  static String _copy(core.AppConfig? cfg, String key, String fallback) {
    final String? override = cfg?.copy[key];
    return (override == null || override.trim().isEmpty) ? fallback : override;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // ⏱ 2026-10-01 · EN-11 — THE CAROUSEL ONLY FOR SOMEBODY WHO HAS NOT SEEN
    // IT. The router starts here (`initialLocation: '/onboarding'`) while the
    // "seen" flag is still coming off disk, and the gate declines to decide
    // until it lands — so a returning user saw the first run flash before
    // being moved on. Until the flag reads `false` and there is no session
    // (EN-12), this is a neutral first frame in the theme's own background,
    // the colour `web/index.html` and the native launch screens paint too.
    final bool? seen = ref.watch(onboardingSeenProvider);
    final bool signedIn = ref.watch(authRepositoryProvider).currentUser != null;
    if (seen != false || signedIn) {
      return const Scaffold(key: OnboardingScreen.bootFrame);
    }
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AppConfig? cfg = ref.watch(appConfigProvider).value;
    // The same reading of the chassis matrix home's catch-up nudge makes.
    final bool canSchedule = NotificationCapabilities.resolve(
      defaultTargetPlatform,
      isWeb: kIsWeb,
      windows: kWindowsNotificationIdentity,
    ).canSchedule;
    final List<List<String>> slides = _slides(l10n, canSchedule: canSchedule);
    return OnboardingView(
      pages: <OnboardingPage>[
        for (int i = 0; i < slideCount; i++)
          OnboardingPage(
            title: _copy(cfg, 'onboarding.${i + 1}.title', slides[i][0]),
            body: _copy(cfg, 'onboarding.${i + 1}.body', slides[i][1]),
            art: i == 0 ? const _ServiceTiles() : null,
          ),
      ],
      onFinish: () => _finish(context, ref),
      // EN-12 — the same exit as finishing: the flag is recorded and sign-in
      // opens, for a returning user on a device that has not seen this.
      onHaveAccount: () => _finish(context, ref),
      footer: NikatruWordmark(
        onDark: Theme.of(context).brightness == Brightness.dark,
        height: AppSpacing.lg,
      ),
    );
  }
}

/// The first page's picture: the services a board like this holds.
///
/// DECORATION, so it is excluded from semantics — "NFX, SPT, GPT" read aloud
/// is six meaningless syllables before the title that says what the page is.
/// Painted from theme roles and foundation tokens only.
class _ServiceTiles extends StatelessWidget {
  const _ServiceTiles();

  static const List<String> _tiles = <String>[
    'NFX',
    'SPT',
    'GPT',
    'DIS',
    'YTB',
    'ADB',
  ];

  /// A tile is one [AppSpacing.xxxl] square — the tap-target size, so the grid
  /// reads as the same family as the controls below it.
  static const double tile = AppSpacing.xxxl;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    return ExcludeSemantics(
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: <Widget>[
          for (final String t in _tiles)
            Container(
              width: tile,
              height: tile,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppRadius.control),
                color: scheme.surfaceContainerHigh,
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: Text(
                t,
                style: theme.textTheme.labelMedium?.copyWith(
                  fontFamily: BrandTokens.fontDisplay,
                  color: scheme.onSurface,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
