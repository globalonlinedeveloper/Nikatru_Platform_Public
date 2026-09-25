// ─────────────────────────────────────────────────────────────────────────────
// "SIGN OUT OF ALL DEVICES", DRIVEN THROUGH THE REAL SETTINGS SCREEN.
//
// AUTH-LOGOUT-ALL (owner, 2026-09-24): a user stays signed in until they reset
// their password or sign out of all devices. The chassis `SettingsView` owns the
// tile and `packages/chassis_screens/test/settings_view_test.dart` proves a tap
// reaches `onSignOutEverywhere`. What only a stamped app can prove is the LAST
// link — that this app's adapter hands that callback a sign-out carrying the
// GLOBAL scope, through `signOutAndForgetUser`.
//
// 🔴 THE SCOPE IS THE WHOLE FEATURE. Both tiles reach `signOut` exactly once and
// both sign this device out, so an adapter that dropped `scope:` would pass
// every other assertion here while leaving every other device signed in. The
// scope list is read off the in-memory repository, which records it.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_chassis_screens/settings/settings_screen.dart'
    show SettingsView;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:{{app_id.snakeCase()}}/features/settings/settings_screen.dart';
import 'package:{{app_id.snakeCase()}}/l10n/app_localizations.dart';
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// The entitlement cache lives here. In memory because the real store reaches
/// a platform channel a widget test does not have — and a drop that threw on
/// that channel would put the FAILURE sentence on screen for a reason that has
/// nothing to do with the scope.
class _MemSecureStore implements core.SecureStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<void> delete(String key) async => data.remove(key);
  @override
  Future<void> deleteAll() async => data.clear();
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A signed-in user on the in-memory seam, and the REAL settings screen, TALL:
/// settings is a `ListView`, and a row below the fold has no element to tap.
Future<InMemoryAuthRepository> _pumpSignedInSettings(
  WidgetTester tester,
) async {
  final InMemoryAuthRepository auth = InMemoryAuthRepository();
  addTearDown(auth.dispose);
  await auth.signInWithEmail(email: 'a@b.com', password: 'pw');

  await tester.binding.setSurfaceSize(const Size(1200, 4000));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => _MemStore()),
      legalReacceptanceNeededProvider.overrideWithValue(false),
      authRepositoryProvider.overrideWithValue(auth),
      secureStoreProvider.overrideWithValue(_MemSecureStore()),
      notificationServiceProvider.overrideWithValue(
        const core.NoOpNotificationService(),
      ),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsScreen(),
      ),
    ),
  );
  // Several provider futures resolve in sequence; `pumpAndSettle` would be a
  // lie about why we are waiting.
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return auth;
}

Future<void> _tap(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

void main() {
  testWidgets('🔴 the all-devices tile signs out with the GLOBAL scope', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = await _pumpSignedInSettings(tester);

    // Parent ruling L2 (2026-09-24): the tile only ASKS; the confirm button
    // is what reaches the adapter.
    await _tap(tester, SettingsView.signOutEverywhereTile);
    expect(auth.signOutScopes, isEmpty, reason: 'one tap must not sign out');
    await _tap(tester, SettingsView.signOutEverywhereConfirm);

    expect(
      auth.signOutScopes,
      <core.SignOutScope>[core.SignOutScope.global],
      reason:
          'a dropped scope is the local default: this device signs out and '
          'every other device stays signed in',
    );
    expect(auth.currentUser, isNull, reason: 'it signs this device out too');
    final BuildContext ctx = tester.element(find.byType(SettingsScreen));
    expect(
      find.text(ChassisLocalizations.of(ctx).signOutEverywhereFailed),
      findsNothing,
      reason: 'a sign-out that worked must not be reported as one that failed',
    );
  });

  testWidgets('🔴 Cancel on the all-devices dialog signs nothing out', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = await _pumpSignedInSettings(tester);

    await _tap(tester, SettingsView.signOutEverywhereTile);
    await _tap(tester, SettingsView.signOutEverywhereCancel);

    expect(auth.signOutScopes, isEmpty, reason: 'Cancel reaches no sign-out');
    expect(auth.currentUser, isNotNull, reason: 'this device stays signed in');
  });

  testWidgets('the ordinary sign-out tile keeps the LOCAL scope', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = await _pumpSignedInSettings(tester);

    await _tap(tester, SettingsView.signOutTile);

    expect(auth.signOutScopes, <core.SignOutScope>[core.SignOutScope.local]);
  });
}
