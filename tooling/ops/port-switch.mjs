#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// port-switch.mjs — the graded, READ-ONLY dry run of switching a port to
// another adapter. Phase 3 of the switch playbook in tooling/ports/README.md.
//
//   node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run
//        [--env live|sandbox|test] [--from <adapter>] [--root <repoRoot>]
//
//   <port>      a tooling/ports/<port>.json registry.
//   --to        the adapter id the port would switch to.
//   --dry-run   REQUIRED. This tool never switches anything; without the flag
//               it refuses, so nobody mistakes it for the switch itself.
//   --env       the environment being switched (default live).
//   --from      the adapter being replaced; default: selection.default[env],
//               or — for a port selected per channel — every adapter that
//               serves a channel today.
//
// One line per check, `PASS | FAIL | LOST  C<n> <name>: <detail>`, after ONE
// first line that names the check deciding the exit (the shape of
// tooling/ops/auth-cutover-preflight.mjs):
//   exit 1  any FAIL (a finding — do not switch);
//   exit 2  no FAIL, but some check could not look (COVERAGE LOST is not a pass),
//           or the invocation was refused;
//   exit 0  every check PASS.
//
// The eight:
//   C1 target     the target row exists, carries the environment, and is not a
//                 `fake` for live
//   C2 status     its status (draft and retired cannot take traffic)
//   C3 secrets    its secret NAMES are declared (assert-ports.mjs's reader: the
//                 manifest, else interface Env); when tooling/ops/worker-secrets.mjs
//                 exists its `check` is run as well. Values are never read here.
//   C4 identity   its identity paths resolve in tooling/house-identity.json
//   C5 conformance  its conformance file CALLS the port's runner, and no case is
//                 pending for it
//   C6 export     the export duty of the current adapter(s) and the target is written
//   C7 standby    a current adapter exists to become `standby` (the rollback path)
//   C8 margin     per channel, the net of every price under the current adapter
//                 against the target, from tooling/catalog/fee-register.json
//                 cells × services/platform/src/app-config-data.json prices.
//                 LOST when a cell is missing or unapplicable. A switch that
//                 lowers the net is printed as such: its ADR must say why.
//
// It reads registries and nothing else: no network, no vault, no credential.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSecretSources, callsRunner, declares } from '../ci/assert-ports.mjs';
import { stripSourceComments } from '../ci/text-reductions.mjs';
import { readRegister, plan, netAfterFee, feeCurrencyProblem, FEE_REGISTER, CHANNEL_REGISTER } from '../catalog/render-rail-prices.mjs';

export const NO_VALUE_FLAGS = new Set(['--dry-run']);
export const VALUE_FLAGS = new Set(['--to', '--env', '--from', '--root']);
export const HOUSE_IDENTITY = 'tooling/house-identity.json';
export const WORKER_SECRETS_TOOL = 'tooling/ops/worker-secrets.mjs';
const ENVS = new Set(['live', 'sandbox', 'test']);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const money = (minor) => `${minor < 0 ? '-' : ''}${Math.trunc(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;

/** Parse argv. Every flag is declared; a no-value flag never eats the next argument (shell-13). */
export function parseArgs(argv) {
  const out = { port: null, to: null, env: 'live', from: null, root: null, dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (NO_VALUE_FLAGS.has(a)) { if (a === '--dry-run') out.dryRun = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined) return { error: `${a} needs a value` };
      if (v.startsWith('--')) return { error: `${a} was given ${JSON.stringify(v)}, which is a flag, not a value` };
      out[a.slice(2)] = v;
      i++;
      continue;
    }
    if (a.startsWith('-')) return { error: `unknown flag ${a}` };
    positional.push(a);
  }
  if (positional.length !== 1) return { error: `expected exactly one <port>, got ${positional.length}` };
  out.port = positional[0];
  if (!out.dryRun) return { error: '--dry-run is required: this tool only ever rehearses a switch, and says so on the command line' };
  if (!out.to) return { error: '--to <adapter> is required' };
  if (!ENVS.has(out.env)) return { error: `--env must be live, sandbox or test, not ${JSON.stringify(out.env)}` };
  return out;
}

/** The fee an adapter charges on one sale of `price` on a channel of `rail`, or {lost}. */
export function feeFor(adapter, rail, price, cells) {
  const ids = adapter?.cost?.feeCells ?? [];
  if (!ids.length) return { lost: `adapter \`${adapter?.id}\` carries no fee cells` };
  const all = [];
  for (const id of ids) {
    const c = cells[id];
    if (!isObj(c)) return { lost: `${FEE_REGISTER} has no cell \`${id}\`` };
    if (!isObj(c.value) || !Number.isInteger(c.value.percentBps)) return { lost: `${FEE_REGISTER} cell \`${id}\` has no percentBps value (${JSON.stringify(c.value)})` };
    all.push({ id, cell: c });
  }
  const sameRail = all.filter((x) => x.cell.rail === rail);
  const pool = sameRail.length ? sameRail : all;
  const under = pool.filter((x) => Number.isInteger(x.cell.thresholdMinor) && price < x.cell.thresholdMinor);
  const applied = under.length ? under : pool.filter((x) => !Number.isInteger(x.cell.thresholdMinor));
  if (!applied.length) return { lost: `no cell of \`${adapter.id}\` applies to a ${money(price)} sale` };
  let percentBps = 0;
  let fixedMinor = 0;
  for (const { id, cell } of applied) {
    const problem = feeCurrencyProblem(cell.value, 'USD');
    if (problem) return { lost: `${FEE_REGISTER} cell \`${id}\` ${problem}` };
    percentBps += cell.value.percentBps;
    fixedMinor += cell.value.fixedMinor ?? 0;
  }
  return { fee: { percentBps, fixedMinor }, cells: applied.map((x) => x.id) };
}

