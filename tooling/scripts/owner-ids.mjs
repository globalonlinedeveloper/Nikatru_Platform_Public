// ─────────────────────────────────────────────────────────────────────────────
// owner-ids.mjs — which PUBLIC fields hold a build on an owner id, and whether
// the id they name is still a live item somebody owes.
//
// 🔴 WHY THIS EXISTS (apps-review F1, O-NAME-CLEARANCE-WAITS-ON-A-MISSING-ROW).
// `apps/subscriptiontracker/name-clearance.json` lifted limb 7's block with
// `trademark.ownerItem: "O-NAME-SUBLY-TRADEMARK"` and a `gatedUntil` date.
// `assert-name-clearance.mjs` checked that the field was PRESENT and never that
// the row it names EXISTS — and it did not: `docs/name-clearance.md` § 8 lists
// that row as owed, and it was never opened. So the build was held on an item
// nobody owed, which is a waiver with an owner's name typed onto it. CI cannot
// read the corpus the id points into, so the check lives here and is run by
// `assert-public-citations.mjs` (its ID CITATIONS class), which already finds
// the private root and runs in the hooks of both repositories.
//
// ── WHAT IS IN THIS FILE, AND WHAT IS NOT ────────────────────────────────────
// Pure functions and one table. No filesystem, no git, no process exit and no
// argv: the guard reads the files and owns every exit code, and this module
// answers questions about values it is handed. That is what lets the test drive
// the resolver without a workspace and the guard's fixture drive the whole path.
//
// ── THE ID GRAMMAR, TWO NAMESPACES ───────────────────────────────────────────
//   · OPEN ids — `O-` then an upper-case word, then more words:
//     `O-NAME-SUBLY-TRADEMARK`. Rows of `Private/platform-state/open.json`.
//   · QUEUE ids — one to three capitals, a dash, a number, an optional letter:
//     `A-12`, `S-3`, `O-3`. Rows of the business root's `owner-queue.json`.
//   ⚠️ `O-3` IS A QUEUE ID, NOT AN OPEN ONE. The owner queue carries `O-<n>`
//   rows (O-1 to O-8 when read on 2026-09-24, and not one open.json row has a
//   digit after its dash); three `tooling/legal/*.json` files hold
//   `ownerItem: "O-3"`, and `tooling/legal/README.md` cites `OWNER_QUEUE O-1`.
//   So "starts with O-" is not the test: a digit after the dash is the queue's
//   shape, and a word after it is open.json's.
//
// ── LIVENESS ─────────────────────────────────────────────────────────────────
//   · an OPEN id is live when its row has `state: "open"`, and a hold of kind
//     `owner-ruling` also needs `owner: "owner"` — a ruling only the owner may
//     make cannot be owed by an agent row;
//   · a QUEUE id is live when its row has `status: "pending"`.
//   An id with no row is ABSENT. The guard decides what each answer costs.
// ─────────────────────────────────────────────────────────────────────────────

export const OPEN_ID = /^O-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
export const QUEUE_ID = /^[A-Z]{1,3}-\d{1,4}[a-z]?$/;

/** 'open' | 'queue' | null. QUEUE_ID is tested first so `O-3` lands in the
 *  queue; the two patterns do not overlap once it has (OPEN_ID needs a letter
 *  after the dash), so the order only matters for that one reading. */
export function idClass(id) {
  if (typeof id !== 'string') return null;
  if (QUEUE_ID.test(id)) return 'queue';
  if (OPEN_ID.test(id)) return 'open';
  return null;
}

export const isOwnerId = (id) => idClass(id) !== null;

/** What each namespace's row must say for the id to count as live. `field` is
 *  the key read off the row; `live` the one value that means "still owed". */
export const LIVENESS = Object.freeze({
  open: Object.freeze({ register: 'open.json', field: 'state', live: 'open' }),
  queue: Object.freeze({ register: 'owner-queue.json', field: 'status', live: 'pending' }),
});

