import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';

/// [pipeline C-7] The six-platform matrix, exercisable for every row.
void main() {
  const List<TargetPlatform> all = <TargetPlatform>[
    TargetPlatform.android,
    TargetPlatform.iOS,
    TargetPlatform.macOS,
    TargetPlatform.windows,
    TargetPlatform.linux,
    TargetPlatform.fuchsia,
  ];

  test('every platform has a declared row, web included', () {
    for (final TargetPlatform p in all) {
      expect(AuthCapabilities.forPlatform(p, isWeb: false), isNotNull);
    }
    expect(
      AuthCapabilities.forPlatform(TargetPlatform.android, isWeb: true),
      isNotNull,
    );
  });

  test('email/password is pure REST and works on every real target', () {
    for (final TargetPlatform p in all) {
      expect(
        AuthCapabilities.forPlatform(p, isWeb: false).emailPassword,
        isTrue,
        reason: '$p lost email sign-in',
      );
    }
  });

  // 🔒 THE CLAIM THAT WAS FALSE. Checked against pub.dev 2026-07-28: app_links
  // 7.2.1 supports all six platforms, Linux included. Carrying Linux as
  // unsupported would have written a real capability out of the portfolio —
  // so a Linux build that REGISTERS the callback reports the door open.
  test('Linux SUPPORTS deep links — the contrary claim was false', () {
    final AuthCapabilities linux = AuthCapabilities.forPlatform(
      TargetPlatform.linux,
      isWeb: false,
      registeredCallbacks: const <TargetPlatform>{TargetPlatform.linux},
    );
    expect(linux.oauthRedirect, isTrue);
    expect(linux.note, contains('Deep links ARE supported'));
  });

  // 🔴 ⏱ 2026-09-23 — "THE PLATFORM CAN" IS NOT "THIS APP DOES". Every native
  // row used to say oauthRedirect: true while no native target registered a
  // scheme, so the login screen offered an OAuth door that could not bring the
  // user back. A target the app has not registered is a closed door.
  test('a native target WITHOUT a registered callback reports no OAuth door',
      () {
    for (final TargetPlatform p in <TargetPlatform>[
      TargetPlatform.android,
      TargetPlatform.iOS,
      TargetPlatform.macOS,
      TargetPlatform.windows,
      TargetPlatform.linux,
    ]) {
      expect(
        AuthCapabilities.forPlatform(p, isWeb: false).oauthRedirect,
        isFalse,
        reason: '$p registered nothing, so an OAuth hop cannot return to it',
      );
      // Registering a DIFFERENT target does not open this one.
      final TargetPlatform other = p == TargetPlatform.android
          ? TargetPlatform.iOS
          : TargetPlatform.android;
      expect(
        AuthCapabilities.forPlatform(
          p,
          isWeb: false,
          registeredCallbacks: <TargetPlatform>{other},
        ).oauthRedirect,
        isFalse,
        reason: "$p is not in the registered set; $other's registration is "
            "not $p's",
      );
    }
  });

  test('a native target WITH a registered callback reports the door open', () {
    const Set<TargetPlatform> all5 = <TargetPlatform>{
      TargetPlatform.android,
      TargetPlatform.iOS,
      TargetPlatform.macOS,
      TargetPlatform.windows,
      TargetPlatform.linux,
    };
    for (final TargetPlatform p in all5) {
      expect(
        AuthCapabilities.forPlatform(
          p,
          isWeb: false,
          registeredCallbacks: all5,
        ).oauthRedirect,
        isTrue,
        reason: '$p registers the scheme',
      );
    }
    // Fuchsia is not a target: naming it registers nothing.
    expect(
      AuthCapabilities.forPlatform(
        TargetPlatform.fuchsia,
        isWeb: false,
        registeredCallbacks: const <TargetPlatform>{TargetPlatform.fuchsia},
      ).oauthRedirect,
      isFalse,
    );
  });

  // The page IS the callback on web: nothing to register, door open.
  test('web needs no registration', () {
    expect(
      AuthCapabilities.forPlatform(TargetPlatform.linux, isWeb: true)
          .oauthRedirect,
      isTrue,
    );
  });

  // ⚠️ Web is the platform to watch, not Linux.
  test('web declares BOTH of its traps', () {
    final AuthCapabilities web = AuthCapabilities.forPlatform(
      TargetPlatform.android,
      isWeb: true,
    );
    // A page has no OS keychain.
    expect(web.secureSessionStorage, isFalse);
    // The token arrives in the FRAGMENT — query parsing fails silently.
    expect(web.note, contains('FRAGMENT'));
    // Popups break in embedded webviews and standalone PWAs.
    expect(web.note.toLowerCase(), contains('popup'));
  });

  test('every desktop platform names its callback requirement', () {
    for (final TargetPlatform p in <TargetPlatform>[
      TargetPlatform.windows,
      TargetPlatform.linux,
      TargetPlatform.macOS,
    ]) {
      expect(
        AuthCapabilities.forPlatform(p, isWeb: false).note,
        isNotEmpty,
        reason: '$p needs a registered URI scheme and does not say so',
      );
    }
  });

  test('current() resolves without throwing on the host', () {
    expect(AuthCapabilities.current(), isNotNull);
  });
}
