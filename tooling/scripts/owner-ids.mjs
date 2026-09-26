// ─────────────────────────────────────────────────────────────────────────────
// owner-ids.mjs — which PUBLIC fields hold a build on an owner id, and whether
// the id they name is still a live item somebody owes.
//
// 🔴 WHY THIS EXISTS (apps-review F1, O-NAME-CLEARANCE-WAITS-ON-A-MISSING-ROW).
// `apps/subscriptiontracker/name-clearance.json` lifted limb 7's block with
// `trademark.ownerItem` set to an owner id no row carried, and a `gatedUntil` date.
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
// ── TWO REGISTERS, AND AN ID IS LOOKED UP IN BOTH ────────────────────────────
//   · `Private/platform-state/open.json` — rows such as `O-NAME-CLEARANCE-WAITS-ON-A-MISSING-ROW`.
//   · the business root's `owner-queue.json` — rows such as `A-12`, `S-3`, `O-3`.
//   ⚠️ `O-3` IS A QUEUE ID, NOT AN OPEN ONE. The owner queue carries `O-<n>`
//   rows (O-1 to O-8 when read on 2026-09-24, and not one open.json row has a
//   digit after its dash); three `tooling/legal/*.json` files hold
//   `ownerItem: "O-3"`, and `tooling/legal/README.md` cites `OWNER_QUEUE O-1`.
//   So "starts with O-" is not the test.
//   ⏱ 2026-09-24 (the PR 913 review, L1): NOR IS ANY GRAMMAR. This file used to
//   say that a word after the dash marks open.json's shape. The queue's address row is an
//   owner-QUEUE row with exactly that shape, so the grammar sent it to open.json,
//   where it is ABSENT; and 18 of the queue's 70 ids fall outside QUEUE_ID, the
//   review's count (`HOSTINGER-EXPIRY`, which is pending, `OD-6.1`, `A-13-orig`,
//   `G-49-MOVE`).
//   So the register is not read off the id. `idClass` survives as a FIRST GUESS
//   and decides nothing: the resolver looks the id up in BOTH registers. Found in
//   exactly one — that register's row. Found in both — AMBIGUOUS. Found in
//   neither — ABSENT. `indexRows` keys a row on the liveness field, never on the
//   grammar, so a queue row whose id fits no pattern is still a row.
//   MALFORMED is kept for a value that cannot be an id whatever the registers
//   say: not a string, empty, holding whitespace, or with no upper-case letter
//   at all (`someone will rule`, `o-lowercase`). That is the whole of
//   `isOwnerId`, and limb 7 of `tooling/ci/assert-name-clearance.mjs` reads the
//   same function, so the two readers cannot disagree about what an id looks like.
//
// ── LIVENESS ─────────────────────────────────────────────────────────────────
//   · an OPEN row is live when it has `state: "open"`, and a hold of kind
//     `owner-ruling` also needs `owner: "owner"` — a ruling only the owner may
//     make cannot be owed by an agent row;
//   · a QUEUE row is live when it has `status: "pending"`.
//   An id with no row is ABSENT. The guard decides what each answer costs.
//
// ── A HOLD MUST NAME ITS SUBJECT (the PR 913 review, M1) ─────────────────────
//   The review held `trademark.ownerItem` on `O-KEY-ESCROW` — a live owner row
//   about key escrow — and this resolver said `live`: any live row the owner
//   owned would lift the gate, which is a waiver with a real id typed onto it.
//   THE ONE RULE: a live row counts only when its text names the SUBJECT FILE by
//   its repo-relative path (`apps/<app>/name-clearance.json`), the exact string
//   `git ls-files` prints for it. Path, not "the app id near the word `name`",
//   because a path is exact and a word is a guess. The text read is
//     · for an open.json row, its `blocks` or its `closes` (either);
//     · for an owner-queue row, every one of its own string fields other than
//       `id` and `status` (a string, or an array of strings) — the queue has no
//       field that plays the part `blocks` / `closes` play in open.json.
//   A live row that names no subject is UNRELATED, and the guard costs it exactly
//   what it costs ABSENT.
//
// ── ⏱ 2026-09-25: A SECOND SUBJECT, THE CHANNEL REGISTER (D3a) ───────────────
//   Row O-CAPTURE-LEAVES-DERIVED-SETS-STALE, its clause "ownerQueue resolves
//   against open rows". `tooling/channel-register.json` names an owner item on
//   every store row (`channels[].ownerQueue`), and nothing read what the id
//   named: A-3, A-4 (twice) and A-2 were all CLOSED in the owner queue while
//   the register still pointed at them, and android-play's own note said
//   "OWNER_QUEUE A-3 CLOSED". This file declares that subject with THREE fields
//   and, for each, what the named row must be:
//     · `channels[].ownerQueue` — a LIVE row: the item somebody still owes for
//       the channel. A closed one moves to `accountStatus.openedBy`.
//     · `channels[].accountStatus.openedBy` — any row that EXISTS, in any
//       state. It is provenance: the item that opened the account.
//     · `disqualified[].ownerQueue` — any row that EXISTS. A disqualification
//       cites the item that ruled it, and a ruled item is closed.
//   A field path may step through an array (`channels[]`). Each hold's path
//   carries the element's `id` (`channels[linux-snap].ownerQueue`), so every
//   message names the channel. A `[]` key that is present and not an array is
//   a SubjectShapeError, and the guard makes it COVERAGE LOST.
//   ⚠️ THE SUBJECT RULE ABOVE DOES NOT APPLY TO THIS KIND, and the reason is not
//   leniency. The rule stops any live owner row from lifting a build GATE, and a
//   register pointer lifts no gate: it names who is accountable for a channel.
//   Requiring the row to name `tooling/channel-register.json` would require the
//   owner to cite a Public path in the owner's own file, which no agent writes.
//   `KINDS` below is where each kind says which rules it takes.
// ─────────────────────────────────────────────────────────────────────────────

