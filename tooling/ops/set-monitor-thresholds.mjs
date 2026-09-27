#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// set-monitor-thresholds.mjs — give every GlitchTip uptime monitor a debounce.
//
// 🔴 THE INCIDENT THIS EXISTS FOR. On 2026-08-11 a flapping monitor sent **122
// emails in 6 h 38 m** and consumed the entire Resend daily quota. Auth mail
// shares that quota — ONE container, because [ADR 041] item 4 (the campaigns
// container) is not built — so for the rest of that day **a new user signing up
// could not receive their confirmation mail**. A monitoring blip took out
// registration. That is the blast radius, and it is why this is not cosmetic.
//
// ## What actually caused it, measured rather than assumed
// Every monitor was created with `confirmationThreshold: 1`, GlitchTip's
// default, which means "the FIRST failed check marks this host down". The
// checks run every 60 s. A host that is intermittently failing therefore
// transitions down→up→down→up all day, and each transition is an alert. At
// ~6.5 min per cycle over 6 h 38 m that is the 122.
//
// ⚠️ THE ALERT RULES WERE NOT THE CAUSE, AND WERE THE FIRST SUSPECT.
// Both rules read `quantity: 1 / timespanMinutes: 1`, which looks like the
// throttle to loosen. It is not: the rules faithfully delivered one alert per
// event, and the events were real state changes. Raising the rule's timespan
// would have SUPPRESSED alerts including the first one — hiding real outages —
// whereas a confirmation threshold stops the state from flapping in the first
// place, so a genuine outage still alerts, once, within `threshold × interval`.
// Fix the signal, not the reporting of it.
//
// ## 🔴 THE PROJECT KEY, AND PUT IS A FULL REPLACE
// Both traps — the request spells the project `project` (a string) while the
// response spells it `projectID`, and a PUT resets every field it does not carry —
// are written up in tooling/ops/glitchtip-monitor-api.mjs, where the request code
// this script used to hold now lives (moved 2026-09-26, E-b2, so ensure-monitors.mjs
// creates monitors through the same body). The header there is this file's own
// text, verbatim. What stays here is the policy run and the read-back diff: this
// script GETs the monitor, changes ONE field, PUTs the whole thing back, and then
// re-GETs and diffs every field to prove nothing else moved.
//
// Usage:
//   node tooling/ops/set-monitor-thresholds.mjs           # DRY RUN — prints the diff
//   node tooling/ops/set-monitor-thresholds.mjs --apply   # performs the writes
//
// Exit 0 = every monitor already matches the policy, or was brought to it and
//          verified by read-back.
// Exit 1 = a write did not take, or changed a field it was not supposed to.
// Exit 2 = could not look — no token, or the API was unreachable.
// ─────────────────────────────────────────────────────────────────────────────
// The request code — the call, the retry, the body and the threshold POLICY
// ([ADR 043] decision 2) — is tooling/ops/glitchtip-monitor-api.mjs. This file
// keeps the verdict: which monitors to write, the read-back and the diff.
import { api as glitchtip, ORG, POLICY, requestBodyFrom, vaultToken } from './glitchtip-monitor-api.mjs';

const APPLY = process.argv.includes('--apply');
const TOKEN = vaultToken();
const api = (method, path, body) => glitchtip(method, path, body, { token: TOKEN });

/// Fields this script is permitted to change. Everything else must come back
/// from the read-back byte-identical, and the diff below enforces that.
const INTENTIONAL = new Set(['confirmationThreshold']);

/// Volatile by nature — these move on their own between two reads and are not
/// evidence of a bad write.
const VOLATILE = new Set(['checks', 'isUp', 'lastChange']);

function diff(before, after) {
  const changed = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (VOLATILE.has(k)) continue;
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) changed.push({ key: k, from: before[k], to: after[k] });
  }
  return changed;
}

