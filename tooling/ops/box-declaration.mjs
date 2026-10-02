// ─────────────────────────────────────────────────────────────────────────────
// box-declaration.mjs — THE ONE READING of what a box is declared to run, and
// of what a box was observed to run. The interface of tooling/ports/boxes.json.
//
// Row O-BOXES-NOT-DECLARED-AS-DATA. Until 2026-10-01 what each box runs was
// spread across Private runbooks, tooling/ops/register.json,
// tooling/monitor-register.json, tooling/ops/alarm-chains.json and the boxes
// themselves, and O-BOXA-TRACKED-COPIES-UNGUARDED found a tracked copy that
// omitted what its box ran. The declaration is now data —
// tooling/boxes/<box>.json, tooling/boxes/roles.json and
// tooling/boxes/backups.json — and three tools read it through this module:
//   tooling/ops/check-box-declared.mjs  the read-back (READ-ONLY over SSH)
//   tooling/ops/box-move.mjs            the graded move dry run
//   tooling/ops/restore-drill.mjs       one file back from the newest snapshot
//
// What lives here: the loaders and the validation of the declarations (each
// cited monitor, register row, backup set and role must exist where it is
// cited — a declaration cites, it never restates); the READ-ONLY command set
// and the refusal of anything else; the parsers of each command's raw output;
// and `diffDeclared`, the comparison. Pure functions plus file reads of the
// repository; no network, no exit. Each caller carries its own COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BOXES_DIR = 'tooling/boxes';
export const ROLES_REL = 'tooling/boxes/roles.json';
export const BACKUPS_REL = 'tooling/boxes/backups.json';
export const MONITOR_REGISTER = 'tooling/monitor-register.json';
export const ALARM_CHAINS = 'tooling/ops/alarm-chains.json';
export const OPS_REGISTER = 'tooling/ops/register.json';

/** Every key a box declaration carries; `_toConfirm` is the one optional key. */
export const BOX_FIELDS = Object.freeze([
  'box', '_why', 'roles', 'provider', 'cost', 'spec', 'ssh', 'cronTz', 'services', 'units', 'volumes',
  'backupSets', 'hostnames', 'tunnel', 'monitors', 'crons', 'allowLists',
]);
const OPTIONAL_FIELDS = new Set(['_toConfirm']);
export const RECORD_KINDS = Object.freeze(['tunnel-cname', 'A', 'AAAA', 'CNAME']);
export const ALLOW_LIST_OWNERS = Object.freeze(['owner', 'operator']);
/** RAM and disk as the OS reports them may sit this far below the plan's figure. */
export const SPEC_TOLERANCE = 0.85;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

// ── the READ-ONLY command set ────────────────────────────────────────────────
// Every command the read-back may send to a box. Nothing else is ever sent:
// `assertReadOnly` is called on each command line before ssh is spawned, and
// refuses any write verb even if a future edit adds one here (trap shell-19:
// never kill anything from an SSH session; and no restart, no backup run, no
// config edit, ever). Restic runs with --no-lock AND --no-cache: a lock is a
// write to the repository, and a cache is a write on the box.
export const READ_ONLY_COMMANDS = Object.freeze({
  composeLs: 'docker compose ls --all --format json',
  dockerPs: 'docker ps --all --format \'{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}\'',
  volumes: 'docker volume ls --format \'{{.Name}}\'',
  crontab: 'crontab -l',
  timezone: 'timedatectl show -p Timezone --value',
  systemd: 'systemctl list-units --type=service --state=running --no-legend --plain',
  nproc: 'nproc',
  mem: 'free -b',
  disk: 'df -B1 --output=size,used /',
  stats: 'docker stats --no-stream --format \'{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\'',
});

const WRITE_VERBS = [
  /\b(?:rm|rmdir|mv|cp|dd|tee|truncate|shred|chmod|chown|mkdir|touch|kill|pkill|killall|reboot|shutdown|poweroff)\b/,
  /\bdocker\s+(?:compose\s+)?(?:up|down|stop|start|restart|kill|rm|rmi|pull|run|exec|prune|create|update|system\s+prune|volume\s+(?:rm|prune|create))\b/,
  /\bsystemctl\s+(?:start|stop|restart|reload|enable|disable|mask|unmask|kill|daemon-reload|edit)\b/,
  /\bcrontab\s+(?:-[er]|[^-\s])/,
  /\brestic\b(?![^|;&]*\bsnapshots\b)/,
  /\brestic\b[^|;&]*\b(?:backup|forget|prune|unlock|init|rebuild-index|repair|migrate|key|tag|copy|rewrite)\b/,
  /\brclone\s+(?!lsf\b|lsjson\b|cat\b)/,
  /\bsed\s+-i\b/,
  /(?:^|[^<>2&])>{1,2}(?!&)/,
];

