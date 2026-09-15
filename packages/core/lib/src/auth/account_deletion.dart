import 'auth_models.dart';
import 'auth_repository.dart';

/// WHAT ACTUALLY HAPPENED when a user asked to be deleted.
///
/// 🔴 THIS EXISTS BECAUSE "IT FAILED" IS NOT AN HONEST ANSWER TO A DELETION
/// REQUEST. `DELETE /v1/account` answers with THREE different refusals, and they
/// mean three incompatible things to the person who asked:
///
///   · **501** — the server refused BEFORE touching anything, because it cannot
///     delete the identity record (`SUPABASE_SERVICE_ROLE_KEY` unset; an owner
///     action). Nothing was deleted. The account and its data are unchanged.
///   · **502** — the rows were purged and the IDENTITY DELETE FAILED. The data
///     is gone and the same email and password still sign in. That is the one
///     state a user cannot discover for themselves, and it is the opposite of
///     "nothing happened".
///   · **503 / 401** — refused before any row was touched, for a different
///     reason. Nothing was deleted.
///
/// A single "deletion failed" message collapses all three, and collapsing 502
/// into it tells someone their deletion merely failed when in fact their data is
/// gone and their login is not.
///
/// 🔴 IT LIVES ON THE CHASSIS, NOT IN A SCREEN, for the same reason
/// `Analytics.purge()` was put on the facade rather than the recorder ([ADR
/// 025]): the app that forgets to distinguish 501 from 502 is the app shipping
/// the compliance bug, and there will be fifty of them.
///
/// ⚠️ NO TURNAROUND TIME, NO RETENTION PERIOD, NO LEGAL STATEMENT is stated in
/// any message below. `sites/nikatru/delete-account.html` deliberately publishes
/// none of those, and an in-app string inventing one would be the app promising
/// something the published policy does not.
enum AccountDeletionOutcome {
  /// 2xx. The rows the route reaches are gone and so is the identity record.
  deleted,

  /// ⏱ 2026-09-15 · 202 `erasure_pending` ([ADR 081]). The server ACCEPTED the
  /// deletion and could not finish it inside the request: at least one app could
  /// not be reached, so its erasure was recorded and is retried automatically,
  /// and the identity record is deleted LAST, after every app confirms. Until
  /// then the same credentials may still sign in, so it is NOT [deleted] and
  /// [accountIsGone] stays false. No turnaround time is stated — the published
  /// policy states none.
  pending,

  /// 501 — the route refused up front because it cannot remove the identity.
  /// The precondition is checked BEFORE anything is destroyed, which is what
  /// makes "nothing was deleted" a safe thing to say here.
  notConfigured,

  /// 502 — data deleted, identity NOT deleted. The login still works.
  signInSurvives,

  /// 401 / 403 / 503 — refused before any row was touched.
  nothingDeleted,

  /// The re-authentication step failed, so NOTHING WAS TOUCHED.
  ///
  /// Deliberately not folded into [nothingDeleted]: that value's message says
  /// the user has been signed out, which is true of a server refusal (the seam
  /// signs out regardless) and false here — a mistyped password must leave the
  /// session exactly as it was.
  ///
  /// Two ways in, one meaning: the password or provider sign-in failed on the
  /// client and the request was never sent; or (⏱ 2026-09-15 ·
  /// O-OAUTH-DELETE-REAUTH) the server answered 403 `reauth_required` for a
  /// password-less account whose last sign-in is not recent, before any
  /// precondition. The api_client maps that BODY, not the status — [forStatus]
  /// still never returns this, because a bare 403 is a different refusal — and
  /// the seam does not sign out on it.
  reauthFailed,

  /// No HTTP status at all (transport failure). Whether the request ever
  /// arrived is unknowable from here, so nothing is claimed about it.
  couldNotReach,

  /// A status this contract does not model. Deliberately NOT folded into
  /// [nothingDeleted]: the route deletes rows before it deletes the identity, so
  /// an unmodelled 5xx may have left the account half-erased, and saying
  /// "nothing was deleted" would be a guess presented as a fact.
  unknown;

  /// Whether the account is GONE. Only [deleted] answers true — every other
  /// value leaves either the login or the data (or both) in place, and a UI that
  /// treats "not an exception" as success is the failure this enum replaces.
  bool get accountIsGone => this == AccountDeletionOutcome.deleted;

