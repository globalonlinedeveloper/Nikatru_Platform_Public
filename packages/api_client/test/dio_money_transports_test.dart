// ⏱ 2026-10-01 · train st-money-ready. The three client halves this train adds
// to the money rail, each against the platform route's real answer shapes:
//   · POST /v1/checkout → a page to open (O-ST-HOSTED-CHECKOUT-CANNOT-START);
//   · POST /v1/plan/cancel's 404 and 409 are ANSWERS (AB-M4-03-client, MF-3b);
//   · DELETE /v1/account's 503 `subscription_still_billing` carries the
//     server's own sentence to the dialog (AB-A5-02-client).
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 200});

  final String body;
  final int status;
  RequestOptions? lastRequest;
  int calls = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    lastRequest = options;
    return ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

Dio _dio(_FakeAdapter a) => Dio()..httpClientAdapter = a;

void main() {
  group('DioCheckoutSessionTransport — POST /v1/checkout', () {
    DioCheckoutSessionTransport transport(_FakeAdapter a) =>
        DioCheckoutSessionTransport(
          platformBaseUrl: 'https://platform.example.test',
          httpClient: _dio(a),
        );

    test('200 is a session, and the request is the route\'s shape', () async {
      final _FakeAdapter a = _FakeAdapter(
        jsonEncode(<String, Object?>{
          'provider': 'paddle',
          'app_id': 'subscriptiontracker',
          'offering_id': 'pro_monthly',
          'transaction_id': 'txn_01abc',
          'checkout_url': 'https://nikatru.com/pricing.html?_ptxn=txn_01abc',
        }),
      );
      final core.Result<core.CheckoutSession> r = await transport(a)
          .createSession(
            appId: 'subscriptiontracker',
            offeringId: 'pro_monthly',
            accessToken: 'tok',
          );
      final core.CheckoutSession? s = r.fold(
        (core.CheckoutSession v) => v,
        (_) => null,
      );
      expect(s?.transactionId, 'txn_01abc');
      expect(s?.checkoutUrl.queryParameters['_ptxn'], 'txn_01abc');
      expect(a.lastRequest!.method, 'POST');
      expect(
        a.lastRequest!.uri.toString(),
        'https://platform.example.test/v1/checkout',
      );
      expect(a.lastRequest!.headers['authorization'], 'Bearer tok');
      expect(a.lastRequest!.data, <String, Object?>{
        'app_id': 'subscriptiontracker',
        'offering_id': 'pro_monthly',
      });
    });

    test('no session: nothing is sent', () async {
      final _FakeAdapter a = _FakeAdapter('{}');
      final core.Result<core.CheckoutSession> r = await transport(
        a,
      ).createSession(appId: 'x', offeringId: 'pro_monthly', accessToken: null);
      expect(r.fold((_) => true, (_) => false), isFalse);
      expect(a.calls, 0);
    });

    for (final int status in <int>[403, 429, 502, 503]) {
      test('$status is a failure, never a page', () async {
        final core.Result<core.CheckoutSession> r =
            await transport(
              _FakeAdapter('{"error":"x"}', status: status),
            ).createSession(
              appId: 'x',
              offeringId: 'pro_monthly',
              accessToken: 't',
            );
        expect(r.fold((_) => true, (_) => false), isFalse);
      });
    }

    test('a 200 whose url is not https is refused', () async {
      final core.Result<core.CheckoutSession> r = await transport(
        _FakeAdapter(
          jsonEncode(<String, Object?>{
            'transaction_id': 'txn_1',
            'checkout_url': 'javascript:alert(1)',
          }),
        ),
      ).createSession(appId: 'x', offeringId: 'pro_monthly', accessToken: 't');
      expect(r.fold((_) => true, (_) => false), isFalse);
    });
  });

  group('DioCancellationTransport — the 404 and 409 answers', () {
    DioCancellationTransport transport(_FakeAdapter a) =>
        DioCancellationTransport(
          platformBaseUrl: 'https://platform.example.test',
          httpClient: _dio(a),
        );

    test(
      '404 {has_active_plan:false} is "no active plan", not a failure',
      () async {
        final core.Result<core.CancellationReceipt> r = await transport(
          _FakeAdapter(
            '{"has_active_plan":false,"recorded":false,"executed":false}',
            status: 404,
          ),
        ).requestCancellation(appId: 'x', accessToken: 't');
        final core.CancellationReceipt? rec = r.fold(
          (core.CancellationReceipt v) => v,
          (_) => null,
        );
        expect(rec, isNotNull);
        expect(rec!.hasActivePlan, isFalse);
      },
    );

    test('409 for a store row carries where to cancel', () async {
      final core.Result<core.CancellationReceipt> r = await transport(
        _FakeAdapter(
          jsonEncode(<String, Object?>{
            'has_active_plan': true,
            'recorded': false,
            'executed': false,
            'cancel_at': 'play_store',
            'manage_url': 'https://play.google.com/store/account/subscriptions',
          }),
          status: 409,
        ),
      ).requestCancellation(appId: 'x', accessToken: 't');
      final core.CancellationReceipt rec = r.fold(
        (core.CancellationReceipt v) => v,
        (_) => throw StateError('409 must be an answer'),
      );
      expect(rec.hasActivePlan, isTrue);
      expect(rec.cancelAt, 'play_store');
      expect(rec.manageUrl, contains('play.google.com'));
    });

    test(
      'a 404 without the receipt shape (a wrong path) stays a failure',
      () async {
        final core.Result<core.CancellationReceipt> r = await transport(
          _FakeAdapter('{"error":"unknown_app"}', status: 404),
        ).requestCancellation(appId: 'x', accessToken: 't');
        expect(r.fold((_) => true, (_) => false), isFalse);
      },
    );
  });

  group('DELETE /v1/account 503 subscription_still_billing', () {
    RestClient client(_FakeAdapter a) => RestClient(
      baseUrl: 'https://platform.test/v1',
      tokenProvider: () async => 'token',
      httpClient: _dio(a),
    );

    test('carries the server sentence, and is nothingDeleted', () async {
      const String sentence =
          'Your subscription is still active. Cancel it first, then delete your account.';
      await expectLater(
        requestAccountDeletion(
          client(
            _FakeAdapter(
              jsonEncode(<String, Object?>{
                'error': 'subscription_still_billing',
                'message': sentence,
              }),
              status: 503,
            ),
          ),
        ),
        throwsA(
          isA<core.AccountDeletionFailure>()
              .having(
                (core.AccountDeletionFailure f) => f.outcome,
                'outcome',
                core.AccountDeletionOutcome.nothingDeleted,
              )
              .having(
                (core.AccountDeletionFailure f) => f.serverSentence,
                'serverSentence',
                sentence,
              ),
        ),
      );
    });

    test('any other 503 carries no sentence', () async {
      await expectLater(
        requestAccountDeletion(
          client(
            _FakeAdapter('{"error":"account_deletion_failed"}', status: 503),
          ),
        ),
        throwsA(
          isA<core.AccountDeletionFailure>().having(
            (core.AccountDeletionFailure f) => f.serverSentence,
            'serverSentence',
            isNull,
          ),
        ),
      );
    });
  });
}
