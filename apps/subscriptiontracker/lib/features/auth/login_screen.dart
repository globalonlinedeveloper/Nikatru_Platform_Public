import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import 'turnstile_gate.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities, AuthFlow, AuthProviders;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show
        AppRadius,
        AppSpacing,
        AuthField,
        AuthFrame,
        AuthMessage,
        AuthOrDivider,
        AuthPasswordChecklist,
        AuthRevealLabels,
        AuthRule,
        AuthRuleState,
        ChassisL10nX,
        ChassisLocalizations,
        FocusableTap,
        StatusKind,
        StatusTones;

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../core/router/gates.dart' show afterSignInDestination;
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../account/email_change_sign_out.dart';
import '../shared/widgets.dart';
import 'auth_panel.dart';
import 'legal_consent_fields.dart';
import 'auth_error_sentence.dart';
import 'email_code_entry.dart';

// 🏗️ `_Tones` / `_tones()` LEFT THIS FILE ON 2026-09-04 ([ADR 065], chassis
// step 2) and are now `FormTones` / `formTones()` in
// `packages/design_system/lib/src/theme/form_tones.dart`. Nothing about the
// resolution changed — the two long notes that explain WHY light is the literal
// token and why the dark arm is not cosmetic moved with the code, because they
// are properties of the resolution and not of this screen. The app brick had no
// copy of any of it, which is the reason the move was worth making.

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.startInSignUp = false, this.initialEmail});

  /// Opens on the sign-up arm — what `/sign-up` renders. ⏱ 2026-09-28 ·
  /// ST-T1b (audit A-5): this screen is the ONE sign-up surface.
  final bool startInSignUp;

  /// ⏱ 2026-10-01 · EN-13 / EN-14 — the address to correct, when the user came
  /// back from "check your inbox" or "verify your e-mail" to change it.
  final String? initialEmail;

  /// ⏱ 2026-10-01 · EN-21: "Email me a code" on the sign-in arm.
  static const Key emailCodeButton = Key('loginEmailCode');

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with CaptchaHost<LoginScreen> {
  late final TextEditingController _email = TextEditingController(
    text: widget.initialEmail,
  );
  final TextEditingController _password = TextEditingController();
  bool _loading = false;
  late bool _signUp = widget.startInSignUp;

  /// 🔴 THIS SCREEN IS THE SIGN-UP SURFACE, AND THAT IS WHY THE CLICKWRAP IS
  /// HERE.
  ///
  /// The toggle at the foot of this form flips `_signUp` and `_submit` then
  /// calls `signUpWithEmail`; `/sign-up` opens the same screen on that arm.
  /// ⏱ 2026-09-28 · ST-T1b (audit A-5): the dedicated `SignUpScreen` that
  /// once sat beside it — a second, divergent form — is gone, so there is one
  /// entrance and one gate. It is the one most users took anyway, because
  /// `/sign-in` is where the router sends every signed-out visitor.
  ///
  /// Both FALSE, always. `assert-signup-consent-shape.mjs` fails the build if
  /// either initialiser says otherwise.
  bool _acceptedTerms = false;
  bool _marketingEmail = false;

  /// Where Enter goes from the email box — see the keyboard note on
  /// `AuthField`, in `packages/design_system`.
  ///
  /// Held on the state rather than created inline because a `FocusNode` built
  /// in `build` is a NEW node on every rebuild, and this screen rebuilds on
  /// every keystroke of the toggle, every `_loading` flip and every tick box:
  /// the node the email field asked to focus would already have been discarded.
  final FocusNode _passwordFocus = FocusNode();

  /// ⏱ 2026-09-29 · ST-D10 (M1 §2.26 "errors arrive only as SnackBars"). The
  /// answer to the last action, INLINE under the fields and a live region
  /// (`AuthMessage`), where a SnackBar vanished after four seconds and was tied
  /// to nothing. Same sentences, same mapper, same moments — only where they
  /// are painted moved. Null is "nothing to say".
  String? _message;
  StatusKind _messageKind = StatusKind.danger;

  /// Whether the server refused THIS password as breached — the one fact the
  /// sign-up checklist cannot know before the request. Forgotten on the next
  /// keystroke in the password box, because it was about the old password.
  bool _breached = false;

  /// ⏱ 2026-10-01 · EN-21 — the address a sign-in code was sent to, which
  /// swaps the form for the code entry; null is the password form. With it,
  /// the wait the per-address cooldown still owes.
  String? _codeEmail;
  Duration _codeWait = Duration.zero;

  @override
  void initState() {
    super.initState();
    _password.addListener(_passwordEdited);
  }

  /// The sign-up checklist reads the password as it is typed.
  void _passwordEdited() {
    if (!mounted || !_signUp) return;
    setState(() => _breached = false);
  }

  // ⏱ 2026-09-27 · ST-A1 (BUG-1): the Turnstile token lives in [captcha]
  // ([CaptchaHost]) and is SPENT through `consume()` on every gated call, which
  // forgets it and re-challenges. Re-sending the token a failed sign-in had
  // already redeemed is what read "Verification expired" until a reload.
  @override
  void dispose() {
    _email.dispose();
    _password.removeListener(_passwordEdited);
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    _hush();
    final String email = _email.text.trim();
    // 🏗️ THE TWO CHECKS THAT WERE WRITTEN OUT HERE ARE NOW `core.signInProblem`
    // ([ADR 065], chassis step 2). Same rules, same order, same two sentences —
    // the reason they moved is that the app brick had NEITHER, so every stamped
    // app posted whatever was in the boxes. The mapping from arm to arb key is
    // exhaustive and the analyzer enforces that: adding an arm to
    // `CredentialsProblem` without a case here is a compile error, which is the
    // property a chain of `if`s could not offer.
    final core.CredentialsProblem? problem = core.signInProblem(
      email: email,
      password: _password.text,
    );
    if (problem != null) {
      _snack(switch (problem) {
        core.CredentialsProblem.incomplete => l10n.authEnterBoth,
        core.CredentialsProblem.emailMalformed => l10n.authInvalidEmail,
        // Unreachable from this door — `signInProblem` cannot return it — but
        // stated rather than defaulted, so a future arm cannot land here
        // wearing the wrong sentence.
        core.CredentialsProblem.emailMissing => l10n.emailRequired,
      });
      return;
    }
    // The clickwrap's second half — the button is disabled, and this holds when
    // the button is not the only way in. Sign-IN is untouched: consent is taken
    // once, at registration, and re-asking an existing user on every sign-in is
    // the pattern research/43 declined.
    if (_signUp && !_acceptedTerms) {
      _snack(l10n.legalMustAcceptTerms);
      return;
    }
    // The one password rule stated client-side (the retired sign-up screen
    // carried it too). The server is the authority on password rules; this is the one
    // rule we can state exactly, and stating it here saves a round trip to be
    // told the same thing. Sign-IN is exempt: an existing account may predate
    // any rule we impose now, and refusing to even attempt the sign-in would
    // lock its owner out on a client-side opinion.
    if (_signUp && _password.text.length < core.kMinPasswordLength) {
      _snack(l10n.passwordTooShort);
      return;
    }
    setState(() => _loading = true);
    final auth = ref.read(authRepositoryProvider);
    try {
      if (_signUp) {
        // ⏱ 2026-09-15 · [ADR 082] §5 — THE STORE AGE GATE, BEFORE ANYTHING IS CREATED.
        // Below adult: no account and no terms recorded — both happen below this line.
        // No signal: proceed on the 18+ declaration the terms box carries.
        final core.AgeSignal ageSignal = await core.readAgeSignal(
          ref.read(ageSignalSourceProvider),
        );
        if (core.signUpAgeGate(ageSignal) == core.SignUpAgeGate.refuse) {
          _snack(l10n.signUpAgeRefused);
          return;
        }
        // ⏱ 2026-09-28 — the fields are valid, so NOW the challenge is waited
        // for (shown by the gate's wait line); a timeout or a widget error
        // throws `CaptchaUnavailable`, which `_snack` says as a retry sentence.
        await captcha.untilReady();
        await auth.signUpWithEmail(
          email: _email.text.trim(),
          password: _password.text,
          captchaToken: captcha.consume(),
        );
        // 🔴 AFTER THE ACCOUNT EXISTS. The consent trail is append-only and
        // keyed by `anon_id`, so an
        // acceptance banked for a sign-up that then throws can never be erased
        // by an account deletion — and because `accept()` sets the device stamp
        // synchronously, it also opened the re-acceptance gate for whatever
        // account this person signed into next.
        // ⏱ 2026-10-01 · EN-05 — an acceptance the server did not receive is
        // not recorded (see `LegalAcceptanceController.accept`): the stamp
        // stays owed and `/reaccept-terms` asks again, with the reason and a
        // Retry, once this person is signed in. The account the server has
        // ALREADY created is not held back for it.
        try {
          await ref
              .read(legalAcceptanceProvider.notifier)
              .accept(marketingEmail: _marketingEmail);
        } on core.LegalAcceptanceNotRecorded {
          // Owed, and retried where it can be: `/reaccept-terms`.
        }
        // 🔴 A SIGN-UP DOES NOT ALWAYS HAND BACK A SESSION, AND THE LINE BELOW
        // USED TO ASSUME IT DOES. With "Confirm email" ON, gotrue returns a
        // user and NO session, so `currentUser` stays null — and `/scan` is on
        // the signed-out allowlist, so `context.go('/scan')` really did land a
        // brand-new registrant, signed out and told nothing, on a receipt
        // scanner. The router could not rescue them either: its gate is
        // `sessionIsUnverified`, which answers FALSE for a null user by design.
        // MEASURED: 2 of the 4 accounts on the live project are unconfirmed
        // with `last_sign_in_at` NULL.
        if (auth.currentUser == null) {
          if (mounted) context.go('/check-inbox', extra: email);
          return;
        }
      } else {
        await captcha.untilReady();
        await auth.signInWithEmail(
          email: _email.text.trim(),
          password: _password.text,
          captchaToken: captcha.consume(),
        );
      }
      if (mounted)
        context.go(afterSignInDestination(GoRouterState.of(context)));
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Both provider doors, through ONE handler: Google inherits the clickwrap,
  /// the age gate and their order rather than a copy of them
  /// (⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT).
  Future<void> _oauth({required bool google}) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    _hush();
    // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP — Sign in with Apple can CREATE an account,
    // and whether this tap will is only knowable after the redirect returns. So
    // a device that still owes the terms (nothing current accepted here; "not
    // known yet" counts as owed) answers the SAME clickwrap BEFORE the provider
    // is called — exactly when the post-sign-in re-acceptance gate would
    // otherwise have asked, so a returning user who has accepted on this device
    // is never shown it. The button is disabled too; this holds for every other
    // way into the handler.
    final bool termsOwed = core.needsLegalReacceptance(
      acceptedStamp: ref.read(legalAcceptanceProvider),
      current: kLegalVersions,
    );
    if (termsOwed && !_acceptedTerms) {
      _snack(l10n.legalMustAcceptTerms);
      return;
    }
    setState(() => _loading = true);
    final auth = ref.read(authRepositoryProvider);
    try {
      // ⏱ 2026-09-15 · [ADR 082] §5 — Sign in with Apple CAN CREATE AN ACCOUNT, so it
      // passes the store age gate BEFORE the provider is called. Whether this tap
      // creates an account or signs into one is only knowable after the OAuth
      // redirect returns, so the gate runs for both: a store signal below adult
      // refuses the tap outright, and no identity is ever created to delete.
      final core.AgeSignal ageSignal = await core.readAgeSignal(
        ref.read(ageSignalSourceProvider),
      );
      if (core.signUpAgeGate(ageSignal) == core.SignUpAgeGate.refuse) {
        _snack(l10n.signUpAgeRefused);
        return;
      }
      // 🔴 THE ACCEPTANCE IS RECORDED BEFORE THE PROVIDER IS CALLED — the reverse
      // of the email arm above, and for the reason that arm cannot share: there
      // the account exists when `signUpWithEmail` returns and not before, so
      // recording after it is possible; here the account may exist the instant
      // the redirect lands, so the consent artifact has to be written while it
      // still does not. The cost, stated: accepting and then cancelling Apple's
      // sheet leaves an acceptance on this device for a sign-in that did not
      // happen — an extra record of a real, affirmative act, never a missing one.
      // ⏱ 2026-10-01 · EN-05 — an acceptance the server did not receive now
      // THROWS here, and the provider is NOT called: the record has to exist
      // before an account can. It carries `consent_not_recorded`, which
      // `authErrorText` maps to its own sentence (reacceptTermsNotRecorded).
      if (termsOwed) {
        await ref
            .read(legalAcceptanceProvider.notifier)
            .accept(marketingEmail: _marketingEmail);
      }
      if (google) {
        await auth.signInWithGoogle();
      } else {
        await auth.signInWithApple();
      }
      if (mounted && auth.currentUser != null) {
        context.go(afterSignInDestination(GoRouterState.of(context)));
      }
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// ⏱ 2026-10-01 · EN-04 — "Resend confirmation", from the notice a failed
  /// confirmation link lands on. The address is the one in the e-mail box (the
  /// failed link carried none we may read), and the call is the one the
  /// check-inbox screen makes: captcha-gated, the server sends only to an
  /// existing unconfirmed account, and its answer never says which.
  Future<void> _resendConfirmation() async {
    if (_loading) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    _hush();
    final String email = _email.text.trim();
    if (core.passwordResetProblem(email: email) != null) {
      _snack(l10n.emailRequired);
      return;
    }
    setState(() => _loading = true);
    try {
      await captcha.untilReady();
      await ref
          .read(authRepositoryProvider)
          .resendSignUpConfirmation(email, captchaToken: captcha.consume());
      _snack(l10n.verifyEmailResent, kind: StatusKind.positive);
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// The chassis `SignInScreen._forgot`, ported into this fork.
  ///
  /// 🔴 BOTH HALVES WERE MISSING AND BOTH FAILED SILENTLY — this button read
  /// the field, sent whatever was in it, and then said a reset link was on its
  /// way, unconditionally.
  ///   · EMPTY FIELD: `sendPasswordReset('')` reaches Supabase as a malformed
  ///     request, and the user is told the mail is coming. There is no address
  ///     it could be coming to. The brick's twin throws
  ///     `AuthFailure(l10n.emailRequired)` into its `_run` wrapper; this screen
  ///     has no `_run`, so the guard returns early instead.
  ///   · A THROW: the rate limit (the likeliest one — GoTrue caps reset mail
  ///     per address) landed in an unawaited future, so the user got the same
  ///     "on its way" and the real answer went to the console. Every other
  ///     await on this screen is already wrapped; this one was not.
  ///
  /// 🔴 AND A THIRD, FOUND 2026-09-05: NOTHING STOPPED A SECOND TAP. This was
  /// the ONE await on this screen outside the `_loading` idiom — `_submit` and
  /// `_oauth` both raise the flag before their request, the submit button and
  /// the Apple button are both gated on it, and even `onSubmitted` re-states it
  /// so a second Enter cannot fire a second sign-in. This button was
  /// `onPressed: _forgot`, flat. So a user who taps twice — the ordinary
  /// response to a control that shows nothing for a second — sent TWO reset
  /// requests for the same address, and GoTrue caps reset mail per address.
  /// The second tap is what manufactures `over_email_send_rate_limit`: the
  /// button was punishing the user for the fact that it gave them no feedback,
  /// and the refusal it produced is one nothing on screen could explain.
  ///
  /// ⚠️ THE LATCH IS NOT THE SAME THING AS THE DISABLED BUTTON, AND BOTH ARE
  /// HERE. `setState` SCHEDULES a rebuild; it does not repaint inside the
  /// current frame. Two taps in one frame therefore both reach a button that is
  /// still the live one, so `onPressed: _loading ? null : _forgot` alone stops
  /// nothing — `login_chassis_parity_test.dart` taps twice with no pump between
  /// for exactly that reason. The gate is what the USER is told; the `if` below
  /// is what actually holds.
  ///
  /// ⚠️ `_loading`, NOT A SECOND FLAG. It is this screen's "a request is in
  /// flight" bit, already shared by `_submit` and `_oauth`, and a reset in
  /// flight genuinely should hold the sign-in button too — the chassis `_run`
  /// uses one `_busy` across every action for the same reason. A private
  /// `_resetting` would be a second concept for one fact, and the screen would
  /// then have two answers to "is something happening".
  ///
  /// ⚠️ THE EMPTY-FIELD GUARD STAYS IN FRONT OF THE FLAG. It makes no request,
  /// so raising `_loading` for it would blank the whole form for one frame to
  /// report a mistake the screen caught locally.
  Future<void> _forgot() async {
    if (_loading) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    _hush();
    final String email = _email.text.trim();
    if (core.passwordResetProblem(email: email) != null) {
      _snack(l10n.emailRequired);
      return;
    }
    setState(() => _loading = true);
    try {
      await captcha.untilReady();
      await ref
          .read(authRepositoryProvider)
          .sendPasswordReset(email, captchaToken: captcha.consume());
      // 🔴 THE "(demo)" LEAK IS GONE. This said "Password reset sent (demo)." —
      // a build-mode detail shown to a user, and a claim the app cannot make:
      // it does not know whether that address has an account, and saying so
      // either way is an account-enumeration oracle. `resetSent` is the
      // existing key that says neither.
      _snack(l10n.resetSent, kind: StatusKind.positive);
    } catch (e) {
      _snack(e);
    } finally {
      // `mounted`-checked like the other two: this runs after an await, and the
      // screen can be gone — the deletion redirect and the router both tear it
      // down. And it must release: a latch that never lets go is a
      // Forgot-password button that works exactly once per app launch.
      if (mounted) setState(() => _loading = false);
    }
  }

  /// ⏱ 2026-10-01 · EN-21 — "E-mail me a code". [_forgot]'s rules exactly:
  /// the latch, the empty-field guard in front of it, the captcha spent on the
  /// call, and a UNIFORM answer — the code entry opens for every address,
  /// because the send cannot tell an account from none and must not.
  Future<void> _requestCode() async {
    if (_loading) return;
    _hush();
    final String email = _email.text.trim();
    if (core.passwordResetProblem(email: email) != null) {
      _snack(AppLocalizations.of(context).emailRequired);
      return;
    }
    setState(() => _loading = true);
    try {
      final Duration wait = await _sendCode(email);
      if (mounted) {
        setState(() {
          _codeEmail = email;
          _codeWait = wait;
        });
      }
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// One send, unless the address is still cooling down — then NO mail, and
  /// the wait that is left: a code sent under a minute ago is still on its way.
  /// The cooldown is read from the store, so a reload does not reset it.
  Future<Duration> _sendCode(String email) async {
    final Duration owed = await emailCodeWait(ref, email);
    if (owed > Duration.zero) return owed;
    await captcha.untilReady();
    await ref
        .read(authRepositoryProvider)
        .sendEmailCode(email, captchaToken: captcha.consume());
    return recordEmailCodeSent(ref, email);
  }

  /// Shows [e] through the ONE shared mapper (`auth_error_sentence.dart`),
  /// which passes a sentence this screen already wrote straight through. The
  /// mapping began here as a private `_friendlyMessage`, the only one any auth
  /// screen had; the thin wrapper it left behind went on 2026-09-24.
  ///
  /// ⏱ 2026-09-29 · ST-D10: painted inline (see [_message]), not snacked.
  void _snack(Object e, {StatusKind kind = StatusKind.danger}) {
    if (!mounted) return;
    // Read INSIDE the mounted check, not at the call site: this runs from a
    // `catch` after an await, and reading localizations on a disposed element
    // throws where the old string literal simply could not.
    final String sentence = authErrorSentence(context, e);
    setState(() {
      _message = sentence;
      _messageKind = kind;
      _breached = sentence == AppLocalizations.of(context).passwordBreached;
    });
  }

  /// A new attempt clears the answer to the last one.
  void _hush() {
    if (_message != null) setState(() => _message = null);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    // What identity can actually do HERE — declared, not assumed
    // ([pipeline C-7]). Offering an OAuth button on a platform that cannot
    // complete the redirect is promising something the app cannot deliver.
    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);
    // …and whether the SERVER will accept the provider at all, which the
    // capability matrix does not describe. Both must be true; see below.
    final AuthProviders providers = ref.watch(authProvidersProvider);
    // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP — whether the Apple door must carry the
    // clickwrap on THIS device. See `_oauth`.
    // 🔴 THE SOURCE PROVIDER, COMPARED HERE — NOT `legalReacceptanceNeededProvider`.
    // Reading the DERIVED provider inside build makes Riverpod recompute it
    // mid-build, and the router's refresh listener on that provider then fires
    // DURING this build ("setState() or markNeedsBuild() called during build",
    // measured on check_inbox_test and legal_gates_test). The comparison is the
    // same one the derived provider makes; null (not hydrated yet) is owed.
    final bool appleTermsOwed = core.needsLegalReacceptance(
      acceptedStamp: ref.watch(legalAcceptanceProvider),
      current: kLegalVersions,
    );
    // Null (not read yet) is a first visit — see [SignedInBeforeController].
    final bool returning = ref.watch(signedInBeforeProvider) ?? false;
    // ⏱ 2026-10-01 · EN-21: a code was sent — the code entry, and the gate
    // its resend spends a token from. Same frame, same brand and panel.
    if (_codeEmail case final String to) {
      return AuthFrame(
        showBack: false,
        brand: authBrandOf(context),
        panel: const AuthPanel(),
        title: l10n.emailCodeTitle,
        children: <Widget>[
          emailCodeEntry(
            email: to,
            cooldown: _codeWait,
            onVerify: (String code) => ref
                .read(authRepositoryProvider)
                .verifyEmailCode(email: to, code: code),
            onResend: () => _sendCode(to),
            onCancel: () => setState(() => _codeEmail = null),
          ),
          TurnstileGate(
            controller: captcha,
            render: renderTurnstile,
            onError: _snack,
          ),
        ],
      );
    }
    // ⏱ 2026-09-29 · ST-D10 (`SignIn`, `SignUp`, `DesktopSignIn`): the page is
    // the shared `AuthFrame` — top-aligned under the 420 form cap, the heading
    // a real heading, the wide split at 1200 dp. What stood here was this
    // screen's own Scaffold, a 28/40 inset and a gradient glyph tile that a
    // screen reader read aloud (M1 §2.26). The notices stay ABOVE the heading.
    return AuthFrame(
      showBack: false,
      // The inset this screen always had (28 / 40), so the 420 cap is a no-op
      // on the narrowest phone and the fields sit where they sat.
      inset: const EdgeInsets.fromLTRB(
        AppSpacing.xl + AppSpacing.xs,
        AppSpacing.xxl + AppSpacing.sm,
        AppSpacing.xl + AppSpacing.xs,
        AppSpacing.xl + AppSpacing.xs,
      ),
      brand: authBrandOf(context),
      panel: const AuthPanel(),
      // 🔴 WHAT HAPPENED TO THE ACCOUNT THEY JUST ASKED US TO DELETE — the
      // deletion redirect lands here and takes every SnackBar with it, so this
      // is the one surface the outcome is readable on. [ADR 027]
      notices: <Widget>[
        const _AccountDeletionNotice(),
        const _EmailChangedNotice(),
        _AuthArrivalNotice(
          onResendConfirmation: _loading ? null : _resendConfirmation,
        ),
      ],
      // ST-T1b (audit A-7): "Welcome back" only where a session has been seen
      // on this device. The key is the anchor every suite reads, never words.
      title: _signUp
          ? l10n.signUpTitle
          : (returning ? l10n.welcomeBack : l10n.welcomeFirstVisit),
      titleKey: E2EKeys.loginHeading,
      subtitle: _signUp ? l10n.signUpSubtitle : l10n.signInSubtitle,
      children: <Widget>[
        // The field labels are the arb's `email` / `password` PUT INTO
        // CAPITALS BY THE LAYOUT, not two more keys shouting in the arb.
        // A translator should never have to decide whether Tamil has an
        // upper case (it does not — `toUpperCase()` is a no-op on Tamil
        // script, which is the correct rendering, and it would be frozen
        // wrong if the capitals lived in the value).
        //
        // ⚠️ THE `toUpperCase()` MOVED INSIDE `_field`, and it is not a
        // tidy-up: the capitals belong to the PAINTED label only. The
        // same word, in sentence case, is now what the field ANNOUNCES
        // (see [_field]), and a reader handed "E-M-A-I-L" is handed a
        // layout compromise read out one letter at a time.
        //
        // 🔴 THE FIRST THING A WEB USER TOUCHES, AND IT ANSWERED
        // NEITHER OF THE TWO THINGS A BROWSER TRIES. Without
        // `autofillHints` the engine emits an `<input>` with no
        // `autocomplete` attribute, so Chrome/Safari/1Password have
        // nothing to match on and the saved credential for this site is
        // never offered — on the ONE screen every signed-out visitor is
        // routed to. And with no `textInputAction`/`onSubmitted`, Enter
        // in the password box did nothing at all: the only way in was
        // to leave the keyboard and hit the button.
        AuthField(
          label: l10n.email,
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          fieldKey: E2EKeys.loginEmail,
          hint: l10n.emailHint,
          autofillHints: const <String>[AutofillHints.email],
          // Enter here ADVANCES rather than submits — a submit from the
          // email box would always be the "enter both" snack, since the
          // password box is by definition still empty.
          textInputAction: TextInputAction.next,
          onSubmitted: _passwordFocus.requestFocus,
        ),
        const SizedBox(height: AppSpacing.md),
        AuthField(
          label: l10n.password,
          controller: _password,
          keyboardType: TextInputType.text,
          obscure: true,
          fieldKey: E2EKeys.loginPassword,
          // ST-D10: Show / Hide, beside the merged field (`AuthField`).
          reveal: AuthRevealLabels(
            show: l10n.authShow,
            hide: l10n.authHide,
            showName: l10n.authShowPassword,
            hideName: l10n.authHidePassword,
          ),
          hint: l10n.passwordHint,
          focusNode: _passwordFocus,
          // 🔴 `password`, NOT `newPassword`, ON BOTH ARMS OF THE
          // TOGGLE. `newPassword` tells the browser to offer a GENERATED
          // secret and to suppress the stored one — correct on a
          // dedicated registration form, wrong here, because this widget
          // is the sign-IN box that `_signUp` re-labels in place. The
          // hint is read when the input connection opens, so a value
          // chosen for the arm the user might toggle to would be the
          // value the returning user's password manager sees first, and
          // sign-in is the dominant path on this screen by a wide
          // margin.
          autofillHints: const <String>[AutofillHints.password],
          textInputAction: TextInputAction.done,
          // Enter is the SAME DOOR as the button, lock included: it
          // routes through `_submit`, which owns the empty-field, bad-
          // address, clickwrap and length guards and says which one
          // stopped it. Only `_loading` is re-stated here, because that
          // is the one the button expresses by going dead and a second
          // Enter would otherwise fire a second sign-in request.
          // ⛔ NEVER the captcha's readiness (2026-09-28, E2E run
          // 36379673890): `_submit` validates first and then WAITS
          // for the challenge. assert-captcha-gated-call-sites R4.
          onSubmitted: _loading ? null : _submit,
        ),
        // ST-D10 (`SignUp`): the rules, readable BEFORE a refusal. It
        // shows them and gates nothing — `_submit` keeps its length
        // refusal and the server keeps the breach check.
        if (_signUp) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          AuthPasswordChecklist(
            rules: <AuthRule>[
              AuthRule(
                label: l10n.authPasswordRuleLength(core.kMinPasswordLength),
                state: _password.text.length >= core.kMinPasswordLength
                    ? AuthRuleState.met
                    : AuthRuleState.pending,
              ),
              AuthRule(
                label: l10n.authPasswordRuleBreach,
                state: _breached ? AuthRuleState.failed : AuthRuleState.pending,
              ),
            ],
          ),
        ],
        if (_message case final String said) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          AuthMessage(message: said, kind: _messageKind),
        ],
        if (!_signUp)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              // Gated like every other control on this screen. This is
              // the half the user can SEE; the latch at the top of
              // `_forgot` is the half that actually holds, because a
              // second tap in the same frame reaches a button that has
              // not been rebuilt yet. Neither is redundant.
              onPressed: _loading ? null : _forgot,
              child: Text(l10n.forgotPasswordShort),
            ),
          ),
        // ⏱ 2026-10-01 · EN-21: only where THIS build can reach the send
        // (`emailCodeAvailable`) — a native build waits for the route's `otp`.
        if (!_signUp && ref.watch(authRepositoryProvider).emailCodeAvailable)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: LoginScreen.emailCodeButton,
              onPressed: _loading ? null : _requestCode,
              child: Text(l10n.emailCodeRequest),
            ),
          ),
        // ⚠️ SIGN-UP ONLY. Rendering the boxes on the sign-IN arm would
        // ask a returning user to re-accept on every visit, which is
        // the pattern research/43 declined — and it would put a
        // marketing box in front of somebody who already answered it.
        if (_signUp) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          LegalConsentFields(
            termsAccepted: _acceptedTerms,
            marketingAccepted: _marketingEmail,
            enabled: !_loading,
            onTermsChanged: (bool v) => setState(() => _acceptedTerms = v),
            onMarketingChanged: (bool v) => setState(() => _marketingEmail = v),
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        // Directly above the button, which is where a challenge belongs:
        // the user meets it at the moment they are about to submit, not
        // half a form earlier where an expiring token can go stale while
        // they are still typing. Renders NOTHING when no site key is
        // compiled in, which is every build today.
        TurnstileGate(
          controller: captcha,
          render: renderTurnstile,
          onError: _snack,
        ),
        GradientButton(
          key: E2EKeys.loginSubmit,
          label: _loading
              ? l10n.pleaseWait
              : (_signUp ? l10n.signUp : l10n.signIn),
          // Disabled while the sign-up arm is showing and the terms box
          // is untouched. `_signUp &&` is load-bearing: without it the
          // sign-IN button would be dead for every returning user,
          // which is a gate on the wrong door.
          // ⏱ 2026-09-28 — NOT while the challenge has not answered.
          // ST-T1 (#1022) gated it on that, and a Turnstile with no
          // token (slow, blocked, headless) left a dead button that
          // could not even say "Enter your email" (E2E live run
          // 36379673890). `_submit` validates first; a valid submit
          // waits for the token, shown by the status line below.
          onPressed: (_loading || (_signUp && !_acceptedTerms))
              ? null
              : _submit,
        ),
        // THE WHOLE OAUTH LIMB IS GATED, NOT JUST THE BUTTON — the
        // chassis `SignInScreen` guard ([pipeline C-7]) that this fork
        // never had. GATED rather than deleted: the day a provider is
        // switched on, the limb returns on its own.
        //
        // 🔴 TWO CONDITIONS, BECAUSE THERE ARE TWO INDEPENDENT FACTS —
        // and the previous version of this gate had only one of them,
        // which is why it changed nothing a user could see.
        //   · `caps.oauthRedirect` — can THIS PLATFORM complete the
        //     redirect back into the app?
        //   · `providers.any`      — will THE SERVER honour an OAuth
        //     request for any provider at all?
        // The first is true for web, android, iOS, macOS, windows and
        // linux; only fuchsia says false, and fuchsia is not a target.
        // So `caps.oauthRedirect` ALONE hid this limb on no shipping
        // platform — it read as a fix and shipped the defect intact.
        // Measured on the live project 2026-08-11 via
        // `GET /auth/v1/settings`: every key under `external` is false
        // except `email`. `apple: false`. So the limb is hidden NOW,
        // on every target, which is the whole point of the change.
        // See `AuthProviders` for the probe and for the CI guard that
        // fails if this declaration and the server ever disagree.
        //
        // ⚠️ THE DIVIDER IS INSIDE THE GATE BECAUSE IT IS THE OTHER
        // HALF OF THE SENTENCE. "or" with nothing after it is a rule
        // with a dangling caption; hiding the button alone would trade
        // a dead control for a stray one.
        if (caps.oauthRedirect && providers.any) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          AuthOrDivider(label: l10n.orDivider),
          const SizedBox(height: AppSpacing.lg),
          // ⚠️ THE TWO-SPACE GUTTER IS GONE, and it could not survive
          // translation: the literal was '  Continue with Apple', and
          // `SoftButton` CENTRES its label, so the spaces were only
          // ever a ~4 px optical nudge left over from a design that had
          // a glyph in front of the words. Leading whitespace inside an
          // arb value is invisible in review, is the first thing a
          // translator drops, and would therefore render differently
          // per locale for no stated reason. The reused key is the
          // chassis's plain `continueWithApple`.
          if (providers.apple || providers.google) ...<Widget>[
            // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP. On the sign-IN arm, a
            // device that owes the terms gets the SAME boxes directly
            // above the Apple button; the sign-up arm already shows them
            // above, and both doors read the same two flags.
            // ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT — ONE set of boxes
            // above BOTH provider buttons: one tick, one acceptance.
            if (!_signUp && appleTermsOwed) ...<Widget>[
              LegalConsentFields(
                termsAccepted: _acceptedTerms,
                marketingAccepted: _marketingEmail,
                enabled: !_loading,
                onTermsChanged: (bool v) => setState(() => _acceptedTerms = v),
                onMarketingChanged: (bool v) =>
                    setState(() => _marketingEmail = v),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
            if (providers.apple)
              SoftButton(
                label: l10n.continueWithApple,
                onPressed: (_loading || (appleTermsOwed && !_acceptedTerms))
                    ? null
                    : () => _oauth(google: false),
              ),
            if (providers.apple && providers.google)
              const SizedBox(height: AppSpacing.md),
            if (providers.google)
              SoftButton(
                label: l10n.continueWithGoogle,
                onPressed: (_loading || (appleTermsOwed && !_acceptedTerms))
                    ? null
                    : () => _oauth(google: true),
              ),
          ],
        ],
        const SizedBox(height: AppSpacing.xl),
        Center(
          // `button:` merged with the sentence below. The whole line is
          // the tap target (see the note further down), and it reads as
          // prose — "New here? Create account" — so without a role a
          // reader announces it as body copy that happens to sit at the
          // bottom of a form. It is the only way to reach sign-up.
          // 🔴 `FocusableTap`, NOT `Semantics` + `GestureDetector`.
          // THE PAIR THAT STOOD HERE WAS THE WORST SINGLE INSTANCE OF
          // SC 2.1.1 IN THE APP, and the comment right below already
          // said why without anyone noticing: this is the ONLY control
          // that reaches registration from the screen every signed-out
          // visitor is routed to. `Semantics(button: true)` gave a
          // screen reader a ROLE and gave a keyboard NOTHING — it
          // creates no `FocusNode` — so a keyboard-only user could not
          // create an account at all. Measured 2026-08-21 and again
          // 2026-08-25 by `test/keyboard_traversal_test.dart`; the
          // primitive is `packages/design_system`'s, so the fix is one
          // widget rather than one per call site.
          //
          // Nothing a reader hears changes: `FocusableTap` re-emits the
          // same `MergeSemantics` + `Semantics(button: true)` it
          // replaces, and paints its ring as a foreground decoration so
          // the 48px band below keeps every pixel it had.
          child: FocusableTap(
            onTap: () => setState(() => _signUp = !_signUp),
            borderRadius: BorderRadius.circular(8),
            // 🔴 THE TAP TARGET IS THE BAND, NOT THE INK.
            // Measured 319.0x40.0 against
            // androidTapTargetGuideline: eight pixels short, on the
            // ONLY control that reaches registration from the screen
            // every signed-out visitor is routed to. `opaque` is
            // half the fix — `deferToChild` would leave the pointer
            // hunting the glyphs while the semantics rect claimed
            // the whole band. `minHeight` rather than a fixed
            // height because `haveAccountPrompt` is a different
            // sentence in every locale and some of them wrap to
            // three lines; a `SizedBox(height: 48)` would clip those
            // instead of growing.
            behavior: HitTestBehavior.opaque,
            // 🔴 ONE WHOLE SENTENCE PER KEY, NOT A LEAD-IN PLUS A LINK.
            // This was two `TextSpan`s — "New here? " + "Create account"
            // — which is a concatenation wearing a rich-text costume: it
            // fixes English word order, and in a language that puts the
            // verb last the "link" half would have to move to the front
            // of the sentence. `newHerePrompt` / `haveAccountPrompt`
            // each carry the complete line, so the translator controls
            // the order.
            //
            // ⚠️ The whole line is the tap target either way — the
            // tap wrapper above always was the button, and the
            // second span was never independently tappable (no
            // `TapGestureRecognizer`), so nothing about the interaction
            // changed. What is lost is the accent colouring of the last
            // two words; a per-locale substring hunt to restore it would
            // be exactly the fixed-word-order assumption this removes.
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Align(
                child: Text(
                  _signUp ? l10n.haveAccountPrompt : l10n.newHerePrompt,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        const Center(child: PoweredByNikatru()),
      ],
    );
  }
}

/// ST-A2 (audit BUG-2): why a link or a provider return brought the user to
/// the sign-in door. A failed sign-up confirmation or a cancelled Apple/Google
/// return used to land on the RESET screen ("This reset link cannot be used
/// here"); the router now leaves it here, and this says what happened.
class _AuthArrivalNotice extends ConsumerWidget {
  const _AuthArrivalNotice({required this.onResendConfirmation});

  /// ⏱ 2026-10-01 · EN-04 — offered under a failed SIGN-UP confirmation only;
  /// null while a request is in flight.
  final VoidCallback? onResendConfirmation;

  static const Key resendConfirmationButton = Key('authArrivalResend');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthFlow? flow = ref.watch(failedAuthArrivalProvider);
    if (flow == null) return const SizedBox.shrink();
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);
    final bool provider =
        flow == AuthFlow.oauth || flow == AuthFlow.linkIdentity;
    return Container(
      key: const Key('authArrivalNotice'),
      margin: const EdgeInsets.only(bottom: AppSpacing.lg),
      padding: const EdgeInsetsDirectional.fromSTEB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.xs,
        AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Semantics(
                  liveRegion: true,
                  child: Text(
                    provider
                        ? l10n.authProviderSignInCancelled
                        : l10n.authLinkFailedSignIn,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                ),
                if (flow == AuthFlow.signUpConfirm)
                  TextButton(
                    key: resendConfirmationButton,
                    onPressed: onResendConfirmation,
                    child: Text(l10n.authResendConfirmation),
                  ),
              ],
            ),
          ),
          IconButton(
            tooltip: l10n.catchUpDismiss,
            icon: const Icon(Icons.close),
            onPressed: () =>
                ref.read(failedAuthArrivalProvider.notifier).state = null,
          ),
        ],
      ),
    );
  }
}

