/// Re-export shim (the F0-4 pattern). `AuthUser` / `AuthSession` /
/// `AuthFailure` now live in `packages/core` so the brick and every stamped app
/// share one auth contract; Subly's feature files keep importing this path and
/// did not change.
export 'package:nikatru_core/nikatru_core.dart'
    show AuthUser, AuthSession, AuthFailure;
