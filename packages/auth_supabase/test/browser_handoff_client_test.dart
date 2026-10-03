// ⏱ 2026-10-01 · the system-browser hand-off, app side
// (lib/src/browser_handoff_client.dart, lib/src/handoff_loopback_io.dart). The
// server's red tests are services/platform/test/native-handoff.test.ts; these
// prove the app sends the exchange the server expects, waits for THIS request's
// code on a real 127.0.0.1 listener, and turns every refusal into an AuthFailure.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

const String base = 'https://platform.example/v1/auth/native/subscriptiontracker';

void main() {
  group('exchangeHandoffCode', () {
    test('posts {code, code_verifier, redirect_uri} and reads the session', () async {
      late http.Request seen;
      final MockClient client = MockClient((http.Request r) async {
        seen = r;
        return http.Response(
          jsonEncode(<String, Object>{'access_token': 'a', 'refresh_token': 'r', 'user': <String, String>{'id': 'u'}}),
          200,
        );
      });
      final HandoffTokens t = await exchangeHandoffCode(
        client: client,
        nativeBaseUrl: base,
        code: 'h1.x',
        verifier: 'v' * 43,
        redirectUri: 'http://127.0.0.1:5000/nk-auth-callback',
      );
      expect(seen.url.toString(), '$base/handoff/token');
      expect(seen.method, 'POST');
      expect(jsonDecode(seen.body), <String, String>{
        'code': 'h1.x',
        'code_verifier': 'v' * 43,
        'redirect_uri': 'http://127.0.0.1:5000/nk-auth-callback',
      });
      expect(t.accessToken, 'a');
      expect(t.refreshToken, 'r');
    });

    test('a refused code, an outage and a malformed answer are each an AuthFailure', () async {
      for (final http.Response answer in <http.Response>[
        http.Response('{"error_code":"invalid_grant"}', 400),
        http.Response('{}', 503),
        http.Response('not json', 200),
        http.Response('{"access_token":"a"}', 200),
      ]) {
        await expectLater(
          exchangeHandoffCode(
            client: MockClient((_) async => answer),
            nativeBaseUrl: base,
            code: 'h1.x',
            verifier: 'v' * 43,
            redirectUri: 'http://127.0.0.1:5000/nk-auth-callback',
          ),
          throwsA(isA<core.AuthFailure>()),
        );
      }
    });
  });

  group('signInThroughBrowser over a real loopback', () {
    test('opens the connect page, takes THIS request\'s code, exchanges it, closes the port', () async {
      final HandoffReturn ret = await openHandoffLoopback();
      expect(ret.redirectUri, matches(RegExp(r'^http://127\.0\.0\.1:\d{4,5}/nk-auth-callback$')));
      late Map<String, dynamic> sent;
      final Future<HandoffTokens> done = signInThroughBrowser(
        appId: 'subscriptiontracker',
        nativeBaseUrl: base,
        ret: ret,
        client: MockClient((http.Request r) async {
          sent = jsonDecode(r.body) as Map<String, dynamic>;
          return http.Response('{"access_token":"a","refresh_token":"r"}', 200);
        }),
        open: (Uri url) async {
          // What the page does: navigate to the redirect with nk_code and state.
          final Uri back = Uri.parse(url.queryParameters['redirect_uri']!).replace(
            queryParameters: <String, String>{'nk_code': 'h1.code', 'state': url.queryParameters['state']!},
          );
          // A stray request first: another path is 404 and does not complete the wait.
          final HttpClient browser = HttpClient();
          final HttpClientResponse stray = await (await browser.getUrl(back.replace(path: '/favicon.ico'))).close();
          expect(stray.statusCode, 404);
          final HttpClientResponse ok = await (await browser.getUrl(back)).close();
          expect(ok.statusCode, 200);
          browser.close();
          return true;
        },
      );
      final HandoffTokens t = await done;
      expect(t.refreshToken, 'r');
      expect(sent['code'], 'h1.code');
      expect(sent['redirect_uri'], ret.redirectUri);
      expect(sent['code_verifier'], matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
      // The port is closed once the hand-off is over.
      final Uri port = Uri.parse(ret.redirectUri);
      await expectLater(
        Socket.connect(InternetAddress.loopbackIPv4, port.port, timeout: const Duration(seconds: 2)),
        throwsA(isA<SocketException>()),
      );
    });

    // ⏱ 2026-10-02 (review of #1133, finding 6): another state is 404 and the wait
    // goes on, so whatever hits the port first cannot end THIS sign-in.
    test('a callback with another state is 404, and the real one still completes', () async {
      final HandoffReturn ret = await openHandoffLoopback();
      final List<String> exchangedCodes = <String>[];
      final HandoffTokens t = await signInThroughBrowser(
        appId: 'subscriptiontracker',
        nativeBaseUrl: base,
        ret: ret,
        client: MockClient((http.Request r) async {
          exchangedCodes.add((jsonDecode(r.body) as Map<String, dynamic>)['code'] as String);
          return http.Response('{"access_token":"a","refresh_token":"r"}', 200);
        }),
        open: (Uri url) async {
          final Uri back = Uri.parse(ret.redirectUri);
          final HttpClient browser = HttpClient();
          final HttpClientResponse probe = await (await browser.getUrl(back.replace(
            queryParameters: <String, String>{'nk_code': 'h1.planted', 'state': 'not-this-one'},
          ))).close();
          expect(probe.statusCode, 404);
          final HttpClientResponse none = await (await browser.getUrl(back)).close();
          expect(none.statusCode, 404);
          final HttpClientResponse ok = await (await browser.getUrl(back.replace(
            queryParameters: <String, String>{'nk_code': 'h1.code', 'state': url.queryParameters['state']!},
          ))).close();
          expect(ok.statusCode, 200);
          browser.close();
          return true;
        },
      );
      expect(t.accessToken, 'a');
      expect(exchangedCodes, <String>['h1.code']);
    });

    test('only another state ever arrives: the wait times out and nothing is exchanged', () async {
      final HandoffReturn ret = await openHandoffLoopback();
      bool exchanged = false;
      await expectLater(
        signInThroughBrowser(
          appId: 'subscriptiontracker',
          nativeBaseUrl: base,
          ret: ret,
          waitLimit: const Duration(milliseconds: 500),
          client: MockClient((_) async {
            exchanged = true;
            return http.Response('{}', 200);
          }),
          open: (Uri url) async {
            final Uri back = Uri.parse(ret.redirectUri).replace(
              queryParameters: <String, String>{'nk_code': 'h1.code', 'state': 'not-this-one'},
            );
            final HttpClient browser = HttpClient();
            final HttpClientResponse res = await (await browser.getUrl(back)).close();
            expect(res.statusCode, 404);
            browser.close();
            return true;
          },
        ),
        throwsA(isA<core.AuthFailure>()),
      );
      expect(exchanged, isFalse);
    });

    test('a browser that will not open is an AuthFailure, and the port is closed', () async {
      final HandoffReturn ret = await openHandoffLoopback();
      await expectLater(
        signInThroughBrowser(
          appId: 'subscriptiontracker',
          nativeBaseUrl: base,
          ret: ret,
          client: MockClient((_) async => http.Response('{}', 200)),
          open: (_) async => false,
        ),
        throwsA(isA<core.AuthFailure>()),
      );
    });
  });
}
