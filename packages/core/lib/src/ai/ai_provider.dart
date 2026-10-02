/// THE AI PORT, CLIENT HALF — the seam an app asks a model through when the
/// user brings their OWN provider key (tooling/ports/ai.json, `half: client`).
///
/// The server half is `services/_shared/src/ports/ai.ts` (OUR key, metered by
/// train-st-ai-customer-pays); this is its Dart twin, and the outcomes mean the
/// same thing on both sides:
///   · [AiSuccess]   — the model finished and its output parsed and validated
///                     against the request's schema. Only a success carries
///                     output.
///   · [AiFailure]   — refused (the model declined), incomplete (it stopped
///                     before finishing: a truncated JSON is never rows),
///                     retryable (429, 5xx), invalid (400-class, or output that
///                     does not validate), unavailable (no key, the credential
///                     refused, or the provider documents no access from this
///                     platform), timeout (no answer).
///
/// 🔴 THE STOP REASON IS READ BEFORE THE CONTENT — [aiStoppedOutcome] is that
/// rule, and every adapter goes through it.
/// 🔴 A DETAIL CARRIES NO KEY AND NO CONTENT: the provider and the status only.
///
/// Adapters (packages/api_client `lib/ai_byok.dart`) take the key from
/// [SecureStore] on every call; there is no default key and no server hop.
/// Pure Dart: no Flutter, no vendor.
library;

import 'dart:convert';

/// What an adapter can do. Declared, never assumed.
enum AiCapability { structured, vision, cache }

/// Why the model stopped, read before anything else in its answer.
enum AiStopReason { endTurn, maxTokens, refusal, pauseTurn, other }

/// The ways a call can fail. Every one is an outcome; nothing throws.
enum AiFailureKind {
  refused,
  incomplete,
  retryable,
  invalid,
  unavailable,
  timeout,
}

class AiImage {
  const AiImage({required this.mediaType, required this.base64});

  /// `image/png`, `image/jpeg`, `image/webp` or `image/gif`.
  final String mediaType;

  /// Base64, no `data:` prefix.
  final String base64;
}

class AiRequest {
  const AiRequest({
    required this.feature,
    required this.model,
    required this.system,
    required this.input,
    required this.schema,
    required this.maxOutputTokens,
    this.images = const <AiImage>[],
    this.effort,
  });

  /// The feature asking (ai.json `features`), for the record — never routing.
  final String feature;

  /// From config, never a constant in an adapter.
  final String model;

  /// The STABLE instructions; a provider that caches caches this prefix.
  final String system;

  /// The per-call input the user handed over.
  final String input;
  final List<AiImage> images;

  /// The output's shape (JSON Schema). The output is validated against it.
  final Map<String, Object?> schema;
  final int maxOutputTokens;

  /// `low` … `max`, for a model that takes an effort setting.
  final String? effort;
}

class AiUsage {
  const AiUsage({
    required this.inputTokens,
    required this.outputTokens,
    this.cacheReadTokens = 0,
    this.cacheWriteTokens = 0,
  });

  /// Uncached input. A cache read is counted in [cacheReadTokens], never twice.
  final int inputTokens;
  final int outputTokens;
  final int cacheReadTokens;
  final int cacheWriteTokens;

  @override
  bool operator ==(Object other) =>
      other is AiUsage &&
      other.inputTokens == inputTokens &&
      other.outputTokens == outputTokens &&
      other.cacheReadTokens == cacheReadTokens &&
      other.cacheWriteTokens == cacheWriteTokens;

  @override
  int get hashCode =>
      Object.hash(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);

  @override
  String toString() =>
      'AiUsage(in: $inputTokens, out: $outputTokens, '
      'cacheRead: $cacheReadTokens, cacheWrite: $cacheWriteTokens)';
}

sealed class AiOutcome {
  const AiOutcome();
}

final class AiSuccess extends AiOutcome {
  const AiSuccess({
    required this.output,
    required this.usage,
    required this.servedModel,
  });

  final Object? output;
  final AiUsage usage;

  /// The model that served the call.
  final String servedModel;
}

final class AiFailure extends AiOutcome {
  const AiFailure({
    required this.kind,
    required this.retryable,
    required this.detail,
    this.stopReason,
    this.usage,
    this.status,
  });

  final AiFailureKind kind;
  final bool retryable;

  /// Set when the model answered: a refusal and a truncation are billed.
  final AiStopReason? stopReason;
  final AiUsage? usage;
  final int? status;

  /// Printable: the provider and what happened. Never a key, never content.
  final String detail;

  @override
  String toString() =>
      'AiFailure(${kind.name}, retryable: $retryable, $detail)';
}

/// The seam. An adapter's `id` is its ai.json adapter id.
abstract interface class AiProvider {
  String get id;
  Set<AiCapability> get capabilities;
  Future<AiOutcome> complete(AiRequest request);
}

