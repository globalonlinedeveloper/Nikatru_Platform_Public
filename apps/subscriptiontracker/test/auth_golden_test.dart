// AUTH, PIXEL FOR PIXEL — train ST-D10.
//
// The seven auth surfaces the canvas draws (`SignIn` / `SignInDark`, `SignUp`,
// `CheckInbox`, `VerifyEmail`, `ResetPassword`, `ResetExpired`,
// `ReacceptTerms`; `DesktopSignIn` is every one of them at large), each
// photographed at one window per class — compact, medium, expanded, large —
// in light and in dark: 56 goldens under `test/goldens/`.
//
// Regenerate, after a DELIBERATE visual change only, from this app's
// directory (so its assets bundle):
//   flutter test --no-pub --update-goldens test/auth_golden_test.dart
// and review every PNG in the diff before committing it: a golden that is
// regenerated to make a red test green asserts nothing.
//
// ⚠️ LINUX ONLY, for the reason `packages/design_system/test/
// foundation_golden_test.dart` gives: glyph anti-aliasing differs by a few
// pixels on macOS and Windows, and CI — the only gate — is Linux.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/auth/check_inbox_screen.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/features/auth/reaccept_terms_screen.dart';
import 'package:subscriptiontracker/features/auth/reset_password_screen.dart';
import 'package:subscriptiontracker/features/auth/verify_email_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// The seed `lib/app.dart` builds both themes from.
const Color kSublySeed = Color(0xFF6459F5);

/// A session with an address, or none.
class _Auth extends core.AuthRepository {
  _Auth({this.user});

  final core.AuthUser? user;

  @override
  core.AuthUser? get currentUser => user;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      Stream<core.AuthUser?>.value(user);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const core.AuthUser _asha = core.AuthUser(
  id: 'u-1',
  email: 'asha.menon@example.test',
);

/// Each photographed surface: the widget, and the session it stands in.
final Map<String, (Widget, core.AuthUser?)> _surfaces =
    <String, (Widget, core.AuthUser?)>{
      'sign_in': (const LoginScreen(), null),
      'sign_up': (const LoginScreen(startInSignUp: true), null),
      'check_inbox': (
        const CheckInboxScreen(email: 'asha.menon@example.test'),
        null,
      ),
      'verify_email': (const VerifyEmailScreen(), _asha),
      'reset_password': (const ResetPasswordScreen(), _asha),
      // No session and no recovery: the dead-link branch (`ResetExpired`).
      'reset_expired': (const ResetPasswordScreen(), null),
      'reaccept_terms': (const ReacceptTermsScreen(), _asha),
    };

Future<void> _pump(
  WidgetTester tester,
  Widget screen,
  core.AuthUser? user,
  Size size,
  Brightness brightness,
) async {
  // HALF density, as the foundation and home goldens: the layout is decided in
  // logical pixels, so every class lays out as it does at 1x.
  tester.view.physicalSize = size * 0.5;
  tester.view.devicePixelRatio = 0.5;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      authRepositoryProvider.overrideWithValue(_Auth(user: user)),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed, brightness: brightness),
        home: screen,
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

void main() {
  const Map<String, Size> classes = <String, Size>{
    'compact': Size(390, 844),
    'medium': Size(700, 1000),
    'expanded': Size(1024, 900),
    'large': Size(1440, 900),
  };

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  for (final MapEntry<String, (Widget, core.AuthUser?)> s
      in _surfaces.entries) {
    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${s.key} · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          await _pump(tester, s.value.$1, s.value.$2, c.value, b);
          // The frame is the SHARED auth frame, not a screen photographed
          // before it was built: a golden of the wrong tree pins nothing.
          expect(find.byType(AuthFrame), findsOneWidget);
          expect(
            find.byKey(AuthFrame.panelKey),
            c.key == 'large' ? findsOneWidget : findsNothing,
          );
          expect(tester.takeException(), isNull);
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/auth_${s.key}_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  }
}