/** Throw when `cmd` could write on a box; the read-back sends nothing that has not passed this. */
export function assertReadOnly(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) throw new Error('refused: an empty command');
  if (/[;&|`]|\$\(/.test(cmd.replace(/'[^']*'/g, "''"))) throw new Error(`refused: \`${cmd}\` chains commands; the read-back sends one read per call`);
  for (const re of WRITE_VERBS) if (re.test(cmd.replace(/'[^']*'/g, "''"))) throw new Error(`refused: \`${cmd}\` matches a write verb (${re}); the read-back never writes on a box`);
  if (/\brestic\b/.test(cmd) && !/--no-lock\b/.test(cmd)) throw new Error(`refused: \`${cmd}\` runs restic without --no-lock, and a lock is a write to the repository`);
  if (/\brestic\b/.test(cmd) && !/--no-cache\b/.test(cmd)) throw new Error(`refused: \`${cmd}\` runs restic without --no-cache, and its cache is a write on the box (and an answer from the cache is not an answer from the repository)`);
  return cmd;
}

/** The read-only restic snapshot listing for a repository on the box. */
export function resticSnapshotsCommand(repo, passwordFile) {
  const q = (s) => `'${String(s).replace(/'/g, '')}'`;
  return `restic --no-lock --no-cache --password-file ${q(passwordFile)} -r ${q(repo)} snapshots --json`;
}

// ── loading and validating the declarations ─────────────────────────────────
/** The box ids declared under tooling/boxes/ (every `box*.json`). */
export function listBoxes(root) {
  return readdirSync(join(root, BOXES_DIR)).filter((f) => /^box[a-z0-9]+\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort();
}

/** What the declarations cite: monitor ids (and names), register row ids. Throws if a register is unreadable. */
export function readCited(root) {
  const monitors = new Map();
  const mon = readJson(root, MONITOR_REGISTER);
  for (const h of mon.hosts ?? []) {
    if (Number.isInteger(h?.monitor?.id)) monitors.set(h.monitor.id, h.monitor.name ?? h.hostname);
    for (const p of h?.pathMonitors ?? []) if (Number.isInteger(p?.id)) monitors.set(p.id, p.name ?? p.url);
  }
  const chains = readJson(root, ALARM_CHAINS);
  for (const m of chains.expectedMonitors ?? []) if (Number.isInteger(m?.id)) monitors.set(m.id, m.name);
  const reg = readJson(root, OPS_REGISTER);
  const rows = new Set((reg.rows ?? []).map((r) => r?.id).filter((x) => typeof x === 'string'));
  if (!monitors.size || !rows.size) throw new Error(`read ${monitors.size} monitor id(s) and ${rows.size} register row(s); a side of zero cites nothing`);
  return { monitors, rows };
}

/** Read every declaration and the two shared files. Returns { boxes: Map, roles, backups, errors }. */
export function readAll(root) {
  const errors = [];
  const boxes = new Map();
  let ids = [];
  try { ids = listBoxes(root); } catch (e) { errors.push(`${BOXES_DIR}/ could not be listed (${e.message})`); }
  if (!ids.length && !errors.length) errors.push(`${BOXES_DIR}/ declares no box`);
  for (const id of ids) {
    try { boxes.set(id, readJson(root, `${BOXES_DIR}/${id}.json`)); } catch (e) { errors.push(`${BOXES_DIR}/${id}.json could not be parsed (${e.message})`); }
  }
  let roles = null;
  let backups = null;
  try { roles = readJson(root, ROLES_REL); } catch (e) { errors.push(`${ROLES_REL} could not be read (${e.message})`); }
  try { backups = readJson(root, BACKUPS_REL); } catch (e) { errors.push(`${BACKUPS_REL} could not be read (${e.message})`); }
  return { boxes, roles, backups, errors };
}

const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const CRON_RE = /^(?:@(?:reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|(?:\S+\s+){4}\S+)$/;

/** Every problem with one declaration, against the registers it cites. */
export function validateBox(doc, file, { cited, roles, backups }) {
  const e = [];
  const at = (m) => e.push(`${file}: ${m}`);
  if (!isObj(doc)) return [`${file}: is not an object`];
  for (const k of BOX_FIELDS) if (!(k in doc)) at(`missing \`${k}\``);
  for (const k of Object.keys(doc)) if (!BOX_FIELDS.includes(k) && !OPTIONAL_FIELDS.has(k)) at(`unknown key \`${k}\``);
  if (`${BOXES_DIR}/${doc.box}.json` !== file) at(`declares box ${JSON.stringify(doc.box)}; the box is the file name`);
  if (!nonEmptyString(doc.provider?.vendor) || !('plan' in (doc.provider ?? {}))) at('provider needs `vendor` and `plan`');
  if (doc.cost?.source !== 'Private/platform-state/identity.json' || !nonEmptyString(doc.cost?.vendorId)) at('cost must CITE Private/platform-state/identity.json by `vendorId`, never carry a figure');
  if (isObj(doc.cost) && Object.keys(doc.cost).some((k) => !['source', 'vendorId', 'why'].includes(k))) at('cost carries a key other than source, vendorId and why: a cost is cited, never copied');
  for (const k of ['cpu', 'ramGiB', 'diskGiB']) if (doc.spec?.[k] !== null && !(typeof doc.spec?.[k] === 'number' && doc.spec[k] > 0)) at(`spec.${k} must be a positive number or null`);
  for (const k of ['hostEnv', 'userEnv', 'keyEnv', 'portEnv', 'sudoEnv']) if (!/^[A-Z][A-Z0-9_]*$/.test(doc.ssh?.[k] ?? '')) at(`ssh.${k} must be an environment variable NAME`);
  if (!isObj(doc.cronTz) || !('value' in doc.cronTz)) at('cronTz needs `value` (null until read)');
  // services
  const svcIds = new Set();
  for (const s of doc.services ?? []) {
    if (!nonEmptyString(s?.id) || svcIds.has(s.id)) at(`service id ${JSON.stringify(s?.id)} is empty or repeated`);
    svcIds.add(s?.id);
    if (!nonEmptyString(s?.image)) at(`service \`${s?.id}\` needs an image repository`);
    if (s?.version !== null && !nonEmptyString(s?.version)) at(`service \`${s?.id}\` version must be a string or null`);
    if (!isObj(s?.compose) || !('project' in s.compose) || !('service' in s.compose)) at(`service \`${s?.id}\` needs compose.project and compose.service (null until read)`);
    if (!(Number.isInteger(s?.containers) && s.containers >= 1)) at(`service \`${s?.id}\` needs containers >= 1`);
    for (const n of s?.secrets ?? []) if (!/^[A-Z][A-Z0-9_]*$/.test(n)) at(`service \`${s?.id}\` secret ${JSON.stringify(n)} is not a NAME`);
    if (s?.use !== null && !(isObj(s?.use) && ['cpu', 'ramGiB', 'diskGiB'].every((k) => typeof s.use[k] === 'number' && s.use[k] >= 0) && nonEmptyString(s.use.asOf))) at(`service \`${s?.id}\` use must be null or {cpu, ramGiB, diskGiB, asOf}`);
  }
  const keyOf = (s) => `${s.image}|${s.compose?.project}|${s.compose?.service}`;
  const seen = new Map();
  for (const s of doc.services ?? []) {
    if (seen.has(keyOf(s))) at(`services \`${seen.get(keyOf(s))}\` and \`${s.id}\` share image and compose project with no compose.service to tell them apart`);
    seen.set(keyOf(s), s.id);
  }
  if (!Array.isArray(doc.units) || doc.units.some((u) => !nonEmptyString(u))) at('units must be a list of unit names');
  // hostnames, monitors, crons, backup sets, roles, allow-lists — each cited where it lives
  for (const h of doc.hostnames ?? []) if (!nonEmptyString(h?.name) || !RECORD_KINDS.includes(h?.record)) at(`hostname ${JSON.stringify(h?.name)} needs a name and a record of ${RECORD_KINDS.join(' | ')}`);
  if ((doc.hostnames ?? []).some((h) => h?.record === 'tunnel-cname') && !nonEmptyString(doc.tunnel?.secret)) at('a tunnel-cname hostname needs `tunnel.secret` (the connector secret NAME)');
  for (const m of doc.monitors ?? []) if (!cited.monitors.has(m)) at(`monitor ${m} is in neither ${MONITOR_REGISTER} nor ${ALARM_CHAINS} expectedMonitors`);
  for (const c of doc.crons ?? []) {
    if (!nonEmptyString(c?.name) || !nonEmptyString(c?.script)) at(`cron ${JSON.stringify(c?.name)} needs a name and a script`);
    if (c?.schedule !== null && !CRON_RE.test(c?.schedule ?? '')) at(`cron \`${c?.name}\` schedule ${JSON.stringify(c?.schedule)} is not a cron schedule (null until read)`);
    if (!cited.rows.has(c?.register)) at(`cron \`${c?.name}\` cites register row ${JSON.stringify(c?.register)}, which is not in ${OPS_REGISTER}`);
  }
  const setIds = new Set((backups?.sets ?? []).map((s) => s.id));
  for (const id of doc.backupSets ?? []) if (!setIds.has(id)) at(`backup set \`${id}\` is not in ${BACKUPS_REL}`);
  for (const v of doc.volumes ?? []) {
    if (!nonEmptyString(v?.name) || !['bind', 'named'].includes(v?.kind)) at(`volume ${JSON.stringify(v?.name)} needs a name and kind bind | named`);
    for (const id of v?.backupSets ?? []) if (!setIds.has(id)) at(`volume \`${v?.name}\` cites backup set \`${id}\`, which is not in ${BACKUPS_REL}`);
  }
  for (const r of doc.roles ?? []) if (roles?.roles?.[r]?.box !== doc.box) at(`role \`${r}\` is not held by ${doc.box} in ${ROLES_REL}`);
  for (const a of doc.allowLists ?? []) {
    if (!nonEmptyString(a?.id) || !nonEmptyString(a?.where) || !ALLOW_LIST_OWNERS.includes(a?.owner) || !nonEmptyString(a?.verify)) at(`allow-list ${JSON.stringify(a?.id)} needs id, where, owner (${ALLOW_LIST_OWNERS.join(' | ')}) and verify`);
    if (a?.row !== null && !/^O-[A-Z0-9-]+$/.test(a?.row ?? '')) at(`allow-list \`${a?.id}\` row must be an O- row id or null`);
  }
  for (const [path, s] of strings(doc)) {
    // A four-part version (supabase/postgres 17.6.1.136) has the shape of an address; only `version` may carry it.
    if (!/\.version$/.test(path) && /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(s)) at(`${path} carries an IPv4 address; a declaration names the address, never writes it`);
  }
  return e;
}

function* strings(v, at = '$') {
  if (typeof v === 'string') yield [at, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${at}[${i}]`);
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) yield* strings(x, `${at}.${k}`);
}

/** Every problem across the set: each box, the roles file and the backups file. */
export function validateAll(root) {
  const { boxes, roles, backups, errors } = readAll(root);
  if (errors.length) return { errors, lost: true, boxes, roles, backups };
  let cited;
  try { cited = readCited(root); } catch (e) { return { errors: [`the cited registers could not be read (${e.message})`], lost: true, boxes, roles, backups }; }
  const out = [];
  for (const [id, doc] of boxes) out.push(...validateBox(doc, `${BOXES_DIR}/${id}.json`, { cited, roles, backups }));
  for (const [role, r] of Object.entries(roles?.roles ?? {})) {
    if (r?.by !== 'single') out.push(`${ROLES_REL}: role \`${role}\` selects by ${JSON.stringify(r?.by)}; every role is \`single\``);
    if (!boxes.has(r?.box)) out.push(`${ROLES_REL}: role \`${role}\` names box ${JSON.stringify(r?.box)}, which has no declaration`);
    else if (!(boxes.get(r.box).roles ?? []).includes(role)) out.push(`${ROLES_REL}: role \`${role}\` names ${r.box}, whose declaration does not list it`);
  }
  if (!Object.keys(roles?.roles ?? {}).length) out.push(`${ROLES_REL}: declares no role`);
  const destIds = new Set();
  for (const d of backups?.destinations ?? []) {
    if (!nonEmptyString(d?.id) || destIds.has(d.id)) out.push(`${BACKUPS_REL}: destination id ${JSON.stringify(d?.id)} is empty or repeated`);
    destIds.add(d?.id);
    if (!isObj(d?.remote) || !('name' in d.remote) || !('layout' in d.remote)) out.push(`${BACKUPS_REL}: destination \`${d?.id}\` must declare BOTH remote.name and remote.layout (trap backup-04)`);
    if (!nonEmptyString(d?.encryption?.posture) || !Array.isArray(d?.encryption?.adr) || !d.encryption.adr.length) out.push(`${BACKUPS_REL}: destination \`${d?.id}\` needs encryption.posture and the ADRs it rests on`);
    if (d?.box !== null && d?.box !== undefined && !boxes.has(d.box)) out.push(`${BACKUPS_REL}: destination \`${d.id}\` is on box ${JSON.stringify(d.box)}, which has no declaration`);
  }
  let cited2 = cited;
  for (const s of backups?.sets ?? []) {
    if (!nonEmptyString(s?.id)) out.push(`${BACKUPS_REL}: a set has no id`);
    if (!cited2.rows.has(s?.writer)) out.push(`${BACKUPS_REL}: set \`${s?.id}\` names writer ${JSON.stringify(s?.writer)}, which is not a ${OPS_REGISTER} row`);
    for (const d of s?.destinations ?? []) if (!destIds.has(d)) out.push(`${BACKUPS_REL}: set \`${s?.id}\` names destination \`${d}\`, which is not declared`);
    if (!s?.destinations?.length) out.push(`${BACKUPS_REL}: set \`${s?.id}\` has no destination`);
    if (s?.box !== null && !boxes.has(s?.box)) out.push(`${BACKUPS_REL}: set \`${s?.id}\` is written on box ${JSON.stringify(s?.box)}, which has no declaration`);
    if (!isObj(s?.drill) || !destIds.has(s.drill.from)) out.push(`${BACKUPS_REL}: set \`${s?.id}\` needs a drill whose \`from\` is one of its destinations`);
    else if (!s.destinations.includes(s.drill.from)) out.push(`${BACKUPS_REL}: set \`${s.id}\` drills from \`${s.drill.from}\`, which is not one of its destinations`);
    if (s?.readBack && !(s.destinations ?? []).includes(s.readBack.destination)) out.push(`${BACKUPS_REL}: set \`${s.id}\` reads back \`${s.readBack.destination}\`, which is not one of its destinations`);
  }
  return { errors: out, lost: false, boxes, roles, backups };
}

// ── the parsers: raw command output in, names out ───────────────────────────
/** `docker compose ls --all --format json` → [{name, status}]. Throws on an unparsable answer. */
export function parseComposeLs(text) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const doc = JSON.parse(t);
  if (!Array.isArray(doc)) throw new Error('docker compose ls did not answer a JSON array');
  return doc.map((p) => ({ name: String(p.Name ?? p.name), status: String(p.Status ?? p.status ?? '') }));
}

/** An image reference → {repo, tag}; docker.io/ and library/ are dropped, a digest is not a tag. */
export function splitImage(ref) {
  let r = String(ref).replace(/@sha256:[0-9a-f]+$/, '');
  r = r.replace(/^(?:docker\.io|index\.docker\.io)\//, '').replace(/^library\//, '');
  const slash = r.lastIndexOf('/');
  const colon = r.lastIndexOf(':');
  if (colon > slash) return { repo: r.slice(0, colon), tag: r.slice(colon + 1) };
  return { repo: r, tag: null };
}

/** `docker ps --all --format <names, image, state, project, service>` → containers. */
export function parseDockerPs(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    const [name, image, state, project, service] = line.split('\t');
    if (!name || !image) throw new Error(`docker ps line has no name or image: ${JSON.stringify(line.slice(0, 80))}`);
    out.push({ name, image, ...splitImage(image), state: state ?? '', project: project || null, service: service || null });
  }
  return out;
}

/** `crontab -l` → {tz, jobs:[{schedule, command}]}. "no crontab for" is an empty table, not an error. */
export function parseCrontab(text) {
  const jobs = [];
  let tz = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^no crontab for /.test(line)) continue;
    const env = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (env) { if (env[1] === 'CRON_TZ' || env[1] === 'TZ') tz = env[2].replace(/^["']|["']$/g, ''); continue; }
    const at = /^(@\w+)\s+(.+)$/.exec(line);
    if (at) { jobs.push({ schedule: at[1], command: at[2] }); continue; }
    const f = line.split(/\s+/);
    if (f.length < 6) throw new Error(`crontab line is neither a job nor an assignment: ${JSON.stringify(line.slice(0, 60))}`);
    jobs.push({ schedule: f.slice(0, 5).join(' '), command: f.slice(5).join(' ') });
  }
  return { tz, jobs };
}

/** `restic snapshots --json` → {count, newest} — counts and the newest timestamp only. */
export function parseResticSnapshots(text) {
  const doc = JSON.parse(String(text ?? '').trim() || 'null');
  if (!Array.isArray(doc)) throw new Error('restic snapshots did not answer a JSON array');
  const times = doc.map((s) => Date.parse(s?.time)).filter((t) => !Number.isNaN(t));
  return { count: doc.length, newest: times.length ? new Date(Math.max(...times)).toISOString() : null };
}

/** `systemctl list-units --type=service --state=running --no-legend --plain` → unit names without `.service`. */
export function parseSystemdUnits(text) {
  return String(text ?? '').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean).map((u) => u.replace(/\.service$/, ''));
}

/** `docker volume ls --format '{{.Name}}'` → names. */
export const parseVolumes = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

const GiB = 1024 ** 3;
const round1 = (n) => Math.round(n * 10) / 10;

/** nproc, `free -b`, `df -B1 --output=size,used /` → {cpu, ramGiB, diskGiB, diskUsedGiB}. */
export function parseSpec({ nproc, mem, disk }) {
  const cpu = Number.parseInt(String(nproc ?? '').trim(), 10);
  const memLine = String(mem ?? '').split('\n').find((l) => /^Mem:/.test(l.trim()));
  const ram = memLine ? Number(memLine.trim().split(/\s+/)[1]) : Number.NaN;
  const [size, used] = (String(disk ?? '').trim().split('\n').pop() ?? '').trim().split(/\s+/).map(Number);
  if (!Number.isFinite(cpu) || !Number.isFinite(ram) || !Number.isFinite(size)) throw new Error('nproc, free -b or df answered something that is not a number');
  return { cpu, ramGiB: round1(ram / GiB), diskGiB: round1(size / GiB), diskUsedGiB: Number.isFinite(used) ? round1(used / GiB) : null };
}

const UNIT = { B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: GiB, KB: 1e3, MB: 1e6, GB: 1e9 };
/** `docker stats --no-stream --format <name, cpu%, mem usage>` → [{name, cpuPct, memMiB}]. */
export function parseStats(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    const [name, cpu, mem] = line.split('\t');
    const m = /^([\d.]+)\s*([KMG]i?B|B)/i.exec(String(mem ?? '').trim());
    const cpuPct = Number.parseFloat(String(cpu ?? '').replace('%', ''));
    if (!name || !m || !Number.isFinite(cpuPct)) throw new Error(`docker stats line could not be read: ${JSON.stringify(line.slice(0, 80))}`);
    out.push({ name, cpuPct, memMiB: round1((Number(m[1]) * UNIT[m[2].toUpperCase()]) / 1024 ** 2) });
  }
  return out;
}

// ── the comparison ──────────────────────────────────────────────────────────
const normVer = (v) => (v === null || v === undefined ? null : String(v).replace(/^v/, ''));

/**
 * Compare a declaration with what was observed. `observed` holds the RAW output
 * of each READ_ONLY_COMMANDS key (absent = could not read) and `restic` as
 * {<set id>: raw}. Returns {drift, lost, ok, observed: names-only summary}.
 */
export function diffDeclared(doc, observed, backups) {
  const drift = [];
  const lost = [];
  const ok = [];
  const names = {};
  const read = (key, parse) => {
    if (observed[key] === undefined || observed[key] === null) { lost.push(`${key}: not read (${READ_ONLY_COMMANDS[key] ?? key})`); return null; }
    try { return parse(observed[key]); } catch (e) { lost.push(`${key}: the answer could not be parsed (${e.message})`); return null; }
  };

  // services: every running container is declared, every declared service runs
  const containers = read('dockerPs', parseDockerPs);
  const projects = read('composeLs', parseComposeLs);
  if (containers) {
    const running = containers.filter((c) => /^running$/i.test(c.state) || c.state === '');
    names.containers = running.map((c) => `${c.name} (${c.repo}${c.tag ? `:${c.tag}` : ''})`);
    const claimed = new Map((doc.services ?? []).map((s) => [s.id, []]));
    for (const c of running) {
      const s = (doc.services ?? []).find((x) => x.image === c.repo && (x.compose?.project === null || x.compose?.project === c.project) && (x.compose?.service === null || x.compose?.service === c.service));
      if (!s) { drift.push(`services: running container \`${c.name}\` (image ${c.repo}, project ${c.project ?? 'none'}) is declared by no service`); continue; }
      claimed.get(s.id).push(c);
    }
    for (const s of doc.services ?? []) {
      const got = claimed.get(s.id);
      if (!got.length) { drift.push(`services: \`${s.id}\` (${s.image}) is declared and no container of it is running`); continue; }
      if (got.length !== s.containers) drift.push(`services: \`${s.id}\` declares ${s.containers} container(s) and ${got.length} run`);
      const tags = [...new Set(got.map((c) => normVer(c.tag)))];
      if (s.version === null) lost.push(`services: \`${s.id}\` version is UNREAD in the declaration (running: ${tags.join(', ') || 'untagged'})`);
      else if (tags.some((t) => t !== normVer(s.version))) drift.push(`services: \`${s.id}\` declares ${s.version} and runs ${tags.join(', ') || 'an untagged image'}`);
      if (s.compose?.project === null) lost.push(`services: \`${s.id}\` compose project is UNREAD (running in: ${[...new Set(got.map((c) => c.project ?? 'none'))].join(', ')})`);
      if (got.length === s.containers && s.version !== null && tags.every((t) => t === normVer(s.version))) ok.push(`services: ${s.id} ${s.version} ×${got.length}`);
    }
    const stopped = containers.filter((c) => !running.includes(c));
    for (const c of stopped) {
      const s = (doc.services ?? []).find((x) => x.image === c.repo);
      if (!s) drift.push(`services: stopped container \`${c.name}\` (image ${c.repo}) is declared by no service`);
    }
  }
  if (projects) {
    names.composeProjects = projects.map((p) => p.name);
    const declared = new Set((doc.services ?? []).map((s) => s.compose?.project).filter(Boolean));
    for (const p of projects) if (!declared.has(p.name) && !(doc.services ?? []).some((s) => s.compose?.project === null)) drift.push(`compose: project \`${p.name}\` is declared by no service`);
    for (const p of declared) if (!projects.some((x) => x.name === p)) drift.push(`compose: project \`${p}\` is declared and \`docker compose ls\` does not list it`);
  }

  // volumes (named ones; a bind path is not a docker volume)
  const vols = read('volumes', parseVolumes);
  if (vols) {
    names.volumes = vols;
    const declared = (doc.volumes ?? []).filter((v) => v.kind === 'named').map((v) => v.name);
    const matches = (obs, dec) => obs === dec || obs.endsWith(`_${dec}`);
    for (const v of vols) if (!declared.some((d) => matches(v, d))) drift.push(`volumes: docker volume \`${v}\` is declared nowhere`);
    for (const d of declared) if (!vols.some((v) => matches(v, d))) drift.push(`volumes: \`${d}\` is declared and does not exist`);
  }

  // crons and their timezone (shell-25: as read, never as assumed)
  const cron = read('crontab', parseCrontab);
  const tz = read('timezone', (t) => String(t).trim() || (() => { throw new Error('empty answer'); })());
  if (cron) {
    names.crons = cron.jobs.map((j) => `${j.schedule} ${(/\S*\/[\w.-]+\.(?:sh|py|mjs|js)\b/.exec(j.command) ?? [j.command.split(/\s+/)[0]])[0]}`);
    const used = new Set();
    for (const c of doc.crons ?? []) {
      const hits = cron.jobs.filter((j) => j.command.includes(c.script));
      hits.forEach((h) => used.add(h));
      if (!hits.length) { drift.push(`crons: \`${c.name}\` (${c.script}) is declared and is not in the crontab`); continue; }
      if (c.schedule === null) lost.push(`crons: \`${c.name}\` schedule is UNREAD (crontab: ${hits.map((h) => h.schedule).join(', ')})`);
      else if (!hits.some((h) => h.schedule === c.schedule)) drift.push(`crons: \`${c.name}\` declares \`${c.schedule}\` and the crontab runs \`${hits.map((h) => h.schedule).join(', ')}\``);
      else ok.push(`crons: ${c.name} ${c.schedule}`);
    }
    for (const j of cron.jobs) if (!used.has(j)) drift.push(`crons: \`${names.crons[cron.jobs.indexOf(j)]}\` is in the crontab and declared by no cron`);
  }
  if (cron || tz) {
    const effective = cron?.tz ?? tz;
    names.cronTz = effective;
    if (effective && doc.cronTz?.value === null) lost.push(`cronTz: UNREAD in the declaration (the box reads ${effective})`);
    else if (effective && effective !== doc.cronTz?.value) drift.push(`cronTz: declared ${doc.cronTz?.value} and the box's cron runs ${effective}`);
    else if (effective) ok.push(`cronTz: ${effective}`);
  }

  // systemd (names)
  const units = read('systemd', parseSystemdUnits);
  if (units) {
    names.units = units;
    for (const u of units) if (!(doc.units ?? []).includes(u)) drift.push(`units: \`${u}\` is running and declared nowhere`);
    for (const u of doc.units ?? []) if (!units.includes(u)) drift.push(`units: \`${u}\` is declared and not running`);
  }

  // spec
  const haveSpec = ['nproc', 'mem', 'disk'].every((k) => observed[k] !== undefined && observed[k] !== null);
  if (!haveSpec) lost.push('spec: nproc, free -b or df was not read');
  else {
    try {
      const s = parseSpec(observed);
      names.spec = s;
      for (const [k, tol] of [['cpu', 1], ['ramGiB', SPEC_TOLERANCE], ['diskGiB', SPEC_TOLERANCE]]) {
        const d = doc.spec?.[k];
        if (d === null || d === undefined) lost.push(`spec.${k}: UNREAD in the declaration (the box reads ${s[k]})`);
        else if (s[k] < d * tol || s[k] > d * 1.05) drift.push(`spec.${k}: declared ${d}, the box reads ${s[k]}`);
      }
    } catch (e) { lost.push(`spec: ${e.message}`); }
  }

  // measured use, per declared service: the input for its `use` (informational, never a finding)
  if (observed.stats !== undefined && observed.stats !== null && containers) {
    try {
      const stats = parseStats(observed.stats);
      const use = {};
      for (const s of doc.services ?? []) {
        const mine = containers.filter((c) => c.repo === s.image && (s.compose?.project === null || s.compose?.project === c.project));
        const rows = stats.filter((x) => mine.some((c) => c.name === x.name));
        if (rows.length) use[s.id] = { cpu: round1(rows.reduce((a, r) => a + r.cpuPct, 0) / 100), ramGiB: round1(rows.reduce((a, r) => a + r.memMiB, 0) / 1024) };
      }
      names.measuredUse = use;
    } catch (e) { names.measuredUse = `unreadable: ${e.message}`; }
  }

  // restic repositories that live on this box: counts and the newest timestamp only
  for (const set of (backups?.sets ?? []).filter((s) => s.readBack && (doc.backupSets ?? []).includes(s.id))) {
    const dest = (backups.destinations ?? []).find((d) => d.id === set.readBack.destination);
    if (dest?.box !== doc.box) continue;
    if (!set.readBack.passwordFile) { lost.push(`restic: set \`${set.id}\` declares no readBack.passwordFile, so its snapshots cannot be listed`); continue; }
    const raw = observed.restic?.[set.id];
    if (raw === undefined || raw === null) { lost.push(`restic: set \`${set.id}\` was not read`); continue; }
    try {
      const r = parseResticSnapshots(raw);
      names[`restic:${set.id}`] = r;
      if (r.count === 0) drift.push(`restic: set \`${set.id}\` holds no snapshot`);
      else ok.push(`restic: ${set.id} ${r.count} snapshot(s), newest ${r.newest}`);
    } catch (e) { lost.push(`restic: set \`${set.id}\`: ${e.message}`); }
  }
  return { drift, lost, ok, names };
}