  /// The outcome a given HTTP [statusCode] means. `0` is the [RestClient]
  /// convention for "no response", not a real status.
  ///
  /// ⬜ 404 IS DELIBERATELY NOT MODELLED, decided 2026-08-09 rather than left
  /// open. The case for modelling it is that a route which is not there cannot
  /// have deleted anything, so [nothingDeleted] would be knowable. It is not:
  /// that value's sentence says "the server refused the request", and a 404 does
  /// not say WHO answered — an edge, a proxy, a cached redirect and the Worker's
  /// own `notFound` are indistinguishable from here. Claiming the server refused
  /// when the request may never have reached it is the same class of guess this
  /// enum exists to refuse. The second reason is diagnostic: a 404 means the
  /// CLIENT is pointed somewhere the route is not, and [unknown]'s sentence is
  /// the one that makes somebody look. Give it a confident "nothing was
  /// deleted" and a broken path reads as ordinary server behaviour.
  static AccountDeletionOutcome forStatus(int statusCode) {
    // ⏱ 2026-09-15 · [ADR 081]: 202 is the one 2xx that is NOT "deleted" — the
    // route answers it exactly when the erasure is accepted and still finishing.
    if (statusCode == 202) return AccountDeletionOutcome.pending;
    if (statusCode >= 200 && statusCode < 300) {
      return AccountDeletionOutcome.deleted;
    }
    switch (statusCode) {
      case 0:
        return AccountDeletionOutcome.couldNotReach;
      case 501:
        return AccountDeletionOutcome.notConfigured;
      case 502:
        return AccountDeletionOutcome.signInSurvives;
      case 401:
      case 403:
      case 503:
        return AccountDeletionOutcome.nothingDeleted;
      default:
        return AccountDeletionOutcome.unknown;
    }
  }

  /// A sentence that is safe to show the user, describing what happened to THEIR
  /// account — not what went wrong on the server.
  ///
  /// Every one of these is written from the user's side of the request, and none
  /// of them says "deleted" unless the account is gone.
  String get plainMessage {
    switch (this) {
      case AccountDeletionOutcome.deleted:
        return 'Your account has been deleted. Signing in to it again, with a '
            'password or with Apple, will not work any more.';
      case AccountDeletionOutcome.pending:
        return 'Your deletion request was accepted but isn\'t finished yet. Some of your data couldn\'t be removed right away. We\'ll keep trying automatically, and your sign-in is removed last. You\'ve been signed out of this device.';
      case AccountDeletionOutcome.notConfigured:
        return 'Nothing was deleted. This app cannot complete an account '
            'deletion yet, so the server refused the request rather than delete '
            'part of your account. Your account and your data are unchanged, '
            'and you have been signed out of this device.';
      case AccountDeletionOutcome.signInSurvives:
        return 'Your data was deleted, but your sign-in was NOT: the same email '
            'and password can still sign in. The deletion is incomplete.';
      case AccountDeletionOutcome.nothingDeleted:
        return 'Your account was not deleted. The server refused the request '
            'and nothing was removed. You have been signed out of this device.';
      case AccountDeletionOutcome.reauthFailed:
        return 'We could not confirm it was you, so nothing was deleted and '
            'nothing was sent. You are still signed in. If you use a password, '
            'check it and try again. If you use Sign in with Apple, finish '
            'signing in with Apple and try again.';
      case AccountDeletionOutcome.couldNotReach:
        return 'We could not reach the server, so we do not know whether '
            'anything was deleted. Check before assuming your account is gone.';
      case AccountDeletionOutcome.unknown:
        return 'Your account was not deleted, and we cannot tell how much of it '
            'was removed before the server stopped. Do not assume the account '
            'is gone.';
    }
  }
}

/// An [AuthFailure] that still knows WHICH refusal it was.
///
/// The seam contract says `deleteAccount()` throws an [AuthFailure] after
/// signing out. That is still true — this is one, so nothing that catches
/// `AuthFailure` changes — but a caller that wants to say what really happened
/// can ask for [outcome] instead of parsing a sentence.
class AccountDeletionFailure extends AuthFailure {
  AccountDeletionFailure(this.outcome, {String? message, this.detail})
      : super(message ?? outcome.plainMessage);

  /// Build the failure a given HTTP [statusCode] deserves. Throwing on a 2xx is
  /// refused loudly rather than quietly producing a "failure" that means success.
  factory AccountDeletionFailure.forStatus(int statusCode, {String? detail}) {
    final AccountDeletionOutcome outcome =
        AccountDeletionOutcome.forStatus(statusCode);
    assert(
      !outcome.accountIsGone,
      'AccountDeletionFailure.forStatus($statusCode) is a SUCCESS status — '
      'constructing a failure from it would report a deletion that worked as '
      'one that did not.',
    );
    return AccountDeletionFailure(
      outcome,
      detail: detail ?? 'HTTP $statusCode',
    );
  }

  final AccountDeletionOutcome outcome;

