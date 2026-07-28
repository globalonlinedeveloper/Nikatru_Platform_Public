import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:test/test.dart';

/// [pipeline C-7] dio is pure Dart, which makes it tempting to call this adapter
/// portable and stop. Web is a different network stack.
///
/// This test runs under `dart test`, not `flutter test` — `packages/api_client`
/// declares no Flutter dependency, which is why the matrix uses its own
/// [HttpPlatform] enum instead of `TargetPlatform`.
void main() {
  test('every platform has a declared row', () {
    for (final HttpPlatform p in HttpPlatform.values) {
      expect(HttpCapabilities.forPlatform(p), isNotNull);
    }
    // Six real targets plus fuchsia.
    expect(HttpPlatform.values, hasLength(7));
  });

  // 🔴 THE ROW THAT MATTERS. Each of these three is a real production failure
  // that no other platform exhibits.
  group('web is a different network stack', () {
    final HttpCapabilities web = HttpCapabilities.forPlatform(HttpPlatform.web);

    test('CORS is enforced by the browser — a SERVER-side fix', () {
      expect(web.corsEnforcedByBrowser, isTrue);
      expect(web.note, contains('CORS'));
      // This is why the Worker's ALLOWED_ORIGINS is a client-facing concern
      // with its own CI guard.
      expect(web.note, contains('ALLOWED_ORIGINS'));
    });

    test('custom headers are NOT available — the assignment is ignored', () {
      expect(
        web.customHeaders,
        isFalse,
        reason: 'the browser owns User-Agent and IGNORES the assignment '
            'silently, so the bug presents as a server problem',
      );
    });

    test('certificate pinning is impossible', () {
      expect(web.certificatePinning, isFalse);
    });
  });

  test('the five native targets control their own headers', () {
    for (final HttpPlatform p in <HttpPlatform>[
      HttpPlatform.android,
      HttpPlatform.iOS,
      HttpPlatform.macOS,
      HttpPlatform.windows,
      HttpPlatform.linux,
    ]) {
      final HttpCapabilities c = HttpCapabilities.forPlatform(p);
      expect(c.customHeaders, isTrue, reason: '$p lost header control');
      expect(c.corsEnforcedByBrowser, isFalse);
    }
  });

  test('every platform that degrades explains why', () {
    for (final HttpPlatform p in HttpPlatform.values) {
      final HttpCapabilities c = HttpCapabilities.forPlatform(p);
      if (!c.customHeaders || !c.certificatePinning) {
        expect(c.note, isNotEmpty, reason: '$p degrades silently');
      }
    }
  });
}
