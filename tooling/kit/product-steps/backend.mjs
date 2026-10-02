// product-steps/backend.mjs — step 5: an app that declares its own API host has
// a stamped Worker whose APP_DB is provisioned (E-a1/E-b2). Sources:
// apps/<id>/app.yaml `hosts.api` and services/<id>-api/wrangler.jsonc. A
// client-only app (no `hosts.api`) calls the shared platform Worker, so this step
// is DONE for it by the declaration. A SERVICE's Worker is the one the service
// set derives (rv2-newproduct-016); one that binds no APP_DB owns no database
// for provision-backend.mjs to provision.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serviceConfigOf } from './service-stamp.mjs';
import { readAppYaml } from './tree.mjs';

export const name = 'backend';
export const guard = 'node tooling/ci/assert-d1-bindings.mjs';
/** The template's all-zeros database id, which provision-backend.mjs replaces. */
export const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
/** The FIRST `database_id` after `"binding": "APP_DB"`, the entry provision-backend.mjs patches. */
const APP_DB_ID = /"binding"\s*:\s*"APP_DB"[\s\S]{0,400}?"database_id"\s*:\s*"([^"]+)"/;

/** A service's Worker: stamped, then its APP_DB provisioned. */
function readService(root, id) {
  const rel = serviceConfigOf(root, id);
  if (rel === null) return { state: 'NEXT', detail: 'no Worker yet, so no database to provision', command: 'the stamp step above', guard };
  const m = APP_DB_ID.exec(readFileSync(join(root, ...rel.split('/')), 'utf8'));
  if (m === null) return { state: 'DONE', detail: `${rel} binds no APP_DB, so there is no database of its own to provision`, guard };
  if (m[1] === PLACEHOLDER) {
    return { state: 'NEXT', detail: `${rel} APP_DB still carries the all-zeros placeholder`, command: `node tooling/scripts/provision-backend.mjs ${id}`, guard };
  }
  return { state: 'DONE', detail: `${rel} APP_DB is provisioned (${m[1]})`, guard };
}

export function read(root, id, { kind = 'app' } = {}) {
  if (kind === 'service') return readService(root, id);
  const y = readAppYaml(root, id);
  if (!y.ok && y.missing) return { state: 'NEXT', detail: 'no app.yaml yet: the stamp decides whether there is a backend', command: 'the stamp step above', guard };
  if (!y.ok) return { lost: y.why };
  const api = y.doc?.hosts?.api;
  if (typeof api !== 'string' || api === '') {
    return { state: 'DONE', detail: 'client-only (no hosts.api): the shared platform Worker serves it', guard };
  }
  const rel = `services/${id}-api/wrangler.jsonc`;
  const abs = join(root, ...rel.split('/'));
  if (!existsSync(abs)) {
    return {
      state: 'NEXT',
      detail: `hosts.api is ${api} and ${rel} does not exist`,
      command: `node tooling/kit/stamp-app.mjs --vars <vars.json with app_id "${id}" and "needs_backend": true> --overwrite`,
      guard,
    };
  }
  const m = APP_DB_ID.exec(readFileSync(abs, 'utf8'));
  if (m === null) return { lost: `${rel} declares no APP_DB database_id, so whether it is provisioned cannot be read` };
  if (m[1] === PLACEHOLDER) {
    return { state: 'NEXT', detail: `${rel} APP_DB still carries the all-zeros placeholder`, command: `node tooling/scripts/provision-backend.mjs ${id}`, guard };
  }
  return { state: 'DONE', detail: `${rel} APP_DB is provisioned (${m[1]})`, guard };
}
