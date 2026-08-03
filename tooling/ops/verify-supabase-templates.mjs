#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-supabase-templates.mjs — do the DR copies still match the LIVE project?
//
// The other half of assert-supabase-templates.mjs. That guard runs in CI and can
// only prove the recovery files exist and are structurally sound; it has no
// credential, so it cannot see DRIFT. This one can, and therefore cannot run in
// CI. Both halves are needed and neither is sufficient.
//
// 🔴 WHY IT EXISTS. On 2026-08-04 a one-field `PATCH /v1/projects/{ref}/config/auth`
// REPLACED the whole auth config and reverted all three branded templates to
// Supabase defaults. The restore worked byte-for-byte only because the files in
// docs/platform/supabase/email-templates/ still happened to match. Nobody had
// checked that in the two weeks since they were written. This is that check.
//
// Reads SUPABASE_PAT + SUPABASE_PROJECT_REF from the environment, or from
// .claude/secrets.env when run from the repo root. **Read-only — it never writes
// to Supabase.** Exits non-zero on drift so it can be scheduled.
//
// Usage:  node tooling/ops/verify-supabase-templates.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
const DIR = join(repoRoot, 'docs', 'platform', 'supabase', 'email-templates');

// file -> live field. Same mapping the CI guard enforces; keep them in step.
const MAP = {
  'confirm-signup.html': 'mailer_templates_confirmation_content',
  'magic-link.html': 'mailer_templates_magic_link_content',
  'reset-password.html': 'mailer_templates_recovery_content',
};

function fromVault(name) {
  const p = join(repoRoot, '.claude', 'secrets.env');
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const pat = process.env.SUPABASE_PAT || fromVault('SUPABASE_PAT');
const ref = process.env.SUPABASE_PROJECT_REF || fromVault('SUPABASE_PROJECT_REF');

if (!pat || !ref) {
  console.error('verify-supabase-templates: SKIPPED — no SUPABASE_PAT / SUPABASE_PROJECT_REF.');
  console.error('  This is a real gap, not a pass. Drift is UNKNOWN until this runs with credentials.');
  process.exit(2); // deliberately distinct from 0 (match) and 1 (drift)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${pat}` },
});
if (!res.ok) {
  console.error(`verify-supabase-templates: API ${res.status} — ${await res.text()}`);
  process.exit(1);
}
const live = await res.json();

const drift = [];
const ok = [];

for (const [file, field] of Object.entries(MAP)) {
  const path = join(DIR, file);
  if (!existsSync(path)) { drift.push(`${file}: MISSING from the repo — nothing to restore ${field} from.`); continue; }
  // Compare on normalised line endings and trailing whitespace only. CRLF/LF and a
  // trailing newline are storage artefacts, not content — treating them as drift
  // would cry wolf every time somebody opened the file on Windows.
  const norm = (s) => (s ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const repoBody = norm(readFileSync(path, 'utf8'));
  const liveBody = norm(live[field]);
  if (!liveBody) { drift.push(`${file}: live \`${field}\` is EMPTY — the project is on a Supabase default.`); continue; }
  if (repoBody === liveBody) ok.push(`${file} ≡ ${field} (${repoBody.length} chars)`);
  else drift.push(`${file}: DIFFERS from live \`${field}\` (repo ${repoBody.length} vs live ${liveBody.length} chars)`);
}

// The sender identity is part of what the incident wiped, so report it too.
console.log(`live sender : ${live.smtp_admin_email || '(unset)'} via ${live.smtp_host || '(no SMTP host)'}`);
console.log(`rate limit  : ${live.rate_limit_email_sent}   autoconfirm: ${live.mailer_autoconfirm}`);
if (!live.smtp_host) console.log('⚠️  no smtp_host — the project is on the BUILT-IN mailer, which only delivers to project team members.');
console.log('');

for (const o of ok) console.log(`  ✓ ${o}`);
if (drift.length) {
  console.error('\nverify-supabase-templates: DRIFT');
  for (const d of drift) console.error(`  ✗ ${d}`);
  console.error('\n  The repo copies are the recovery path. If live is correct, update the files.');
  console.error('  If live is wrong, restore it — and send the COMPLETE config, not one field.');
  process.exit(1);
}
console.log('\nverify-supabase-templates: IN SYNC — every DR copy matches live.');
