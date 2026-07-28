import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

/// [pipeline C-7] The matrix must cover all SIX platforms and be exercisable for
/// each — which is why `forPlatform` takes the platform rather than reading the
/// host. A matrix only evaluable on the test machine leaves five of six rows
/// permanently unexercised.
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
      expect(StorageCapabilities.forPlatform(p, isWeb: false), isNotNull);
    }
    expect(
      StorageCapabilities.forPlatform(TargetPlatform.android, isWeb: true),
      isNotNull,
    );
  });

  test('key-value storage works on all six', () {
    for (final TargetPlatform p in all) {
      expect(
        StorageCapabilities.forPlatform(p, isWeb: false).keyValueStore,
        isTrue,
        reason: '$p lost plain key-value storage',
      );
    }
  });

  // 🔴 THE ROW THIS CLASS EXISTS FOR. Linux secure storage is conditional on the
  // ENVIRONMENT — libsecret must be installed AND a Secret Service daemon must
  // be running and unlocked. Headless, kiosk and CI sessions often have neither.
  test('Linux warns that its secure store is environment-conditional', () {
    final StorageCapabilities linux = StorageCapabilities.forPlatform(
      TargetPlatform.linux,
      isWeb: false,
    );
    expect(linux.secureStore, isTrue);
    expect(linux.note, contains('libsecret'));
    expect(
      linux.note.toLowerCase(),
      contains('running'),
      reason: 'the note must say the DAEMON has to be running — "libsecret is '
          'installed" is only half the requirement, and the other half is what '
          'fails at first sign-in',
    );
  });

  // ⚠️ THE DECLARED FALLBACK on web: a secure store exists, but it is NOT
  // OS-backed. Callers that assume a keychain need to know the difference.
  test('web declares its secure store is NOT OS-backed', () {
    final StorageCapabilities web = StorageCapabilities.forPlatform(
      TargetPlatform.android,
      isWeb: true,
    );
    expect(web.secureStore, isTrue);
    expect(
      web.secureStoreIsOsBacked,
      isFalse,
      reason: 'a browser exposes no OS keychain to a page — claiming otherwise '
          'is how a token ends up treated as safer than it is',
    );
    expect(web.note, isNotEmpty);
  });

  test('isWeb takes precedence over the host platform', () {
    // A web build still reports a host TargetPlatform.
    for (final TargetPlatform p in all) {
      expect(
        StorageCapabilities.forPlatform(p, isWeb: true).secureStoreIsOsBacked,
        isFalse,
        reason: 'web reported $p as OS-backed',
      );
    }
  });

  test('every platform that differs explains why', () {
    for (final TargetPlatform p in all) {
      final StorageCapabilities c = StorageCapabilities.forPlatform(
        p,
        isWeb: false,
      );
      if (!c.secureStoreIsOsBacked || !c.secureStore) {
        expect(
          c.note,
          isNotEmpty,
          reason: '$p degrades but says nothing about why',
        );
      }
    }
  });
}
