#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-supabase-templates.mjs — does the LIVE project still match what we recorded?
//
// The other half of assert-supabase-templates.mjs and of
// assert-mail-transport-claims.mjs. Those run in CI and can only prove the
// recovery files exist, are structurally sound, and are described consistently;
// they hold no credential, so they cannot see DRIFT. This one can, and therefore
// cannot run in CI. Both halves are needed and neither is sufficient.
//
// 🔴 WHY IT EXISTS. On 2026-08-04 a one-field `PATCH /v1/projects/{ref}/config/auth`
// REPLACED the whole auth config and reverted all three branded templates to
// Supabase defaults. The restore worked byte-for-byte only because the files in
// docs/platform/supabase/email-templates/ still happened to match. Nobody had
// checked that in the two weeks since they were written. This is that check.
//
// 🔴 AND IT CHECKS THE TRANSPORT, NOT ONLY THE TEMPLATES — added 2026-08-04 after
// a SECOND failure of the same class. Seven repo documents claimed this project
// was on the provider's own sender. It never was: `smtp_host` reads
// `smtp.resend.com` and has for as long as anyone can date. An audit agent turned
// those agreeing documents into a false 🔴🔴 store-submission blocker while the
// credential that settles it in one GET sat in the vault. So the transport is now
// a RECORD — tooling/mail-transport.json, the same file the CI guard parses — and
// this script compares that record against live. See ADR 029.
//
// ⚠️ THE EXPECTED VALUES ARE READ FROM THAT REGISTER, NEVER TYPED HERE. A checker
// that hardcodes what it expects has stopped checking the record and become a
// second copy of it — which is exactly the N-drifting-copies defect the register
// removes. assert-mail-transport-claims.mjs fails if this import goes away.
//
// Reads SUPABASE_PAT + SUPABASE_PROJECT_REF from the environment, or from
// .claude/secrets.env when run from the repo root. **Read-only — it never writes
// to Supabase.** Exit 0 = in sync · 1 = DRIFT (a readable config differs) ·
// 2 = UNKNOWN (no credential, or the live config could not be read).
//
// Usage:  node tooling/ops/verify-supabase-templates.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
const DIR = join(repoRoot, 'docs', 'platform', 'supabase', 'email-templates');
const REGISTER = join(repoRoot, 'tooling', 'mail-transport.json');

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

// The recorded transport. Its ABSENCE is a gap, not a pass: without it this
// script silently degrades to checking half of what it says it checks.
let expectedAuth = null;
if (existsSync(REGISTER)) {
  try {
    expectedAuth = JSON.parse(readFileSync(REGISTER, 'utf8')).supabaseAuth ?? null;
  } catch (e) {
    console.error(`verify-supabase-templates: tooling/mail-transport.json is unparseable (${e.message}).`);
    process.exit(1);
  }
}
if (!expectedAuth) {
  console.error('verify-supabase-templates: tooling/mail-transport.json has no `supabaseAuth` record.');
  console.error('  The transport comparison would range over nothing and this run would report only half');
  console.error('  of what it claims to check. Restore the register before trusting a green run.');
  process.exit(1);
}

const pat = process.env.SUPABASE_PAT || fromVault('SUPABASE_PAT');
const ref = process.env.SUPABASE_PROJECT_REF || fromVault('SUPABASE_PROJECT_REF');

if (!pat || !ref) {
  console.error('verify-supabase-templates: SKIPPED — no SUPABASE_PAT / SUPABASE_PROJECT_REF.');
  console.error('  This is a real gap, not a pass. Drift is UNKNOWN until this runs with credentials.');
  process.exit(2); // deliberately distinct from 0 (match) and 1 (drift)
}

