/// THE GEMINI BRING-YOUR-OWN-KEY ADAPTER of the AI port's client half
/// (tooling/ports/ai.json, row `gemini-byok`). The USER's key and account.
///
/// Plain HTTP over dio against `models.generateContent` as documented (read
/// 2026-10-02, https://ai.google.dev/api/generate-content and
/// https://ai.google.dev/gemini-api/docs/api-key):
/// `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
/// with the key in `x-goog-api-key` (never in the URL, where it would sit in
/// every proxy log), structured output as `generationConfig.responseMimeType:
/// application/json` with `responseJsonSchema`, and the stop read first: a
/// `promptFeedback.blockReason` or a safety `finishReason` is a refusal,
/// `MAX_TOKENS` a truncation. `usageMetadata.promptTokenCount` INCLUDES the
/// cached part (`cachedContentTokenCount`) and thinking is billed as output
/// (`thoughtsTokenCount`), so both are split here to keep the port's meaning.
/// Not offered on web: Gemini documents no browser access
/// ([AiByokCapabilities]).
library;

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart';

import '../http_capabilities.dart';
import 'ai_byok_capabilities.dart';
import 'byok_call.dart';

class GeminiByok implements AiProvider {
  /// [transport] is the socket layer only, for tests; the adapter builds its OWN
  /// [Dio] around it, so no interceptor, header or logger of the app's can reach
  /// a request carrying the user's key. It never takes the app's Dio or RestClient.
  GeminiByok({
    required this.keys,
    required this.platform,
    HttpClientAdapter? transport,
    this.timeout = byokCallTimeout,
  }) : _dio = byokDio(transport);

  final SecureStore keys;
  final Dio _dio;
  final HttpPlatform platform;
  final Duration timeout;

  static const String host = 'generativelanguage.googleapis.com';
  static const String _carrier = 'Gemini';

  /// The finish reasons that mean the model declined (a safety or policy stop).
  static const Set<String> refusalReasons = <String>{
    'SAFETY',
    'RECITATION',
    'BLOCKLIST',
    'PROHIBITED_CONTENT',
    'SPII',
    'IMAGE_SAFETY',
    'LANGUAGE',
  };

  /// The endpoint for [model]; the model is a path segment.
  static Uri endpointFor(String model) => Uri(
    scheme: 'https',
    host: host,
    path: '/v1beta/models/${Uri.encodeComponent(model)}:generateContent',
  );

  @override
  String get id => 'gemini-byok';

  @override
  Set<AiCapability> get capabilities => const <AiCapability>{
    AiCapability.structured,
    AiCapability.vision,
  };

  @override
  Future<AiOutcome> complete(AiRequest request) async {
    final AiByokCapabilities caps = AiByokCapabilities.forPlatform(
      platform,
      AiByokProvider.gemini,
    );
    if (!caps.supported) {
      return AiFailure(
        kind: AiFailureKind.unavailable,
        retryable: false,
        detail: '$_carrier: ${caps.note}',
      );
    }
    final String? key = await keys.read(
      byokKeyName(AiByokProvider.gemini.name),
    );
    if (key == null || key.isEmpty) return byokNoKey(_carrier);
    return byokPost(
      carrier: _carrier,
      dio: _dio,
      uri: endpointFor(request.model),
      timeout: timeout,
      headers: <String, String>{'x-goog-api-key': key},
      body: <String, Object?>{
        'systemInstruction': <String, Object?>{
          'parts': <Object?>[
            <String, Object?>{'text': request.system},
          ],
        },
        'contents': <Object?>[
          <String, Object?>{
            'role': 'user',
            'parts': <Object?>[
              for (final AiImage img in request.images)
                <String, Object?>{
                  'inlineData': <String, Object?>{
                    'mimeType': img.mediaType,
                    'data': img.base64,
                  },
                },
              <String, Object?>{'text': request.input},
            ],
          },
        ],
        'generationConfig': <String, Object?>{
          'responseMimeType': 'application/json',
          'responseJsonSchema': request.schema,
          'maxOutputTokens': request.maxOutputTokens,
        },
      },
      onAnswer: (Map<String, Object?> json) {
        final Object? meta = json['usageMetadata'];
        final int cached = byokInt(meta, 'cachedContentTokenCount');
        final AiUsage u = AiUsage(
          inputTokens: byokInt(meta, 'promptTokenCount') - cached,
          outputTokens:
              byokInt(meta, 'candidatesTokenCount') +
              byokInt(meta, 'thoughtsTokenCount'),
          cacheReadTokens: cached,
        );
        final String served = json['modelVersion'] is String
            ? json['modelVersion']! as String
            : request.model;
        AiOutcome stop(AiStopReason r, String? text) => aiStoppedOutcome(
          carrier: _carrier,
          stopReason: r,
          text: text,
          schema: request.schema,
          usage: u,
          servedModel: served,
        );
        final Object? feedback = json['promptFeedback'];
        if (feedback is Map && feedback['blockReason'] != null) {
          return stop(AiStopReason.refusal, null);
        }
        final Object? candidates = json['candidates'];
        if (candidates is! List ||
            candidates.isEmpty ||
            candidates.first is! Map) {
          return stop(AiStopReason.other, null);
        }
        final Map<Object?, Object?> first =
            candidates.first! as Map<Object?, Object?>;
        final Object? reason = first['finishReason'];
        if (refusalReasons.contains(reason)) {
          return stop(AiStopReason.refusal, null);
        }
        if (reason == 'MAX_TOKENS') return stop(AiStopReason.maxTokens, null);
        if (reason != 'STOP') return stop(AiStopReason.other, null);
        final Object? content = first['content'];
        final Object? parts = content is Map ? content['parts'] : null;
        final StringBuffer text = StringBuffer();
        for (final Object? p in parts is List ? parts : const <Object?>[]) {
          if (p is Map && p['text'] is String && p['thought'] != true) {
            text.write(p['text']);
          }
        }
        return stop(
          AiStopReason.endTurn,
          text.isEmpty ? null : text.toString(),
        );
      },
    );
  }
}