/** The rails an adapter serves: the `rail` of each of its fee cells. */
const railsOf = (adapter, cells) => new Set((adapter?.cost?.feeCells ?? []).map((id) => cells[id]?.rail).filter(Boolean));

/** C8 · margin. Returns {verdict, detail, lines}. */
export function margin(root, doc, target, current) {
  const lines = [];
  const priced = (doc.adapters ?? []).some((a) => (a?.cost?.feeCells ?? []).length);
  if (!priced) {
    const u = (a) => (a?.cost?.unit ? `${a.cost.unit.usd} USD per ${a.cost.unit.per}` : 'no unit cost recorded');
    return { verdict: 'PASS', detail: `no per-sale fee on this port; unit cost ${current.map((c) => `${c.id}: ${u(c)}`).join(', ') || 'n/a'} → ${target.id}: ${u(target)}`, lines };
  }
  let feeDoc;
  try { feeDoc = JSON.parse(readFileSync(join(root, FEE_REGISTER), 'utf8')); } catch (e) { return { verdict: 'LOST', detail: `${FEE_REGISTER} could not be read (${e.message})`, lines }; }
  const cells = isObj(feeDoc?.cells) ? feeDoc.cells : {};
  let channels;
  try { channels = (JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8')).channels ?? []).filter((c) => c?.surface === 'app' && c?.purchaseRail?.rail && c.purchaseRail.rail !== 'none'); } catch (e) {
    return { verdict: 'LOST', detail: `${CHANNEL_REGISTER} could not be read (${e.message})`, lines };
  }
  const reg = readRegister(root);
  if (!reg.ok) return { verdict: 'LOST', detail: reg.why, lines };
  const { book, lost: planLost } = plan(root, reg.data);
  if (planLost.length) return { verdict: 'LOST', detail: planLost[0], lines };
  const plans = [];
  for (const { app, offerings } of book) for (const o of offerings) plans.push({ label: `${app} ${o.id}`, webUsd: o.webUsd, store: o.entry?.store });
  for (const [k, b] of Object.entries(reg.data?.prices?.bundles ?? {})) if (!k.startsWith('_') && isObj(b)) plans.push({ label: `bundle ${k}`, webUsd: b.amount_minor, store: b.store });
  if (!plans.length) return { verdict: 'LOST', detail: 'the price register yields no plan to net', lines };

  const lostWhy = [];
  let rows = 0;
  let lower = 0;
  let delta = 0;
  for (const ch of channels) {
    const rail = ch.purchaseRail.rail;
    const cur = current.find((a) => railsOf(a, cells).has(rail));
    if (!cur || cur.id === target.id) continue;
    lines.push(`    ${ch.id} (${rail}): ${cur.id} → ${target.id}`);
    const onStore = rail === 'play-billing' || rail === 'apple-iap';
    for (const p of plans) {
      const price = onStore ? (isObj(p.store) ? p.store.USD : null) : p.webUsd;
      if (!Number.isInteger(price)) continue;
      const a = feeFor(cur, rail, price, cells);
      const b = feeFor(target, rail, price, cells);
      if (a.lost || b.lost) { lostWhy.push(a.lost ?? b.lost); continue; }
      const na = netAfterFee(price, a.fee);
      const nb = netAfterFee(price, b.fee);
      rows++;
      delta += nb - na;
      if (nb < na) lower++;
      lines.push(`      ${p.label.padEnd(36)} USD ${money(price).padStart(7)}  net ${money(na).padStart(7)} → ${money(nb).padStart(7)}  (${nb - na >= 0 ? '+' : ''}${money(nb - na)})`);
    }
  }
  if (lostWhy.length) return { verdict: 'LOST', detail: `${lostWhy.length} net(s) could not be derived — first: ${lostWhy[0]}`, lines };
  if (!rows) return { verdict: 'PASS', detail: `no channel served by ${current.map((c) => c.id).join(', ') || 'a current adapter'} would change rail; no net moves`, lines };
  const verdictLine = lower ? `${lower} of ${rows} net(s) FALL (total ${money(delta)} USD per round of sales) — the switch's ADR must say why` : `${rows} net(s), none falls (total +${money(delta)} USD)`;
  return { verdict: 'PASS', detail: verdictLine, lines };
}

/** Run the dry run. Returns {code, out: string[]}. */
export function run(opts) {
  const root = resolve(opts.root ?? process.cwd());
  const checks = [];
  const add = (n, name, verdict, detail) => checks.push({ n, name, verdict, detail });
  const rel = `tooling/ports/${opts.port}.json`;
  let doc;
  try { doc = JSON.parse(readFileSync(join(root, rel), 'utf8')); } catch (e) {
    return { code: 2, out: [`port-switch: LOST — ${rel} could not be read (${e.message})`] };
  }
  const env = opts.env;
  const adapters = Array.isArray(doc.adapters) ? doc.adapters : [];
  const target = adapters.find((a) => a?.id === opts.to);

  // C1
  if (!target) add(1, 'target', 'FAIL', `${rel} has no adapter \`${opts.to}\` (has: ${adapters.map((a) => a?.id).join(', ')})`);
  else if (target.status === 'fake' && env === 'live') add(1, 'target', 'FAIL', `\`${target.id}\` is a fake; a fake is never selectable in live`);
  else if (!(target.environments ?? []).includes(env)) add(1, 'target', 'FAIL', `\`${target.id}\` does not list the ${env} environment (${(target.environments ?? []).join(', ')})`);
  else add(1, 'target', 'PASS', `\`${target.id}\` (vendor ${target.vendor ?? 'none — a fake'}) is a row of ${rel} for ${env}`);
  if (!target) return finish(checks);

  // C2
  if (['draft', 'retired'].includes(target.status)) add(2, 'status', 'FAIL', `\`${target.id}\` is ${target.status}; it cannot take traffic`);
  else add(2, 'status', 'PASS', `\`${target.id}\` is ${target.status}`);

  // C3
  const names = target.secrets ?? [];
  if (!names.length) add(3, 'secrets', 'PASS', 'declares no secrets');
  else {
    const sec = readSecretSources(root);
    if (sec.lost) add(3, 'secrets', 'LOST', sec.lost);
    else {
      const missing = names.filter((n) => !sec.names.has(n) && !(sec.source === 'env' && sec.declaredElsewhere.has(n)));
      let tool = null;
      if (existsSync(join(root, WORKER_SECRETS_TOOL))) {
        const r = spawnSync(process.execPath, [WORKER_SECRETS_TOOL, 'check'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
        tool = r.status;
      }
      if (missing.length) add(3, 'secrets', 'FAIL', `not declared: ${missing.join(', ')}`);
      else if (tool !== null && tool === 1) add(3, 'secrets', 'FAIL', `${WORKER_SECRETS_TOOL} check exit 1`);
      else if (tool !== null && tool !== 0) add(3, 'secrets', 'LOST', `${WORKER_SECRETS_TOOL} check exit ${tool}`);
      else add(3, 'secrets', 'PASS', `${names.length} name(s) declared (${sec.source === 'env' ? 'manifest absent, read interface Env' : 'manifest'}): ${names.join(', ')}`);
    }
  }

  // C4
  const paths = target.identity ?? [];
  if (!paths.length) add(4, 'identity', 'PASS', 'declares no identity fields');
  else {
    let id;
    try { id = JSON.parse(readFileSync(join(root, HOUSE_IDENTITY), 'utf8')); } catch (e) { id = null; add(4, 'identity', 'LOST', `${HOUSE_IDENTITY} could not be read (${e.message})`); }
    if (id) {
      const absent = paths.filter((p) => {
        let node = id;
        for (const k of p.split('.')) node = isObj(node) ? node[k] : undefined;
        return node === undefined || node === null || node === '';
      });
      if (absent.length) add(4, 'identity', 'FAIL', `absent from ${HOUSE_IDENTITY}: ${absent.join(', ')}`);
      else add(4, 'identity', 'PASS', `${paths.join(', ')} present in ${HOUSE_IDENTITY}`);
    }
  }

  // C5
  const suite = doc.conformance?.suite;
  const pending = (doc.conformance?.pending ?? []).filter((p) => p.adapter === target.id);
  if (!suite) add(5, 'conformance', 'FAIL', `${rel} has no conformance suite; no adapter of this port can be shown conformant`);
  else if (!target.conformance?.file) add(5, 'conformance', 'FAIL', `\`${target.id}\` names no conformance file`);
  else {
    const abs = join(root, target.conformance.file);
    const src = existsSync(abs) ? stripSourceComments(readFileSync(abs, 'utf8'), extname(abs).toLowerCase()) : null;
    if (src === null) add(5, 'conformance', 'FAIL', `${target.conformance.file} does not exist`);
    else if (!callsRunner(src, suite.runner, extname(abs))) add(5, 'conformance', 'FAIL', `${target.conformance.file} does not CALL ${suite.runner}${declares(src, suite.runner, extname(abs)) ? ' (it declares it — the call must be in the adapter\'s test)' : ''}`);
    else if (pending.length) add(5, 'conformance', 'FAIL', `${pending.length} pending case(s): ${pending.map((p) => `${p.case} (${p.row})`).join('; ')}`);
    else add(5, 'conformance', 'PASS', `${target.conformance.file} calls ${suite.runner}; nothing pending`);
  }

  // current adapter(s)
  let current;
  if (opts.from) current = adapters.filter((a) => a?.id === opts.from);
  else {
    const def = doc.selection?.default?.[env];
    if (def) current = adapters.filter((a) => a?.id === def);
    else current = adapters.filter((a) => a?.status !== 'fake' && a?.status !== 'retired' && a?.status !== 'draft' && (a?.environments ?? []).includes(env));
  }
  current = current.filter((a) => a.id !== target.id);

  // C6
  const unwritten = [...current, target].filter((a) => typeof a.exportDuty !== 'string' || a.exportDuty.trim().length < 20).map((a) => a.id);
  if (unwritten.length) add(6, 'export', 'FAIL', `no export duty written for: ${unwritten.join(', ')}`);
  else add(6, 'export', 'PASS', `written for ${[...current, target].map((a) => a.id).join(', ')}`);

  // C7
  if (opts.from && !current.length) add(7, 'standby', 'FAIL', `--from \`${opts.from}\` is not another adapter of ${rel}`);
  else if (!current.length) add(7, 'standby', 'FAIL', `no current adapter other than \`${target.id}\` in ${env}: nothing to fall back to`);
  else {
    const bad = current.filter((a) => a.status === 'retired' || (env === 'live' && a.status === 'fake'));
    if (bad.length) add(7, 'standby', 'FAIL', `${bad.map((a) => `${a.id} (${a.status})`).join(', ')} cannot become standby`);
    else add(7, 'standby', 'PASS', `${current.map((a) => a.id).join(', ')} would become standby (the rollback path)`);
  }

  // C8
  const m = margin(root, doc, target, current);
  add(8, 'margin', m.verdict, m.detail);
  return finish(checks, m.lines);
}

function finish(checks, extra = []) {
  const fail = checks.find((c) => c.verdict === 'FAIL');
  const lost = checks.find((c) => c.verdict === 'LOST');
  const decider = fail ?? lost;
  const code = fail ? 1 : lost ? 2 : 0;
  const out = [decider ? `port-switch: ${decider.verdict} — C${decider.n} ${decider.name}: ${decider.detail}` : `port-switch: PASS — all ${checks.length} checks pass (dry run; nothing was switched)`];
  for (const c of checks) out.push(`${c.verdict.padEnd(4)}  C${c.n} ${c.name}: ${c.detail}`);
  out.push(...extra);
  return { code, out };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`port-switch: REFUSED — ${opts.error}`);
    console.error('usage: node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run [--env live|sandbox|test] [--from <adapter>] [--root <dir>]');
    process.exit(2);
  }
  const { code, out } = run(opts);
  for (const l of out) (code ? console.error : console.log)(l);
  process.exit(code);
}

const IS_MAIN = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) main();
