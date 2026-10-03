import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// The AI port's client seam (lib/src/ai/ai_provider.dart): the stop reason is
/// read before the content, and output that does not match the schema is never
/// a success. The same rules as services/_shared/src/ports/ai.ts.
void main() {
  const Map<String, Object?> schema = <String, Object?>{
    'type': 'object',
    'additionalProperties': false,
    'required': <Object?>['rows'],
    'properties': <String, Object?>{
      'rows': <String, Object?>{
        'type': 'array',
        'items': <String, Object?>{
          'type': 'object',
          'required': <Object?>['amount'],
          'properties': <String, Object?>{
            'amount': <String, Object?>{'type': 'number'},
          },
        },
      },
    },
  };
  const AiUsage usage = AiUsage(inputTokens: 10, outputTokens: 5);

  AiOutcome stopped(AiStopReason r, String? text) => aiStoppedOutcome(
    carrier: 'test',
    stopReason: r,
    text: text,
    schema: schema,
    usage: usage,
    servedModel: 'm',
  );

  test('an ended answer that validates is a success carrying the output', () {
    final AiOutcome out = stopped(
      AiStopReason.endTurn,
      '{"rows":[{"amount":9.99}]}',
    );
    expect(out, isA<AiSuccess>());
    expect((out as AiSuccess).output, <String, Object?>{
      'rows': <Object?>[
        <String, Object?>{'amount': 9.99},
      ],
    });
  });

  test(
    'a refusal and a truncation are failures with usage — even when the text would parse',
    () {
      const String valid = '{"rows":[]}';
      final AiOutcome refused = stopped(AiStopReason.refusal, valid);
      final AiOutcome truncated = stopped(AiStopReason.maxTokens, valid);
      expect(
        refused,
        isA<AiFailure>().having(
          (AiFailure f) => f.kind,
          'kind',
          AiFailureKind.refused,
        ),
      );
      expect(
        truncated,
        isA<AiFailure>().having(
          (AiFailure f) => f.kind,
          'kind',
          AiFailureKind.incomplete,
        ),
      );
      expect((truncated as AiFailure).usage, usage);
    },
  );

  test(
    'output that does not match the schema is invalid, and the detail names a path, never a value',
    () {
      final AiOutcome out = stopped(
        AiStopReason.endTurn,
        '{"rows":[{"amount":"Private nine"}]}',
      );
      expect(
        out,
        isA<AiFailure>().having(
          (AiFailure f) => f.kind,
          'kind',
          AiFailureKind.invalid,
        ),
      );
      expect((out as AiFailure).detail, contains(r'$.rows[0].amount'));
      expect(out.detail, isNot(contains('Private nine')));
      expect(
        aiSchemaProblem(schema, <String, Object?>{
          'rows': <Object?>[],
          'extra': 1,
        }),
        contains('unknown key'),
      );
    },
  );

  test(
    'a 429 and a 5xx are retryable; a 401 is unavailable; a 400 is invalid',
    () {
      expect(aiAnsweredOutcome('t', 429).kind, AiFailureKind.retryable);
      expect(aiAnsweredOutcome('t', 503).retryable, isTrue);
      expect(aiAnsweredOutcome('t', 401).kind, AiFailureKind.unavailable);
      expect(aiAnsweredOutcome('t', 400).kind, AiFailureKind.invalid);
    },
  );
}
