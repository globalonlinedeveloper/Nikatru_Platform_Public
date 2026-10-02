#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// port-switch.mjs — the graded, READ-ONLY dry run of switching a port to
// another adapter. Phase 3 of the switch playbook in tooling/ports/README.md.
//
//   node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run
//        [--env live|sandbox|test] [--from <adapter>] [--root <repoRoot>]
//        [--export <file>]   (port `sql` only)
//
//   <port>      a tooling/ports/<port>.json registry.
//   --to        the adapter id the port would switch to.
//   --dry-run   REQUIRED. This tool never switches anything; without the flag
//               it refuses, so nobody mistakes it for the switch itself.
//   --env       the environment being switched (default live).
//   --from      the adapter being replaced; default: selection.default[env],
//               or — for a port selected per channel — every adapter that
//               serves a channel today.
//   --export    port `sql` only: ONE nightly D1 export (gzipped JSON lines,
//               services/platform/src/backup/), given locally — never fetched.
//
// One line per check, `PASS | FAIL | LOST  C<n> <name>: <detail>`, after ONE
// first line that names the check deciding the exit (the shape of
// tooling/ops/auth-cutover-preflight.mjs):
//   exit 1  any FAIL (a finding — do not switch);
//   exit 2  no FAIL, but some check could not look (COVERAGE LOST is not a pass),
//           or the invocation was refused;
//   exit 0  every check PASS.
//
// The eight, and for `sql` a ninth:
//   C1 target     the target row exists, carries the environment, and is not a
//                 `fake` for live
//   C2 status     its status (draft and retired cannot take traffic)
//   C3 secrets    its secret NAMES are declared (assert-ports.mjs's reader: the
//                 manifest, else interface Env); when tooling/ops/worker-secrets.mjs
//                 exists its `check --port <p> --adapter <a>` is run as well (one
//                 line per secret: name, presence, length, sha8). Values never print.
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
// ⏱ 2026-10-01 · port-pay-core · and, for `payments` only, four more:
//   C9 webhook    the URL the owner registers at the target's dashboard —
//                 https://<the platform Worker's own custom domain>/v1/money/<id>,
//                 read from services/platform/wrangler.jsonc for --env — and the
//                 target's secrets BY NAME. LOST when the env declares no route.
//   C10 prices    the price ids still to create per offering on the target rail
//                 (app-config-data.json `prices.*.rails.<id>`, via
//                 render-rail-prices.mjs `plan`). FAIL while any is missing.
//   C11 channels  the channels whose purchaseRails the switch would change. A channel moves
//                 only to an adapter of its billing KIND: a STORE-billed channel (a rail of a
//                 `cancel-store` adapter) only to another store biller, a web-billed one only
//                 to a web rail; C8 nets the same set.
//   C12 run-off   card and UPI mandates do not move: existing subscribers renew on
//                 the current rail until they lapse (each current adapter's
//                 export duty is printed). The reconcile during the dual run is
//                 alert-only.
// A MAIL switch (a port with `streams`) adds six, because what moves with mail
// is mostly not code (tooling/ports/README.md §5):
//   C9  dns       the records the target sends under — SPF include, DKIM,
//                 return-path MX, DMARC alignment — from tooling/mail-transport.json
//                 authRecords for its rail (verified by check-mail-auth-dns.mjs);
//                 an adapter with no rail yet lists what to publish, and FAILs
//   C10 domain    the domain verification step is written
//   C11 streams   each stream, the adapter it moves from and to, and the secret
//                 NAMES it would take; an external stream (auth's SMTP) is named
//                 as not moved by this switch
//   C12 suppression  the suppression list's export from the current adapter and
//                 import into the target are NAMED — FAIL until
//                 Private/runbooks/switch-vendor.md#mail names the method:
//                 mailing it from a new provider re-mails people who complained
//   C13 warming   sending reputation does not move; the target's warm-up is written
//   C14 cost      the per-stream monthly cost from tooling/ceilings.json's rows for
//                 the vendors; LOST when it records none (never a guess)
// A TELEMETRY switch adds one (port-telemetry, PORT_PLANS):
//   C9  plan      what else the switch moves: the DSN of every app build per
//                 channel — COMPILE-TIME by owner decision, so a crash-sink switch
//                 is an APP RELEASE on each of them — and of every Worker (a deploy
//                 var, so a redeploy); the release artefacts to re-upload (native
//                 symbols, web source maps); the monitors to recreate from
//                 tooling/monitor-register.json; and the owner-alert routes.
//                 LOST when a source cannot be read or yields nothing.
// A SQL switch adds one (port-sql, ⏱ 2026-10-02):
//   C9  replay    the --export file is loaded into a node:sqlite file built from
//                 the migrations of the database it names, and its table list and
//                 row counts are compared (tooling/ops/sql-export-replay.mjs). Each
//                 mismatch is a FAIL; no --export is LOST — the export duty
//                 unrehearsed is not a pass.
//
// It reads registries and nothing else: no network, no vault, no credential.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSecretSources, callsRunner, declares } from '../ci/assert-ports.mjs';
import { stripSourceComments } from '../ci/text-reductions.mjs';
import { readRegister, plan, netAfterFee, feeCurrencyProblem, FEE_REGISTER, CHANNEL_REGISTER, RAILS } from '../catalog/render-rail-prices.mjs';
import { railsOf, billsThroughStore, storeBilledRails } from '../ports/render.mjs';
import { readExportFile, replayExport } from './sql-export-replay.mjs';

