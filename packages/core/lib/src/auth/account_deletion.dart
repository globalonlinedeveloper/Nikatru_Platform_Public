import 'auth_models.dart';

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

  /// 501 — the route refused up front because it cannot remove the identity.
  /// The precondition is checked BEFORE anything is destroyed, which is what
  /// makes "nothing was deleted" a safe thing to say here.
  notConfigured,

  /// 502 — data deleted, identity NOT deleted. The login still works.
  signInSurvives,

  /// 401 / 403 / 503 — refused before any row was touched.
  nothingDeleted,

  /// The re-authentication step failed, so THE REQUEST WAS NEVER SENT.
  ///
  /// Deliberately not folded into [nothingDeleted]: that value's message says
  /// the user has been signed out, which is true of a server refusal (the seam
  /// signs out regardless) and false here — a mistyped password must leave the
  /// session exactly as it was. No HTTP status maps to this; it is the one
  /// outcome decided entirely on the client, which is why [forStatus] never
  /// returns it.
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
  static AccountDeletionOutcome forStatus(int statusCode) {
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
        return 'Your account has been deleted. Signing in with the same email '
            'and password will not work any more.';
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
            'nothing was sent. You are still signed in. If the password was '
            'wrong, try again. If you signed in with Apple or Google there is '
            'no password on this account, and the deletion has to be requested '
            'by email.';
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
  AccountDeletionFailure(this.outcome, {String? message})
      : super(message ?? outcome.plainMessage);

  /// Build the failure a given HTTP [statusCode] deserves. Throwing on a 2xx is
  /// refused loudly rather than quietly producing a "failure" that means success.
  factory AccountDeletionFailure.forStatus(int statusCode) {
    final AccountDeletionOutcome outcome =
        AccountDeletionOutcome.forStatus(statusCode);
    assert(
      !outcome.accountIsGone,
      'AccountDeletionFailure.forStatus($statusCode) is a SUCCESS status — '
      'constructing a failure from it would report a deletion that worked as '
      'one that did not.',
    );
    return AccountDeletionFailure(outcome);
  }

  final AccountDeletionOutcome outcome;

  @override
  String toString() => 'AccountDeletionFailure(${outcome.name}): $message';
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
