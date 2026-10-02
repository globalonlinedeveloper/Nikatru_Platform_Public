#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// arb-remove-keys.mjs — delete message keys (and their `@key` metadata) from
// every locale of an ARB set, preserving the files' layout byte for byte
// everywhere else. The ARB hygiene tool: a key no surface renders, or one the
// app re-declared from the chassis, leaves EVERY locale in one step, so the
// parity tests (en ⊆ each translation and back) stay green by construction.
//
//   node tooling/i18n/arb-remove-keys.mjs <arb-dir> <prefix> <key> [<key> ...]
//   node tooling/i18n/arb-remove-keys.mjs <arb-dir> <prefix> --from <file>   one key per line
//
// It refuses (exit 1) when a named key is absent from the template ARB, so a
// typo cannot report success, and it re-parses every file it wrote.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';

/** [text] with the top-level members named in [keys] removed. Pure. */
export function removeArbKeys(text, keys) {
  const drop = new Set(keys.flatMap((k) => [k, `@${k}`]));
  // Walk the top-level object member by member, tracking string and nesting state,
  // so a value containing braces, commas or quotes cannot confuse the cut.
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  const body = text.slice(open + 1, close);
  const members = [];
  let i = 0;
  while (i < body.length) {
    const start = i;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) {
      members.push({ raw: body.slice(start), key: null });
      break;
    }
    // key
    if (body[i] !== '"') throw new Error(`unexpected ${JSON.stringify(body[i])} at offset ${open + 1 + i}`);
    let j = i + 1;
    while (body[j] !== '"') j += body[j] === '\\' ? 2 : 1;
    const key = JSON.parse(body.slice(i, j + 1));
    i = j + 1;
    // value: to the next top-level comma, or the end
    let depth = 0;
    let inStr = false;
    for (; i < body.length; i++) {
      const c = body[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 0) break;
    }
    const hasComma = body[i] === ',';
    members.push({ raw: body.slice(start, i), key, hasComma });
    if (hasComma) i++;
  }
  const trailing = body.match(/\s*$/)[0];
  const keyed = members.filter((m) => m.key !== null && !drop.has(m.key));
  const rebuilt = keyed.map((m, n) => m.raw.trimEnd() + (n < keyed.length - 1 ? ',' : '')).join('') + trailing;
  return text.slice(0, open + 1) + rebuilt + text.slice(close);
}

function main(argv) {
  const [dir, prefix, ...rest] = argv;
  if (!dir || !prefix || rest.length === 0) {
    console.error('usage: arb-remove-keys.mjs <arb-dir> <prefix> <key>... | --from <file>');
    return 1;
  }
  const keys =
    rest[0] === '--from'
      ? readFileSync(rest[1], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
      : rest;
  const files = listDir(dir).filter((f) => f.startsWith(`${prefix}_`) && f.endsWith('.arb')).sort();
  const template = files.find((f) => f === `${prefix}_en.arb`);
  if (!template) {
    console.error(`no ${prefix}_en.arb in ${dir}`);
    return 1;
  }
  const en = JSON.parse(readFileSync(join(dir, template), 'utf8'));
  const absent = keys.filter((k) => !(k in en));
  if (absent.length) {
    console.error(`refused: not in ${template}: ${absent.join(', ')}`);
    return 1;
  }
  for (const f of files) {
    const abs = join(dir, f);
    const before = readFileSync(abs, 'utf8');
    const after = removeArbKeys(before, keys);
    const parsed = JSON.parse(after);
    const left = keys.filter((k) => k in parsed || `@${k}` in parsed);
    if (left.length) throw new Error(`${f}: still holds ${left.join(', ')}`);
    writeFileSync(abs, after);
    console.log(`${f}: ${Object.keys(JSON.parse(before)).length} -> ${Object.keys(parsed).length} member(s)`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
