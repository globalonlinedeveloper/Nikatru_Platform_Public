// ─────────────────────────────────────────────────────────────────────────────
// auth-record-compare.mjs — the recorded hosted auth config, field by field,
// against one live read of it.
//
// ⏱ 2026-09-25 — MOVED, NOT REWRITTEN. The two loops below (every compared key
// of `supabaseAuth`, then the `subjects` map) and their `transportChecked` count
// stood inside verifyHosted() in verify-supabase-templates.mjs until today, where
// no case could reach them without a stubbed network and a whole fixture root.
// They sit here verbatim as one pure function, so a case hands it a record and a
// live object and reads the verdict. verify-supabase-templates.mjs imports it and
// STILL reads the register itself — assert-mail-transport-claims.mjs (limb C)
// proves that read behaviourally and fails if it goes away.
//
// ONE case is new, and only for a field the record names: `sameMeaning` (below,
// and `_whySameMeaning` in tooling/mail-transport.json). Every other line of
// output is the text the verifier printed before the move.
//
// Pure: no file, no network, no environment, no exit. The caller prints and
// decides the exit code. Returns { drift: string[], ok: string[], checked: number }.
// ─────────────────────────────────────────────────────────────────────────────

// So the derivation is now real: every key of `supabaseAuth` is a live field
// name and is compared, with exactly four exclusions, each of which has to say
// why out loud rather than sit in a list:
//   · `_`-prefixed keys are this register's own prose (`_why`, `_whyHardening`),
//     not fields — the same convention the rest of this file uses;
//   · `transport` is the register's VOCABULARY, not a Supabase field. Live has
//     no such key, so comparing it would report permanent drift against a word
//     we invented. assert-mail-transport-claims.mjs is what validates it.
//   · `subjects` (2026-09-24) is a MAP keyed by template (`confirmation`,
//     `magic_link`, `recovery`), not one field. Each key IS compared, just
//     below, against the live field it names: `mailer_subjects_<key>`.
//   · `sameMeaning` (2026-09-25) is a statement ABOUT fields, not a field: for a
//     named compared field, the values the live API may answer that mean the
//     same thing as the recorded one. Live has no such key. It is read before
//     the loop, and a malformed one is refused as DRIFT, never skipped:
//     assert-mail-transport-claims.mjs refuses the same four shapes in CI, so
//     a bad declaration is red there before Ops watch ever runs.
// Anything else in the record that live does not carry is DRIFT, not a skip:
// that is how a typo'd field name gets caught instead of quietly checking eight
// things while claiming eighteen.
export const NOT_A_LIVE_FIELD = new Set(['transport', 'subjects', 'sameMeaning']);

/** A JSON scalar: what a register list may hold. `NaN` and the infinities are
 *  numbers to JavaScript and nothing to JSON, so they are refused too. */
const isJsonScalar = (v) =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

const show = (v) => (v === undefined ? 'undefined' : JSON.stringify(v) ?? String(v));

/**
 * Reads `expectedAuth.sameMeaning` and returns every refusal as a DRIFT sentence,
 * plus the lists that passed, keyed by field. A refused entry grants nothing: its
 * field is compared strictly, so a malformed declaration can only ever ADD red.
 *
 * The four refusals, per entry: the key is not a compared field of this record;
 * the value is not an array of JSON scalars; the array is empty; the array does
 * not contain the recorded value. Membership is strict (`===`): `null`, `0` and
 * `"0"` are three different members.
 *
 * @param {Record<string, unknown>} expectedAuth the register's `supabaseAuth`
 * @returns {{ refused: string[], lists: Map<string, unknown[]> }}
 */