export const NO_VALUE_FLAGS = new Set(['--dry-run']);
export const VALUE_FLAGS = new Set(['--to', '--env', '--from', '--root', '--export']);
/** The ports whose dry run replays an export (C9). */
export const EXPORT_REPLAY_PORTS = new Set(['sql']);
export const HOUSE_IDENTITY = 'tooling/house-identity.json';
export const WORKER_SECRETS_TOOL = 'tooling/ops/worker-secrets.mjs';
const ENVS = new Set(['live', 'sandbox', 'test']);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const money = (minor) => `${minor < 0 ? '-' : ''}${Math.trunc(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;

/** Parse argv. Every flag is declared; a no-value flag never eats the next argument (shell-13). */
export function parseArgs(argv) {
  const out = { port: null, to: null, env: 'live', from: null, root: null, export: null, dryRun: false };
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
  if (out.export !== null && !EXPORT_REPLAY_PORTS.has(out.port)) return { error: `--export is for ${[...EXPORT_REPLAY_PORTS].join(', ')}; the ${out.port} port has no export to replay` };
  return out;
}

/** The fee an adapter charges on one sale of `price` on a channel of `rail`, or {lost}. */
export function feeFor(adapter, rail, price, cells) {
  const ids = adapter?.cost?.feeCells ?? [];
  // A declared per-SALE unit cost (e.g. the fake rail's 0 USD) is a fee, not a guess.
  const unit = adapter?.cost?.unit;
  if (!ids.length && isObj(unit) && unit.per === 'sale' && Number.isFinite(unit.usd) && unit.usd >= 0) {
    return { fee: { percentBps: 0, fixedMinor: Math.round(unit.usd * 100) }, cells: [`unit (${unit.usd} USD per sale, as of ${unit.asOf})`] };
  }
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

// The rails an adapter serves, whether it bills through a store, and the store-billed rails it
// derives: ONE copy, in tooling/ports/render.mjs, because the client's rail kind per channel
// (its Dart render) reads the same predicate this move rule does (port-pay-client).
export { billsThroughStore, storeBilledRails };

/**
 * Can a channel billed on `rail` move to `target` at all? Only to an adapter that serves its
 * billing KIND, both ways: a store-billed channel moves only to a store biller, and a web-billed
 * channel (web, desktop, extension) only to a web rail — a store aggregator cannot bill a page
 * the store never sees (#1127 re-review, nit A).
 */
export const canMoveTo = (rail, target, stores) => stores.has(rail) === billsThroughStore(target);

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

  const stores = storeBilledRails(doc.adapters, cells);
  const lostWhy = [];
  let rows = 0;
  let lower = 0;
  let delta = 0;
  for (const ch of channels) {
    const rail = ch.purchaseRail.rail;
    const cur = current.find((a) => railsOf(a, cells).has(rail));
    if (!cur || cur.id === target.id) continue;
    // The same set C11 moves: a channel moves only to an adapter of its billing kind, so the rest net nothing.
    if (!canMoveTo(rail, target, stores)) continue;
    lines.push(`    ${ch.id} (${rail}): ${cur.id} → ${target.id}`);
    const onStore = stores.has(rail);
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
  else if (!(target.environments ?? []).length) add(1, 'target', 'FAIL', `\`${target.id}\` is ${target.status} (status: ${target.status}) and lists no environment: no environment may select it`);
  else if (!(target.environments ?? []).includes(env)) add(1, 'target', 'FAIL', `\`${target.id}\` does not list the ${env} environment (${(target.environments ?? []).join(', ')})`);
  else add(1, 'target', 'PASS', `\`${target.id}\` (${target.vendor ? `vendor ${target.vendor}` : typeof target.channel === 'string' ? `channel ${target.channel} — the store is that ${CHANNEL_REGISTER} row's` : 'vendor none — a fake'}) is a row of ${rel} for ${env}`);
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
        const r = spawnSync(process.execPath, [WORKER_SECRETS_TOOL, 'check', '--port', doc.port, '--adapter', target.id, '--root', root], { cwd: root, encoding: 'utf8', timeout: 120_000 });
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
  const extra = [...m.lines];
  for (const p of pending) extra.push(`FAIL  C5 pending: ${p.case} (${p.row})`);
  if (opts.port === 'payments') {
    const w = webhook(root, env, target);
    add(9, 'webhook', w.verdict, w.detail);
    const pr = pricesToCreate(root, target);
    add(10, 'prices', pr.verdict, pr.detail);
    extra.push(...pr.lines);
    const ch = channelsChanging(root, target, current, adapters);
    add(11, 'channels', ch.verdict, ch.detail);
    add(12, 'run-off', 'PASS', `a RUN-OFF, not a cutover: card and UPI mandates do not move, so subscribers on ${current.map((a) => a.id).join(', ') || 'the current rail'} renew there until they lapse; the dual run lasts the longest live term, and its reconcile is alert-only`);
    for (const a of current) extra.push(`    run-off ${a.id}: ${a.exportDuty}`);
  }
  if (isObj(doc.streams)) mailChecks(root, doc, target, current, add);
  // C9 — the export duty, rehearsed (port `sql`)
  if (EXPORT_REPLAY_PORTS.has(opts.port)) {
    if (!opts.export) add(9, 'replay', 'LOST', 'no --export <file>: the nightly export was not replayed, so the export duty is unrehearsed');
    else {
      let text = null;
      try { text = readExportFile(resolve(root, opts.export)); } catch (e) { add(9, 'replay', 'LOST', `${opts.export} could not be read (${e.message})`); }
      if (text !== null) {
        const r = replayExport({ root, jsonl: text });
        add(9, 'replay', r.verdict, r.detail);
        extra.push(...r.lines);
      }
    }
  }
  // C9 — a port's own switch plan, when it has one (PORT_PLANS)
  const planFor = Object.hasOwn(PORT_PLANS, opts.port) ? PORT_PLANS[opts.port] : undefined;
  if (planFor) {
    const p = planFor(root, doc, target, current);
    add(9, 'plan', p.verdict, p.detail);
    extra.push(...p.lines);
  }
  return finish(checks, extra);
}

