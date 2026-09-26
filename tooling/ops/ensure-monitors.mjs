#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ensure-monitors.mjs — create the GlitchTip monitor a host row asks for, and
// write its id into tooling/monitor-register.json only after reading it back.
//
// ⏱ 2026-09-26 (O-SERVICE-KIT-UNBUILT, E-b2). A new app Worker's host row is
// written by tooling/scripts/provision-backend.mjs step [7] with `monitor: null`
// and a `gap` whose `create` block says what to watch: the name, the type, the
// path, the expected status and body, the interval, and the GlitchTip project (by
// slug) whose alert rule tells a person. This command turns that block into the
// monitor, so a second app's API is watched without anyone composing a request
// body by hand.
//
// WHY ITS OWN COMMAND, AND NOT A CREATE BRANCH IN set-monitor-thresholds.mjs:
// that script is a full-replace PUT over existing ids, and every run of it with
// --apply edits live monitors. A create branch there would put a POST behind a
// flag of a script whose every run already writes. One API module
// (glitchtip-monitor-api.mjs), two commands, each with one kind of write.
//
// DRY RUN BY DEFAULT, AND THE DRY RUN IS OFFLINE: it reads the register, prints
// each POST it would send, and needs no token and no network. The project id is
// printed as the slug it will be resolved from, because resolving it is a read of
// the live instance.
//
// --apply, per planned row:
//   1. resolves the project slug to its id (GET projects). A slug the instance
//      does not have is a refusal naming it: creating the app's GlitchTip project
//      is an owner step (service-kit design O-E1), never this command's;
//   2. POSTs the body — the SAME body shape set-monitor-thresholds echoes back,
//      from glitchtip-monitor-api.mjs, with `project` as a STRING (the 422 trap)
//      and the [ADR 043] threshold for its type (GET → 2), never GlitchTip's
//      default of 1;
//   3. RE-READS the monitor by the id the POST returned. The status code is the
//      server's claim; the re-read is the evidence;
//   4. writes the id into the row only when every field it sent reads back as
//      sent. A mismatch writes nothing and names the created id, so a person can
//      fix or delete that monitor: a register that recorded an id whose monitor
//      tells nobody would be the monitor-6 defect with a citation.
// A POST is attempted exactly once; only the reads are retried
// (glitchtip-monitor-api.mjs).
//
// 🔴 --apply IS A VENDOR WRITE. Its first run is a parent step after the owner's
// go (service-kit design O-E2); no agent drafting or reviewing this file runs it.
// Its create path is proven against a fake GlitchTip served in the test process
// (tooling/ci/test/ensure-monitors.test.mjs).
//
// Usage:
//   node tooling/ops/ensure-monitors.mjs                    # dry run, offline
//   GLITCHTIP_TOKEN=… node tooling/ops/ensure-monitors.mjs --apply
//   … [--root <dir>]                                       # another checkout (the tests)
//
// The token is read from the ENVIRONMENT only, never from the vault and never
// printed. GLITCHTIP_URL and GLITCHTIP_ORG are read as glitchtip-monitor-api.mjs
// reads them.
//
// Exit 0 = nothing to create, a dry run, or every planned monitor created, read
//          back as sent, and recorded.
// Exit 1 = a create spec is incomplete, a project is missing, a POST was refused,
//          or a monitor did not read back as sent.
// Exit 2 = could not look — the register has no host rows or does not parse, no
//          token for --apply, or the projects could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, BASE, ORG, POLICY, requestBodyFrom } from './glitchtip-monitor-api.mjs';
import { REGISTER_REL, replaceHostRow } from './monitor-register.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootAt = args.indexOf('--root');
const ROOT = rootAt > -1 ? resolve(args[rootAt + 1] ?? '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTER = join(ROOT, REGISTER_REL);

/** The monitor types this command creates. A host row watches an HTTP answer,
 *  and [ADR 043]'s policy is written for GET; any other type is created by hand. */
const CREATABLE = new Set(['GET']);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The planned POST for one host row's `gap.create`, or the list of what is wrong with it. */
function planFor(row) {
  const c = row.gap?.create ?? {};
  const wrong = [];
  if (typeof c.name !== 'string' || c.name.trim() === '') wrong.push('`name`');
  if (!CREATABLE.has(c.type)) wrong.push(`\`type\` ${JSON.stringify(c.type ?? null)} (this command creates ${[...CREATABLE].join(', ')} only)`);
  if (typeof c.path !== 'string' || !c.path.startsWith('/')) wrong.push('`path` (a string starting with /)');
  if (!Number.isInteger(c.expectedStatus) || c.expectedStatus < 100 || c.expectedStatus > 599) wrong.push('`expectedStatus` (an HTTP status)');
  if (typeof c.expectedBody !== 'string') wrong.push('`expectedBody` (a string; "" asserts nothing about the body)');
  if (!Number.isInteger(c.intervalSeconds) || c.intervalSeconds < 1 || c.intervalSeconds > 86400) {
    wrong.push('`intervalSeconds` (1..86400; GlitchTip refuses more)');
  }
  if (typeof c.project !== 'string' || !SLUG.test(c.project)) wrong.push('`project` (the GlitchTip project slug)');
  const threshold = POLICY[c.type];
  if (c.confirmationThreshold !== undefined && c.confirmationThreshold !== threshold) {
    wrong.push(`\`confirmationThreshold\` ${c.confirmationThreshold}, where [ADR 043] sets ${threshold} for ${c.type} (omit it)`);
  }
  if (wrong.length) return { wrong };
  const representation = {
    monitorType: c.type,
    name: c.name,
    url: `https://${row.hostname}${c.path}`,
    expectedStatus: c.expectedStatus,
    expectedBody: c.expectedBody,
    interval: c.intervalSeconds,
    timeout: null,
  };
  return { spec: c, representation, threshold };
}

/** Every field the POST set, compared with the monitor as it reads back. */
function mismatches(sent, live) {
  const read = { ...live, project: live.projectID };
  return Object.keys(sent)
    .filter((k) => k !== 'timeout')
    .filter((k) => JSON.stringify(sent[k]) !== JSON.stringify(read[k]))
    .map((k) => `${k}: sent ${JSON.stringify(sent[k])}, reads back ${JSON.stringify(read[k])}`);
}

async function main() {
  let text;
  let register;
  try {
    text = readFileSync(REGISTER, 'utf8');
    register = JSON.parse(text);
  } catch (e) {
    console.error(`✗ COULD NOT LOOK — ${REGISTER_REL} is missing or not JSON (${e.message}). Exit 2, not a pass.`);
    return 2;
  }
  const hosts = Array.isArray(register.hosts) ? register.hosts : [];
  if (hosts.length === 0) {
    console.error(`✗ COVERAGE LOST — ${REGISTER_REL} declares no host rows, so there is nothing to reconcile. Exit 2, not a pass.`);
    return 2;
  }

  const problems = [];
  const plans = [];
  let watched = 0;
  hosts.forEach((row, index) => {
    const m = row?.monitor;
    if (m !== null && m !== undefined) {
      if (typeof m.id === 'number') watched++;
      else problems.push(`${row.hostname} claims a monitor with no numeric id; a host with no monitor yet is \`monitor: null\` with a \`gap\`.`);
      return;
    }
    if (!row.gap?.create) {
      console.log(`--   ${row.hostname} — no monitor, and its gap names nothing to create (${row.gap?.why ?? 'no reason recorded'}); left alone`);
      return;
    }
    const plan = planFor(row);
    if (plan.wrong) {
      problems.push(`${row.hostname}: its \`gap.create\` cannot become a monitor — fix ${plan.wrong.join(', ')}.`);
      return;
    }
    plans.push({ index, row, ...plan });
  });
  console.log(`read ${hosts.length} host row(s) from ${REGISTER_REL}: ${watched} carry a monitor id, ${plans.length} ask for one`);

  if (!APPLY) {
    for (const p of plans) {
      const body = requestBodyFrom({ ...p.representation, projectID: `<the id of GlitchTip project "${p.spec.project}", read by --apply>` }, { confirmationThreshold: p.threshold });
      console.log(`\nPOST ${BASE}/api/0/organizations/${ORG}/monitors/   (for ${p.row.hostname})`);
      console.log(JSON.stringify(body, null, 2));
    }
    if (problems.length) {
      console.error('');
      for (const p of problems) console.error(`✗ ${p}`);
      return 1;
    }
    console.log(`\nDRY RUN — nothing was sent and nothing was written. ${plans.length} POST(s) planned. Re-run with --apply to create them.`);
    return 0;
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('\nNothing was sent: fix the rows above first.');
    return 1;
  }
  if (plans.length === 0) {
    console.log('\nensure-monitors — every host row that asks for a monitor already has one. Nothing to create.');
    return 0;
  }
  const token = process.env.GLITCHTIP_TOKEN?.trim();
  if (!token) {
    console.error('✗ COULD NOT LOOK — GLITCHTIP_TOKEN is not set, so nothing was sent. Exit 2, not a pass.');
    return 2;
  }
  const call = (method, path, body) => api(method, path, body, { token });

  const projects = await call('GET', `/api/0/organizations/${ORG}/projects/`);
  if (projects.status !== 200 || !Array.isArray(projects.body)) {
    console.error(`✗ COULD NOT LOOK — GET projects returned HTTP ${projects.status}. Nothing was sent.`);
    return 2;
  }
  const idBySlug = new Map(projects.body.map((p) => [p.slug, String(p.id)]));

  let created = 0;
  for (const p of plans) {
    const at = p.row.hostname;
    const projectID = idBySlug.get(p.spec.project);
    if (!projectID) {
      problems.push(
        `${at}: GlitchTip has no project "${p.spec.project}" in ${ORG}. Creating the app's project (and its alert rule) is an ` +
          'owner step; a monitor in no project alerts nobody. Nothing was sent for this row.',
      );
      continue;
    }
    const body = requestBodyFrom({ ...p.representation, projectID }, { confirmationThreshold: p.threshold });
    const post = await call('POST', `/api/0/organizations/${ORG}/monitors/`, body);
    const id = post.body?.id;
    if (post.status < 200 || post.status >= 300 || typeof id !== 'number') {
      problems.push(`${at}: POST returned HTTP ${post.status} — ${JSON.stringify(post.body)}. Nothing was written.`);
      continue;
    }
    const back = await call('GET', `/api/0/organizations/${ORG}/monitors/${id}/`);
    if (back.status !== 200 || !back.body) {
      problems.push(`${at}: created monitor ${id}, and it could not be read back (HTTP ${back.status}). The register was NOT written; check monitor ${id} by hand.`);
      continue;
    }
    const off = mismatches(body, back.body);
    if (off.length) {
      problems.push(`${at}: created monitor ${id}, and it does not read back as sent — ${off.join('; ')}. The register was NOT written; fix or delete monitor ${id} by hand.`);
      continue;
    }
    const { gap: _closed, ...rest } = p.row;
    const row = {
      ...rest,
      monitor: {
        id,
        name: back.body.name,
        type: back.body.monitorType,
        path: p.spec.path,
        expectedStatus: back.body.expectedStatus,
        expectedBody: back.body.expectedBody,
        confirmationThreshold: back.body.confirmationThreshold,
        intervalSeconds: back.body.interval,
        verifiedOn: new Date().toISOString().slice(0, 10),
      },
    };
    // Written after EACH create, so a later failure cannot lose an id already made.
    text = replaceHostRow(text, p.index, row);
    writeFileSync(REGISTER, text);
    created++;
    console.log(`SET  ${at} — monitor ${id} created, read back as sent, and recorded`);
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\nensure-monitors — ${created} created and recorded, ${problems.length} not.`);
    return 1;
  }
  console.log(`\nensure-monitors — ${created} monitor(s) created, each read back as sent and recorded in ${REGISTER_REL}.`);
  return 0;
}

process.exitCode = await main();
