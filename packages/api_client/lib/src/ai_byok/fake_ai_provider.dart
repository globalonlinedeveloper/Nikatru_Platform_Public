/// THE BRING-YOUR-OWN-KEY FAKE (tooling/ports/ai.json, row `byok-fake`): an
/// [AiProvider] that answers what a test scripted and calls no provider.
///
/// Selectable in `test` and `sandbox` only (assert-ports limb 7 refuses it in
/// live). It reads its key from [SecureStore] exactly as a real adapter does,
/// so "no key, no call" holds of it too, and it COUNTS what reached its pretend
/// wire. It passes the same conformance suite as the three real adapters
/// (packages/api_client/test/ai_byok_conformance_test.dart).
library;

import 'package:nikatru_core/nikatru_core.dart';

import 'byok_call.dart';

/// One scripted answer.
sealed class FakeAiAnswer {
  const FakeAiAnswer();
}

final class FakeAiStop extends FakeAiAnswer {
  const FakeAiStop(
    this.stopReason,
    this.text, {
    this.usage = FakeAiProvider.defaultUsage,
  });
  final AiStopReason stopReason;
  final String? text;
  final AiUsage usage;
}

final class FakeAiStatus extends FakeAiAnswer {
  const FakeAiStatus(this.status);
  final int status;
}

final class FakeAiUnreachable extends FakeAiAnswer {
  const FakeAiUnreachable();
}

class FakeAiProvider implements AiProvider {
  FakeAiProvider({required this.keys, this.defaultText = '{}'});

  final SecureStore keys;

  /// The text an unscripted call ends with.
  final String defaultText;

  /// The pretend host every call "reaches".
  static const String host = 'ai-fake.invalid';
  static const AiUsage defaultUsage = AiUsage(
    inputTokens: 120,
    outputTokens: 30,
  );
  static const String _carrier = 'fake ai';

  final List<FakeAiAnswer> _queue = <FakeAiAnswer>[];
  final List<AiRequest> requests = <AiRequest>[];

  /// Calls that reached the pretend wire (after a key was found).
  int get calls => requests.length;

  /// Queue the next answer.
  void answer(FakeAiAnswer next) => _queue.add(next);

  @override
  String get id => 'byok-fake';

  @override
  Set<AiCapability> get capabilities => const <AiCapability>{
    AiCapability.structured,
    AiCapability.vision,
  };

  @override
  Future<AiOutcome> complete(AiRequest request) async {
    final String? key = await keys.read(byokKeyName('fake'));
    if (key == null || key.isEmpty) return byokNoKey(_carrier);
    requests.add(request);
    final FakeAiAnswer next = _queue.isEmpty
        ? FakeAiStop(AiStopReason.endTurn, defaultText)
        : _queue.removeAt(0);
    return switch (next) {
      FakeAiStatus(:final int status) => aiAnsweredOutcome(_carrier, status),
      FakeAiUnreachable() => const AiFailure(
        kind: AiFailureKind.timeout,
        retryable: false,
        detail: '$_carrier not reached: connectionError',
      ),
      FakeAiStop(
        :final AiStopReason stopReason,
        :final String? text,
        :final AiUsage usage,
      ) =>
        aiStoppedOutcome(
          carrier: _carrier,
          stopReason: stopReason,
          text: text,
          schema: request.schema,
          usage: usage,
          servedModel: request.model,
        ),
    };
  }
}
