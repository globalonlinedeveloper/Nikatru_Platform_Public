import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/ai_byok.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show HttpPlatform;
import 'package:nikatru_api_client/testing.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// The AI port's client half (tooling/ports/ai.json, `half: client`): the
/// three bring-your-own-key adapters and the fake each pass
/// runAiProviderConformance over RECORDED bytes of their provider, with no
/// network. The bodies follow each provider's documentation, read 2026-10-02:
///   · Anthropic — https://platform.claude.com/docs/en/build-with-claude/structured-outputs
///     and https://platform.claude.com/docs/en/api/errors;
///   · OpenAI — https://developers.openai.com/api/docs/guides/structured-outputs
///     (`status`, `incomplete_details.reason`, `refusal` / `output_text` items);
///   · Gemini — https://ai.google.dev/api/generate-content (`candidates`,
///     `finishReason`, `promptFeedback.blockReason`, `usageMetadata`).
/// OpenAI and Gemini model ids here are fixture placeholders: which model a user
/// runs is their configuration, and modelFromConfig only asks that it be sent.

/// The sentinel key. Low-entropy on purpose; never a real one.
const String _sentinel = 'sentinel-never-logged-sentinel-never-logged';

/// Our own domain, from the entity source — the host no request may target.
final String _ownerDomain = _readOwnerDomain();

String _readOwnerDomain() {
  final Object? house = jsonDecode(
    File('../../tooling/house-identity.json').readAsStringSync(),
  );
  final Object? owner = house is Map ? house['ownerDomain'] : null;
  final Object? value = owner is Map ? owner['value'] : null;
  if (value is! String || !value.contains('.')) {
    throw StateError(
      'tooling/house-identity.json has no ownerDomain.value: the host check would compare against nothing',
    );
  }
  return value;
}

const AiUsage _cached = AiUsage(
  inputTokens: 42,
  outputTokens: 17,
  cacheReadTokens: 2048,
  cacheWriteTokens: 512,
);

/// One recorded answer: a status and a body, or no answer.
class _Answer {
  const _Answer(this.status, this.body);
  const _Answer.unreachable() : status = 0, body = null;
  final int status;
  final Object? body;
}

class _Seen {
  _Seen(this.uri, this.headers, this.body);
  final Uri uri;
  final Map<String, dynamic> headers;
  final Map<String, Object?> body;
}

/// A carrier answering each request with the next of [answers] (the last repeats).
class _Carrier implements HttpClientAdapter {
  _Carrier(this.answers);
  final List<_Answer> answers;
  final List<_Seen> seen = <_Seen>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final List<int> bytes = <int>[];
    if (requestStream != null) {
      await for (final Uint8List chunk in requestStream) {
        bytes.addAll(chunk);
      }
    }
    final Object? body = bytes.isEmpty
        ? options.data is String
              ? jsonDecode(options.data as String)
              : null
        : jsonDecode(utf8.decode(bytes));
    seen.add(
      _Seen(
        options.uri,
        options.headers,
        (body ?? <String, Object?>{}) as Map<String, Object?>,
      ),
    );
    final _Answer a = answers[(seen.length - 1).clamp(0, answers.length - 1)];
    if (a.body == null && a.status == 0) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'fixture: unreachable',
      );
    }
    return ResponseBody.fromString(
      jsonEncode(a.body),
      a.status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

/// A transport that sends every request to [to] instead — the mutation the
/// noNikatruHost red control needs, now that an adapter takes no Dio to bend.
class _Redirect implements HttpClientAdapter {
  _Redirect(this.inner, this.to);
  final HttpClientAdapter inner;
  final Uri to;

  @override
  void close({bool force = false}) => inner.close(force: force);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) => inner.fetch(
    options.copyWith(path: to.toString()),
    requestStream,
    cancelFuture,
  );
}

// ── recorded bodies ────────────────────────────────────────────────────────────

