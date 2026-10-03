#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-status-components.mjs — the public status page reports only on what a
// monitor watches, and names everything it reports on (lane status-page, Do 1).
//
//   node tooling/ci/assert-status-components.mjs [--root <dir>]
//
// SUBJECT: tooling/monitor-register.json — every `hosts` row and every
// `pathMonitors` entry. A row may carry `statusPage: { public, component }`;
// one without it stays PRIVATE (vault, dashboards, the www hops…).
//   SC-1  `statusPage.public` is a boolean when `statusPage` is present.
//   SC-2  public ⇒ a non-empty `component` name: a monitor marked public with no
//         component would put a nameless row on the page.
//   SC-3  public ⇒ a monitor with an id: a public component with no monitor is a
//         state the page would invent.
//   SC-4  `component` only when public: a name on a private row is a claim the
//         page never makes.
//   SC-5  component names are unique.
// tooling/status/build-status.mjs renders exactly these components into
// sites/status (its `--check` is in ci.yml's sites job).
//
// Exit 0 clean · 1 a finding · 2 COVERAGE LOST (the register unreadable, or no
// public component — a status page about nothing is not a pass).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTER = 'tooling/monitor-register.json';

/** Every row the page could report on: [{ where, statusPage, monitorId }]. */
export function rowsOf(reg) {
  const out = [];
  for (const h of reg.hosts ?? []) {
    out.push({ where: h.hostname, statusPage: h.statusPage, monitorId: h.monitor?.id ?? null });
    for (const pm of h.pathMonitors ?? []) out.push({ where: `${h.hostname} path ${pm.url ?? pm.id}`, statusPage: pm.statusPage, monitorId: pm.id ?? null });
  }
  return out;
}

export function check(reg) {
  if (!Array.isArray(reg?.hosts)) return { code: 2, lines: [`assert-status-components: COVERAGE LOST — ${REGISTER} has no hosts array`] };
  const out = [];
  const names = new Map();
  let pub = 0;
  for (const r of rowsOf(reg)) {
    const sp = r.statusPage;
    if (sp === undefined) continue;
    if (typeof sp?.public !== 'boolean') {
      out.push(`SC-1 ${r.where}: statusPage.public must be true or false`);
      continue;
    }
    const name = typeof sp.component === 'string' ? sp.component.trim() : '';
    if (sp.public) {
      pub++;
      if (!name) out.push(`SC-2 ${r.where}: marked public with no component name`);
      if (r.monitorId === null || r.monitorId === undefined) out.push(`SC-3 ${r.where}: public component ${JSON.stringify(name)} has no monitor — the page would invent its state`);
      if (name) {
        if (names.has(name)) out.push(`SC-5 ${r.where}: component ${JSON.stringify(name)} is already ${names.get(name)}'s`);
        else names.set(name, r.where);
      }
    } else if (name) out.push(`SC-4 ${r.where}: names component ${JSON.stringify(name)} but is not public`);
  }
  if (out.length) return { code: 1, lines: [...out, `assert-status-components: ${out.length} finding(s)`] };
  if (pub === 0) return { code: 2, lines: [`assert-status-components: COVERAGE LOST — no row of ${REGISTER} is a public component, so the status page reports on nothing`] };
  return { code: 0, lines: [`assert-status-components: ok — ${pub} public component(s), each with a monitor and a unique name; every other row stays private`] };
}

export function run(root) {
  let reg;
  try {
    reg = JSON.parse(readFileSync(path.join(root, ...REGISTER.split('/')), 'utf8'));
  } catch (e) {
    return { code: 2, lines: [`assert-status-components: COVERAGE LOST — ${REGISTER} could not be read (${e.code ?? e.message})`] };
  }
  return check(reg);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const root = a.includes('--root') ? path.resolve(a[a.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = run(root);
  for (const l of r.lines) console.log(l);
  process.exit(r.code);
}
