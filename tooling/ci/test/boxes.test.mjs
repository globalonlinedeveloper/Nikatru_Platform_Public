// boxes.test.mjs — the box declarations, the read-back, the move dry run and the
// restore drill must each be able to FAIL (vacuous-03), with a green control
// beside every red one.
//
// Subjects: tooling/boxes/*.json (read through tooling/ops/box-declaration.mjs),
// tooling/ops/check-box-declared.mjs, tooling/ops/box-move.mjs and
// tooling/ops/restore-drill.mjs. Row O-BOXES-NOT-DECLARED-AS-DATA.
//
// The red controls the brief names:
//   read-back   a fixture with an undeclared running service → exit 1
//   box-move    --dry-run omitted → refused; a target too small → FAIL
//   drill       a fixture repository with a corrupted object → FAIL
// Each is ALSO run against the REAL declarations where it can be ("a fixture
// passing is not a guard working"): the real boxb with one container added, and
// the real backups.json drills, which are LOST until their file is named.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, posix, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  READ_ONLY_COMMANDS, assertReadOnly, resticSnapshotsCommand, validateAll, diffDeclared, parseCrontab,
  parseDockerPs, splitImage, parseSpec, parseStats, parseResticSnapshots,
} from '../../ops/box-declaration.mjs';
import { sshArgv, readBoxOverSsh } from '../../ops/check-box-declared.mjs';
import { parseArgs as moveArgs, monthlyCostFor } from '../../ops/box-move.mjs';
import { missingEnv, fill, insideRepo } from '../../ops/restore-drill.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const OPS = join(REPO, 'tooling', 'ops');
const CHECK = join(OPS, 'check-box-declared.mjs');
const MOVE = join(OPS, 'box-move.mjs');
const DRILL = join(OPS, 'restore-drill.mjs');
const REGISTERS = ['tooling/monitor-register.json', 'tooling/ops/alarm-chains.json', 'tooling/ops/register.json'];

