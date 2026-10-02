import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/ai_byok.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show HttpPlatform;
import 'package:nikatru_api_client/testing.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// Review 1 of #1136, item 3: a bring-your-own-key adapter OWNS its Dio. An app's
/// Dio carries a session interceptor (RestClient adds an `Authorization` header
/// carrying the Nikatru session); if an adapter shared it, the user's OpenAI key would be
/// overwritten with our session token and every provider would receive it.
///
/// Here the app's Dio and the three adapters share ONE socket layer (the same
/// recording transport), which is the most an app can hand an adapter — and
/// nothing the app's Dio sets reaches a provider request.
///
/// And nit 6: each client adapter declares exactly the capabilities
/// tooling/ports/ai.json lists for it — one source, asserted here.

const String _userKey = 'sentinel-never-logged-sentinel-never-logged';
const String _session = 'nikatru-session-token-fixture';

class _Recorder implements HttpClientAdapter {
  final List<RequestOptions> seen = <RequestOptions>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (requestStream != null) await requestStream.drain<void>();
    seen.add(options);
    return ResponseBody.fromString(
      '{}',
      500,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

/// The header names each provider documents for a call (plus what dio itself
/// sets); anything else on the wire came from somewhere it must not.
const Map<String, Set<String>> _allowed = <String, Set<String>>{
  'anthropic-byok': <String>{
    'x-api-key',
    'anthropic-version',
    'anthropic-beta',
    'content-type',
    'content-length',
  },
  'openai-byok': <String>{'authorization', 'content-type', 'content-length'},
  'gemini-byok': <String>{'x-goog-api-key', 'content-type', 'content-length'},
};

void main() {
  test(
    '🔴 no provider request carries the app\'s session token or any app header; the user\'s key is the only credential',
    () async {
      final _Recorder wire = _Recorder();
      // The app's Dio: what RestClient builds — a session interceptor and an app header.
      final Dio app =
          Dio(
              BaseOptions(
                headers: <String, Object>{'X-App-Id': 'subscriptiontracker'},
              ),
            )
            ..httpClientAdapter = wire
            ..interceptors.add(
              InterceptorsWrapper(
                onRequest: (RequestOptions o, RequestInterceptorHandler h) {
                  o.headers['Authorization'] = 'Bearer $_session';
                  h.next(o);
                },
              ),
            );
      await app.get<String>(
        'https://api.nikatru.invalid/v1/config',
        options: Options(validateStatus: (_) => true),
      );
      expect(
        wire.seen.single.headers['Authorization'],
        'Bearer $_session',
        reason: 'control: the app Dio does set its session',
      );

      final InMemorySecureStore keys = InMemorySecureStore(<String, String>{
        byokKeyName('anthropic'): _userKey,
        byokKeyName('openai'): _userKey,
        byokKeyName('gemini'): _userKey,
      });
      final List<AiProvider> adapters = <AiProvider>[
        AnthropicByok(
          keys: keys,
          platform: HttpPlatform.android,
          transport: wire,
        ),
        OpenAiByok(keys: keys, platform: HttpPlatform.android, transport: wire),
        GeminiByok(keys: keys, platform: HttpPlatform.android, transport: wire),
      ];
      for (final AiProvider ai in adapters) {
        final int before = wire.seen.length;
        await ai.complete(aiConformanceRequest('fixture-model-a'));
        final RequestOptions req = wire.seen[before];
        final Map<String, String> headers = <String, String>{
          for (final MapEntry<String, dynamic> e in req.headers.entries)
            e.key.toLowerCase(): '${e.value}',
        };
        expect(
          headers.values.any((String v) => v.contains(_session))
              ? 'match'
              : 'no match',
          'no match',
          reason: ai.id,
        );
        expect(headers.containsKey('x-app-id'), isFalse, reason: ai.id);
        expect(
          headers.keys.toSet().difference(_allowed[ai.id]!),
          isEmpty,
          reason: ai.id,
        );
        // The only credential is the user's key ("match" / "no match": a key is never printed).
        final String credential = switch (ai.id) {
          'anthropic-byok' => headers['x-api-key']!,
          'openai-byok' => headers['authorization']!,
          _ => headers['x-goog-api-key']!,
        };
        expect(
          credential.endsWith(_userKey) ? 'match' : 'no match',
          'match',
          reason: ai.id,
        );
      }
    },
  );

  test(
    'each client adapter declares exactly the capabilities tooling/ports/ai.json lists',
    () {
      final Map<String, Object?> registry =
          jsonDecode(File('../../tooling/ports/ai.json').readAsStringSync())
              as Map<String, Object?>;
      final Map<String, List<String>> listed = <String, List<String>>{
        for (final Object? a in registry['adapters']! as List<Object?>)
          if (a is Map && a['half'] == 'client')
            a['id']! as String:
                (a['capabilities']! as List<Object?>).cast<String>()..sort(),
      };
      final InMemorySecureStore keys = InMemorySecureStore();
      final List<AiProvider> adapters = <AiProvider>[
        AnthropicByok(keys: keys, platform: HttpPlatform.android),
        OpenAiByok(keys: keys, platform: HttpPlatform.android),
        GeminiByok(keys: keys, platform: HttpPlatform.android),
        FakeAiProvider(keys: keys),
      ];
      expect(adapters.map((AiProvider a) => a.id).toSet(), listed.keys.toSet());
      for (final AiProvider a in adapters) {
        expect(
          a.capabilities.map((AiCapability c) => c.name).toList()..sort(),
          listed[a.id],
          reason: a.id,
        );
      }
    },
  );
}
