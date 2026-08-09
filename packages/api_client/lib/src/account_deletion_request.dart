import 'package:nikatru_core/nikatru_core.dart' as core;

import 'rest_client.dart';

/// `DELETE {baseUrl}{path}` — the erasure call, with the server's REFUSAL KEPT.
///
/// 🔴 WHY THIS IS A FUNCTION AND NOT A LINE IN EVERY APP. The obvious wiring is
/// `requestServerDeletion: () => rest.delete('/account')`, and that is exactly
/// what the brick shipped. It works, and it throws away the only thing the
/// caller needs: an [ApiException] carries the status, but by the time
/// `AuthRepository.deleteAccount` has wrapped it in an `AuthFailure` the status
/// is a substring of a sentence. Every app would then have to re-derive 501 vs
/// 502 from prose, and the app that got it wrong would be the one telling a user
/// "deletion failed" when their data was gone and their login still worked.
///
/// So the mapping happens ONCE, here, at the only layer that still has the
/// status code, and every caller above sees an [core.AccountDeletionFailure]
/// that names the outcome.
///
/// A 2xx returns normally. Everything else throws.
Future<void> requestAccountDeletion(
  RestClient client, {
  String path = '/account',
}) async {
  try {
    await client.delete(path);
  } on ApiException catch (e) {
    // `statusCode == 0` is RestClient's "no response at all", which
    // AccountDeletionOutcome maps to couldNotReach rather than to a refusal.
    //
    // `detail` carries the status AND the server's own error string forward —
    // never into the user's sentence (that stays `outcome.plainMessage`), only
    // into `toString()`. Without it an unmodelled status arrives as
    // `AccountDeletionOutcome.unknown` and nothing anywhere in the app can say
    // WHICH status it was, which is precisely the hole the 2026-08-09 delete-leg
    // investigation fell into.
    throw core.AccountDeletionFailure.forStatus(
      e.statusCode,
      detail: 'DELETE $path -> HTTP ${e.statusCode}: ${e.message}',
    );
  }
}
