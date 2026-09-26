import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_external_links/nikatru_external_links.dart';

// [pipeline C-7] The matrix, one row per case. Each row is asserted on its own
// so a platform whose row flips cannot hide behind the others.
void main() {
  group('ExternalLinkCapabilities.forPlatform — the six targets', () {
    test('android opens https and mailto', () {
      final ExternalLinkCapabilities c = ExternalLinkCapabilities.forPlatform(
        TargetPlatform.android,
        isWeb: false,
      );
      expect(c.canOpenHttps, isTrue);
      expect(c.canOpenMailto, isTrue);
    });

    test('iOS opens https and mailto', () {
      final ExternalLinkCapabilities c = ExternalLinkCapabilities.forPlatform(
        TargetPlatform.iOS,
        isWeb: false,
      );
      expect(c.canOpenHttps, isTrue);
      expect(c.canOpenMailto, isTrue);
    });

    test('macOS opens https and mailto', () {
      final ExternalLinkCapabilities c = ExternalLinkCapabilities.forPlatform(
        TargetPlatform.macOS,
        isWeb: false,
      );
      expect(c.canOpenHttps, isTrue);
      expect(c.canOpenMailto, isTrue);
    });

    test('windows opens https and mailto', () {
      final ExternalLinkCapabilities c = ExternalLinkCapabilities.forPlatform(
        TargetPlatform.windows,
        isWeb: false,
      );
      expect(c.canOpenHttps, isTrue);
      expect(c.canOpenMailto, isTrue);
    });

    test('linux opens https and mailto', () {
      final ExternalLinkCapabilities c = ExternalLinkCapabilities.forPlatform(
        TargetPlatform.linux,
        isWeb: false,
      );
      expect(c.canOpenHttps, isTrue);
      expect(c.canOpenMailto, isTrue);
    });

    test('isWeb wins over the host platform', () {
      final ExternalLinkCapabilities web = ExternalLinkCapabilities.forPlatform(
        TargetPlatform.fuchsia,
        isWeb: true,
      );
      expect(
        web.canOpenHttps,
        isTrue,
        reason: 'a web build reports a host TargetPlatform; reading that '
            'instead of isWeb would mark a web build as unable to open links',
      );
    });
  });

  group('ExternalLinkCapabilities.forPlatform — the unsupported row', () {
    test('fuchsia opens nothing, and says why', () {
      final ExternalLinkCapabilities c = ExternalLinkCapabilities.forPlatform(
        TargetPlatform.fuchsia,
        isWeb: false,
      );
      expect(c.canOpenHttps, isFalse);
      expect(c.canOpenMailto, isFalse);
      expect(c.why, contains('Fuchsia'));
    });
  });
}
