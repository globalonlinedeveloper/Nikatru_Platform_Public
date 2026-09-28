// ─────────────────────────────────────────────────────────────────────────────
// derived-sets.mjs — the register's `derivedFrom` declarations, read ONE way.
//
// Row O-CAPTURE-LEAVES-DERIVED-SETS-STALE (AR-D3b, 2026-09-27). A listing set
// that is made from another channel's set declares, on its own
// `storeMetadataContract.perChannel[<channel>].graphicAssets` entry:
//
//     "derivedFrom": { "channel": "<source channel>", "set": "<path under that
//                      channel's listing directory>", "deriver": "<tooling/...mjs>" }
//
// on either an `assets["<file>"]` entry (a FILE set) or a block carrying its own
// `dir` (a DIRECTORY set). Three programs read these lines: the finish step
// (tooling/store/finish-capture.mjs), the source-hash guard
// (tooling/ci/assert-derived-sets.mjs) and the apps.gov.in deriver
// (tooling/ci/assert-apps-gov-in-media.mjs). Each reads them through this module,
// so the three agree on what a declaration is.
//
// THE DERIVER CONTRACT. A deriver module exports
//     DERIVER = { write(root, app, { register }), check(root, app, { register }) }
// `write` derives and records one app's sets; its record (the directory set's
// CAPTURE.json) carries `derivation.sources: [{ file, sha256 }]`, one entry per
// source file it read, repo-relative. `check` is its own full re-derivation and
// returns `{ problems, notes, checked }`. A FILE set's sources are recorded in the
// CAPTURE.json of the one DIRECTORY set the same deriver writes on the same
// channel. Pure functions and one loader; no process exits here.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REGISTER_REL = 'tooling/channel-register.json';
/** The repository this module lives in: derivers are CODE, and resolve here. */
export const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RECORD = 'CAPTURE.json';
export const IMAGE = /\.(png|jpe?g)$/i;

/** Every derived set the register declares, in register order:
 *  `{ channel, set, kind: 'file'|'dir', derivedFrom, generatedBy, where }`. */
export function derivedSets(register) {
  const out = [];
  const per = register?.storeMetadataContract?.perChannel ?? {};
  for (const [channel, pc] of Object.entries(per)) {
    const g = pc?.graphicAssets;
    if (!g || typeof g !== 'object' || Array.isArray(g)) continue;
    for (const [name, spec] of Object.entries(g.assets ?? {})) {
      if (name === '_why' || !spec || typeof spec !== 'object' || !Object.hasOwn(spec, 'derivedFrom')) continue;
      out.push({ channel, set: name, kind: 'file', derivedFrom: spec.derivedFrom, generatedBy: spec.generatedBy ?? null, where: `perChannel["${channel}"].graphicAssets.assets["${name}"]` });
    }
    for (const [key, block] of Object.entries(g)) {
      if (key === 'assets' || key === '_why' || !block || typeof block !== 'object' || Array.isArray(block) || !Object.hasOwn(block, 'derivedFrom')) continue;
      out.push({ channel, set: block.dir, kind: 'dir', derivedFrom: block.derivedFrom, generatedBy: block.generatedBy ?? null, where: `perChannel["${channel}"].graphicAssets.${key}` });
    }
  }
  return out;
}

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._\/-]+$/;

