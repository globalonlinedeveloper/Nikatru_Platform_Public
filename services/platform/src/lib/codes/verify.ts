// ─────────────────────────────────────────────────────────────────────────────
// THE CODE VERIFIER (lane growth-codes): the server's own evidence that a code
// is one an operator issued, is unexpired and has redemptions left — the
// `promo_code` source's counterpart of a rail's signed receipt. A `promo_code`
// grant is written only after `.verify(` answered `ok` against `offer_codes`,
// the OPERATOR RECORD (migration 0032); tooling/ci/assert-bundle-provenance.mjs
// limb 3 accepts this module as a verification seam for exactly that reason.
//
// 🔴 THE CODE IS NEVER STORED OR LOGGED: it is normalised (upper case, no
// spaces or dashes) and hashed with SHA-256, and only the hash is compared. A
// code carries ≥ 80 bits (tooling/catalog/offers.json codePolicy), so the
// unsalted hash cannot be inverted by enumeration.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../../_shared/src/ports/sql';
import { firstRow } from '../d1';

/** @ceiling none — the longest code text accepted, a request-shape bound. */
export const CODE_MAX_CHARS = 40;

/** A code as typed → its canonical form, or null when it cannot be one. */
export function normaliseCode(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > CODE_MAX_CHARS) return null;
  const c = v.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8,32}$/.test(c) ? c : null;
}

export async function codeHash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface OfferCodeRow {
  code_hash: string;
  offer_id: string;
  app_id: string;
  max_redemptions: number;
  redeemed: number;
  expires_at: string;
  issued_by: string;
}

export type CodeVerdict =
  | { kind: 'ok'; row: OfferCodeRow }
  | { kind: 'unknown' }
  | { kind: 'expired'; row: OfferCodeRow }
  | { kind: 'exhausted'; row: OfferCodeRow };

/** The verifier over `offer_codes`. `nowIso` is the request's clock. */
export function codeVerifier(db: SqlDb) {
  return {
    async verify(code: string, nowIso: string): Promise<CodeVerdict> {
      const row = await firstRow<OfferCodeRow>(
        db
          .prepare('SELECT code_hash, offer_id, app_id, max_redemptions, redeemed, expires_at, issued_by FROM offer_codes WHERE code_hash = ?')
          .bind(await codeHash(code)),
      );
      if (row === null) return { kind: 'unknown' };
      if (!(Date.parse(row.expires_at) > Date.parse(nowIso))) return { kind: 'expired', row };
      if (row.redeemed >= row.max_redemptions) return { kind: 'exhausted', row };
      return { kind: 'ok', row };
    },
  };
}