export const PLATFORM_REGISTER = 'tooling/platform-register.json';
export const MONITOR_REGISTER = 'tooling/monitor-register.json';
/** The release artefacts a crash sink needs re-uploaded to make old releases readable. */
export const TELEMETRY_UPLOADERS = ['tooling/ops/upload-native-symbols.mjs', 'tooling/ops/upload-web-sourcemaps.mjs'];

/**
 * C9 for `telemetry`: everything a crash-sink or alert switch moves besides the
 * registry row. Reads tooling/channel-register.json (crashSink per channel),
 * tooling/platform-register.json (dsnSecret per Worker), tooling/monitor-register.json
 * (the monitors) and the port's own Notifier rows. Never a DSN value — names only.
 */
export function telemetryPlan(root, doc, target, current) {
  const lines = [];
  const lost = [];
  const read = (rel) => { try { return JSON.parse(readFileSync(join(root, rel), 'utf8')); } catch (e) { lost.push(`${rel} could not be read (${e.message})`); return null; } };
  const ch = read(CHANNEL_REGISTER);
  const plat = read(PLATFORM_REGISTER);
  const mon = read(MONITOR_REGISTER);
  const lang = (a) => (/\.dart$/.test(a?.impl?.file ?? '') ? 'dart' : /\.ts$/.test(a?.impl?.file ?? '') ? 'ts' : null);
  const touches = new Set([target, ...current].map(lang).filter(Boolean));

  // the app half: one DSN per build, compile-time
  const appRows = (ch?.channels ?? []).filter((c) => (c?.crashSink?.layers ?? []).includes('dart'));
  lines.push(`    ── app builds (${touches.has('dart') ? 'TOUCHED by this switch' : 'not touched: the target is a Worker adapter'}) ──`);
  lines.push('    GLITCHTIP_DSN is COMPILE-TIME (owner decision 2026-07-27, capability-register glitchtip.configKeyed): a new crash sink for the apps is an APP RELEASE on every channel below, and builds already in the field keep reporting to the old sink until users update.');
  for (const c of appRows) lines.push(`      ${c.id.padEnd(16)} GLITCHTIP_DSN (--dart-define) → release this channel`);
  for (const c of (ch?.channels ?? []).filter((x) => !(x?.crashSink?.layers ?? []).includes('dart'))) lines.push(`      ${String(c.id).padEnd(16)} no Dart crash sink declared (${c.crashSink ? 'crashSink.layers is empty' : 'no crashSink row'}) — nothing to repoint`);
  if (ch && !appRows.length) lost.push(`${CHANNEL_REGISTER} names no channel whose crashSink carries the dart layer`);

  // the Worker half: one DSN per Worker, a deploy var
  const workers = [plat?.servingWorker, ...(plat?.appWorkers ?? [])].filter((w) => w && typeof w.dsnSecret === 'string');
  lines.push(`    ── Workers (${touches.has('ts') ? 'TOUCHED by this switch' : 'not touched: the target is an app adapter'}) ──`);
  for (const w of workers) lines.push(`      ${String(w.worker ?? w.id ?? w.name ?? '?').padEnd(24)} ${w.dsnSecret} (deploy var) → set it and REDEPLOY; no app release`);
  if (plat && !workers.length) lost.push(`${PLATFORM_REGISTER} names no Worker with a dsnSecret`);

  // releases and symbols
  lines.push('    ── release artefacts to re-upload to the new sink, per release still in the field ──');
  for (const u of TELEMETRY_UPLOADERS) {
    if (existsSync(join(root, u))) lines.push(`      node ${u}`);
    else lost.push(`${u} does not exist; the symbol re-upload path is unknown`);
  }

  // monitors
  const hosts = Array.isArray(mon?.hosts) ? mon.hosts : [];
  const withMonitor = hosts.filter((h) => h?.monitor && h.monitor.id !== undefined && h.monitor.id !== null);
  lines.push(`    ── monitors to recreate from ${MONITOR_REGISTER} (node tooling/ops/ensure-monitors.mjs --apply, through tooling/ops/monitor-api/) ──`);
  const byId = new Map();
  for (const h of withMonitor) byId.set(h.monitor.id, { type: h.monitor.type, hosts: [...(byId.get(h.monitor.id)?.hosts ?? []), h.hostname] });
  for (const [id, m] of byId) lines.push(`      #${String(id).padEnd(4)} ${String(m.type ?? '?').padEnd(9)} ${m.hosts.join(', ')}`);
  const pending = hosts.length - withMonitor.length;
  if (pending) lines.push(`      (${pending} host row(s) with no monitor yet — ensure-monitors creates those too)`);
  lines.push('      the heartbeat URLs (PLATFORM_CRON_HEARTBEAT_URL, OPS_WATCHDOG_HEARTBEAT_URL, OPS_STUCK_RUNS_HEARTBEAT_URL) are Worker secrets: re-set each to the new monitor\'s URL.');
  if (mon && !withMonitor.length) lost.push(`${MONITOR_REGISTER} holds no monitor id`);

  // owner alerts
  const notifiers = (doc.adapters ?? []).filter((a) => (a.capabilities ?? []).includes('notify'));
  lines.push('    ── owner alerts (services/_shared/src/ports/telemetry.ts NOTIFIER_ROUTES; a route change, never a caller change) ──');
  for (const n of notifiers) lines.push(`      ${n.id.padEnd(14)} ${n.status.padEnd(6)} ${(n.secrets ?? []).join(', ') || 'no secret'}`);

  // cost and history
  const unit = (a) => (a?.cost?.unit ? `${a.cost.unit.usd} USD per ${a.cost.unit.per} (asOf ${a.cost.unit.asOf})` : 'no unit cost recorded');
  lines.push(`    ── cost delta: ${current.map((c) => `${c.id}: ${unit(c)}`).join('; ') || 'no current adapter'} → ${target.id}: ${unit(target)} ──`);
  lines.push('    ── export: the issue history is a diagnostic stream — export it optionally; never block the switch on it ──');

  if (lost.length) return { verdict: 'LOST', detail: lost[0], lines };
  return {
    verdict: 'PASS',
    detail: `${appRows.length} app build(s) need a release if the app sink moves; ${workers.length} Worker(s) a redeploy; ${TELEMETRY_UPLOADERS.length} uploader(s); ${byId.size} monitor(s) to recreate`,
    lines,
  };
}

