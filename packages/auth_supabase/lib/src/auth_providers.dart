import 'package:flutter/foundation.dart' show immutable;

/// Which federated identity providers the IDENTITY SERVER will actually accept.
///
/// [pipeline C-15] DECLARED, NOT ASSUMED — the same rule `AuthCapabilities`
/// follows, on the axis `AuthCapabilities` does not cover.
///
/// 🔴 THIS EXISTS BECAUSE ONE QUESTION WAS ANSWERED WITH THE OTHER, AND IT
/// SHIPPED A DEAD BUTTON TO EVERY USER ON EVERY PLATFORM.
/// "Can this platform complete an OAuth redirect?" and "will the server honour
/// an OAuth request?" are independent facts, and only the first one had a home.
/// So `if (caps.oauthRedirect)` was made to stand in for both — and
/// `AuthCapabilities.forPlatform` answers `oauthRedirect: true` for web,
/// android, iOS, macOS, windows and linux, saying false only for fuchsia, which
/// this portfolio does not ship. **The gate hid the button on no shipping
/// target.** It read like a fix, it was reviewed as a fix, and the user-visible
/// defect it was written for survived it untouched: tap "Continue with Apple"
/// and Supabase answers 400 "Unsupported provider: provider is not enabled".
///
/// The lesson is the class, not the button: *a gate whose condition is true on
/// every target is not a gate.* Adding the missing axis is what lets the false
/// arm exist at all — before this, no test could pin a case in which the button
/// is correctly absent on a platform the portfolio actually builds for.
///
/// ## The values below are MEASURED, and here is how to re-measure them
/// GoTrue publishes its own provider list, unauthenticated apart from the
/// publishable key, so this never has to be taken on trust:
///
/// ```
/// GET $SUPABASE_URL/auth/v1/settings   (headers: apikey, Authorization Bearer)
/// ```
///
/// Probed 2026-08-11 → HTTP 200, and **every** key under `external` is `false`
/// except `email: true` — `apple: false`, `google: false`, and the other
/// twenty-odd providers likewise. That is the whole reason both flags below are
/// `false`.
///
/// ⚠️ **A measured constant rots the moment somebody flips the switch in the
/// dashboard, and nothing in this file would know.** So it is not left on
/// trust either: `tooling/ops/verify-auth-providers.mjs` re-runs exactly the
/// probe above in CI and fails when the live answer and [configured] disagree —
/// in EITHER direction. Turning a provider on without turning it on here is a
/// capability the app hides from its users; turning it on here without turning
/// it on at the server is this defect, again.
@immutable
class AuthProviders {
  const AuthProviders({required this.apple, required this.google});

  /// Sign in with Apple is enabled on the identity server.
  final bool apple;

  /// Sign in with Google is enabled on the identity server.
  final bool google;

  /// Whether ANY federated provider is available.
  ///
  /// The divider above the social buttons is the other half of their sentence —
  /// an "or" with nothing after it is a rule with a dangling caption — so the
  /// divider asks this rather than repeating the disjunction at each call site
  /// and drifting from it when a third provider arrives.
  bool get any => apple || google;

  /// What the live project is configured to accept. See the class note for the
  /// probe that produced these values and the guard that keeps them true.
  ///
  /// 👤 Both flags are owner-gated: enabling a provider means creating the
  /// credential with Apple/Google and pasting it into the Supabase dashboard.
  /// The day that happens, flip the flag here and the buttons return on their
  /// own — they are GATED, not deleted, and the parity tests drive both arms.
  static const AuthProviders configured = AuthProviders(
    apple: false,
    google: false,
  );
}
