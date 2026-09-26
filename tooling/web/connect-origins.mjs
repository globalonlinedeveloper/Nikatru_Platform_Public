#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// connect-origins.mjs — the origins a web build calls, compared with the
// `connect-src` its own `_headers` serves, in BOTH directions, before the build.
//
// Row O-WEB-CSP-HAND-LIST-UNSMOKED, the derivation half. The launch smoke
// (tooling/smoke/smoke-web-artifact.mjs) already boots the built bundle under
// its `_headers` policy and fetches each `--connect` origin from the page. What
// it could not say is WHICH origins to probe: deploy-web passed three by hand,
// and `connect-src` itself was a hand list of hosts that nothing compared with
// what the build is configured to call. A host the build calls and the list
// omits is refused by the browser at runtime — sign-in or an API call fails for
// every visitor, and no server log shows it. A host the list names and the build
// no longer calls is an allowance nobody is using.
//
// ── THE SET ─────────────────────────────────────────────────────────────────
// derived = D ∪ K ∪ X, and it must EQUAL `connect-src` minus `'self'`:
//   · D — the origin (scheme://host[:port]) of each URL-valued `--dart-define`
//     of the web build deploy-web.yml asks the composer for (URL_DEFINES). A
//     define composed as `$NAME` is read from the job's environment; one composed
//     as a value (API_BASE_URL, the app's rule) is the value the build compiles.
//     The GlitchTip DSN carries its public key before the `@`; only the origin is
//     ever kept or printed.
//   · K — the origins of the app_config.dart constants the app FETCHES from
//     (CONNECT_KEYS). A key this file names and app_config.dart no longer
//     declares is COVERAGE LOST (exit 2), never a silent pass.
//   · X — DECLARED below: an origin connect-src carries ahead of, or behind, the
//     build's own configuration, each with its kind, reason and retirement.
//
// ── EVERY https CONSTANT IS CLASSIFIED ──────────────────────────────────────
// A constant in app_config.dart whose value (followed through `defaultValue:`
// and identifier references) names an http(s) origin is one of: a CONNECT_KEYS
// constant (in K); a LINK_KEYS constant (navigated to, never fetched, so never
// in connect-src); a constant that reads one of URL_DEFINES (its origin is D's);
// or the `defaultValue:` fallback of such a constant. Anything else exits 1
// until it is added to CONNECT_KEYS or LINK_KEYS. The same rule holds for the
// web build's defines: each is in URL_DEFINES or VALUE_DEFINES.
//
// A derived origin whose host carries `YOUR_` is the app's placeholder fallback
// for an absent define, and exits 1: it means a define is empty.
//
// ── IT IMPORTS ONLY NODE BUILT-INS, AND ASKS THE COMPOSER ───────────────────
// It runs inside deploy-web, whose push trigger lists `tooling/web/**`. An
// import from tooling/ci/ (workflow-scan.mjs) would make a file outside that
// trigger part of what the lane runs, so it imports nothing from there.
// ⏱ 2026-09-26 (O-FLUTTER-BUILD-TYPED-PER-LINE): deploy-web types no
// `flutter build web` line any more; it calls tooling/ci/flutter-release-build.mjs.
// So this module finds that ONE call in deploy-web.yml, runs the composer's
// `--print` with the call's own app, target and channel, and reads the defines
// from what it prints. The composer is the one source of the defines, and no
// copy of them lives here. A call that is not the one shape it models, and a
// `--print` that fails or prints anything but one `flutter build web` line, are
// COVERAGE LOST (tooling/workflow-readers.json, `refuses-blind`). The test holds
// its define reading equal to workflow-scan.mjs's release-build census.
//
// ── WHAT IS PRINTED ─────────────────────────────────────────────────────────
// The define values are repository secrets. This prints ORIGINS and define
// NAMES only: never a value, a path, a key or a DSN's user part. A value that
// does not parse is reported by its name alone.
//
// Usage:  node tooling/web/connect-origins.mjs --app <app> [--check] [--emit-connect] [--root <dir>]
//   --check         the compare (the default mode); the report goes to stdout.
//   --emit-connect  after a passing compare, print `connect=--connect <origin> …`
//                   on stdout (deploy-web appends it to $GITHUB_OUTPUT for the
//                   launch smoke) and send the report to stderr.
// Exit 0 = connect-src equals the derived set. Exit 1 = a finding. Exit 2 =
// COVERAGE LOST: an input could not be read or modelled, so nothing was graded.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The composer deploy-web calls for its web build, relative to the repository. */
export const COMPOSER = 'tooling/ci/flutter-release-build.mjs';

