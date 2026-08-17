#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-stamp-text-fidelity.mjs — what the owner typed is what the app ships,
// the app ships under ITS OWN NAME, and a blank optional var is DERIVED rather
// than interpolated as nothing.
//
// Four defects, one lane, because they are all the same failure: a stamp that
// produces syntactically valid, analyzable, green output carrying the WRONG
// TEXT. Nothing downstream can catch that — `flutter analyze` has no opinion on
// whether the OS window title says "Traveler&#x27;s Guide".
//
// ── 1 · MASON HTML-ESCAPES EVERY DOUBLE STACHE ──────────────────────────────
// mason 0.1.2 renders with mustache_template's `htmlEscapeValues` left at its
// default of TRUE, and that escape map covers & < > " ' AND '/'. So
// `{{display_name}}` in a Dart string, an ARB message, a PWA manifest or a
// pubspec stamps `Probe&#x27;s &amp; Co — 24&#x2F;7 Smoke` — into files that are
// read as TEXT and never as HTML. Every gate stayed green: it compiles, it
// analyzes, it formats, and the corruption is only visible to a human looking at
// the task switcher or the store listing. Names containing `&`, `'` or `/` are
// not exotic ("Fit & Fast", "24/7 Tracker", any possessive).
//
// `web/index.html` is the ONE place the escaping is right, so it is excluded by
// name rather than by accident — there the value really is HTML.
//
// ── 2 · "EMPTY MEANS DERIVE" WAS DOCUMENTED, NEVER IMPLEMENTED ──────────────
// `pre_gen` blesses a blank `subdomain`/`api_domain` ("or empty to derive") and
// `brick.yaml` defaults both to "". Derivation existed only in `post_gen`, for
// the apps.json row and the printed checklist — the TEMPLATES interpolated the
// raw var, so the documented-normal input stamped `"ALLOWED_ORIGINS": "https://"`
// into the app's own Worker and `_phApiBase = 'https://'` into its config. An
// allowlist of `https://` matches no origin on earth, and `cors.ts` cannot even
// fall back from it because "https://" is not empty. Silent at analyze, at
// build, at deploy — it surfaces as a browser CORS failure with no server-side
// error.
//
// ── 3 · EVERY STAMPED APP REPORTED THE SAME RELEASE ID ──────────────────────
// `main.dart` handed the telemetry chassis a hard-coded literal naming the CI
// throwaway probe and a frozen 0.1.0. A literal survives stamping unchanged, so
// all fifty apps would report ONE identity into the ONE shared GlitchTip
// project: the moment app #2 crashed there would be nothing in the event saying
// whose crash it was. Invisible from inside any single app — it compiles, it
// reports, it is simply signed with somebody else's name. So the release is
// RESOLVED here through the stamped constants and required to be
// `<this app's id>@<something that moves between builds>`.
//
// ── 4 · A HYPHEN IN A DISPLAY NAME TRUNCATED THE CATALOGUE ENTRY ────────────
// `post_gen`'s short-name split used `RegExp(r'[—-]')` — inside a character
// class a trailing `-` is a LITERAL hyphen — so "E-Book Reader" was published to
// the public catalogue as "E". The split is meant to drop a subtitle after a
// dash SURROUNDED BY WHITESPACE ("Lingo — Offline Phrasebook" → "Lingo"); the
// whitespace is the whole signal. Checked against the catalogue row the stamp
// actually wrote, not against the hook's source.
//
// 🔴 ORDERING IS LOAD-BEARING for check 4: `ci.yml` reverts
// catalog/apps.json after each variant to keep the tree clean, so
// this guard must run BEFORE that revert. It exits COVERAGE LOST rather than
// passing when the row is absent, which is what makes the ordering enforce
// itself instead of living in a comment.
//
// 🔴 THE ASSERTION IS ONLY WORTH ITS RUNTIME IF THE PROBE CAN TRIGGER IT.
// Both probe vars files used to hold escape-free names and explicit non-blank
// hosts, so this lane could never have caught either defect no matter how many
// checks it ran. So the FIXTURE is audited first: the vars file must carry a
// character from mason's escape set, must leave a derivable var blank, and must
// name the app with a hyphen inside a word. Any one missing ⇒ COVERAGE LOST,
// not "ok".
//
// Everything is compared against PARSED STRUCTURE — JSON.parse, JSONC parse, the
// Dart literal decoded through its own escape rules — never a grep for prose. A
// grep for `&amp;` in a template would match the comment explaining escaping.
//
// Usage:
//   node tooling/ci/assert-stamp-text-fidelity.mjs --vars <probe-vars.json>
//                                                  [--service services/<id>-api]
//                                                  [repoRoot]
// Exit 0 = the stamp is faithful, 1 = corrupted text, a borrowed release id, a
// truncated catalogue name, a missing derivation, or a probe that cannot detect
// any of them.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { listDir } from './tree-walk.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const varsPath = flag('--vars');
const servicePath = flag('--service');
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const ROOT = resolve(positional[0] ?? process.cwd());

