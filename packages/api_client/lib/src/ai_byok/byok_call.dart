/// The plumbing every bring-your-own-key adapter shares: where the key lives,
/// and one POST that turns every way it can go wrong into an [AiOutcome].
///
/// 🔴 THE KEY COMES ONLY FROM [SecureStore], READ ON EVERY CALL. There is no
/// default key, no key in a constructor and no cache: a key the user removed is
/// gone from the next call. It is sent to the provider's own host and nowhere
/// else, and no detail, print or exception text carries it — a failure names
/// the provider and the status, never the response body (which can echo the
/// request) and never dio's message (which can print the request's headers).
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart';

/// The [SecureStore] key holding the user's key for one provider.
String byokKeyName(String provider) => 'ai.byok.$provider.key';

/// The [Dio] a bring-your-own-key adapter OWNS: bare options, no interceptor
/// beyond dio's own, and no base URL or header of anyone else's. Review 1 of
/// #1136: an app's shared Dio carries its session interceptor, which would set
/// `Authorization: Bearer <Nikatru session>` on a provider call — overwriting
/// OpenAI's user key, and handing every provider our session token. [transport]
/// swaps only the socket layer, for tests.
Dio byokDio([HttpClientAdapter? transport]) {
  final Dio dio = Dio(BaseOptions());
  if (transport != null) dio.httpClientAdapter = transport;
  return dio;
}

/// How long one call may take before it is a timeout.
const Duration byokCallTimeout = Duration(seconds: 60);

/// The failure for a call that cannot be made without a key.
AiFailure byokNoKey(String carrier) => AiFailure(
  kind: AiFailureKind.unavailable,
  retryable: false,
  detail: '$carrier: no key is stored for this provider',
);

/// One POST to [uri]. [onAnswer] reads a 2xx JSON body; everything else is
/// mapped here.
Future<AiOutcome> byokPost({
  required String carrier,
  required Dio dio,
  required Uri uri,
  required Map<String, String> headers,
  required Map<String, Object?> body,
  required AiOutcome Function(Map<String, Object?> json) onAnswer,
  Duration timeout = byokCallTimeout,
}) async {
  final Response<String> res;
  try {
    res = await dio.postUri<String>(
      uri,
      data: jsonEncode(body),
      options: Options(
        headers: <String, Object>{
          ...headers,
          Headers.contentTypeHeader: 'application/json',
        },
        responseType: ResponseType.plain,
        sendTimeout: timeout,
        receiveTimeout: timeout,
        validateStatus: (_) => true,
      ),
    );
  } on DioException catch (e) {
    // The exception's TYPE only: its message and its requestOptions carry the
    // request, headers included.
    final bool noAnswer =
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.cancel;
    return AiFailure(
      kind: noAnswer ? AiFailureKind.timeout : AiFailureKind.invalid,
      retryable: false,
      detail: '$carrier not reached: ${e.type.name}',
    );
  }
  final int status = res.statusCode ?? 0;
  if (status < 200 || status >= 300) return aiAnsweredOutcome(carrier, status);
  final Object? json;
  try {
    json = jsonDecode(res.data ?? '');
  } on FormatException {
    return AiFailure(
      kind: AiFailureKind.invalid,
      retryable: false,
      status: status,
      detail: '$carrier: the answer is not JSON',
    );
  }
  if (json is! Map<String, Object?>) {
    return AiFailure(
      kind: AiFailureKind.invalid,
      retryable: false,
      status: status,
      detail: '$carrier: the answer is not an object',
    );
  }
  return onAnswer(json);
}

/// An int field of a JSON object, or 0.
int byokInt(Object? map, String key) {
  if (map is! Map) return 0;
  final Object? v = map[key];
  return v is num ? v.toInt() : 0;
}
