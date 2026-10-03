#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-ports.mjs — EVERY EXTERNAL CAPABILITY IS A PORT WHOSE LEVEL IS EARNED,
// not claimed. The standard is tooling/ports/README.md; the shape is
// tooling/ports/port.schema.json; the subjects are tooling/ports/<capability>.json.
//
// Extends [pipeline C-8], the portability checklist; payments' interface is the
// [ADR 004] seam, MoRWebhookVerifier.
//
// Row O-NO-PORT-SELECTS-AN-ADAPTER-BY-CONFIG. Measured at origin/main 630dcce4
// (2026-10-01): of 53 external dependencies and identity facts none was at L3,
// and nothing selected an adapter by configuration. C-8
// (assert-vendor-portability.mjs) asks whether each vendor is BEHIND a seam;
// this asks what the seam is worth — L0 hard-coded, L1 centralised, L2 one
// adapter chosen by config that no caller imports, L3 conformance-tested with a
// second adapter and a dry-run switch — and refuses a level the tree does not
// earn. It EXTENDS the registers that already exist and restates none of them:
// vendors from tooling/capability-register.json and
// tooling/legal/provider-register.json, secrets by NAME from the Worker Env (or
// tooling/worker-secrets.json once it exists), fees as tooling/catalog/
// fee-register.json cell ids, identity as tooling/house-identity.json paths.
//
// THE LIMBS, each with its recorded mutation in test/ports.test.mjs (vacuous-03):
//   1 schema    every registry validates against port.schema.json, through the
//               small validator below that READS the schema (no second copy of
//               the shape lives here); no secret-shaped value and no e-mail
//               literal; the file name equals `port`. An adapter with NO
//               environment is `draft` or `retired`; a `stream` selection has
//               `streams`, each naming an adapter of the port and only secrets
//               that adapter declares; a `per-call` selection whose adapters
//               price models (`cost.models`) has `features`,
//               each naming an adapter of the port, candidates that adapter
//               prices in `cost.models`, and a model (when set) among its
//               candidates. An empty or unreadable
//               tooling/ports/ is COVERAGE LOST (exit 2) — a floor of zero ports
//               is met by an empty directory (vacuous-02).
//   2 symbols   every interface and impl symbol is DECLARED in its file, in
//               comment-stripped source — a mention, an import or a comment is
//               not a declaration.
//   3 waivers   every handTables anchor still exists, and is PRINTED on every run.
//               `generated: true` needs the render tool (tooling/ports/render.mjs),
//               and the rendered table must be CURRENT (its renderCheck, run here
//               on every build: a hand edit of the generated file is a finding).
//   4 imports   no TS module imports an adapter's impl.file (or its outbound file
//               and modules) except its Worker's
//               composition root (services/<w>/src/ports.ts) or, while
//               `generated: false`, a file the port's handTables names. A walk
//               of the import graph of services/*/src (tests are not modules of
//               a Worker bundle). Dart is C-5's (assert-package-boundaries.mjs).
//   5 secrets   every `secrets` NAME is a tooling/worker-secrets.json row when
//               that file exists, else an `interface Env` member of some
//               services/*/src/types.ts — printed `manifest absent, read
//               interface Env`. A name in neither, but a row of
//               tooling/channel-register.json ciSecretRegister, is PRINTED as a
//               waiver (a secret read dynamically, declared by name elsewhere).
//   6 level     the level is EARNED: L1 interface declared; L2 + a selection and
//               limb 4 clean for the port, with a non-fake adapter that is built;
//               L3 + a conformance suite whose runner each of >= 2 adapters'
//               conformance files CALLS, zero pending for them, a runbook and the
//               dry-run command. A draft or retired adapter is never one of the
//               two: it may pass the suite, but nothing can select it. A port
//               with a `clientSuite` (ai: TS Worker adapters and Dart
//               bring-your-own-key adapters) grades each adapter against the
//               suite in its own file's language. A claim
//               above the earned level is exit 1. The table port · claimed ·
//               earned · target prints on every run.
//   7 fakes     a `fake` never lists `live`, and selection.default.live is never one.
//   8 cross     every capability-register vendor key (minus `_`-keys) and every
//               provider-register provider id is the `vendor` of adapters of
//               EXACTLY ONE port, or one tooling/ports/_non-port.json row (two
//               adapters of one port may share a vendor — boxes.json's two
//               Hostinger boxes are one placement, printed together); and a ported vendor's
//               C-8 seam.file equals its port's interface file, unless the
//               adapter declares that exact file as a `c8Seam` divergence
//               (printed). A vendor behind two adapters of ONE port (mail's
//               HTTP API and its SMTP relay) is placed once, in that port.
//               An adapter's `channel` is a tooling/channel-register.json
//               row, named by one adapter; a `candidates` id is NOT a row yet (a
//               candidate with a row is an adapter), and every candidate PRINTS.
//               (⏱ 2026-10-01, port-channels: tooling/ports/channels.json.)
//   9 literals  no owner-domain address is a literal in services/*/src outside
//               src/generated/ (comment-stripped, so a citation in prose is not
//               one): an address is an entity-source FIELD, rendered. Every
//               stream's `from`/`to` path resolves in tooling/house-identity.json,
//               and when a stream names one, services/platform/src/generated/
//               entity.ts is what tooling/ports/render-entity.mjs renders.
//               No house identity, or no module scanned, is COVERAGE LOST.
//  10 client    ⏱ 2026-10-01 · port-pay-client. A port's optional `client` half (the
//               Dart seams an app package declares — payments: PurchaseRail and
//               IapBridge). Each seam's suite runner is DECLARED in its file and
//               each adapter's conformance test CALLS it (comment-stripped, never
//               in the file that declares it, never an import: vacuous-10/11);
//               every class in packages/*/lib that implements a seam is a
//               registered client adapter (derived, so a rail cannot ship
//               unregistered; none found is COVERAGE LOST); no app or package lib
//               imports the shared fakes (lib/testing.dart); and the half's level
//               is earned like limb 6's — two conformant adapters per seam with
//               nothing pending, a runbook and the dry-run tool. Its row prints
//               as `<port>/client`; a claim above it is a limb 6 finding.
//               A Dart interface may be a LIBRARY file: limb 2 follows its
//               relative `export` directives one level for the declaration.
//  11 monitor   ⏱ 2026-10-02 · port-telemetry. No tooling/ops script outside
//     -api      tooling/ops/monitor-api/ CALLS GlitchTip's uptime-monitor API
//               itself (a `fetch(` naming a monitor route, or composing one in a
//               file that names it). The adapter tooling/ops/monitor-api/glitchtip.mjs
//               is the positive control: absent, or not matched, is COVERAGE LOST.
//               Declared exceptions (MONITOR_API_EXCEPTIONS) print on every run,
//               and one that no longer calls the API is a stale row.
//  12 bindings  ⏱ 2026-10-02 · port-storage. No module under services/*/src names
//               a Cloudflare binding TYPE (`KVNamespace`, `R2Bucket` and its R2
//               types, `RateLimit`, and — port-sql — `D1Database` and its D1
//               types) outside a Worker's composition root
//               (src/ports.ts), its `types.ts`, or services/_shared/src/ports/
//               (the ports, their fakes and adapters) — every handler takes the
//               PORT type. The pattern must still match SOMETHING in the tree
//               (the adapters name the types), else COVERAGE LOST.
//  13 geo       no module under services/*/src reads `.cf` (or names
//               `IncomingRequestCfProperties`) except services/_shared/src/
//               geo.ts, whose `requestGeo` is the one reader. geo.ts must itself
//               still match the pattern, else COVERAGE LOST.
//
// ⏱ 2026-10-02 · port-storage, in limbs 1 and 8: a `draft` adapter (declared, not
// built) may have an empty impl and, while its vendor is not chosen, `vendor: null`.
// ONE vendor may back adapters of SEVERAL ports (Cloudflare is KV, R2 and the rate
// limiters) only beside one _non-port row that names what is LEFT (`remaining`) and
// the train that ports it (`until`); without such a row, two ports are two
// placements, as before. A row with `remaining` for a vendor no adapter names is stale.
//
// ⏱ 2026-10-02 · port-telemetry, beside limbs 6, 7 and 8: a port with a ts AND a
// dart interface may grade each apart (`level.byInterface`): each half over the
// adapters whose impl.file is in its language, its own selection
// (`selection.byInterface`, else the port's) and a suite in its language; the
// port claims and earns the LOWEST half, and each half prints its own row
// (`telemetry.dart`, `telemetry.ts`). Limb 7 reads each half's selection too. In
// limb 8 a `draft` adapter whose vendor another port already places is not a
// second placement (telemetry's `mail` notifier names resend, which mail.json
// carries): the pairing prints. A draft nothing else places still places it.
//
// Exit 0 green, 1 a finding, 2 COVERAGE LOST (every problem is one). The FIRST
// line names the deciding limb.
//
// `evaluate(root)` is exported: assert-vendor-portability.mjs imports it to print
// each vendor's port and earned level (C-8's one-line link, never a re-derivation).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
import { renderCheck } from '../ports/render.mjs';
import { renderEntityAt, ENTITY_SOURCE } from '../ports/render-entity.mjs';

