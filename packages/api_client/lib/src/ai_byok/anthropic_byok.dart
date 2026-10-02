/// THE ANTHROPIC BRING-YOUR-OWN-KEY ADAPTER of the AI port's client half
/// (tooling/ports/ai.json, row `anthropic-byok`). The USER's key, the user's
/// account; we pay nothing and see nothing.
///
/// Plain HTTP over dio — Dart has no official Anthropic SDK. The wire is the
/// Messages API as documented (read 2026-10-02,
/// https://platform.claude.com/docs/en/api/overview and
/// https://platform.claude.com/docs/en/build-with-claude/structured-outputs):
/// `POST https://api.anthropic.com/v1/messages` with `x-api-key`,
/// `anthropic-version: 2023-06-01`, structured output in
/// `output_config.format`, the stable system prefix cached, an explicit effort
/// for Opus 5.5 and Sonnet 5.5 (never for Haiku 4.5, which refuses it), and on
/// those two the server-side refusal fallback in its "default" form. On web the
/// documented opt-in header rides along ([AiByokCapabilities]).
library;

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart';

import '../http_capabilities.dart';
import 'ai_byok_capabilities.dart';
import 'byok_call.dart';

class AnthropicByok implements AiProvider {
  /// [transport] is the socket layer only, for tests; the adapter builds its OWN
  /// [Dio] around it, so no interceptor, header or logger of the app's can reach
  /// a request carrying the user's key. It never takes the app's Dio or RestClient.
  AnthropicByok({
    required this.keys,
    required this.platform,
    HttpClientAdapter? transport,
    this.timeout = byokCallTimeout,
  }) : _dio = byokDio(transport);

  /// Where the user's key lives. Read on every call.
  final SecureStore keys;
  final Dio _dio;
  final HttpPlatform platform;
  final Duration timeout;

  static final Uri endpoint = Uri.parse(
    'https://api.anthropic.com/v1/messages',
  );
  static const String apiVersion = '2023-06-01';
  static const String fallbackBeta = 'server-side-fallback-2026-07-01';
  static const Set<String> effortModels = <String>{
    'claude-sonnet-5-5',
    'claude-opus-5-5',
  };
  static const String _carrier = 'Anthropic';

  @override
  String get id => 'anthropic-byok';

  @override
  Set<AiCapability> get capabilities => const <AiCapability>{
    AiCapability.structured,
    AiCapability.vision,
    AiCapability.cache,
  };

  @override
  Future<AiOutcome> complete(AiRequest request) async {
    final AiByokCapabilities caps = AiByokCapabilities.forPlatform(
      platform,
      AiByokProvider.anthropic,
    );
    if (!caps.supported) {
      return AiFailure(
        kind: AiFailureKind.unavailable,
        retryable: false,
        detail: '$_carrier: ${caps.note}',
      );
    }
    final String? key = await keys.read(
      byokKeyName(AiByokProvider.anthropic.name),
    );
    if (key == null || key.isEmpty) return byokNoKey(_carrier);
    final bool rich = effortModels.contains(request.model);
    return byokPost(
      carrier: _carrier,
      dio: _dio,
      uri: endpoint,
      timeout: timeout,
      headers: <String, String>{
        'x-api-key': key,
        'anthropic-version': apiVersion,
        if (rich) 'anthropic-beta': fallbackBeta,
        ...caps.browserHeaders,
      },
      body: <String, Object?>{
        'model': request.model,
        'max_tokens': request.maxOutputTokens,
        'system': <Object?>[
          <String, Object?>{
            'type': 'text',
            'text': request.system,
            'cache_control': <String, Object?>{'type': 'ephemeral'},
          },
        ],
        'messages': <Object?>[
          <String, Object?>{
            'role': 'user',
            'content': <Object?>[
              for (final AiImage img in request.images)
                <String, Object?>{
                  'type': 'image',
                  'source': <String, Object?>{
                    'type': 'base64',
                    'media_type': img.mediaType,
                    'data': img.base64,
                  },
                },
              <String, Object?>{'type': 'text', 'text': request.input},
            ],
          },
        ],
        'output_config': <String, Object?>{
          'format': <String, Object?>{
            'type': 'json_schema',
            'schema': request.schema,
          },
          if (rich) 'effort': request.effort ?? 'medium',
        },
        if (rich) 'fallbacks': 'default',
      },
      onAnswer: (Map<String, Object?> json) {
        final Object? usage = json['usage'];
        final List<Object?> content = json['content'] is List
            ? json['content']! as List<Object?>
            : const <Object?>[];
        String? text;
        for (final Object? block in content) {
          if (block is Map &&
              block['type'] == 'text' &&
              block['text'] is String) {
            text = block['text']! as String;
            break;
          }
        }
        return aiStoppedOutcome(
          carrier: _carrier,
          stopReason: switch (json['stop_reason']) {
            'end_turn' => AiStopReason.endTurn,
            'max_tokens' => AiStopReason.maxTokens,
            'refusal' => AiStopReason.refusal,
            'pause_turn' => AiStopReason.pauseTurn,
            _ => AiStopReason.other,
          },
          text: text,
          schema: request.schema,
          usage: AiUsage(
            inputTokens: byokInt(usage, 'input_tokens'),
            outputTokens: byokInt(usage, 'output_tokens'),
            cacheReadTokens: byokInt(usage, 'cache_read_input_tokens'),
            cacheWriteTokens: byokInt(usage, 'cache_creation_input_tokens'),
          ),
          servedModel: json['model'] is String
              ? json['model']! as String
              : request.model,
        );
      },
    );
  }
}
