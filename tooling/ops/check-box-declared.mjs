#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-box-declared.mjs — READ ONE BOX BACK AGAINST ITS DECLARATION.
//
//   node tooling/ops/check-box-declared.mjs <box> [--observed <file.json>]
//        [--print-observed] [--root <repoRoot>]
//
// Rows O-BOXES-NOT-DECLARED-AS-DATA and O-BOXA-TRACKED-COPIES-UNGUARDED. The
// declaration is tooling/boxes/<box>.json (read through
// tooling/ops/box-declaration.mjs, the one reading of it); this reads the box
// and diffs the two: every running container is a declared service at its
// declared version, every compose project and named volume is declared, the
// crontab holds exactly the declared jobs at their schedules, the cron timezone
// is the one declared (trap shell-25: AS READ, never as assumed), every running
// systemd service is declared, the shape is the declared plan's, and every
// restic repository that lives on the box answers a snapshot count and its
// newest timestamp.
//
// 🔴 READ-ONLY, AND HELD TO IT IN CODE. The commands are READ_ONLY_COMMANDS in
// box-declaration.mjs and nothing else; `assertReadOnly` refuses any write verb
// before ssh is spawned (no restart, no kill — trap shell-19 — no backup run,
// no config edit), and restic runs with --no-lock, because a lock is a write.
// Each ssh call has its own ConnectTimeout and a process timeout.
//
// HOW IT REACHES THE BOX. The argv is built from PARTS (trap shell-23: the
// vault's ORACLE_SSH_COMMAND is a Windows command line and breaks the key path
// when pasted): the environment names in the declaration's `ssh` block —
// <BOX>_SSH_HOST, _USER (default root), _KEY (a key PATH), _PORT (default 22),
// _SUDO (1 prefixes `sudo -n`). The address is never printed, and neither is
// anything the box answers beyond names, versions, schedules and counts.
//
// --observed <file>  read the box's answers from a JSON file instead of ssh:
//                    {composeLs, dockerPs, volumes, crontab, timezone, systemd,
//                    nproc, mem, disk, restic: {<set>: raw}} — the raw text each
//                    command prints. The fixtures in test/boxes.test.mjs use it.
// --print-observed   also print what was read as JSON, names only: the input
//                    for completing a declaration's UNREAD fields.
//
// Exit 0 the box matches its declaration · 1 DRIFT (a finding) · 2 COVERAGE LOST:
// the box was unreachable, a command failed, an answer did not parse, or the
// declaration holds an UNREAD field. The first line names the deciding finding.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { READ_ONLY_COMMANDS, assertReadOnly, resticSnapshotsCommand, validateAll, diffDeclared } from './box-declaration.mjs';

export const SSH_CONNECT_TIMEOUT_S = 15;
export const CALL_TIMEOUT_MS = 60_000;

export function parseArgs(argv) {
  const out = { box: null, observed: null, printObserved: false, root: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print-observed') { out.printObserved = true; continue; }
    if (a === '--observed' || a === '--root') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      out[a.slice(2)] = v;
      i++;
      continue;
    }
    if (a.startsWith('-')) return { error: `unknown flag ${a}` };
    pos.push(a);
  }
  if (pos.length !== 1) return { error: `expected exactly one <box>, got ${pos.length}` };
  out.box = pos[0];
  return out;
}

