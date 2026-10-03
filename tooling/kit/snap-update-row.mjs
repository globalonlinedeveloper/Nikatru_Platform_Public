#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// snap-update-row.mjs — a stamped app is served its snapcraft.io page on
// `linux-snap` when it is stamped, not when [10]D-8 goes red.
//
// O-FORCE-UPDATE-VERSION-READ-UNPROVEN. `linux-snap` is ARMED (submittable + a
// lane), so assert-stamp-properties.mjs [10]D-8 (rules in tooling/ci/update-exit.mjs)
// requires every catalogue app to be served `https://snapcraft.io/<snap-name>` on
// that channel: no adapter opens the Snap Store, so a null exit opens the
// compiled-in homepage. App #1's entry was written by hand; nothing wrote one for
// the NEXT app, so the brick's own stamped probe went red in the App brick lane
// ("'probe' is served null on 'linux-snap', which is armed"). The row has to be
// born WITH the app, in the one command that stamps it — the precedent is
// gen-app-licence-rows.mjs, which stamp-app.mjs runs for the same reason.
//
// Derived from apps/<id>/store/linux-snap/snap-name.txt (the brick's pre_gen
// writes it) into services/platform/src/app-config-data.json
// `apps.<id>.update_url["linux-snap"]`. That file is hand-formatted, so --write
// INSERTS one line rather than re-serialising it, and refuses (never overwrites)
// an app entry that already exists without the right value: that entry is a
// person's, and the edit is theirs.
//
// Usage:  node tooling/kit/snap-update-row.mjs --write --app <id>
//         node tooling/kit/snap-update-row.mjs --check --app <id>
// Exit 0 = served as derived (--write: written, or already so). 1 = not, named.
// 2 = usage, or an input that could not be read (COVERAGE LOST).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { appIdProblems } from '../../contracts/app-id/app-id.js';
import { snapcraftUrl } from '../ci/update-exit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const CONFIG_DATA = 'services/platform/src/app-config-data.json';
export const SNAP_CHANNEL = 'linux-snap';
const SNAP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** The `linux-snap` value served to `id` by its own entry, or undefined. */
export function servedSnapUrl(data, id) {
  const own = data?.apps?.[id];
  const map = own && typeof own === 'object' ? own.update_url : undefined;
  return map && typeof map === 'object' ? map[SNAP_CHANNEL] : undefined;
}

/**
 * The config text with `id` served `url` on linux-snap.
 * @returns {{text: string|null, changed: boolean, problem: string|null}}
 */
export function withSnapUpdateRow(text, id, url) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { text: null, changed: false, problem: `${CONFIG_DATA} does not parse (${e.message})` };
  }
  if (!data || typeof data.apps !== 'object' || data.apps === null) {
    return { text: null, changed: false, problem: `${CONFIG_DATA} has no \`apps\` object` };
  }
  const served = servedSnapUrl(data, id);
  if (served === url) return { text, changed: false, problem: null };
  if (Object.prototype.hasOwnProperty.call(data.apps, id)) {
    return {
      text: null,
      changed: false,
      problem:
        `${CONFIG_DATA} apps.${id} already exists and serves ${JSON.stringify(served ?? null)} on ${SNAP_CHANNEL}; ` +
        `set apps.${id}.update_url["${SNAP_CHANNEL}"] to "${url}" by hand (an existing entry is never rewritten here).`,
    };
  }
  const anchor = /\n {2}"apps": \{\n/.exec(text);
  if (!anchor) return { text: null, changed: false, problem: `${CONFIG_DATA} has no \`  "apps": {\` line to insert after` };
  const empty = Object.keys(data.apps).length === 0;
  const row = `    ${JSON.stringify(id)}: { "update_url": { ${JSON.stringify(SNAP_CHANNEL)}: ${JSON.stringify(url)} } }${empty ? '' : ','}\n`;
  const at = anchor.index + anchor[0].length;
  const next = text.slice(0, at) + row + text.slice(at);
  // The insertion is proven, not trusted: the result parses, serves the value,
  // and differs from the input by exactly that one entry.
  let after;
  try {
    after = JSON.parse(next);
  } catch (e) {
    return { text: null, changed: false, problem: `inserting apps.${id} left ${CONFIG_DATA} unparseable (${e.message})` };
  }
  const expected = { ...data, apps: { ...data.apps, [id]: { update_url: { [SNAP_CHANNEL]: url } } } };
  if (!isDeepStrictEqual(after, expected)) {
    return { text: null, changed: false, problem: `inserting apps.${id} changed ${CONFIG_DATA} beyond that one entry` };
  }
  return { text: next, changed: true, problem: null };
}

/** The snap name the stamp wrote for `id`, or a problem. */
export function readSnapName(root, id) {
  const rel = `apps/${id}/store/linux-snap/snap-name.txt`;
  let name;
  try {
    name = readFileSync(join(root, 'apps', id, 'store', 'linux-snap', 'snap-name.txt'), 'utf8').trim();
  } catch (e) {
    return { name: null, problem: `${rel} could not be read (${e.code ?? e.message})` };
  }
  if (!SNAP_NAME_RE.test(name)) return { name: null, problem: `${rel} holds ${JSON.stringify(name)}, which is not a snap name` };
  return { name, problem: null };
}

/** The CLI as a function. Returns the exit code. */
export function main(argv, { root = REPO, log = console.log, error = console.error } = {}) {
  const known = new Set(['--write', '--check', '--app']);
  const unknown = argv.filter((a) => a.startsWith('--') && !known.has(a));
  const at = argv.indexOf('--app');
  const id = at === -1 ? null : argv[at + 1] ?? null;
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  if (unknown.length || write === check || id === null || id.startsWith('--')) {
    error('usage: node tooling/kit/snap-update-row.mjs (--write | --check) --app <id>');
    return 2;
  }
  const idProblems = appIdProblems(id);
  if (idProblems.length) {
    error(`✗ --app ${JSON.stringify(id)} refused: ${idProblems.join(' ')}`);
    return 2;
  }
  const snap = readSnapName(root, id);
  if (snap.problem) {
    error(`COVERAGE LOST — snap-update-row: ${snap.problem}.`);
    return 2;
  }
  const url = snapcraftUrl(snap.name);
  const abs = join(root, ...CONFIG_DATA.split('/'));
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    error(`COVERAGE LOST — snap-update-row: ${CONFIG_DATA} could not be read (${e.code ?? e.message}).`);
    return 2;
  }
  const r = withSnapUpdateRow(text, id, url);
  if (r.problem) {
    error(`✗ snap-update-row: ${r.problem}.`);
    return 1;
  }
  if (!r.changed) {
    log(`ok  snap-update-row: '${id}' is served ${url} on ${SNAP_CHANNEL}.`);
    return 0;
  }
  if (check) {
    error(`✗ snap-update-row: '${id}' is not served ${url} on ${SNAP_CHANNEL}; run: node tooling/kit/snap-update-row.mjs --write --app ${id}`);
    return 1;
  }
  writeFileSync(abs, r.text);
  log(`ok  snap-update-row: wrote apps.${id}.update_url["${SNAP_CHANNEL}"] = ${url} into ${CONFIG_DATA}.`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = main(process.argv.slice(2));