export const PORTS_DIR = 'tooling/ports';
export const SCHEMA_REL = 'tooling/ports/port.schema.json';
export const NON_PORT_REL = 'tooling/ports/_non-port.json';
export const CAPABILITY_REGISTER = 'tooling/capability-register.json';
export const PROVIDER_REGISTER = 'tooling/legal/provider-register.json';
export const SECRETS_MANIFEST = 'tooling/worker-secrets.json';
export const CHANNEL_REGISTER = 'tooling/channel-register.json';
/** The renderer `generated: true` needs (port-pay-core); limb 3 runs its check on every build. */
export const RENDER_TOOL = 'tooling/ports/render.mjs';
/** A Worker's one composition root, relative to services/<w>/. */
export const COMPOSITION_ROOT = 'src/ports.ts';
export const LIMB_NAMES = Object.freeze({
  1: 'schema',
  2: 'symbols',
  3: 'waivers',
  4: 'imports',
  5: 'secrets',
  6: 'level',
  7: 'fakes',
  8: 'cross-register',
  9: 'literals',
  10: 'client',
  11: 'monitor-api',
  12: 'bindings',
  13: 'geo',
});

/** Limb 12: a Cloudflare binding TYPE, named in code (comments and strings stripped).
 *  ⏱ 2026-10-02 · port-sql: the D1 types joined, so a handler typed `D1Database`
 *  (or a statement typed `D1PreparedStatement`) reddens as a `KVNamespace` does.
 *  `\b` on both sides, so an identifier that merely CONTAINS one (`dumpD1Database`)
 *  is not a type. */
export const BINDING_TYPE_RE = /\b(?:KVNamespace\w*|R2(?:Bucket|Objects?|ObjectBody|PutOptions|ListOptions|HTTPMetadata)|RateLimit(?:Options|Outcome)?|D1(?:Database(?:Session)?|PreparedStatement|Result|Response|Meta|ExecResult))\b/;
/** Limb 13: a read of the runtime's per-request `cf` object, or its type. Matched on
 *  comment- AND string-stripped code for the dot and destructuring forms, and on
 *  comment-stripped code for the bracket form (whose name IS a string). */
export const CF_READ_RE = /(?:\?\.|\.)\s*cf(?![\w$-])|\{[^{}]*(?<![\w$.-])cf(?![\w$-])[^{}]*\}\s*=(?!=)|\bIncomingRequestCfProperties\b/;
export const CF_BRACKET_RE = /\[\s*(['"`])cf\1\s*\]/;
/**
 * The limb 12 and limb 13 matches in one TS module's text: the binding type it names and
 * the `cf` read it makes, each null when absent. Comments never count; strings never
 * count except the bracket form's own name. affected-guards.mjs selects this guard with
 * it, so the selector and the guard cannot disagree about what a shape is.
 */
export function workerSourceShapes(text) {
  const code = stripSourceComments(text, '.ts');
  const bare = stripStringLiterals(code);
  const binding = BINDING_TYPE_RE.exec(bare);
  const cf = CF_READ_RE.exec(bare) ?? CF_BRACKET_RE.exec(code);
  return { binding: binding ? binding[0] : null, cf: cf ? cf[0].trim() : null };
}
/** Limb 13's one permitted reader. */
export const GEO_HOME = 'services/_shared/src/geo.ts';
/** Limb 12's permitted homes under services/_shared. */
export const PORTS_HOME = 'services/_shared/src/ports/';

/** The ops monitor API (limb 11): the directory every ops script reaches GlitchTip's
 *  uptime-monitor API through, and its adapter — the positive control. */
export const MONITOR_API_DIR = 'tooling/ops/monitor-api';
export const MONITOR_API_ADAPTER = 'tooling/ops/monitor-api/glitchtip.mjs';
/** A monitor route, as a script would name it. */
const MONITOR_ROUTE = /monitors\/|monitorsPath|heartbeat_check/;
/** Ops scripts that still reach the monitor API with their own request code —
 *  DECLARED, printed on every run, and each must still match (a stale row fails). */
export const MONITOR_API_EXCEPTIONS = Object.freeze([
  {
    file: 'tooling/ops/verify-alarm-chains.mjs',
    why: 'the alarm-chain canary: its own api() also drives alert rules, the project list and the canary event, and the drill breaks and restores a heartbeat monitor on purpose',
    until: 'port-telemetry-callers',
  },
]);

// ── values a registry may never carry (rule: no secret value, no business-fact literal) ──
// Each shape is one a real credential or a PII literal takes; a registry names
// secrets and identity by NAME and by PATH, so none of these has a legitimate use.
export const FORBIDDEN_VALUES = Object.freeze([
  { what: 'a secret-shaped token (vendor key prefix)', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}|\bpdl_(?:live|sdbx)_[A-Za-z0-9_]{8,}|\brzp_(?:live|test)_[A-Za-z0-9]{8,}/ },
  { what: 'a JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { what: 'a private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { what: 'a long high-entropy token', re: /(?<![A-Za-z0-9/._-])(?=[A-Za-z0-9+_=-]*\d)(?=[A-Za-z0-9+_=-]*[a-z])(?=[A-Za-z0-9+_=-]*[A-Z])[A-Za-z0-9+_=-]{32,}(?![A-Za-z0-9/._-])/ },
  { what: 'an e-mail address (identity is a house-identity.json PATH, never the value)', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
]);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The interface an adapter implements, by its impl.file: `ts`, `dart`, or null (external). */
export const langOf = (a) => {
  const f = a?.impl?.file;
  if (typeof f !== 'string') return null;
  return /\.dart$/.test(f) ? 'dart' : /\.(?:ts|mts)$/.test(f) ? 'ts' : null;
};
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

// ── the validator: the subset of JSON Schema port.schema.json uses, and nothing silently ──
const KNOWN_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'minLength',
  'minimum', 'maximum', 'minItems', 'minProperties', 'required', 'properties', 'additionalProperties', 'items',
]);

/** Validate `value` against `schema` (resolving `#/$defs/…` in `rootSchema`); returns error strings. */
export function validate(value, schema, rootSchema = schema, at = '$') {
  const errors = [];
  if (schema.$ref) {
    const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(schema.$ref);
    const target = m ? rootSchema.$defs?.[m[1]] : null;
    if (!target) return [`${at}: the schema's $ref ${schema.$ref} does not resolve`];
    return validate(value, target, rootSchema, at);
  }
  for (const k of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(k)) errors.push(`${at}: the schema uses keyword \`${k}\`, which this validator does not implement — refused rather than ignored`);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    const ok = types.some((x) => x === t || (x === 'number' && (t === 'number' || t === 'integer')));
    if (!ok) return [...errors, `${at}: is ${t}, expected ${types.join(' | ')}`];
  }
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, rootSchema, `${at}[${i}]`)));
  }
  if (isObj(value)) {
    const props = schema.properties ?? {};
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${at}: fewer than ${schema.minProperties} key(s)`);
    for (const r of schema.required ?? []) if (!(r in value)) errors.push(`${at}: missing required \`${r}\``);
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errors.push(...validate(v, props[k], rootSchema, `${at}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown key \`${k}\` (additionalProperties: false)`);
      else if (isObj(schema.additionalProperties)) errors.push(...validate(v, schema.additionalProperties, rootSchema, `${at}.${k}`));
    }
  }
  return errors;
}

/** Every string inside `value`, with its JSON path. */
function* strings(value, at = '$') {
  if (typeof value === 'string') yield [at, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], `${at}[${i}]`);
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) yield* strings(v, `${at}.${k}`);
}

/** Forbidden literals in a registry: [{at, what}]. */
export function forbiddenValues(doc) {
  const out = [];
  for (const [at, s] of strings(doc)) {
    for (const f of FORBIDDEN_VALUES) if (f.re.test(s)) out.push({ at, what: f.what });
  }
  return out;
}

// ── declarations ───────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when `symbol` is DECLARED in comment-stripped `src` of extension `ext`. */
export function declares(src, symbol, ext) {
  const s = esc(symbol);
  if (ext === '.dart') {
    return new RegExp(`\\b(?:(?:abstract|base|final|sealed|interface|mixin)\\s+)*(?:class|mixin|enum|extension\\s+type|typedef)\\s+${s}\\b`).test(src) ||
      new RegExp(`^[ \\t]*(?:const|final|var|[A-Za-z_][\\w<>?, ]*)\\s+${s}\\s*(?:=|\\()`, 'm').test(src);
  }
  return new RegExp(`\\b(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:interface|type|class|enum|function\\*?|const|let|var)\\s+${s}\\b`).test(src);
}

/** The comment-stripped source of a repo file, or null. */
function readStripped(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  try { return stripSourceComments(readFileSync(abs, 'utf8'), extname(rel).toLowerCase()); } catch { return null; }
}

/**
 * True when `symbol` is declared in the Dart LIBRARY at `rel`: in the file itself, or in a file
 * it re-exports by a relative `export '…';` directive (one level — a library's public API is
 * what it exports, and a seam package's library file is the interface its apps import).
 */
export function declaresInLibrary(root, rel, symbol) {
  const src = readStripped(root, rel);
  if (src === null) return false;
  if (declares(src, symbol, '.dart')) return true;
  for (const m of src.matchAll(/^\s*export\s+'([^':]+)'/gm)) {
    const target = posix.normalize(posix.join(posix.dirname(rel), m[1]));
    const t = readStripped(root, target);
    if (t !== null && declares(t, symbol, '.dart')) return true;
  }
  return false;
}

