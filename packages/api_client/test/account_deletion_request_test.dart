import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// THE LAYER WHERE THE STATUS STILL EXISTS.
///
/// The obvious wiring is `requestServerDeletion: () => rest.delete('/account')`,
/// and it is what the brick shipped. It works — and it throws away the only
/// thing the screen needs. `ApiException` carries the status; by the time
/// `AuthRepository.deleteAccount` has wrapped it in an `AuthFailure`, the status
/// is a substring of a sentence, and 501 (nothing was deleted) and 502 (the data
/// is gone, the login is not) arrive indistinguishable. [ADR 027].
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter({required this.status, this.body = '{}'});

  final int status;
  final String body;
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

RestClient _client(_FakeAdapter adapter) => RestClient(
      baseUrl: 'https://platform.test/v1',
      tokenProvider: () async => 'token',
      httpClient: Dio()..httpClientAdapter = adapter,
    );

void main() {
  test('a 2xx returns normally, and hits DELETE /account', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      status: 200,
      body: '{"ok":true,"deleted":{"identity":1}}',
    );
    await requestAccountDeletion(_client(adapter));
    expect(adapter.lastRequest!.method, 'DELETE');
    expect(adapter.lastRequest!.path, '/account');
  });

  test('🔴 501 SURVIVES AS notConfigured — nothing was deleted', () async {
    // What the live route answers while SUPABASE_SERVICE_ROLE_KEY is unset.
    final _FakeAdapter adapter = _FakeAdapter(
      status: 501,
      body: '{"error":"account_deletion_unconfigured"}',
    );
    await expectLater(
      requestAccountDeletion(_client(adapter)),
      throwsA(
        isA<core.AccountDeletionFailure>().having(
          (core.AccountDeletionFailure f) => f.outcome,
          'outcome',
          core.AccountDeletionOutcome.notConfigured,
        ),
      ),
    );
  });

  test('🔴 502 SURVIVES AS signInSurvives — the data is gone, the login is not',
      () async {
    final _FakeAdapter adapter = _FakeAdapter(
      status: 502,
      body: '{"error":"identity_delete_failed"}',
    );
    await expectLater(
      requestAccountDeletion(_client(adapter)),
      throwsA(
        isA<core.AccountDeletionFailure>().having(
          (core.AccountDeletionFailure f) => f.outcome,
          'outcome',
          core.AccountDeletionOutcome.signInSurvives,
        ),
      ),
    );
  });

  test('503 is nothingDeleted, and is NOT the same object as 501 or 502',
      () async {
    final List<core.AccountDeletionOutcome> seen =
        <core.AccountDeletionOutcome>[];
    for (final int status in <int>[501, 502, 503]) {
      try {
        await requestAccountDeletion(_client(_FakeAdapter(status: status)));
        fail('status $status must not succeed');
      } on core.AccountDeletionFailure catch (e) {
        seen.add(e.outcome);
      }
    }
    expect(
      seen.toSet().length,
      3,
      reason: 'three refusals that mean three different things must not '
          'collapse at the transport boundary',
    );
  });

  test('the failure is still an AuthFailure, so no existing catch changes',
      () async {
    await expectLater(
      requestAccountDeletion(_client(_FakeAdapter(status: 501))),
      throwsA(isA<core.AuthFailure>()),
    );
  });
}
