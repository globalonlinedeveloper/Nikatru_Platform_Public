import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// F1, row O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS: a store capture given a
/// sandbox `API_BASE_URL` still wrote to production, because
/// `apiClientProvider` preferred the config document's `apiBaseUrl` and the
/// compiled seed names the production API. [apiBaseFor] is the decision, and
/// `AppConfig.pinnedBackend` (`PIN_BACKEND_HOSTS`) is the one input that makes
/// the define win. These four cases pin both directions: a pinned build never
/// follows the document, and an unpinned build (every production build) still
/// does, exactly as before.
void main() {
  const String define =
      'https://subscriptiontracker-api-sandbox.nikatru.workers.dev';
  const String configured = 'https://subscriptiontracker-api.nikatru.com/v1';

  test(
    'P1: pinned, with a config document naming another host → the define',
    () {
      expect(
        apiBaseFor(pinned: true, configured: configured, define: define),
        '$define/v1',
      );
    },
  );

  test(
    'P2: unpinned, with a config document → the document (CFG-1 unchanged)',
    () {
      expect(
        apiBaseFor(pinned: false, configured: configured, define: define),
        configured,
      );
    },
  );

  test('P3: unpinned, before any document resolves → the define', () {
    expect(
      apiBaseFor(pinned: false, configured: null, define: define),
      '$define/v1',
    );
  });

  test('P4: pinned, before any document resolves → the define', () {
    expect(
      apiBaseFor(pinned: true, configured: null, define: define),
      '$define/v1',
    );
  });
}
