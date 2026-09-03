import 'auth_event.dart';
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

  /// The same changes, carrying WHY each one happened — see [AuthEvent].
  ///
  /// 🔴 THE ROUTER CANNOT DO ITS JOB FROM [authStateChanges] ALONE, and password
  /// recovery is the proof. A user who follows a reset link is handed a real
  /// session, so on that stream their arrival is indistinguishable from an
  /// ordinary sign-in — same user, same emission — and the app sends them to the
  /// home screen instead of to the form they came for. The reason exists only at
  /// the instant of delivery; nothing downstream can reconstruct it.
  ///
  /// ⚠️ THE DEFAULT IS DERIVED FROM [authStateChanges], NOT A REFUSAL, AND THAT
  /// IS DELIBERATE — the opposite choice from the three members below. A stream
  /// that throws is a listener that dies on its first event, and a
  /// `Stream.empty()` default is the [pipeline C-6] dead seam exactly: the
  /// router would compile, run, and never route anybody anywhere, in silence.
  /// So an implementation that says nothing about reasons still reports real
  /// arrivals and departures — and can NEVER report
  /// [AuthEventKind.passwordRecovery], because the mapping below has no way to
  /// produce it. The honest degradation is "every arrival is an ordinary
  /// sign-in", which is the closed side of the only question a caller asks.
  ///
  /// Both real implementations override this. A test double that does not still
  /// drives every gate that keys off sign-in and sign-out.
  Stream<AuthEvent> authEvents() => authStateChanges().map(
        (AuthUser? user) => AuthEvent(
          user == null ? AuthEventKind.signedOut : AuthEventKind.signedIn,
          user,
        ),
      );

  /// 🔴 `captchaToken` IS THE SEAM FOR A GATE THAT DOES NOT EXIST YET ON THE
  /// PROVIDER WE CURRENTLY POINT AT, AND THAT IS DELIBERATE.
  ///
  /// Self-hosted GoTrue on Box A now enforces Cloudflare Turnstile on SIX
  /// endpoints — `signup`, `token?grant_type=password`, `recover`, `otp`,
  /// `magiclink` and `resend` — measured 2026-09-03. Production auth is still
  /// the HOSTED project, which has no gate, and GoTrue ignores the field when
  /// captcha is disabled. So this parameter can land, ship and sit unused
  /// against hosted, and then be correct on the day `SUPABASE_URL` moves.
  ///
  /// ⚠️ It is OPTIONAL and defaults to null, which is exactly today's request.
  /// A required parameter would have broken every implementor and every test
  /// for a behaviour change that has not happened yet.
  ///
  /// Passing it is NOT the same as satisfying the gate: the token has to come
  /// from a rendered Turnstile widget, is single-use, and is short-lived. The
  /// screens own that; this seam only carries it.
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  });

  Future<AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  });

  /// OAuth (Apple/Google). Completes via redirect/deep link — the resulting
  /// session arrives on [authStateChanges], NOT as a return value.
  ///
  /// On the web this MUST be a full-page redirect rather than a popup: popups
  /// are blocked by default in several browsers unless the call is inside a
  /// direct user-gesture handler, and they break entirely in embedded webviews
  /// and PWAs launched standalone (G-43).
  Future<void> signInWithApple();

  /// Send the "set a new password" mail.
  ///
  /// ⚠️ WHERE THE EMAILED LINK POINTS IS NOT A PARAMETER HERE, and the omission
  /// is the design. The destination is a property of the BUILD (which origin
  /// this binary was served from, which scheme it registered), never of the
  /// screen that happens to call this — so it is injected once, where the
  /// implementation is constructed. A caller that could pass a URL is a caller
  /// that can point our recovery mail at anything.
  ///
  /// Says NOTHING about whether the address has an account, by design and by
  /// contract: returning normally either way is what keeps this from being an
  /// account-enumeration oracle. The screen's message must be equally silent.
  Future<void> sendPasswordReset(String email, {String? captchaToken});

  /// Set a NEW password on the session in hand, and return the fresh user.
  ///
  /// 🔴 THE HALF THAT DID NOT EXIST. [sendPasswordReset] shipped, real mail was
  /// delivered, and there was nowhere for the link to land: no member here, no
  /// implementation, no route. A user who forgot their password could ask for
  /// help and then had no way to accept it. A send with no completion is not a
  /// password-reset feature; it is a mail generator.
  ///
  /// Called from TWO situations that this contract deliberately does not
  /// distinguish, because the provider call is identical in both:
  ///   · a RECOVERY session, created by following the emailed link — see
  ///     [AuthEventKind.passwordRecovery], which is how the app knows;
  ///   · an ordinary signed-in user changing their password from settings.
  ///
  /// ⚠️ THIS CONTRACT PROMISES NO RE-AUTHENTICATION. Whether the provider
  /// demands the current password, or a fresh login, is the PROVIDER's setting
  /// (`security_update_password_require_reauthentication` on Supabase) and it is
  /// the integrator's live act. With it off, a session that has been stolen can
  /// rotate the password without proving anything — so an app that offers this
  /// from settings, on a project with that switch off, has built a session-theft
  /// escalation. The recovery path does not have that problem: the session it
  /// runs on was minted seconds earlier by somebody holding the mailbox.
  ///
  /// Implementations MUST refuse when there is no session at all, rather than
  /// silently doing nothing: an expired or already-used link is the single
  /// commonest way this is reached, and "nothing happened" is the one outcome
  /// the user cannot tell from success.
  ///
  /// Throws [AuthFailure] when there is no session, when the provider refused
  /// the password, or when the implementation has no such capability. The
  /// default body is that last case — see the block below for why a refusing
  /// default is the right one for a member eight test doubles inherit.
  Future<AuthUser> updatePassword({required String newPassword}) async {
    throw AuthFailure('Setting a new password is not available here.');
  }

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
  Future<void> resendVerificationEmail({String? captchaToken}) async {
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
