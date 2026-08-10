import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ContentPane;

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../shared/widgets.dart';
import 'legal_consent_fields.dart';

/// The six neutral colours this screen paints with, resolved for the current
/// brightness.
///
/// 🔴 LIGHT IS THE LITERAL TOKEN, NOT `scheme.<slot>`, AND THAT IS THE WHOLE
/// SHAPE OF THIS FUNCTION — the same rule `cardDecoration` and `RowCard` are
/// written to (read `features/shared/widgets.dart:19-57` first). `apps/subly` is
/// the frozen legacy rail-prover the owner eyeballs, so light must come out
/// byte-identical to the twelve `AppColors.*` references this replaces; a
/// "tidy-up" to `scheme.surface` in the light arm would repaint the login screen
/// while every assertion comparing scheme-to-scheme kept passing.
///
/// 🔴 AND THE DARK ARM IS NOT COSMETIC. `app.dart` supplies a `darkTheme`, so
/// every user on a dark-mode OS lands here — and with the tokens hardcoded that
/// meant `AppColors.bg` (#F4F4F8, near-white) behind `AppColors.ink` (#141420,
/// near-black) inside dark chassis chrome. Not "slightly off": a white sheet in
/// a dark app, and, had only the surfaces been fixed, near-black headings on a
/// near-black scaffold. Both halves move together or neither is worth doing,
/// which is why [ink] and [muted] are in here beside the surfaces rather than
/// left to `AppText`'s const styles.
///
/// [AppText.title], [AppText.body], [AppText.muted] and [AppText.label] each
/// bake `AppColors.ink` / `AppColors.muted` into a `const TextStyle` in
/// `packages/design_system`, so the only place a screen can correct them is at
/// the call site, with `copyWith`. In LIGHT the value copied in is the value
/// that was already there.
typedef _Tones = ({
  Color bg,
  Color surface,
  Color line,
  Color ink,
  Color muted,
  Color accent,
  Color danger,
});