/// The outcome of a provider that ANSWERED with a non-2xx [status].
AiFailure aiAnsweredOutcome(String carrier, int status) {
  if (status == 429 || status >= 500) {
    return AiFailure(
      kind: AiFailureKind.retryable,
      retryable: true,
      status: status,
      detail: '$carrier answered $status',
    );
  }
  if (status == 401 || status == 403) {
    return AiFailure(
      kind: AiFailureKind.unavailable,
      retryable: false,
      status: status,
      detail: '$carrier answered $status: the credential was refused',
    );
  }
  return AiFailure(
    kind: AiFailureKind.invalid,
    retryable: false,
    status: status,
    detail: '$carrier answered $status',
  );
}

/// The outcome of a model that ANSWERED: the stop reason first, then the text.
AiOutcome aiStoppedOutcome({
  required String carrier,
  required AiStopReason stopReason,
  required String? text,
  required Map<String, Object?> schema,
  required AiUsage usage,
  required String servedModel,
}) {
  AiFailure billed(AiFailureKind kind, String detail) => AiFailure(
    kind: kind,
    retryable: false,
    stopReason: stopReason,
    usage: usage,
    detail: detail,
  );
  switch (stopReason) {
    case AiStopReason.refusal:
      return billed(AiFailureKind.refused, '$carrier: the model declined');
    case AiStopReason.maxTokens:
    case AiStopReason.pauseTurn:
    case AiStopReason.other:
      return billed(
        AiFailureKind.incomplete,
        '$carrier: the model stopped before finishing (${stopReason.name})',
      );
    case AiStopReason.endTurn:
      break;
  }
  if (text == null) {
    return billed(
      AiFailureKind.invalid,
      '$carrier: the answer carried no text',
    );
  }
  final Object? output;
  try {
    output = jsonDecode(text);
  } on FormatException {
    return billed(AiFailureKind.invalid, '$carrier: the answer is not JSON');
  }
  final String? problem = aiSchemaProblem(schema, output);
  if (problem != null) {
    return billed(
      AiFailureKind.invalid,
      '$carrier: the answer does not match the schema ($problem)',
    );
  }
  return AiSuccess(output: output, usage: usage, servedModel: servedModel);
}

/// The first way [value] fails [schema], or null: the subset structured output
/// uses (type, enum, const, properties, required, additionalProperties, items,
/// minItems, maxItems). A PATH is named, never a value — a value may be content.
String? aiSchemaProblem(
  Map<String, Object?> schema,
  Object? value, [
  String at = r'$',
]) {
  final Object? type = schema['type'];
  if (type != null) {
    final List<Object?> types = type is List ? type : <Object?>[type];
    final String t = _typeOf(value);
    if (!types.any(
      (Object? x) => x == t || (x == 'number' && t == 'integer'),
    )) {
      return '$at is $t, expected ${types.join(' | ')}';
    }
  }
  final Object? enumValues = schema['enum'];
  if (enumValues is List &&
      !enumValues.any((Object? e) => _deepEquals(e, value))) {
    return '$at is not one of the enum';
  }
  if (schema.containsKey('const') && !_deepEquals(schema['const'], value)) {
    return '$at is not the const';
  }
  if (value is List) {
    final Object? minItems = schema['minItems'];
    final Object? maxItems = schema['maxItems'];
    if (minItems is int && value.length < minItems) {
      return '$at has fewer than $minItems item(s)';
    }
    if (maxItems is int && value.length > maxItems) {
      return '$at has more than $maxItems item(s)';
    }
    final Object? items = schema['items'];
    if (items is Map<String, Object?>) {
      for (int i = 0; i < value.length; i++) {
        final String? p = aiSchemaProblem(items, value[i], '$at[$i]');
        if (p != null) return p;
      }
    }
  }
  if (value is Map) {
    final Object? props = schema['properties'];
    final Map<String, Object?> properties = props is Map<String, Object?>
        ? props
        : const <String, Object?>{};
    final Object? required = schema['required'];
    if (required is List) {
      for (final Object? r in required) {
        if (!value.containsKey(r)) return '$at lacks `$r`';
      }
    }
    for (final MapEntry<Object?, Object?> e in value.entries) {
      final Object? sub = properties[e.key];
      if (sub is Map<String, Object?>) {
        final String? p = aiSchemaProblem(sub, e.value, '$at.${e.key}');
        if (p != null) return p;
      } else if (schema['additionalProperties'] == false) {
        return '$at has an unknown key';
      }
    }
  }
  return null;
}

String _typeOf(Object? v) {
  if (v == null) return 'null';
  if (v is bool) return 'boolean';
  if (v is int) return 'integer';
  if (v is double) {
    return v == v.roundToDouble() && v.isFinite ? 'integer' : 'number';
  }
  if (v is String) return 'string';
  if (v is List) return 'array';
  if (v is Map) return 'object';
  return 'unknown';
}

bool _deepEquals(Object? a, Object? b) {
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (!_deepEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final Object? k in a.keys) {
      if (!b.containsKey(k) || !_deepEquals(a[k], b[k])) return false;
    }
    return true;
  }
  if (a is num && b is num) return a == b;
  return a == b;
}