Map<String, Object?> _anthropicMessage(
  String stop,
  String? text, {
  AiUsage usage = const AiUsage(inputTokens: 123, outputTokens: 45),
}) => <String, Object?>{
  'id': 'msg_fixture',
  'type': 'message',
  'role': 'assistant',
  'model': 'claude-haiku-4-5',
  'content': <Object?>[
    <String, Object?>{
      'type': 'thinking',
      'thinking': '',
      'signature': 'fixture-signature',
    },
    if (text != null) <String, Object?>{'type': 'text', 'text': text},
  ],
  'stop_reason': stop,
  'stop_sequence': null,
  'usage': <String, Object?>{
    'input_tokens': usage.inputTokens,
    'output_tokens': usage.outputTokens,
    'cache_read_input_tokens': usage.cacheReadTokens,
    'cache_creation_input_tokens': usage.cacheWriteTokens,
  },
};

Map<String, Object?> _anthropicError(String type) => <String, Object?>{
  'type': 'error',
  'error': <String, Object?>{'type': type, 'message': 'fixture'},
  'request_id': 'req_fixture',
};

Map<String, Object?> _openAiResponse({
  String status = 'completed',
  String? reason,
  Object? content,
  int input = 2090,
  int cached = 2048,
  int output = 17,
}) => <String, Object?>{
  'id': 'resp_fixture',
  'object': 'response',
  'status': status,
  if (reason != null) 'incomplete_details': <String, Object?>{'reason': reason},
  'model': 'fixture-model-a',
  'output': <Object?>[
    <String, Object?>{
      'type': 'message',
      'id': 'msg_fixture',
      'role': 'assistant',
      'content': <Object?>[?content],
    },
  ],
  'usage': <String, Object?>{
    'input_tokens': input,
    'input_tokens_details': <String, Object?>{'cached_tokens': cached},
    'output_tokens': output,
    'total_tokens': input + output,
  },
};

Map<String, Object?> _openAiText(String text) => <String, Object?>{
  'type': 'output_text',
  'text': text,
  'annotations': <Object?>[],
};

Map<String, Object?> _openAiError(String type) => <String, Object?>{
  'error': <String, Object?>{
    'message': 'fixture',
    'type': type,
    'param': null,
    'code': null,
  },
};

Map<String, Object?> _geminiResponse({
  String finish = 'STOP',
  String? text,
  String? block,
  int prompt = 2090,
  int cached = 2048,
  int candidates = 12,
  int thoughts = 5,
}) => <String, Object?>{
  if (block == null)
    'candidates': <Object?>[
      <String, Object?>{
        'content': <String, Object?>{
          'role': 'model',
          'parts': <Object?>[
            if (text != null) <String, Object?>{'text': text},
          ],
        },
        'finishReason': finish,
        'index': 0,
      },
    ],
  if (block != null) 'promptFeedback': <String, Object?>{'blockReason': block},
  'usageMetadata': <String, Object?>{
    'promptTokenCount': prompt,
    'cachedContentTokenCount': cached,
    'candidatesTokenCount': candidates,
    'thoughtsTokenCount': thoughts,
    'totalTokenCount': prompt + candidates + thoughts,
  },
  'modelVersion': 'fixture-model-a',
};

Map<String, Object?> _geminiError(int code, String status) => <String, Object?>{
  'error': <String, Object?>{
    'code': code,
    'message': 'fixture',
    'status': status,
  },
};

// ── harnesses ──────────────────────────────────────────────────────────────────

typedef _Build =
    AiProvider Function(SecureStore keys, HttpClientAdapter transport);

AiProviderHarness _over(
  _Build build,
  SecureStore keys,
  List<_Answer> answers, {
  AiUsage? expectedUsage,
  required bool modelInPath,
}) {
  final _Carrier carrier = _Carrier(answers);
  return AiProviderHarness(
    provider: build(keys, carrier),
    calls: () => carrier.seen.length,
    models: () => carrier.seen
        .map(
          (_Seen s) => modelInPath
              ? Uri.decodeComponent(s.uri.pathSegments.last.split(':').first)
              : s.body['model']! as String,
        )
        .toList(),
    hosts: () => carrier.seen.map((_Seen s) => s.uri.host).toList(),
    expectedUsage: expectedUsage,
  );
}