if (!varsPath) {
  console.error('usage: assert-stamp-text-fidelity.mjs --vars <probe-vars.json> [--service <dir>] [root]');
  process.exit(1);
}

const problems = [];
const ok = (m) => console.log(`  ok  ${m}`);
const fail = (m) => problems.push(m);
/** Coverage loss is FATAL and immediate: everything after it would report on a
 *  scan that cannot fail, which is worse than no check at all. */
const lost = (m) => {
  console.error(`✗ COVERAGE LOST — ${m}`);
  process.exit(1);
};

// ── mason's escape set, from mustache_template's renderer ────────────────────
// & < > " ' /  →  &amp; &lt; &gt; &quot; &#x27; &#x2F;
const ESCAPABLE = /[&<>"'/]/;
const ENTITY = /&(?:amp|quot|lt|gt|#x27|#x2F|#39|#x3C|#x3E);/;

// ── the fixture must be able to trigger both checks ──────────────────────────
const varsAbs = resolve(ROOT, varsPath);
if (!existsSync(varsAbs)) lost(`the probe vars file ${varsPath} does not exist, so nothing was checked.`);
let vars;
try {
  vars = JSON.parse(readFileSync(varsAbs, 'utf8'));
} catch (e) {
  lost(`${varsPath} is not parseable JSON (${e.message}); the probe spec cannot be read.`);
}

const appId = String(vars.app_id ?? '');
const displayName = String(vars.display_name ?? '').trim();
const description = String(vars.description ?? '').trim();
const needsBackend = vars.needs_backend === true;

if (!appId) lost(`${varsPath} names no app_id.`);
if (!ESCAPABLE.test(displayName)) {
  lost(
    `${varsPath} display_name ("${displayName}") contains none of & < > " ' / — the six characters ` +
      'mason HTML-escapes. This lane would report "ok" against a brick that escapes every one of ' +
      'them, which is exactly how the defect shipped. Put one in the probe.',
  );
}
if (!ESCAPABLE.test(description)) {
  lost(
    `${varsPath} description ("${description}") contains none of & < > " ' / — see display_name above.`,
  );
}
// The derive path is the one `pre_gen` steers users onto, and it is the one that
// had never been stamped. A probe that passes explicit values for BOTH optional
// hosts exercises only the path that already worked.
const blankSub = String(vars.subdomain ?? '') === '';
const blankApi = String(vars.api_domain ?? '') === '';
if (!blankSub && !blankApi) {
  lost(
    `${varsPath} passes explicit values for BOTH subdomain and api_domain, so the "empty means ` +
      'derive" path — the documented-normal input — is never stamped and this check cannot fail.',
  );
}
// ── the catalogue split: the separator is WHITESPACE-DELIMITED ───────────────
// "<name> <dash> <tagline>" is what the split drops the tail of. A hyphen INSIDE
// a word is not a separator, and that distinction is the entire defect — so the
// probe's name must carry an intra-word hyphen in the part that has to SURVIVE,
// or this check passes against a brick that truncates at the first hyphen.
const SEPARATOR = /\s+[—–-]\s+/;
const sepAt = SEPARATOR.exec(displayName);
const leadingSegment = (sepAt ? displayName.slice(0, sepAt.index) : displayName).trim();
if (!/\S-\S/.test(leadingSegment)) {
  lost(
    `${varsPath} display_name ("${displayName}") carries no hyphen inside a word before its subtitle ` +
      `separator — the surviving part is "${leadingSegment}". A probe named without one cannot tell a ` +
      'separator from a hyphen, which is exactly how "E-Book Reader" reached the public catalogue as "E".',
  );
}
ok(`probe spec can trigger every check (escape set present; ${blankSub ? 'subdomain' : 'api_domain'} left blank to derive; "${leadingSegment}" holds an intra-word hyphen)`);

const appDir = join(ROOT, 'apps', appId);
if (!existsSync(appDir)) lost(`apps/${appId} was not stamped, so there is no output to check.`);

// ── 1 · the text arrives verbatim ────────────────────────────────────────────
const readIf = (rel) => {
  const p = join(appDir, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

/** Decode a Dart SINGLE-quoted string literal body back to its text. */
const unDart = (body) => body.replace(/\\([\\$'])/g, '$1');

const config = readIf(join('lib', 'core', 'app_config.dart'));
if (config === null) {
  fail(`apps/${appId}/lib/core/app_config.dart is missing.`);
} else {
  const m = config.match(/static const String appName = '((?:[^'\\]|\\.)*)';/);
  if (!m) {
    fail(`apps/${appId}/lib/core/app_config.dart declares no \`appName\` string literal this guard can read.`);
  } else if (unDart(m[1]) !== displayName) {
    fail(`appName is "${unDart(m[1])}" but the spec says "${displayName}".`);
  } else {
    ok('app_config.dart appName is the display name, verbatim');
  }
}

const jsonAt = (rel) => {
  const raw = readIf(rel);
  if (raw === null) return { missing: true };
  try {
    return { value: JSON.parse(raw) };
  } catch (e) {
    return { error: e.message };
  }
};

for (const arb of ['app_en.arb', 'app_ta.arb']) {
  const rel = join('lib', 'l10n', arb);
  const r = jsonAt(rel);
  if (r.missing) fail(`apps/${appId}/lib/l10n/${arb} is missing.`);
  else if (r.error) fail(`apps/${appId}/lib/l10n/${arb} is not valid JSON: ${r.error}`);
  else if (r.value.appTitle !== displayName) {
    fail(`${arb} appTitle is "${r.value.appTitle}" but the spec says "${displayName}".`);
  } else ok(`${arb} appTitle is the display name, verbatim`);
}

const manifest = jsonAt(join('web', 'manifest.json'));
if (manifest.missing) fail(`apps/${appId}/web/manifest.json is missing.`);
else if (manifest.error) fail(`apps/${appId}/web/manifest.json is not valid JSON: ${manifest.error}`);
else {
  for (const [key, expected] of [
    ['name', displayName],
    ['short_name', displayName],
    ['description', description],
  ]) {
    if (manifest.value[key] !== expected) {
      fail(`manifest.json ${key} is "${manifest.value[key]}" but the spec says "${expected}".`);
    }
  }
  if (!problems.length || !problems.some((p) => p.startsWith('manifest.json'))) {
    ok('manifest.json name/short_name/description are the spec, verbatim (the PWA install name)');
  }
}

// pubspec `description:` is a YAML double-quoted scalar, whose escapes are a
// superset of JSON's — so JSON.parse decodes it correctly.
const pubspec = readIf('pubspec.yaml');
if (pubspec === null) fail(`apps/${appId}/pubspec.yaml is missing.`);
else {
  const line = pubspec.split('\n').find((l) => l.startsWith('description:'));
  if (!line) fail(`apps/${appId}/pubspec.yaml has no \`description:\` line.`);
  else {
    let decoded = null;
    try {
      decoded = JSON.parse(line.slice('description:'.length).trim());
    } catch {
      fail(`apps/${appId}/pubspec.yaml description is not a parseable quoted scalar: ${line.trim()}`);
    }
    if (decoded !== null && !decoded.startsWith(displayName)) {
      fail(`pubspec description starts "${decoded.slice(0, 40)}…" but the spec says "${displayName}".`);
    } else if (decoded !== null) ok('pubspec.yaml description opens with the display name, verbatim');
  }
}

const readme = readIf('README.md');
if (readme === null) fail(`apps/${appId}/README.md is missing.`);
else if (readme.split('\n')[0].trim() !== `# ${displayName}`) {
  fail(`README.md heading is "${readme.split('\n')[0].trim()}" but the spec says "# ${displayName}".`);
} else ok('README.md heading is the display name, verbatim');

// ── the class, not the instances: NO entity anywhere but index.html ─────────
const TEXTY = /\.(?:dart|arb|json|jsonc|yaml|yml|md|ts|html|xml|plist|gradle|kts|cc|cpp|h|rc|swift|properties)$/;
const SKIP_DIR = new Set(['build', '.dart_tool', 'node_modules', '.git', '.wrangler']);
/** index.html is HTML: `&#x27;` renders as an apostrophe there and a raw `"`
 *  would end an attribute early, so the double stache is CORRECT in that file
 *  and only in that file. Excluded by name so the exception stays visible. */
const HTML_OK = new Set(['index.html']);

const scanRoots = [appDir];
if (servicePath) scanRoots.push(resolve(ROOT, servicePath));

const escaped = [];
let scanned = 0;
const walk = (dir) => {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(join(dir, e.name));
      continue;
    }
    if (!TEXTY.test(e.name) || HTML_OK.has(e.name)) continue;
    const p = join(dir, e.name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.size > 512 * 1024) continue;
    scanned++;
    const text = readFileSync(p, 'utf8');
    for (const [i, line] of text.split('\n').entries()) {
      if (ENTITY.test(line)) escaped.push(`${relative(ROOT, p).split(sep).join('/')}:${i + 1}: ${line.trim()}`);
    }
  }
};
for (const r of scanRoots) walk(r);

const MIN_SCANNED = 20;
if (scanned < MIN_SCANNED) {
  lost(
    `scanned only ${scanned} text file(s) of the stamped tree, expected at least ${MIN_SCANNED}. ` +
      'An entity scan over nothing prints "ok" forever.',
  );
}
if (escaped.length) {
  fail(
    `${escaped.length} HTML entity/entities in the stamped output, outside web/index.html:\n` +
      escaped.slice(0, 12).map((l) => `      ${l}`).join('\n') +
      '\n      Triple-stache the var ({{{name}}}) and escape it for the destination language ' +
      'in hooks/pre_gen.dart. mason escapes & < > " \' / on every DOUBLE stache.',
  );
} else {
  ok(`no HTML entity in ${scanned} stamped text file(s) (web/index.html excepted, where it is correct)`);
}

// ── 2 · a blank optional var was DERIVED, not interpolated as nothing ────────
const expectedSub = `${appId}.nikatru.com`;
const expectedApiHost = `api-${appId}.nikatru.com`;
const expectedBase = needsBackend ? `https://${expectedApiHost}` : 'https://platform.nikatru.com/v1';
/** The shape the defect produced: a scheme with no authority. */
const EMPTY_URL = /^https?:\/\/\s*$/;

for (const rel of [join('config', 'defaults.json'), join('config', 'defaults.example.json')]) {
  const r = jsonAt(rel);
  const name = rel.split(sep).join('/');
  if (r.missing) fail(`apps/${appId}/${name} is missing.`);
  else if (r.error) fail(`apps/${appId}/${name} is not valid JSON: ${r.error}`);
  else if (EMPTY_URL.test(String(r.value.api_base_url ?? ''))) {
    fail(`${name} api_base_url is "${r.value.api_base_url}" — a scheme with no host. The blank var was interpolated, not derived.`);
  } else if (r.value.api_base_url !== expectedBase) {
    fail(`${name} api_base_url is "${r.value.api_base_url}", expected the derived "${expectedBase}".`);
  } else ok(`${name} api_base_url derived to ${expectedBase}`);
}

if (config !== null) {
  const m = config.match(/static const String _phApiBase = '([^']*)';/);
  if (!m) fail(`apps/${appId}/lib/core/app_config.dart declares no \`_phApiBase\` literal this guard can read.`);
  else if (EMPTY_URL.test(m[1])) fail(`_phApiBase is "${m[1]}" — a scheme with no host.`);
  else if (m[1] !== expectedBase) fail(`_phApiBase is "${m[1]}", expected the derived "${expectedBase}".`);
  else ok(`_phApiBase derived to ${expectedBase}`);
}

if (servicePath) {
  const wrangler = resolve(ROOT, servicePath, 'wrangler.jsonc');
  if (!existsSync(wrangler)) {
    fail(`${servicePath}/wrangler.jsonc is missing, so the stamped Worker's allowlist cannot be checked.`);
  } else {
    let cfg = null;
    try {
      cfg = parseJsonc(readFileSync(wrangler, 'utf8'));
    } catch (e) {
      fail(`${servicePath}/wrangler.jsonc is not parseable JSONC: ${e.message}`);
    }
    if (cfg) {
      const origins = String(cfg.vars?.ALLOWED_ORIGINS ?? '');
      const want = `https://${vars.subdomain || expectedSub}`;
      if (EMPTY_URL.test(origins)) {
        fail(
          `ALLOWED_ORIGINS is "${origins}" — a scheme with no host. The app's own Worker would reject its ` +
            'own web origin, and cors.ts cannot fall back because "https://" is not empty. Silent CORS failure.',
        );
      } else if (origins !== want) {
        fail(`ALLOWED_ORIGINS is "${origins}", expected the derived "${want}".`);
      } else ok(`ALLOWED_ORIGINS derived to ${want}`);
    }
  }
}

// ── 3 · the crash reports are signed with THIS app's name ────────────────────
// Resolved through the stamped constants rather than pattern-matched, so the
// check is about the VALUE that reaches GlitchTip and not about one spelling of
// the expression that produces it.

/** Marks a value that comes from a --dart-define, i.e. one that MOVES between
 *  builds. A release whose version half cannot move cannot separate two
 *  releases of the same app, which is half of what a release id is for. */
const DERIVED = '\u0000APP_VERSION\u0000';
const show = (s) => s.replaceAll(DERIVED, '<APP_VERSION>');

/** `static const String x = <expr>;` → Map(name → expr). Stops at the first `;`,
 *  which is the declaration terminator for every form used here. */
function dartStringConsts(src) {
  const out = new Map();
  for (const m of src.matchAll(/static\s+const\s+String\s+(\w+)\s*=\s*([\s\S]*?);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** Evaluate a Dart const string expression to its text, with [DERIVED] standing
 *  in for anything read from the environment. Returns null when the expression
 *  is something this guard was never taught — which is reported, never ignored. */
function evalDartString(expr, consts, seen = new Set()) {
  const e = String(expr).trim();
  if (/^String\.fromEnvironment\b/.test(e)) return DERIVED;
  const ref = /^(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)$/.exec(e);
  if (ref) {
    const name = ref[1];
    if (seen.has(name) || !consts.has(name)) return null;
    return evalDartString(consts.get(name), consts, new Set([...seen, name]));
  }
  const lit = /^'((?:[^'\\]|\\.)*)'$/.exec(e) ?? /^"((?:[^"\\]|\\.)*)"$/.exec(e);
  if (!lit) return null;
  const body = lit[1];
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      out += body[i + 1] ?? '';
      i++;
      continue;
    }
    if (body[i] === '$') {
      const rest = body.slice(i);
      const m = /^\$\{([^}]+)\}/.exec(rest) ?? /^\$([A-Za-z_]\w*)/.exec(rest);
      if (!m) return null;
      const sub = evalDartString(m[1], consts, new Set(seen));
      if (sub === null) return null;
      out += sub;
      i += m[0].length - 1;
      continue;
    }
    out += body[i];
  }
  return out;
}