/** The ssh argv for one read, from the declaration's environment NAMES. Null when the host is unset. */
export function sshArgv(doc, cmd, env = process.env) {
  assertReadOnly(cmd);
  const host = env[doc.ssh.hostEnv];
  if (!host) return null;
  const user = env[doc.ssh.userEnv] || 'root';
  const port = env[doc.ssh.portEnv] || '22';
  const key = env[doc.ssh.keyEnv];
  const argv = ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`, '-o', 'StrictHostKeyChecking=accept-new', '-p', port];
  if (key) argv.push('-i', key, '-o', 'IdentitiesOnly=yes');
  argv.push(`${user}@${host}`, '--', env[doc.ssh.sudoEnv] === '1' ? `sudo -n ${cmd}` : cmd);
  return argv;
}

/** The adapter: read every command over ssh. {observed, unreachable} — never throws. */
export function readBoxOverSsh(doc, backups, { env = process.env, spawn = spawnSync } = {}) {
  const observed = { restic: {} };
  const cmds = Object.entries(READ_ONLY_COMMANDS);
  for (const set of (backups?.sets ?? []).filter((s) => s.readBack?.passwordFile && (doc.backupSets ?? []).includes(s.id))) {
    const dest = (backups.destinations ?? []).find((d) => d.id === set.readBack.destination);
    if (dest?.box === doc.box) cmds.push([`restic:${set.id}`, resticSnapshotsCommand(dest.repo, set.readBack.passwordFile)]);
  }
  for (const [key, cmd] of cmds) {
    const argv = sshArgv(doc, cmd, env);
    if (!argv) return { observed, unreachable: `${doc.ssh.hostEnv} is not set; fill it from the vault (the address is never printed)` };
    const r = spawn('ssh', argv, { encoding: 'utf8', timeout: CALL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error || r.status === 255 || r.signal) return { observed, unreachable: `ssh to ${doc.box} failed on \`${key}\` (${r.error?.code ?? r.signal ?? `exit ${r.status}`})` };
    const nocron = key === 'crontab' && r.status === 1 && /no crontab for/.test(r.stderr ?? '');
    if (r.status !== 0 && !nocron) continue; // absent → LOST in the diff, named by key
    if (key.startsWith('restic:')) observed.restic[key.slice('restic:'.length)] = r.stdout;
    else observed[key] = nocron ? '' : r.stdout;
  }
  return { observed, unreachable: null };
}

export function run(opts, { env = process.env, spawn = spawnSync } = {}) {
  const root = resolve(opts.root ?? process.cwd());
  const v = validateAll(root);
  const out = [];
  if (v.errors.length) {
    out.push(`check-box-declared: ${v.lost ? 'LOST' : 'FAILED'} — the declarations do not validate: ${v.errors[0]}`);
    for (const e of v.errors) out.push(`  ${e}`);
    return { code: v.lost ? 2 : 1, out };
  }
  const doc = v.boxes.get(opts.box);
  if (!doc) return { code: 2, out: [`check-box-declared: REFUSED — no declaration tooling/boxes/${opts.box}.json (declared: ${[...v.boxes.keys()].join(', ')})`] };

  let observed;
  if (opts.observed) {
    try { observed = JSON.parse(readFileSync(resolve(opts.observed), 'utf8')); } catch (e) {
      return { code: 2, out: [`check-box-declared: LOST — --observed ${opts.observed} could not be read (${e.message})`] };
    }
  } else {
    const r = readBoxOverSsh(doc, v.backups, { env, spawn });
    if (r.unreachable) return { code: 2, out: [`check-box-declared: LOST — ${doc.box} unreachable: ${r.unreachable}`] };
    observed = r.observed;
  }
  const d = diffDeclared(doc, observed, v.backups);
  const code = d.drift.length ? 1 : d.lost.length ? 2 : 0;
  if (d.drift.length) out.push(`check-box-declared: DRIFT — ${doc.box}: ${d.drift[0]}`);
  else if (d.lost.length) out.push(`check-box-declared: LOST — ${doc.box}: ${d.lost[0]}`);
  else out.push(`check-box-declared: ok — ${doc.box} runs what it declares (${d.ok.length} check(s) matched; read-only)`);
  for (const x of d.drift) out.push(`DRIFT ${x}`);
  for (const x of d.lost) out.push(`LOST  ${x}`);
  for (const x of d.ok) out.push(`ok    ${x}`);
  if (opts.printObserved) out.push('', JSON.stringify({ box: doc.box, observed: d.names }, null, 2));
  return { code, out };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`check-box-declared: REFUSED — ${opts.error}`);
    console.error('usage: node tooling/ops/check-box-declared.mjs <box> [--observed <file.json>] [--print-observed] [--root <dir>]');
    process.exit(2);
  }
  if (opts.root && !existsSync(opts.root)) { console.error(`check-box-declared: REFUSED — --root ${opts.root} does not exist`); process.exit(2); }
  const { code, out } = run(opts);
  for (const l of out) (code ? console.error : console.log)(l);
  process.exit(code);
}

const IS_MAIN = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) main();
