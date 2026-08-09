// ─────────────────────────────────────────────────────────────────────────────
// consent_anon_id.mjs — WHICH INSTALL the nightly's consent artifact belongs to.
//
// `consent_artifacts` carries NO user id, deliberately (services/platform/
// migrations/0002_analytics.sql: "Deliberately carries NO IP and NO device
// fingerprint"): a DPDP consent record that named a person would defeat the
// pseudonymous id it is written against. The only key a row can be found by is
// `anon_id` — the per-install id under `nikatru.install_id` — and CI mints a
// fresh one in every browser profile, every night. So the RUN has to say which
// id it used, and this is the single place that answer is parsed.
//
// TWO SOURCES, IN THIS ORDER, AND THE ORDER IS THE POINT:
//   1. `build/integration_response_data.json` — `binding.reportData`, written
//      host-side by integration_test's `responseDataCallback`. A JSON FIELD:
//      structured, unambiguous, and it cannot be produced by prose.
//   2. the tee'd `flutter drive` log — the `E2E_CONSENT_ANON_ID=` token
//      apps/subly/test_driver/integration_test.dart prints. This is the hedge
//      for the case where the response file was never written at all (the
//      driver never obtained a response, the working directory moved).
//
// SHARED BY THE VERIFIER AND THE TEARDOWN, on purpose. One asserts the row
// exists, the other deletes it, and they MUST name the same row — two copies of
// a parser is precisely how they would come to disagree about which one.
//
// It is imported, never invoked as a step: naming it on a `run:` line would put
// it in assert-guard-coverage.mjs's set of workflow-invoked executables, which
// is a claim about a script CI runs directly.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

/** The token the DRIVER prints on the host. The app prints the same string into
 *  the browser console, where nothing reads it — see the note in
 *  apps/subly/integration_test/app_test.dart. */
export const ANON_ID_TOKEN = 'E2E_CONSENT_ANON_ID';

/** The shape `installIdProvider` mints: 16 bytes of `Random.secure()`, lower-case
 *  hex (apps/subly/lib/state/analytics_providers.dart).
 *
 *  🔴 A VALUE OF ANY OTHER SHAPE IS REFUSED RATHER THAN USED, AND THAT MATTERS
 *  MOST TO THE TEARDOWN. The id resolved here is interpolated into nothing, but
 *  it IS bound into a `DELETE … WHERE anon_id = ?` against production. A
 *  half-written log line, a truncated JSON field or a placeholder that happened
 *  to survive parsing would send that DELETE at a row this run never created.
 *  Refusing an unrecognised shape costs a red step and buys the guarantee that
 *  the teardown can only ever touch ids of the form the app itself mints. */
export const ANON_ID_SHAPE = /^[0-9a-f]{32}$/;

/** The run's `anon_id`, from reportData if it is there and from the drive log
 *  if it is not.
 *
 *  Returns `{ id, source, notes }` — `id` is `null` when nothing resolved, and
 *  `notes` always explains what each source was asked and what it answered.
 *  Callers PRINT the notes: "could not find the id" with no account of where it
 *  looked is the shape of report that gets a step disabled rather than fixed. */
export function resolveConsentAnonId({ responsePath, logPath } = {}) {
  const notes = [];
  const sources = [
    ['reportData', responsePath, fromResponseData],
    ['drive log', logPath, fromDriveLog],
  ];
  for (const [name, path, read] of sources) {
    if (!path) {
      notes.push(`${name}: no path was given, so it was not consulted`);
      continue;
    }
    const id = read(path, name, notes);
    if (id) return { id, source: `${name} (${path})`, notes };
  }
  return { id: null, source: null, notes };
}

/** `binding.reportData`, as written verbatim by `writeResponseData`. The file's
 *  top level IS the reportData map — the driver hands `response.data` straight
 *  to the callback — so `screenshots` sits beside `consent_anon_id` in it. */
function fromResponseData(path, name, notes) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    notes.push(`${name}: ${path} could not be read (${e.code ?? e.message})`);
    return null;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    notes.push(`${name}: ${path} is not JSON (${e.message})`);
    return null;
  }
  const value = json?.consent_anon_id;
  if (typeof value !== 'string' || value.length === 0) {
    notes.push(
      `${name}: ${path} carries no \`consent_anon_id\` — the suite reached the end without ` +
        'exporting one, or an older build wrote this file',
    );
    return null;
  }
  if (!ANON_ID_SHAPE.test(value)) {
    notes.push(`${name}: \`consent_anon_id\` ${JSON.stringify(value)} is not the 32-hex install-id shape`);
    return null;
  }
  notes.push(`${name}: ${path} → ${value}`);
  return value;
}

/** The LAST token in the log. A re-run inside one job appends to the same file,
 *  and the newest line is the one whose row is still in the database. */
function fromDriveLog(path, name, notes) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    notes.push(`${name}: ${path} could not be read (${e.code ?? e.message})`);
    return null;
  }
  const wellFormed = [...text.matchAll(new RegExp(`${ANON_ID_TOKEN}=([0-9a-f]{32})\\b`, 'g'))];
  if (wellFormed.length > 0) {
    const id = wellFormed[wellFormed.length - 1][1];
    notes.push(`${name}: ${path} → ${id} (last of ${wellFormed.length} token(s))`);
    return id;
  }
  const anyToken = [...text.matchAll(new RegExp(`${ANON_ID_TOKEN}=(\\S*)`, 'g'))];
  if (anyToken.length > 0) {
    notes.push(
      `${name}: ${path} carries ${anyToken.length} \`${ANON_ID_TOKEN}=\` token(s) but none is the ` +
        `32-hex install-id shape (last: ${JSON.stringify(anyToken[anyToken.length - 1][1])})`,
    );
    return null;
  }
  notes.push(`${name}: ${path} carries no \`${ANON_ID_TOKEN}=\` token`);
  return null;
}
