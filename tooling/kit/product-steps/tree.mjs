// ─────────────────────────────────────────────────────────────────────────────
// product-steps/tree.mjs — the reads every product-step reader shares, and the
// one shape a reader answers in.
//
// Row O-NEW-PRODUCT-HAS-NO-READOUT. Each reader under this directory is
// `read(root, id, ctx) → answer`, pure over the tree at `root`: it writes
// nothing, spawns nothing but a named read-only check, and calls no network.
//
// An answer is one of:
//   { state: 'DONE',       detail }
//   { state: 'NEXT',       detail, command }            the agent's step
//   { state: 'OWNER',      detail, owner, command? }    printed, never performed
//   { state: 'AFTER-LIVE', detail }                     waits on the product going live
//   { state: 'UNREAD',     detail }                     the source lives outside this
//                                                       repository and is not beside it
//   { lost: '<why>' }                                   the reader could not read its
//                                                       source: COVERAGE LOST, exit 2
// and every answer but `lost` carries `guard`: the check that owns the step's
// sentinel, which the pairing test runs against the same fixture.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from '../../app-yaml/yaml.mjs';
import { CATALOG_DIR, readCatalogFile } from '../../catalog/read.mjs';

export const appYamlRel = (id) => `apps/${id}/app.yaml`;

/** `{ ok, value }` for a JSON file under `root`, `{ ok: false, missing }` when it
 *  is absent, `{ ok: false, why }` when it does not parse. */
export function readJsonAt(root, rel) {
  const abs = join(root, ...rel.split('/'));
  if (!existsSync(abs)) return { ok: false, missing: true, why: `${rel} does not exist` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { ok: false, why: `${rel} is not valid JSON (${e.message})` };
  }
}

/** The app's declaration: `{ ok, doc }`, `{ ok: false, missing }` before a
 *  stamp, `{ ok: false, why }` when it does not parse. */
export function readAppYaml(root, id) {
  const rel = appYamlRel(id);
  const abs = join(root, ...rel.split('/'));
  if (!existsSync(abs)) return { ok: false, missing: true, why: `${rel} does not exist` };
  try {
    return { ok: true, doc: parseYaml(readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { ok: false, why: `${rel} does not parse (${e.message})` };
  }
}

/** The app catalogue, repo-relative. It is read through tooling/catalog/read.mjs, the one Node reader. */
export const APPS_CATALOG = `${CATALOG_DIR}/apps.json`;

/** The catalogue row for `id`, or null; `{ lost }` when the app catalogue cannot be read. */
export function catalogRowOf(root, id) {
  const r = readCatalogFile(root, APPS_CATALOG);
  if (!r.ok) return { lost: `${r.why}, so no app's catalogue row can be read` };
  if (!Array.isArray(r.value)) return { lost: `${APPS_CATALOG} is not a JSON array` };
  return { row: r.value.find((a) => a?.slug === id) ?? null };
}
