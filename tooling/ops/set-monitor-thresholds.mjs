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
// ## 🔴 THE REQUEST AND THE RESPONSE DO NOT USE THE SAME KEY FOR THE PROJECT,
// ## AND GETTING THAT WRONG DETACHES EVERY MONITOR FROM ITS ALERTS
// Measured on this instance (GlitchTip 6.2.2) on 2026-08-11, the hard way:
//
//   · the RESPONSE calls it `projectID`, and its value is a STRING — `"1"`.
//   · the REQUEST calls it **`project`**, and it is ALSO a string. Sending
//     `project: 1` as an integer is rejected: HTTP 422,
//     `{"loc":["body","payload","project"],"msg":"Input should be a valid string"}`.
//   · sending the RESPONSE's key, `projectID`, is **accepted with HTTP 200 and
//     silently ignored** — the field is not in the input schema, so the project
//     falls to its default of null.
//
// That last line is the whole hazard. Echoing a monitor's own representation
// straight back — the obvious, careful-looking thing to do — returns 200 and
// detaches the monitor from its project. GlitchTip resolves recipients by
// joining alert → project → monitor, so a null project means **an empty
// recipient set**: the dashboard still draws the monitor, still turns it red,
// and tells nobody. That precise failure already happened once to monitor 6 and
// is written up in `register.json` under `duty.laptop.nikatru-daily-backup` —
// "it went Down 13 times of 41 checks telling nobody".
//
// It happened AGAIN on 2026-08-11, to all nine monitors at once, from this very
// script — and the read-back diff below is the only reason it was noticed and
// repaired within the minute rather than discovered by an outage nobody was
// told about. The guard caught the guard's own author. Keep the diff.
//
// The threshold field is `confirmationThreshold` in both directions. Note the
// upstream Python model spells these `confirmation_threshold` and `project`;
// reading field names off the source rather than off the wire is what produced
// the broken body in the first place.
//
// 🔴 PUT IS A FULL REPLACE. There is no PATCH route (`apps/uptime/api.py`
// registers POST/GET/PUT/DELETE and no `@router.patch`), and the handler does
// `payload.dict()` rather than `exclude_unset`, so **every field absent from the
// body is reset to its schema default** — including the project, which is how a
// monitor ends up with `project_id = NULL`, an empty recipient set, and a
// dashboard that draws it red while it tells nobody. That exact failure already
// happened to monitor 6 and is written up in `register.json`
// (`duty.laptop.nikatru-daily-backup`). So this script never composes a body: it
// GETs the monitor, changes ONE field, PUTs the whole thing back, and then
// re-GETs and diffs every field to prove nothing else moved. A write that
// cannot show what it changed is a write nobody can trust.
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
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VAULT = join(ROOT, '.claude', 'secrets.env');
const BASE = process.env.GLITCHTIP_URL || 'https://glitchtip.nikatru.com';
const ORG = process.env.GLITCHTIP_ORG || 'nikatru';
const APPLY = process.argv.includes('--apply');

// The vault quotes its values; a reader that keeps the quotes sends
// `Bearer "…"` and gets a 400 that reads exactly like a revoked token.
const unquote = (v) => v.replace(/^(['"])([\s\S]*)\1$/, '$2');
function vault(key) {
  if (!existsSync(VAULT)) return null;
  for (const line of readFileSync(VAULT, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    if (line.slice(0, i).trim() === key) return unquote(line.slice(i + 1).trim());
  }
  return null;
}
const TOKEN = process.env.GLITCHTIP_TOKEN?.trim() || vault('GLITCHTIP_TOKEN');

/// THE POLICY — and it is [ADR 043] decision 2, not this script's own opinion.
///
/// · GET monitors → 2. They run every 60 s, so two consecutive failures means
///   about two minutes of continuous failure before anyone is told. A real
///   outage still pages within ~2 min, while a single blip and an ALTERNATING
///   flap (fail, ok, fail, ok — the pattern that actually produced the 122
///   emails) never reach two and are silent. ADR 043 priced this against the
///   real check rows and against the precedent already inside this install:
///   monitors 11 and 12 were created with 2 and neither has ever flapped.
///
/// · HEARTBEAT monitors → NOT MANAGED HERE, deliberately. ADR 043 says "leave
///   6 and 16 alone". Their intervals are 12 h and 3 h, so each extra
///   confirmation costs a whole interval of detection latency, and turning
///   "the daily backup stopped" into a 24 h-late finding is a real cost that
///   the ADR did not price. Monitor 6 HAS flapped (14 down checks, 11
///   transitions, including 8 consecutive downs 30 s apart on 2026-07-27), so
///   there is a case to answer — but it is a decision to take with evidence,
///   not a number to slip in inside a script. Raised as a follow-up on ADR 043.
///
/// A type absent from this map is reported and left untouched.
const POLICY = { GET: 2 };

/// Fields this script is permitted to change. Everything else must come back
/// from the read-back byte-identical, and the diff below enforces that.
const INTENTIONAL = new Set(['confirmationThreshold']);

/// Volatile by nature — these move on their own between two reads and are not
/// evidence of a bad write.
const VOLATILE = new Set(['checks', 'isUp', 'lastChange']);

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    /* a 204 or an error page — status is what matters */
  }
  return { status: res.status, body: parsed };
}

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
    const payload = {
      monitorType: before.monitorType,
      name: before.name,
      url: before.url,
      expectedStatus: before.expectedStatus,
      expectedBody: before.expectedBody,
      interval: before.interval,
      timeout: before.timeout,
      project: before.projectID,
      confirmationThreshold: want,
    };

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
