// O-LINK-LAUNCHER-SEAM-UNOWNED · the external-link policy.
//
// Pure Dart, so every verdict below is decided with no plugin and no platform
// channel. The adapter in packages/external_links consults this before it
// touches url_launcher, which makes these cases the whole contract of what a
// stamped app can hand to the operating system.
//
// Every case is written out by hand. Each refusal is reachable only by its own
// input, and the allowed cases come first so a policy that refuses EVERYTHING
// cannot pass this file by being strict.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// The shape both apps build: the site apex, its legal pages, one support
/// address.
LinkPolicy _policy() => LinkPolicy.fromUrls(
      httpsUrls: <String>[
        'https://nikatru.com',
        'https://nikatru.com/privacy',
        'https://nikatru.com/terms',
      ],
      supportEmail: 'support@nikatru.com',
    );

void main() {
  group('LinkPolicy — what it opens', () {
    test('a configured legal page is allowed', () {
      expect(
        _policy().check(Uri.parse('https://nikatru.com/privacy')).allowed,
        isTrue,
        reason: 'a policy that refuses the privacy policy is a dead link on '
            'every settings screen',
      );
    });

    test('the site apex is allowed', () {
      expect(_policy().check(Uri.parse('https://nikatru.com')).allowed, isTrue);
    });

    test('a host is compared case-insensitively', () {
      expect(
        _policy().check(Uri.parse('https://NIKATRU.com/terms')).allowed,
        isTrue,
      );
    });

    test('the support mailto with a subject is allowed', () {
      expect(
        _policy()
            .check(
              Uri.parse(
                'mailto:support@nikatru.com'
                '?subject=${Uri.encodeComponent('Subscriptions support')}',
              ),
            )
            .allowed,
        isTrue,
      );
    });

    test('the support mailto with a body is allowed', () {
      expect(
        _policy()
            .check(Uri.parse('mailto:support@nikatru.com?body=hello'))
            .allowed,
        isTrue,
      );
    });
  });

  group('LinkPolicy — what it refuses', () {
    test('RC3 · javascript: is refused', () {
      final LinkVerdict v = _policy().check(Uri.parse('javascript:alert(1)'));
      expect(v.allowed, isFalse);
      expect(v.reason, contains('javascript'));
    });

    test('RC4 · a mailto to another address is refused', () {
      final LinkVerdict v = _policy().check(
        Uri.parse('mailto:someone-else@example.com'),
      );
      expect(v.allowed, isFalse);
      expect(
        v.reason,
        isNot(contains('someone-else')),
        reason: 'the reason is loggable, so it must not carry the address',
      );
    });

    test('a mailto that adds a cc recipient is refused', () {
      expect(
        _policy()
            .check(
              Uri.parse(
                  'mailto:support@nikatru.com?cc=someone-else@example.com'),
            )
            .allowed,
        isFalse,
      );
    });

    test('a mailto with two recipients is refused', () {
      expect(
        _policy()
            .check(
              Uri.parse('mailto:support@nikatru.com,someone-else@example.com'),
            )
            .allowed,
        isFalse,
      );
    });

    test('a mailto with no support address configured is refused', () {
      expect(
        LinkPolicy.fromUrls(httpsUrls: <String>['https://nikatru.com'])
            .check(Uri.parse('mailto:support@nikatru.com'))
            .allowed,
        isFalse,
      );
    });

    test('an https host the configuration does not name is refused', () {
      expect(
        _policy().check(Uri.parse('https://example.com/privacy')).allowed,
        isFalse,
      );
    });

    test('a look-alike subdomain is refused', () {
      expect(
        _policy().check(Uri.parse('https://nikatru.com.example.com/')).allowed,
        isFalse,
      );
    });

    test('credentials in the authority are refused', () {
      expect(
        _policy().check(Uri.parse('https://user@nikatru.com/privacy')).allowed,
        isFalse,
      );
    });

    test('a non-default port is refused', () {
      expect(
        _policy().check(Uri.parse('https://nikatru.com:8443/privacy')).allowed,
        isFalse,
      );
    });

    test('plain http: to a configured host is refused', () {
      expect(
        _policy().check(Uri.parse('http://nikatru.com/privacy')).allowed,
        isFalse,
      );
    });

    test('file: is refused', () {
      expect(_policy().check(Uri.parse('file:///etc/passwd')).allowed, isFalse);
    });

    test('a link with no scheme is refused', () {
      expect(_policy().check(Uri.parse('/privacy')).allowed, isFalse);
    });

    test('a string that is not a URI is refused', () {
      expect(_policy().checkUrl('http://[::1').allowed, isFalse);
    });
  });

  group('LinkPolicy — built from configuration', () {
    test('a non-https configured URL widens nothing', () {
      final LinkPolicy p = LinkPolicy.fromUrls(
        httpsUrls: <String>['http://nikatru.com', 'javascript:alert(1)', ''],
      );
      expect(p.httpsHosts, isEmpty);
    });

    test('withHttpsUrl admits the ONE resolved destination', () {
      final LinkPolicy p = _policy().withHttpsUrl(
        'https://update.invalid/from-config',
      );
      expect(
        p.check(Uri.parse('https://update.invalid/from-config')).allowed,
        isTrue,
        reason: 'the force-update destination is served config; a policy '
            'that refuses it re-freezes the kill-switch at build time',
      );
      expect(
        _policy()
            .check(Uri.parse('https://update.invalid/from-config'))
            .allowed,
        isFalse,
        reason: 'widening returns a NEW policy; the original is unchanged',
      );
    });

    test('withHttpsUrl ignores a null or non-https destination', () {
      final LinkPolicy p = _policy();
      expect(identical(p.withHttpsUrl(null), p), isTrue);
      expect(identical(p.withHttpsUrl('javascript:alert(1)'), p), isTrue);
    });

    test('the support address is compared case-insensitively', () {
      expect(
        LinkPolicy(supportEmail: 'Support@Nikatru.com')
            .check(Uri.parse('mailto:SUPPORT@nikatru.com'))
            .allowed,
        isTrue,
      );
    });
  });
}