/** THE SUBJECTS: every Public field that holds a build on an owner id.
 *  F1 ships one. A subject is a tracked-file shape and a JSON path into it; a
 *  null at that path holds nothing and is not read as an id. */
export const HOLD_SUBJECTS = Object.freeze([
  Object.freeze({
    id: 'name-clearance-trademark',
    glob: 'apps/*/name-clearance.json',
    file: /^apps\/[^/]+\/name-clearance\.json$/,
    jsonPath: 'trademark.ownerItem',
    kind: 'owner-ruling',
  }),
]);

/** The subject a tracked path belongs to, or null. Forward slashes only, which
 *  is what `git ls-files` prints on every host. */
export function subjectFor(rel) {
  return HOLD_SUBJECTS.find((s) => s.file.test(rel)) ?? null;
}

const at = (doc, jsonPath) => {
  let v = doc;
  for (const k of jsonPath.split('.')) {
    if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return v;
};

/** The holds one parsed subject file carries: `[{ file, jsonPath, id, kind }]`.
 *  An absent or null value holds nothing. Any other value is returned as it is,
 *  so a number or a malformed string reaches the resolver and is reported there
 *  rather than being dropped here. */
export function holdsIn(subject, rel, doc) {
  const v = at(doc, subject.jsonPath);
  if (v === undefined || v === null) return [];
  return [{ file: rel, jsonPath: subject.jsonPath, id: v, kind: subject.kind }];
}

/** Every row-shaped object in a register, keyed by id: an object carrying a
 *  string `id` in the namespace's grammar AND the namespace's liveness field.
 *  Walked rather than read at one key, so the answer does not depend on how the
 *  register nests its rows; the liveness field is what makes an object a row
 *  rather than a mention. Returns `{ rows, duplicates }` — a held id that
 *  appears twice is ambiguous, and choosing one would be a guess. */
export function indexRows(doc, cls) {
  const { field } = LIVENESS[cls];
  const grammar = cls === 'open' ? OPEN_ID : QUEUE_ID;
  const rows = new Map();
  const duplicates = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.id === 'string' && grammar.test(v.id) && Object.prototype.hasOwnProperty.call(v, field)) {
      if (rows.has(v.id)) duplicates.add(v.id);
      else rows.set(v.id, v);
    }
    Object.values(v).forEach(walk);
  };
  walk(doc);
  return { rows, duplicates };
}

/** THE RESOLVER. `rowsByClass` is `{ open: Map|null, queue: Map|null }`; the
 *  guard passes null for a namespace it did not read, and asking about an id
 *  in that namespace is a programming error rather than an answer.
 *
 *  Returns one of:
 *    { verdict: 'malformed', why }         — not an id in either grammar
 *    { verdict: 'absent',    cls }         — no row carries it
 *    { verdict: 'not-live',  cls, state }  — a row, and it no longer owes it
 *    { verdict: 'live',      cls, state }  */
export function resolveHold(hold, rowsByClass) {
  const cls = idClass(hold.id);
  if (!cls) {
    return { verdict: 'malformed', why: `${JSON.stringify(hold.id)} is not an owner id (an open.json \`O-<WORDS>\` id, or an owner-queue id such as \`A-12\`)` };
  }
  const rows = rowsByClass[cls];
  if (!rows) throw new Error(`resolveHold: the ${LIVENESS[cls].register} rows were not supplied for ${hold.id}`);
  const row = rows.get(hold.id);
  if (!row) return { verdict: 'absent', cls };
  const { field, live } = LIVENESS[cls];
  const state = row[field];
  if (state !== live) return { verdict: 'not-live', cls, state: `${field}=${String(state)}` };
  if (cls === 'open' && hold.kind === 'owner-ruling' && row.owner !== 'owner') {
    return { verdict: 'not-live', cls, state: `owner=${String(row.owner)}` };
  }
  return { verdict: 'live', cls, state: `${field}=${state}` };
}