export const OPEN_ID = /^O-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
export const QUEUE_ID = /^[A-Z]{1,3}-\d{1,4}[a-z]?$/;

/** 'open' | 'queue' | null — the FIRST GUESS at a register, from the id's shape
 *  alone. QUEUE_ID is tested first so `O-3` lands in the queue; the two patterns
 *  do not overlap once it has (OPEN_ID needs a letter after the dash), so the
 *  order only matters for that one reading. Nothing is decided by it: see the
 *  header, and `resolveHold`, which looks every id up in both registers. */
export function idClass(id) {
  if (typeof id !== 'string') return null;
  if (QUEUE_ID.test(id)) return 'queue';
  if (OPEN_ID.test(id)) return 'open';
  return null;
}

/** Could this value be an owner id at all? A non-empty string with no
 *  whitespace and at least one upper-case letter. Which register carries it is a
 *  lookup, never a reading of its shape. */
export const isOwnerId = (id) => typeof id === 'string' && id.length > 0 && !/\s/.test(id) && /[A-Z]/.test(id);

export const REGISTERS = Object.freeze(['open', 'queue']);

/** What each namespace's row must say for the id to count as live. `field` is
 *  the key read off the row; `live` the one value that means "still owed". */
export const LIVENESS = Object.freeze({
  open: Object.freeze({ register: 'open.json', field: 'state', live: 'open' }),
  queue: Object.freeze({ register: 'owner-queue.json', field: 'status', live: 'pending' }),
});

/** What each kind of hold is held to, beyond existing and being live.
 *    · `ownerOnly` — an open.json row counts only when `owner: "owner"`;
 *    · `namesSubject` — a live row counts only when its text names the subject
 *      file (the PR 913 review's M1 rule, in the header).
 *  A kind this table does not list takes `namesSubject` and not `ownerOnly`,
 *  which is how the resolver treated every kind before the table existed. */
export const KINDS = Object.freeze({
  'owner-ruling': Object.freeze({ ownerOnly: true, namesSubject: true }),
  'register-owner-queue': Object.freeze({ ownerOnly: false, namesSubject: false }),
});
const DEFAULT_KIND = Object.freeze({ ownerOnly: false, namesSubject: true });

/** THE SUBJECTS: every Public field that holds a build on an owner id, or
 *  points at one. A subject is a tracked-file shape and either ONE `jsonPath`
 *  (F1's shape, held to `live`) or a list of `fields`, each a `jsonPath` that
 *  may step through arrays and the `requires` its id is held to: `live` (a row
 *  still owed) or `exists` (a row in any state, for provenance). A null at a
 *  path holds nothing and is not read as an id. `heldWhileNull` is the path of
 *  the answer the hold waits on: once a value is recorded there the id is
 *  provenance, not a hold, which is how limb 7 of
 *  `tooling/ci/assert-name-clearance.mjs` reads the same record. */
