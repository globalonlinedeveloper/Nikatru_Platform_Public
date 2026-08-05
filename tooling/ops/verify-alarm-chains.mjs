#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-alarm-chains.mjs — a monitor must resolve to a mailbox.
//
// tooling/ops/verify-monitors.mjs reconciles tooling/monitor-register.json
// against the live GlitchTip instance: does the monitor the register claims
// actually exist, and is it pointed at the host it is filed under. It answers
// nothing about whether that monitor can TELL ANYONE, and it prints the laptop
// heartbeat as "not filed under any hostname" — correctly, and reassuringly —
// while that monitor was structurally incapable of sending mail.
//
// WHY THIS EXISTS. Monitor 6 ("Laptop daily backup") was created with
// project_id = NULL. GlitchTip's notification path is one join:
//
//     AlertRecipient.objects.filter(alert__project__monitor__id=<id>,
//                                   alert__uptime=True)     apps/uptime/tasks.py
//
// A monitor belonging to no project belongs to no project's alert rule, so the
// recipient set is EMPTY. It went Down 13 times of 41 checks and told nobody.
// Nothing was broken: checks ran on schedule, transitions were recorded, the
// dashboard drew them red, the alert rule existed and was enabled. Every surface
// a person looks at was healthy. The missing thing was a foreign key, and a
// foreign key has no dashboard.
//
// And tooling/ops/register.json called that row "the one provably complete alarm
// chain in the portfolio and the template every other row is measured against" —
// so the yardstick the whole duty register was calibrated against was a chain
// that did not deliver.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHY LIMB C EXISTS, AND WHY THE OBVIOUS GUARD IS NOT ENOUGH.
// The obvious guard is "assert every monitor has a project" — that is limb A. It
// is necessary and it is not sufficient, because a config-shaped check answers a
// config-shaped question: it would have gone green the instant the foreign key
// was set, which is the same half-state one step later. The thing that had never
// actually happened was an email arriving. So limb C requires a dated delivery
// record per project in alarm-chains.json, naming evidence that outlives the
// session that wrote it, and the enforced rule is: a chain is not complete until
// somebody has watched it carry something.
//
// 🔴 SILENCE IS NOT SUCCESS. Unreachable API, empty monitor list, unreadable
// project list — every one of those EXITS NON-ZERO rather than reporting clean
// over a set this script could not read. That is why limb D is a NAME canary and
// not a count: a count is satisfied by junk and by a truncated page.
//
// ⚠️ NOT RUN BY CI, and for the same reason verify-monitors.mjs is not: a CI limb
// needing a network token would either be SKIPPED when the token is absent — and
// a skipped check reports ok — or it would make every build depend on the Oracle
// box, which is the very single point of failure E-9b is about. It becomes
// automatable when GLITCHTIP_TOKEN is a repository secret (OWNER_QUEUE S-8).
// Until then it is a command, and SESSION_BOOTSTRAP step 7 is where it is run.
//
// Usage:
//   GLITCHTIP_TOKEN=…  node tooling/ops/verify-alarm-chains.mjs
//   GLITCHTIP_TOKEN=…  node tooling/ops/verify-alarm-chains.mjs --self-test
//
// The token lives in the local vault (.claude/secrets.env) and must never be
// committed, echoed or printed. Nothing below ever prints its value.
//
// Exit 0 = every chain resolves to a recipient and has been watched delivering.
// Exit 1 = a broken chain, or the API could not be reached / authorised.
// Exit 2 = no token supplied — a DIFFERENT exit code from "broken" on purpose,
//          so "I could not look" can never be read as "I looked and it was fine".
//          --self-test also exits 2 if it fails to RESTORE what it broke.
//
// ─────────────────────────────────────────────────────────────────────────────
// --self-test MUTATES THE LIVE INSTANCE AND THE REAL LEDGER, then restores both.
// A fixture cannot negative-test this: a fixture would encode the same belief
// about GlitchTip's join that the guard encodes, so both would be wrong together
// and both would pass. Limb A is proved by actually unsetting monitor 6's
// project and watching this script go red — the exact production state that
// caused it to be written. That is not a hypothetical this time; the FIRST run
// of --self-test found a real defect here, in limb B, by doing precisely that.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(HERE, 'alarm-chains.json');