const run = (tool, args, env = {}) => {
  const r = spawnSync(process.execPath, [tool, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  const out = `${r.stderr}${r.stdout}`;
  return { code: r.status, out, first: out.split('\n')[0] };
};
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const w = (root, rel, v) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A copy of the REAL declarations and the registers they cite. */
function realCopy() {
  const root = tmp('boxes-real-');
  for (const rel of ['tooling/boxes', ...REGISTERS]) cpSync(join(REPO, rel), join(root, rel), { recursive: true });
  return root;
}
const edit = (root, rel, fn) => { const doc = JSON.parse(readFileSync(join(root, rel), 'utf8')); fn(doc); w(root, rel, doc); };

// ── a small fixture estate: one box, one role, one restic set and one manifest set ──
const box = (over = {}) => ({
  box: 'boxz',
  _why: ['fixture'],
  roles: ['ops'],
  provider: { vendor: 'hostinger', plan: 'KVM 2', product: 'VPS' },
  cost: { source: 'Private/platform-state/identity.json', vendorId: 'hostinger', why: 'cited' },
  spec: { cpu: 2, ramGiB: 8, diskGiB: 100, asOf: '2026-10-01', verify: 'read back' },
  ssh: { hostEnv: 'BOXZ_SSH_HOST', userEnv: 'BOXZ_SSH_USER', keyEnv: 'BOXZ_SSH_KEY', portEnv: 'BOXZ_SSH_PORT', sudoEnv: 'BOXZ_SSH_SUDO' },
  cronTz: { value: 'Etc/UTC', measuredOn: '2026-10-01', by: 'timedatectl' },
  services: [
    { id: 'app', image: 'acme/app', version: '1.2.3', compose: { project: 'app', service: null }, containers: 2, hostnames: ['app.example.test'], secrets: ['APP_KEY'], use: { cpu: 1, ramGiB: 3, diskGiB: 20, asOf: '2026-10-01' } },
    { id: 'db', image: 'postgres', version: '17', compose: { project: 'app', service: 'db' }, containers: 1, hostnames: [], secrets: ['POSTGRES_PASSWORD'], use: { cpu: 0.5, ramGiB: 2, diskGiB: 30, asOf: '2026-10-01' } },
  ],
  units: ['docker', 'cron', 'ssh'],
  volumes: [{ name: 'pgdata', kind: 'named', holds: 'the database', backupSets: ['zset'] }],
  backupSets: ['zset', 'zexport'],
  hostnames: [{ name: 'app.example.test', record: 'tunnel-cname', via: 'tunnel' }],
  tunnel: { secret: 'TUNNEL_TOKEN', why: 'fixture' },
  monitors: [1],
  crons: [{ name: 'snap', schedule: '0 4 * * *', script: '/opt/backup/restic-run.sh', register: 'duty.restic-snapshot' }],
  allowLists: [{ id: 'db-hba', where: 'pg_hba on the box', owner: 'operator', row: null, verify: 'read it', confirmedOn: null }],
  ...over,
});
const backups = (over = {}) => ({
  _why: ['fixture'],
  destinations: [
    { id: 'zlocal', kind: 'restic', box: 'boxz', remote: { name: null, layout: '/srv/restic' }, repo: '/srv/restic', env: [], encryption: { posture: 'restic key', adr: ['046'] } },
    { id: 'zrepo', kind: 'restic', box: null, remote: { name: 'local', layout: '<DRILL_REPO>' }, repo: '<DRILL_REPO>', env: [['RESTIC_PASSWORD_FILE', 'RESTIC_PASSWORD'], 'DRILL_REPO'], encryption: { posture: 'restic key', adr: ['046'] } },
    { id: 'zr2', kind: 'rclone-manifest', box: null, remote: { name: '<Z_REMOTE>', layout: 'bucket' }, base: '<Z_REMOTE>:bucket', env: ['Z_REMOTE'], encryption: { posture: 'none client-side', adr: ['021'] } },
    { id: 'zdrive', kind: 'rclone-dated', box: null, remote: { name: 'enc', layout: 'cf/<date>/' }, base: 'enc:cf', env: [], encryption: { posture: 'crypt', adr: ['047'] } },
  ],
  sets: [
    { id: 'zset', box: 'boxz', writer: 'duty.restic-snapshot', what: 'f', destinations: ['zlocal', 'zrepo'], retention: 'r', readBack: { destination: 'zlocal', passwordFile: '/root/.restic-pass' }, drill: { from: 'zrepo', file: null, hash: 'restic-tree' } },
    { id: 'zexport', box: null, writer: 'duty.platform-cron', what: 'f', destinations: ['zr2', 'zdrive'], retention: 'r', readBack: null, drill: { from: 'zr2', file: 'kv/jwks/{date}.json.gz', hash: 'manifest', manifest: 'manifests/latest.json' } },
    { id: 'zdated', box: null, writer: 'duty.cloudflare-backup-pull', what: 'f', destinations: ['zdrive'], retention: 'r', readBack: null, drill: { from: 'zdrive', file: 'kv/jwks/{date}.json.gz', hash: 'manifest', manifest: 'manifests/{date}.json' } },
  ],
  ...over,
});
function estate({ boxDoc = box(), backupsDoc = backups(), roles = { roles: { ops: { by: 'single', box: 'boxz' } } } } = {}) {
  const root = tmp('boxes-fx-');
  for (const rel of REGISTERS) cpSync(join(REPO, rel), join(root, rel));
  w(root, 'tooling/boxes/boxz.json', boxDoc);
  w(root, 'tooling/boxes/roles.json', roles);
  w(root, 'tooling/boxes/backups.json', backupsDoc);
  return root;
}

/** What boxz answers when it runs exactly what it declares. */
const observedMatching = () => ({
  composeLs: JSON.stringify([{ Name: 'app', Status: 'running(3)' }]),
  dockerPs: ['app-web-1\tacme/app:1.2.3\trunning\tapp\tweb', 'app-worker-1\tacme/app:v1.2.3\trunning\tapp\tworker', 'app-db-1\tdocker.io/library/postgres:17\trunning\tapp\tdb'].join('\n'),
  volumes: 'app_pgdata\n',
  crontab: '# m h dom mon dow command\nMAILTO=""\n0 4 * * * /opt/backup/restic-run.sh >/dev/null 2>&1\n',
  timezone: 'Etc/UTC\n',
  systemd: 'cron.service loaded active running Regular background program processing daemon\ndocker.service loaded active running Docker\nssh.service loaded active running OpenBSD Secure Shell server\n',
  nproc: '2\n',
  mem: '               total        used        free\nMem:      8323002368  1234567890  1000000000\nSwap:              0           0           0\n',
  disk: ' 1B-blocks       Used\n107374182400 21474836480\n',
  stats: 'app-web-1\t3.50%\t512MiB / 7.75GiB\napp-worker-1\t1.00%\t256MiB / 7.75GiB\napp-db-1\t0.20%\t1.5GiB / 7.75GiB\n',
  restic: { zset: JSON.stringify([{ time: '2026-09-30T04:00:00Z', id: 'a' }, { time: '2026-10-01T04:00:00Z', id: 'b' }]) },
});
const checkWith = (root, observed, extra = []) => {
  const f = join(root, 'observed.json');
  writeFileSync(f, JSON.stringify(observed));
  return run(CHECK, ['boxz', '--root', root, '--observed', f, ...extra]);
};

describe('the declarations validate, and every citation can redden them', () => {
  it('green control: the real tooling/boxes validates against the registers it cites', () => {
    const v = validateAll(REPO);
    assert.deepEqual(v.errors, []);
    assert.deepEqual([...v.boxes.keys()], ['boxa', 'boxb', 'boxc']);
  });
  /** Green on the real copy first, then one mutation, then the named error. */
  const declRed = (mutate, re) => {
    const root = realCopy();
    assert.deepEqual(validateAll(root).errors, [], 'green before the mutation');
    mutate(root);
    const errs = validateAll(root).errors;
    assert.ok(errs.some((e) => re.test(e)), errs.join('\n'));
  };
  it('red: a monitor id no register holds', () => declRed((r) => edit(r, 'tooling/boxes/boxb.json', (d) => d.monitors.push(99999)), /monitor 99999 is in neither/));
  it('red: a cron citing a register row that does not exist', () => declRed((r) => edit(r, 'tooling/boxes/boxc.json', (d) => { d.crons[0].register = 'duty.nowhere'; }), /cites register row "duty\.nowhere"/));
  it('red: a cost carrying a figure instead of a citation', () => declRed((r) => edit(r, 'tooling/boxes/boxb.json', (d) => { d.cost.monthlyUsd = 1; }), /a cost is cited, never copied/));
  it('red: an address written into a declaration', () => declRed((r) => edit(r, 'tooling/boxes/boxa.json', (d) => { d._why.push(['203', '0', '113', '7'].join('.')); }), /carries an IPv4 address/));
  it('red: a role the roles file gives to another box', () => declRed((r) => edit(r, 'tooling/boxes/roles.json', (d) => { d.roles.ops.box = 'boxc'; }), /role `ops` is not held by boxb|role `ops` names boxc, whose declaration does not list it/));
  it('red: a destination without its layout (trap backup-04)', () => declRed((r) => edit(r, 'tooling/boxes/backups.json', (d) => { delete d.destinations[1].remote.layout; }), /must declare BOTH remote\.name and remote\.layout/));
  it('red: a set drilled from a destination it does not have', () => declRed((r) => edit(r, 'tooling/boxes/backups.json', (d) => { d.sets[0].drill.from = 'drive-cloudflare'; }), /drills from `drive-cloudflare`, which is not one of its destinations/));
  it('red: a box backup set that backups.json does not declare', () => declRed((r) => edit(r, 'tooling/boxes/boxa.json', (d) => { d.backupSets.push('ghost-set'); }), /backup set `ghost-set` is not in/));
  it('red: a declaration the read-back cannot validate exits 1 before any box is read', () => {
    const root = realCopy();
    edit(root, 'tooling/boxes/boxb.json', (d) => d.monitors.push(99999));
    const r = run(CHECK, ['boxb', '--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /the declarations do not validate/);
  });
});

describe('the read-only command set holds', () => {
  it('green: every READ_ONLY_COMMANDS entry and the restic listing pass assertReadOnly', () => {
    for (const cmd of Object.values(READ_ONLY_COMMANDS)) assert.equal(assertReadOnly(cmd), cmd);
    assertReadOnly(resticSnapshotsCommand('/srv/restic', '/root/.restic-pass'));
  });
  it('red: every write verb, a chained command, a redirect and restic without --no-lock or --no-cache is refused', () => {
    const writes = ['docker restart glitchtip-web-1', 'docker compose up -d', 'systemctl restart docker', "pkill -f 'restic'", 'rm -rf /srv/restic',
    'crontab -r', 'restic -r /srv/restic backup /opt', 'restic -r /srv/restic snapshots --json', 'restic --no-lock -r /srv/restic forget --keep-last 1 snapshots',
    'restic --no-lock -r /srv/restic snapshots --json', 'crontab -l > /tmp/x', 'docker ps; reboot', 'rclone delete oracleenc:restic-boxb', 'sed -i s/a/b/ /etc/crontab', 'docker volume rm pgdata', ''];
    for (const cmd of writes) assert.throws(() => assertReadOnly(cmd), /refused/, JSON.stringify(cmd));
    assert.throws(() => assertReadOnly('restic --no-lock -r /srv/restic snapshots --json'), /--no-cache/);
  });
  it('the ssh argv is built from PARTS (trap shell-23), never a pasted command line; sudo only when asked', () => {
    const doc = box();
    assert.equal(sshArgv(doc, 'nproc', {}), null, 'no host, no call');
    const a = sshArgv(doc, 'nproc', { BOXZ_SSH_HOST: 'h.example', BOXZ_SSH_KEY: '/k/id', BOXZ_SSH_PORT: '2222' });
    assert.deepEqual(a.slice(-3), ['root@h.example', '--', 'nproc']);
    assert.ok(a.includes('BatchMode=yes') && a.includes('-i') && a.includes('/k/id') && a.includes('2222'));
    assert.ok(a.some((x) => /^ConnectTimeout=\d+$/.test(x)));
    assert.equal(sshArgv(doc, 'nproc', { BOXZ_SSH_HOST: 'h', BOXZ_SSH_SUDO: '1' }).at(-1), 'sudo -n nproc');
    assert.throws(() => sshArgv(doc, 'docker restart x', { BOXZ_SSH_HOST: 'h' }), /refused/);
  });
  it('the adapter: ssh exit 255 is unreachable, and every call carries a timeout', () => {
    const calls = [];
    const r = readBoxOverSsh(box(), backups(), { env: { BOXZ_SSH_HOST: 'h' }, spawn: (bin, argv, o) => { calls.push({ bin, argv, o }); return { status: 255, stdout: '', stderr: 'ssh: connect to host h port 22: Connection timed out' }; } });
    assert.match(r.unreachable, /ssh to boxz failed/);
    assert.equal(calls[0].bin, 'ssh');
    assert.ok(calls[0].o.timeout > 0);
  });
  it('the adapter: a green read sends only read-only commands, and the restic listing uses --no-lock', () => {
    const sent = [];
    const obs = observedMatching();
    const answer = { composeLs: obs.composeLs, dockerPs: obs.dockerPs, volumes: obs.volumes, crontab: obs.crontab, timezone: obs.timezone, systemd: obs.systemd, nproc: obs.nproc, mem: obs.mem, disk: obs.disk, stats: obs.stats };
    const byCmd = new Map(Object.entries(READ_ONLY_COMMANDS).map(([k, c]) => [c, answer[k]]));
    const r = readBoxOverSsh(box(), backups(), {
      env: { BOXZ_SSH_HOST: 'h' },
      spawn: (bin, argv) => { const cmd = argv.at(-1); sent.push(cmd); return { status: 0, stdout: byCmd.get(cmd) ?? obs.restic.zset, stderr: '' }; },
    });
    assert.equal(r.unreachable, null);
    for (const c of sent) assertReadOnly(c);
    assert.ok(sent.some((c) => /^restic --no-lock --no-cache .* snapshots --json$/.test(c)));
    const d = diffDeclared(box(), r.observed, backups());
    assert.deepEqual(d.drift, []);
  });
});

describe('check-box-declared — the read-back', () => {
  it('green control: a box that runs exactly what it declares exits 0, names and counts only', () => {
    const r = checkWith(estate(), observedMatching(), ['--print-observed']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /^check-box-declared: ok — boxz runs what it declares/);
    assert.match(r.out, /restic: zset 2 snapshot\(s\), newest 2026-10-01T04:00:00\.000Z/);
    assert.match(r.out, /"measuredUse"/);
  });
  it('RED (the brief\'s): an undeclared running service exits 1 and names it', () => {
    const o = observedMatching();
    o.dockerPs += '\nminer-1\tevil/miner:latest\trunning\t\t';
    const r = checkWith(estate(), o);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /DRIFT — boxz: services: running container `miner-1` \(image evil\/miner, project none\) is declared by no service/);
  });
  /** The green observation, one mutation, exit 1 and the named drift. */
  const obsRed = (mutate, re) => {
    const o = observedMatching();
    mutate(o);
    const r = checkWith(estate(), o);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, re);
  };
  it('red: a declared service not running exits 1', () => obsRed((o) => { o.dockerPs = o.dockerPs.split('\n').filter((l) => !l.startsWith('app-db')).join('\n'); }, /`db` \(postgres\) is declared and no container of it is running/));
  it('red: a version that moved exits 1', () => obsRed((o) => { o.dockerPs = o.dockerPs.replace('postgres:17', 'postgres:18'); }, /`db` declares 17 and runs 18/));
  it('red: a container count that differs exits 1', () => obsRed((o) => { o.dockerPs = o.dockerPs.split('\n').filter((l) => !l.startsWith('app-worker')).join('\n'); }, /`app` declares 2 container\(s\) and 1 run/));
  it('red: an undeclared cron exits 1', () => obsRed((o) => { o.crontab += '*/5 * * * * /usr/local/bin/stray.sh\n'; }, /crontab and declared by no cron/));
  it('red: a cron schedule that moved exits 1', () => obsRed((o) => { o.crontab = o.crontab.replace('0 4 * * *', '0 5 * * *'); }, /`snap` declares `0 4 \* \* \*` and the crontab runs `0 5 \* \* \*`/));
  it('red: a cron timezone that is not the declared one (shell-25) exits 1', () => obsRed((o) => { o.timezone = 'Asia/Kolkata\n'; }, /cronTz: declared Etc\/UTC and the box's cron runs Asia\/Kolkata/));
  it('red: a CRON_TZ line overrides the system timezone exits 1', () => obsRed((o) => { o.crontab = `CRON_TZ=Asia/Kolkata\n${o.crontab}`; }, /cron runs Asia\/Kolkata/));
  it('red: an undeclared running unit exits 1', () => obsRed((o) => { o.systemd += 'cloudflared.service loaded active running cloudflared\n'; }, /units: `cloudflared` is running and declared nowhere/));
  it('red: an undeclared docker volume exits 1', () => obsRed((o) => { o.volumes += 'app_scratch\n'; }, /docker volume `app_scratch` is declared nowhere/));
  it('red: an undeclared compose project exits 1', () => obsRed((o) => { o.composeLs = JSON.stringify([{ Name: 'app', Status: 'running(3)' }, { Name: 'side', Status: 'exited(1)' }]); }, /compose: project `side` is declared by no service/));
  it('red: a shape smaller than the plan exits 1', () => obsRed((o) => { o.nproc = '1\n'; }, /spec\.cpu: declared 2, the box reads 1/));
  it('red: an empty restic repository exits 1', () => obsRed((o) => { o.restic.zset = '[]'; }, /restic: set `zset` holds no snapshot/));
  it('LOST, not ok: a command that was not read, an answer that does not parse, an UNREAD field', () => {
    const o = observedMatching();
    delete o.crontab;
    let r = checkWith(estate(), o);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /LOST — boxz: crontab: not read/);
    const o2 = observedMatching();
    o2.composeLs = 'not json';
    r = checkWith(estate(), o2);
    assert.equal(r.code, 2, r.out);
    const unread = box();
    unread.services[1].version = null;
    r = checkWith(estate({ boxDoc: unread }), observedMatching());
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /`db` version is UNREAD in the declaration \(running: 17\)/);
  });
  it('unreachable is exit 2: no host in the environment', () => {
    const r = run(CHECK, ['boxz', '--root', estate()]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /LOST — boxz unreachable: BOXZ_SSH_HOST is not set/);
    assert.doesNotMatch(r.out, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  });
  it('on the REAL boxb declaration: a read that matches it is green but for its UNREAD fields; one extra container is DRIFT', () => {
    const doc = JSON.parse(readFileSync(join(REPO, 'tooling/boxes/boxb.json'), 'utf8'));
    const ps = [];
    for (const s of doc.services) for (let i = 0; i < s.containers; i++) ps.push(`${s.id}-${i}\t${s.image}:${s.version ?? 'x'}\trunning\t${s.compose.project ?? 'p'}\t${s.compose.service ?? ''}`);
    const o = {
      composeLs: JSON.stringify([...new Set(doc.services.map((s) => s.compose.project ?? 'p'))].map((Name) => ({ Name, Status: 'running' }))),
      dockerPs: ps.join('\n'),
      volumes: '',
      crontab: doc.crons.map((c) => `${c.schedule ?? '7 * * * *'} ${c.script}`).join('\n'),
      timezone: doc.cronTz.value,
      systemd: doc.units.map((u) => `${u}.service loaded active running x`).join('\n'),
      nproc: String(doc.spec.cpu), mem: `Mem: ${doc.spec.ramGiB * 1024 ** 3} 0 0`, disk: `${doc.spec.diskGiB * 1024 ** 3} 0`,
    };
    const v = validateAll(REPO);
    const green = diffDeclared(doc, o, v.backups);
    assert.deepEqual(green.drift, []);
    assert.ok(green.lost.length > 0, 'the real declaration still has UNREAD fields, so a matching read is LOST, never ok');
    o.dockerPs += '\nstray-1\tacme/stray:1\trunning\tstray\t';
    const red = diffDeclared(doc, o, v.backups);
    assert.ok(red.drift.some((x) => /`stray-1`/.test(x)), red.drift.join('\n'));
  });
  it('the parsers read the shapes the commands print', () => {
    assert.deepEqual(splitImage('docker.io/library/postgres:17'), { repo: 'postgres', tag: '17' });
    assert.deepEqual(splitImage('ghcr.io/acme/app@sha256:abcd'), { repo: 'ghcr.io/acme/app', tag: null });
    assert.deepEqual(splitImage('localhost:5000/app'), { repo: 'localhost:5000/app', tag: null });
    assert.deepEqual(parseCrontab('no crontab for root\n'), { tz: null, jobs: [] });
    assert.deepEqual(parseCrontab('@reboot /x.sh\n15 0,6,12,18 * * * /opt/s/hb-run.sh /opt/s/backup.sh').jobs.map((j) => j.schedule), ['@reboot', '15 0,6,12,18 * * *']);
    assert.throws(() => parseCrontab('garbage line'), /neither a job nor an assignment/);
    assert.equal(parseDockerPs('a\tb:1\trunning\t\t')[0].project, null);
    assert.deepEqual(parseSpec({ nproc: '8', mem: 'Mem: 34359738368 1 1', disk: '429496729600 107374182400' }), { cpu: 8, ramGiB: 32, diskGiB: 400, diskUsedGiB: 100 });
    assert.deepEqual(parseStats('x\t12.5%\t1.5GiB / 31GiB'), [{ name: 'x', cpuPct: 12.5, memMiB: 1536 }]);
    assert.deepEqual(parseResticSnapshots('[]'), { count: 0, newest: null });
    assert.throws(() => parseResticSnapshots('{"not":"a list"}'));
  });
});

describe('box-move — the graded dry run', () => {
  const spec = (over = {}) => {
    const f = join(tmp('boxspec-'), 'spec.json');
    writeFileSync(f, JSON.stringify({ name: 'boxy', provider: { vendor: 'hostinger', plan: 'KVM 4' }, cpu: 4, ramGiB: 16, diskGiB: 200, cost: { monthlyUsd: 12 }, ...over }));
    return f;
  };
  const priv = (identity) => { const d = tmp('private-'); w(d, 'platform-state/identity.json', identity); return d; };
  const readyBackups = () => backups({ sets: backups().sets.map((s) => ({ ...s, drill: { ...s.drill, file: s.drill.file ?? '/opt/x/small.txt' } })) });

  it('RED (the brief\'s): --dry-run omitted is refused, exit 2', () => {
    const r = run(MOVE, ['--from', 'boxb', '--to', spec()]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /REFUSED — refused without --dry-run/);
    assert.deepEqual(moveArgs(['--from', 'boxb', '--to', '--dry-run']), { error: '--to was given "--dry-run", which is a flag, not a value' });
  });
  it('green control: a target that fits, operator-only allow-lists, runnable drills and a readable cost — exit 0', () => {
    const root = estate({ backupsDoc: readyBackups() });
    const r = run(MOVE, ['--from', 'boxz', '--to', spec(), '--dry-run', '--root', root, '--private', priv({ vendors: [{ id: 'hostinger', cost: { monthlyUsd: 10, renewalMonthlyUsd: 20 } }] })]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /^box-move: PASS — all 7 checks pass for boxz → boxy/);
    assert.match(r.out, /C7 cost: monthly 10 → 12 USD \(delta \+2\); boxz renews at 20/);
    assert.match(r.out, /app\.example\.test: no record change — start the tunnel connector on boxy with secret TUNNEL_TOKEN/);
    assert.match(r.out, /C6 secrets: 3 secret NAME\(s\) to carry from the vault: APP_KEY, POSTGRES_PASSWORD, TUNNEL_TOKEN/);
    assert.match(r.out, /the new box serves, the old stays standby for 7 days/);
  });
  it('RED (the brief\'s): a target too small for the declared services is FAIL, exit 1', () => {
    const root = estate({ backupsDoc: readyBackups() });
    const r = run(MOVE, ['--from', 'boxz', '--to', spec({ cpu: 1, ramGiB: 4, diskGiB: 40 }), '--dry-run', '--root', root, '--private', priv({ vendors: [{ id: 'hostinger', cost: { monthlyUsd: 10 } }] })]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /FAIL — C1 capacity: the measured use of 2 declared service\(s\) is 1\.5 CPU, 5 GiB RAM, 50 GiB disk; ×1\.25 it does not fit .* in cpu, ramGiB, diskGiB/);
  });
  it('red: an allow-list the OWNER holds is FAIL (an owner step); the cost is LOST without Private', () => {
    const owned = box({ allowLists: [{ id: 'gov-whitelist', where: 'a console', owner: 'owner', row: 'O-APISETU-KEY-IP-WHITELIST', verify: 'look', confirmedOn: null }] });
    const root = estate({ boxDoc: owned, backupsDoc: readyBackups() });
    const r = run(MOVE, ['--from', 'boxz', '--to', spec(), '--dry-run', '--root', root, '--private', join(root, 'no-private-here')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /FAIL — C3 allow-lists: 1 allow-list\(s\) pin boxz's address; 1 is the owner's to update \(gov-whitelist\)/);
    assert.match(r.out, /LOST  C7 cost: Private platform-state\/identity\.json is not readable here/);
  });
  it('LOST, not PASS: unmeasured services against a target smaller than the source; an UNREAD drill', () => {
    const unmeasured = box({ services: box().services.map((s) => ({ ...s, use: null })) });
    const root = estate({ boxDoc: unmeasured });
    const r = run(MOVE, ['--from', 'boxz', '--to', spec({ cpu: 1, ramGiB: 4, diskGiB: 40 }), '--dry-run', '--root', root, '--private', priv({ vendors: [{ id: 'hostinger', cost: { monthlyUsd: 10 } }] })]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LOST  C1 capacity: 2 service\(s\) have no measured use/);
    assert.match(r.out, /LOST  C4 backups: .* drill\(s\) cannot run yet \(zset\)/);
  });
  it('on the REAL boxb: the API Setu whitelist is an owner step (FAIL), every hostname is a tunnel record, the cost is LOST in CI', () => {
    const r = run(MOVE, ['--from', 'boxb', '--to', spec({ cpu: 8, ramGiB: 32, diskGiB: 400 }), '--dry-run', '--private', join(tmp('none-'), 'x')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /FAIL — C3 allow-lists: .*apisetu-key-ip-whitelist/);
    assert.match(r.out, /PASS  C1 capacity: 8 service\(s\) unmeasured, and the target .* is at least boxb's declared shape/);
    assert.match(r.out, /PASS  C2 dns: 5 record\(s\) to move/);
    assert.match(r.out, /LOST  C7 cost/);
    assert.doesNotMatch(r.out, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'no address is ever printed');
  });
  it('LOST, not a crash: an identity.json that exists and cannot be read (a directory here; EACCES on the laptop) is exit 2 naming the code', () => {
    const root = estate({ backupsDoc: readyBackups() });
    const d = tmp('private-');
    mkdirSync(join(d, 'platform-state', 'identity.json'), { recursive: true });
    const r = run(MOVE, ['--from', 'boxz', '--to', spec(), '--dry-run', '--root', root, '--private', d]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /^box-move: LOST — C7 cost: Private platform-state\/identity\.json could not be read \((EISDIR|EPERM|EACCES)\)/);
    assert.doesNotMatch(r.out, /\n\s+at /, 'no stack trace');
  });
  it('the cost reader finds a monthly USD figure under the vendor, or says what it read', () => {
    assert.deepEqual(monthlyCostFor({ vendors: { hostinger: { plan: { monthlyUsd: { value: 9.99 } } } } }, 'hostinger'), { usd: 9.99, path: '$.vendors.hostinger.plan.monthlyUsd.value', renewalUsd: null });
    assert.match(monthlyCostFor({ vendors: { hostinger: { seats: 1 } } }, 'hostinger').lost, /no monthly USD figure under vendor `hostinger` \(read 1 numeric field/);
  });
});

describe('restore-drill — one file back, hashed against the source, then deleted', () => {
  // A fake rclone that serves `<remote>:<path>` from a local directory, with rclone's
  // lsf habit of listing subdirectories with a trailing slash (trap backup-05).
  const shimDir = tmp('rclone-shim-');
  // A .cjs node script, never a shebang file: the drill runs a .js/.cjs/.mjs tool
  // with process.execPath, so this launches on Windows too (#1148 shipped a shebang
  // shim that Windows reported as ENOENT, failing four tests there).
  const RCLONE = join(shimDir, 'rclone.cjs');
  writeFileSync(RCLONE, `const fs = require('node:fs'); const path = require('node:path');
const [cmd, ...rest] = process.argv.slice(2);
const local = (p) => path.join(process.env.FAKE_RCLONE_ROOT, p.replace(/^[^:]*:/, ''));
if (cmd === 'lsf') { const d = local(rest[0]); if (!fs.existsSync(d)) { console.error('directory not found'); process.exit(3); }
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) console.log(e.name + '/'); else if (!rest.includes('--dirs-only')) console.log(e.name); } process.exit(0); }
if (cmd === 'cat') { const f = local(rest[0]); if (!fs.existsSync(f)) { console.error('object not found'); process.exit(3); } process.stdout.write(fs.readFileSync(f)); process.exit(0); }
if (cmd === 'copyto') { const f = local(rest[0]); if (!fs.existsSync(f)) { console.error('object not found'); process.exit(3); } fs.copyFileSync(f, rest[1]); process.exit(0); }
console.error('unsupported ' + cmd); process.exit(9);
`);
  const exportTree = ({ corrupt = false, complete = true, date = '2026-10-01' } = {}) => {
    const d = tmp('r2-');
    const body = Buffer.from('{"keys":{"k1":"v1"}}');
    const key = `kv/jwks/${date}.json.gz`;
    w(d, `bucket/${key}`, corrupt ? Buffer.from('{"keys":{"k1":"v2"}}').toString() : body.toString());
    w(d, 'bucket/manifests/latest.json', { date, complete, objects: [{ key, bytes: body.length, sha256: sha(body), truncated: false }] });
    return d;
  };
  const drill = (root, set, fakeRoot, extra = [], env = {}) => {
    const scratch = tmp('scratch-');
    const r = run(DRILL, [set, '--to', scratch, '--root', root, '--rclone-bin', RCLONE, ...extra], { FAKE_RCLONE_ROOT: fakeRoot, Z_REMOTE: 'r2fixture', ...env });
    return { ...r, scratch };
  };

  it('green control: the newest manifest names the object, it comes back, its SHA-256 matches, and the scratch copy is deleted', () => {
    const r = drill(estate(), 'zexport', exportTree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /^restore-drill: PASS — zexport: zr2 2026-10-01: kv\/jwks\/2026-10-01\.json\.gz came back 20 B and its SHA-256 matches/);
    assert.match(r.out, /the scratch copy was deleted/);
    assert.deepEqual(readdirSync(r.scratch), [], 'nothing is left in the scratch directory');
  });
  it('RED (the brief\'s): a corrupted object fails the drill, exit 1', () => {
    const r = drill(estate(), 'zexport', exportTree({ corrupt: true }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /FAIL — zexport: zr2 2026-10-01: kv\/jwks\/2026-10-01\.json\.gz came back 20 B with SHA-256 .*the source recorded/);
    assert.deepEqual(readdirSync(r.scratch), [], 'the failed copy is deleted too');
  });
  it('red: a manifest that is not complete, and a manifest that does not list the file', () => {
    let r = drill(estate(), 'zexport', exportTree({ complete: false }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /is not `complete`/);
    const b = backups();
    b.sets[1].drill.file = 'kv/other/{date}.json.gz';
    r = drill(estate({ backupsDoc: b }), 'zexport', exportTree());
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /does not list kv\/other\/2026-10-01\.json\.gz/);
  });
  it('dated directories are PARSED, never inferred from a non-empty listing (trap backup-05)', () => {
    const d = tmp('drive-');
    const body = Buffer.from('jwks');
    for (const date of ['2026-09-29', '2026-09-30']) {
      w(d, `cf/${date}/kv/jwks/${date}.json.gz`, body.toString());
      w(d, `cf/${date}/manifests/${date}.json`, { date, complete: true, objects: [{ key: `kv/jwks/${date}.json.gz`, sha256: sha(body) }] });
    }
    w(d, 'cf/not-a-date/x', 'x');
    w(d, 'cf/README', 'x');
    const r = drill(estate(), 'zdated', d);
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /zdrive 2026-09-30: kv\/jwks\/2026-09-30\.json\.gz came back/);
    const empty = tmp('drive-empty-');
    w(empty, 'cf/not-a-date/x', 'x');
    const r2 = drill(estate(), 'zdated', empty);
    assert.equal(r2.code, 1, r2.out);
    assert.match(r2.first, /holds no dated directory \(listed 1 entr\(ies\), none a date\)/);
  });
  it('LOST: an unset credential name, a missing tool, and every REAL drill whose file is not yet named', () => {
    let r = drill(estate(), 'zexport', exportTree(), [], { Z_REMOTE: '' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /needs Z_REMOTE in the environment/);
    r = run(DRILL, ['zexport', '--to', tmp('s-'), '--root', estate(), '--rclone-bin', join(shimDir, 'no-such-rclone')], { Z_REMOTE: 'x' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /is not installed here/);
    for (const set of ['boxb-restic', 'restic-third-copy', 'glitchtip-pg', 'supabase-auth-pg']) {
      const real = run(DRILL, [set, '--to', tmp('s-')]);
      assert.equal(real.code, 2, real.out);
      assert.match(real.first, /the drill names no file/);
    }
    assert.deepEqual(missingEnv([['A', 'B'], 'C'], { B: '1' }), ['C']);
    assert.deepEqual(fill('s3:<EP>/b', {}), { missing: ['EP'] });
  });
  it('refuses a scratch directory inside the repository', () => {
    const r = run(DRILL, ['d1-kv-export', '--to', join(REPO, 'tooling'), '--rclone-bin', RCLONE], { R2_RCLONE_REMOTE: 'x', FAKE_RCLONE_ROOT: tmp('x-') });
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /--to is inside the repository/);
  });

  it('the containment test holds under win32 semantics: case, separators, the long-path prefix, a sibling with a shared prefix', () => {
    const W = { p: win32, real: () => null };
    const root = 'C:\\Users\\o\\Nikatru_Platform_Public';
    for (const inside of [root, `${root}\\x`, 'c:\\users\\O\\NIKATRU_PLATFORM_PUBLIC\\x', 'C:/Users/o/Nikatru_Platform_Public/tooling', `${root}\\a\\..\\b`, `\\\\?\\${root}\\x`, `${root}\\..foo`]) {
      assert.equal(insideRepo(root, inside, W), true, `${inside} is inside`);
    }
    for (const outside of ['C:\\Users\\o\\scratch', 'C:\\Users\\o\\Nikatru_Platform_Public-scratch', 'C:\\Users\\o', `${root}\\..\\drill`, 'D:\\Users\\o\\Nikatru_Platform_Public\\x']) {
      assert.equal(insideRepo(root, outside, W), false, `${outside} is outside`);
    }
    // the #1148 test, on these same paths, failed open: control that it would have
    const old = (r, t) => { const a = win32.resolve(r); const b = win32.resolve(t); return b === a || b.startsWith(`${a}/`); };
    assert.equal(old(root, `${root}\\x`), false, 'the old prefix test lets a backslashed inside path through');
    // a junction or 8.3 short name: `real` says where it lands
    const viaLink = { p: win32, real: (x) => (x.toLowerCase().startsWith('c:\\link') ? x.replace(/^c:\\link/i, root) : null) };
    assert.equal(insideRepo(root, 'C:\\link\\x', viaLink), true, 'a junction into the repo is inside');
    assert.equal(insideRepo(root, 'C:\\link\\x', W), false, 'control: without its target the junction reads as outside');
    assert.equal(insideRepo('/srv/repo', '/srv/repo-scratch', { p: posix, real: () => null }), false);
    assert.equal(insideRepo('/srv/repo', '/srv/repo/x', { p: posix, real: () => null }), true);
  });
  it('a symlink outside the repository that points into it is refused (the real filesystem)', (t) => {
    const link = join(tmp('link-'), 'into-repo');
    try { symlinkSync(join(REPO, 'tooling'), link, 'junction'); } catch (e) { t.skip(`cannot create a link here (${e.code})`); return; }
    assert.equal(insideRepo(REPO, join(link, 'scratch')), true);
    assert.equal(insideRepo(REPO, join(dirname(link), 'scratch')), false, 'control: its sibling is outside');
    const r = run(DRILL, ['d1-kv-export', '--to', join(link, 'scratch'), '--rclone-bin', RCLONE], { R2_RCLONE_REMOTE: 'x', FAKE_RCLONE_ROOT: tmp('x-') });
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /--to is inside the repository/);
  });

  // The real restic, when this machine has one: CI's runners do not, and the
  // shim-free red control above (a corrupted object) runs everywhere.
  const RESTIC = process.env.RESTIC_BIN || 'restic';
  const haveRestic = spawnSync(RESTIC, ['version'], { encoding: 'utf8', timeout: 30_000 }).status === 0;
  it('restic: green from a real repository, then a corrupted pack fails the drill', { skip: haveRestic ? false : `no restic binary (set RESTIC_BIN to run it); the manifest red control above runs everywhere` }, () => {
    const d = tmp('restic-');
    const src = join(d, 'src', 'opt', 'backup');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'restic-sets.txt'), '/opt/glitchtip\n/opt/backup\n');
    const repo = join(d, 'repo');
    const env = { ...process.env, RESTIC_PASSWORD: 'fixture-only' };
    assert.equal(spawnSync(RESTIC, ['init', '-q', '-r', repo], { env, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(RESTIC, ['backup', '-q', '-r', repo, '--tag', 'boxb', src], { env, encoding: 'utf8' }).status, 0);
    const file = join(src, 'restic-sets.txt');
    const drillEnv = { RESTIC_PASSWORD: 'fixture-only', DRILL_REPO: repo };
    const green = run(DRILL, ['zset', '--to', tmp('s-'), '--root', estate(), '--restic-bin', RESTIC, '--file', file], drillEnv);
    assert.equal(green.code, 0, green.out);
    assert.match(green.first, /PASS — zset: zrepo snapshot \w{8} of .*: .*restic-sets\.txt came back 27 B and its SHA-256 matches/);
    assert.doesNotMatch(green.out, /fixture-only/, 'the password is never printed');
    const packs = [];
    const walk = (p) => { for (const e of readdirSync(p, { withFileTypes: true })) { if (e.isDirectory()) walk(join(p, e.name)); else packs.push(join(p, e.name)); } };
    walk(join(repo, 'data'));
    const found = spawnSync(RESTIC, ['--no-lock', '--no-cache', '-r', repo, 'find', '--show-pack-id', '--blob', sha(readFileSync(file))], { env, encoding: 'utf8' });
    const dataPackId = /belongs to pack ([0-9a-f]{64})/.exec(found.stdout)?.[1];
    assert.ok(dataPackId, found.stdout + found.stderr);
    const dataPack = packs.find((p) => p.endsWith(dataPackId));
    const treePacks = packs.filter((p) => p !== dataPack);
    assert.ok(dataPack && treePacks.length, 'one data pack and at least one tree pack');
    // Byte 20 of a pack is inside its FIRST blob's ciphertext (16 B IV, then the ciphertext), so its MAC fails.
    const corrupt = (p) => { const before = readFileSync(p); const b = Buffer.from(before); b[20] ^= 0xff; chmodSync(p, 0o644); writeFileSync(p, b); return () => writeFileSync(p, before); };
    // 1. the DATA object corrupted: the tree reads, the restore fails
    let undo = corrupt(dataPack);
    let red = run(DRILL, ['zset', '--to', tmp('s-'), '--root', estate(), '--restic-bin', RESTIC, '--file', file], drillEnv);
    assert.equal(red.code, 1, red.out);
    assert.match(red.first, /FAIL — zset: zrepo snapshot \w{8} of .*: the restore failed — .*ciphertext verification failed/);
    undo();
    // 2. the TREE corrupted with the data intact: before --no-cache the cached tree answered and this PASSED
    const undos = treePacks.map(corrupt);
    red = run(DRILL, ['zset', '--to', tmp('s-'), '--root', estate(), '--restic-bin', RESTIC, '--file', file], drillEnv);
    assert.equal(red.code, 1, red.out);
    assert.match(red.first, /FAIL — zset: zrepo snapshot \w{8} of .*: the tree holding .*restic-sets\.txt could not be read/);
    undos.forEach((u) => u());
    assert.ok(existsSync(repo), 'the repository is untouched by the drill');
  });
});
