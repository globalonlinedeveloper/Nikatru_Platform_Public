#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// locales.mjs — the ONE reader of tooling/i18n/locales.json, the locale register.
//
// Every Node consumer that needs "which languages do we ship" imports this module
// instead of typing a list: assert-policy-archive (the notice-per-locale limb),
// assert-stamp-text-fidelity (the brick ARB set), the content-pack recipe, the
// store tooling, and the translation-QA harness. The shell consumers (the CI
// chassis regeneration step) call it as a CLI:
//
//   node tooling/i18n/locales.mjs --codes            supported codes, space-separated
//   node tooling/i18n/locales.mjs --codes --json     the same as a JSON array
//
// tooling/ci/assert-locale-register.mjs owns the register's schema, its generated
// Dart twin and the hunt for hand-typed lists; this file only reads and validates.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTER_REL = 'tooling/i18n/locales.json';
export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CODE = /^[a-z]{2,3}$/;
const PSEUDO_CODE = /^[a-z]{2,3}-X[A-Z]$/;
const STATUSES = new Set(['supported', 'pending']);
const DIRECTIONS = new Set(['ltr', 'rtl']);
const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const REQUIRED = ['code', 'name', 'nativeName', 'script', 'direction', 'pluralRules', 'status', 'apple', 'android', 'msix', 'play'];

/** Every problem with a parsed register, as sentences; [] when it is sound. */
export function registerProblems(reg) {
  const out = [];
  if (!reg || typeof reg !== 'object') return ['the register is not a JSON object'];
  if (!Array.isArray(reg.locales) || reg.locales.length === 0) return ['`locales` is missing or empty'];
  const seen = new Set();
  for (const [i, row] of reg.locales.entries()) {
    const at = `locales[${i}]${row?.code ? ` (${row.code})` : ''}`;
    for (const f of REQUIRED) {
      if (typeof row?.[f] !== 'string' || row[f].trim() === '') out.push(`${at}: \`${f}\` is missing or empty`);
    }
    if (typeof row?.code !== 'string') continue;
    if (!CODE.test(row.code)) out.push(`${at}: code "${row.code}" is not a lower-case ISO 639 language code`);
    if (seen.has(row.code)) out.push(`${at}: code "${row.code}" is listed twice`);
    seen.add(row.code);
    if (!STATUSES.has(row.status)) out.push(`${at}: status "${row.status}" is not one of ${[...STATUSES].join('|')}`);
    if (!DIRECTIONS.has(row.direction)) out.push(`${at}: direction "${row.direction}" is not ltr|rtl`);
    if (typeof row.script === 'string' && !/^[A-Z][a-z]{3}$/.test(row.script)) out.push(`${at}: script "${row.script}" is not an ISO 15924 code`);
    if (typeof row.pluralRules === 'string') {
      const cats = row.pluralRules.split(',');
      if (!cats.includes('other') || cats.some((c) => !PLURAL_CATEGORIES.has(c))) {
        out.push(`${at}: pluralRules "${row.pluralRules}" must be CLDR categories and include "other"`);
      }
    }
    if (typeof row.msix === 'string' && row.msix !== row.msix.toLowerCase()) out.push(`${at}: msix "${row.msix}" must be lower-case (msix_config spells it so)`);
  }
  if (typeof reg.source !== 'string' || !reg.locales.some((r) => r.code === reg.source && r.status === 'supported')) {
    out.push(`\`source\` ("${reg.source}") must name a supported row — it is the template ARB's language`);
  }
  for (const [i, row] of (reg.pseudo ?? []).entries()) {
    const at = `pseudo[${i}]`;
    if (!PSEUDO_CODE.test(row?.code ?? '')) out.push(`${at}: code "${row?.code}" is not a pseudo-locale tag (xx-XA shape)`);
    if (!DIRECTIONS.has(row?.direction)) out.push(`${at}: direction "${row?.direction}" is not ltr|rtl`);
    if (!seen.has(row?.base)) out.push(`${at}: base "${row?.base}" is not a registered locale`);
    if (!(typeof row?.expansion === 'number' && row.expansion >= 0 && row.expansion <= 1)) out.push(`${at}: expansion must be a number in [0, 1]`);
  }
  return out;
}

/** The parsed, validated register. Throws naming every problem. */
export function loadRegister(root = DEFAULT_ROOT) {
  const abs = join(root, REGISTER_REL);
  if (!existsSync(abs)) throw new Error(`${REGISTER_REL} not found under ${root}`);
  const reg = JSON.parse(readFileSync(abs, 'utf8'));
  const problems = registerProblems(reg);
  if (problems.length) throw new Error(`${REGISTER_REL} is malformed:\n  ${problems.join('\n  ')}`);
  return reg;
}

/** The shipped rows, register order (the source language first by convention). */
export const supportedLocales = (reg) => reg.locales.filter((r) => r.status === 'supported');
/** The shipped codes, register order. */
export const supportedCodes = (reg) => supportedLocales(reg).map((r) => r.code);
/** Every registered code, supported or pending. */
export const registeredCodes = (reg) => reg.locales.map((r) => r.code);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    const reg = loadRegister();
    if (args.includes('--codes')) {
      const codes = supportedCodes(reg);
      console.log(args.includes('--json') ? JSON.stringify(codes) : codes.join(' '));
    } else {
      console.log(JSON.stringify(reg.locales.map(({ code, status, direction }) => ({ code, status, direction }))));
    }
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