/** Port-specific C9 plans, by port. */
export const PORT_PLANS = Object.freeze({ telemetry: telemetryPlan });


/** C9 · the webhook URL to register: the platform Worker's own custom domain for `env`. */
export function webhook(root, env, target) {
  const rel = 'services/platform/wrangler.jsonc';
  // `env` arrives from the command line through an EXPORTED function, so it is
  // allowlisted HERE (shape, then membership) and never becomes a RegExp: the env block
  // is found by comparing each `"<key>": {` key to it as a string (#1127, CodeQL #546
  // js/regex-injection).
  if (typeof env !== 'string' || !/^[a-z0-9-]+$/.test(env) || !ENVS.has(env)) {
    return { verdict: 'FAIL', detail: `--env ${JSON.stringify(env)} is not a declared environment (${[...ENVS].join(', ')})` };
  }
  let raw;
  try { raw = stripSourceComments(readFileSync(join(root, rel), 'utf8'), '.jsonc'); } catch (e) { return { verdict: 'LOST', detail: `${rel} could not be read (${e.message})` }; }
  const name = /"name"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
  const envAt = raw.search(/"env"\s*:\s*\{/);
  let scope;
  if (env === 'live') scope = envAt >= 0 ? raw.slice(0, envAt) : raw;
  else {
    const block = envAt >= 0 ? [...raw.slice(envAt).matchAll(/"([a-z0-9-]+)"\s*:\s*\{/g)].find((m) => m[1] === env) : undefined;
    const at = block === undefined ? -1 : block.index;
    scope = at >= 0 ? raw.slice(envAt + at) : '';
  }
  const domains = [...scope.matchAll(/"pattern"\s*:\s*"([^"]+)"\s*,\s*"custom_domain"\s*:\s*true/g)].map((x) => x[1]);
  const host = domains.find((d) => name && d.split('.')[0] === name);
  const secrets = (target.secrets ?? []).length ? `secrets by name: ${target.secrets.join(', ')}` : 'no secrets';
  if (!host) return { verdict: 'LOST', detail: `${rel} declares no custom domain named for the Worker (\`${name ?? '?'}\`) in ${env === 'live' ? 'its top-level routes' : `env.${env}`}; ${secrets}` };
  return { verdict: 'PASS', detail: `register https://${host}/v1/money/${target.id} at ${target.vendor ?? 'no vendor (a fake)'}; ${secrets}` };
}

/** C10 · the rail price ids still to create for the target, per served offering. */
export function pricesToCreate(root, target) {
  const lines = [];
  const reg = readRegister(root);
  if (!reg.ok) return { verdict: 'LOST', detail: reg.why, lines };
  const { book, lost } = plan(root, reg.data);
  if (lost.length) return { verdict: 'LOST', detail: lost[0], lines };
  const priced = book.some(({ offerings }) => offerings.some((o) => isObj(o.entry?.rails) && target.id in o.entry.rails));
  if (target.status === 'fake') return { verdict: 'PASS', detail: `\`${target.id}\` is a fake: it creates no price at any vendor`, lines };
  if (!priced && !RAILS.includes(target.id)) return { verdict: 'PASS', detail: `\`${target.id}\` keeps no rail price map in ${FEE_REGISTER.replace(/fee-register\.json$/, '')}… (its prices live with the store it fronts)`, lines };
  let missing = 0;
  let total = 0;
  for (const { app, offerings } of book) {
    for (const o of offerings) {
      total++;
      const r = isObj(o.entry?.rails) ? o.entry.rails[target.id] : undefined;
      if (isObj(r) && !('pending' in r)) continue;
      missing++;
      lines.push(`    to create on ${target.id}: ${app} ${o.id}${isObj(r) && typeof r.pending === 'string' ? ` — ${r.pending}` : ' — no price id recorded'}`);
    }
  }
  if (!total) return { verdict: 'LOST', detail: 'the price register yields no served offering', lines };
  return missing
    ? { verdict: 'FAIL', detail: `${missing} of ${total} offering(s) have no ${target.id} price id yet (the owner creates them; never this tool)`, lines }
    : { verdict: 'PASS', detail: `all ${total} offering(s) carry a ${target.id} price id`, lines };
}

/** C11 · the channels whose purchaseRails the switch would change. */
export function channelsChanging(root, target, current, adapters = [...current, target]) {
  let feeDoc;
  let channels;
  try { feeDoc = JSON.parse(readFileSync(join(root, FEE_REGISTER), 'utf8')); } catch (e) { return { verdict: 'LOST', detail: `${FEE_REGISTER} could not be read (${e.message})` }; }
  try { channels = JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8')).channels ?? []; } catch (e) { return { verdict: 'LOST', detail: `${CHANNEL_REGISTER} could not be read (${e.message})` }; }
  const cells = isObj(feeDoc?.cells) ? feeDoc.cells : {};
  const served = new Set(current.flatMap((a) => [...railsOf(a, cells)]));
  const stores = storeBilledRails(adapters, cells);
  const leaving = channels.filter((c) => typeof c?.purchaseRail?.rail === 'string' && served.has(c.purchaseRail.rail) && !railsOf(target, cells).has(c.purchaseRail.rail));
  const moving = leaving.filter((c) => canMoveTo(c.purchaseRail.rail, target, stores));
  const held = leaving.filter((c) => !canMoveTo(c.purchaseRail.rail, target, stores));
  const heldStore = held.filter((c) => stores.has(c.purchaseRail.rail));
  const heldWeb = held.filter((c) => !stores.has(c.purchaseRail.rail));
  const named = (cs) => cs.map((c) => `${c.id} (${c.purchaseRail.rail})`).join(', ');
  const heldNote = [
    heldStore.length ? `; ${heldStore.length} store-billed channel(s) stay on their store's billing, which \`${target.id}\` cannot take: ${named(heldStore)}` : '',
    heldWeb.length ? `; ${heldWeb.length} web-billed channel(s) stay on a web rail, which \`${target.id}\` (a store biller) cannot take: ${named(heldWeb)}` : '',
  ].join('');
  if (!moving.length) return { verdict: 'PASS', detail: `no channel's purchaseRail changes${heldNote}` };
  return { verdict: 'PASS', detail: `${moving.length} channel(s) would change purchaseRail: ${moving.map((c) => `${c.id} (${c.purchaseRail.rail} → ${target.id})`).join(', ')}${heldNote}` };
}

export const MAIL_TRANSPORT = 'tooling/mail-transport.json';
export const CEILINGS = 'tooling/ceilings.json';
const DNS_KINDS = ['spf', 'dkim', 'mx', 'dmarc'];
const DNS_LABEL = { spf: 'SPF include', dkim: 'DKIM', mx: 'return-path MX', dmarc: 'DMARC alignment' };

/** C9–C14 · what a mail switch moves besides code. */
export function mailChecks(root, doc, target, current, add) {
  const d = target.delivery;
  if (target.status === 'fake') {
    // A fake delivers nothing: no DNS, no domain, no list to import, no reputation.
    for (const [n, name] of [[9, 'dns'], [10, 'domain'], [11, 'streams'], [12, 'suppression'], [13, 'warming'], [14, 'cost']]) add(n, name, 'PASS', `\`${target.id}\` is a fake: it sends nothing`);
    return;
  }
  // C9
  if (!isObj(d)) add(9, 'dns', 'FAIL', `\`${target.id}\` records no \`delivery\`: the DNS it needs is unwritten`);
  else if (d.rail) {
    let recs = null;
    try { recs = JSON.parse(readFileSync(join(root, MAIL_TRANSPORT), 'utf8'))?.authRecords?.records; } catch (e) { add(9, 'dns', 'LOST', `${MAIL_TRANSPORT} could not be read (${e.message})`); }
    if (Array.isArray(recs)) {
      const rows = recs.filter((r) => r?.rail === d.rail || r?.kind === 'dmarc');
      const have = new Set(rows.map((r) => r.kind));
      const missing = DNS_KINDS.filter((k) => !have.has(k));
      const list = rows.map((r) => `${DNS_LABEL[r.kind] ?? r.kind} ${r.name}`).join('; ');
      if (missing.length) add(9, 'dns', 'FAIL', `rail \`${d.rail}\` in ${MAIL_TRANSPORT} lacks ${missing.map((k) => DNS_LABEL[k]).join(', ')} (has: ${list || 'nothing'})`);
      else add(9, 'dns', 'PASS', `rail \`${d.rail}\`: ${list} — verify: node tooling/ops/check-mail-auth-dns.mjs`);
    } else if (recs !== null) add(9, 'dns', 'LOST', `${MAIL_TRANSPORT} has no authRecords.records`);
  } else {
    const need = d.dnsNeeded ?? [];
    const missing = DNS_KINDS.filter((k) => !need.some((r) => r.kind === k));
    const list = need.map((r) => `${DNS_LABEL[r.kind]} ${r.name} → ${r.expect}`).join('; ');
    add(9, 'dns', 'FAIL', `\`${target.id}\` has no rail in ${MAIL_TRANSPORT}: publish and declare ${missing.length ? `(and first write ${missing.map((k) => DNS_LABEL[k]).join(', ')}) ` : ''}${list || 'its records'}`);
  }
  // C10
  if (isObj(d) && typeof d.domainVerification === 'string' && d.domainVerification.length >= 20) add(10, 'domain', 'PASS', d.domainVerification);
  else add(10, 'domain', 'FAIL', `\`${target.id}\` records no domain verification step`);
  // C11
  const moving = new Set(current.map((a) => a.id));
  const lines = [];
  for (const [name, st] of Object.entries(doc.streams)) {
    const a = (doc.adapters ?? []).find((x) => x?.id === st?.adapter);
    if (a?.status === 'external') lines.push(`${name}: ${a.id} (external, ${a.impl?.configAt ?? 'configured elsewhere'}) — not moved by this switch; its own switch is that config plus DNS`);
    else if (moving.has(st?.adapter)) lines.push(`${name}: ${st.adapter} → ${target.id}, secrets ${(target.secrets ?? []).join(', ') || 'none'} (today ${(st.secrets ?? []).join(' else ') || 'none'})`);
    else lines.push(`${name}: stays on ${st?.adapter}`);
  }
  add(11, 'streams', 'PASS', lines.join('; '));
  // C12
  const unnamed = [];
  for (const c of current) if (!(isObj(c.delivery?.suppression) && c.delivery.suppression.export)) unnamed.push(`export from \`${c.id}\``);
  if (!(isObj(d?.suppression) && d.suppression.import)) unnamed.push(`import into \`${target.id}\``);
  if (unnamed.length) add(12, 'suppression', 'FAIL', `the suppression list (bounces, complaints, unsubscribes) must move with the switch, and no method is named for: ${unnamed.join(', ')}. Private/runbooks/switch-vendor.md#mail names it; record it in \`delivery.suppression\``);
  else add(12, 'suppression', 'PASS', `export: ${current.map((c) => c.delivery.suppression.export).join('; ')} → import: ${d.suppression.import}`);
  // C13
  if (isObj(d) && typeof d.warming === 'string' && d.warming.length >= 20) add(13, 'warming', 'PASS', `sending reputation does not move — ${d.warming}`);
  else add(13, 'warming', 'FAIL', `\`${target.id}\` records no warm-up; sending reputation does not move`);
  // C14
  let ceilings;
  try { ceilings = JSON.parse(readFileSync(join(root, CEILINGS), 'utf8')); } catch (e) { add(14, 'cost', 'LOST', `${CEILINGS} could not be read (${e.message})`); return; }
  const vendors = [...new Set([...current, target].map((a) => a.vendor).filter(Boolean))];
  const found = [];
  const walk = (v, at) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (isObj(v)) {
      if (vendors.some((vd) => v.vendor === vd || (typeof v.id === 'string' && v.id.toLowerCase().includes(vd)))) found.push(at);
      for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    }
  };
  walk(ceilings, '$');
  if (!found.length) add(14, 'cost', 'LOST', `${CEILINGS} records no row for ${vendors.join(' or ')}; the per-stream monthly cost is not derived (never a guess)`);
  else add(14, 'cost', 'PASS', `${CEILINGS} rows for ${vendors.join(', ')}: ${found.join(', ')} — read each stream's monthly volume against them`);
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
    console.error('usage: node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run [--env live|sandbox|test] [--from <adapter>] [--root <dir>] [--export <file>]');
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
