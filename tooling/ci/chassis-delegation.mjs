// ─────────────────────────────────────────────────────────────────────────────
// chassis-delegation.mjs — THE ONE READING OF "this brick screen was emptied
// into `package:nikatru_chassis_screens`, and here is the file that now carries
// its behaviour".
//
// [ADR 067] decision 2 re-points the path-pinned guards from file paths to
// package-boundary contracts: when a routed/anchored brick file delegates to a
// widget in the chassis package, the property those guards judge (a Semantics
// label, a width test, a caps gate, a seam call, a key constant, a call site)
// moved with the body and must be judged where it now lives. Eleven guards need
// that answer.
//
// 🔴 WHY THIS IS A MODULE AND NOT ELEVEN COPIES. It shipped as eleven copies on
// 2026-09-05 and an independent review measured what that cost before a single
// screen had moved: TEN `delegationOf` bodies, 283 lines, SEVEN DISTINCT
// implementations by sha256, three different signatures and two different regex
// constructions — with nothing in the tree comparing them. A one-line change to
// the rule (rename the package, admit a second chassis package, two-level
// barrels, `export` as well as `import`) was twelve edits, not one, and
// `assert-copy-parity.mjs:10-15` already states this repository's doctrine on
// shipping copies: "a security fix lands in one repo and silently not the
// others … the only thing that makes it loud is hashing the shared files."
// `assert-guard-coverage.mjs:180-186` names the exact shape that answers it —
// "a shared pure-function module that every caller's own self-check already
// covers" — which is what tree-walk.mjs and text-reductions.mjs already are.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE, STATED ONCE HERE:
//
//   A file DELEGATES when it imports exactly one `package:nikatru_chassis_screens/…`
//   path, that path resolves to a file on disk under `packages/chassis_screens/lib/`,
//   and THE FILE ACTUALLY REFERENCES SOMETHING THAT TARGET DECLARES.
//
//   Resolution is ONE LEVEL: the target itself, plus the files it re-exports
//   with a bare `export '…dart';`. No deeper.
//
//   There are exactly THREE answers and the caller must keep them apart:
//     · `null`      — this file does not delegate. Judge it where it is.
//     · `{ lost }`  — it does, and the delegation could not be followed. The
//                     caller reports COVERAGE LOST. Never silently `null`.
//     · `{ files, symbols, usedSymbol }` — the package file(s) that now carry it.
//
// 🔴 THE USE CHECK IS THE HALF THAT WAS MISSING, AND ITS ABSENCE WAS EXPLOITED.
// Until this module existed, every text-union caller widened its scan on the
// strength of an IMPORT LINE ALONE. An independent review demonstrated, on the
// real tree, that ONE UNUSED IMPORT plus a package file merely CONTAINING the
// token turned two deleted controls from EXIT 1 into EXIT 0:
//   · `apps/subly/.../settings_screen.dart` with its `recordAnalyticsConsent(`
//     call deleted — `assert-consent-withdrawal-surface.mjs`, the DPDP §6(3)
//     guard — went green because a never-rendered free function in a package
//     file said the words.
//   · `apps/subly/.../login_screen.dart` with its `caps.oauthRedirect` gate
//     deleted — `assert-no-seam-forks.mjs`'s parity limb, one of the three
//     constraints [ADR 066] names as NOT escapable — went green the same way.
// An import is a claim about where behaviour went; a REFERENCE is evidence.
// So the adapter must name at least one public symbol the target declares,
// found in the adapter's CODE — comments blanked, string literals blanked, and
// the import/export directives themselves removed, so that the delegation's own
// text can never be the thing that proves the delegation is used.
//
// A resolvable import that is never used is `{ lost }`, not `null`. It is dead
// code that looks exactly like a delegation, and reading it as "no delegation"
// is the silent-pass shape this whole mechanism is built against.
//
// ─────────────────────────────────────────────────────────────────────────────
// IT SCANS NOTHING AND OWNS NO COVERAGE CLAIM. Pure functions plus the
// directory listing its caller hands it: paths in, an answer out. "Did my scan
// still reach the tree" belongs to the eleven importers, each of which carries
// its own COVERAGE LOST over what it read and reports every `lost` this module
// returns. What this module CAN lose is its refusals, and that is not left to
// prose: tooling/ci/test/chassis-delegation.test.mjs mutates each limb — an
// unused import, a target that is not on disk, two imports, a use hidden in a
// comment, a use hidden in a string literal — and fails when any of them starts
// answering `{ files }`.
//
// It sits FLAT in tooling/ci because assert-guard-coverage.mjs's stray-.mjs
// check (correctly) treats a subdirectory of tooling/ci as a guard escaping the
// scan, and it is listed in that guard's NOT_A_SCANNER for the reason above.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

