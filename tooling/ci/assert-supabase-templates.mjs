#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-supabase-templates.mjs — the auth email templates must stay RESTORABLE.
//
// 🔴 WHY THIS EXISTS — it is a post-incident guard, 2026-08-04.
// A one-field `PATCH /v1/projects/{ref}/config/auth` against Supabase REPLACES
// the auth config instead of merging it. Changing only `smtp_admin_email`
// emptied `smtp_host`/`port`/`user`/`pass`/`sender_name`, reset the send rate
// limit 100 → 2, and reverted ALL THREE branded email templates to Supabase
// defaults. Auth mail was briefly back on the built-in mailer.
//
// 📌 THOSE FEW MINUTES ARE THE ONLY TIME IT EVER WAS. This project runs on custom
// SMTP — `smtp_host smtp.resend.com`, sender `auth@mail.nikatru.com` — and has for
// as long as anyone can date. Seven repo documents claimed otherwise and one
// audit turned that agreement into a false 🔴🔴 store blocker; the record now
// lives in tooling/mail-transport.json and ADR 029, guarded by
// assert-mail-transport-claims.mjs.
//
// It recovered byte-for-byte ONLY because `docs/platform/supabase/email-templates/`
// happened to hold copies matching the live bodies exactly. Nothing required
// that. Nothing noticed they were load-bearing. **Luck was standing in for a
// backup**, and the next person to touch that endpoint would not have had it.
//
// So: these files are DISASTER RECOVERY MATERIAL, not documentation, and this
// guard is what says so in a way CI can enforce.
//
// ⚠️ WHAT THIS GUARD CANNOT DO, stated plainly so nobody mistakes green for safe:
// it CANNOT detect DRIFT between these files and the live Supabase project —
// that needs `SUPABASE_PAT`, which CI does not hold. It catches the files being
// deleted, gutted, or stripped of the one thing that makes the mail actionable.
// For drift, run `node tooling/ops/verify-supabase-templates.mjs` with the PAT.
//
// 🔬 NO INVENTED SIZE FLOOR. The obvious check — "each file must be ≥ N bytes" —
// is exactly the sin `assert-store-metadata.mjs` refuses: a made-up threshold
// fires on CORRECT input while looking authoritative, and a stub padded with
// whitespace passes it anyway. These assert STRUCTURE instead: a template with
// no `{{ .ConfirmationURL }}` is functionally dead however long it is, because
// the recipient has nothing to click.
//
// Usage:  node tooling/ci/assert-supabase-templates.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// ⚠️ NOT `readdirSync`. `assert-walks-bounded.mjs` rejected the first version of
// this guard for importing it directly, and it was right: a raw listing descends
// into a nested checkout — a git worktree, a submodule, a stray clone — and reads
// another repository's files as this tree's. That is green in CI, which creates no
// worktrees, and red on the one machine actually looking at it. `listDir` is the
// single place that knows which entries belong to the tree under test.
import { listDir } from './tree-walk.mjs';
// The ONE list of the three templates — file, hosted field, self-hosted GoTrue
// variable, served URL and subject key. The generator that writes the served
// copies, this guard, the live verifier and the switch preflight all read it, so
// "which templates exist" cannot be typed twice and disagree.
import { AUTH_MAIL_SERVED_DIR, AUTH_MAIL_TEMPLATES, genAuthMail } from '../sites/gen-auth-mail.mjs';

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
const DIR = join(repoRoot, 'docs', 'platform', 'supabase', 'email-templates');
const README = join(repoRoot, 'docs', 'platform', 'supabase', 'README.md');
const TRANSPORT = join(repoRoot, 'tooling', 'mail-transport.json');
const HEADERS = join(repoRoot, 'sites', 'nikatru', '_headers');

// Each DR file and the live Supabase field it restores. The mapping is the point:
// a file nobody can map to a field is not a recovery artefact, it is a document.
// Derived from AUTH_MAIL_TEMPLATES (confirm-signup → confirmation, magic-link →
// magic_link, reset-password → recovery) rather than re-typed here.
const REQUIRED = Object.fromEntries(AUTH_MAIL_TEMPLATES.map((t) => [t.file, t.hostedField]));

