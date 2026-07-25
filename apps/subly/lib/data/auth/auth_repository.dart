/// Re-export shim (the F0-4 pattern). The `AuthRepository` seam now lives in
/// `packages/core` — pure Dart, provider-free — so the brick and every stamped
/// app depend on the same contract. Subly's feature files keep importing this
/// path and did not change.
///
/// `AuthUser`/`AuthSession`/`AuthFailure` are re-exported here too: callers of
/// this interface use them, and they used to arrive via the `auth_models.dart`
/// import this file previously carried.
export 'package:nikatru_core/nikatru_core.dart'
    show AuthRepository, AuthUser, AuthSession, AuthFailure;
