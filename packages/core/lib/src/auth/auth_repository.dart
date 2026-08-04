import 'auth_models.dart';

/// The auth seam. Swapping identity providers = writing one more implementation
/// of this interface; nothing above the data layer changes.
///
/// Pure Dart and provider-free ON PURPOSE — this is the keystone the money rail
/// stands on. Account deletion, the entitlements fetch and the paywall gate all
/// need an authenticated call, so every one of them was blocked until this
/// contract lived somewhere the brick and every app could depend on.
///
/// Concrete implementations live in `packages/auth_supabase` (Supabase + an
/// in-memory mock). `core` must never gain an SDK dependency for this.
abstract class AuthRepository {
  /// Synchronous snapshot (used by a router's redirect guard, which cannot
  /// await). Null when signed out.
  AuthUser? get currentUser;

  /// Emits on sign-in / sign-out / token refresh.
  Stream<AuthUser?> authStateChanges();

  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
  });

  Future<AuthUser> signUpWithEmail({
    required String email,
    required String password,
  });

  /// OAuth (Apple/Google). Completes via redirect/deep link — the resulting
  /// session arrives on [authStateChanges], NOT as a return value.
  ///
  /// On the web this MUST be a full-page redirect rather than a popup: popups
  /// are blocked by default in several browsers unless the call is inside a
  /// direct user-gesture handler, and they break entirely in embedded webviews
  /// and PWAs launched standalone (G-43).
  Future<void> signInWithApple();

  Future<void> sendPasswordReset(String email);

  Future<void> signOut();

  /// The bearer token attached to every API call (the JWT the Worker verifies).
  /// Null when signed out.
  ///
  /// This is the shape the brick's `RestClient` takes as its `tokenProvider`,
  /// which is why it returns a token rather than a session: the HTTP layer has
  /// no business knowing about refresh.
  Future<String?> currentAccessToken();

  /// The full current session, or null when signed out. Used where expiry
  /// matters (entitlement refresh, an offline-validity decision) — prefer
  /// [currentAccessToken] for plain request authorization.
  Future<AuthSession?> currentSession();

  /// Change the signed-in user's display name.
  ///
  /// [pipeline C-13] This lives on the SEAM rather than in a screen because the
  /// screen was refused on the grounds that "there is no profile data model" —
  /// which was the symptom, not the cause. Every identity provider worth using
  /// stores user metadata (Supabase's gotrue exposes `updateUser`), so the model
  /// was there the whole time and nothing was writing to it. A field nothing
  /// writes looks exactly like a field that cannot be written.
  ///
  /// An EMPTY string clears the name — `displayName` goes back to null rather
  /// than becoming `''`, so callers have one "no name" case to handle instead of
  /// two that render differently.
  ///
  /// Implementations MUST emit on [authStateChanges] so a screen showing the
  /// user's details refreshes. Without that the save succeeds and the user goes
  /// on looking at their old name, which is indistinguishable from a save that
  /// silently failed.
  ///
  /// Throws [AuthFailure] when nobody is signed in, or when the provider
  /// refused. Returns the updated user so a caller need not re-read.
  Future<AuthUser> updateProfile({required String displayName});

  /// Ask the backend to delete the account and its data, then sign out locally.
  ///
  /// 🔴 [pipeline C-15] THE CLIENT HALF ONLY, and the split is deliberate: this
  /// contract owns *asking*, the server owns *answering*. Drawing the boundary
  /// at the network edge is what made C-15 buildable before the route existed.
  ///
  /// 🔄 CORRECTED 2026-08-04. This used to read "`DELETE /v1/account` is stage
  /// 4's route and does not exist yet — only CORS comments reference it". It
  /// does exist: `services/platform/src/routes/account.ts` is the entry point
  /// (platform_db, then every app's own route, then the identity, in that
  /// order), and `services/subly-api/src/routes/account.ts` erases that app's own
  /// database behind an asymmetric-only boundary. The SPLIT is unchanged and is
  /// still the reason this method promises nothing about the server.
  ///
  /// Both stores require an in-app path to account deletion where an account can
  /// be created at all, so this cannot be left to a support email.
  ///
  /// Implementations MUST sign out locally even when the request fails —
  /// otherwise a user who has asked to be deleted is left holding a live
  /// session, which is the worst of both outcomes. Throws [AuthFailure] when the
  /// server refused, AFTER signing out.
  Future<void> deleteAccount();
}