/** Every `.dart` file under `relDir`, repo-relative. */
function walkDart(root, relDir, out) {
  let entries;
  try { entries = listDir(join(root, relDir), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = posix.join(relDir, e.name);
    if (e.isDirectory()) walkDart(root, rel, out);
    else if (e.name.endsWith('.dart')) out.push(rel);
  }
}

/** The `lib/` directories of every Dart package and app: packages/<p>/lib, apps/<a>/lib. */
function dartLibDirs(root) {
  const out = [];
  for (const top of ['packages', 'apps']) {
    let dirs = [];
    try { dirs = listDir(join(root, top), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* none */ }
    for (const d of dirs) if (existsSync(join(root, top, d, 'lib'))) out.push(`${top}/${d}/lib`);
  }
  return out;
}

/** A runner CALL, in comment-stripped source that does not declare it (vacuous-10/11). */
export function callsRunner(src, runner, ext) {
  if (declares(src, runner, ext)) return false;
  return new RegExp(`(?<![\\w.])${esc(runner)}\\s*(?:<[^>()]*>)?\\s*\\(`).test(src);
}

// ── the TS import graph (limb 4) ───────────────────────────────────────────────
const IMPORT_RES = [
  /\bimport\s+(?:type\s+)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function walkTs(root, relDir, out) {
  const abs = join(root, relDir);
  let entries;
  try { entries = listDir(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = posix.join(relDir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkTs(root, rel, out); }
    else if (/\.(?:ts|mts)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(rel);
  }
}

/** Every module specifier a TS file imports, resolved to a repo-relative path when relative. */
export function importsOf(root, rel, src) {
  const code = stripSourceComments(src, '.ts');
  const out = new Set();
  for (const re of IMPORT_RES) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const base = posix.normalize(posix.join(posix.dirname(rel), spec));
      const candidates = [base, `${base}.ts`, base.replace(/\.js$/, '.ts'), posix.join(base, 'index.ts')];
      const hit = candidates.find((c) => existsSync(join(root, c)) && statSync(join(root, c)).isFile());
      if (hit) out.add(hit);
    }
  }
  return out;
}

// ── secrets (limb 5) ──────────────────────────────────────────────────────────
export function readSecretSources(root) {
  if (existsSync(join(root, SECRETS_MANIFEST))) {
    try {
      const doc = JSON.parse(readFileSync(join(root, SECRETS_MANIFEST), 'utf8'));
      const rows = Array.isArray(doc) ? doc : Array.isArray(doc?.rows) ? doc.rows : Array.isArray(doc?.secrets) ? doc.secrets : null;
      // a row's NAME is `secret` (tooling/worker-secrets.json, read by assert-worker-secrets-declared.mjs); `name` is the older spelling
      const names = new Set((rows ?? []).map((r) => (typeof r === 'string' ? r : r?.secret ?? r?.name)).filter((n) => typeof n === 'string'));
      if (!names.size) return { lost: `${SECRETS_MANIFEST} exists but yields no secret names`, source: 'manifest', names, declaredElsewhere: new Set() };
      return { lost: null, source: 'manifest', names, declaredElsewhere: new Set() };
    } catch (e) {
      return { lost: `${SECRETS_MANIFEST} exists but could not be parsed (${e.message})`, source: 'manifest', names: new Set(), declaredElsewhere: new Set() };
    }
  }
  const names = new Set();
  const svc = join(root, 'services');
  let dirs = [];
  try { dirs = listDir(svc, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* lost below */ }
  for (const d of dirs) {
    const src = readStripped(root, `services/${d}/src/types.ts`);
    const block = src?.match(/interface\s+Env\s*\{([\s\S]*?)\n\}/);
    if (!block) continue;
    for (const m of block[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*[?:]/gm)) names.add(m[1]);
  }
  const declaredElsewhere = new Set();
  try {
    const ch = JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8'));
    for (const r of ch?.ciSecretRegister?.nonSigning ?? []) if (typeof r?.name === 'string') declaredElsewhere.add(r.name);
  } catch { /* the waiver source is optional; absent, a non-Env name is a finding */ }
  if (!names.size) return { lost: 'no `interface Env` member was read from any services/*/src/types.ts, and tooling/worker-secrets.json does not exist', source: 'env', names, declaredElsewhere };
  return { lost: null, source: 'env', names, declaredElsewhere };
}

// ── the evaluation ────────────────────────────────────────────────────────────
/**
 * Evaluate every limb over the tree at `root`.
 * @returns {{ findings: {limb:number,msg:string,lost:boolean}[], waivers: string[], notes: string[],
 *   table: {port:string,claimed:number,earned:number,target:number}[], ports: object[],
 *   vendorPort: Map<string,{port:string,adapter:string,earned:number}>, nonPort: Map<string,object> }}
 */
export function evaluate(root) {
  const findings = [];
  const waivers = [];
  const notes = [];
  const find = (limb, msg) => findings.push({ limb, msg, lost: false });
  const lost = (limb, msg) => findings.push({ limb, msg: `COVERAGE LOST — ${msg}`, lost: true });
  const result = { findings, waivers, notes, table: [], ports: [], vendorPort: new Map(), vendorPorts: new Map(), nonPort: new Map() };

  // ── limb 1 · schema and the set ──
  let schema;
  try { schema = JSON.parse(readFileSync(join(root, SCHEMA_REL), 'utf8')); } catch (e) {
    lost(1, `${SCHEMA_REL} could not be read or parsed (${e.message}); no registry can be graded.`);
    return result;
  }
  let files = [];
  try { files = listDir(join(root, PORTS_DIR)).filter((f) => f.endsWith('.json') && f !== 'port.schema.json' && f !== '_non-port.json').sort(); } catch (e) {
    lost(1, `${PORTS_DIR}/ could not be listed (${e.message}).`);
    return result;
  }
  if (!files.length) {
    lost(1, `${PORTS_DIR}/ holds no port registry. A port set of zero is met by an empty directory, which is not evidence of anything.`);
    return result;
  }
  const ports = [];
  for (const f of files) {
    const rel = `${PORTS_DIR}/${f}`;
    let doc;
    try { doc = JSON.parse(readFileSync(join(root, rel), 'utf8')); } catch (e) {
      lost(1, `${rel} could not be parsed (${e.message}).`);
      continue;
    }
    const errs = validate(doc, schema, schema);
    for (const e of errs) find(1, `${rel} ${e}`);
    for (const v of forbiddenValues(doc)) find(1, `${rel} ${v.at} carries ${v.what}. A registry names secrets and identity; it never holds one.`);
    if (doc?.port !== f.replace(/\.json$/, '')) find(1, `${rel} declares port ${JSON.stringify(doc?.port)}; the port is the file name.`);
    const ids = new Set();
    for (const a of doc?.adapters ?? []) {
      if (ids.has(a?.id)) find(1, `${rel} lists adapter \`${a?.id}\` twice.`);
      ids.add(a?.id);
      if (a?.status === 'fake' && a?.vendor !== null) find(1, `${rel} adapter \`${a.id}\` is a fake with vendor ${JSON.stringify(a.vendor)}; a fake has none.`);
      // A per-channel adapter names its tooling/channel-register.json row instead of a vendor (limb 8 resolves it).
      if (a?.status !== 'fake' && a?.status !== 'draft' && a?.vendor === null && typeof a?.channel !== 'string') find(1, `${rel} adapter \`${a.id}\` has vendor null but is not a fake and names no \`channel\`.`);
      if (typeof a?.channel === 'string' && a?.vendor !== null) find(1, `${rel} adapter \`${a.id}\` names both a vendor and a channel; a channel adapter's store is its register row's.`);
      const impl = a?.impl ?? {};
      // A draft is declared and not built: an EMPTY impl is honest for it, a half one is not.
      const unbuiltDraft = a?.status === 'draft' && isObj(impl) && Object.keys(impl).length === 0;
      if (!unbuiltDraft && (a?.status === 'external' ? !(impl.configAt && impl.verify) : !(impl.file && impl.symbol))) {
        find(1, `${rel} adapter \`${a?.id}\` impl must be ${a?.status === 'external' ? '{configAt, verify}' : a?.status === 'draft' ? '{file, symbol}, or {} while unbuilt,' : '{file, symbol}'} for status ${a?.status}.`);
      }
    }
    for (const a of doc?.adapters ?? []) {
      if (Array.isArray(a?.environments) && a.environments.length === 0 && a.status !== 'draft' && a.status !== 'retired') {
        find(1, `${rel} adapter \`${a.id}\` lists no environment but is ${a.status}; only a draft or retired adapter may be selectable nowhere.`);
      }
    }
    if (doc?.selection?.by === 'stream' && !isObj(doc?.streams)) find(1, `${rel} is selected by stream but declares no \`streams\`.`);
    for (const [name, st] of Object.entries(isObj(doc?.streams) ? doc.streams : {})) {
      const a = (doc?.adapters ?? []).find((x) => x?.id === st?.adapter);
      if (!a) { find(1, `${rel} stream \`${name}\` names adapter \`${st?.adapter}\`, which is no adapter of this port.`); continue; }
      for (const n of st.secrets ?? []) if (!(a.secrets ?? []).includes(n)) find(1, `${rel} stream \`${name}\` takes secret \`${n}\`, which its adapter \`${a.id}\` does not declare.`);
    }
    // `features` is the price list of a METERED per-call port: one whose adapters price models
    // (ai). A per-call port that prices no model (channels: the channel picks the submitter) has
    // nothing for a feature to run on, so it needs none.
    const pricesModels = (doc?.adapters ?? []).some((a) => isObj(a?.cost?.models) && Object.keys(a.cost.models).length > 0);
    if (doc?.selection?.by === 'per-call' && pricesModels && !isObj(doc?.features)) find(1, `${rel} is selected per call and prices models but declares no \`features\`.`);
    for (const [name, ft] of Object.entries(isObj(doc?.features) ? doc.features : {})) {
      const a = (doc?.adapters ?? []).find((x) => x?.id === ft?.adapter);
      if (!a) { find(1, `${rel} feature \`${name}\` names adapter \`${ft?.adapter}\`, which is no adapter of this port.`); continue; }
      const priced = isObj(a.cost?.models) ? a.cost.models : {};
      for (const m of ft.candidates ?? []) if (!isObj(priced[m])) find(1, `${rel} feature \`${name}\` lists candidate \`${m}\`, which adapter \`${a.id}\` does not price in cost.models.`);
      if (typeof ft.model === 'string' && !(ft.candidates ?? []).includes(ft.model)) find(1, `${rel} feature \`${name}\` runs on \`${ft.model}\`, which is not one of its candidates.`);
    }
    // A fallback chain is sent with a model, so every model in it can be billed:
    // each must be priced by the same adapter (review 1 of #1136).
    for (const a of doc?.adapters ?? []) {
      const priced = isObj(a?.cost?.models) ? a.cost.models : {};
      for (const [m, row] of Object.entries(priced)) {
        for (const f of Array.isArray(row?.fallbacks) ? row.fallbacks : []) {
          if (!isObj(priced[f])) find(1, `${rel} adapter \`${a.id}\` model \`${m}\` falls back to \`${f}\`, which it does not price in cost.models.`);
        }
      }
    }
    for (const env of ['live', 'sandbox', 'test']) {
      const sel = doc?.selection?.default?.[env];
      if (sel !== null && sel !== undefined && !ids.has(sel)) find(1, `${rel} selection.default.${env} names \`${sel}\`, which is no adapter of this port.`);
    }
    for (const p of doc?.conformance?.pending ?? []) if (!ids.has(p.adapter)) find(1, `${rel} conformance.pending names adapter \`${p.adapter}\`, which is not one of this port's.`);
    // per-interface grading: its keys are the interface's, and its slots name this port's adapters
    const ifaceKeys = Object.keys(doc?.interface ?? {}).sort();
    const byLevel = doc?.level?.byInterface;
    if (isObj(byLevel) && JSON.stringify(Object.keys(byLevel).sort()) !== JSON.stringify(ifaceKeys)) {
      find(1, `${rel} level.byInterface grades ${JSON.stringify(Object.keys(byLevel).sort())}, and the port's interfaces are ${JSON.stringify(ifaceKeys)}; grade every interface or none.`);
    }
    for (const [lang, sel] of Object.entries(isObj(doc?.selection?.byInterface) ? doc.selection.byInterface : {})) {
      if (!ifaceKeys.includes(lang)) find(1, `${rel} selection.byInterface.${lang} selects for an interface the port does not declare.`);
      for (const env of ['live', 'sandbox', 'test']) {
        const id = sel?.default?.[env];
        if (id !== null && id !== undefined && !ids.has(id)) find(1, `${rel} selection.byInterface.${lang}.default.${env} names \`${id}\`, which is no adapter of this port.`);
        else if (id && langOf(doc.adapters.find((a) => a?.id === id)) !== lang) find(1, `${rel} selection.byInterface.${lang}.default.${env} names \`${id}\`, which is not a ${lang} adapter.`);
      }
    }
    ports.push({ rel, doc, schemaOk: errs.length === 0 });
  }
  let nonPortDoc = null;
  try {
    nonPortDoc = JSON.parse(readFileSync(join(root, NON_PORT_REL), 'utf8'));
    for (const e of validate(nonPortDoc, { $ref: '#/$defs/nonPortRegister' }, schema)) find(1, `${NON_PORT_REL} ${e}`);
    for (const v of forbiddenValues(nonPortDoc)) find(1, `${NON_PORT_REL} ${v.at} carries ${v.what}.`);
    for (const r of nonPortDoc?.rows ?? []) {
      if (('until' in r) === ('nonPort' in r)) find(1, `${NON_PORT_REL} row \`${r.vendor}\` must carry exactly one of \`until\` and \`nonPort\`.`);
      if ('remaining' in r && !('until' in r)) find(1, `${NON_PORT_REL} row \`${r.vendor}\` names \`remaining\` surfaces without \`until\`: what is left of a ported vendor is waiting for a train, not deliberately never ported.`);
    }
  } catch (e) {
    lost(8, `${NON_PORT_REL} could not be read or parsed (${e.message}); the cross-register limb has no non-port side.`);
  }
  result.ports = ports;

  // ── limb 2 · declarations ──
  const symOk = new Map(); // port -> interface declared
  for (const { rel, doc } of ports) {
    let interfaceOk = Object.keys(doc?.interface ?? {}).length > 0;
    for (const [lang, it] of Object.entries(doc?.interface ?? {})) {
      const src = readStripped(root, it.file);
      if (src === null) { find(2, `${rel} interface.${lang}.file \`${it.file}\` does not exist.`); interfaceOk = false; continue; }
      for (const s of it.symbols ?? []) {
        const ok = extname(it.file) === '.dart' ? declaresInLibrary(root, it.file, s) : declares(src, s, extname(it.file));
        if (!ok) { find(2, `${rel} interface.${lang} symbol \`${s}\` is not declared in \`${it.file}\`${extname(it.file) === '.dart' ? ' or a file it exports' : ''}.`); interfaceOk = false; }
      }
    }
    symOk.set(doc.port, interfaceOk);
    for (const a of doc?.adapters ?? []) {
      if (a?.status === 'external' || !a?.impl?.file) continue;
      const src = readStripped(root, a.impl.file);
      if (src === null) { find(2, `${rel} adapter \`${a.id}\` impl.file \`${a.impl.file}\` does not exist.`); continue; }
      if (!declares(src, a.impl.symbol, extname(a.impl.file))) find(2, `${rel} adapter \`${a.id}\` symbol \`${a.impl.symbol}\` is not declared in \`${a.impl.file}\`.`);
    }
    for (const a of doc?.adapters ?? []) {
      if (!a?.outbound) continue;
      const src = readStripped(root, a.outbound.file);
      if (src === null) { find(2, `${rel} adapter \`${a.id}\` outbound.file \`${a.outbound.file}\` does not exist.`); continue; }
      if (!declares(src, a.outbound.symbol, extname(a.outbound.file))) find(2, `${rel} adapter \`${a.id}\` outbound symbol \`${a.outbound.symbol}\` is not declared in \`${a.outbound.file}\`.`);
      for (const m of a.outbound.modules ?? []) if (!existsSync(join(root, m))) find(2, `${rel} adapter \`${a.id}\` outbound module \`${m}\` does not exist.`);
    }
    const src = doc?.selection?.source;
    if (typeof src === 'string') {
      const [file, pointer] = src.split('#');
      if (!existsSync(join(root, file))) find(2, `${rel} selection.source names \`${file}\`, which does not exist.`);
      else if (file.endsWith('.json')) {
        let node;
        try { node = JSON.parse(readFileSync(join(root, file), 'utf8')); } catch { node = undefined; }
        for (const k of pointer.split('.')) node = isObj(node) ? node[k] : undefined;
        if (node === undefined) find(2, `${rel} selection.source pointer \`${src}\` resolves to nothing.`);
      } else if (!readFileSync(join(root, file), 'utf8').includes(pointer)) {
        find(2, `${rel} selection.source anchor \`${pointer}\` is not in \`${file}\`.`);
      }
    }
  }

  // ── limb 3 · waivers ──
  for (const { rel, doc } of ports) {
    for (const h of doc?.handTables ?? []) {
      const abs = join(root, h.file);
      if (!existsSync(abs) || !readFileSync(abs, 'utf8').includes(h.anchor)) {
        find(3, `${rel} handTables anchor \`${h.anchor}\` is no longer in \`${h.file}\`. Remove the waiver, or re-anchor it on the hand table that replaced it.`);
      } else {
        waivers.push(`${doc.port}: hand table \`${h.anchor}\` in ${h.file} — until ${h.until}`);
      }
    }
    if (doc?.generated === true && !existsSync(join(root, RENDER_TOOL))) {
      find(3, `${rel} claims \`generated: true\`, but ${RENDER_TOOL} (the renderer) does not exist; no rendered table can be current.`);
    }
  }
  // The rendered table is current, whether or not a port claims `generated` yet: a hand
  // edit of services/platform/src/generated/ports.ts is a finding on every build.
  if (existsSync(join(root, RENDER_TOOL)) && ports.some(({ doc }) => doc?.port === 'payments')) {
    const r = renderCheck(root);
    if (r.lost) lost(3, `render --check: ${r.detail}`);
    else if (!r.ok) find(3, `render --check: ${r.detail}`);
    else notes.push(`limb 3: ${r.detail}`);
  }

  // ── limb 4 · imports ──
  const tsFiles = [];
  let workers = [];
  try { workers = listDir(join(root, 'services'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* lost below */ }
  for (const w of workers) walkTs(root, `services/${w}/src`, tsFiles);
  const tsPorts = ports.filter(({ doc }) => doc?.interface?.ts);
  const limb4Clean = new Map(ports.map(({ doc }) => [doc.port, true]));
  if (tsPorts.length && !tsFiles.length) {
    lost(4, 'the import walk read no TypeScript module under services/*/src, so "no caller imports an adapter" would hold of nothing.');
    for (const { doc } of tsPorts) limb4Clean.set(doc.port, false);
  } else {
    const graph = new Map(tsFiles.map((f) => [f, importsOf(root, f, readFileSync(join(root, f), 'utf8'))]));
    let edges = 0;
    for (const set of graph.values()) edges += set.size;
    if (tsFiles.length && edges === 0) {
      lost(4, `the import walk read ${tsFiles.length} module(s) and resolved ZERO relative imports; the specifier parse has broken.`);
      for (const { doc } of tsPorts) limb4Clean.set(doc.port, false);
    }
    for (const { rel, doc } of tsPorts) {
      // An adapter's files: its inbound impl, its outbound half and that half's private modules (port-pay-core).
      const implFiles = new Set((doc.adapters ?? []).flatMap((a) => [a?.impl?.file, a?.outbound?.file, ...(a?.outbound?.modules ?? [])]).filter((f) => typeof f === 'string' && /\.ts$/.test(f)));
      const allowed = new Set(doc.generated === false ? (doc.handTables ?? []).map((h) => h.file) : []);
      for (const [from, targets] of graph) {
        const worker = from.split('/')[1];
        if (from === `services/${worker}/${COMPOSITION_ROOT}` || allowed.has(from) || implFiles.has(from)) continue;
        for (const t of targets) {
          if (implFiles.has(t)) {
            find(4, `${rel}: \`${from}\` imports the adapter \`${t}\`. Only services/${worker}/${COMPOSITION_ROOT} (the composition root) may, or — while generated: false — a file the port's handTables names.`);
            limb4Clean.set(doc.port, false);
          }
        }
      }
    }
    notes.push(`limb 4 walked ${tsFiles.length} TS module(s), ${edges} relative import(s)`);
  }

  // ── limbs 12 and 13 · Cloudflare binding types and `.cf`, over the same walk ──
  if (!tsFiles.length) {
    lost(12, 'the walk read no TypeScript module under services/*/src, so "no handler names a binding type" would hold of nothing.');
    lost(13, 'the walk read no TypeScript module under services/*/src, so "only geo.ts reads .cf" would hold of nothing.');
  } else {
    let bindingHomesMatched = 0;
    let geoHomeMatched = false;
    for (const f of tsFiles) {
      const shape = workerSourceShapes(readFileSync(join(root, f), 'utf8'));
      const worker = f.split('/')[1];
      const bindingHome = f === `services/${worker}/${COMPOSITION_ROOT}` || f === `services/${worker}/src/types.ts` || f.startsWith(PORTS_HOME);
      if (shape.binding) {
        if (bindingHome) bindingHomesMatched++;
        else find(12, `\`${f}\` names the Cloudflare binding type \`${shape.binding}\`. A handler takes the PORT (KvStore, ObjectStore, RateLimiter, SqlDb in ${PORTS_HOME}); only a composition root (services/<worker>/${COMPOSITION_ROOT}), a services/<worker>/src/types.ts or ${PORTS_HOME} may name the binding.`);
      }
      if (shape.cf) {
        if (f === GEO_HOME) geoHomeMatched = true;
        else find(13, `\`${f}\` reads the runtime's \`cf\` object (\`${shape.cf}\`). Request geography is \`requestGeo\` in ${GEO_HOME}, the one reader.`);
      }
    }
    if (!bindingHomesMatched) lost(12, `the binding-type pattern matched nothing in ${tsFiles.length} module(s), not even in a types.ts or ${PORTS_HOME} — a pattern that matches nothing refuses nothing.`);
    if (!geoHomeMatched) lost(13, `${GEO_HOME} ${tsFiles.includes(GEO_HOME) ? 'no longer matches the `.cf` pattern' : 'was not walked (moved or deleted)'}; with the one reader unseen, "nothing else reads .cf" is evidence of nothing.`);
    notes.push(`limbs 12/13 read ${tsFiles.length} TS module(s): binding types in ${bindingHomesMatched} permitted home(s), .cf only in ${GEO_HOME}`);
  }

  // ── limb 5 · secrets ──
  const sec = readSecretSources(root);
  if (sec.lost) lost(5, sec.lost);
  else {
    notes.push(sec.source === 'env' ? `limb 5: manifest absent, read interface Env (${sec.names.size} name(s))` : `limb 5: read ${SECRETS_MANIFEST} (${sec.names.size} name(s))`);
    for (const { rel, doc } of ports) {
      for (const a of doc?.adapters ?? []) {
        for (const n of a?.secrets ?? []) {
          if (sec.names.has(n)) continue;
          if (sec.source === 'env' && sec.declaredElsewhere.has(n)) {
            waivers.push(`${doc.port}/${a.id}: secret ${n} is not an interface Env member; declared by name in ${CHANNEL_REGISTER} ciSecretRegister (read dynamically)`);
            continue;
          }
          find(5, `${rel} adapter \`${a.id}\` names secret \`${n}\`, which is ${sec.source === 'env' ? 'no `interface Env` member of any services/*/src/types.ts' : `no row of ${SECRETS_MANIFEST}`}.`);
        }
      }
    }
  }

  // ── limb 7 · fakes (before 6: a fake in live un-earns L2) ──
  const fakeLive = new Map();
  for (const { rel, doc } of ports) {
    const fakes = new Set((doc?.adapters ?? []).filter((a) => a?.status === 'fake').map((a) => a.id));
    for (const a of doc?.adapters ?? []) {
      if (a?.status === 'fake' && (a.environments ?? []).includes('live')) { find(7, `${rel} fake \`${a.id}\` lists the \`live\` environment. A fake is never selectable in live.`); fakeLive.set(doc.port, true); }
    }
    const live = doc?.selection?.default?.live;
    if (live && fakes.has(live)) { find(7, `${rel} selection.default.live is the fake \`${live}\`.`); fakeLive.set(doc.port, true); }
    for (const [lang, sel] of Object.entries(isObj(doc?.selection?.byInterface) ? doc.selection.byInterface : {})) {
      const l = sel?.default?.live;
      if (l && fakes.has(l)) { find(7, `${rel} selection.byInterface.${lang}.default.live is the fake \`${l}\`.`); fakeLive.set(doc.port, true); }
    }
  }

  // ── limb 6 · the earned level ──
  // One grading, applied to the whole port — or, when `level.byInterface` is
  // present, to each interface over ITS adapters (by impl.file extension), its
  // selection (`selection.byInterface[lang]`, else the port's) and a suite in
  // ITS language. The port then earns the lowest of them.
  const grade = (doc, schemaOk, lang) => {
    const why = [];
    const its = (doc.adapters ?? []).filter((a) => lang === null || langOf(a) === lang);
    let earned = 0;
    const ifaceOk = lang === null ? symOk.get(doc.port) : symOk.get(doc.port) && Boolean(doc?.interface?.[lang]);
    if (schemaOk && ifaceOk) earned = 1;
    else why.push('the interface is not declared where the registry says');
    const real = its.filter((a) => a?.status !== 'fake' && a?.status !== 'retired' && a?.status !== 'draft');
    const sel = (lang !== null && doc?.selection?.byInterface?.[lang]) || doc?.selection;
    const selected = sel && (sel.source !== null || sel.default?.live || sel.default?.sandbox);
    const fakeInLive = its.some((a) => a?.status === 'fake' && (a.environments ?? []).includes('live')) ||
      its.some((a) => a?.status === 'fake' && a.id === sel?.default?.live);
    if (earned === 1) {
      if (!selected) why.push('no selection: neither a source nor a default names how an adapter is chosen');
      else if (!limb4Clean.get(doc.port)) why.push('a caller imports an adapter (limb 4)');
      else if (!real.length) why.push('no built, non-fake adapter');
      else if (lang === null ? fakeLive.get(doc.port) : fakeInLive) why.push('a fake is selectable in live (limb 7)');
      else earned = 2;
    }
    if (earned === 2) {
      const suite = doc?.conformance?.suite;
      const pending = new Set((doc?.conformance?.pending ?? []).map((p) => p.adapter));
      let conformant = 0;
      if (!suite) why.push('no conformance suite');
      else if (lang !== null && langOf({ impl: { file: suite.file } }) !== lang) why.push(`no conformance suite for the ${lang} interface (the suite ${suite.file} is ${langOf({ impl: { file: suite.file } }) ?? 'neither'})`);
      else {
        // A two-sided port (ai: Worker adapters and Dart bring-your-own-key
        // adapters) carries a `clientSuite` too. Each adapter is graded against
        // the suite in ITS OWN language — a Dart test cannot call a TS runner.
        const suites = [suite, doc.conformance.clientSuite].filter(Boolean);
        const undeclared = suites.find((st) => {
          const src = readStripped(root, st.file);
          return src === null || !declares(src, st.runner, extname(st.file));
        });
        if (undeclared) why.push(`the suite ${undeclared.file} does not declare ${undeclared.runner}`);
        else {
          for (const a of its) {
            // A draft or retired adapter may pass the suite (mail's SES draft
            // does), but no environment can select it, so it earns nothing.
            if (!a?.conformance?.file || pending.has(a.id) || a.status === 'draft' || a.status === 'retired') continue;
            const st = suites.find((x) => extname(x.file) === extname(a.conformance.file));
            if (!st) continue;
            const s = readStripped(root, a.conformance.file);
            if (s !== null && callsRunner(s, st.runner, extname(a.conformance.file))) conformant++;
          }
          if (conformant < 2) why.push(`${conformant} conformant adapter(s); L3 needs two with zero pending`);
        }
      }
      const sw = doc?.switch;
      if (!sw?.runbook) why.push('no switch runbook');
      if (!existsSync(join(root, 'tooling/ops/port-switch.mjs'))) why.push('no dry-run tool');
      if (conformant >= 2 && sw?.runbook && existsSync(join(root, 'tooling/ops/port-switch.mjs'))) earned = 3;
    }
    return { earned, why };
  };
  for (const { rel, doc, schemaOk } of ports) {
    for (const p of doc?.conformance?.pending ?? []) notes.push(`PENDING ${doc.port}/${p.adapter}: ${p.case} (${p.row}) — blocks L3 for that adapter`);
    const claimed = doc?.level?.claimed ?? 0;
    const target = doc?.level?.target ?? 0;
    const byLevel = isObj(doc?.level?.byInterface) ? doc.level.byInterface : null;
    let earned;
    let why;
    if (byLevel) {
      const rows = [];
      for (const lang of Object.keys(byLevel).sort()) {
        const g = grade(doc, schemaOk, lang);
        const c = byLevel[lang]?.claimed ?? 0;
        const t = byLevel[lang]?.target ?? 0;
        rows.push({ lang, ...g, claimed: c, target: t });
        result.table.push({ port: `${doc.port}.${lang}`, claimed: c, earned: g.earned, target: t, why: g.earned < t ? g.why[0] ?? '' : '' });
        if (c > g.earned) find(6, `${rel} claims L${c} for its ${lang} interface and earns L${g.earned}: ${g.why[0] ?? 'see above'}.`);
        if (c > t) find(6, `${rel} claims L${c} for its ${lang} interface, above its target L${t}.`);
      }
      const low = rows.reduce((m, r) => (r.earned < m.earned ? r : m), rows[0]);
      earned = low.earned;
      why = low.why.map((w) => `${low.lang}: ${w}`);
      const minClaim = Math.min(...rows.map((r) => r.claimed));
      const minTarget = Math.min(...rows.map((r) => r.target));
      if (claimed !== minClaim) find(6, `${rel} level.claimed is L${claimed}, and its weakest interface claims L${minClaim}; a port claims what its weakest interface claims.`);
      if (target !== minTarget) find(6, `${rel} level.target is L${target}, and its interfaces' lowest target is L${minTarget}.`);
    } else {
      ({ earned, why } = grade(doc, schemaOk, null));
    }
    result.table.push({ port: doc.port, claimed, earned, target, why: earned < target ? why[0] ?? '' : '' });
    if (claimed > earned) find(6, `${rel} claims L${claimed} and earns L${earned}: ${why[0] ?? 'see above'}.`);
    if (claimed > target) find(6, `${rel} claims L${claimed} above its target L${target}.`);
  }
  const earnedOf = new Map(result.table.map((r) => [r.port, r.earned]));

  // ── limb 8 · cross-register ──
  let cap; let prov;
  try { cap = JSON.parse(readFileSync(join(root, CAPABILITY_REGISTER), 'utf8')); } catch (e) { lost(8, `${CAPABILITY_REGISTER} could not be read (${e.message}).`); }
  try { prov = JSON.parse(readFileSync(join(root, PROVIDER_REGISTER), 'utf8')); } catch (e) { lost(8, `${PROVIDER_REGISTER} could not be read (${e.message}).`); }
  if (cap && prov && nonPortDoc) {
    const capIds = Object.keys(cap.vendors ?? {}).filter((k) => !k.startsWith('_'));
    const provIds = (Array.isArray(prov.providers) ? prov.providers : []).map((p) => p?.id).filter((x) => typeof x === 'string');
    if (!capIds.length || !provIds.length) lost(8, `read ${capIds.length} capability-register vendor(s) and ${provIds.length} provider(s); a side of zero is a cross-check of nothing.`);
    const all = new Map();
    for (const id of capIds) all.set(id, new Set(['capability-register']));
    for (const id of provIds) all.set(id, new Set([...(all.get(id) ?? []), 'provider-register']));
    // vendor -> [where]: one entry per PORT (two adapters of one port are one placement) and one per _non-port row
    const placed = new Map();
    const place = (v, where) => placed.set(v, [...(placed.get(v) ?? []), where]);
    // ⏱ 2026-10-02 · port-telemetry: a `draft` adapter whose vendor ANOTHER port (or a
    // _non-port row) already places is not a second placement — telemetry's `mail`
    // notifier names resend, which mail.json carries. It prints the pairing. A draft
    // whose vendor nothing else places still places it, in its own port (mail's ses).
    const drafts = [];
    for (const { doc } of ports) {
      const inPort = new Set();
      for (const a of doc?.adapters ?? []) {
        if (typeof a?.vendor !== 'string') continue;
        if (a.status === 'draft') { drafts.push({ doc, a }); continue; }
        // One placement per port: a vendor behind two adapters of the same port
        // (an HTTP API and an SMTP relay; two boxes at one provider; a port's ts and
        // dart halves) is still one vendor in one port.
        if (inPort.has(a.vendor)) { result.vendorPort.get(a.vendor).adapter += `, ${a.id}`; continue; }
        inPort.add(a.vendor);
        place(a.vendor, `${doc.port}/${a.id}`);
        const entry = { port: doc.port, adapter: a.id, earned: earnedOf.get(doc.port) ?? 0 };
        if (!result.vendorPort.has(a.vendor)) result.vendorPort.set(a.vendor, entry);
        result.vendorPorts.set(a.vendor, [...(result.vendorPorts.get(a.vendor) ?? []), entry]);
      }
    }
    for (const r of nonPortDoc.rows ?? []) {
      place(r.vendor, `_non-port`);
      result.nonPort.set(r.vendor, r);
    }
    for (const { doc, a } of drafts) {
      const elsewhere = (placed.get(a.vendor) ?? []).filter((w) => !w.startsWith(`${doc.port}/`));
      const here = (placed.get(a.vendor) ?? []).some((w) => w.startsWith(`${doc.port}/`));
      if (elsewhere.length) waivers.push(`${doc.port}/${a.id}: draft adapter of vendor ${a.vendor}, placed at ${elsewhere.join(', ')} until it is built`);
      else if (here) result.vendorPort.get(a.vendor).adapter += `, ${a.id}`;
      else {
        place(a.vendor, `${doc.port}/${a.id}`);
        const entry = { port: doc.port, adapter: a.id, earned: earnedOf.get(doc.port) ?? 0 };
        result.vendorPort.set(a.vendor, entry);
        result.vendorPorts.set(a.vendor, [entry]);
      }
    }
    for (const [id, regs] of all) {
      const at = placed.get(id) ?? [];
      const rows = at.filter((w) => w === '_non-port');
      const portsAt = at.filter((w) => w !== '_non-port');
      const row = result.nonPort.get(id);
      if (at.length === 0) find(8, `vendor \`${id}\` (${[...regs].join(', ')}) is no adapter's \`vendor\` and no ${NON_PORT_REL} row. Port it, or say in _non-port.json why not.`);
      else if (at.length === 1) continue;
      // ⏱ 2026-10-02 · port-storage: ONE vendor of SEVERAL capabilities (Cloudflare is KV, R2
      // and the rate limiters) is one adapter per port beside ONE _non-port row naming what
      // is LEFT (`remaining`) and the train that ports it (`until`). Without that row, two
      // ports are two placements.
      else if (rows.length === 1 && Array.isArray(row?.remaining) && row.remaining.length && row.until) {
        notes.push(`limb 8: vendor ${id} is the adapter of ${portsAt.map((w) => w.split('/')[0]).join(', ')}; what is left (${row.remaining.join(', ')}) until ${row.until}`);
      } else if (rows.length === 1 && portsAt.length) {
        find(8, `vendor \`${id}\` is placed ${at.length} times (${at.join(', ')}); a non-port row beside a vendor's adapters must name what is LEFT (\`remaining\`) and the train that ports it (\`until\`).`);
      } else find(8, `vendor \`${id}\` is placed ${at.length} times (${at.join(', ')}); exactly one port's adapters or one non-port row.`);
    }
    for (const r of nonPortDoc.rows ?? []) {
      if ('remaining' in r && !(placed.get(r.vendor) ?? []).some((w) => w !== '_non-port')) {
        find(8, `${NON_PORT_REL} row \`${r.vendor}\` names \`remaining\` surfaces, but \`${r.vendor}\` is no adapter of any port: the row is the whole answer. Drop \`remaining\`.`);
      }
    }
    for (const v of placed.keys()) {
      if (!all.has(v)) find(8, `\`${v}\` is placed in tooling/ports/ but is in neither ${CAPABILITY_REGISTER} vendors nor ${PROVIDER_REGISTER} providers.`);
    }
    for (const r of nonPortDoc.rows ?? []) {
      const regs = all.get(r.vendor);
      if (regs) for (const g of r.registers ?? []) if (!regs.has(g)) find(8, `${NON_PORT_REL} row \`${r.vendor}\` says it is in the ${g}, and it is not.`);
    }
    // a ported vendor's C-8 seam.file is its port's interface file
    for (const { rel, doc } of ports) {
      const ifaceFiles = new Set(Object.values(doc?.interface ?? {}).map((i) => i.file));
      for (const a of doc?.adapters ?? []) {
        // A draft whose vendor another port places claims no seam here (above).
        if (a?.status === 'draft' && result.vendorPort.get(a.vendor)?.port !== doc.port) continue;
        const seam = typeof a?.vendor === 'string' ? cap.vendors?.[a.vendor]?.seam?.file : undefined;
        if (!seam) continue;
        if (ifaceFiles.has(seam)) {
          if (a.c8Seam) find(8, `${rel} adapter \`${a.id}\` declares a c8Seam divergence, but C-8's seam.file already IS this port's interface. Remove the stale waiver.`);
          continue;
        }
        if (a.c8Seam?.file === seam) {
          waivers.push(`${doc.port}/${a.id}: C-8 seam is ${seam}, not this port's interface — until ${a.c8Seam.until}`);
          continue;
        }
        find(8, `${rel} adapter \`${a.id}\`: vendor \`${a.vendor}\`'s C-8 seam.file is \`${seam}\` (${CAPABILITY_REGISTER}), but this port's interface is ${[...ifaceFiles].map((f) => `\`${f}\``).join(' / ')}. One seam per vendor; or declare the exact divergence as \`c8Seam\`.`);
      }
    }
  }

  // ── limb 9 · literals ──
  let house = null;
  try { house = JSON.parse(readFileSync(join(root, ENTITY_SOURCE), 'utf8')); } catch (e) {
    lost(9, `${ENTITY_SOURCE} could not be read (${e.message}); without the owner domain no address literal can be recognised.`);
  }
  const ownerDomain = house?.ownerDomain?.value;
  if (house && (typeof ownerDomain !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(ownerDomain))) {
    lost(9, `${ENTITY_SOURCE} \`ownerDomain.value\` is not a domain; the literal scan has nothing to match.`);
  } else if (house) {
    const scanned = tsFiles.filter((f) => !/\/src\/generated\//.test(f));
    if (!scanned.length) lost(9, 'the literal scan read no TypeScript module under services/*/src.');
    const re = new RegExp(`[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\\.)*${esc(ownerDomain)}(?![A-Za-z0-9.-])`, 'gi');
    for (const f of scanned) {
      const code = stripSourceComments(readFileSync(join(root, f), 'utf8'), '.ts');
      for (const m of code.matchAll(re)) {
        const line = code.slice(0, m.index).split('\n').length;
        find(9, `${f}:${line} carries an address on ${ownerDomain} as a literal. An address is an entity-source field (${ENTITY_SOURCE}), read from the Worker's src/generated/entity.ts.`);
      }
    }
    notes.push(`limb 9 scanned ${scanned.length} TS module(s) for an address on ${ownerDomain}`);
    const resolves = (path) => {
      let node = house;
      for (const k of path.split('.')) node = isObj(node) ? node[k] : undefined;
      const v = isObj(node) ? node.value : node;
      return typeof v === 'string' && v !== '';
    };
    let namesSender = false;
    for (const { rel, doc } of ports) {
      for (const [name, st] of Object.entries(isObj(doc?.streams) ? doc.streams : {})) {
        for (const k of ['from', 'to']) {
          if (typeof st?.[k] !== 'string') continue;
          namesSender = true;
          if (!resolves(st[k])) find(9, `${rel} stream \`${name}\` ${k} path \`${st[k]}\` resolves to no value in ${ENTITY_SOURCE}.`);
        }
      }
    }
    if (namesSender) {
      const r = renderEntityAt(root, { check: true });
      if (r.code === 1) find(9, r.msg);
      else if (r.code !== 0) lost(9, r.msg);
    }
  }
  // ── limb 10 · the client (Dart) half ──
  const clientPorts = ports.filter(({ doc }) => isObj(doc?.client));
  if (clientPorts.length) {
    const libFiles = [];
    for (const d of dartLibDirs(root)) walkDart(root, d, libFiles);
    if (!libFiles.length) lost(10, 'no Dart file was read under packages/*/lib or apps/*/lib, so "every seam implementation is a registered adapter" would hold of nothing.');
    const libSrc = new Map(libFiles.map((f) => [f, readStripped(root, f) ?? '']));
    for (const { rel, doc } of clientPorts) {
      const c = doc.client;
      const seams = new Map((c.seams ?? []).map((x) => [x.interface, x]));
      const dartSymbols = new Set(doc?.interface?.dart?.symbols ?? []);
      for (const name of seams.keys()) {
        if (!dartSymbols.has(name)) find(10, `${rel} client seam \`${name}\` is not a symbol of interface.dart; a client seam is one of the port's declared Dart interfaces.`);
      }
      const runnerOk = new Map();
      for (const [name, seam] of seams) {
        const src = readStripped(root, seam.suite.file);
        const ok = src !== null && declares(src, seam.suite.runner, '.dart');
        runnerOk.set(name, ok);
        if (!ok) find(10, `${rel} client seam \`${name}\`: the suite ${seam.suite.file} does not declare \`${seam.suite.runner}\`.`);
      }
      const pending = new Set((c.pending ?? []).map((p) => p.adapter));
      for (const p of c.pending ?? []) notes.push(`PENDING ${doc.port}/client/${p.adapter}: ${p.case} (${p.row}) — blocks L3 for that adapter`);
      const conformant = new Map([...seams.keys()].map((k) => [k, 0]));
      const registered = new Set();
      const ids = new Set();
      for (const a of c.adapters ?? []) {
        if (ids.has(a.id)) find(10, `${rel} client lists adapter \`${a.id}\` twice.`);
        ids.add(a.id);
        const seam = seams.get(a.seam);
        if (!seam) { find(10, `${rel} client adapter \`${a.id}\` implements \`${a.seam}\`, which is no client seam.`); continue; }
        const implSrc = readStripped(root, a.impl.file);
        if (implSrc === null) find(10, `${rel} client adapter \`${a.id}\` impl.file \`${a.impl.file}\` does not exist.`);
        else if (!declares(implSrc, a.impl.symbol, '.dart')) find(10, `${rel} client adapter \`${a.id}\` symbol \`${a.impl.symbol}\` is not declared in \`${a.impl.file}\`.`);
        registered.add(`${a.impl.file}#${a.impl.symbol}`);
        if (a.conformance === null) {
          if (typeof a.waits !== 'string') find(10, `${rel} client adapter \`${a.id}\` has no conformance test and says nothing about why; \`waits\` names it.`);
          else waivers.push(`${doc.port}/client/${a.id}: no conformance run — ${a.waits}`);
          continue;
        }
        const testSrc = readStripped(root, a.conformance.file);
        if (testSrc === null) { find(10, `${rel} client adapter \`${a.id}\` conformance file \`${a.conformance.file}\` does not exist.`); continue; }
        if (!callsRunner(testSrc, seam.suite.runner, '.dart')) {
          find(10, `${rel} client adapter \`${a.id}\`: \`${a.conformance.file}\` never CALLS \`${seam.suite.runner}\`. An import of the suite, or its name in a comment, runs nothing.`);
          continue;
        }
        if (runnerOk.get(a.seam) && !pending.has(a.id) && a.status !== 'draft' && a.status !== 'retired') conformant.set(a.seam, conformant.get(a.seam) + 1);
      }
      // Derived: every class under packages/*/lib that implements a client seam is registered.
      for (const name of seams.keys()) {
        let found = 0;
        const re = new RegExp(`\\bclass\\s+(\\w+)\\b[^{;]*?\\bimplements\\b([^{;]*)\\{`, 'g');
        for (const [f, src] of libSrc) {
          if (!f.startsWith('packages/')) continue;
          for (const m of src.matchAll(re)) {
            if (!new RegExp(`\\b${esc(name)}\\b`).test(m[2])) continue;
            found++;
            if (!registered.has(`${f}#${m[1]}`)) {
              find(10, `${rel}: \`${m[1]}\` (${f}) implements the client seam \`${name}\` and is no client adapter. Register it — with the conformance test that calls the runner — or it ships ungraded.`);
            }
          }
        }
        if (libFiles.length && found === 0) lost(10, `${rel}: no class under packages/*/lib implements the client seam \`${name}\`; the derivation has stopped finding its subject.`);
      }
      // The shared fakes ship in no app: no lib imports lib/testing.dart (or lib/testing/).
      const fakeLib = /^\s*(?:import|export)\s+'(?:package:nikatru_purchases\/testing(?:\.dart|\/[^']*)|(?:\.\.\/)+testing(?:\.dart|\/[^']*))'/m;
      for (const [f, src] of libSrc) {
        if (f === 'packages/purchases/lib/testing.dart' || f.startsWith('packages/purchases/lib/testing/')) continue;
        if (fakeLib.test(src)) find(10, `${f} imports the shared payment fakes (nikatru_purchases/testing.dart) from a lib/ file. They depend on flutter_test and promise nothing a real rail does; only tests may import them.`);
      }
      // The half's earned level, as limb 6 earns the port's.
      const claimed = c.level?.claimed ?? 0;
      const target = c.level?.target ?? 0;
      const why = [];
      let earned = 0;
      if (symOk.get(doc.port) && doc?.interface?.dart) earned = 1;
      else why.push('interface.dart is not declared where the registry says');
      const real = (c.adapters ?? []).filter((a) => a.status !== 'fake' && a.status !== 'retired' && a.status !== 'draft');
      const selected = doc?.selection && (doc.selection.source !== null || doc.selection.default?.live || doc.selection.default?.sandbox);
      if (earned === 1) {
        if (!selected) why.push('no selection');
        else if (!real.length) why.push('no built, non-fake client adapter');
        else earned = 2;
      }
      if (earned === 2) {
        const short = [...conformant].filter(([, n]) => n < 2);
        if (short.length) why.push(`${short.map(([k, n]) => `${k}: ${n} conformant adapter(s)`).join(', ')}; L3 needs two per seam with zero pending`);
        if (!doc?.switch?.runbook) why.push('no switch runbook');
        if (!existsSync(join(root, 'tooling/ops/port-switch.mjs'))) why.push('no dry-run tool');
        if (!why.length) earned = 3;
      }
      result.table.push({ port: `${doc.port}/client`, claimed, earned, target, why: earned < target ? why[0] ?? '' : '' });
      if (claimed > earned) find(6, `${rel} client claims L${claimed} and earns L${earned}: ${why[0] ?? 'see above'}.`);
      if (claimed > target) find(6, `${rel} client claims L${claimed} above its target L${target}.`);
      notes.push(`limb 10: ${doc.port}/client — ${[...conformant].map(([k, n]) => `${k} ${n} conformant`).join(', ')}; ${libFiles.length} Dart lib file(s) scanned`);
    }
  }
  // a per-channel adapter's `channel` is a register row, and a candidate is not one yet
  const channelAdapters = ports.flatMap(({ rel, doc }) => (doc?.adapters ?? []).filter((a) => typeof a?.channel === 'string').map((a) => ({ rel, a })));
  const candidates = ports.flatMap(({ rel, doc }) => (doc?.candidates ?? []).map((c) => ({ rel, port: doc.port, c })));
  if (channelAdapters.length || candidates.length) {
    let rows = null;
    try {
      const ch = JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8'));
      rows = new Set((ch?.channels ?? []).map((c) => c?.id).filter((x) => typeof x === 'string'));
    } catch (e) {
      lost(8, `${CHANNEL_REGISTER} could not be read (${e.message}); no adapter's \`channel\` can be resolved.`);
    }
    if (rows) {
      if (rows.size === 0) lost(8, `${CHANNEL_REGISTER} carries no channel row, so every \`channel\` would resolve to nothing.`);
      const named = new Map();
      for (const { rel, a } of channelAdapters) {
        if (rows.size && !rows.has(a.channel)) find(8, `${rel} adapter \`${a.id}\` names channel \`${a.channel}\`, which is no ${CHANNEL_REGISTER} row.`);
        named.set(a.channel, [...(named.get(a.channel) ?? []), `${rel}/${a.id}`]);
      }
      for (const [c, at] of named) if (at.length > 1) find(8, `channel \`${c}\` is named by ${at.length} adapters (${at.join(', ')}); one channel, one adapter.`);
      for (const { rel, port, c } of candidates) {
        if (rows.has(c.id)) find(8, `${rel} candidate \`${c.id}\` already has a ${CHANNEL_REGISTER} row: it is an adapter now, not a candidate.`);
        else if (named.has(c.id)) find(8, `${rel} candidate \`${c.id}\` is also an adapter's channel.`);
        else notes.push(`CANDIDATE ${port}/${c.id} (${c.name}): not submittable — ${c.deferral?.source ?? 'no source'}; commission ${c.commission?.cell ? `${c.commission.cell} read ${c.commission.asOf}` : 'UNREAD'}`);
      }
    }
  }
  // ── limb 11 · the monitor API: no ops script calls GlitchTip's monitor routes itself ──
  {
    const adapterSrc = readStripped(root, MONITOR_API_ADAPTER);
    if (adapterSrc === null) lost(11, `${MONITOR_API_ADAPTER} does not exist, so "every ops script reaches the monitor API through ${MONITOR_API_DIR}/" holds of nothing.`);
    else if (!directMonitorCalls(adapterSrc)) lost(11, `the matcher finds no monitor call in ${MONITOR_API_ADAPTER}, the one module that makes them; the matcher has broken.`);
    else {
      const files = [];
      walkMjs(root, 'tooling/ops', files);
      const declared = new Map(MONITOR_API_EXCEPTIONS.map((e) => [e.file, e]));
      let scanned = 0;
      for (const f of files) {
        if (f.startsWith(`${MONITOR_API_DIR}/`)) continue;
        const code = readStripped(root, f);
        if (code === null) continue;
        scanned++;
        const n = directMonitorCalls(code);
        const ex = declared.get(f);
        if (ex) {
          if (n) waivers.push(`monitor-api: ${f} reaches the monitor API with its own request code — ${ex.why} — until ${ex.until}`);
          else find(11, `${f} is a declared monitor-API exception and makes no monitor call any more. Remove its MONITOR_API_EXCEPTIONS row.`);
          continue;
        }
        if (n) find(11, `${f} calls GlitchTip's monitor API directly (${n} fetch call(s)). Reach it through ${MONITOR_API_DIR}/index.mjs (listMonitors, api), so the monitor vendor stays one adapter.`);
      }
      notes.push(`limb 11 scanned ${scanned} ops script(s) outside ${MONITOR_API_DIR}/`);
    }
  }
  return result;
}

/**
 * The `fetch(` calls in comment-stripped `code` that reach the monitor API on
 * their own: a call whose URL names a monitor route, or — in a file that names
 * one anywhere — a call to GlitchTip's `/api/0/` that composes the route
 * elsewhere. Matches CALLS (vacuous-10/11), never a mention in prose.
 */
export function directMonitorCalls(code) {
  const calls = [...code.matchAll(/(?<![\w.])fetch\s*\(/g)].map((m) => code.slice(m.index, m.index + 240));
  const named = calls.filter((c) => MONITOR_ROUTE.test(c.split(/,\s*\{/)[0]));
  if (named.length) return named.length;
  return MONITOR_ROUTE.test(code) ? calls.filter((c) => /\/api\/0\//.test(c.split(/,\s*\{/)[0])).length : 0;
}

function walkMjs(root, relDir, out) {
  let entries;
  try { entries = listDir(join(root, relDir), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = posix.join(relDir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'test') walkMjs(root, rel, out); }
    else if (/\.m?js$/.test(e.name)) out.push(rel);
  }
}

/** One printable line per vendor for C-8: its port and earned level, or why it has none. */
export function portLineFor(result, vendor) {
  const many = result.vendorPorts?.get(vendor) ?? [];
  const p = result.vendorPort.get(vendor);
  if (many.length > 1 || (p && result.nonPort.get(vendor)?.remaining)) {
    const rest = result.nonPort.get(vendor);
    const lines = many.map((x) => `${x.port} (adapter ${x.adapter}, earned L${x.earned})`).join('; ');
    return `port: ${lines}${rest?.remaining ? ` — the rest (${rest.remaining.join(', ')}) none yet, until ${rest.until}` : ''}`;
  }
  if (p) return `port: ${p.port} (adapter ${p.adapter}, earned L${p.earned})`;
  const n = result.nonPort.get(vendor);
  if (n) return n.nonPort ? 'port: none — deliberately not ported' : `port: none yet — until ${n.until}`;
  return 'port: UNPLACED (assert-ports limb 8)';
}

function main() {
  const root = resolve(process.argv[2] ?? process.cwd());
  const r = evaluate(root);
  const findings = r.findings;
  const allLost = findings.length > 0 && findings.every((f) => f.lost);
  const deciding = findings.find((f) => (allLost ? f.lost : !f.lost));
  if (deciding) {
    console.error(`assert-ports: ${allLost ? 'COVERAGE LOST' : 'FAILED'} — limb ${deciding.limb} (${LIMB_NAMES[deciding.limb]}): ${deciding.msg.replace(/^COVERAGE LOST — /, '')}`);
  } else {
    console.log(`assert-ports: ok — all ${Object.keys(LIMB_NAMES).length} limbs green over ${r.ports.length} port(s)`);
  }
  if (r.table.length) {
    console.log('\nport             claimed  earned  target');
    for (const t of r.table) console.log(`${t.port.padEnd(16)} L${t.claimed}       L${t.earned}      L${t.target}${t.why ? `   (below target: ${t.why})` : ''}`);
  }
  if (r.waivers.length) {
    console.log(`\n⬜ ${r.waivers.length} declared waiver(s), printed on every run:`);
    for (const w of r.waivers) console.log(`  ${w}`);
  }
  for (const n of r.notes) console.log(`  ${n}`);
  if (findings.length) {
    console.error('');
    for (const f of findings) console.error(`FAIL limb ${f.limb} (${LIMB_NAMES[f.limb]}) ${f.msg}`);
    console.error('\nassert-ports: FAILED');
    const problems = findings.map((f) => f.msg); // a COVERAGE LOST message starts with the marker
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1); // 2 = could not look; 1 = a finding
  }
}

const IS_MAIN = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) main();