export const HOLD_SUBJECTS = Object.freeze([
  Object.freeze({
    id: 'name-clearance-trademark',
    glob: 'apps/*/name-clearance.json',
    file: /^apps\/[^/]+\/name-clearance\.json$/,
    jsonPath: 'trademark.ownerItem',
    heldWhileNull: 'trademark.ruling',
    kind: 'owner-ruling',
  }),
  /* ── REGISTER SUBJECT BEGIN ── the test deletes this region to rebuild the
     guard as it stood before the subject existed, and watches the subject bite. */
  Object.freeze({
    id: 'register-owner-queue',
    glob: 'tooling/channel-register.json',
    file: /^tooling\/channel-register\.json$/,
    kind: 'register-owner-queue',
    fields: Object.freeze([
      Object.freeze({ jsonPath: 'channels[].ownerQueue', requires: 'live' }),
      Object.freeze({ jsonPath: 'channels[].accountStatus.openedBy', requires: 'exists' }),
      Object.freeze({ jsonPath: 'disqualified[].ownerQueue', requires: 'exists' }),
    ]),
  }),
  /* ── REGISTER SUBJECT END ── */
]);

/** The JSON paths a subject reads, for the guard's report line. */
export const subjectPaths = (subject) => (subject.fields ? subject.fields.map((f) => f.jsonPath) : [subject.jsonPath]);

/** A subject file whose shape leaves what it holds unknown: a `[]` key that is
 *  present and is not an array. The guard makes it COVERAGE LOST. */
export class SubjectShapeError extends Error {}

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
 *  A subject declaring `fields` is read by `fieldHolds` below instead.
 *  An absent or null value holds nothing, and neither does any value once the
 *  subject's `heldWhileNull` path carries a recorded answer (a ruling kept
 *  beside its old id for provenance is not a hold). A null or ABSENT answer
 *  leaves the hold standing: a record that lost its `ruling` field has not
 *  recorded one. Any other id value is returned as it is, so a number or a
 *  malformed string reaches the resolver and is reported there rather than
 *  being dropped here. */
export function holdsIn(subject, rel, doc) {
  if (subject.fields) return subject.fields.flatMap((f) => fieldHolds(subject, f, rel, doc));
  const v = at(doc, subject.jsonPath);
  if (v === undefined || v === null) return [];
  if (subject.heldWhileNull) {
    const answer = at(doc, subject.heldWhileNull);
    if (answer !== undefined && answer !== null) return [];
  }
  return [{ file: rel, jsonPath: subject.jsonPath, id: v, kind: subject.kind }];
}

/** The holds one `fields` entry carries: `[{ file, jsonPath, id, kind, requires,
 *  anchor, key }]`, one per non-null value its path reaches. A `name[]` segment
 *  steps into every element of the array at `name`, and the hold's `jsonPath`
 *  names the element by its `id` (by its index when it has none). `anchor` is
 *  that element id and `key` the last segment, which is how the guard finds the
 *  line. An absent key reaches nothing; a `[]` key that is present and is not an
 *  array throws SubjectShapeError. */
function fieldHolds(subject, field, rel, doc) {
  let frontier = [{ v: doc, path: '', anchor: null }];
  const segs = field.jsonPath.split('.');
  for (const seg of segs) {
    const many = seg.endsWith('[]');
    const key = many ? seg.slice(0, -2) : seg;
    const next = [];
    for (const { v, path, anchor } of frontier) {
      if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, key)) continue;
      const child = v[key];
      const base = path ? `${path}.${key}` : key;
      if (!many) { next.push({ v: child, path: base, anchor }); continue; }
      if (!Array.isArray(child)) {
        throw new SubjectShapeError(`\`${base}\` is ${child === null ? 'null' : typeof child}, and ${field.jsonPath} steps through it as an array`);
      }
      child.forEach((el, i) => {
        const named = el !== null && typeof el === 'object' && typeof el.id === 'string' && el.id !== '';
        next.push({ v: el, path: `${base}[${named ? el.id : i}]`, anchor: named ? el.id : anchor });
      });
    }
    frontier = next;
  }
  const key = segs[segs.length - 1];
  return frontier
    .filter(({ v }) => v !== undefined && v !== null)
    .map(({ v, path, anchor }) => ({ file: rel, jsonPath: path, id: v, kind: subject.kind, requires: field.requires, anchor, key }));
}

