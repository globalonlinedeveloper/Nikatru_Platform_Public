/// THE OPENAI BRING-YOUR-OWN-KEY ADAPTER of the AI port's client half
/// (tooling/ports/ai.json, row `openai-byok`). The USER's key and account.
///
/// Plain HTTP over dio against the Responses API as documented (read
/// 2026-10-02, https://developers.openai.com/api/docs/guides/structured-outputs):
/// `POST https://api.openai.com/v1/responses` with a Bearer key, structured
/// output in `text.format` (`json_schema`, strict), and the edge cases read in
/// the order the docs give them — `status: incomplete` with
/// `incomplete_details.reason` (`max_output_tokens`, `content_filter`) BEFORE
/// the content, then a `refusal` item before any `output_text`.
/// `store: false`: the response is not kept at OpenAI for later retrieval.
/// OpenAI's `input_tokens` INCLUDES the cached part
/// (`input_tokens_details.cached_tokens`), so it is split here to keep the
/// port's meaning (uncached input + cache reads).
/// Not offered on web: OpenAI documents no browser access
/// ([AiByokCapabilities]).
library;

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart';

import '../http_capabilities.dart';
import 'ai_byok_capabilities.dart';
import 'byok_call.dart';

class OpenAiByok implements AiProvider {
  /// [transport] is the socket layer only, for tests; the adapter builds its OWN
  /// [Dio] around it, so no interceptor, header or logger of the app's can reach
  /// a request carrying the user's key. It never takes the app's Dio or RestClient.
  OpenAiByok({
    required this.keys,
    required this.platform,
    HttpClientAdapter? transport,
    this.timeout = byokCallTimeout,
  }) : _dio = byokDio(transport);

  final SecureStore keys;
  final Dio _dio;
  final HttpPlatform platform;
  final Duration timeout;

  static final Uri endpoint = Uri.parse('https://api.openai.com/v1/responses');
  static const String _carrier = 'OpenAI';

  @override
  String get id => 'openai-byok';

  @override
  Set<AiCapability> get capabilities => const <AiCapability>{
    AiCapability.structured,
    AiCapability.vision,
  };

  @override
  Future<AiOutcome> complete(AiRequest request) async {
    final AiByokCapabilities caps = AiByokCapabilities.forPlatform(
      platform,
      AiByokProvider.openai,
    );
    if (!caps.supported) {
      return AiFailure(
        kind: AiFailureKind.unavailable,
        retryable: false,
        detail: '$_carrier: ${caps.note}',
      );
    }
    final String? key = await keys.read(
      byokKeyName(AiByokProvider.openai.name),
    );
    if (key == null || key.isEmpty) return byokNoKey(_carrier);
    return byokPost(
      carrier: _carrier,
      dio: _dio,
      uri: endpoint,
      timeout: timeout,
      headers: <String, String>{'Authorization': 'Bearer $key'},
      body: <String, Object?>{
        'model': request.model,
        'instructions': request.system,
        'input': <Object?>[
          <String, Object?>{
            'role': 'user',
            'content': <Object?>[
              <String, Object?>{'type': 'input_text', 'text': request.input},
              for (final AiImage img in request.images)
                <String, Object?>{
                  'type': 'input_image',
                  'image_url': 'data:${img.mediaType};base64,${img.base64}',
                },
            ],
          },
        ],
        'text': <String, Object?>{
          'format': <String, Object?>{
            'type': 'json_schema',
            'name': 'output',
            'schema': request.schema,
            'strict': true,
          },
        },
        'max_output_tokens': request.maxOutputTokens,
        'store': false,
      },
      onAnswer: (Map<String, Object?> json) {
        final Object? usage = json['usage'];
        final Object? inputDetails = usage is Map
            ? usage['input_tokens_details']
            : null;
        final int cached = byokInt(inputDetails, 'cached_tokens');
        final AiUsage u = AiUsage(
          inputTokens: byokInt(usage, 'input_tokens') - cached,
          outputTokens: byokInt(usage, 'output_tokens'),
          cacheReadTokens: cached,
        );
        final String served = json['model'] is String
            ? json['model']! as String
            : request.model;
        AiOutcome stop(AiStopReason r, String? text) => aiStoppedOutcome(
          carrier: _carrier,
          stopReason: r,
          text: text,
          schema: request.schema,
          usage: u,
          servedModel: served,
        );
        if (json['status'] == 'incomplete') {
          final Object? details = json['incomplete_details'];
          final Object? reason = details is Map ? details['reason'] : null;
          return stop(
            reason == 'content_filter'
                ? AiStopReason.refusal
                : AiStopReason.maxTokens,
            null,
          );
        }
        if (json['status'] != 'completed') {
          return stop(AiStopReason.other, null);
        }
        String? text;
        for (final Object? item
            in json['output'] is List
                ? json['output']! as List<Object?>
                : const <Object?>[]) {
          if (item is! Map ||
              item['type'] != 'message' ||
              item['content'] is! List) {
            continue;
          }
          for (final Object? c in item['content']! as List<Object?>) {
            if (c is Map && c['type'] == 'refusal') {
              return stop(AiStopReason.refusal, null);
            }
            if (c is Map && c['type'] == 'output_text' && c['text'] is String) {
              text ??= c['text']! as String;
            }
          }
        }
        return stop(AiStopReason.endTurn, text);
      },
    );
  }
}
