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
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