const BASE = (process.env.GLITCHTIP_URL ?? 'https://glitchtip.nikatru.com').replace(/\/+$/, '');
const TOKEN = process.env.GLITCHTIP_TOKEN;
const MODE = process.argv[2] ?? '';

if (!TOKEN) {
  console.error('⬜ GLITCHTIP_TOKEN is not set, so the live instance was NOT contacted.');
  console.error('   Exit code 2, deliberately distinct from 1: "I could not look" must never be readable');
  console.error('   as "I looked and it was fine". Source the token from the local vault and re-run.');
  process.exit(2);
}

const ledger = () => JSON.parse(readFileSync(LEDGER, 'utf8'));
const ORG = ledger().org;

async function api(path, init = {}) {
  // NO `CF-Connecting-IP` HEADER, EVER — Cloudflare's edge rejects any client
  // request carrying one with error 1000, before the origin is reached.
  const res = await fetch(`${BASE}/api/0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Swallowing a 5xx and carrying on with an empty list is how a guard reports
    // clean during an outage.
    throw new Error(`${init.method ?? 'GET'} /${path} → HTTP ${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

async function check() {
  const m = ledger();
  const problems = [];

  let monitors;
  try {
    monitors = await api(`organizations/${ORG}/monitors/`);
  } catch (err) {
    console.error(`✗ could not list monitors — ${err.message}`);
    console.error('  A 401 means the token is wrong or expired; a 5xx means the Oracle box is unwell,');
    console.error('  which is itself the E-9b single point of failure showing its face.');
    return 1;
  }
  if (!Array.isArray(monitors) || monitors.length === 0) {
    console.error('✗ the monitor list is empty or not an array. Refusing to report clean on a set I could not read.');
    return 1;
  }

  // 🔴 KEY BY SLUG, NEVER BY NAME. The monitor payload carries projectName, not
  // projectSlug, and for `ops`/`subly` the two are identical — so the first
  // version of this script used the name in the alerts URL and worked by pure
  // coincidence. --self-test created a throwaway project called "TEMP alarm-chain
  // selftest", whose slug is not its name, and limb B reported "ALERTS
  // UNREADABLE: HTTP 404" instead of the condition it was written to test. It
  // still printed PASS, because a failure for the wrong reason is still a
  // failure. Resolve id → slug explicitly.
  let projectList;
  try {
    projectList = await api(`organizations/${ORG}/projects/`);
  } catch (err) {
    console.error(`✗ could not list projects — ${err.message}`);
    return 1;
  }
  const projects = Array.isArray(projectList) ? projectList : [projectList];
  if (projects.length === 0) {
    console.error('✗ the project list is empty. Refusing to report clean on a set I could not read.');
    return 1;
  }
  const slugById = new Map(projects.map((p) => [String(p.id), p.slug]));

  console.log(`read ${monitors.length} monitor(s) and ${projects.length} project(s) from ${ORG}`);

  // ── limb D — the coverage canary. Run first: everything else is scoped by
  // what the API returned, so a silently shortened list would shrink the whole
  // check while every other limb still printed ok.
  const seen = new Set(monitors.map((x) => x.name));
  for (const name of m.expectedMonitorNames ?? []) {
    if (!seen.has(name)) {
      problems.push(
        `COVERAGE LOST: expected monitor ${JSON.stringify(name)} is not in the live list. Either it was ` +
          `deleted — in which case remove it from alarm-chains.json in the same change, deliberately — or ` +
          `this script is now checking less than it believes it is.`,
      );
    }
  }
  if ((m.expectedMonitorNames ?? []).length === 0) {
    problems.push('COVERAGE LOST: expectedMonitorNames is empty, so the canary can never fire. Never "fix" a failure by emptying it.');
  }

  // ── limb A — every monitor resolves to a project. Monitor 6's exact defect.
  const hosting = new Set();
  for (const mon of monitors) {
    if (mon.projectID === null || mon.projectID === undefined || mon.projectID === '') {
      problems.push(
        `NO PROJECT: monitor ${mon.id} ${JSON.stringify(mon.name)} has no project. The alert join runs ` +
          `alert → project → monitor, so this monitor can never notify anyone, no matter how many alert ` +
          `rules exist or how red the dashboard looks.`,
      );
      continue;
    }
    const slug = slugById.get(String(mon.projectID));
    if (!slug) {
      problems.push(
        `DANGLING PROJECT: monitor ${mon.id} ${JSON.stringify(mon.name)} points at project id ` +
          `${mon.projectID}, which is not in this organization's project list.`,
      );
      continue;
    }
    hosting.add(slug);
  }

  // ── limb B — every project hosting a monitor has an uptime alert WITH at least
  // one recipient. An alert with uptime:false, or with an empty recipient list,
  // is the same silence one join further along.
  for (const slug of [...hosting].sort()) {
    let alerts;
    try {
      alerts = await api(`projects/${ORG}/${slug}/alerts/`);
    } catch (err) {
      problems.push(`ALERTS UNREADABLE: project ${slug} — ${err.message}`);
      continue;
    }
    const list = Array.isArray(alerts) ? alerts : [alerts].filter(Boolean);
    const live = list.filter((a) => a && a.uptime === true && (a.alertRecipients ?? []).length > 0);
    if (live.length === 0) {
      problems.push(
        `NO UPTIME RECIPIENT: project ${slug} hosts monitor(s) but has no alert rule with uptime=true and ` +
          `at least one recipient. Its monitors are decorative.`,
      );
    }
  }

  // ── limb C — the chain has been WATCHED delivering, not merely wired.
  for (const slug of [...hosting].sort()) {
    const obs = m.chainsObserved?.[slug];
    if (!obs?.date || !obs?.evidence) {
      problems.push(
        `NEVER OBSERVED: project ${slug} has monitors and an alert rule, but no dated delivery record with ` +
          `evidence in alarm-chains.json. Force a real state change and record the delivery id. Config-only ` +
          `is the half-state that caused this script to exist.`,
      );
    }
  }

  // Print what was covered, not just what failed. A check whose only output is
  // silence teaches the next reader nothing about its reach.
  for (const slug of [...hosting].sort()) {
    const owned = monitors.filter((x) => slugById.get(String(x.projectID)) === slug).map((x) => x.name);
    const obs = m.chainsObserved?.[slug];
    console.log(`ok   project ${slug} — ${owned.length} monitor(s) [${owned.join(', ')}] — delivery observed ${obs?.date ?? 'NEVER'}`);
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\nverify-alarm-chains — ${problems.length} broken chain(s).`);
    return 1;
  }
  console.log(
    `\nverify-alarm-chains — ${monitors.length} monitor(s) across ${hosting.size} project(s); every one ` +
      `resolves to a recipient, and every project's chain has been watched delivering.`,
  );
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// --self-test: break the real thing four ways and require red each time. Every
// mutation is undone in a finally block, the undo is verified, and the run ends
// by requiring the real system green again.
// ─────────────────────────────────────────────────────────────────────────────
async function selfTest() {
  const results = [];
  const original = readFileSync(LEDGER, 'utf8');
  const expectRed = async (label) => {
    const code = await check();
    const ok = code === 1;
    results.push([ok, label]);
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}\n`);
  };

  // A — reproduce the production defect on the LIVE instance.
  const mon6 = (await api(`organizations/${ORG}/monitors/`)).find((x) => x.monitorType === 'Heartbeat');
  if (!mon6) {
    console.error('✗ no heartbeat monitor to test against; self-test cannot reproduce the defect.');
    return 1;
  }
  const put = (project) =>
    api(`organizations/${ORG}/monitors/${mon6.id}/`, {
      method: 'PUT',
      body: JSON.stringify({
        monitorType: mon6.monitorType,
        name: mon6.name,
        url: mon6.url,
        interval: mon6.interval,
        confirmationThreshold: mon6.confirmationThreshold,
        expectedBody: mon6.expectedBody,
        expectedStatus: mon6.expectedStatus,
        timeout: mon6.timeout,
        project,
      }),
    });
  try {
    await put(null);
    const broken = await api(`organizations/${ORG}/monitors/${mon6.id}/`);
    if (broken.projectID !== null) {
      console.error('✗ could not reproduce the null-project state — this self-test would be meaningless.');
      return 1;
    }
    await expectRed('limb A: a live monitor with no project is caught');
  } finally {
    await put(mon6.projectID);
    const restored = await api(`organizations/${ORG}/monitors/${mon6.id}/`);
    if (restored.projectID !== mon6.projectID) {
      console.error(`🔴 RESTORE FAILED — monitor ${mon6.id} projectID is ${restored.projectID}, expected ${mon6.projectID}. FIX BY HAND NOW.`);
      process.exit(2);
    }
    if (restored.endpointID !== mon6.endpointID) {
      console.error('🔴 RESTORE FAILED — the heartbeat endpoint id changed, so the laptop backup heartbeat URL is now dead. FIX BY HAND NOW.');
      process.exit(2);
    }
  }

  // B — a project that hosts a monitor but has no uptime alert. Built ADDITIVELY
  // (a throwaway project plus a throwaway monitor) rather than by deleting the
  // real alert rule, so a crash mid-test cannot leave a real chain disarmed.
  let tmpProject = null;
  let tmpMonitor = null;
  try {
    tmpProject = await api(`teams/${ORG}/${ORG}/projects/`, {
      method: 'POST',
      body: JSON.stringify({ name: 'TEMP alarm-chain selftest' }),
    });
    tmpMonitor = await api(`organizations/${ORG}/monitors/`, {
      method: 'POST',
      body: JSON.stringify({
        monitorType: 'Heartbeat',
        name: 'TEMP alarm-chain selftest monitor',
        url: '',
        interval: 86400,
        confirmationThreshold: 1,
        expectedBody: '',
        expectedStatus: null,
        timeout: null,
        project: String(tmpProject.id),
      }),
    });
    await expectRed('limb B: a project with monitors but no uptime recipient is caught');
  } finally {
    if (tmpMonitor) await api(`organizations/${ORG}/monitors/${tmpMonitor.id}/`, { method: 'DELETE' });
    if (tmpProject) await api(`projects/${ORG}/${tmpProject.slug}/`, { method: 'DELETE' });
  }

  // C — wired but never observed.
  try {
    const m = JSON.parse(original);
    delete m.chainsObserved.ops;
    writeFileSync(LEDGER, JSON.stringify(m, null, 2));
    await expectRed('limb C: a wired-but-never-observed chain is caught');
  } finally {
    writeFileSync(LEDGER, original);
  }

  // C2 — a date with no evidence. The word "verified" is not evidence.
  try {
    const m = JSON.parse(original);
    m.chainsObserved.ops = { date: '2026-08-05', evidence: '' };
    writeFileSync(LEDGER, JSON.stringify(m, null, 2));
    await expectRed('limb C: a dated observation carrying no evidence is caught');
  } finally {
    writeFileSync(LEDGER, original);
  }

  // D — the canary: a monitor the live instance no longer has.
  try {
    const m = JSON.parse(original);
    m.expectedMonitorNames.push('a monitor that does not exist');
    writeFileSync(LEDGER, JSON.stringify(m, null, 2));
    await expectRed('limb D: a monitor missing from the live list is caught');
  } finally {
    writeFileSync(LEDGER, original);
  }

  const finalCode = await check();
  results.push([finalCode === 0, 'restore: the live instance and the ledger are green again']);
  console.log(`${finalCode === 0 ? 'PASS' : 'FAIL'} — restore: the live instance and the ledger are green again`);

  const passed = results.filter(([ok]) => ok).length;
  console.log(`\n${passed}/${results.length} self-tests passed`);
  return passed === results.length ? 0 : 1;
}

process.exit(MODE === '--self-test' ? await selfTest() : await check());