/** What is wrong with one declaration's SHAPE, as sentences. Empty when sound. */
export function shapeProblems(entry, register) {
  const p = [];
  const df = entry.derivedFrom;
  const per = register?.storeMetadataContract?.perChannel ?? {};
  if (!df || typeof df !== 'object' || Array.isArray(df)) return [`${entry.where}.derivedFrom is not an object { channel, set, deriver }.`];
  for (const k of ['channel', 'set', 'deriver']) {
    if (typeof df[k] !== 'string' || df[k].trim() === '') p.push(`${entry.where}.derivedFrom.${k} is not a non-empty string.`);
  }
  if (typeof entry.set !== 'string' || !SAFE_PATH.test(entry.set)) p.push(`${entry.where} names no set path of its own (a directory set needs a \`dir\`).`);
  if (p.length) return p;
  if (!Object.hasOwn(per, df.channel)) p.push(`${entry.where}.derivedFrom.channel "${df.channel}" is not a channel of storeMetadataContract.perChannel.`);
  if (df.channel === entry.channel) p.push(`${entry.where} derives from its own channel.`);
  if (!SAFE_PATH.test(df.set)) p.push(`${entry.where}.derivedFrom.set "${df.set}" is not a relative path under the source channel's listing directory.`);
  if (!/^tooling\/[A-Za-z0-9._\/-]+\.mjs$/.test(df.deriver) || !SAFE_PATH.test(df.deriver)) p.push(`${entry.where}.derivedFrom.deriver "${df.deriver}" is not a tooling/**.mjs path.`);
  if (entry.generatedBy !== null) p.push(`${entry.where} carries BOTH \`generatedBy\` (${JSON.stringify(entry.generatedBy)}) and \`derivedFrom\`. \`generatedBy\` is for an asset made from a non-capture master; a set derived from another channel's set declares \`derivedFrom\` only.`);
  return p;
}

/** One app's listing directory for a channel, repo-relative: the `channels[]`
 *  row's `storeMetadataDir` template, or null when the row declares none. */
export function storeDirOf(register, channel, app) {
  const row = (register?.channels ?? []).find((r) => r?.id === channel);
  const t = row?.storeMetadataDir;
  return typeof t === 'string' && t.includes('{app}') ? t.replaceAll('{app}', app) : null;
}

/** Where a derived set's sources are recorded, relative to its channel's
 *  listing directory: `<dir>/CAPTURE.json` for a directory set; for a file set,
 *  the record of the ONE directory set its deriver writes on the same channel.
 *  Null when that is not exactly one. */
export function recordOf(entries, entry) {
  if (entry.kind === 'dir') return `${entry.set}/${RECORD}`;
  const dirs = entries.filter((e) => e.kind === 'dir' && e.channel === entry.channel && e.derivedFrom?.deriver === entry.derivedFrom?.deriver);
  return dirs.length === 1 ? `${dirs[0].set}/${RECORD}` : null;
}

/** The derived channels reachable from `captured` through `derivedFrom`, each
 *  after every reachable channel it is derived from. Throws on a cycle. */
export function derivationOrder(entries, captured) {
  const edges = new Map(); // derived channel -> Set(source channels)
  for (const e of entries) {
    if (!edges.has(e.channel)) edges.set(e.channel, new Set());
    edges.get(e.channel).add(e.derivedFrom.channel);
  }
  const reached = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [ch, srcs] of edges) {
      if (reached.has(ch)) continue;
      if ([...srcs].some((s) => s === captured || reached.has(s))) {
        reached.add(ch);
        grew = true;
      }
    }
  }
  if (reached.has(captured)) throw new RangeError(`the derivedFrom declarations form a cycle through the captured channel "${captured}".`);
  const order = [];
  const placed = new Set([captured]);
  while (order.length < reached.size) {
    const next = [...reached].filter((ch) => !placed.has(ch) && [...edges.get(ch)].every((s) => placed.has(s) || !reached.has(s)));
    if (!next.length) throw new RangeError(`the derivedFrom declarations form a cycle among ${[...reached].filter((c) => !placed.has(c)).join(', ')}.`);
    for (const ch of next.sort()) {
      order.push(ch);
      placed.add(ch);
    }
  }
  return order;
}

/** A deriver's module, or why it cannot be one: `{ deriver }` or `{ lost }`. */
export async function loadDeriver(rel, root = TOOL_ROOT) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { lost: `the deriver ${rel} does not exist.` };
  let mod;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (e) {
    return { lost: `the deriver ${rel} does not load (${e.message}).` };
  }
  const d = mod.DERIVER;
  if (!d || typeof d.write !== 'function' || typeof d.check !== 'function') {
    return { lost: `the deriver ${rel} exports no DERIVER { write, check }: it has no write mode or no check mode to run.` };
  }
  return { deriver: d };
}
