import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';

void main() {
  test('every target has a PIN, and every row says why', () {
    for (final TargetPlatform p in TargetPlatform.values) {
      final AppLockCapabilities c = AppLockCapabilities.forPlatform(
        p,
        isWeb: false,
      );
      expect(c.pin, isTrue, reason: '$p');
      expect(c.why, isNotEmpty, reason: '$p');
    }
    final AppLockCapabilities web = AppLockCapabilities.forPlatform(
      TargetPlatform.android,
      isWeb: true,
    );
    expect(web.pin, isTrue);
    expect(web.biometric, isFalse);
  });

  test('biometric exactly where local_auth 3.x has an implementation', () {
    bool bio(TargetPlatform p) =>
        AppLockCapabilities.forPlatform(p, isWeb: false).biometric;
    expect(bio(TargetPlatform.android), isTrue);
    expect(bio(TargetPlatform.iOS), isTrue);
    expect(bio(TargetPlatform.macOS), isTrue);
    expect(bio(TargetPlatform.windows), isTrue);
    expect(bio(TargetPlatform.linux), isFalse);
    expect(bio(TargetPlatform.fuchsia), isFalse);
  });
}