/** The value passed to `<ctor>(… <arg>: HERE …)`. Brackets are balanced and
 *  string literals + `//` comments are skipped, so a comma or a paren inside
 *  either cannot split an argument. */
function namedArg(src, ctor, arg) {
  const at = src.indexOf(`${ctor}(`);
  if (at === -1) return null;
  let i = at + ctor.length + 1;
  let depth = 1;
  let cur = '';
  const parts = [];
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      cur += src[i++];
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') cur += src[i++];
        cur += src[i++];
      }
      cur += src[i++] ?? '';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
    } else if (c === ',' && depth === 1) {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  parts.push(cur);
  for (const p of parts) {
    const m = /^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]+?)\s*$/.exec(p);
    if (m && m[1] === arg) return m[2];
  }
  return null;
}

const mainDart = readIf(join('lib', 'main.dart'));
if (mainDart === null) {
  lost(`apps/${appId}/lib/main.dart is missing, so the telemetry release cannot be checked.`);
}
const releaseExpr = namedArg(mainDart, 'TelemetryConfig', 'release');
if (releaseExpr === null) {
  lost(
    `apps/${appId}/lib/main.dart passes no \`release:\` to TelemetryConfig that this guard can read. ` +
      'Every crash the app reports is grouped by that value; a scan that cannot find it reports "ok" forever.',
  );
}
{
  const consts = config === null ? new Map() : dartStringConsts(config);
  const resolved = evalDartString(releaseExpr, consts);
  if (resolved === null) {
    fail(
      `the telemetry release \`${releaseExpr}\` could not be resolved from apps/${appId}/lib/core/app_config.dart. ` +
        'Teach this guard the new spelling in the same change — an unreadable release is an unchecked one.',
    );
  } else if (!resolved.includes('@')) {
    fail(
      `the telemetry release resolves to "${show(resolved)}", which has no \`<app_id>@<version>\` shape. ` +
        'GlitchTip groups by this string; without an id half, fifty apps share one bucket.',
    );
  } else {
    const at = resolved.indexOf('@');
    const idHalf = resolved.slice(0, at);
    const versionHalf = resolved.slice(at + 1);
    if (idHalf !== appId) {
      fail(
        `the telemetry release resolves to "${show(resolved)}" — it names "${idHalf}", but this app is ` +
          `"${appId}". Every crash from this app would triage as that one, and nothing inside the app ` +
          'can show it: the report is delivered successfully, under somebody else\'s name.',
      );
    } else if (!versionHalf.includes(DERIVED)) {
      fail(
        `the telemetry release resolves to "${show(resolved)}" — its version half "${versionHalf}" is a ` +
          'frozen literal, so every release of this app reports the same string and no regression can be ' +
          'pinned to a build. Compose it from the APP_VERSION define.',
      );
    } else {
      ok(`telemetry release is this app's own identity (${show(resolved)})`);
    }
  }
}