/// ADR 059 decision 2: the account's address changed and this device was
/// signed out (`EmailChangeSignOut`) — with every other device, or, when the
/// global revoke did not go through, WITHOUT them, and then it says so and
/// how to finish. Said here, the screen that sign-out lands on, until
/// dismissed or the next sign-in; a live region, like the deletion outcome.
class _EmailChangedNotice extends ConsumerWidget {
  const _EmailChangedNotice();

  static const Key text = Key('emailChangedSignedOutNotice');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final EmailChangeSignOutNotice? notice = ref.watch(
      emailChangeSignedOutProvider,
    );
    if (notice == null) return const SizedBox.shrink();
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    return Semantics(
      container: true,
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.lg),
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: theme.colorScheme.outlineVariant),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              notice == EmailChangeSignOutNotice.everywhere
                  ? l10n.emailChangedSignedOut
                  : l10n.emailChangedOthersStillSignedIn,
              key: text,
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () =>
                    ref.read(emailChangeSignedOutProvider.notifier).state =
                        null,
                child: Text(l10n.dismiss),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The deletion outcome, rendered where the sign-out redirect cannot reach it.
///
/// Inline rather than a dialog, deliberately: a dialog here is another PAGELESS
/// ROUTE, and this widget exists precisely because a pageless route was carried
/// away by a page change. It sits until the user dismisses it — clearing the
/// provider, so it cannot resurface at some later sign-out. [ADR 027]
class _AccountDeletionNotice extends ConsumerWidget {
  const _AccountDeletionNotice();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AccountDeletionOutcome? outcome = ref.watch(
      lastAccountDeletionOutcomeProvider,
    );
    final String? detail = ref.watch(lastAccountDeletionDetailProvider);
    final String? billing = ref.watch(lastDeletionBillingSentenceProvider);
    if (outcome == null) return const SizedBox.shrink();
    // ⏱ ST truth pass (EN-16): a LIVE REGION. This notice appears on the
    // sign-in screen the deletion lands on, and is the only place the outcome
    // is said — a reader on the heading never heard it arrive.
    return Semantics(
      key: const Key('accountDeletionNoticeLive'),
      container: true,
      liveRegion: true,
      child: _card(context, l10n, outcome, detail, billing, ref),
    );
  }

  Widget _card(
    BuildContext context,
    AppLocalizations l10n,
    core.AccountDeletionOutcome outcome,
    String? detail,
    String? billing,
    WidgetRef ref,
  ) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextStyle? small = theme.textTheme.bodySmall?.copyWith(
      color: scheme.onSurfaceVariant,
    );
    return Container(
      key: E2EKeys.accountDeletionNotice,
      margin: const EdgeInsets.only(bottom: AppSpacing.lg),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.card),
        // The FAILED case keeps its danger edge in both brightnesses; only the
        // token it resolves through changes.
        border: Border.all(
          color: outcome.accountIsGone
              ? scheme.outlineVariant
              : StatusTones.of(context).danger,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            outcome.accountIsGone
                ? l10n.deleteAccountResultGone
                : l10n.deleteAccountResultNotDeleted,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
              color: scheme.onSurface,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            outcome.plainMessage,
            key: const Key('accountDeletionNoticeText'),
            style: small,
          ),
          // ⏱ 2026-10-01 · AB-A5-02-client: the server's own reason, when it
          // refused because a plan is still billing — what to cancel first.
          // HERE, not in the dialog: this refusal signs out too, and the
          // redirect tears the dialog down before it is read.
          if (!outcome.accountIsGone && billing != null) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Text(
              billing,
              key: const Key('accountDeletionNoticeBilling'),
              style: small,
            ),
          ],
          if (!outcome.accountIsGone) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            // No turnaround time and no retention period: the published page
            // states none, and an app inventing one commits us to it.
            Text(
              l10n.deleteAccountEmailRoute(AppConfig.supportEmail),
              style: small,
            ),
          ],
          // 🔴 WHY IT FAILED, IN A DEBUG BUILD ONLY — never localised, never
          // shown to a user, and never in a release artifact (`kDebugMode` is a
          // const, so the tree-shaker removes this whole branch).
          //
          // `flutter drive` builds DEBUG, so this is the surface the E2E can
          // read. Without it the suite could only print the outcome SENTENCE,
          // and "we cannot tell how much of it was removed" is the same sentence
          // for a 404, a 500, and a client-side throw that never sent a request
          // — which is exactly how the 2026-08-09 delete leg stayed unexplained
          // across three sessions. [ADR 027]
          if (kDebugMode && detail != null) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Text(
              'debug: $detail',
              key: E2EKeys.accountDeletionNoticeDetail,
              style: small,
            ),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () {
                ref.read(lastAccountDeletionOutcomeProvider.notifier).state =
                    null;
                ref.read(lastAccountDeletionDetailProvider.notifier).state =
                    null;
                ref.read(lastDeletionBillingSentenceProvider.notifier).state =
                    null;
              },
              child: Text(l10n.dismiss),
            ),
          ),
        ],
      ),
    );
  }
}
