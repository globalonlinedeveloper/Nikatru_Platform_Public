#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-stamp-text-fidelity.mjs — what the owner typed is what the app ships,
// and a blank optional var is DERIVED rather than interpolated as nothing.
//
// Two defects, one lane, because both are the same failure: a stamp that
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
// 🔴 THE ASSERTION IS ONLY WORTH ITS RUNTIME IF THE PROBE CAN TRIGGER IT.
// Both probe vars files used to hold escape-free names and explicit non-blank
// hosts, so this lane could never have caught either defect no matter how many
// checks it ran. So the FIXTURE is audited first: the vars file must carry a
// character from mason's escape set, and must leave a derivable var blank.
// Neither condition holds ⇒ COVERAGE LOST, not "ok".
//
// Everything is compared against PARSED STRUCTURE — JSON.parse, JSONC parse, the
// Dart literal decoded through its own escape rules — never a grep for prose. A
// grep for `&amp;` in a template would match the comment explaining escaping.
//
// Usage:
//   node tooling/ci/assert-stamp-text-fidelity.mjs --vars <probe-vars.json>
//                                                  [--service services/<id>-api]
//                                                  [repoRoot]
// Exit 0 = the stamp is faithful, 1 = corrupted text, missing derivation, or a
// probe that cannot detect either.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

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
ok(`probe spec can trigger both checks (escape set present; ${blankSub ? 'subdomain' : 'api_domain'} left blank to derive)`);

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
    entries = readdirSync(dir, { withFileTypes: true });
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
console.log(`\nassert-stamp-text-fidelity: ok — apps/${appId} ships the spec's text and derived every blank host`);
