// ─────────────────────────────────────────────────────────────────────────────
// The Worker's reader of tooling/catalog/offers.json (lane growth-codes): which
// offer an own code redeems, and the invite-a-friend rules. The JSON is imported
// as a module and inlined at deploy, as src/lib/catalog.ts does for catalog/*.
// tooling/ci/assert-offers.mjs holds the register (never below cost, never free
// AI); this module reads only what the routes need and DROPS any row that would
// break that policy, so a register the guard has not seen still cannot grant AI.
// ─────────────────────────────────────────────────────────────────────────────
import offersJson from '../../../../../tooling/catalog/offers.json';

export const OFFERS_REGISTER = 'tooling/catalog/offers.json';

export interface InviteRules {
  readonly minAccountAgeDays: number;
  readonly verifiedEmail: boolean;
  readonly activation: { readonly database: string; readonly table: string; readonly minRows: number };
  readonly maxRewardsPerInviterPerYear: number;
  readonly oneRewardPerInvitee: boolean;
  readonly noPriorProOrTrial: boolean;
  readonly noSelfInvite: boolean;
}

/** An offer a code or an invite can grant: free Pro months, never an AI allowance. */
export interface FreeOffer {
  readonly id: string;
  readonly kind: 'free-month' | 'invite';
  readonly app: string;
  readonly months: number;
  readonly status: string;
  readonly rules?: InviteRules;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The free offers of a register. A row carrying any AI allowance is dropped (never free AI). */
export function freeOffersOf(register: unknown): FreeOffer[] {
  const rows = isObj(register) && Array.isArray(register.offers) ? register.offers : [];
  return rows.filter(
    (o): o is FreeOffer =>
      isObj(o) &&
      (o.kind === 'free-month' || o.kind === 'invite') &&
      typeof o.id === 'string' &&
      typeof o.app === 'string' &&
      Number.isInteger(o.months) &&
      (o.months as number) >= 1 &&
      (o.months as number) <= 12 &&
      o.aiAllowance === 0 &&
      typeof o.status === 'string',
  );
}

/** The code policy's attempts-per-minute, from the register; 5 when it is unreadable. */
export function redeemPerMinuteOf(register: unknown): number {
  const n = isObj(register) && isObj(register.codePolicy) ? register.codePolicy.redeemPerMinute : null;
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10 ? (n as number) : 5;
}

export const FREE_OFFERS: readonly FreeOffer[] = freeOffersOf(offersJson);
export const REDEEM_PER_MINUTE = redeemPerMinuteOf(offersJson);