async function main() {
  if (!TOKEN) {
    console.error(
      'set-monitor-thresholds: no GLITCHTIP_TOKEN in the environment or the local vault. ' +
        'I COULD NOT LOOK — exit 2, not a pass.',
    );
    return 2;
  }

  const list = await api('GET', `/api/0/organizations/${ORG}/monitors/`);
  if (list.status !== 200 || !Array.isArray(list.body)) {
    console.error(
      `set-monitor-thresholds: GET monitors returned HTTP ${list.status}. I COULD NOT LOOK.`,
    );
    return 2;
  }

  const problems = [];
  let wrote = 0;
  let already = 0;

  for (const m of list.body.sort((a, b) => a.id - b.id)) {
    const want = POLICY[m.monitorType];
    if (want === undefined) {
      console.log(`--   #${m.id} "${m.name}" — type "${m.monitorType}" has no policy; left alone`);
      continue;
    }
    if (m.confirmationThreshold === want) {
      console.log(`ok   #${m.id} "${m.name}" (${m.monitorType}) already at threshold ${want}`);
      already++;
      continue;
    }

    const line =
      `#${m.id} "${m.name}" (${m.monitorType}, every ${m.interval}s): ` +
      `confirmationThreshold ${m.confirmationThreshold} → ${want}`;

    if (!APPLY) {
      console.log(`DRY  ${line}`);
      continue;
    }

    // Read the monitor on its own, so the body we echo back is the server's
    // own current representation rather than a list projection of it.
    const cur = await api('GET', `/api/0/organizations/${ORG}/monitors/${m.id}/`);
    if (cur.status !== 200 || !cur.body) {
      problems.push(`#${m.id}: could not re-read before writing (HTTP ${cur.status}).`);
      continue;
    }
    const before = cur.body;

    // 🔴 EVERY FIELD THE SCHEMA ACCEPTS, ECHOED BACK. Omitting one resets it.
    // Note `project:` — the REQUEST key — carrying the value the RESPONSE calls
    // `projectID`. They are different names for the same field and using the
    // response's name here is accepted-and-ignored, which nulls the project and
    // silently empties the monitor's recipient list. See the header.
    if (typeof before.projectID !== 'string' || !before.projectID) {
      problems.push(
        `#${m.id} "${m.name}": has no project (projectID=${JSON.stringify(before.projectID)}), so it ` +
          `can reach no recipients. Refusing to write — repair the project first, or this ` +
          `script would preserve a monitor that alerts nobody.`,
      );
      continue;
    }
    const payload = requestBodyFrom(before, { confirmationThreshold: want });

    const put = await api('PUT', `/api/0/organizations/${ORG}/monitors/${m.id}/`, payload);
    if (put.status < 200 || put.status >= 300) {
      problems.push(
        `#${m.id} "${m.name}": PUT returned HTTP ${put.status} — ${JSON.stringify(put.body)}`,
      );
      continue;
    }

    // READ BACK. The PUT response is the server's claim; this is the evidence.
    const after = await api('GET', `/api/0/organizations/${ORG}/monitors/${m.id}/`);
    if (after.status !== 200 || !after.body) {
      problems.push(`#${m.id}: wrote, but could not read back (HTTP ${after.status}).`);
      continue;
    }
    if (after.body.confirmationThreshold !== want) {
      problems.push(
        `#${m.id} "${m.name}": threshold is ${after.body.confirmationThreshold} after the write, ` +
          `not the ${want} that was sent. The write did not take.`,
      );
      continue;
    }
    const moved = diff(before, after.body).filter((c) => !INTENTIONAL.has(c.key));
    if (moved.length) {
      problems.push(
        `#${m.id} "${m.name}": the PUT changed fields it was not meant to — ` +
          moved.map((c) => `${c.key}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('; ') +
          `. This is the full-replace hazard; restore it by hand before trusting this monitor.`,
      );
      continue;
    }

    console.log(`SET  ${line}  ✓ read back, no other field moved`);
    wrote++;
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`✗ ${p}`);
    return 1;
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing was written. ${already} monitor(s) already match the policy. ` +
        `Re-run with --apply to perform the changes above.`,
    );
    return 0;
  }
  console.log(
    `\nset-monitor-thresholds — ${wrote} monitor(s) updated and verified by read-back, ` +
      `${already} already compliant. Policy: ` +
      Object.entries(POLICY)
        .map(([t, n]) => `${t}→${n} consecutive failure(s)`)
        .join(', ') +
      '. Types absent from the policy are reported and left untouched.',
  );
  return 0;
}

process.exitCode = await main();
