import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/api/api_client.dart' show ApiException;
import 'package:subscriptiontracker/data/api/dio_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

/// A dio adapter returning a fixed body/status and recording the last request.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 200});

  final String body;
  final int status;
  RequestOptions? lastRequest;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
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

void main() {
  test('attaches the bearer token and parses subscriptions', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<dynamic>[
        <String, dynamic>{
          'id': '1',
          'name': 'Netflix',
          'category': 'Streaming',
          'price': 15.0,
          'cycle': 'monthly',
          'next_renewal': '2026-08-01',
        },
      ]),
    );
    final Dio dio = Dio()..httpClientAdapter = adapter;
    final DioApiClient client = DioApiClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => 'tok123',
      httpClient: dio,
    );

    final List<Subscription> subs = await client.getSubscriptions();
    expect(subs, hasLength(1));
    expect(subs.first.name, 'Netflix');
    expect(adapter.lastRequest!.headers['Authorization'], 'Bearer tok123');
  });

  test('maps error responses to ApiException', () {
    final Dio dio = Dio()
      ..httpClientAdapter = _FakeAdapter(
        jsonEncode(<String, dynamic>{'error': 'nope'}),
        status: 400,
      );
    final DioApiClient client = DioApiClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => null,
      httpClient: dio,
    );
    expect(client.getSubscriptions(), throwsA(isA<ApiException>()));
  });

  test('maps a malformed 2xx body to ApiException (not a raw TypeError)', () {
    // Server returns 200 with an object where a list is expected.
    final Dio dio = Dio()
      ..httpClientAdapter = _FakeAdapter(
        jsonEncode(<String, dynamic>{'unexpected': true}),
      );
    final DioApiClient client = DioApiClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => null,
      httpClient: dio,
    );
    expect(client.getSubscriptions(), throwsA(isA<ApiException>()));
  });

  test('a legacy row with a decimal price and NO currency still parses', () {
    // 🔴 THE OLD WIRE IS STILL THE WIRE. `price` is a SQLite REAL and the
    // migration policy here is strictly additive, so a server that has not
    // grown `price_minor`/`currency` must keep working. 15.0 becomes an exact
    // 1500 minor units under the fallback the caller names.
    expect(
      Subscription.fromJson(<String, dynamic>{
        'id': '1',
        'name': 'Netflix',
        'category': 'Streaming',
        'price': 15.0,
        'cycle': 'monthly',
        'next_renewal': '2026-08-01',
      }).price,
      const Money(1500, 'USD'),
    );
  });

  test('a row that DOES carry the exact fields is read from them', () {
    final Subscription s = Subscription.fromJson(<String, dynamic>{
      'id': '1',
      'name': 'Netflix',
      'category': 'Streaming',
      'price': 15.0,
      'price_minor': 49900,
      'currency': 'INR',
      'cycle': 'monthly',
      'next_renewal': '2026-08-01',
    });
    expect(s.price, const Money(49900, 'INR'));
    expect(s.currencyCode, 'INR');
  });

  test('what the client SENDS keeps the decimal price and adds two fields', () {
    // A client that silently stopped sending `price` would write zeroes into
    // every row it touched on a server that has not migrated.
    final Map<String, dynamic> body = Subscription(
      id: '1',
      name: 'Netflix',
      category: 'Streaming',
      price: const Money(49900, 'INR'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 8, 1),
    ).toJson();
    expect(body['price'], 499.0);
    expect(body['price_minor'], 49900);
    expect(body['currency'], 'INR');
  });

  group('🔴 ST-C1 — a currency-less row reads back in the user currency', () {
    // Audit B21/D5/D18: the Worker stores `price` with no currency, and the
    // client decoded with the USD default — so ₹649 came back "$649.00".
    // MUTATION PROOF: drop `fallbackCurrencyCode: _currencyCode()` from any
    // decode in dio_api_client.dart and the matching case goes red.
    Map<String, dynamic> row(String id) => <String, dynamic>{
      'id': id,
      'name': 'Hotstar',
      'category': 'Streaming',
      'price': 649,
      'cycle': 'monthly',
      'next_renewal': '2026-10-01',
    };

    DioApiClient over(Object body) => DioApiClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => 'tok',
      httpClient: Dio()..httpClientAdapter = _FakeAdapter(jsonEncode(body)),
      currencyCode: () => 'INR',
    );

    test('the list', () async {
      final List<Subscription> subs = await over(<dynamic>[
        row('1'),
      ]).getSubscriptions();
      expect(subs.single.price, const Money(64900, 'INR'));
    });

    test('the POST response the add sheet renders at once', () async {
      final Subscription s = await over(row('2')).createSubscription(
        Subscription.fromJson(row('2'), fallbackCurrencyCode: 'INR'),
      );
      expect(s.price, const Money(64900, 'INR'));
    });

    test('one row, and its payment history', () async {
      final Map<String, dynamic> body = <String, dynamic>{
        'subscription': row('3'),
        'payment_history': <dynamic>[
          <String, dynamic>{'paid_at': '2026-09-01', 'amount': 649},
        ],
      };
      expect(
        (await over(body).getSubscription('3')).price,
        const Money(64900, 'INR'),
      );
      expect(
        (await over(body).getPaymentHistory('3')).single.amount,
        const Money(64900, 'INR'),
      );
    });

    test('a row that names its OWN currency keeps it', () async {
      final List<Subscription> subs = await over(<dynamic>[
        <String, dynamic>{...row('4'), 'currency': 'USD', 'price_minor': 999},
      ]).getSubscriptions();
      expect(subs.single.price, const Money(999, 'USD'));
    });
  });
}
