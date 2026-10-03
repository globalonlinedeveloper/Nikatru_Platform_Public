// ─────────────────────────────────────────────────────────────────────────────
// wrangler-surgery.mjs — write ONE value into a wrangler.jsonc environment's
// binding, and prove by re-parsing that nothing else moved.
//
// ⏱ 2026-10-01 (rv2-services-011, -022). Two scripts write resource ids into an
// `env.<name>` block: tooling/scripts/provision-backend.mjs (a stamped Worker's
// sandbox database and the shared sandbox namespaces) and
// tooling/scripts/provision-sandbox-twins.mjs (the platform's sandbox namespaces).
// provision-backend.mjs's own APP_DB_BLOCK regex is scoped by DISTANCE (the next
// `database_id` within 400 characters of `"binding": "APP_DB"`), which is safe at
// the top level only because APP_DB comes first; an environment repeats every
// binding name further down the same file, so a distance-scoped pattern would
// write the first match, which is production's. This module is scoped by
// STRUCTURE instead: comments are blanked in place (offsets kept), the
// environment's object, the section's array and the binding's object are each
// found by matched brackets, and only the value's own bytes are replaced. Then
// the whole file is parsed before and after, and the write is refused unless the
// two parses differ in exactly that one field.
//
// Pure: text in, text out, no filesystem. Throws SurgeryRefused.
// ─────────────────────────────────────────────────────────────────────────────
import { stripSourceComments } from '../ci/text-reductions.mjs';
import { parseJsonc } from '../ci/d1-stores.mjs';

/** The id a template or an unprovisioned config carries until a script writes it. */
export const D1_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
export const KV_PLACEHOLDER = '00000000000000000000000000000000';
/** True for either placeholder (all zeros, with or without dashes). */
export const isPlaceholderId = (id) => typeof id === 'string' && id !== '' && /^0+$/.test(id.replace(/-/g, ''));

export class SurgeryRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'SurgeryRefused';
  }
}

/** The index of the bracket that closes the one at `open`, in comment-blanked text. */
function closing(code, open) {
  const pair = { '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"') {
      for (i++; i < code.length && code[i] !== '"'; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (c === '{' || c === '[') stack.push(pair[c]);
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** `[start, end]` of the value of `"key": <open>` directly inside [from, to), or null.
 *  "Directly" means at depth 1 of that span, so a nested object's key never matches. */
function keyedSpan(code, from, to, key, open) {
  const re = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*\\${open}`, 'g');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(code)) !== null && m.index < to) {
    if (depthAt(code, from, m.index) !== 1) continue;
    const start = m.index + m[0].length - 1;
    const end = closing(code, start);
    if (end === -1 || end > to) return null;
    return [start, end];
  }
  return null;
}

/** Bracket depth at `at`, counted from `from` (which is an opening bracket). */
function depthAt(code, from, at) {
  let depth = 0;
  for (let i = from; i < at; i++) {
    const c = code[i];
    if (c === '"') {
      for (i++; i < at && code[i] !== '"'; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth;
}

/** The parsed value at `env.<env>.<section>[binding=<binding>].<field>` (or the
 *  top level when `env` is null), or undefined. `key` is the field naming the
 *  binding: `binding`, or `name` for `ratelimits`. */
export function bindingField(cfg, { env = null, section, binding, field, key = 'binding' }) {
  const block = env === null ? cfg : cfg?.env?.[env];
  const items = Array.isArray(block?.[section]) ? block[section] : [];
  return items.find((i) => i?.[key] === binding)?.[field];
}

/**
 * `text` with `env.<env>.<section>[<key>=<binding>].<field>` set to the string
 * `value`. Throws SurgeryRefused when the environment, the section, the binding or
 * the field is not there exactly once, when the field is not a string, or when the
 * re-parsed result differs from the original anywhere but that one field.
 */
export function setEnvBindingField(text, { env, section, binding, field, value, key = 'binding' }) {
  const where = `env.${env}.${section}[${binding}].${field}`;
  const code = stripSourceComments(text, '.jsonc');
  const rootOpen = code.indexOf('{');
  const rootClose = rootOpen === -1 ? -1 : closing(code, rootOpen);
  if (rootClose === -1) throw new SurgeryRefused(`${where}: the config has no top-level object.`);
  const envSpan = keyedSpan(code, rootOpen, rootClose, 'env', '{');
  if (!envSpan) throw new SurgeryRefused(`${where}: the config declares no top-level \`env\` object.`);
  const named = keyedSpan(code, envSpan[0], envSpan[1], env, '{');
  if (!named) throw new SurgeryRefused(`${where}: \`env\` declares no \`${env}\` block.`);
  const arr = keyedSpan(code, named[0], named[1], section, '[');
  if (!arr) throw new SurgeryRefused(`${where}: env.${env} declares no \`${section}\` array.`);
  const hits = [];
  for (let i = arr[0] + 1; i < arr[1]; i++) {
    if (code[i] === '"') {
      for (i++; i < arr[1] && code[i] !== '"'; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (code[i] !== '{') continue;
    const end = closing(code, i);
    if (end === -1) break;
    const body = code.slice(i, end + 1);
    if (new RegExp(`"${key}"\\s*:\\s*"${binding}"`).test(body)) hits.push([i, end]);
    i = end;
  }
  if (hits.length !== 1) throw new SurgeryRefused(`${where}: ${hits.length} entries are bound as ${binding}; exactly one is required.`);
  const [objStart, objEnd] = hits[0];
  const fm = new RegExp(`"${field}"\\s*:\\s*"([^"\\\\]*)"`, 'g');
  fm.lastIndex = objStart;
  const found = [];
  let m;
  while ((m = fm.exec(code)) !== null && m.index < objEnd) found.push(m);
  if (found.length !== 1) throw new SurgeryRefused(`${where}: the ${binding} entry carries ${found.length} string \`${field}\` fields; exactly one is required.`);
  const valueStart = found[0].index + found[0][0].length - 1 - found[0][1].length;
  const out = text.slice(0, valueStart) + String(value) + text.slice(valueStart + found[0][1].length);

  // The proof: the two parses differ in that one field and nowhere else.
  let before;
  let after;
  try {
    before = parseJsonc(text);
    after = parseJsonc(out);
  } catch (e) {
    throw new SurgeryRefused(`${where}: the config does not parse before or after the write (${e.message}).`);
  }
  const expected = structuredClone(before);
  const item = expected.env[env][section].find((i) => i?.[key] === binding);
  item[field] = String(value);
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    throw new SurgeryRefused(`${where}: the write changed something other than that field. Nothing was written.`);
  }
  return out;
}

/** The offset of the top-level `"env"` key in `text`, or `text.length` when there
 *  is none. A pattern that must only ever see the TOP LEVEL (provision-backend.mjs's
 *  APP_DB_BLOCK) is applied to `text.slice(0, topLevelEnvOffset(text))`: every
 *  binding name repeats inside an environment, so an unconfined match can land on
 *  the environment's entry and write production's id into it. */
export function topLevelEnvOffset(text) {
  const code = stripSourceComments(text, '.jsonc');
  const rootOpen = code.indexOf('{');
  const rootClose = rootOpen === -1 ? -1 : closing(code, rootOpen);
  if (rootClose === -1) return text.length;
  const re = /"env"\s*:\s*\{/g;
  re.lastIndex = rootOpen;
  let m;
  while ((m = re.exec(code)) !== null && m.index < rootClose) {
    if (depthAt(code, rootOpen, m.index) === 1) return m.index;
  }
  return text.length;
}
