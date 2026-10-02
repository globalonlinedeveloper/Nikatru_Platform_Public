// ─────────────────────────────────────────────────────────────────────────────
// identity-address-sql.test.mjs — the trigger file the notices' network-address
// paragraph rests on (docs/platform/supabase/sql/identity-address-null-on-write.sql),
// APPLIED to a real PostgreSQL, not read as text.
//
// ⏱ 2026-10-02 · ruling on review 2 of #1140, item 1: MFA stays on, so the MFA
// challenge address is kept while the challenge is pending (GoTrue v2.189.0
// mfa.go compares it on verify) and emptied by the write that sets verified_at,
// or by the sweep once the challenge is past GoTrue's 300 s expiry. assert-app-yaml
// limb 10 reads the file's SHAPE; these cases prove what it DOES to a row.
//
// The tables are the GoTrue v2.189.0 columns the file touches, with GoTrue's
// types (inet NOT NULL on the challenge). A throwaway cluster on a unix socket
// only, in a temp dir. CI's ubuntu-24.04 image carries PostgreSQL 16 in
// /usr/lib/postgresql/16/bin; a CI run that cannot find it FAILS (an untested
// trigger is not a pass); a laptop without it skips, saying so.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SQL_FILE = join(REPO, 'docs', 'platform', 'supabase', 'sql', 'identity-address-null-on-write.sql');

/** The newest /usr/lib/postgresql/<major>/bin that has initdb, or null. */
function pgBin() {
  let majors = [];
  try {
    majors = readdirSync('/usr/lib/postgresql').filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(b) - Number(a));
  } catch {
    return null;
  }
  for (const m of majors) {
    const bin = join('/usr/lib/postgresql', m, 'bin');
    try {
      if (readdirSync(bin).includes('initdb') && readdirSync(bin).includes('pg_ctl')) return bin;
    } catch {
      // not this one
    }
  }
  return null;
}

const BIN = pgBin();
// initdb refuses root; a root shell (a container) runs the server as `postgres`.
const AS = typeof process.getuid === 'function' && process.getuid() === 0 ? ['runuser', '-u', 'postgres', '--'] : [];
const skip = BIN === null && !process.env.CI ? 'no PostgreSQL in /usr/lib/postgresql here (CI has 16)' : false;

/** The GoTrue v2.189.0 shapes the file touches, and the roles it grants to. */
const SCHEMA = `
CREATE ROLE supabase_admin;
CREATE ROLE supabase_auth_admin;
CREATE SCHEMA auth;
CREATE TABLE auth.sessions (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), ip inet);
CREATE TABLE auth.audit_log_entries (id uuid PRIMARY KEY, payload json, ip_address varchar(64) NOT NULL DEFAULT '');
CREATE TABLE auth.mfa_challenges (
  id uuid PRIMARY KEY, factor_id uuid NOT NULL, created_at timestamptz NOT NULL,
  verified_at timestamptz, ip_address inet NOT NULL, otp_code text, web_authn_session_data jsonb);
`;