  /// 🔴 WHAT ACTUALLY WENT WRONG, FOR A DEVELOPER — never for a user, and never
  /// rendered by a screen. [message] is the sentence the person reads and it is
  /// deliberately outcome-shaped; this is the status, the error body, or the
  /// exception that produced that outcome.
  ///
  /// It exists because [AccountDeletionOutcome.unknown] is a BUCKET, and a
  /// bucket with no label costs a session every time something lands in it. On
  /// 2026-08-09 the live delete leg reported "we cannot tell how much of it was
  /// removed" across three sessions (E2E run 31295025009): the cause was a Riverpod
  /// `CircularDependencyError` thrown before any request was formed, and the
  /// object carrying it was rebuilt as a plain outcome with the cause dropped on
  /// the floor. Two others chased an HTTP status that never existed. The next
  /// unmodelled status, or the next non-HTTP throw, names itself here in one
  /// run instead.
  final String? detail;

  @override
  String toString() => detail == null
      ? 'AccountDeletionFailure(${outcome.name}): $message'
      : 'AccountDeletionFailure(${outcome.name}) [$detail]: $message';
}

/// The outcome to SHOW for an error thrown out of `AuthRepository.deleteAccount`.
///
/// 🔴 A UI MUST NOT `catch (_)` AND PRINT ONE MESSAGE. That is what the brick did
/// and what every stamped app would have inherited: the 502 case — data gone,
/// login alive — read identically to "nothing happened".
///
/// Anything that is not an [AccountDeletionFailure] resolves to
/// [AccountDeletionOutcome.unknown] rather than to a failure shape this code
/// invented, because an unrecognised error is exactly the case where nothing is
/// known about how far the deletion got.
AccountDeletionOutcome accountDeletionOutcomeOf(Object error) =>
    error is AccountDeletionFailure
        ? error.outcome
        : AccountDeletionOutcome.unknown;

/// ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH. How recent a password-less account's last
/// sign-in must be for the app to call `DELETE /v1/account` WITHOUT opening the
/// provider sheet again. Half the platform Worker's `RECENT_AUTH_SECONDS` (600),
/// so an app that skips the sheet is always inside the window the server checks.
const Duration kProviderReauthFreshness = Duration(minutes: 5);

/// How long [confirmIdentityWithProvider] waits for the provider sign-in to land.
const Duration kProviderReauthTimeout = Duration(minutes: 5);

/// ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH (owner ruling on OWNER_QUEUE A-10) — a
/// PASSWORD-LESS account confirms deletion by signing in with its provider AGAIN,
/// at the moment of deletion. Returns when [user] has freshly authenticated;
/// throws [AuthFailure] when that did not happen, which every delete flow already
/// reports as [AccountDeletionOutcome.reauthFailed] (nothing sent, still signed in).
///
/// 🔴 THE PROOF IS A NEWER SIGN-IN BY THE SAME ACCOUNT, NOT "SOMEBODY IS SIGNED IN".
/// The provider completes on [AuthRepository.authStateChanges], never as a return
/// value (a redirect or deep link), so this waits for a user with the SAME id and
/// a `lastSignInAt` later than the one it started from. A different account
/// arriving on this device, or the same session refreshing, is not a
/// confirmation, and a sheet the person closed simply times out.
///
/// The server does not take this function's word for it: `DELETE /v1/account`
/// re-checks the token's own authentication time and refuses a stale one with
/// `reauth_required`. This exists so a person who just signed in is not sent
/// round the provider sheet twice — on web, Apple's full-page redirect reloads the
/// app, so a user who comes back and taps Delete again is inside
/// [kProviderReauthFreshness] and goes straight through.
Future<void> confirmIdentityWithProvider({
  required AuthRepository auth,
  required AuthUser user,
  DateTime Function() now = DateTime.now,
  Duration freshness = kProviderReauthFreshness,
  Duration timeout = kProviderReauthTimeout,
}) async {
  final DateTime? last = user.lastSignInAt;
  if (last != null && now().toUtc().difference(last.toUtc()) < freshness) {
    return;
  }
  // Subscribed BEFORE the sheet opens, so a fast provider cannot land between.
  final Future<AuthUser?> fresh = auth
      .authStateChanges()
      .firstWhere(
        (AuthUser? u) =>
            u != null &&
            u.id == user.id &&
            u.lastSignInAt != null &&
            (last == null || u.lastSignInAt!.isAfter(last)),
      )
      .timeout(timeout);
  await auth.signInWithApple();
  try {
    await fresh;
  } on Object {
    // A timeout, a closed stream, a stream error: none of them is a confirmation.
    throw AuthFailure('The provider sign-in did not complete.');
  }
}