AiProviderConformanceSubject _subject({
  required String adapter,
  required String keyName,
  required String modelA,
  required String modelB,
  required _Build build,
  required bool modelInPath,
  required Map<AiProviderScenario, List<_Answer>> answers,
  required AiUsage expectedUsage,
}) => AiProviderConformanceSubject(
  adapter: adapter,
  keyName: keyName,
  secret: _sentinel,
  ownerDomain: _ownerDomain,
  modelA: modelA,
  modelB: modelB,
  fixtures: <AiProviderScenario, AiProviderHarness Function(SecureStore)>{
    for (final AiProviderScenario s in AiProviderScenario.values)
      s: (SecureStore keys) => _over(
        build,
        keys,
        answers[s] ?? answers[AiProviderScenario.structuredRows]!,
        expectedUsage: s == AiProviderScenario.usageReported
            ? expectedUsage
            : null,
        modelInPath: modelInPath,
      ),
  },
);

void main() {
  // ── Anthropic ──
  runAiProviderConformance(
    _subject(
      adapter: 'anthropic-byok',
      keyName: byokKeyName('anthropic'),
      modelA: 'claude-haiku-4-5',
      modelB: 'claude-opus-5-5',
      modelInPath: false,
      build: (SecureStore keys, HttpClientAdapter transport) => AnthropicByok(
        keys: keys,
        transport: transport,
        platform: HttpPlatform.android,
      ),
      expectedUsage: _cached,
      answers: <AiProviderScenario, List<_Answer>>{
        AiProviderScenario.structuredRows: <_Answer>[
          _Answer(200, _anthropicMessage('end_turn', aiConformanceRowsText)),
        ],
        AiProviderScenario.refusal: <_Answer>[
          _Answer(
            200,
            _anthropicMessage('refusal', 'I can not help with that.'),
          ),
        ],
        AiProviderScenario.maxTokens: <_Answer>[
          _Answer(
            200,
            _anthropicMessage('max_tokens', aiConformanceTruncatedText),
          ),
        ],
        AiProviderScenario.usageReported: <_Answer>[
          _Answer(
            200,
            _anthropicMessage(
              'end_turn',
              aiConformanceRowsText,
              usage: _cached,
            ),
          ),
        ],
        AiProviderScenario.keyNotLogged: <_Answer>[
          _Answer(200, _anthropicMessage('end_turn', aiConformanceRowsText)),
          _Answer(429, _anthropicError('rate_limit_error')),
          _Answer(400, _anthropicError('invalid_request_error')),
          _Answer(500, _anthropicError('api_error')),
          const _Answer.unreachable(),
        ],
        AiProviderScenario.rateLimited: <_Answer>[
          _Answer(429, _anthropicError('rate_limit_error')),
        ],
        AiProviderScenario.serverError: <_Answer>[
          _Answer(529, _anthropicError('overloaded_error')),
        ],
        AiProviderScenario.badRequest: <_Answer>[
          _Answer(400, _anthropicError('invalid_request_error')),
        ],
      },
    ),
    group: group,
    test: test,
  );

  // ── OpenAI ──
  runAiProviderConformance(
    _subject(
      adapter: 'openai-byok',
      keyName: byokKeyName('openai'),
      modelA: 'fixture-model-a',
      modelB: 'fixture-model-b',
      modelInPath: false,
      build: (SecureStore keys, HttpClientAdapter transport) => OpenAiByok(
        keys: keys,
        transport: transport,
        platform: HttpPlatform.iOS,
      ),
      expectedUsage: const AiUsage(
        inputTokens: 42,
        outputTokens: 17,
        cacheReadTokens: 2048,
      ),
      answers: <AiProviderScenario, List<_Answer>>{
        AiProviderScenario.structuredRows: <_Answer>[
          _Answer(
            200,
            _openAiResponse(content: _openAiText(aiConformanceRowsText)),
          ),
        ],
        AiProviderScenario.refusal: <_Answer>[
          _Answer(
            200,
            _openAiResponse(
              content: <String, Object?>{
                'type': 'refusal',
                'refusal': "I'm sorry, I cannot assist with that request.",
              },
            ),
          ),
        ],
        AiProviderScenario.maxTokens: <_Answer>[
          _Answer(
            200,
            _openAiResponse(
              status: 'incomplete',
              reason: 'max_output_tokens',
              content: _openAiText(aiConformanceTruncatedText),
            ),
          ),
        ],
        AiProviderScenario.usageReported: <_Answer>[
          _Answer(
            200,
            _openAiResponse(content: _openAiText(aiConformanceRowsText)),
          ),
        ],
        AiProviderScenario.keyNotLogged: <_Answer>[
          _Answer(
            200,
            _openAiResponse(content: _openAiText(aiConformanceRowsText)),
          ),
          _Answer(429, _openAiError('rate_limit_error')),
          _Answer(400, _openAiError('invalid_request_error')),
          _Answer(500, _openAiError('server_error')),
          const _Answer.unreachable(),
        ],
        AiProviderScenario.rateLimited: <_Answer>[
          _Answer(429, _openAiError('rate_limit_error')),
        ],
        AiProviderScenario.serverError: <_Answer>[
          _Answer(500, _openAiError('server_error')),
        ],
        AiProviderScenario.badRequest: <_Answer>[
          _Answer(400, _openAiError('invalid_request_error')),
        ],
      },
    ),
    group: group,
    test: test,
  );

  // ── Gemini ──
  runAiProviderConformance(
    _subject(
      adapter: 'gemini-byok',
      keyName: byokKeyName('gemini'),
      modelA: 'fixture-model-a',
      modelB: 'fixture-model-b',
      modelInPath: true,
      build: (SecureStore keys, HttpClientAdapter transport) => GeminiByok(
        keys: keys,
        transport: transport,
        platform: HttpPlatform.linux,
      ),
      expectedUsage: const AiUsage(
        inputTokens: 42,
        outputTokens: 17,
        cacheReadTokens: 2048,
      ),
      answers: <AiProviderScenario, List<_Answer>>{
        AiProviderScenario.structuredRows: <_Answer>[
          _Answer(200, _geminiResponse(text: aiConformanceRowsText)),
        ],
        AiProviderScenario.refusal: <_Answer>[
          _Answer(200, _geminiResponse(block: 'SAFETY')),
        ],
        AiProviderScenario.maxTokens: <_Answer>[
          _Answer(
            200,
            _geminiResponse(
              finish: 'MAX_TOKENS',
              text: aiConformanceTruncatedText,
            ),
          ),
        ],
        AiProviderScenario.usageReported: <_Answer>[
          _Answer(200, _geminiResponse(text: aiConformanceRowsText)),
        ],
        AiProviderScenario.keyNotLogged: <_Answer>[
          _Answer(200, _geminiResponse(text: aiConformanceRowsText)),
          _Answer(429, _geminiError(429, 'RESOURCE_EXHAUSTED')),
          _Answer(400, _geminiError(400, 'INVALID_ARGUMENT')),
          _Answer(503, _geminiError(503, 'UNAVAILABLE')),
          const _Answer.unreachable(),
        ],
        AiProviderScenario.rateLimited: <_Answer>[
          _Answer(429, _geminiError(429, 'RESOURCE_EXHAUSTED')),
        ],
        AiProviderScenario.serverError: <_Answer>[
          _Answer(500, _geminiError(500, 'INTERNAL')),
        ],
        AiProviderScenario.badRequest: <_Answer>[
          _Answer(400, _geminiError(400, 'INVALID_ARGUMENT')),
        ],
      },
    ),
    group: group,
    test: test,
  );

  // ── the fake ──
  runAiProviderConformance(
    AiProviderConformanceSubject(
      adapter: 'byok-fake',
      keyName: byokKeyName('fake'),
      secret: _sentinel,
      ownerDomain: _ownerDomain,
      modelA: 'fixture-model-a',
      modelB: 'fixture-model-b',
      fixtures: <AiProviderScenario, AiProviderHarness Function(SecureStore)>{
        for (final AiProviderScenario s in AiProviderScenario.values)
          s: (SecureStore keys) {
            final FakeAiProvider f = FakeAiProvider(
              keys: keys,
              defaultText: aiConformanceRowsText,
            );
            switch (s) {
              case AiProviderScenario.refusal:
                f.answer(const FakeAiStop(AiStopReason.refusal, null));
              case AiProviderScenario.maxTokens:
                f.answer(
                  const FakeAiStop(
                    AiStopReason.maxTokens,
                    aiConformanceTruncatedText,
                  ),
                );
              case AiProviderScenario.usageReported:
                f.answer(
                  const FakeAiStop(
                    AiStopReason.endTurn,
                    aiConformanceRowsText,
                    usage: _cached,
                  ),
                );
              case AiProviderScenario.keyNotLogged:
                for (final FakeAiAnswer a in const <FakeAiAnswer>[
                  FakeAiStop(AiStopReason.endTurn, aiConformanceRowsText),
                  FakeAiStatus(429),
                  FakeAiStatus(400),
                  FakeAiStatus(503),
                  FakeAiUnreachable(),
                ]) {
                  f.answer(a);
                }
              case AiProviderScenario.rateLimited:
                f.answer(const FakeAiStatus(429));
              case AiProviderScenario.serverError:
                f.answer(const FakeAiStatus(503));
              case AiProviderScenario.badRequest:
                f.answer(const FakeAiStatus(400));
              default:
                break;
            }
            return AiProviderHarness(
              provider: f,
              calls: () => f.calls,
              models: () => f.requests.map((AiRequest r) => r.model).toList(),
              hosts: () => List<String>.filled(f.calls, FakeAiProvider.host),
              expectedUsage: s == AiProviderScenario.usageReported
                  ? _cached
                  : null,
            );
          },
      },
    ),
    group: group,
    test: test,
  );

  group('the bring-your-own-key wire', () {
    InMemorySecureStore keyed(String provider) =>
        InMemorySecureStore(<String, String>{byokKeyName(provider): _sentinel});
    final List<_Answer> ok = <_Answer>[
      _Answer(200, _anthropicMessage('end_turn', aiConformanceRowsText)),
    ];

    test(
      '🔴 every adapter targets its provider\'s documented host, and none a Nikatru host',
      () async {
        final Map<String, String> want = <String, String>{
          'anthropic-byok': 'api.anthropic.com',
          'openai-byok': 'api.openai.com',
          'gemini-byok': 'generativelanguage.googleapis.com',
        };
        final Map<String, AiProvider Function(HttpClientAdapter)> adapters =
            <String, AiProvider Function(HttpClientAdapter)>{
              'anthropic-byok': (HttpClientAdapter d) => AnthropicByok(
                keys: keyed('anthropic'),
                transport: d,
                platform: HttpPlatform.macOS,
              ),
              'openai-byok': (HttpClientAdapter d) => OpenAiByok(
                keys: keyed('openai'),
                transport: d,
                platform: HttpPlatform.macOS,
              ),
              'gemini-byok': (HttpClientAdapter d) => GeminiByok(
                keys: keyed('gemini'),
                transport: d,
                platform: HttpPlatform.macOS,
              ),
            };
        for (final MapEntry<String, AiProvider Function(HttpClientAdapter)> e
            in adapters.entries) {
          final _Carrier c = _Carrier(ok);
          await e.value(c).complete(aiConformanceRequest('fixture-model-a'));
          expect(c.seen.map((_Seen s) => s.uri.host), <String>[
            want[e.key]!,
          ], reason: e.key);
          expect(c.seen.single.uri.scheme, 'https', reason: e.key);
          expect(
            c.seen.single.uri.host.endsWith(_ownerDomain),
            isFalse,
            reason: e.key,
          );
        }
      },
    );

    test(
      'the key is read from SecureStore on EVERY call: removed, the next call sends nothing',
      () async {
        final InMemorySecureStore keys = keyed('anthropic');
        final _Carrier c = _Carrier(ok);
        final AnthropicByok ai = AnthropicByok(
          keys: keys,
          transport: c,
          platform: HttpPlatform.windows,
        );
        expect(
          await ai.complete(aiConformanceRequest('claude-haiku-4-5')),
          isA<AiSuccess>(),
        );
        // "match" / "no match" only: the key is never printed, even by a test.
        expect(
          c.seen.single.headers['x-api-key'] == _sentinel
              ? 'match'
              : 'no match',
          'match',
        );
        await keys.delete(byokKeyName('anthropic'));
        final AiOutcome after = await ai.complete(
          aiConformanceRequest('claude-haiku-4-5'),
        );
        expect(
          after,
          isA<AiFailure>().having(
            (AiFailure f) => f.kind,
            'kind',
            AiFailureKind.unavailable,
          ),
        );
        expect(c.seen, hasLength(1));
      },
    );

    test(
      'on web, Anthropic sends its documented browser opt-in header; OpenAI and Gemini send nothing at all',
      () async {
        final _Carrier a = _Carrier(ok);
        await AnthropicByok(
          keys: keyed('anthropic'),
          transport: a,
          platform: HttpPlatform.web,
        ).complete(aiConformanceRequest('claude-haiku-4-5'));
        expect(
          a.seen.single.headers['anthropic-dangerous-direct-browser-access'],
          'true',
        );
        for (final AiProvider Function(HttpClientAdapter) build
            in <AiProvider Function(HttpClientAdapter)>[
              (HttpClientAdapter d) => OpenAiByok(
                keys: keyed('openai'),
                transport: d,
                platform: HttpPlatform.web,
              ),
              (HttpClientAdapter d) => GeminiByok(
                keys: keyed('gemini'),
                transport: d,
                platform: HttpPlatform.web,
              ),
            ]) {
          final _Carrier c = _Carrier(ok);
          final AiOutcome out = await build(
            c,
          ).complete(aiConformanceRequest('fixture-model-a'));
          expect(
            out,
            isA<AiFailure>().having(
              (AiFailure f) => f.kind,
              'kind',
              AiFailureKind.unavailable,
            ),
          );
          expect(c.seen, isEmpty);
        }
      },
    );

    test(
      'Anthropic: an explicit effort and the "default" refusal fallback for Opus 5.5, neither for Haiku 4.5',
      () async {
        final _Carrier opus = _Carrier(ok);
        await AnthropicByok(
          keys: keyed('anthropic'),
          transport: opus,
          platform: HttpPlatform.linux,
        ).complete(aiConformanceRequest('claude-opus-5-5'));
        expect(
          (opus.seen.single.body['output_config']!
              as Map<String, Object?>)['effort'],
          'medium',
        );
        expect(opus.seen.single.body['fallbacks'], 'default');
        expect(
          opus.seen.single.headers['anthropic-beta'],
          AnthropicByok.fallbackBeta,
        );
        final _Carrier haiku = _Carrier(ok);
        await AnthropicByok(
          keys: keyed('anthropic'),
          transport: haiku,
          platform: HttpPlatform.linux,
        ).complete(aiConformanceRequest('claude-haiku-4-5'));
        expect(
          (haiku.seen.single.body['output_config']! as Map<String, Object?>)
              .containsKey('effort'),
          isFalse,
        );
        expect(haiku.seen.single.body.containsKey('fallbacks'), isFalse);
      },
    );

    test(
      'OpenAI: the response is not stored at the provider, and Gemini\'s key never rides in the URL',
      () async {
        final _Carrier o = _Carrier(<_Answer>[
          _Answer(
            200,
            _openAiResponse(content: _openAiText(aiConformanceRowsText)),
          ),
        ]);
        await OpenAiByok(
          keys: keyed('openai'),
          transport: o,
          platform: HttpPlatform.android,
        ).complete(aiConformanceRequest('fixture-model-a'));
        expect(o.seen.single.body['store'], isFalse);
        final _Carrier g = _Carrier(<_Answer>[
          _Answer(200, _geminiResponse(text: aiConformanceRowsText)),
        ]);
        await GeminiByok(
          keys: keyed('gemini'),
          transport: g,
          platform: HttpPlatform.android,
        ).complete(aiConformanceRequest('fixture-model-a'));
        expect(
          g.seen.single.uri.toString().contains(_sentinel)
              ? 'match'
              : 'no match',
          'no match',
        );
        expect(g.seen.single.uri.queryParameters, isEmpty);
      },
    );
  });

  group('the client suite reddens', () {
    test(
      '🔴 an adapter pointed at a Nikatru host fails noNikatruHost',
      () async {
        final _Carrier c = _Carrier(<_Answer>[
          _Answer(200, _anthropicMessage('end_turn', aiConformanceRowsText)),
        ]);
        final _Redirect redirect = _Redirect(
          c,
          Uri.parse('https://api.$_ownerDomain/v1/messages'),
        );
        final AnthropicByok ai = AnthropicByok(
          keys: InMemorySecureStore(<String, String>{
            byokKeyName('anthropic'): _sentinel,
          }),
          transport: redirect,
          platform: HttpPlatform.android,
        );
        final AiProviderHarness h = AiProviderHarness(
          provider: ai,
          calls: () => c.seen.length,
          models: () => <String>[],
          hosts: () => c.seen.map((_Seen s) => s.uri.host).toList(),
        );
        await expectLater(
          checkAiProviderScenario(
            AiProviderScenario.noNikatruHost,
            h,
            AiProviderConformanceSubject(
              adapter: 'mutated',
              keyName: byokKeyName('anthropic'),
              secret: _sentinel,
              ownerDomain: _ownerDomain,
              modelA: 'claude-haiku-4-5',
              modelB: 'claude-opus-5-5',
              fixtures:
                  const <
                    AiProviderScenario,
                    AiProviderHarness Function(SecureStore)
                  >{},
            ),
          ),
          throwsA(
            isA<AiConformanceFailure>().having(
              (AiConformanceFailure f) => f.message,
              'message',
              contains('a Nikatru host'),
            ),
          ),
        );
      },
    );

    test(
      '🔴 a fake that returns rows on a max_tokens stop fails maxTokens',
      () async {
        final FakeAiProvider f = FakeAiProvider(
          keys: InMemorySecureStore(<String, String>{
            byokKeyName('fake'): _sentinel,
          }),
        );
        final AiProvider rowsAnyway = _RowsOnTruncation(f);
        final AiProviderHarness h = AiProviderHarness(
          provider: rowsAnyway,
          calls: () => f.calls,
          models: () => <String>[],
          hosts: () => <String>[],
        );
        f.answer(
          const FakeAiStop(AiStopReason.maxTokens, aiConformanceTruncatedText),
        );
        await expectLater(
          checkAiProviderScenario(
            AiProviderScenario.maxTokens,
            h,
            _plainSubject,
          ),
          throwsA(
            isA<AiConformanceFailure>().having(
              (AiConformanceFailure e) => e.message,
              'message',
              contains('got a success'),
            ),
          ),
        );
      },
    );

    test('a missing fixture throws at registration — never a skip', () {
      expect(
        () => runAiProviderConformance(
          _plainSubject,
          group: (_, _) {},
          test: (_, _) {},
        ),
        throwsA(isA<AiConformanceFailure>()),
      );
    });
  });
}

final AiProviderConformanceSubject _plainSubject = AiProviderConformanceSubject(
  adapter: 'mutated',
  keyName: byokKeyName('fake'),
  secret: _sentinel,
  ownerDomain: _ownerDomain,
  modelA: 'fixture-model-a',
  modelB: 'fixture-model-b',
  fixtures:
      const <AiProviderScenario, AiProviderHarness Function(SecureStore)>{},
);

/// The mutation: read the content before the stop reason, and keep what parses.
class _RowsOnTruncation implements AiProvider {
  _RowsOnTruncation(this.inner);
  final AiProvider inner;
  @override
  String get id => inner.id;
  @override
  Set<AiCapability> get capabilities => inner.capabilities;
  @override
  Future<AiOutcome> complete(AiRequest request) async {
    final AiOutcome out = await inner.complete(request);
    if (out is AiFailure && out.stopReason == AiStopReason.maxTokens) {
      return AiSuccess(
        output: const <String, Object?>{'rows': <Object?>[]},
        usage: out.usage!,
        servedModel: request.model,
      );
    }
    return out;
  }
}
