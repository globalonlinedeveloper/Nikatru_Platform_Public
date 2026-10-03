// ─────────────────────────────────────────────────────────────────────────────
// INVITE-A-FRIEND RULES (lane growth-codes, O-INVITE-REWARD-UNBUILT): one free
// Pro month for BOTH the inviter and the invitee, once the invitee is a real,
// active, NEW user. The rules are tooling/catalog/offers.json `st-invite.rules`
// and nothing else; every fact is the SERVER's own (the identity provider's
// account record, the app's own rows, the money tables), never the client's.
//
//   rule                      refuses when                            final?
//   noSelfInvite              invitee === inviter, or the two         yes
//                             accounts' canonical addresses match
//   inviterGone               the inviter's account was erased        yes
//   noPriorProOrTrial         any entitlement row or bundle grant     yes
//                             the invitee ever held for the app
//   maxRewardsPerInviterPerYear  the inviter's rewards in 365 days    yes
//   minAccountAgeDays         the invitee's account is younger        no — wait
//   verifiedEmail             the invitee's address is unconfirmed    no — wait
//   activation                the invitee has not reached it          no — wait
//
// "one reward per invitee" is the `invites` primary key (user_id, app_id): a
// second claim conflicts and the reward is settled once (`state = 'pending'`
// in the settling UPDATE).
// ─────────────────────────────────────────────────────────────────────────────
import type { InviteRules } from './offers';

export interface InviteFacts {
  readonly inviteeId: string;
  readonly inviterId: string | null;
  /** Both accounts' addresses, from the identity provider (compared canonicalised, never stored). */
  readonly inviteeEmail: string;
  readonly inviterEmail: string;
  /** The invitee's account creation instant, from the identity provider. */
  readonly accountCreatedAt: string | null;
  readonly emailConfirmed: boolean;
  /** Rows the invitee holds in the activation table. */
  readonly activationRows: number;
  /** Whether the invitee ever held Pro or a trial for this app. */
  readonly priorProOrTrial: boolean;
  /** The inviter's rewarded invites in the last 365 days. */
  readonly inviterRewardsThisYear: number;
  readonly nowIso: string;
}

export type InviteRule =
  | 'noSelfInvite'
  | 'inviterGone'
  | 'noPriorProOrTrial'
  | 'maxRewardsPerInviterPerYear'
  | 'minAccountAgeDays'
  | 'verifiedEmail'
  | 'activation';

export type InviteVerdict = { ok: true } | { ok: false; rule: InviteRule; final: boolean };

// @ceiling none — a unit of time, not a platform resource
const DAY_MS = 86_400_000;

/**
 * An address as one mailbox: trimmed, lower-cased, a `+tag` dropped, and for
 * Gmail the dots too (they deliver to the same inbox). Used only to compare.
 */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** The verdict over the facts. Final refusals first, then the ones time can lift. */
export function inviteVerdict(f: InviteFacts, rules: InviteRules): InviteVerdict {
  if (rules.noSelfInvite && (f.inviterId === f.inviteeId || (f.inviteeEmail !== '' && canonicalEmail(f.inviteeEmail) === canonicalEmail(f.inviterEmail)))) {
    return { ok: false, rule: 'noSelfInvite', final: true };
  }
  if (f.inviterId === null) return { ok: false, rule: 'inviterGone', final: true };
  if (rules.noPriorProOrTrial && f.priorProOrTrial) return { ok: false, rule: 'noPriorProOrTrial', final: true };
  if (f.inviterRewardsThisYear >= rules.maxRewardsPerInviterPerYear) return { ok: false, rule: 'maxRewardsPerInviterPerYear', final: true };
  const created = f.accountCreatedAt === null ? Number.NaN : Date.parse(f.accountCreatedAt);
  if (!(Date.parse(f.nowIso) - created >= rules.minAccountAgeDays * DAY_MS)) return { ok: false, rule: 'minAccountAgeDays', final: false };
  if (rules.verifiedEmail && !f.emailConfirmed) return { ok: false, rule: 'verifiedEmail', final: false };
  if (f.activationRows < rules.activation.minRows) return { ok: false, rule: 'activation', final: false };
  return { ok: true };
}

/**
 * The seam the settle route verifies through before it writes a reward —
 * tooling/ci/assert-bundle-provenance.mjs limb 3 reads its `.verify(` call.
 */
export const inviteEligibility = {
  verify: inviteVerdict,
};
