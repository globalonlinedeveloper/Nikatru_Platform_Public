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

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
const DIR = join(repoRoot, 'docs', 'platform', 'supabase', 'email-templates');
const README = join(repoRoot, 'docs', 'platform', 'supabase', 'README.md');

// Each DR file and the live Supabase field it restores. The mapping is the point:
// a file nobody can map to a field is not a recovery artefact, it is a document.
const REQUIRED = {
  'confirm-signup.html': 'mailer_templates_confirmation_content',
  'magic-link.html': 'mailer_templates_magic_link_content',
  'reset-password.html': 'mailer_templates_recovery_content',
};

const problems = [];
const prints = [];

if (!existsSync(DIR)) {
  console.error(`COVERAGE LOST: ${DIR} does not exist.`);
  console.error('  These files are the only recovery path for the live auth email templates.');
  console.error('  If they moved, re-point this guard. Do not delete it.');
  process.exit(1);
}

const present = listDir(DIR).filter((f) => f.endsWith('.html')).sort();

// COVERAGE LOST, not "pass": a guard that evaluates nothing must never be green.
if (present.length === 0) {
  console.error(`COVERAGE LOST: no .html templates found in ${DIR}.`);
  process.exit(1);
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
  process.exit(1);
}

prints.push(`checked ${checked}/${Object.keys(REQUIRED).length} DR templates in docs/platform/supabase/email-templates/`);
prints.push('DRIFT vs live Supabase is NOT checked here (needs SUPABASE_PAT) — run tooling/ops/verify-supabase-templates.mjs');

if (problems.length) {
  console.error('assert-supabase-templates: FAIL');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  console.error('  These files are the recovery path for the live Supabase auth templates.');
  console.error('  On 2026-08-04 a one-field PATCH wiped the live ones; only these restored them.');
  process.exit(1);
}

console.log('assert-supabase-templates: OK');
for (const p of prints) console.log(`  · ${p}`);
