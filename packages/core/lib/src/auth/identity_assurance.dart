/// The two rules that stand between "someone typed an address" and "this
/// account is that person" — owner locks, 2026-08-09 late.
///
/// PURE FUNCTIONS IN `core`, NOT `if`s IN A ROUTER, and the reason is the shape
/// of the bug they prevent. Both rules are invisible when they work: a correct
/// gate looks exactly like no gate at all from every screen that never sees an
/// unverified session. A predicate that lives here can be driven directly with
/// the one input that matters, in both directions, by a test that needs no
/// widget tree, no Supabase project and no live mailbox — which is the only way
/// a rule this consequential gets a falsifiable assertion at all.
///
/// The e2e suite CANNOT stand in for that. It creates its users through the
/// admin API, which bypasses confirmation entirely, so a green nightly proves
/// nothing whatsoever about email verification. That is why the pins are here.
library;

import 'auth_models.dart';

/// True when somebody holds a SESSION but has not proven the address on it.
///
/// 🔴 THE APP MUST NOT LET THIS STATE PAST THE FRONT DOOR (owner, 2026-08-09:
/// "email verification is mandatory for email+password registration").
/// Supabase's dashboard switch — Authentication → Sign In / Providers → Confirm
/// email — is the SERVER half and it is the integrator's live act. This is the
/// CLIENT half, and it is not redundant with it:
///
///   · with Confirm-email OFF, gotrue returns a full session on sign-up and the
///     app is the only thing standing between an unproven address and the
///     product. Nothing else would refuse.
///   · with Confirm-email ON, gotrue returns a session with a NULL
///     `email_confirmed_at` on some flows, and the honest screen for that user
///     is "check your inbox" rather than a home screen that half-works.
///
/// A signed-OUT visitor is not unverified — they are signed out, which the auth
/// gate already handles. Null in, false out, deliberately.
bool sessionIsUnverified(AuthUser? user) => user != null && !user.emailVerified;

/// Whether a social identity (Apple/Google) may be attached to [user]'s
/// account.
///
/// 🔴 THIS IS THE TAKEOVER VECTOR THE VERIFICATION RULE EXISTS FOR, stated
/// directly. Identities are merged BY EMAIL under the one-identity lock. So if
/// an unproven address could accept a link, the attack is three steps and needs
/// no exploit: register with somebody else's address, leave it unconfirmed,
/// wait for them to arrive through the Apple/Google door — and their social
/// identity is now attached to an account an attacker holds the password to.
///
/// Supabase's own default is verified-only linking. This predicate does not
/// trust that default to stay put: a dashboard is a mutable setting, this is a
/// pinned one, and the client is where the "Link account" control lives.
bool mayLinkIdentity(AuthUser? user) => user != null && user.emailVerified;
