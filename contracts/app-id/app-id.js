// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// contracts/app-id/app-id.js — the APP ID CONTRACT, authored once.
//
// Row O-APP-ID-FORM-UNVALIDATED, limb (a). Before this file each caller carried
// its own regex literal, and they held three different rules: pre_gen.dart
// allowed `_` up to 63 characters and provision-backend.mjs allowed `_` with no
// bound at all, services/platform/src/config.ts allowed `_` up to 32, and
// app.schema.json allowed `_` up to 40. An id one of them accepted and another
// dropped is an app stamped, provisioned and then silently never served.
//
// ── WHAT THE ID BECOMES, AND THE LIMIT EACH ONE SETS ─────────────────────────
// Every name below is made from the id by the brick, and each forbids something:
//   · a Worker name          brick wrangler.jsonc `{{app_id}}-api`              no `_`
//   · a D1 database name     brick wrangler.jsonc `{{app_id}}_db`               (fits any id here)
//   · a DNS label            brick wrangler.jsonc `{{app_id}}-api.nikatru.com`  no `_`, at most 63 octets with `-api`
//   · a Dart package         brick apps/{{app_id}}/pubspec.yaml `name:`         no `-`, a letter first, no reserved word
//   · an Android applicationId / namespace segment  `com.nikatru.<id>`          no `-`, a letter first, no Java keyword
//   · an Apple CFBundleIdentifier segment           `com.nikatru.<id>`          no `_`
//   · the platform Worker's served set  services/platform/src/config.ts
//     APP_ID_PATTERN, which DROPS a longer id with no error                     at most 32 characters
// The pattern is the intersection of those alphabets; 32 is the tightest length.
// An id never contains '-': the release job's `<app>-*` artifact pattern and
// the `<app>-v*` tag filter rely on it (PR 18 F9).
//
// ── WHO READS IT ─────────────────────────────────────────────────────────────
//   · tooling/scripts/provision-backend.mjs     imports appIdProblems
//   · tooling/ci/assert-store-identity.mjs      imports appIdProblems
//   · tooling/ci/assert-catalog-contract.mjs    imports appIdProblems
//   · tooling/bricks/app/hooks/pre_gen.dart     reads app-id.json (Dart cannot import this file)
// `app-id.json` is GENERATED from this file by `generate.mjs`; its `--check`
// and tooling/ci/assert-app-id-contract.mjs hold the two together, and the same
// guard grades the copies that cannot import it (config.ts, the app-yaml
// schemas).
// ─────────────────────────────────────────────────────────────────────────────

/** The shape. `pattern` is a JSON Schema / ECMAScript regex source, so the same
 *  string works as `new RegExp(pattern)` here and `RegExp(pattern)` in Dart. */
export const APP_ID_RULE = Object.freeze({
  pattern: '^[a-z][a-z0-9]*$',
  minLength: 2,
  maxLength: 32,
});

/** Dart language reserved words — Dart Language Specification, "Reserved Words"
 *  (a pubspec `name` must be a valid Dart identifier, and these are not). Only
 *  the members the pattern above could accept are listed. */
export const DART_RESERVED_WORDS = Object.freeze([
  'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'do', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'for', 'if',
  'in', 'is', 'new', 'null', 'rethrow', 'return', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'var', 'void', 'while', 'with',
]);

/** Java SE keywords — The Java Language Specification (Java SE 21), §3.9
 *  "Keywords", reserved keywords only; plus the literals `true`, `false` (§3.10.3)
 *  and `null` (§3.10.8), which §3.8 also forbids as an identifier. A package
 *  segment is an identifier, and `com.nikatru.<id>` is the Android namespace.
 *  `_` is a keyword too and is already outside the pattern. */
export const JAVA_KEYWORDS = Object.freeze([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while',
]);

/** Kotlin hard keywords — Kotlin language specification, "Keywords and
 *  operators", hard keywords (`as?`, `!in` and `!is` are outside the pattern).
 *  A hard keyword cannot be a package segment without backticks. */
export const KOTLIN_HARD_KEYWORDS = Object.freeze([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if',
  'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this',
  'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
]);

/** The union of the three lists, sorted and de-duplicated. An id here is refused. */
export const RESERVED = Object.freeze(
  [...new Set([...DART_RESERVED_WORDS, ...JAVA_KEYWORDS, ...KOTLIN_HARD_KEYWORDS])].sort(),
);

const PATTERN = new RegExp(APP_ID_RULE.pattern);
const RESERVED_SET = new Set(RESERVED);
const WHERE = 'contracts/app-id';

/**
 * Every rule `id` breaks, as sentences naming the rule and `contracts/app-id`.
 * An empty array means the id is acceptable.
 *
 * @param {unknown} id
 * @returns {string[]}
 */
export function appIdProblems(id) {
  if (typeof id !== 'string') {
    return [`app id must be a string — got ${id === null ? 'null' : typeof id} (${WHERE}).`];
  }
  const shown = JSON.stringify(id);
  const problems = [];
  if (!PATTERN.test(id)) {
    const why = [];
    if (id === '') why.push('it is empty');
    else if (!/^[a-z]/.test(id)) why.push(`it starts with ${JSON.stringify(id[0])}, not a lowercase letter`);
    const bad = [...new Set([...id.slice(1)].filter((c) => !/[a-z0-9]/.test(c)))];
    if (bad.length) why.push(`it contains ${bad.map((c) => JSON.stringify(c)).join(', ')}`);
    problems.push(
      `app id ${shown} breaks the pattern ${APP_ID_RULE.pattern} (${WHERE}): ${why.join('; ')}. ` +
        'Only lowercase letters and digits, a letter first: `_` is not valid in a Worker name, a DNS label ' +
        'or an Apple bundle id, and `-` is not valid in a Dart package or an Android package name.',
    );
  }
  if (id.length < APP_ID_RULE.minLength) {
    problems.push(`app id ${shown} is ${id.length} character(s); the minimum is ${APP_ID_RULE.minLength} (${WHERE}).`);
  }
  if (id.length > APP_ID_RULE.maxLength) {
    problems.push(
      `app id ${shown} is ${id.length} characters; the maximum is ${APP_ID_RULE.maxLength} (${WHERE}). ` +
        "services/platform/src/config.ts APP_ID_PATTERN drops a longer id from the served set with no error.",
    );
  }
  if (RESERVED_SET.has(id)) {
    problems.push(
      `app id ${shown} is a reserved word in Dart, Java or Kotlin (${WHERE}), so it cannot name the Dart ` +
        'package or the Android package segment it becomes.',
    );
  }
  return problems;
}

/** The document `generate.mjs` writes to app-id.json, keys sorted. The one
 *  definition of that file's shape: the generator and the guard both call it. */
export function appIdDocument() {
  return {
    $comment:
      'GENERATED from contracts/app-id/app-id.js by contracts/app-id/generate.mjs. Do not edit by hand: edit app-id.js, then run node contracts/app-id/generate.mjs',
    reserved: [...RESERVED],
    rule: {
      maxLength: APP_ID_RULE.maxLength,
      minLength: APP_ID_RULE.minLength,
      pattern: APP_ID_RULE.pattern,
    },
  };
}

/** The exact bytes of app-id.json: two-space JSON, LF, one trailing newline. */
export function renderAppIdJson() {
  return `${JSON.stringify(appIdDocument(), null, 2)}\n`;
}