/** The web build's defines whose value is a URL the app calls (D). */
export const URL_DEFINES = ['SUPABASE_URL', 'API_BASE_URL', 'GLITCHTIP_DSN'];

/** The web build's defines that carry no origin: a key, a version, a label. */
export const VALUE_DEFINES = ['SUPABASE_ANON_KEY', 'APP_VERSION', 'TURNSTILE_SITE_KEY', 'APP_ENV', 'RELEASE_CHANNEL'];

/** app_config.dart constants the app fetches from (K). Read at their call
 *  sites: platformBaseUrl — the analytics and consent transports and the
 *  platform REST client; configBaseUrl — the launch-time config fetch. */
export const CONNECT_KEYS = ['platformBaseUrl', 'configBaseUrl'];

/** app_config.dart constants that name an https origin and are only ever
 *  NAVIGATED to (openExternalUrl, the force-update button), never fetched. */
export const LINK_KEYS = ['companyUrl', 'updateUrl', 'privacyUrl', 'termsUrl', 'refundUrl', 'contactUrl'];

/**
 * X — origins connect-src carries that neither D nor K names today.
 *
 * `prestage`: added ahead of the configuration that will call it. It retires
 * itself: once D or K derives the same origin, the compare exits 1 until the
 * entry is deleted.
 *
 * `rollback`: kept after the configuration moved away, so a rollback of a
 * secret is not blocked by the app's own policy. None today. The Phase 5 switch
 * PR — the one that moves SUPABASE_URL to the self-hosted host — deletes the
 * auth-api `prestage` entry below and adds the hosted Supabase origin here as a
 * `rollback`; it stays until Phase 6 retires the hosted project, as the comment
 * above the Content-Security-Policy line in apps/subscriptiontracker/web/_headers
 * says. A `rollback` origin that D derives again is not a finding: that is the
 * rollback in effect. Until that PR lands, a deploy after the secret moves is
 * red here, before anything is built.
 */
export const DECLARED = [
  {
    origin: 'https://auth-api.nikatru.com',
    kind: 'prestage',
    reason:
      '#920 auth cutover prep: SUPABASE_URL moves here at Phase 5; a host missing from connect-src blocks every web sign-in with a CSP violation no server log shows',
    retire: 'when D derives it',
  },
];

const DECLARED_KINDS = ['prestage', 'rollback'];

/** An origin this module accepts: https, a plain host name, an optional port.
 *  Stricter than `new URL().origin`, which keeps `$(…)` and backticks in a host;
 *  the emitted origins reach a `run:` line in deploy-web. */
const HOST_ORIGIN = /^https:\/\/[a-z0-9._-]+(?::\d{1,5})?$/;
const isPlaceholder = (origin) => /your_/i.test(origin);

/** Thrown by a reader that could not model its input. The CLI turns it into
 *  exit 2; the pure check returns its lines as `lost`. */
export class CoverageLost extends Error {
  constructor(message) {
    super(message);
    this.name = 'CoverageLost';
  }
}

// ── the origin of a value ────────────────────────────────────────────────────

/** scheme://host[:port] of a URL, lower-cased, with any user part, path, query
 *  and fragment dropped — or null when it does not parse. */
