#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// box-move.mjs — the graded, READ-ONLY dry run of moving a box to another host.
// Phase 3 of the switch playbook (tooling/ports/README.md §4) for the `boxes`
// port: a host change turned into a LIST, so a renewal price that roughly
// doubles is a decision, not a crisis.
//
//   node tooling/ops/box-move.mjs --from <box> --to <spec.json> --dry-run
//        [--private <dir>] [--root <repoRoot>]
//
//   --from     a declared box (tooling/boxes/<box>.json).
//   --to       the target's spec, a JSON file the operator writes:
//              {"name", "provider": {"vendor", "plan"}, "cpu", "ramGiB",
//               "diskGiB", "cost": {"monthlyUsd"} | null}
//   --dry-run  REQUIRED. This never moves anything; without it, it refuses.
//   --private  the Private checkout, for the cost (default: the sibling
//              ../Nikatru_Platform_Private, or $NIKATRU_PRIVATE_DIR).
//
// One line per check, `PASS | FAIL | LOST  C<n> <name>: <detail>`, after ONE
// first line naming the check that decides the exit (port-switch.mjs's shape):
//   C1 capacity    the declared services' measured `use` × HEADROOM fits the
//                  target (FAIL when it does not). With a service's use
//                  unmeasured: PASS when the target is at least the source's
//                  declared shape (what runs today fits by construction), else
//                  LOST. Use is recorded from check-box-declared --print-observed.
//   C2 dns         the records to move: a tunnel CNAME does not change (the
//                  connector moves, with its secret NAME); an A/AAAA record is
//                  repointed to the target's declared address.
//   C3 allow-lists every IP allow-list that pins the box's address (the address
//                  cannot move, so every allow-list moves with the box). FAIL for
//                  each one the OWNER holds — an owner step; an operator's is listed.
//   C4 backups     the sets to restore first, each with its drill command; a set
//                  without a drill is FAIL, a drill whose file or hash is UNREAD
//                  is LOST.
//   C5 monitors    the monitors to repoint, by id (cited, never restated).
//   C6 secrets     the secrets the services need — NAMES only, from the vault.
//   C7 cost        the monthly delta when Private platform-state/identity.json
//                  is readable (by the declaration's vendorId); else LOST (CI
//                  cannot read Private).
// Exit 1 on any FAIL, 2 on any LOST (or a refusal), 0 only when every check
// passes. It reads files and nothing else: no network, no box, no credential.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAll, readCited, ROLES_REL } from './box-declaration.mjs';

/** The target must hold the measured use with this much to spare. */
export const HEADROOM = 1.25;
export const IDENTITY_REL = 'platform-state/identity.json';
export const PHASES = Object.freeze([
  'decide (an ADR names the target, the reason and the cost delta)',
  'build (the target box, its declaration tooling/boxes/<box>.json, read back green)',
  'dry run (this command, exit 0 or every FAIL an owner step already taken)',
  'dual run: the new box serves, the old stays standby for 7 days',
  'cutover (tooling/boxes/roles.json names the new box; DNS or the tunnel moves)',
  'retire (the old box: its secrets revoked, its allow-list entries removed, its declaration deleted)',
]);

export function parseArgs(argv) {
  const out = { from: null, to: null, private: null, root: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (['--from', '--to', '--private', '--root'].includes(a)) {
      const v = argv[i + 1];
      if (v === undefined) return { error: `${a} needs a value` };
      if (v.startsWith('--')) return { error: `${a} was given ${JSON.stringify(v)}, which is a flag, not a value` };
      out[a.slice(2)] = v;
      i++;
      continue;
    }
    return { error: `unexpected argument ${JSON.stringify(a)}` };
  }
  if (!out.from || !out.to) return { error: '--from <box> and --to <spec.json> are both required' };
  if (!out.dryRun) return { error: 'refused without --dry-run: this tool never moves a box, and it says so by refusing to run as if it might' };
  return out;
}

/** The target spec, or {error}. */
export function readTarget(path) {
  let t;
  try { t = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { error: `the target spec ${path} could not be read (${e.message})` }; }
  for (const k of ['cpu', 'ramGiB', 'diskGiB']) if (!(typeof t?.[k] === 'number' && t[k] > 0)) return { error: `the target spec needs a positive \`${k}\`` };
  if (typeof t?.name !== 'string' || !t.name) return { error: 'the target spec needs a `name`' };
  return { target: t };
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A monthly figure for `vendorId` in Private identity.json: {usd, path} or {lost}. Values are read, never written anywhere. */
export function monthlyCostFor(identity, vendorId) {
  const entries = [];
  const visit = (v, path, inVendor) => {
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`, inVendor || (isObj(x) && (x.id === vendorId || x.vendor === vendorId))));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`, inVendor || k === vendorId);
    else if (inVendor && typeof v === 'number') entries.push({ path, value: v });
  };
  visit(identity, '$', false);
  const pick = (re) => entries.find((e) => re.test(e.path) && /usd/i.test(e.path) && !/renew/i.test(e.path));
  const hit = pick(/month/i);
  if (!hit) return { lost: `no monthly USD figure under vendor \`${vendorId}\` (read ${entries.length} numeric field(s))` };
  const renewal = entries.find((e) => /renew/i.test(e.path) && /month/i.test(e.path) && /usd/i.test(e.path));
  return { usd: hit.value, path: hit.path, renewalUsd: renewal?.value ?? null };
}

