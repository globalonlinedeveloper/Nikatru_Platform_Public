// product-steps/monitor-row.mjs — step 10: every host the app is served from has
// a monitor row (E-b2). Sources: the app's catalog/apps.json row (`api` and
// `origin`, the hosts assert-monitor-coverage.mjs derives for an app) and
// tooling/monitor-register.json `hosts`. A row and its live GlitchTip monitor
// are one change, and creating the monitor is O-E2's go, so a missing row is
// the owner's step. The guard FAILS an `api` host with no row and PRINTS an
// origin host with no row ("printed not hidden"); this reader names both.
import { catalogRowOf, readJsonAt } from './tree.mjs';

export const name = 'monitor row';
export const guard = 'node tooling/ci/assert-monitor-coverage.mjs';
export const REGISTER_REL = 'tooling/monitor-register.json';

const hostOf = (u) => {
  try {
    return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export function read(root, id) {
  const reg = readJsonAt(root, REGISTER_REL);
  if (!reg.ok) return { lost: `${reg.why}, so no host's monitor row can be read` };
  if (!Array.isArray(reg.value?.hosts)) return { lost: `${REGISTER_REL} holds no \`hosts\` array` };
  const c = catalogRowOf(root, id);
  if (c.lost) return { lost: c.lost };
  if (c.row === null) return { state: 'NEXT', detail: 'no catalogue row yet, so no served host to watch', command: 'the stamp step above', guard };
  const wanted = ['origin', 'api']
    .map((f) => (typeof c.row[f] === 'string' && c.row[f] !== '' ? hostOf(c.row[f]) : null))
    .filter((h) => h !== null);
  const rows = new Map(reg.value.hosts.map((h) => [String(h?.hostname ?? '').toLowerCase(), h]));
  const noRow = wanted.filter((h) => !rows.has(h));
  const noMonitor = wanted.filter((h) => rows.has(h) && (rows.get(h).monitor ?? null) === null);
  if (noRow.length === 0 && noMonitor.length === 0) {
    return { state: 'DONE', detail: `${wanted.join(', ')}: each has a row and a monitor`, guard };
  }
  const parts = [];
  if (noRow.length) parts.push(`no row: ${noRow.join(', ')}`);
  if (noMonitor.length) parts.push(`row with monitor null: ${noMonitor.join(', ')}`);
  return {
    state: 'OWNER',
    detail: parts.join('; '),
    owner: "O-E2 — the owner's go for the GlitchTip monitor; the row lands with it",
    command: 'node tooling/ops/ensure-monitors.mjs --apply (after the go; printed, never run by this command)',
    guard,
  };
}