_Tones _tones(BuildContext context) {
  final ThemeData theme = Theme.of(context);
  if (theme.brightness == Brightness.light) {
    return (
      bg: AppColors.bg,
      surface: AppColors.surface,
      line: AppColors.line,
      ink: AppColors.ink,
      muted: AppColors.muted,
      accent: AppColors.accent,
      danger: AppColors.danger,
    );
  }
  final ColorScheme scheme = theme.colorScheme;
  return (
    // The scaffold is `scheme.surface` because that is exactly what
    // `buildAppTheme` sets `scaffoldBackgroundColor` to — the screen agreeing
    // with the theme rather than inventing a second answer.
    bg: scheme.surface,
    // `surfaceContainerHighest` is the slot `cardDecoration` and `RowCard`
    // already chose: the lightest container step, so a field or a card lifts off
    // the scaffold by the widest margin the scheme offers.
    surface: scheme.surfaceContainerHighest,
    line: scheme.outlineVariant,
    ink: scheme.onSurface,
    muted: scheme.onSurfaceVariant,
    accent: scheme.primary,
    danger: scheme.error,
  );
}

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

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String email = _email.text.trim();
    if (email.isEmpty || _password.text.isEmpty) {
      _snack(l10n.authEnterBoth);
      return;
    }
    if (!email.contains('@') || !email.contains('.')) {
      _snack(l10n.authInvalidEmail);
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
    if (_signUp && _password.text.length < 8) {
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
    if (email.isEmpty) {
      _snack(l10n.emailRequired);
      return;
    }
    try {
      await ref.read(authRepositoryProvider).sendPasswordReset(email);
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

  /// Maps raw auth/network errors onto short, human messages so users never see
  /// a stack-tracey exception (e.g. Supabase's invalid_credentials).
  ///
  /// The `raw` it matches on is the SERVER's English — Supabase's error codes
  /// are not localized and must not be, or the matching stops working. Only the
  /// message handed back to the user comes from the arb.
  String _friendlyMessage(AppLocalizations l10n, Object e) {
    if (e is String) return e;
    final String raw = e.toString().toLowerCase();
    if (raw.contains('invalid_credentials') || raw.contains('invalid login')) {
      return l10n.authIncorrect;
    }
    if (raw.contains('already registered') ||
        raw.contains('already been registered') ||
        raw.contains('user_already_exists')) {
      return l10n.authAlreadyRegistered;
    }
    if (raw.contains('weak_password') || raw.contains('password should be')) {
      // 🔴 THE COPY CHANGED HERE, ON PURPOSE (WORKORDER §8 decision 3). This
      // said "Password must be at least 6 characters." — the 6 was GoTrue's
      // server default leaking into our words, while `signUpTitle`'s own screen
      // enforces 8 client-side and says so via `passwordTooShort` ("Use at
      // least 8 characters."). Two numbers for one rule is a bug in the copy,
      // and the shipped one was the wrong number.
      // 👤 Flagged for the polish list: THIS screen's sign-up toggle has no
      // client-side 8-check at all, so it can still reach the server with 6.
      return l10n.passwordTooShort;
    }
    if (raw.contains('email_not_confirmed') || raw.contains('not confirmed')) {
      return l10n.authConfirmEmail;
    }
    if (raw.contains('rate limit') || raw.contains('over_email_send')) {
      return l10n.authRateLimited;
    }
    if (raw.contains('socketexception') ||
        raw.contains('failed host lookup') ||
        raw.contains('connection') ||
        raw.contains('network')) {
      return l10n.authNetworkError;
    }
    return l10n.authUnknownError;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final _Tones t = _tones(context);
    // What identity can actually do HERE — declared, not assumed
    // ([pipeline C-7]). Offering an OAuth button on a platform that cannot
    // complete the redirect is promising something the app cannot deliver.
    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);
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
                _field(
                  l10n.email.toUpperCase(),
                  _email,
                  TextInputType.emailAddress,
                  fieldKey: E2EKeys.loginEmail,
                  hint: l10n.emailHint,
                ),
                const SizedBox(height: 14),
                _field(
                  l10n.password.toUpperCase(),
                  _password,
                  TextInputType.text,
                  obscure: true,
                  fieldKey: E2EKeys.loginPassword,
                  hint: l10n.passwordHint,
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
                // never had. Subly rendered "Continue with Apple"
                // unconditionally; it is now behind `caps.oauthRedirect`,
                // GATED rather than deleted, and not enabled by this change.
                //
                // ⚠️ THIS GATE HIDES THE BUTTON ON NO TARGET THIS PORTFOLIO
                // SHIPS TO, and saying so here is the point — the earlier
                // version of this comment claimed the button "returns on its
                // own the day the capability says yes", which reads as: it is
                // hidden now. It is not. `AuthCapabilities.forPlatform` answers
                // `oauthRedirect: true` for web, android, iOS, macOS, windows
                // and linux; only fuchsia says false, and fuchsia is not a
                // target. So what renders today is UNCHANGED.
                //
                // A live probe on 2026-08-10 answered
                // `GET /auth/v1/authorize?provider=apple` with 400 "Unsupported
                // provider: provider is not enabled". That is a switch in the
                // SUPABASE PROJECT — server-side — which this gate neither
                // reads nor flips, and which the capability matrix does not
                // describe at all. Structural parity with the chassis is what
                // changed here, and nothing beyond it.
                //
                // ⚠️ THE DIVIDER IS INSIDE THE GATE BECAUSE IT IS THE OTHER
                // HALF OF THE SENTENCE. "or" with nothing after it is a rule
                // with a dangling caption; hiding the button alone would trade
                // a dead control for a stray one.
                if (caps.oauthRedirect) ...<Widget>[
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
                  child: MergeSemantics(
                    child: Semantics(
                      button: true,
                      child: GestureDetector(
                        onTap: () => setState(() => _signUp = !_signUp),
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
                        // `GestureDetector` above always was the button, and the
                        // second span was never independently tappable (no
                        // `TapGestureRecognizer`), so nothing about the interaction
                        // changed. What is lost is the accent colouring of the last
                        // two words; a per-locale substring hunt to restore it would
                        // be exactly the fixed-word-order assumption this removes.
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

  Widget _field(
    String label,
    TextEditingController c,
    TextInputType type, {
    bool obscure = false,
    Key? fieldKey,
    String? hint,
  }) {
    final _Tones t = _tones(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: AppText.label.copyWith(color: t.muted)),
        const SizedBox(height: 7),
        TextField(
          key: fieldKey,
          controller: c,
          obscureText: obscure,
          keyboardType: type,
          style: AppText.body.copyWith(
            fontWeight: FontWeight.w600,
            color: t.ink,
          ),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: AppText.muted.copyWith(
              fontWeight: FontWeight.w500,
              color: t.muted,
            ),
            filled: true,
            fillColor: t.surface,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 15,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: BorderSide(color: t.line),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: BorderSide(color: t.accent, width: 1.5),
            ),
          ),
        ),
      ],
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
    final _Tones t = _tones(context);
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