/** The package a brick screen is emptied INTO ([ADR 067] decision 2). */
export const CHASSIS_PKG = 'nikatru_chassis_screens';
/** …and where that package lives in this repository. */
export const CHASSIS_DIR = 'packages/chassis_screens';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A FRESH regex every time. A module-level `/g` regex carries `lastIndex`
 *  between callers, and a shared one that eleven guards reach into is exactly
 *  the state bug that produces a different answer on the second call. */
const importRe = () => new RegExp(`import\\s+'package:${escapeRe(CHASSIS_PKG)}/([^']+\\.dart)'`, 'g');
const exportRe = () => /export\s+'([^':]+\.dart)'/g;

/** Every distinct `package:nikatru_chassis_screens/<path>` a RAW source imports.
 *
 *  🔴 RAW, NEVER COMMENT-STRIPPED. An import path IS a string literal, so a
 *  caller that hands this its own `stripDart`/`stripStringLiterals` output hands
 *  it `import                              ;` and gets back an empty list — the
 *  whole resolver then being unreachable while every line of it reads as
 *  shipped. That is not hypothetical: assert-seams-wired.mjs scanned its
 *  comment-and-literal-blanked `bodies` map on 2026-09-05 and its +83 lines of
 *  delegation handling could not fire at all. */
export const chassisImportPaths = (rawSource) => [...new Set([...String(rawSource).matchAll(importRe())].map((m) => m[1]))];

/** Dart source with comments, string literals (including `'''`/`"""` blocks and
 *  `r'…'` raw strings) and the import/export DIRECTIVES themselves blanked —
 *  what is left is the code that could reference a symbol.
 *
 *  Blanked, never deleted, so offsets and line numbers survive for any caller
 *  that later wants to report a position. */
export function dartCodeOnly(rawSource) {
  const blanked = String(rawSource)
    // Triple-quoted blocks first: stripStringLiterals is single-line by design
    // and would leave the body of a `'''…'''` behind.
    .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, (m) => m.replace(/[^\n]/g, ' '))
    // The directives. A delegation must not be able to prove itself.
    .replace(/^[ \t]*(?:import|export|part)\b[^;]*;/gm, (m) => m.replace(/[^\n]/g, ' '));
  return stripStringLiterals(stripSourceComments(blanked, '.dart'));
}