let dir;
let sock;
const run = (cmd, args) => {
  const r = spawnSync(AS[0] ?? cmd, AS.length ? [...AS.slice(1), cmd, ...args] : args, { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' };
};
/** One psql call; ON_ERROR_STOP, so a failed statement is a non-zero exit. */
const psql = (sql) => {
  const f = join(dir, `q-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(f, sql);
  chmodSync(f, 0o644);
  const r = run('psql', ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', '5439', '-d', 'postgres', '-f', f]);
  assert.equal(r.code, 0, r.out);
  return r.stdout.trim();
};
/** Apply the trigger file, exactly as the runbook does: the whole file at once. */
const apply = (text = readFileSync(SQL_FILE, 'utf8')) => psql(text);

describe('identity-address-null-on-write.sql on a real PostgreSQL', { skip }, () => {
  before(() => {
    assert.ok(BIN, 'CI must have PostgreSQL in /usr/lib/postgresql/<major>/bin (ubuntu-24.04 carries 16)');
    dir = mkdtempSync(join(tmpdir(), 'idaddr-pg-'));
    chmodSync(dir, 0o777);
    sock = dir;
    const data = join(dir, 'data');
    let r = run(join(BIN, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-sync']);
    assert.equal(r.code, 0, r.out);
    r = run(join(BIN, 'pg_ctl'), ['-D', data, '-w', '-l', join(dir, 'log'), '-o', `-k ${sock} -p 5439 -c listen_addresses=''`, 'start']);
    assert.equal(r.code, 0, r.out);
    psql(SCHEMA);
    apply();
  });
  after(() => {
    if (BIN && dir) run(join(BIN, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'immediate', 'stop']);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const challenge = (id, createdAgo = '0 seconds') =>
    psql(`INSERT INTO auth.mfa_challenges (id, factor_id, created_at, ip_address)
          VALUES ('${id}', gen_random_uuid(), now() - interval '${createdAgo}', '203.0.113.7');`);
  const addressOf = (id) => psql(`SELECT host(ip_address) FROM auth.mfa_challenges WHERE id = '${id}';`);

  test('GREEN CONTROL: a PENDING challenge keeps the address verify compares (mfa.go:584), through an unrelated update too', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    challenge(id);
    assert.equal(addressOf(id), '203.0.113.7');
    psql(`UPDATE auth.mfa_challenges SET otp_code = 'x' WHERE id = '${id}';`);
    assert.equal(addressOf(id), '203.0.113.7', 'blanking a pending challenge fails every MFA verify as an address mismatch');
  });

  test('🔴 a challenge VERIFIED (GoTrue: UPDATE … SET verified_at) leaves no address', () => {
    const id = '00000000-0000-4000-8000-000000000002';
    challenge(id);
    // challenge.go:84-87, Verify = tx.UpdateOnly(c, "verified_at").
    psql(`UPDATE auth.mfa_challenges SET verified_at = now() WHERE id = '${id}';`);
    assert.equal(addressOf(id), '0.0.0.0');
  });

  test('🔴 an EXPIRED challenge (created > 300 s ago) leaves no address after the sweep; a live one keeps it', () => {
    const old = '00000000-0000-4000-8000-000000000003';
    const live = '00000000-0000-4000-8000-000000000004';
    challenge(old, '301 seconds');
    challenge(live, '60 seconds');
    const n = psql('SELECT nikatru_privacy.mfa_challenge_ip_sweep();');
    assert.ok(Number(n) >= 1, `the sweep reports the rows it blanked (${n})`);
    assert.equal(addressOf(old), '0.0.0.0');
    assert.equal(addressOf(live), '203.0.113.7', 'a challenge inside its 300 s must keep the address verify compares');
  });

  test('the session and audit address columns are emptied on every write', () => {
    psql(`INSERT INTO auth.sessions (id, ip) VALUES ('00000000-0000-4000-8000-0000000000a1', '203.0.113.7');
          INSERT INTO auth.audit_log_entries (id, ip_address) VALUES ('00000000-0000-4000-8000-0000000000a2', '203.0.113.7');`);
    assert.equal(psql(`SELECT count(*) FROM auth.sessions WHERE ip IS NOT NULL;`), '0');
    assert.equal(psql(`SELECT count(*) FROM auth.audit_log_entries WHERE ip_address <> '';`), '0');
  });

  test('🔴 RED CONTROL: with the on-verify trigger dropped, a verified challenge KEEPS the address — the cases above can fail', () => {
    psql('DROP TRIGGER nikatru_mfa_ip_blank_on_verify ON auth.mfa_challenges;');
    try {
      const id = '00000000-0000-4000-8000-000000000005';
      challenge(id);
      psql(`UPDATE auth.mfa_challenges SET verified_at = now() WHERE id = '${id}';`);
      assert.equal(addressOf(id), '203.0.113.7');
    } finally {
      apply(); // the file re-creates it: re-applying is safe, as its header says
    }
    const id = '00000000-0000-4000-8000-000000000006';
    challenge(id);
    psql(`UPDATE auth.mfa_challenges SET verified_at = now() WHERE id = '${id}';`);
    assert.equal(addressOf(id), '0.0.0.0', 're-applying the file restores the trigger');
  });
});
