// Provisions a throwaway, PRE-CONFIRMED Supabase user for the live E2E run and
// emails/password/user_id back to the workflow via $GITHUB_OUTPUT.
//
// Uses the GoTrue admin API (`email_confirm: true` skips the confirmation mail —
// the project has email confirmation ON) with the service-role key. No SDK: Node
// 20 global fetch only. The user is deleted again by purge.mjs after the run.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const url = need('SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');

// GoTrue rejects @example.com; use a clearly-labelled @nikatru.com test address.
const email = `subly-e2e+${Date.now()}@nikatru.com`;
const password = `E2e${randomBytes(24).toString('hex')}`; // 51 chars, alphanumeric
console.log(`::add-mask::${password}`);

const res = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});

if (!res.ok) {
  console.error(`Provision failed: HTTP ${res.status}\n${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
const userId = body.id ?? body.user?.id;
if (!userId) {
  console.error(`No user id in GoTrue response:\n${JSON.stringify(body)}`);
  process.exit(1);
}

const out = process.env.GITHUB_OUTPUT;
if (!out) {
  console.error('GITHUB_OUTPUT is not set — cannot pass credentials to the run');
  process.exit(1);
}
appendFileSync(out, `email=${email}\n`);
appendFileSync(out, `password=${password}\n`);
appendFileSync(out, `user_id=${userId}\n`);

console.log(`Provisioned confirmed E2E user ${email} (id ${userId}).`);

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