export function sameMeaningFindings(expectedAuth) {
  const refused = [];
  const lists = new Map();
  if (!Object.prototype.hasOwnProperty.call(expectedAuth, 'sameMeaning')) return { refused, lists };
  const declared = expectedAuth.sameMeaning;
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    refused.push(`auth \`sameMeaning\`: ${show(declared)} is not an object of field name -> list of values, so no equivalence is honoured and every field is compared strictly.`);
    return { refused, lists };
  }
  const compared = new Set(Object.keys(expectedAuth).filter((k) => !k.startsWith('_') && !NOT_A_LIVE_FIELD.has(k)));
  for (const [field, list] of Object.entries(declared)) {
    const at = `auth \`sameMeaning.${field}\``;
    if (!compared.has(field)) {
      refused.push(`${at}: \`${field}\` is not a compared field of this record, so the equivalence would apply to nothing. Refused rather than ignored: a misspelt name here reads as a declared exception that never fires.`);
    } else if (!Array.isArray(list) || !list.every(isJsonScalar)) {
      refused.push(`${at}: ${show(list)} is not an array of JSON scalars (string, number, boolean, null), so no equivalence is honoured and \`${field}\` is compared strictly.`);
    } else if (list.length === 0) {
      refused.push(`${at}: the list is EMPTY, so it declares nothing. Refused rather than read as "no value means the same"; \`${field}\` is compared strictly.`);
    } else if (!list.some((v) => v === expectedAuth[field])) {
      refused.push(`${at}: ${show(list)} does not contain the recorded value ${show(expectedAuth[field])}, so it cannot say what the recorded value means; \`${field}\` is compared strictly.`);
    } else {
      lists.set(field, list);
    }
  }
  return { refused, lists };
}

/**
 * The recorded auth config against one live read of `GET config/auth`.
 *
 * @param {Record<string, unknown>} expectedAuth the register's `supabaseAuth`
 * @param {Record<string, unknown>} live the parsed live config
 * @returns {{ drift: string[], ok: string[], checked: number }}
 */
export function compareAuthRecord(expectedAuth, live) {
  const drift = [];
  const ok = [];
  const { refused, lists: SAME } = sameMeaningFindings(expectedAuth);
  drift.push(...refused);
  const COMPARE = Object.keys(expectedAuth).filter((k) => !k.startsWith('_') && !NOT_A_LIVE_FIELD.has(k));
  let transportChecked = 0;
  for (const field of COMPARE) {
    transportChecked += 1;
    const want = expectedAuth[field];
    const got = live[field];
    // A key the live config does not carry AT ALL is its own sentence. Folding it
    // into the value comparison below prints `live says null`, which reads as "the
    // setting is off" when what happened is that the register names a field this
    // API has never heard of — a typo, or a field that was renamed upstream.
    if (!Object.prototype.hasOwnProperty.call(live, field)) {
      drift.push(`auth \`${field}\`: the register records ${JSON.stringify(want)}, and the live config has NO SUCH FIELD. Either the name is wrong here or it was renamed upstream; nothing is being checked either way.`);
      continue;
    }
    // String-compare: the API returns smtp_port as a string and booleans as
    // booleans, and a JSON register cannot promise which it wrote.
    if (String(want) !== String(got)) {
      // ⏱ 2026-09-25 — the ONE new case. Two different values are a match only
      // when the record itself declares both as the same meaning for THIS field,
      // by strict membership. Run 36097413255 read `sessions_timebox: 0` where
      // 36093365693, an hour earlier, read it unset; to GoTrue both are "never".
      const same = SAME.get(field);
      if (same && same.some((v) => v === want) && same.some((v) => v === got)) {
        ok.push(`${field} ≡ ${JSON.stringify(want)} (live ${JSON.stringify(got)}, declared same meaning)`);
      } else {
        drift.push(`auth \`${field}\`: register says ${JSON.stringify(want)}, live says ${JSON.stringify(got ?? null)}.`);
      }
    } else {
      ok.push(`${field} ≡ ${JSON.stringify(want)}`);
    }
  }
  // The subjects map: each recorded key against `mailer_subjects_<key>`, with the
  // same NO-SUCH-FIELD sentence as above, so a misspelt key is drift, not a skip.
  for (const [key, want] of Object.entries(expectedAuth.subjects ?? {})) {
    const field = `mailer_subjects_${key}`;
    transportChecked += 1;
    if (!Object.prototype.hasOwnProperty.call(live, field)) {
      drift.push(`auth subject \`${key}\`: the register records ${JSON.stringify(want)}, and the live config has NO SUCH FIELD \`${field}\`.`);
    } else if (String(want) !== String(live[field])) {
      drift.push(`auth \`${field}\`: register says ${JSON.stringify(want)}, live says ${JSON.stringify(live[field] ?? null)}.`);
    } else {
      ok.push(`${field} ≡ ${JSON.stringify(want)}`);
    }
  }
  if (transportChecked === 0) {
    drift.push('the register\'s `supabaseAuth` declared no comparable field at all, so NOTHING about the live auth config was checked. That is a gap, not a match.');
  }
  return { drift, ok, checked: transportChecked };
}