// 🔴 A READ THAT FAILED IS UNKNOWN, NEVER DRIFT — exit 2, the code a missing
// credential already uses. Until 2026-09-11 any non-OK status exited 1, and
// ops-watch printed "Supabase auth config has DRIFTED" for run 34511747076,
// where the Management API had answered a 504 gateway time-out page and NOTHING
// had been compared. A thrown request, or a body that is not JSON, is the same case.
const unreadable = (why) => {
  console.error(`verify-supabase-templates: COULD NOT READ the live auth config — ${why}`);
  console.error('  Nothing was compared, so drift is UNKNOWN: a real gap, not a pass, and not drift.');
  process.exit(2);
};
let res;
try {
  res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
} catch (e) {
  unreadable(`the request failed (${e?.message ?? e}).`);
}
if (!res.ok) {
  const body = String(await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
  unreadable(`the Management API answered HTTP ${res.status}${body ? ` — ${body}` : ''}.`);
}
let live;
try {
  live = await res.json();
} catch (e) {
  unreadable(`the Management API answered HTTP ${res.status} with a body that is not JSON (${e?.message ?? e}).`);
}

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

// ── THE RECORDED AUTH CONFIG, compared field by field against live ──────────
// Every field the 2026-08-04 one-field PATCH emptied is here, because "the
// templates match" was green throughout an outage in which the SMTP block did
// not exist. Comparison is on the RECORDED keys, so adding one to the register
// starts checking it — there is no second list here to forget to update.
//
// 🔴 ⏱ 2026-09-16 — THE PARAGRAPH ABOVE WAS FALSE FOR AS LONG AS IT HAS EXISTED,
// AND IT IS LEFT STANDING BECAUSE IT DESCRIBES WHAT THIS CODE NOW DOES.
// What stood here was a hardcoded array:
//
//     const COMPARE = ['smtp_host', 'smtp_port', … 'mailer_autoconfirm'];
//     for (const field of COMPARE) { if (!hasOwnProperty(expectedAuth, field)) continue; … }
//
// — a SECOND LIST, in exactly the place the sentence promised there was none.
// Adding a field to the register did nothing at all: the loop walked the array,
// not the record, and the `continue` made the mismatch silent in the direction
// that matters. It was found while landing O-AUTH-PASSWORD-RESET-HARDENING,
// whose ten new fields would have sat in the register UNCHECKED FOREVER while
// Ops watch printed a green "the live auth config still matches what the repo
// recorded" over eight fields out of eighteen.
//
// So the derivation is now real: every key of `supabaseAuth` is a live field
// name and is compared, with exactly two exclusions, both of which have to say
// why out loud rather than sit in a list:
//   · `_`-prefixed keys are this register's own prose (`_why`, `_whyHardening`),
//     not fields — the same convention the rest of this file uses;
//   · `transport` is the register's VOCABULARY, not a Supabase field. Live has
//     no such key, so comparing it would report permanent drift against a word
//     we invented. assert-mail-transport-claims.mjs is what validates it.
// Anything else in the record that live does not carry is DRIFT, not a skip:
// that is how a typo'd field name gets caught instead of quietly checking eight
// things while claiming eighteen.
//
// `smtp_pass` is deliberately not comparable: the register carries no secret, so
// the most that can be said is whether live holds one at all. Said, not skipped.
// ⚠️ And do not be tempted to add it — measured 2026-09-16, `GET config/auth`
// answers a 64-character `smtp_pass` while the real credential is 36. The API
// does not give that value back, so nothing here can compare it and nothing
// anywhere should write it back.
const NOT_A_LIVE_FIELD = new Set(['transport']);
const COMPARE = Object.keys(expectedAuth).filter((k) => !k.startsWith('_') && !NOT_A_LIVE_FIELD.has(k));
let transportChecked = 0;
for (const field of COMPARE) {
  transportChecked += 1;
  const want = expectedAuth[field];
  const got = live[field];
  // A key the live config does not carry AT ALL is its own sentence. Folding it
  // into the value comparison below prints `live says null`, which reads as "the
  // setting is off" when what happened is that the register names a field this
  // API has never heard of — a typo, or a field that was renamed upstream.
  if (!Object.prototype.hasOwnProperty.call(live, field)) {
    drift.push(`auth \`${field}\`: the register records ${JSON.stringify(want)}, and the live config has NO SUCH FIELD. Either the name is wrong here or it was renamed upstream; nothing is being checked either way.`);
    continue;
  }
  // String-compare: the API returns smtp_port as a string and booleans as
  // booleans, and a JSON register cannot promise which it wrote.
  if (String(want) !== String(got)) {
    drift.push(`auth \`${field}\`: register says ${JSON.stringify(want)}, live says ${JSON.stringify(got ?? null)}.`);
  } else {
    ok.push(`${field} ≡ ${JSON.stringify(want)}`);
  }
}
if (transportChecked === 0) {
  drift.push('the register\'s `supabaseAuth` declared no comparable field at all, so NOTHING about the live auth config was checked. That is a gap, not a match.');
}
if (!live.smtp_pass) {
  drift.push('live `smtp_pass` is EMPTY — custom SMTP cannot authenticate, so auth mail falls back to the provider\'s own sender, which only delivers to project team members.');
}

console.log(`live sender : ${live.smtp_admin_email || '(unset)'} via ${live.smtp_host || '(no SMTP host)'}`);
console.log(`rate limit  : ${live.rate_limit_email_sent}   autoconfirm: ${live.mailer_autoconfirm}`);
console.log(`expected    : ${expectedAuth.transport} per tooling/mail-transport.json (${transportChecked} field(s) compared)`);
console.log('');

for (const o of ok) console.log(`  ✓ ${o}`);
if (drift.length) {
  console.error('\nverify-supabase-templates: DRIFT');
  for (const d of drift) console.error(`  ✗ ${d}`);
  console.error('\n  The repo copies are the recovery path. If live is correct, update the files and');
  console.error('  tooling/mail-transport.json in the same change — a record nobody corrects becomes the');
  console.error('  next stale document somebody escalates from.');
  console.error('  If live is wrong, restore it — and send the COMPLETE config, not one field.');
  process.exit(1);
}
console.log(`\nverify-supabase-templates: IN SYNC — every DR copy and ${transportChecked} transport field(s) match live.`);
