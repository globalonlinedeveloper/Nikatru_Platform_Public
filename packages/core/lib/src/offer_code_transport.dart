import 'result.dart';

/// What `POST /v1/codes/redeem` granted (lane growth-codes): free Pro months
/// on one app, never an AI allowance. Mirrors the platform Worker's answer
/// (`services/platform/src/routes/codes.ts`).
class RedeemedOffer {
  const RedeemedOffer({
    required this.offer,
    required this.app,
    required this.expiresAt,
    required this.replay,
    this.months,
  });

  final String offer;
  final String app;
  final int? months;
  final String expiresAt;

  /// True when this code (or this request) was redeemed before: nothing new
  /// was granted, and [expiresAt] is the first redemption's.
  final bool replay;

  static RedeemedOffer? tryParse(Object? j) {
    if (j is! Map) return null;
    final Object? offer = j['offer'];
    final Object? app = j['app'];
    final Object? expiresAt = j['expiresAt'];
    final Object? replay = j['replay'];
    final Object? months = j['months'];
    if (offer is! String || app is! String || expiresAt is! String) {
      return null;
    }
    return RedeemedOffer(
      offer: offer,
      app: app,
      expiresAt: expiresAt,
      replay: replay == true,
      months: months is int ? months : null,
    );
  }
}

/// Why a code was not redeemed — every status the route can answer, so a new
/// one is a build failure (tooling/ci/assert-analytics-contract.mjs pins this
/// set against the route's literal statuses), never a silent success.
enum RedeemRefusal {
  invalid,
  unknownCode,
  expired,
  exhausted,
  throttled,
  unavailable;

  static RedeemRefusal forStatus(int status) {
    switch (status) {
      case 400:
      case 413:
      case 422:
        return RedeemRefusal.invalid;
      case 404:
        return RedeemRefusal.unknownCode;
      case 410:
        return RedeemRefusal.expired;
      case 409:
        return RedeemRefusal.exhausted;
      case 429:
        return RedeemRefusal.throttled;
      case 503:
        return RedeemRefusal.unavailable;
      default:
        return RedeemRefusal.unavailable;
    }
  }
}

/// The state of an invite after a claim or a settle (`routes/invites.ts`).
class InviteState {
  const InviteState({
    required this.state,
    this.expiresAt,
    this.waitingOn,
    this.rule,
  });

  /// `pending`, `rewarded` or `refused`.
  final String state;

  /// The invitee's reward expiry, once rewarded.
  final String? expiresAt;

  /// The rule a pending invite still waits on (account age, a confirmed
  /// address, activation).
  final String? waitingOn;

  /// The rule that refused it for good.
  final String? rule;

  static InviteState? tryParse(Object? j) {
    if (j is! Map) return null;
    final Object? state = j['state'];
    if (state is! String) return null;
    final Object? expiresAt = j['expiresAt'];
    final Object? waitingOn = j['waitingOn'];
    final Object? rule = j['rule'];
    return InviteState(
      state: state,
      expiresAt: expiresAt is String ? expiresAt : null,
      waitingOn: waitingOn is String ? waitingOn : null,
      rule: rule is String ? rule : null,
    );
  }
}

/// "Your invites": how many people joined with this account's invite, and how
/// many of them were rewarded. Counts only — never who (`GET /v1/invites/mine`).
class InviteCounts {
  const InviteCounts({required this.joined, required this.rewarded});

  final int joined;
  final int rewarded;

  static InviteCounts? tryParse(Object? j) {
    if (j is! Map) return null;
    final Object? joined = j['joined'];
    final Object? rewarded = j['rewarded'];
    if (joined is! int || rewarded is! int) return null;
    return InviteCounts(joined: joined, rewarded: rewarded);
  }
}

/// The client half of our own offer codes and invite-a-friend.
abstract class OfferCodeTransport {
  /// Redeems [code] once; a retry with the same [idempotencyKey] answers the
  /// first outcome. An `Err` carries the [RedeemRefusal] as its cause.
  Future<Result<RedeemedOffer>> redeem({
    required String? accessToken,
    required String code,
    required String idempotencyKey,
  });

  /// Mints (or rotates) this account's invite code for [app]. Shown once.
  Future<Result<String>> inviteCode({
    required String? accessToken,
    required String app,
  });

  /// Names who invited this account.
  Future<Result<InviteState>> claimInvite({
    required String? accessToken,
    required String app,
    required String code,
  });

  /// "Your invites" for [app]: two counts.
  Future<Result<InviteCounts>> inviteCounts({
    required String? accessToken,
    required String app,
  });

  /// Asks for the reward, once the rules are met.
  Future<Result<InviteState>> settleInvite({
    required String? accessToken,
    required String app,
  });
}