const problems = [];
const prints = [];
// Inputs this run could not read. Reported LAST and exit 2 only when there is no
// finding — a finding (exit 1) is never hidden behind a could-not-look.
const lost = [];

if (!existsSync(DIR)) {
  console.error(`COVERAGE LOST: ${DIR} does not exist.`);
  console.error('  These files are the only recovery path for the live auth email templates.');
  console.error('  If they moved, re-point this guard. Do not delete it.');
  coverageLost();
}

const present = listDir(DIR).filter((f) => f.endsWith('.html')).sort();

// COVERAGE LOST, not "pass": a guard that evaluates nothing must never be green.
if (present.length === 0) {
  console.error(`COVERAGE LOST: no .html templates found in ${DIR}.`);
  coverageLost();
}

let checked = 0;

for (const [file, field] of Object.entries(REQUIRED)) {
  const path = join(DIR, file);
  if (!existsSync(path)) {
    problems.push(`MISSING: ${file} — restores \`${field}\`. Without it that template cannot be recovered.`);
    continue;
  }
  const body = readFileSync(path, 'utf8');
  checked += 1;

  // The action link. A confirm/reset/magic-link mail without it is dead on
  // arrival — the recipient literally cannot complete the flow.
  if (!/\{\{\s*\.ConfirmationURL\s*\}\}/.test(body)) {
    problems.push(`${file}: no {{ .ConfirmationURL }}. The recipient would have nothing to click.`);
  }

  // The branding these files exist to preserve. Losing it is precisely what the
  // 2026-08-04 wipe did — the live templates reverted to Supabase defaults.
  if (!/Nikatru/i.test(body)) {
    problems.push(`${file}: no "Nikatru" branding — this is what the incident reverted. A default template is not a restore.`);
  }

  // README states these are inline-CSS with no remote images (email-client safety
  // + no tracking-pixel surface). A remote <img> regresses both.
  const remoteImg = body.match(/<img[^>]+src\s*=\s*["']https?:/i);
  if (remoteImg) {
    problems.push(`${file}: remote image src — templates are declared image-free (client safety + no pixel surface).`);
  }
}

// ── ONE PROJECT SIGNS A USER INTO EVERY APP, SO ITS MAIL NAMES THE HOUSE ─────
// O-MAIL-TEMPLATES-NAME-ONE-APP, 2026-09-24. These three bodies belong to ONE
// Supabase project, and that project authenticates every app in catalog/apps.json.
// Until this limb they said "Nikatru Subscription Tracker" at six sites, so the
// second app to ship would have mailed its users in the first app's name. The
// branding check above could not see it, because that app's name CONTAINS "Nikatru".
//
// So each catalog name is refused here, in full and with its leading "Nikatru "
// cut off, case-insensitively, in every template body and in every recorded
// subject (`supabaseAuth.subjects` in tooling/mail-transport.json): the subject
// line is part of the same shared mail. The names are read from the catalog at run
// time; a test adds a second app to a fixture catalog and expects its name to be
// refused.
//
// A catalog this limb cannot read, or one with no named app, is COVERAGE LOST:
// with no name to refuse, it would pass a template that names one app. So is a
// register whose `supabaseAuth.subjects` is missing, not an object or holds no
// string, because then no subject was read. Those register stops go on `lost`, like
// the subjects check below: a finding beside them still exits 1.
const CATALOG_REL = 'catalog/apps.json';
const REGISTER_REL = 'tooling/mail-transport.json';
const ONE_APP = 'the shared templates name the house, not one app (O-MAIL-TEMPLATES-NAME-ONE-APP)';

const appNames = readAppNames(join(repoRoot, 'catalog', 'apps.json'));
const subjects = readRecordedSubjects(TRANSPORT);
const nameMatchers = appNames.map((name) => ({ name, re: appNamePattern(name) }));
let scannedForNames = 0;

for (const file of Object.keys(REQUIRED)) {
  const path = join(DIR, file);
  if (!existsSync(path)) continue; // reported as MISSING by the loop above
  scannedForNames += 1;
  for (const { name, line } of appNameHits(readFileSync(path, 'utf8'), nameMatchers)) {
    problems.push(`docs/platform/supabase/email-templates/${file}:${line} — "${name}" — ${ONE_APP}`);
  }
}
for (const { where, value } of subjects) {
  for (const { name } of appNameHits(value, nameMatchers)) {
    problems.push(`${where} — "${name}" — ${ONE_APP}`);
  }
}

prints.push(`${appNames.length} ${CATALOG_REL} name(s) refused in ${scannedForNames} template(s) and in ${subjects.length} recorded subject(s) (\`supabaseAuth.subjects\`) of ${REGISTER_REL}`);

// The restore procedure must be findable. A backup nobody can find is not a backup.
if (!existsSync(README)) {
  problems.push('docs/platform/supabase/README.md missing — the restore procedure has no home.');
} else {
  const readme = readFileSync(README, 'utf8');
  if (!/config\/auth/.test(readme)) {
    problems.push('README does not name the `config/auth` endpoint — the restore path is undocumented.');
  }
  // ⚠️ `[\w*]+`, not `\w+` — and the mutation run is why. The README documents the
  // field FAMILY as `mailer_templates_*_content`, a glob. A `\w+` pattern rejects
  // the literal asterisk, so the very first baseline run failed on the REAL tree:
  // the guard was wrong, not the repository. A guard that fails on correct input
  // gets disabled by whoever hits it next, which is how a check stops checking.
  if (!/mailer_templates_[\w*]+_content/.test(readme)) {
    problems.push('README does not name the `mailer_templates_*_content` fields these files restore.');
  }
}

// A guard that checked nothing is a guard that cannot fail.
if (checked === 0) {
  console.error('COVERAGE LOST: zero templates were evaluated.');
  coverageLost();
}

// ── THE SERVED COPIES (self-hosted GoTrue fetches these) ─────────────────────
// Self-hosted GoTrue has no template-body field: it FETCHES each body from a
// URL, and those URLs point at sites/nikatru/auth-mail/. If the served bytes
// drift from the DR source, hosted and self-hosted send different mail from
// "the same" template. Byte-exact, CR included — `gen-auth-mail.mjs --check` is
// the one comparison, so the guard and the generator cannot disagree about
// what "equal" means. Only when every source exists: a missing source is
// already a MISSING finding above, and comparing against nothing proves nothing.
let servedEqual = 0;
if (checked === Object.keys(REQUIRED).length) {
  const g = genAuthMail(repoRoot, { check: true });
  if (g.code === 0) {
    servedEqual = AUTH_MAIL_TEMPLATES.length;
  } else {
    for (const l of g.lines.filter((x) => x.startsWith('✗ '))) {
      problems.push(`SERVED DRIFT: ${l.slice(2)}. Run \`node tooling/sites/gen-auth-mail.mjs\` and commit the output.`);
    }
    if (!g.lines.some((x) => x.startsWith('✗ '))) problems.push(`SERVED: ${g.lines.join(' ')}`);
  }
}

// The served bodies are FRAGMENTS with no <head>, so they cannot carry a robots
// meta. The noindex has to come from the host: the `/auth-mail/*` block in
// sites/nikatru/_headers. check-site-integrity leaves these paths out of the
// canonical/sitemap checks ON THAT PREMISE — so the premise is asserted here.
if (!existsSync(HEADERS)) {
  problems.push('sites/nikatru/_headers missing — nothing sends X-Robots-Tag: noindex for /auth-mail/*.');
} else if (!headersNoindex(readFileSync(HEADERS, 'utf8'), '/auth-mail/*')) {
  problems.push(
    'sites/nikatru/_headers has no `/auth-mail/*` block with `X-Robots-Tag: noindex` — the served mail bodies ' +
      'would be indexable, and check-site-integrity skips them only because this block exists.',
  );
}

// ── THE SUBJECTS (self-hosted GoTrue takes them from its env, not a URL) ─────
// tooling/mail-transport.json `supabaseAuth.subjects` is the record the switch
// preflight compares the self-hosted env with. Exactly the three keys, each a
// non-empty string: an empty subject is what GoTrue falls back to its default on.
const wantKeys = AUTH_MAIL_TEMPLATES.map((t) => t.subjectKey).sort();
let subjectsOk = false;
if (!existsSync(TRANSPORT)) {
  lost.push('tooling/mail-transport.json does not exist — the subjects record cannot be read.');
} else {
  let transport = null;
  try {
    transport = JSON.parse(readFileSync(TRANSPORT, 'utf8'));
  } catch (e) {
    problems.push(`tooling/mail-transport.json does not parse: ${e.message}`);
  }
  if (transport) {
    const subjects = transport?.supabaseAuth?.subjects;
    if (!subjects || typeof subjects !== 'object' || Array.isArray(subjects)) {
      problems.push(`SUBJECTS: tooling/mail-transport.json has no supabaseAuth.subjects object (want keys ${wantKeys.join(', ')}).`);
    } else {
      const have = Object.keys(subjects).sort();
      const extra = have.filter((k) => !wantKeys.includes(k));
      const absent = wantKeys.filter((k) => !have.includes(k));
      const empty = wantKeys.filter((k) => have.includes(k) && (typeof subjects[k] !== 'string' || subjects[k].trim() === ''));
      if (absent.length) problems.push(`SUBJECTS: supabaseAuth.subjects is missing ${absent.join(', ')}.`);
      if (extra.length) problems.push(`SUBJECTS: supabaseAuth.subjects has unknown key(s) ${extra.join(', ')} — no template sends them.`);
      if (empty.length) problems.push(`SUBJECTS: supabaseAuth.subjects has an empty or non-string value for ${empty.join(', ')}.`);
      subjectsOk = !absent.length && !extra.length && !empty.length;
    }
  }
}

prints.push(`checked ${checked}/${Object.keys(REQUIRED).length} DR templates in docs/platform/supabase/email-templates/`);
prints.push(`served copies ${servedEqual}/${AUTH_MAIL_TEMPLATES.length} byte-equal to their source in ${AUTH_MAIL_SERVED_DIR}/`);
prints.push(`subjects ${subjectsOk ? wantKeys.length : 0}/${wantKeys.length} present and non-empty in tooling/mail-transport.json`);
prints.push('DRIFT vs live Supabase is NOT checked here (needs SUPABASE_PAT) — run tooling/ops/verify-supabase-templates.mjs');

if (problems.length) {
  console.error('assert-supabase-templates: FAIL');
  for (const p of problems) console.error(`  ✗ ${p}`);
  for (const l of lost) console.error(`  ? COVERAGE LOST: ${l}`);
  console.error('');
  console.error('  These files are the recovery path for the live Supabase auth templates.');
  console.error('  On 2026-08-04 a one-field PATCH wiped the live ones; only these restored them.');
  process.exit(1);
}

if (lost.length) {
  console.error(`COVERAGE LOST: ${lost[0]}`);
  for (const l of lost.slice(1)) console.error(`  ? ${l}`);
  coverageLost();
}

console.log('assert-supabase-templates: OK');
for (const p of prints) console.log(`  · ${p}`);

/** Does a Cloudflare Pages `_headers` text give `path` an `X-Robots-Tag: noindex`?
 *  A block is a path line at column 0 followed by indented `Name: value` lines. */
function headersNoindex(text, path) {
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      inBlock = raw.trim() === path;
      continue;
    }
    if (inBlock && /^\s+X-Robots-Tag:\s*noindex\b/i.test(raw)) return true;
  }
  return false;
}

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-supabase-templates.mjs:NNN`
 *  citation above keeps pointing at the line it names. The one-app limb's catalog reader below
 *  hands it its reason as `lines`, which it prints before exiting. */
function coverageLost(...lines) {
  for (const line of lines) console.error(line);
  process.exit(2);
}

// The one-app limb's readers. Declared after `coverageLost` for the same reason: an
// edit here moves no line above.

/** Every app `name` in catalog/apps.json, a top-level array. Exits 2 when it cannot say. */
function readAppNames(path) {
  const why = '  The one-app limb has no name to refuse, so it would pass a template that names one app.';
  if (!existsSync(path)) coverageLost(`COVERAGE LOST: ${CATALOG_REL} does not exist.`, why);
  let apps;
  try {
    apps = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    coverageLost(`COVERAGE LOST: ${CATALOG_REL} is unparseable (${e.message}).`, why);
  }
  if (!Array.isArray(apps) || apps.length === 0) {
    coverageLost(`COVERAGE LOST: ${CATALOG_REL} lists no app: expected a non-empty top-level array.`, why);
  }
  return apps.map((app, i) => {
    const name = typeof app?.name === 'string' ? app.name.trim() : '';
    if (!name) coverageLost(`COVERAGE LOST: ${CATALOG_REL} entry ${i} has no \`name\`, so that app's name would not be refused.`, why);
    return name;
  });
}