// ── 4 · the public catalogue got the app's NAME, not a fragment of it ────────
const catalogPath = join(ROOT, 'catalog', 'apps.json');
if (!existsSync(catalogPath)) {
  lost(`catalog/apps.json is missing, so the catalogue entry the stamp wrote cannot be checked.`);
}
let catalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
} catch (e) {
  lost(`catalog/apps.json is not parseable JSON (${e.message}).`);
}
const row = Array.isArray(catalog) ? catalog.find((r) => r && r.slug === appId) : null;
if (!row) {
  lost(
    `catalog/apps.json holds no row for "${appId}". post_gen appends it on every stamp, so ` +
      'either the SHOW-1 append broke or this guard ran AFTER the lane reverted the catalogue — check ' +
      "ci.yml's step order. Either way nothing about the published name was checked.",
  );
}
{
  const published = String(row.name ?? '');
  if (published === '') {
    fail(`apps.json row for "${appId}" publishes an empty name.`);
  } else if (published === leadingSegment) {
    ok(`apps.json publishes "${published}" — the display name up to its subtitle separator, whole`);
  } else if (displayName.startsWith(published) && published.length < leadingSegment.length) {
    fail(
      `apps.json publishes "${published}" but the app is called "${leadingSegment}" — the name was cut ` +
        `mid-word at "${displayName.slice(published.length, published.length + 1)}". The short-name split ` +
        'must fire on a dash SURROUNDED BY WHITESPACE; a hyphen inside a word is part of the name.',
    );
  } else {
    fail(
      `apps.json publishes "${published}" but the display name "${displayName}" reduces to "${leadingSegment}" ` +
        '(everything before the first whitespace-delimited dash).',
    );
  }
}

/** JSONC → object. Comments stripped OUTSIDE string literals, so a `//` inside a
 *  URL survives. Same shape as assert-clone-contract.mjs, kept local so this
 *  guard has no dependency that could be edited out from under it. */
function parseJsonc(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const two = raw.slice(i, i + 2);
    if (two === '//') {
      while (i < raw.length && raw[i] !== '\n') i++;
    } else if (two === '/*') {
      const end = raw.indexOf('*/', i + 2);
      i = end === -1 ? raw.length : end + 2;
    } else if (raw[i] === '"') {
      out += raw[i++];
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\') out += raw[i++];
        out += raw[i++];
      }
      if (i < raw.length) out += raw[i++];
    } else {
      out += raw[i++];
    }
  }
  return JSON.parse(out);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`\nassert-stamp-text-fidelity: FAILED (${problems.length} problem(s)) for apps/${appId}`);
  process.exit(1);
}
console.log(
  `\nassert-stamp-text-fidelity: ok — apps/${appId} ships the spec's text, reports under its own release id, ` +
    'publishes its whole name and derived every blank host',
);
