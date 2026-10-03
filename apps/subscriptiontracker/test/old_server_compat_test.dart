import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/cached_api_client.dart';
import 'package:subscriptiontracker/data/api/dio_api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

// 🔴 THE PRE-MERGE E2E ON #1075 (e2e.yml run 36797465703): every add from the
// web app failed against the API AS DEPLOYED — "Could not add that
// subscription". The new client sent an `Idempotency-Key` HEADER; the deployed
// Worker's CORS allow-list predates it, so the browser's preflight refused the
// POST before it was sent. Old and new clients and servers coexist after any
// merge (a mobile build in the field lags the server), so the client's save is
// proven here against a fake of the server as deployed today:
//   · its CORS allow-list is the one on main before #1075 — a request carrying
//     any other header fails as a browser would after a refused preflight
//     (a connection error, status 0);
//   · it knows nothing of idempotency — no key is read, no idempotency
//     response header is sent — and it answers the OLD response shape.

/// The request headers the deployed Worker allows (services/_shared/src/cors.ts
/// on main before #1075), plus what a browser adds on its own.
const Set<String> _deployedAllowList = <String>{
  'authorization',
  'content-type',
  'x-request-id',
  'accept',
  'content-length',
};

class _DeployedServer implements HttpClientAdapter {
  final List<RequestOptions> requests = <RequestOptions>[];
  final List<Map<String, dynamic>> rows = <Map<String, dynamic>>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final Iterable<String> refused = options.headers.keys
        .map((String k) => k.toLowerCase())
        .where((String k) => !_deployedAllowList.contains(k));
    if (refused.isNotEmpty) {
      // What a browser reports after a refused CORS preflight.
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'CORS preflight refused header(s): ${refused.join(', ')}',
      );
    }
    if (options.method == 'POST' && options.path.endsWith('/subscriptions')) {
      final Map<String, dynamic> body = options.data as Map<String, dynamic>;
      // The old shape: the server mints the id; nothing about keys.
      final Map<String, dynamic> row = <String, dynamic>{
        'id': 'srv-${rows.length + 1}',
        'user_id': 'u1',
        'name': body['name'],
        'category': body['category'],
        'price': body['price'],
        'cycle': body['cycle'],
        'next_renewal': body['next_renewal'],
        'plan': '',
        'glyph': '',
        'used_pct': 0,
        'usage_note': '',
        'unused': false,
        'created_at': '2026-10-01T00:00:00Z',
        'updated_at': '2026-10-01T00:00:00Z',
      };
      rows.add(row);
      return _json(row, 201);
    }
    // Routed on the PATH, as the Worker routes: the deployed server ignores a
    // query it does not know, so the paging client's `?limit=` (lane
    // fix-st-api-bounds) gets the bare array — which the client reads whole.
    if (options.method == 'GET' &&
        options.uri.path.endsWith('/subscriptions')) {
      return _json(rows, 200);
    }
    return _json(<String, dynamic>{'error': 'not_found'}, 404);
  }

  static ResponseBody _json(Object body, int status) => ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: <String, List<String>>{
      Headers.contentTypeHeader: <String>['application/json'],
    },
  );
}

Subscription _draft() => Subscription(
  id: '',
  name: 'Gym',
  category: 'Health',
  price: const core.Money(64900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 11, 1),
);

void main() {
  test('an add saves against the server as deployed: no new header, the old '
      'response shape', () async {
    final _DeployedServer server = _DeployedServer();
    final DioApiClient network = DioApiClient(
      baseUrl: 'https://api.example.test/v1',
      tokenProvider: () async => 'token',
      httpClient: Dio()..httpClientAdapter = server,
    );
    final CachedApiClient client = CachedApiClient(
      network,
      LocalSubscriptionStore.inMemory(),
      currentUser: () => 'u1',
    );

    final Subscription created = await client.createSubscription(_draft());

    expect(
      created.id,
      'srv-1',
      reason: 'the server made the row; nothing queued',
    );
    expect(await client.pendingWrites(), isEmpty);
    expect(server.rows, hasLength(1));
    final RequestOptions post = server.requests.firstWhere(
      (RequestOptions r) => r.method == 'POST',
    );
    expect(
      post.queryParameters['idempotency_key'],
      isNotNull,
      reason: 'the key still travels — where an old server ignores it',
    );
    expect((await client.getSubscriptions()).single.name, 'Gym');
  });

  // The same client with no server at all: an add built the way the add sheet
  // builds it (trial, first charge, notes, website) is QUEUED and shown, never
  // an error — the placeholder round-trips the sheet's whole draft.
  test(
    'offline, a full add-sheet draft is queued and shown, never thrown',
    () async {
      final DioApiClient network = DioApiClient(
        baseUrl: 'https://api.example.test/v1',
        tokenProvider: () async => 'token',
        httpClient: Dio()..httpClientAdapter = _Unreachable(),
      );
      final CachedApiClient client = CachedApiClient(
        network,
        LocalSubscriptionStore.inMemory(),
        currentUser: () => 'u1',
      );
      final Subscription draft = Subscription(
        id: '',
        name: 'Netflix',
        category: 'Streaming',
        price: const core.Money(64900, 'INR'),
        cycle: BillingCycle.monthly,
        nextRenewal: DateTime(2026, 11, 1),
        plan: 'Premium',
        glyph: Subscription.glyphFor('Netflix'),
        status: SubscriptionStatus.trialing,
        firstChargeOn: DateTime(2026, 11, 1),
        trialEndsOn: DateTime(2026, 11, 1),
        notes: 'shared with family',
        cancelUrl: 'https://netflix.com/cancel',
      );
      final Subscription shown = await client.createSubscription(draft);
      expect(shown.name, 'Netflix');
      expect(shown.status, SubscriptionStatus.trialing);
      expect(await client.pendingWrites(), hasLength(1));
    },
  );
}

class _Unreachable implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => throw DioException.connectionError(
    requestOptions: options,
    reason: 'no network',
  );
}
