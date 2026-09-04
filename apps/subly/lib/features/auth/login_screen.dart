import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import 'turnstile_gate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities, AuthProviders;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AuthField, ContentPane, FocusableTap, FormTones, formTones;

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../shared/widgets.dart';
import 'legal_consent_fields.dart';
import 'auth_error_text.dart';

// 🏗️ `_Tones` / `_tones()` LEFT THIS FILE ON 2026-09-04 ([ADR 065], chassis
// step 2) and are now `FormTones` / `formTones()` in
// `packages/design_system/lib/src/theme/form_tones.dart`. Nothing about the
// resolution changed — the two long notes that explain WHY light is the literal
// token and why the dark arm is not cosmetic moved with the code, because they
// are properties of the resolution and not of this screen. The app brick had no
// copy of any of it, which is the reason the move was worth making.

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _loading = false;
  bool _signUp = false;

  /// 🔴 THIS SCREEN IS A SIGN-UP SURFACE TOO, AND THAT IS WHY THE CLICKWRAP IS
  /// HERE AS WELL AS ON `SignUpScreen`.
  ///
  /// `/sign-up` is not the only door: the toggle at the foot of this form flips
  /// `_signUp` and `_submit` then calls `signUpWithEmail`. Putting the tick box
  /// only on the dedicated screen would have left a fully working, completely
  /// unblocked registration path one tap away — a consent gate with a second
  /// entrance is not a gate, and this one is the entrance most users take,
  /// because `/sign-in` is where the router sends every signed-out visitor.
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

  /// The current Turnstile token, or null when there is not a usable one.
  ///
  /// Null is the normal state today: with no `TURNSTILE_SITE_KEY` compiled in
  /// the gate renders nothing and never calls back, so every request goes out
  /// exactly as it did before. It becomes load-bearing the day SUPABASE_URL
  /// points at Box A, where six auth endpoints refuse a request without one.
  String? _captchaToken;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String email = _email.text.trim();
    // 🏗️ THE TWO CHECKS THAT WERE WRITTEN OUT HERE ARE NOW `core.signInProblem`
    // ([ADR 065], chassis step 2). Same rules, same order, same two sentences —
    // the reason they moved is that the app brick had NEITHER, so every stamped
    // app posted whatever was in the boxes. The mapping from arm to arb key is
    // exhaustive and the analyzer enforces that: adding an arm to
    // `CredentialsProblem` without a case here is a compile error, which is the
    // property a chain of `if`s could not offer.
    final core.CredentialsProblem? problem =
        core.signInProblem(email: email, password: _password.text);
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
    // Parity with `sign_up_screen.dart`, which has had this check since it was
    // written. The server is the authority on password rules; this is the one
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
        await auth.signUpWithEmail(
          email: _email.text.trim(),
          password: _password.text,
          captchaToken: _captchaToken,
        );
        // 🔴 AFTER THE ACCOUNT EXISTS — same ordering and same reason as
        // `sign_up_screen.dart`, which carries the full note. The short version:
        // the consent trail is append-only and keyed by `anon_id`, so an
        // acceptance banked for a sign-up that then throws can never be erased
        // by an account deletion — and because `accept()` sets the device stamp
        // synchronously, it also opened the re-acceptance gate for whatever
        // account this person signed into next.
        await ref
            .read(legalAcceptanceProvider.notifier)
            .accept(marketingEmail: _marketingEmail);
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
        await auth.signInWithEmail(
          email: _email.text.trim(),
          password: _password.text,
          captchaToken: _captchaToken,
        );
      }
      if (mounted) context.go('/scan');
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _apple() async {
    setState(() => _loading = true);
    final auth = ref.read(authRepositoryProvider);
    try {
      await auth.signInWithApple();
      if (mounted && auth.currentUser != null) context.go('/scan');
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
  Future<void> _forgot() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String email = _email.text.trim();
    if (core.passwordResetProblem(email: email) != null) {
      _snack(l10n.emailRequired);
      return;
    }
    try {
      await ref
          .read(authRepositoryProvider)
          .sendPasswordReset(email, captchaToken: _captchaToken);
      // 🔴 THE "(demo)" LEAK IS GONE. This said "Password reset sent (demo)." —
      // a build-mode detail shown to a user, and a claim the app cannot make:
      // it does not know whether that address has an account, and saying so
      // either way is an account-enumeration oracle. `resetSent` is the
      // existing key that says neither.
      _snack(l10n.resetSent);
    } catch (e) {
      _snack(e);
    }
  }

  void _snack(Object e) {
    if (!mounted) return;
    // Read INSIDE the mounted check, not at the call site: this runs from a
    // `catch` after an await, and `AppLocalizations.of` on a disposed element
    // throws where the old string literal simply could not.
    final AppLocalizations l10n = AppLocalizations.of(context);
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(_friendlyMessage(l10n, e))));
  }

  /// Delegates to the shared mapper. This WAS the only implementation, private
  /// to this screen — which is why the other three auth screens showed the
  /// server's raw English instead. Moved to `auth_error_text.dart` 2026-09-04
  /// so one change fixes every screen; kept as a thin method because `_snack`
  /// and the tests both call it by name.
  String _friendlyMessage(AppLocalizations l10n, Object e) => authErrorText(l10n, e);

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final FormTones t = formTones(context);
    // What identity can actually do HERE — declared, not assumed
    // ([pipeline C-7]). Offering an OAuth button on a platform that cannot
    // complete the redirect is promising something the app cannot deliver.
    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);
    // …and whether the SERVER will accept the provider at all, which the
    // capability matrix does not describe. Both must be true; see below.
    final AuthProviders providers = ref.watch(authProvidersProvider);
    return Scaffold(
      backgroundColor: t.bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(28, 40, 28, 28),
          // 🔴 THE FORM CAP, and this is the screen the argument for it is
          // easiest to see on: an email field, a password field and a button,
          // stretched edge to edge across a 1280 px window. `ContentPane.form`
          // (420) is the same idiom `features/auth/sign_up_screen.dart:70`
          // already uses, and the same 420 that was hand-written six times
          // before the chassis owned it.
          //
          // ⚠️ THE PADDING STAYS ON THE SCROLL VIEW, OUTSIDE THE CAP — matching
          // sign_up_screen, not the onboarding twin. So the cap engages at
          // 420 + 56 = 476 px, well below a tablet, and the width measured
          // inside the pane is `min(surface - 56, 420)`.
          //
          // ⚠️ topCenter, NOT `Center`: `_AccountDeletionNotice` appears and
          // disappears above the fields and the error SnackBar changes nothing
          // vertically, but the sign-in/sign-up toggle changes the column's
          // height on every tap — vertically centred, that would slide the two
          // fields under the user's finger mid-form. `ContentPane` refuses to.
          child: ContentPane.form(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Container(
                  width: 52,
                  height: 52,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    // Brand, not neutral: the gradient and the glyph on it are
                    // the same in both brightnesses. An on-gradient white stays
                    // white — `scheme.onPrimary` would be a dark glyph on a
                    // dark-mode primary, i.e. the mark disappearing into itself.
                    gradient: AppColors.brandGradient,
                    borderRadius: BorderRadius.all(Radius.circular(16)),
                  ),
                  child: const Text(
                    '◈',
                    style: TextStyle(fontSize: 24, color: Colors.white),
                  ),
                ),
                const SizedBox(height: 22),
                // 🔴 WHAT HAPPENED TO THE ACCOUNT THEY JUST ASKED US TO DELETE.
                //
                // `deleteAccount()` signs out whichever way the request went, so
                // the router lands the user HERE — and takes the settings screen,
                // its dialog and any SnackBar with it. Measured, not assumed: the
                // router-driven test in test/delete_account_test.dart found ZERO
                // result widgets after the redirect settled. So the message that
                // matters most (502: your data is gone and your login still
                // works) was the one message nobody ever saw. [ADR 027]
                const _AccountDeletionNotice(),
                Text(
                  _signUp ? l10n.signUpTitle : l10n.welcomeBack,
                  style: AppText.title.copyWith(fontSize: 34, color: t.ink),
                ),
                const SizedBox(height: 6),
                Text(
                  _signUp ? l10n.signUpSubtitle : l10n.signInSubtitle,
                  style: AppText.muted.copyWith(fontSize: 15, color: t.muted),
                ),
                const SizedBox(height: 28),
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
                const SizedBox(height: 14),
                AuthField(
                  label: l10n.password,
                  controller: _password,
                  keyboardType: TextInputType.text,
                  obscure: true,
                  fieldKey: E2EKeys.loginPassword,
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
                  // margin. `sign_up_screen.dart` is the surface where
                  // `newPassword` belongs.
                  autofillHints: const <String>[AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  // Enter is the SAME DOOR as the button, lock included: it
                  // routes through `_submit`, which owns the empty-field, bad-
                  // address, clickwrap and length guards and says which one
                  // stopped it. Only `_loading` is re-stated here, because that
                  // is the one the button expresses by going dead and a second
                  // Enter would otherwise fire a second sign-in request.
                  onSubmitted: _loading ? null : _submit,
                ),
                if (!_signUp)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: _forgot,
                      child: Text(
                        l10n.forgotPasswordShort,
                        style: AppText.body.copyWith(
                          color: t.accent,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                // ⚠️ SIGN-UP ONLY. Rendering the boxes on the sign-IN arm would
                // ask a returning user to re-accept on every visit, which is
                // the pattern research/43 declined — and it would put a
                // marketing box in front of somebody who already answered it.
                if (_signUp) ...<Widget>[
                  const SizedBox(height: 18),
                  LegalConsentFields(
                    termsAccepted: _acceptedTerms,
                    marketingAccepted: _marketingEmail,
                    enabled: !_loading,
                    onTermsChanged: (bool v) =>
                        setState(() => _acceptedTerms = v),
                    onMarketingChanged: (bool v) =>
                        setState(() => _marketingEmail = v),
                  ),
                ],
                const SizedBox(height: 12),
                // Directly above the button, which is where a challenge belongs:
                // the user meets it at the moment they are about to submit, not
                // half a form earlier where an expiring token can go stale while
                // they are still typing. Renders NOTHING when no site key is
                // compiled in, which is every build today.
                TurnstileGate(
                  onToken: (String? t) => setState(() => _captchaToken = t),
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
                  const SizedBox(height: 20),
                  Row(
                    children: <Widget>[
                      Expanded(child: Divider(color: t.line)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Text(
                          l10n.orDivider,
                          style: TextStyle(color: t.muted),
                        ),
                      ),
                      Expanded(child: Divider(color: t.line)),
                    ],
                  ),
                  const SizedBox(height: 20),
                  // ⚠️ THE TWO-SPACE GUTTER IS GONE, and it could not survive
                  // translation: the literal was '  Continue with Apple', and
                  // `SoftButton` CENTRES its label, so the spaces were only
                  // ever a ~4 px optical nudge left over from a design that had
                  // a glyph in front of the words. Leading whitespace inside an
                  // arb value is invisible in review, is the first thing a
                  // translator drops, and would therefore render differently
                  // per locale for no stated reason. The reused key is the
                  // chassis's plain `continueWithApple`.
                  if (providers.apple)
                    SoftButton(
                      label: l10n.continueWithApple,
                      onPressed: _loading ? null : _apple,
                    ),
                ],
                const SizedBox(height: 24),
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
                          style: AppText.muted.copyWith(
                            fontSize: 14,
                            color: t.muted,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 30),
                const Center(child: PoweredByNikatru()),
              ],
            ),
          ),
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
    final FormTones t = formTones(context);
    final core.AccountDeletionOutcome? outcome = ref.watch(
      lastAccountDeletionOutcomeProvider,
    );
    final String? detail = ref.watch(lastAccountDeletionDetailProvider);
    if (outcome == null) return const SizedBox.shrink();
    return Container(
      key: E2EKeys.accountDeletionNotice,
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: t.surface,
        borderRadius: BorderRadius.circular(16),
        // The FAILED case keeps its danger edge in both brightnesses; only the
        // token it resolves through changes.
        border: Border.all(color: outcome.accountIsGone ? t.line : t.danger),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            outcome.accountIsGone
                ? l10n.deleteAccountResultGone
                : l10n.deleteAccountResultNotDeleted,
            style: AppText.body.copyWith(
              fontWeight: FontWeight.w800,
              color: t.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            outcome.plainMessage,
            key: const Key('accountDeletionNoticeText'),
            style: AppText.muted.copyWith(fontSize: 13, color: t.muted),
          ),
          if (!outcome.accountIsGone) ...<Widget>[
            const SizedBox(height: 6),
            // No turnaround time and no retention period: the published page
            // states none, and an app inventing one commits us to it.
            Text(
              l10n.deleteAccountEmailRoute(AppConfig.supportEmail),
              style: AppText.muted.copyWith(fontSize: 13, color: t.muted),
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
            const SizedBox(height: 6),
            Text(
              'debug: $detail',
              key: E2EKeys.accountDeletionNoticeDetail,
              style: AppText.muted.copyWith(fontSize: 11, color: t.muted),
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
              },
              child: Text(l10n.dismiss),
            ),
          ),
        ],
      ),
    );
  }
}