const DECL_PATTERNS = [
  /^(?:abstract\s+|base\s+|final\s+|interface\s+|sealed\s+|mixin\s+)*class\s+([A-Za-z][\w$]*)/gm,
  /^mixin\s+([A-Za-z][\w$]*)/gm,
  /^enum\s+([A-Za-z][\w$]*)/gm,
  /^extension\s+([A-Za-z][\w$]*)/gm,
  /^typedef\s+([A-Za-z][\w$]*)/gm,
  // Top-level functions and getters. Column-anchored, which in Dart is what
  // "top level" means. Deliberately generous: a name this over-collects can
  // only ever be one the adapter would also have to spell out.
  /^(?:[A-Za-z_$][\w$<>,?\s.[\]]*?\s+)?([a-z][\w$]*)\s*(?:<[^>\n]*>)?\s*\([^;()]*\)\s*(?:async\s*\*?\s*)?[{=]/gm,
  // Top-level `final`/`const`/`var` declarations.
  /^(?:final|const|var)\s+(?:[A-Za-z_$][\w$<>,?\s.[\]]*\s+)?([a-z][\w$]*)\s*=/gm,
];

/** The PUBLIC top-level names a Dart source declares — what an adapter could
 *  legitimately name to prove it uses this file. Private (`_`-prefixed) names
 *  are excluded: they are unreachable from the adapter by construction, so
 *  counting one would accept a reference that cannot exist. */
export function publicApiOf(rawSource) {
  const code = stripStringLiterals(stripSourceComments(String(rawSource), '.dart'));
  const out = new Set();
  for (const re of DECL_PATTERNS) {
    for (const m of code.matchAll(re)) {
      const name = m[1];
      if (name && !name.startsWith('_')) out.add(name);
    }
  }
  // Dart keywords a generous pattern can pick up as a "name".
  for (const kw of ['if', 'for', 'while', 'switch', 'catch', 'return', 'assert', 'super', 'this', 'new', 'await', 'yield']) out.delete(kw);
  return out;
}

/** The first symbol of `symbols` that `rawAdapterSource` references in CODE, or
 *  `null`. Word-boundary matched: `SignInBody` must not be satisfied by
 *  `SignInBodyController` in another package, nor by the word inside a comment
 *  or a string, nor by the import line that named it. */
export function referencedSymbol(rawAdapterSource, symbols) {
  const code = dartCodeOnly(rawAdapterSource);
  for (const s of symbols) {
    if (new RegExp(`(?<![\\w$])${escapeRe(s)}(?![\\w$])`).test(code)) return s;
  }
  return null;
}

/** A refusal, with the caller's own leading description trimmed off when it
 *  supplies none — so a guard that prefixes the path itself does not get a
 *  message that starts with a space. */
const refuse = (msg) => ({ lost: msg.replace(/^\s+/, '') });

/**
 * Where `relFile` (repo-relative, forward slashes) delegates to, resolved one
 * level. `repoRoot` is an absolute path.
 *
 * `null` · `{ lost }` · `{ files, symbols, usedSymbol }` — see the header. The
 * `describe` option prefixes every refusal with whatever the caller calls the
 * file, so each guard's report keeps its own voice.
 */
export function delegationOf(repoRoot, relFile, { describe = (r) => `\`${r}\`` } = {}) {
  const abs = join(repoRoot, relFile);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  const paths = chassisImportPaths(raw);
  if (paths.length === 0) return null;
  if (paths.length > 1) {
    return refuse(
        `${describe(relFile)} imports ${paths.length} different \`package:${CHASSIS_PKG}\` paths ` +
        `(${paths.join(', ')}), so the file that now carries the behaviour cannot be identified. ` +
        'This resolver will not guess between two of them.',
    );
  }
  const target = `${CHASSIS_DIR}/lib/${paths[0]}`;
  if (!existsSync(join(repoRoot, target))) {
    return refuse(
        `${describe(relFile)} delegates to \`package:${CHASSIS_PKG}/${paths[0]}\`, which resolves to ` +
        `\`${target}\` and that file is not on disk. The behaviour has been emptied into a package that ` +
        'does not carry it, so it is asserted NOWHERE by anything.',
    );
  }
  const files = [target];
  const targetRaw = readFileSync(join(repoRoot, target), 'utf8');
  for (const m of targetRaw.matchAll(exportRe())) {
    const t = `${CHASSIS_DIR}/lib/${m[1]}`;
    if (existsSync(join(repoRoot, t)) && !files.includes(t)) files.push(t);
  }

  // ── THE USE CHECK ──────────────────────────────────────────────────────────
  const symbols = new Set();
  for (const f of files) for (const s of publicApiOf(readFileSync(join(repoRoot, f), 'utf8'))) symbols.add(s);
  if (symbols.size === 0) {
    return refuse(
        `${describe(relFile)} delegates to \`${target}\`, which declares no public top-level name and ` +
        're-exports none that does. One level of barrel expansion is all this resolver does, and it found ' +
        'nothing the adapter could be using — so there is no evidence the behaviour went there.',
    );
  }
  const usedSymbol = referencedSymbol(raw, symbols);
  if (!usedSymbol) {
    return refuse(
        `${describe(relFile)} imports \`package:${CHASSIS_PKG}/${paths[0]}\` but never references anything ` +
        `it declares (${[...symbols].sort().slice(0, 8).join(', ')}${symbols.size > 8 ? ', …' : ''}). An import ` +
        'is a claim about where behaviour went; a reference is evidence. A resolvable import that is never ' +
        'used is dead code wearing a delegation\'s costume — and it was MEASURED, on 2026-09-05, turning a ' +
        'deleted DPDP withdrawal control and a deleted caps gate from EXIT 1 into EXIT 0.',
    );
  }
  return { files, symbols, usedSymbol };
}

/** Every chassis file the `.dart` tree under `relDir` delegates to.
 *  `{ files, lost }` — `lost` is the list of refusals the CALLER must report,
 *  because the coverage claim belongs to the caller, never to this module. */
export function delegationsUnder(repoRoot, relDir, opts = {}) {
  const files = [];
  const lost = [];
  const walk = (rel) => {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) return;
    for (const e of listDir(abs, { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.dart')) {
        const dg = delegationOf(repoRoot, child, opts);
        if (dg && dg.lost) lost.push(dg.lost);
        else for (const f of (dg && dg.files) || []) if (!files.includes(f)) files.push(f);
      }
    }
  };
  walk(relDir);
  return { files, lost };
}