export function originOf(value) {
  try {
    const u = new URL(String(value).trim());
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

// ── _headers ─────────────────────────────────────────────────────────────────

/**
 * The sources of the ONE `connect-src` directive `_headers` serves, in order.
 *
 * Comment lines are skipped (this file's own prose names `connect-src`), and
 * only an indented `Content-Security-Policy:` header line is read. Mustache
 * section tags (`{{#x}}`, `{{^x}}`, `{{/x}}`) are removed so the brick's copy
 * parses; a `{{{var}}}` inside a source is kept as written.
 */
export function connectSrcOf(headersText) {
  const csp = String(headersText)
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => /^\s+Content-Security-Policy:\s*(.*?)\s*$/i.exec(l))
    .filter(Boolean)
    .map((m) => m[1]);
  if (csp.length !== 1) {
    throw new CoverageLost(`_headers carries ${csp.length} Content-Security-Policy line(s); the compare models exactly one.`);
  }
  const policy = csp[0].replace(/\{\{[#^/][^}]*\}\}/g, '');
  const directive = policy
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find((tokens) => tokens[0].toLowerCase() === 'connect-src');
  if (!directive) throw new CoverageLost('the Content-Security-Policy line has no connect-src directive.');
  return directive.slice(1);
}

/** connect-src minus `'self'`, as origins. A source the compare cannot grade — a
 *  wildcard, a bare scheme, a path, a template variable — is COVERAGE LOST. */
export function listedOrigins(sources) {
  const out = [];
  for (const s of sources) {
    if (s.toLowerCase() === "'self'") continue;
    const o = HOST_ORIGIN.test(s.toLowerCase()) ? originOf(s) : null;
    if (o === null || o !== s.toLowerCase()) {
      throw new CoverageLost(`connect-src source \`${s}\` is not a bare https origin, so the compare cannot grade it.`);
    }
    out.push(o);
  }
  return out;
}

// ── deploy-web.yml, and the composer ─────────────────────────────────────────

/** `node [<dir>/]tooling/ci/flutter-release-build.mjs …`: group 1 is what follows the script. */
const COMPOSER_CALL = /(?:^|\s)node\s+(?:\S*\/)?tooling\/ci\/flutter-release-build\.mjs(?=\s|$)(.*)$/;
const MATRIX_APP = '${{matrix.app}}';
const unquote = (t) => t.replace(/^(['"])(.*)\1$/, '$2');

/**
 * deploy-web.yml's ONE composer call that builds web: `{ line, app, target,
 * channel, lane }`, `app` as written (`${{ matrix.app }}` with its spaces folded
 * out) and `lane` null when the call names none. A `--print` or `--emit-env` call
 * builds nothing and is not counted, and a word starting with `#` begins a shell
 * comment. Any count of calls but one, or a hand-typed `flutter build web` beside
 * it, is COVERAGE LOST: the compare would grade a build that is not the one shipped.
 */
export function composerWebCall(workflowText) {
  const calls = [];
  let typed = 0;
  String(workflowText)
    .split(/\r?\n/)
    .forEach((l, i) => {
      if (/^\s*#/.test(l)) return;
      const live = l.split(/(?:^|\s)#/)[0];
      if (/\bflutter\s+build\s+web\b/.test(live)) typed++;
      const m = COMPOSER_CALL.exec(live);
      if (m === null) return;
      const folded = m[1].replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_w, inner) => `\${{${inner.replace(/\s+/g, '')}}}`);
      const tokens = folded.trim().split(/\s+/).filter((t) => t !== '').map(unquote);
      if (tokens.includes('--print') || tokens.includes('--emit-env')) return;
      const laneAt = tokens.indexOf('--lane');
      const positional = tokens.filter((t, j) => !t.startsWith('--') && (laneAt === -1 || j !== laneAt + 1));
      if (positional[1] !== 'web') return;
      if (positional.length !== 3) {
        throw new CoverageLost(`the composer call at deploy-web.yml:${i + 1} names ${positional.length} of its three arguments <app> <target> <channel>.`);
      }
      calls.push({ line: i + 1, app: positional[0], target: positional[1], channel: positional[2], lane: laneAt === -1 ? null : tokens[laneAt + 1] ?? '' });
    });
  if (calls.length !== 1 || typed !== 0) {
    throw new CoverageLost(
      `deploy-web.yml has ${calls.length} composer web build call(s) and ${typed} hand-typed \`flutter build web\` line(s); the compare models exactly one composed build.`,
    );
  }
  return calls[0];
}

/**
 * The `--dart-define`s of the ONE `flutter build web` command the composer's
 * `--print` printed, name → the value as composed: `$NAME` for a value the
 * build step's environment supplies, else the value the build compiles.
 */
export function printedDefines(printedText) {
  const lines = String(printedText)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length !== 1 || !/^flutter\s+build\s+web(?:\s|$)/.test(lines[0].trim())) {
    throw new CoverageLost(`the composer's --print printed ${lines.length} line(s) and not one \`flutter build web\` command, so there are no defines to read.`);
  }
  const words = lines[0].trim().split(/\s+/);
  if (words.some((w) => w.startsWith('--dart-define-from-file'))) {
    throw new CoverageLost('the web build reads defines from a file, which this compare cannot see.');
  }
  const defines = new Map();
  for (let i = 0; i < words.length; i++) {
    const d = words[i] === '--dart-define' ? words[++i] ?? '' : words[i].startsWith('--dart-define=') ? words[i].slice('--dart-define='.length) : null;
    if (d === null) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(d);
    if (!m) throw new CoverageLost('the composed web build passes a --dart-define with no NAME=, which the compare cannot read.');
    defines.set(m[1], m[2]);
  }
  return defines;
}

/**
 * How the CLI asks: run `<root>/tooling/ci/flutter-release-build.mjs <app> <target>
 * <channel> [--lane …] --print --root <root>` and return what it printed. A
 * composer that cannot start, refuses or times out is COVERAGE LOST, naming its
 * own first line. `--print` reads no environment, so that line holds no value.
 */
export function composerPrint(root) {
  return ({ app, target, channel, lane }) => {
    const args = [app, target, channel, ...(lane === null ? [] : ['--lane', lane]), '--print'];
    const r = spawnSync(process.execPath, [join(root, COMPOSER), ...args, '--root', root], { encoding: 'utf8', timeout: 60000 });
    if (r.error || r.status !== 0) {
      const said = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const first = said.find((l) => /^(?:FAIL\b|\w*Error\b)/.test(l)) ?? said[0] ?? 'it printed nothing';
      const how = r.error ? `did not run (${r.error.code ?? r.error.message})` : `exited ${r.status ?? r.signal}`;
      throw new CoverageLost(`\`node ${COMPOSER} ${args.join(' ')}\` ${how}: ${first}`);
    }
    return r.stdout;
  };
}

/**
 * The web build's defines, read THROUGH THE COMPOSER: deploy-web.yml's one
 * composer web call, for `app`, asked for its `--print` with `compose(call)`.
 * @returns {{ line: number, defines: Map<string, string> }}
 */
export function composedBuildDefines(workflowText, app, compose) {
  const call = composerWebCall(workflowText);
  if (call.app !== MATRIX_APP && call.app !== app) {
    throw new CoverageLost(`the composer call at deploy-web.yml:${call.line} builds "${call.app}", which is neither \${{ matrix.app }} nor ${app}.`);
  }
  return { line: call.line, defines: printedDefines(compose({ ...call, app })) };
}

// ── app_config.dart ──────────────────────────────────────────────────────────

// Dart source with every line comment and every (nested) block comment removed,
// and every string literal kept intact — a URL's `//` is not a comment.
export function stripDartComments(src) {
  const s = String(src);
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('//', i)) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (s.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < s.length && depth > 0) {
        if (s.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (s.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      out += ' ';
      continue;
    }
    if (s[i] === "'" || s[i] === '"') {
      const q = s.startsWith(s[i].repeat(3), i) ? s[i].repeat(3) : s[i];
      const raw = i > 0 && s[i - 1] === 'r';
      let j = i + q.length;
      while (j < s.length && !s.startsWith(q, j)) {
        if (!raw && s[j] === '\\') j++;
        if (q.length === 1 && s[j] === '\n') break;
        j++;
      }
      j = Math.min(s.length, j + q.length);
      out += s.slice(i, j);
      i = j;
      continue;
    }
    out += s[i++];
  }
  return out;
}

const LITERAL = /^r?(['"])([^'"]*)\1$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const FROM_ENV = /^String\.fromEnvironment\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*(?:,\s*defaultValue:\s*([\s\S]*?))?\s*,?\s*\)$/;

/** Every `static const [String] NAME = …;` in app_config.dart, name → how its
 *  value is made: a literal, a `String.fromEnvironment` read (with its define
 *  and `defaultValue:` expression), or a reference to another constant. */
export function dartConstants(dartText) {
  const code = stripDartComments(dartText);
  const out = new Map();
  const decl = /\bstatic\s+const\s+(?:String\s+)?([A-Za-z_$][\w$]*)\s*=\s*((?:'[^'\n]*'|"[^"\n]*"|[^;'"])*);/g;
  for (const m of code.matchAll(decl)) {
    const init = m[2].trim();
    const env = FROM_ENV.exec(init);
    if (env) out.set(m[1], { name: m[1], define: env[2], fallback: env[3]?.trim() ?? null });
    else if (LITERAL.test(init)) out.set(m[1], { name: m[1], literal: LITERAL.exec(init)[2] });
    else if (IDENT.test(init)) out.set(m[1], { name: m[1], ref: init });
    else out.set(m[1], { name: m[1] });
  }
  return out;
}

/** The value a constant compiles to when no define is passed, followed through
 *  references and `defaultValue:` — or null when it is not a plain string. */
export function resolveConstant(constants, name, depth = 0) {
  const c = constants.get(name);
  if (!c || depth > 16) return null;
  if ('literal' in c) return c.literal;
  if ('ref' in c) return resolveConstant(constants, c.ref, depth + 1);
  if ('define' in c) {
    if (c.fallback === null) return '';
    const lit = LITERAL.exec(c.fallback);
    if (lit) return lit[2];
    return IDENT.test(c.fallback) ? resolveConstant(constants, c.fallback, depth + 1) : null;
  }
  return null;
}

// ── the compare ──────────────────────────────────────────────────────────────

/** A define the composer leaves to the build step's environment: exactly `$NAME`. */
const ENV_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * The whole check: texts, an environment and the composer in, a verdict out.
 * Pure but for `compose` (see composedBuildDefines; the CLI passes composerPrint).
 *
 * @returns {{ lost: string[], findings: string[], derived: Map<string, string[]>, listed: string[] }}
 *   `lost` non-empty means nothing was graded (exit 2); otherwise `findings`
 *   non-empty is exit 1. `derived` maps each origin to the names that derive it.
 */
export function checkConnectOrigins({
  headersText,
  dartText,
  workflowText,
  app,
  compose,
  env = {},
  urlDefines = URL_DEFINES,
  valueDefines = VALUE_DEFINES,
  connectKeys = CONNECT_KEYS,
  linkKeys = LINK_KEYS,
  declared = DECLARED,
}) {
  if (typeof compose !== 'function') throw new TypeError('checkConnectOrigins needs compose(call), the way to ask the composer for its --print.');
  const result = { lost: [], findings: [], derived: new Map(), listed: [] };
  let listed;
  let build;
  let constants;
  try {
    listed = listedOrigins(connectSrcOf(headersText));
    build = composedBuildDefines(workflowText, app, compose);
    constants = dartConstants(dartText);
  } catch (e) {
    if (!(e instanceof CoverageLost)) throw e;
    result.lost.push(e.message);
    return result;
  }
  result.listed = listed;
  const findings = result.findings;
  const derive = new Map();
  const add = (origin, from) => derive.set(origin, [...(derive.get(origin) ?? []), from]);

  // Every define the build passes is classified; every URL define is passed.
  for (const name of build.defines.keys()) {
    if (!urlDefines.includes(name) && !valueDefines.includes(name)) {
      findings.push(`unclassified define ${name} in the web build: add it to URL_DEFINES or VALUE_DEFINES in tooling/web/connect-origins.mjs`);
    }
  }
  for (const name of urlDefines) {
    const composed = build.defines.get(name);
    if (composed === undefined) {
      result.lost.push(`${name} is not passed by the web build the composer composes for deploy-web.yml:${build.line}: define renamed?`);
    } else if (composed.includes('$') && !ENV_REF.test(composed)) {
      result.lost.push(`${name} is composed as \`${composed}\`, neither one $NAME nor a value, so the compare cannot resolve it.`);
    }
  }

  // K, and the classification of every constant that names an origin.
  const urlBacked = [...constants.values()].filter((c) => urlDefines.includes(c.define));
  const fallbacks = new Set(urlBacked.map((c) => c.fallback).filter((f) => f && IDENT.test(f)));
  const fromKeys = [];
  for (const key of connectKeys) {
    if (!constants.has(key)) {
      result.lost.push(`CONNECT_KEYS names ${key}, and app_config.dart declares no such constant: key renamed?`);
      continue;
    }
    const origin = originOf(resolveConstant(constants, key) ?? '');
    if (origin === null) {
      result.lost.push(`CONNECT_KEYS names ${key}, and its value in app_config.dart is not a URL, so it derives no origin.`);
      continue;
    }
    fromKeys.push([origin, key]);
  }
  for (const c of constants.values()) {
    const value = resolveConstant(constants, c.name);
    if (!value || !/^https?:\/\//i.test(value)) continue;
    if (connectKeys.includes(c.name) || linkKeys.includes(c.name) || urlBacked.includes(c) || fallbacks.has(c.name)) continue;
    findings.push(`unclassified origin constant ${c.name} (${originOf(value) ?? 'unparsed'}) in app_config.dart: add it to CONNECT_KEYS or LINK_KEYS`);
  }
  if (result.lost.length) return result;

  // D: a `$NAME` from the job's environment, a composed value as composed.
  // Names and origins only, never a value.
  for (const name of urlDefines) {
    const ref = ENV_REF.exec(build.defines.get(name));
    const raw = (ref ? String(env[ref[1]] ?? '') : build.defines.get(name)).trim();
    if (raw === '') {
      const why = !ref ? 'is composed empty' : ref[1] === name ? 'has no value in this job' : `reads $${ref[1]}, which has no value in this job`;
      const backing = urlBacked.find((c) => c.define === name);
      const fallback = backing ? originOf(resolveConstant(constants, backing.name) ?? '') : null;
      findings.push(
        fallback
          ? `placeholder origin: a define is empty — ${name} ${why}, so the build would compile app_config.dart's fallback ${fallback}`
          : `a define is empty — ${name} ${why}, and app_config.dart gives it no fallback`,
      );
      continue;
    }
    const origin = originOf(raw);
    if (origin === null || !origin.startsWith('https://')) {
      findings.push(`${name} is not an https URL (its value is not printed)`);
      continue;
    }
    if (!HOST_ORIGIN.test(origin)) {
      findings.push(`${name} names a host that is not a plain DNS name (its origin is not printed)`);
      continue;
    }
    add(origin, name);
  }
  for (const [origin, key] of fromKeys) add(origin, key);

  for (const [origin, from] of derive) {
    if (isPlaceholder(origin)) findings.push(`placeholder origin: a define is empty — ${origin} (${from.join(', ')}) is app_config.dart's fallback`);
  }

  // X. A pre-stage that D or K now derives has done its job.
  declared.forEach((d, i) => {
    const origin = typeof d?.origin === 'string' ? d.origin : '';
    if (!HOST_ORIGIN.test(origin) || originOf(origin) !== origin || !DECLARED_KINDS.includes(d.kind) || !d.reason || !d.retire) {
      findings.push(`DECLARED entry #${i + 1} is malformed: it needs a bare https origin, a kind of ${DECLARED_KINDS.join(' or ')}, a reason and a retire condition`);
      return;
    }
    if (d.kind === 'prestage' && derive.has(origin)) {
      findings.push(`pre-stage is now derived: delete its DECLARED entry — ${origin} is derived from ${derive.get(origin).join(', ')}`);
    }
    add(origin, `DECLARED ${d.kind}`);
  });

  result.derived = derive;
  if (derive.size === 0) {
    result.lost.push('the derived set is empty, so an equal compare would prove nothing.');
    return result;
  }
  for (const origin of derive.keys()) {
    if (!listed.includes(origin)) findings.push(`missing from connect-src: ${origin} (${derive.get(origin).join(', ')}) — the browser would refuse it`);
  }
  for (const origin of listed) {
    if (!derive.has(origin)) {
      findings.push(`unused in connect-src: ${origin} — no URL define, CONNECT_KEYS constant or DECLARED entry names it`);
    }
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function lost(lines) {
  console.error(`FAIL COVERAGE LOST — connect-origins: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  process.exit(2);
}

function main(argv) {
  const known = new Set(['--app', '--root', '--check', '--emit-connect']);
  const unknown = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && !['--app', '--root'].includes(argv[i - 1]));
  const value = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  const app = value('--app');
  if (unknown.length || !app || !/^[a-z0-9_]+$/.test(app)) {
    lost([
      unknown.length ? `unrecognised argument(s): ${unknown.join(' ')}` : 'no --app <app id> given.',
      'Usage: node tooling/web/connect-origins.mjs --app <app> [--check] [--emit-connect] [--root <dir>]',
    ]);
  }
  const root = resolve(value('--root') ?? REPO);
  const emit = argv.includes('--emit-connect');
  const say = emit ? console.error : console.log;
  const rels = {
    workflowText: '.github/workflows/deploy-web.yml',
    headersText: `apps/${app}/web/_headers`,
    dartText: `apps/${app}/lib/core/app_config.dart`,
  };
  const texts = {};
  for (const [k, rel] of Object.entries(rels)) {
    try {
      texts[k] = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      lost([`${rel} could not be read (${e.code ?? e.message}), so there is nothing to compare.`]);
    }
  }
  const r = checkConnectOrigins({ ...texts, app, compose: composerPrint(root), env: process.env });
  if (r.lost.length) lost(r.lost);

  const count = (prefix) => [...r.derived.values()].filter((from) => from.some(prefix)).length;
  const d = count((f) => URL_DEFINES.includes(f));
  const k = count((f) => CONNECT_KEYS.includes(f));
  const x = count((f) => f.startsWith('DECLARED'));
  say(`connect-origins: apps/${app} — derived ${r.derived.size} origin(s) (defines ${d}, app_config ${k}, declared ${x}); ${rels.headersText} connect-src lists ${r.listed.length} besides 'self'`);
  for (const [origin, from] of r.derived) say(`     ${origin}  ← ${from.join(', ')}`);
  if (r.findings.length) {
    for (const f of r.findings) console.error(`FAIL connect-origins: ${f}`);
    process.exit(1);
  }
  say(`ok   connect-src equals the derived set in both directions (${r.derived.size} origin(s)), checked before the build`);
  if (emit) console.log(`connect=${[...r.derived.keys()].map((o) => `--connect ${o}`).join(' ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
