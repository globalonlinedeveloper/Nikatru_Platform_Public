// ApiException.isOffline — train ST-D7. The one rule every screen uses to tell
// "you are offline" from "the request was refused", so both arms are pinned:
// a status-0 transport failure is offline, and nothing else is — not a 5xx,
// not a 401, and not an exception this client never classified.
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:test/test.dart';

void main() {
  test('status 0 — no answer at all — is offline', () {
    expect(ApiException(0, 'Failed host lookup').isOffline, isTrue);
    expect(ApiException.isOfflineError(ApiException(0, 'timeout')), isTrue);
  });

  test('an answer, however bad, is not offline', () {
    for (final int status in <int>[400, 401, 404, 500, 503]) {
      expect(
        ApiException(status, 'x').isOffline,
        isFalse,
        reason: '$status is the server answering',
      );
      expect(ApiException.isOfflineError(ApiException(status, 'x')), isFalse);
    }
  });

  test('an error this client did not classify is never assumed offline', () {
    expect(ApiException.isOfflineError(StateError('boom')), isFalse);
    expect(ApiException.isOfflineError(null), isFalse);
  });
}