export function run(opts) {
  const root = resolve(opts.root ?? process.cwd());
  const checks = [];
  const add = (n, name, verdict, detail, lines = []) => checks.push({ n, name, verdict, detail, lines });
  const v = validateAll(root);
  if (v.errors.length) return { code: 2, out: [`box-move: LOST — the declarations do not validate: ${v.errors[0]}`] };
  const doc = v.boxes.get(opts.from);
  if (!doc) return { code: 2, out: [`box-move: REFUSED — no declaration tooling/boxes/${opts.from}.json (declared: ${[...v.boxes.keys()].join(', ')})`] };
  const t = readTarget(resolve(opts.to));
  if (t.error) return { code: 2, out: [`box-move: REFUSED — ${t.error}`] };
  const target = t.target;
  const cited = readCited(root);

  // C1 capacity
  const svcs = doc.services ?? [];
  const unmeasured = svcs.filter((s) => s.use === null).map((s) => s.id);
  const sum = { cpu: 0, ramGiB: 0, diskGiB: 0 };
  for (const s of svcs) if (s.use) for (const k of Object.keys(sum)) sum[k] += s.use[k];
  const short = Object.keys(sum).filter((k) => sum[k] * HEADROOM > target[k]);
  const fmt = (o) => `${o.cpu} CPU, ${o.ramGiB} GiB RAM, ${o.diskGiB} GiB disk`;
  if (short.length) add(1, 'capacity', 'FAIL', `the measured use of ${svcs.length - unmeasured.length} declared service(s) is ${fmt(sum)}; ×${HEADROOM} it does not fit the target ${target.name} (${fmt(target)}) in ${short.join(', ')}`);
  else if (!svcs.length) add(1, 'capacity', 'PASS', `${doc.box} declares no service: nothing to fit`);
  else if (unmeasured.length) {
    const src = doc.spec ?? {};
    const atLeast = ['cpu', 'ramGiB', 'diskGiB'].every((k) => typeof src[k] === 'number' && target[k] >= src[k]);
    if (atLeast) add(1, 'capacity', 'PASS', `${unmeasured.length} service(s) unmeasured, and the target (${fmt(target)}) is at least ${doc.box}'s declared shape (${fmt(src)}): what runs today fits by construction`);
    else add(1, 'capacity', 'LOST', `${unmeasured.length} service(s) have no measured use (${unmeasured.join(', ')}) and the target is smaller than ${doc.box}'s declared shape: record \`use\` from check-box-declared --print-observed`);
  } else add(1, 'capacity', 'PASS', `measured ${fmt(sum)} ×${HEADROOM} fits ${fmt(target)}`);

  // C2 dns
  const dns = (doc.hostnames ?? []).map((h) => (h.record === 'tunnel-cname'
    ? `${h.name}: no record change — start the tunnel connector on ${target.name} with secret ${doc.tunnel?.secret}, stop the old connector after the dual run`
    : `${h.name}: repoint the ${h.record} record to ${target.name}'s declared address`));
  add(2, 'dns', 'PASS', dns.length ? `${dns.length} record(s) to move` : `${doc.box} serves no hostname`, dns);

  // C3 allow-lists
  const lists = doc.allowLists ?? [];
  const ownerSteps = lists.filter((a) => a.owner === 'owner');
  const lines3 = lists.map((a) => `${a.owner === 'owner' ? 'OWNER STEP' : 'operator'}: ${a.id} — ${a.where}${a.row ? ` (${a.row})` : ''}; verify: ${a.verify}`);
  if (ownerSteps.length) add(3, 'allow-lists', 'FAIL', `${lists.length} allow-list(s) pin ${doc.box}'s address; ${ownerSteps.length} is the owner's to update (${ownerSteps.map((a) => a.id).join(', ')})`, lines3);
  else add(3, 'allow-lists', 'PASS', lists.length ? `${lists.length} allow-list(s) pin ${doc.box}'s address, each the operator's: update with the move` : `no allow-list pins ${doc.box}'s address`, lines3);

  // C4 backups
  const dests = new Map((v.backups.destinations ?? []).map((d) => [d.id, d]));
  const sets = (v.backups.sets ?? []).filter((s) => s.box === doc.box || (doc.backupSets ?? []).includes(s.id) || s.destinations.some((d) => dests.get(d)?.box === doc.box));
  const noDrill = sets.filter((s) => !s.drill);
  const unread = sets.filter((s) => s.drill && (!s.drill.file || !s.drill.hash));
  const lines4 = sets.map((s) => `${s.id} (from ${s.drill?.from ?? 'nowhere'}): node tooling/ops/restore-drill.mjs ${s.id} --to <scratch dir>${s.drill && (!s.drill.file || !s.drill.hash) ? '   ⬜ drill UNREAD: name its file and hash source in tooling/boxes/backups.json' : ''}`);
  if (noDrill.length) add(4, 'backups', 'FAIL', `${noDrill.length} set(s) have no drill: ${noDrill.map((s) => s.id).join(', ')}`, lines4);
  else if (unread.length) add(4, 'backups', 'LOST', `${sets.length} set(s) to restore first; ${unread.length} drill(s) cannot run yet (${unread.map((s) => s.id).join(', ')})`, lines4);
  else add(4, 'backups', 'PASS', sets.length ? `${sets.length} set(s) to restore first, each with a drill` : `${doc.box} holds no backup set`, lines4);

  // C5 monitors
  const missing = (doc.monitors ?? []).filter((m) => !cited.monitors.has(m));
  const lines5 = (doc.monitors ?? []).map((m) => `monitor ${m}: ${cited.monitors.get(m) ?? 'NOT IN THE REGISTERS'}`);
  if (missing.length) add(5, 'monitors', 'FAIL', `monitor(s) ${missing.join(', ')} are cited and no longer in the registers`, lines5);
  else add(5, 'monitors', 'PASS', `${lines5.length} monitor(s) to repoint or re-home`, lines5);

  // C6 secrets
  const names = new Set();
  for (const s of svcs) for (const n of s.secrets ?? []) names.add(n);
  if (doc.tunnel?.secret) names.add(doc.tunnel.secret);
  for (const s of sets) for (const d of s.destinations) for (const e of dests.get(d)?.box === doc.box ? dests.get(d).env ?? [] : []) for (const n of [e].flat()) names.add(n);
  add(6, 'secrets', 'PASS', names.size ? `${names.size} secret NAME(s) to carry from the vault: ${[...names].sort().join(', ')}` : 'no secret declared');

  // C7 cost
  const privDir = opts.private ?? process.env.NIKATRU_PRIVATE_DIR ?? join(dirname(root), 'Nikatru_Platform_Private');
  const idPath = join(privDir, IDENTITY_REL);
  // One read, no existsSync first (CodeQL js/file-system-race): a missing file is LOST.
  let idText = null;
  try { idText = readFileSync(idPath, 'utf8'); } catch (e) {
    if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') throw e;
  }
  if (idText === null) add(7, 'cost', 'LOST', `Private ${IDENTITY_REL} is not readable here (CI cannot read Private): the delta is not known`);
  else {
    let identity;
    try { identity = JSON.parse(idText); } catch (e) { identity = null; add(7, 'cost', 'LOST', `Private ${IDENTITY_REL} could not be parsed (${e.message})`); }
    if (identity) {
      const from = monthlyCostFor(identity, doc.cost.vendorId);
      const to = typeof target.cost?.monthlyUsd === 'number' ? { usd: target.cost.monthlyUsd } : target.provider?.vendor ? monthlyCostFor(identity, target.provider.vendor) : { lost: 'the target spec carries no cost.monthlyUsd and no provider.vendor' };
      if (from.lost || to.lost) add(7, 'cost', 'LOST', from.lost ?? to.lost);
      else {
        const delta = Math.round((to.usd - from.usd) * 100) / 100;
        add(7, 'cost', 'PASS', `monthly ${from.usd} → ${to.usd} USD (delta ${delta >= 0 ? '+' : ''}${delta})${from.renewalUsd !== null ? `; ${doc.box} renews at ${from.renewalUsd}` : ''}`);
      }
    }
  }

  const roles = Object.entries(v.roles?.roles ?? {}).filter(([, r]) => r.box === doc.box).map(([k]) => k);
  const fail = checks.find((c) => c.verdict === 'FAIL');
  const lost = checks.find((c) => c.verdict === 'LOST');
  const decider = fail ?? lost;
  const code = fail ? 1 : lost ? 2 : 0;
  const out = [decider
    ? `box-move: ${decider.verdict} — C${decider.n} ${decider.name}: ${decider.detail}`
    : `box-move: PASS — all ${checks.length} checks pass for ${doc.box} → ${target.name} (dry run; nothing was moved)`];
  out.push(`roles carried: ${roles.join(', ') || 'none'} (${ROLES_REL} names ${target.name} at cutover)`);
  for (const c of checks) {
    out.push(`${c.verdict.padEnd(4)}  C${c.n} ${c.name}: ${c.detail}`);
    for (const l of c.lines) out.push(`        · ${l}`);
  }
  out.push('phases (Private runbooks/switch-vendor.md#boxes):');
  PHASES.forEach((p, i) => out.push(`  ${i + 1}. ${p}`));
  return { code, out };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`box-move: REFUSED — ${opts.error}`);
    console.error('usage: node tooling/ops/box-move.mjs --from <box> --to <spec.json> --dry-run [--private <dir>] [--root <dir>]');
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