/** Each string in `supabaseAuth.subjects`, with the line its key sits on inside that block.
 *  A register it cannot read pushes its reason to `lost` and returns no subject: the run then
 *  exits 2 through `coverageLost`, or 1 when a finding sits beside it (the subjects check
 *  below reports the same register as a finding when it parses without the three subjects). */
function readRecordedSubjects(path) {
  const why = 'so the one-app limb checked no recorded subject for an app name';
  if (!existsSync(path)) {
    lost.push(`${REGISTER_REL} does not exist, ${why}.`);
    return [];
  }
  const text = readFileSync(path, 'utf8');
  let subjects;
  try {
    subjects = JSON.parse(text)?.supabaseAuth?.subjects;
  } catch (e) {
    lost.push(`${REGISTER_REL} is unparseable (${e.message}), ${why}.`);
    return [];
  }
  if (!subjects || typeof subjects !== 'object' || Array.isArray(subjects)) {
    lost.push(`${REGISTER_REL} has no \`supabaseAuth.subjects\` object, ${why}.`);
    return [];
  }
  const recorded = Object.entries(subjects).filter(([, value]) => typeof value === 'string');
  if (recorded.length === 0) {
    lost.push(`${REGISTER_REL} \`supabaseAuth.subjects\` holds no string value, ${why}.`);
    return [];
  }
  const lines = text.split('\n');
  const auth = lines.findIndex((l) => l.includes('"supabaseAuth"'));
  const block = lines.findIndex((l, i) => i > auth && /^\s*"subjects"\s*:/.test(l));
  return recorded.map(([key, value]) => {
    const keyLine = new RegExp(`^\\s*"${escapeRegExp(key)}"\\s*:`);
    const at = block < 0 ? -1 : lines.findIndex((l, i) => i > block && keyLine.test(l));
    return { where: at >= 0 ? `${REGISTER_REL}:${at + 1}` : `${REGISTER_REL} supabaseAuth.subjects.${key}`, value };
  });
}

/** One case-insensitive pattern for an app name: the name itself, and the name without its
 *  leading "Nikatru " (the house name alone stays allowed). Words may be split by any run of
 *  whitespace or a non-breaking space, and a match may not sit inside a longer word. */
function appNamePattern(name) {
  const forms = [name];
  const bare = name.replace(/^Nikatru\s+/i, '');
  if (bare && bare !== name) forms.push(bare);
  const form = (f) => f.split(/\s+/).map(escapeRegExp).join('(?:\\s|&nbsp;|&#160;)+');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.map(form).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Each (app name, 1-based line) that `text` names, once per line and app, in line order. */
function appNameHits(text, matchers) {
  const hits = [];
  for (const { name, re } of matchers) {
    const lines = new Set();
    for (const m of text.matchAll(re)) lines.add(text.slice(0, m.index).split('\n').length);
    for (const line of lines) hits.push({ name, line });
  }
  return hits.sort((a, b) => a.line - b.line);
}
