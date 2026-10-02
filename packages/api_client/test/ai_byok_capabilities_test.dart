import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/ai_byok.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show HttpPlatform;
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// [pipeline C-7] Every bring-your-own-key adapter declares where it works, and
/// the unsupported path returns the declared fallback instead of a request.
///
/// Web is supported only where the provider DOCUMENTS browser access
/// (AiByokCapabilities' header): Anthropic does, OpenAI and Gemini do not.
void main() {
  test('every platform and every provider has a declared row', () {
    for (final HttpPlatform p in HttpPlatform.values) {
      for (final AiByokProvider provider in AiByokProvider.values) {
        expect(AiByokCapabilities.forPlatform(p, provider), isNotNull);
      }
    }
    expect(AiByokProvider.values, hasLength(3));
  });

  test('the five native targets call every provider directly', () {
    for (final HttpPlatform p in <HttpPlatform>[
      HttpPlatform.android,
      HttpPlatform.iOS,
      HttpPlatform.macOS,
      HttpPlatform.windows,
      HttpPlatform.linux,
    ]) {
      for (final AiByokProvider provider in AiByokProvider.values) {
        final AiByokCapabilities c = AiByokCapabilities.forPlatform(
          p,
          provider,
        );
        expect(c.supported, isTrue, reason: '$p $provider');
        expect(c.browserHeaders, isEmpty, reason: '$p $provider');
      }
    }
  });

  group('web: only a documented browser access is offered', () {
    test('Anthropic is supported, with its documented opt-in header', () {
      final AiByokCapabilities c = AiByokCapabilities.forPlatform(
        HttpPlatform.web,
        AiByokProvider.anthropic,
      );
      expect(c.supported, isTrue);
      expect(c.browserHeaders, <String, String>{
        'anthropic-dangerous-direct-browser-access': 'true',
      });
    });

    test(
      '🔴 OpenAI and Gemini are NOT — and the adapter returns the declared fallback without a request',
      () async {
        for (final AiByokProvider provider in <AiByokProvider>[
          AiByokProvider.openai,
          AiByokProvider.gemini,
        ]) {
          final AiByokCapabilities c = AiByokCapabilities.forPlatform(
            HttpPlatform.web,
            provider,
          );
          expect(c.supported, isFalse, reason: '$provider');
          expect(
            c.note,
            contains('documents no browser access'),
            reason: '$provider',
          );
        }
        final InMemorySecureStore keys = InMemorySecureStore(<String, String>{
          byokKeyName('openai'): 'sentinel-never-logged-sentinel-never-logged',
          byokKeyName('gemini'): 'sentinel-never-logged-sentinel-never-logged',
        });
        // A transport that fails the test if it is ever asked: a returned
        // `unavailable` with it untouched proves no request was attempted.
        final _Refusing never = _Refusing();
        for (final AiProvider ai in <AiProvider>[
          OpenAiByok(keys: keys, transport: never, platform: HttpPlatform.web),
          GeminiByok(keys: keys, transport: never, platform: HttpPlatform.web),
        ]) {
          final AiOutcome out = await ai.complete(
            const AiRequest(
              feature: 'import',
              model: 'fixture-model-a',
              system: 's',
              input: 'i',
              schema: <String, Object?>{},
              maxOutputTokens: 16,
            ),
          );
          expect(
            out,
            isA<AiFailure>().having(
              (AiFailure f) => f.kind,
              'kind',
              AiFailureKind.unavailable,
            ),
            reason: ai.id,
          );
          expect(
            (out as AiFailure).detail,
            contains('documents no browser access'),
            reason: ai.id,
          );
        }
      },
    );
  });

  test('fuchsia is not a target: no provider is offered', () {
    for (final AiByokProvider provider in AiByokProvider.values) {
      expect(
        AiByokCapabilities.forPlatform(
          HttpPlatform.fuchsia,
          provider,
        ).supported,
        isFalse,
      );
    }
  });
}

class _Refusing implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) => throw StateError('no request may be made from web for this provider');
}
