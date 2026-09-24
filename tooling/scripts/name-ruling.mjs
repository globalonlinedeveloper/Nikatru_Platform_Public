// ─────────────────────────────────────────────────────────────────────────────
// name-ruling.mjs — is a recorded trademark ruling COMPLETE? One answer, read by
// both readers that act on it: limb 7 of `tooling/ci/assert-name-clearance.mjs`
// and `rollUp` in `tooling/store/name-clearance.mjs`.
//
// 🔴 WHY IT IS ONE FUNCTION (the PR 913 review, L2, 2026-09-24). Limb 7 refused
// a `PROCEED` with no `ruledBy`, no dated `ruledOn` or no `basis`; `rollUp` read
// `ruling === 'PROCEED'` alone, so the same record rolled up to CLEAR, exit 0,
// in the probe and the weekly sweep while the guard refused it. Two readers of
// one field that disagree hand the reader whichever answer they ran last. Both
// now call `rulingOwed`, so a ruling is complete for both or for neither.
//
// A ruling is a dated act by a named person on a stated basis:
//   · `ruledBy` — a string that is not blank;
//   · `ruledOn` — a real calendar date, by `isIsoDate` in
//     `tooling/app-yaml/schema-validate.mjs` (the one copy; `2026-02-31` is not one);
//   · `basis`   — a string that is not blank.
//
// Pure: no filesystem, no exit. It does not judge WHICH ruling was made — that
// is each reader's own question (limb 7 refuses DO-NOT-PROCEED, `rollUp` rolls
// it up to BLOCKED) — only whether the record says who, when and on what.
// ─────────────────────────────────────────────────────────────────────────────
import { isIsoDate } from '../app-yaml/schema-validate.mjs';

/** What a recorded ruling still owes, as the phrases limb 7 prints. `[]` means
 *  complete. `tm` is the record's `trademark` block. */
export function rulingOwed(tm) {
  const owed = [];
  if (typeof tm?.ruledBy !== 'string' || tm.ruledBy.trim() === '') owed.push('`ruledBy`');
  if (!isIsoDate(tm?.ruledOn)) owed.push('a dated `ruledOn`');
  if (typeof tm?.basis !== 'string' || tm.basis.trim() === '') owed.push('`basis`');
  return owed;
}
