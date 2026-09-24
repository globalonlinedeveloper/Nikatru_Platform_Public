// ─────────────────────────────────────────────────────────────────────────────
// name-clearance-why.mjs — the `_why` lines of apps/<app>/name-clearance.json,
// computed from that record's own fields and from nothing else.
//
// 🔴 WHY THE PROSE IS GENERATED. Until 2026-09-24 `_why` was hand-written and
// `--execute` carried it over verbatim, so it went on saying what was true the
// day it was typed: the subscriptiontracker record explained a Subly collision
// fifteen days after the rename, and named `ios-appstore` as having no lane
// after it had one. A sentence about a field is a second copy of that field, and
// only one of the two was ever re-probed.
//
// So `whyLines(record)` reads ONLY the record: the name and its `verify`
// command, `asOf`, `overall`, each channel's verdict (grouped as clear, held,
// blocked for a submission, and not applicable) and the trademark block with its
// ownerItem. It takes no register, no tree and no clock, which is why it carries
// no word about whether a channel can reach a user today: that is register
// state, and tooling/ci/assert-name-clearance.mjs computes it on every run.
//
// Writers: tooling/store/name-clearance.mjs on every write (--execute, --hold,
// and --why, which rewrites `_why` alone, offline). Reader: limb 11 of
// tooling/ci/assert-name-clearance.mjs, which refuses a `_why` that is not
// exactly these lines. It is `tooling/store/` and not `tooling/ci/` because it
// is a tool's function, not a guard (`assert-guard-coverage.mjs` treats every
// `.mjs` under tooling/ci as one).
//
// It is TOTAL: a record the schema would refuse still gets lines, because the
// fixture suites mutate a record one property at a time and call this on it.
// ─────────────────────────────────────────────────────────────────────────────

/** The verdict groups, in print order, each with the sentence that says what
 *  the verdict means for a submission. A verdict outside these still prints,
 *  under its own name, after them. */
const GROUPS = [
  ['PROVEN-FREE', 'Clear (PROVEN-FREE) — an authority answered "no such name" with its red control green'],
  ['HELD', 'Held (HELD) — the owner reserved the name in that store\'s console and recorded its id'],
  ['PROVEN-TAKEN', 'Blocked for a submission (PROVEN-TAKEN) — a live record holds the name'],
  ['UNDETERMINED', 'Blocked for a submission (UNDETERMINED) — could not check, which is never a pass'],
  ['NOT-APPLICABLE', 'Not applicable (NOT-APPLICABLE) — no third party holds a name there, and no submission passes on it'],
];

const text = (v, fallback) => (typeof v === 'string' && v.trim() !== '' ? v : fallback);

/** One channel's mention in its group: the id, `(global)` where the store
 *  refuses a duplicate, and the store record id and date on a hold. */
function mention(id, ch) {
  const marks = [];
  if (ch?.uniqueness === 'global') marks.push('global');
  if (ch?.verdict === 'HELD') marks.push(`store record ${text(ch.storeRecordId, '(none recorded)')}, ${text(ch.heldOn, 'undated')}`);
  return marks.length ? `${id} (${marks.join('; ')})` : id;
}

function trademarkLine(tm) {
  if (!tm || typeof tm !== 'object') return 'Trademark: the record carries no trademark block.';
  if (tm.ruling === 'PROCEED' || tm.ruling === 'DO-NOT-PROCEED') {
    return (
      `Trademark: ${tm.ruling}, ruled by ${text(tm.ruledBy, '(nobody recorded)')} on ${text(tm.ruledOn, '(no date)')}, ` +
      `basis ${text(tm.basis, '(none recorded)')}. No software can clear a trademark; the ruling is the owner's.`
    );
  }
  if (tm.ruling === null || tm.ruling === undefined) {
    return (
      `Trademark: no ruling — QUALIFIED, never clear. Owed under ${text(tm.ownerItem, '(no owner item)')}` +
      `${text(tm.gatedUntil, '') ? `, owner-gated until ${tm.gatedUntil}` : ''}; a submission is refused until it is ruled.`
    );
  }
  return `Trademark: ruling ${JSON.stringify(tm.ruling)}, which is not a ruling this record's readers accept.`;
}

/**
 * The `_why` array for `record`. Pure: the same record always gives the same
 * lines, and nothing outside the record is read.
 */
export function whyLines(record) {
  const r = record && typeof record === 'object' ? record : {};
  const app = text(r.app, '<app>');
  const name = r.name && typeof r.name === 'object' ? r.name : {};
  const channels = r.channels && typeof r.channels === 'object' ? Object.entries(r.channels) : [];

  const byVerdict = new Map();
  for (const [id, ch] of channels) {
    const v = typeof ch?.verdict === 'string' ? ch.verdict : String(ch?.verdict);
    if (!byVerdict.has(v)) byVerdict.set(v, []);
    byVerdict.get(v).push(mention(id, ch));
  }
  const known = new Set(GROUPS.map(([v]) => v));
  const groupLines = GROUPS.map(([v, head]) => `${head}: ${byVerdict.get(v)?.join(', ') ?? 'none'}.`);
  for (const [v, ids] of byVerdict) if (!known.has(v)) groupLines.push(`${v} — not a verdict this record's readers accept: ${ids.join(', ')}.`);

  return [
    `GENERATED — whyLines() in tooling/store/name-clearance-why.mjs computes these lines from this record's own fields, and limb 11 of tooling/ci/assert-name-clearance.mjs refuses any other text. Change a field, then regenerate offline: node tooling/store/name-clearance.mjs --why --app ${app}`,
    `"${text(name.value, '(no name)')}", probed ${text(r.asOf, '(undated)')}; overall ${text(r.overall, '(none)')}. Re-probe (networked, ~20 external calls): ${text(name.verify, '(no verify command)')}`,
    ...groupLines,
    trademarkLine(r.trademark),
    `A submit lane runs node tooling/ci/assert-name-clearance.mjs --for-submission=<channel>, which passes only PROVEN-FREE, or HELD with its store record id, on that channel. The owner records a hold with: node tooling/store/name-clearance.mjs --hold <channel> --record <store record id> --app ${app}`,
    'Whether a channel can reach a user today is register state and is not written here: tooling/ci/assert-name-clearance.mjs reads it off tooling/channel-register.json on every run.',
  ];
}
