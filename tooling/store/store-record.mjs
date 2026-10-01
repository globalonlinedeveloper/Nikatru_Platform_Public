// ─────────────────────────────────────────────────────────────────────────────
// store-record.mjs — ONE reading of "what did a store console issue to this app,
// and has the owner sworn this app's declarations in that console".
//
// O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9a). Every store-issued id is per app:
// apps/<id>/app.yaml `stores.<channel id>` holds one closed record per store
// channel (tooling/app-yaml/schema/app.schema.json `stores`). This module is the
// reader every consumer goes through, so none of them re-parses the record and
// none of them invents a default.
//
// 🔴 TWO FACTS, TWO FIELDS, NEVER MERGED (O-APP1-CONSOLE-DECLARATIONS-UNSUBMITTED, 2026-09-26):
//   · whether a channel's store FILES are final content or the brick's preview is
//     each file's own `"sworn"` key, judged per (app, channel) by
//     tooling/ci/assert-sworn-store-files.mjs. Nothing here reads it or changes it.
//   · `declaredOn` is the DATE the owner swore that content in the store's
//     console. It is null until the owner says so, and it gates ONE thing: a REAL
//     submission (`declaredOnRefusal` below). A dry run grades the bytes and
//     proceeds. `declaredOn: null` never turns an app into a preview.
//
// Answers, and never a default:
//   storeRecordOf(root, appId, channelId) → { rel, state, declaredOn, …ids }, or a
//     THROWN error naming the cause: an unknown channel, no apps/<appId>/app.yaml,
//     a declaration that does not parse, no `stores.<channel>` record, or a record
//     whose `state` / `declaredOn` is not one of the allowed values.
//   readAppStores(root, appId) → the parsed `stores` mapping: the ONE parse,
//     which lives in tooling/ci/read-identity.mjs beside windowsIdentityOf (whose
//     answers are structured rather than thrown) and is re-exported here.
//
// The record SHAPE is this repository's (the schema beside render.mjs, resolved
// from this file); the record DATA is the root's. So a fixture root holds only
// the app declarations it tests.
//
// The bundle id is derived, never stored: `bundleIdOf` is re-exported from
// tooling/ci/apple-provisioning.mjs (prep6 B1), not re-implemented. The Android
// package name is `com.nikatru.<id>`, derived the same way by its readers.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppStores } from '../ci/read-identity.mjs';

export { bundleIdOf } from '../ci/apple-provisioning.mjs';
export { readAppStores };

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), '..', 'app-yaml', 'schema', 'app.schema.json');

/** The two keys every channel's record carries; every other property is an id
 *  the console issues. */
export const RECORD_STATE_KEYS = Object.freeze(['state', 'declaredOn']);
export const RECORD_STATES = Object.freeze(['pending', 'issued']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** channel id → the id fields its console issues, read from the schema's
 *  `stores` sub-schemas, so a channel added there is known here with no edit. */
export const STORE_ID_FIELDS = (() => {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
  const channels = schema?.properties?.stores?.properties;
  if (!channels || typeof channels !== 'object') {
    throw new Error(`${SCHEMA} declares no properties.stores.properties, so no store channel has a per-app record`);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(channels).map(([id, sub]) => [
        id,
        Object.freeze(Object.keys(sub?.properties ?? {}).filter((k) => !RECORD_STATE_KEYS.includes(k))),
      ]),
    ),
  );
})();

/** The channel ids that carry a per-app store record, in schema order. */
export const STORE_CHANNELS = Object.freeze(Object.keys(STORE_ID_FIELDS));

/** One app's record for one store channel. Throws; never returns a default. */
export function storeRecordOf(root, appId, channelId) {
  if (!Object.hasOwn(STORE_ID_FIELDS, channelId)) {
    throw new Error(`"${channelId}" is not a store channel with a per-app record (known: ${STORE_CHANNELS.join(', ')})`);
  }
  const read = readAppStores(root, appId);
  if (read.absent) throw new Error(`${read.rel} does not exist, so app "${appId}" has no ${channelId} record`);
  if (read.parseError) throw new Error(`${read.rel} does not parse (${read.parseError}), so app "${appId}"'s ${channelId} record cannot be read`);
  const rec = read.stores && typeof read.stores === 'object' ? read.stores[channelId] : undefined;
  if (rec === undefined || rec === null) {
    throw new Error(`${read.rel} declares no stores.${channelId} record. Every store channel carries one; an app with nothing issued yet writes state: pending, declaredOn: null`);
  }
  if (typeof rec !== 'object' || Array.isArray(rec)) {
    throw new Error(`${read.rel} stores.${channelId} is ${JSON.stringify(rec)}, not a record`);
  }
  if (!RECORD_STATES.includes(rec.state)) {
    throw new Error(`${read.rel} stores.${channelId}.state is ${JSON.stringify(rec.state ?? null)}; it is one of ${RECORD_STATES.join(', ')}`);
  }
  if (!Object.hasOwn(rec, 'declaredOn')) {
    throw new Error(`${read.rel} stores.${channelId} has no declaredOn. It is null until the owner swears this channel's console declarations, and then the date they did`);
  }
  if (rec.declaredOn !== null && !(typeof rec.declaredOn === 'string' && DATE.test(rec.declaredOn))) {
    throw new Error(`${read.rel} stores.${channelId}.declaredOn is ${JSON.stringify(rec.declaredOn)}; it is null or a YYYY-MM-DD date`);
  }
  const ids = Object.fromEntries(STORE_ID_FIELDS[channelId].filter((f) => Object.hasOwn(rec, f)).map((f) => [f, rec[f]]));
  return { rel: read.rel, state: rec.state, declaredOn: rec.declaredOn, ...ids };
}

/**
 * Pure. The id fields an `issued` record lacks: absent, empty, or still the
 * channel's not-yet-configured sentinel. An empty list for a `pending` record,
 * which by definition has not been issued everything.
 */
export function missingIdsOf(channelId, record, { sentinel = null } = {}) {
  if (record?.state !== 'issued') return [];
  return (STORE_ID_FIELDS[channelId] ?? []).filter((f) => {
    const v = record[f];
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v !== 'string' || v.trim() === '') return true;
    return sentinel !== null && v.includes(sentinel);
  });
}

/**
 * Pure. O-APP1-CONSOLE-DECLARATIONS-UNSUBMITTED: a REAL submission of (app, channel) whose
 * record has `declaredOn: null` is refused, and the refusal tells the owner
 * what to do. A dry run is never refused here: it grades the bytes and says
 * the same thing as a print. → the refusal text, or null when the record is
 * declared.
 *
 * `files` names the repo files the owner copies into the console (the sworn
 * set of the channel), so the message points at the exact source of the form.
 */
export function declaredOnRefusal(record, { appId, channelId, files = [], form = null }) {
  if (record?.declaredOn !== null) return null;
  // ⏱ 2026-10-01: a channel can owe BOTH — windows-store's age ratings are a sworn file and its
  // Properties form is console-only — so the form and the files are named together.
  const from =
    [form ? `(${form})` : null, files.length > 0 ? `from ${files.join(', ')}` : null].filter(Boolean).join(' ') ||
    "from this app's store files";
  return (
    `${record.rel} stores.${channelId}.declaredOn is null: the owner has not sworn app "${appId}"'s ` +
    `${channelId} declarations in the store console. Submit that console form ${from} first, then record ` +
    `the date it was submitted as stores.${channelId}.declaredOn (YYYY-MM-DD).`
  );
}