/** Every row-shaped object in a register, keyed by id: an object carrying an
 *  `id` that passes `isOwnerId` AND the register's liveness field. The liveness
 *  field is what makes an object a row rather than a mention; the id's pattern
 *  plays no part, because the queue carries ids no pattern here fits. Walked
 *  rather than read at one key, so the answer does not depend on how the
 *  register nests its rows. Returns `{ rows, duplicates }` — a held id that
 *  appears twice is ambiguous, and choosing one would be a guess. */
export function indexRows(doc, cls) {
  const { field } = LIVENESS[cls];
  const rows = new Map();
  const duplicates = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (isOwnerId(v.id) && Object.prototype.hasOwnProperty.call(v, field)) {
      if (rows.has(v.id)) duplicates.add(v.id);
      else rows.set(v.id, v);
    }
    Object.values(v).forEach(walk);
  };
  walk(doc);
  return { rows, duplicates };
}

/** The text of one field, for the subject test: a string, or the strings of an
 *  array. Anything else says nothing. */
const textOf = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter((s) => typeof s === 'string').join('\n') : '');

/** The fields whose text must name the subject, per register. open.json rows
 *  carry `blocks` and `closes`; an owner-queue row's text is every string field it
 *  has other than `id` and the liveness field. */
export function subjectText(row, cls) {
  if (cls === 'open') return [textOf(row.blocks), textOf(row.closes)].join('\n');
  const { field } = LIVENESS[cls];
  return Object.entries(row)
    .filter(([k]) => k !== 'id' && k !== field)
    .map(([, v]) => textOf(v))
    .join('\n');
}

/** Does this row name the hold's subject? Its text carries the subject file's
 *  repo-relative path — the one rule, stated in the header. */
export const namesSubject = (row, cls, hold) => typeof hold.file === 'string' && hold.file.length > 0 && subjectText(row, cls).includes(hold.file);

/** THE RESOLVER. `rowsByClass` is `{ open: Map, queue: Map }`, and BOTH are
 *  required: an id is looked up in both registers, so a missing one is a
 *  programming error rather than an answer.
 *
 *  Returns one of:
 *    { verdict: 'malformed', why }             — `isOwnerId` refuses it
 *    { verdict: 'absent',    guess }           — neither register carries it;
 *                                                `guess` is `idClass`, for the message
 *    { verdict: 'ambiguous', classes }         — both registers carry it
 *    { verdict: 'exists',    cls, state }      — a row, in any state, for a hold
 *                                                whose `requires` is `exists`
 *    { verdict: 'not-live',  cls, state }      — a row, and it no longer owes it
 *    { verdict: 'unrelated', cls, id, state }  — a live row whose text never
 *                                                names the subject file, for a
 *                                                kind that takes that rule
 *    { verdict: 'live',      cls, state }
 *  A hold with no `requires` (F1's shape) is held to `live`. */
export function resolveHold(hold, rowsByClass) {
  if (!isOwnerId(hold.id)) {
    return {
      verdict: 'malformed',
      why: `${JSON.stringify(hold.id)} is not an owner id (a non-empty string with no whitespace and at least one upper-case letter, carried by a row of open.json or owner-queue.json)`,
    };
  }
  for (const cls of REGISTERS) {
    if (!rowsByClass?.[cls]) throw new Error(`resolveHold: the ${LIVENESS[cls].register} rows were not supplied for ${hold.id}, and an id is looked up in both registers`);
  }
  const found = REGISTERS.filter((cls) => rowsByClass[cls].has(hold.id));
  if (found.length === 0) return { verdict: 'absent', guess: idClass(hold.id) };
  if (found.length > 1) return { verdict: 'ambiguous', classes: found };
  const [cls] = found;
  const row = rowsByClass[cls].get(hold.id);
  const { field, live } = LIVENESS[cls];
  const state = row[field];
  if (hold.requires === 'exists') return { verdict: 'exists', cls, state: `${field}=${String(state)}` };
  if (state !== live) return { verdict: 'not-live', cls, state: `${field}=${String(state)}` };
  const rules = KINDS[hold.kind] ?? DEFAULT_KIND;
  if (cls === 'open' && rules.ownerOnly && row.owner !== 'owner') {
    return { verdict: 'not-live', cls, state: `owner=${String(row.owner)}` };
  }
  if (rules.namesSubject && !namesSubject(row, cls, hold)) return { verdict: 'unrelated', cls, id: row.id, state: `${field}=${state}` };
  return { verdict: 'live', cls, state: `${field}=${state}` };
}
