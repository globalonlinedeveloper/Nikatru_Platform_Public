// ⏱ 2026-10-01 · the system-browser hand-off's client protocol
// (lib/src/auth/browser_handoff.dart). The server half's rules are proven in
// services/platform/test/native-handoff.test.ts; these hold the app's end to
// the same contract: S256 over the verifier, the exact return address, and a
// callback accepted only with this request's `state`.
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart' show sha256;
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  const String loop = 'http://127.0.0.1:53111/nk-auth-callback';

  test('the S256 challenge matches the server\'s, byte for byte', () {
    // Computed by node:crypto — `createHash('sha256').update(v).digest('base64url')`
    // — an implementation independent of this one, and the encoding the
    // platform Worker's `s256` (lib/native-attest/handoff.ts) compares against.
    expect(
      handoffS256('dBjftJeZ4CVP-mJ92IZTvGzBR6xNJM9YFQqRwpcmvn0'),
      'ZHSMcMAgn7z81MHS2ETyNlj3jbpen2MOzQvb_vo-ba8',
    );
  });

  test('a request carries a 43-character verifier, its S256 challenge and a state', () {
    final HandoffRequest r = newHandoffRequest(
      appId: 'subscriptiontracker',
      redirectUri: loop,
      random: Random(7),
    );
    expect(r.verifier, matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
    expect(
      r.challenge,
      base64Url
          .encode(sha256.convert(ascii.encode(r.verifier)).bytes)
          .replaceAll('=', ''),
    );
    expect(r.state, matches(RegExp(r'^[A-Za-z0-9_-]{22}$')));
    expect(r.connectUrl.origin, 'https://nikatru.com');
    expect(r.connectUrl.path, '/app/connect');
    expect(r.connectUrl.queryParameters, <String, String>{
      'app': 'subscriptiontracker',
      'redirect_uri': loop,
      'code_challenge': r.challenge,
      'code_challenge_method': 'S256',
      'state': r.state,
    });
    // 🔴 the verifier never rides in the URL the browser opens.
    expect(r.connectUrl.toString(), isNot(contains(r.verifier)));
  });

  test('two requests share nothing', () {
    final HandoffRequest a =
        newHandoffRequest(appId: 'subscriptiontracker', redirectUri: loop);
    final HandoffRequest b =
        newHandoffRequest(appId: 'subscriptiontracker', redirectUri: loop);
    expect(a.verifier, isNot(b.verifier));
    expect(a.state, isNot(b.state));
  });

  group('the callback', () {
    final HandoffRequest r = newHandoffRequest(
      appId: 'subscriptiontracker',
      redirectUri: loop,
      random: Random(1),
    );

    test('carries the code back when the address and the state are this request\'s', () {
      expect(
        handoffCodeOf(Uri.parse('$loop?nk_code=h1.abc&state=${r.state}'), r),
        'h1.abc',
      );
    });

    test('is refused with another state, no state, or no code', () {
      expect(handoffCodeOf(Uri.parse('$loop?nk_code=h1.abc&state=other'), r), isNull);
      expect(handoffCodeOf(Uri.parse('$loop?nk_code=h1.abc'), r), isNull);
      expect(handoffCodeOf(Uri.parse('$loop?state=${r.state}'), r), isNull);
    });

    test('is refused at another port, path or scheme — and `code` is not `nk_code`', () {
      for (final String u in <String>[
        'http://127.0.0.1:53112/nk-auth-callback?nk_code=h1.abc&state=${r.state}',
        'http://127.0.0.1:53111/other?nk_code=h1.abc&state=${r.state}',
        'https://127.0.0.1:53111/nk-auth-callback?nk_code=h1.abc&state=${r.state}',
        '$loop?code=h1.abc&state=${r.state}',
      ]) {
        expect(handoffCodeOf(Uri.parse(u), r), isNull, reason: u);
      }
    });

    test('the deep-link return keeps its own marker', () {
      final HandoffRequest d = newHandoffRequest(
        appId: 'subscriptiontracker',
        redirectUri: 'com.nikatru.subscriptiontracker://auth-callback?nk_auth=handoff',
      );
      expect(
        handoffCodeOf(
          Uri.parse(
            'com.nikatru.subscriptiontracker://auth-callback?nk_auth=handoff&nk_code=h1.x&state=${d.state}',
          ),
          d,
        ),
        'h1.x',
      );
      expect(
        handoffCodeOf(
          Uri.parse(
            'com.nikatru.subscriptiontracker://auth-callback?nk_auth=oauth&nk_code=h1.x&state=${d.state}',
          ),
          d,
        ),
        isNull,
      );
    });
  });

  test('the loopback address refuses a privileged port', () {
    expect(handoffLoopbackRedirect(53111), loop);
    expect(() => handoffLoopbackRedirect(80), throwsArgumentError);
  });
}
