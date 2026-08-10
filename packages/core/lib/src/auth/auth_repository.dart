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

  // ───────────────────────────────────────────────────────────────────────────
  // EMAIL VERIFICATION (owner lock, 2026-08-09 late) — the three members the
  // "check your inbox" screen needs, and no more.
  //
  // 🔴 THEY CARRY DEFAULT BODIES, AND EACH DEFAULT IS THE HONEST ANSWER FOR THE
  // KIND OF THING THAT INHERITS IT. Ten classes conform to this interface and
  // eight of them are TEST DOUBLES driving one screen apiece; making each hand-
  // write three stubs is noise that rots, and the first person to paste
  // `async {}` into `resendVerificationEmail` writes a button that silently
  // does nothing. A default that REFUSES cannot be mistaken for a default that
  // works. Both real implementations override all three, and
  // `packages/auth_supabase/test/` drives the overrides rather than these.
  //
  // ⚠️ A DEFAULT BODY ONLY REACHES A CLASS THAT `extends` THIS ONE. Dart's
  // `implements` copies the SIGNATURES and none of the bodies, so a double
  // written `implements AuthRepository` does not compile against a member it
  // has not written out. That is why the test doubles in `apps/subly/test/`
  // extend rather than implement: one word, and the double inherits refusals it
  // was never going to be asked for instead of eight files of stubs. The two
  // REAL implementations keep `implements` on purpose — a provider must state
  // its answer to every one of these, and inheriting a refusal by accident is
  // exactly the dead-seam shape [pipeline C-6] exists to catch.
  // ───────────────────────────────────────────────────────────────────────────

  /// Send the confirmation mail again, to the address on the CURRENT session.
  ///
  /// Takes no argument on purpose: a resend that accepted an arbitrary address
  /// is a free mail cannon pointed at anybody, and it would also let an
  /// unverified session re-aim its own confirmation at a different inbox.
  ///
  /// Throws [AuthFailure] when nobody is signed in, when the provider refused,
  /// or when the implementation has no such capability at all.
  Future<void> resendVerificationEmail() async {
    throw AuthFailure(
      'Resending the confirmation email is not available here.',
    );
  }

  /// Re-read the user from the provider and return the fresh copy.
  ///
  /// This is what makes "I've confirmed my email" work. Confirmation happens in
  /// a MAIL CLIENT, on a link this app never sees, so nothing pushes the new
  /// state at a running app — the session in memory says unverified until
  /// something asks the server again.
  ///
  /// Implementations MUST emit the fresh user on [authStateChanges] as well as
  /// returning it: the router's gate reads [currentUser], and a screen that
  /// learns the answer while the router does not is a user staring at "check
  /// your inbox" after they already did.
  ///
  /// The default returns [currentUser] unchanged — correct for an implementation
  /// with no server behind it, and never a false "now verified".
  Future<AuthUser?> reloadUser() async => currentUser;

  /// Attach an Apple identity to the account that is ALREADY signed in.
  ///
  /// Distinct from [signInWithApple], which is a door in. This is the explicit
  /// link-in-settings path the one-identity lock names for the Apple
  /// hide-my-email case, where the relay address cannot match by email and
  /// silent forking is the alternative.
  ///
  /// 🔴 IMPLEMENTATIONS MUST REFUSE UNLESS `mayLinkIdentity` PASSES. Linking is
  /// merging, merging is by email, and an unproven email is somebody else's
  /// account. See `identity_assurance.dart` for the three-step attack this
  /// closes.
  ///
  /// Completes via redirect/deep link like [signInWithApple]; the result
  /// arrives on [authStateChanges], not as a return value.
  Future<void> linkAppleIdentity() async {
    throw AuthFailure('Linking another sign-in method is not available here.');
  }

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
