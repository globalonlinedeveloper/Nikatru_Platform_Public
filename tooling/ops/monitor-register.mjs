// ─────────────────────────────────────────────────────────────────────────────
// monitor-register.mjs — the monitor ids tooling/monitor-register.json declares,
// and the one way a script writes a host row into that file.
//
// ⏱ 2026-09-26 (O-SERVICE-KIT-UNBUILT, E-b2). Three readers share it:
//   · tooling/ops/verify-alarm-chains.mjs takes its canary list from
//     `expectedMonitors()` below: every host row's monitor id, plus
//     tooling/ops/alarm-chains.json `expectedMonitors`, which from today holds
//     only the monitors that are NOT a host row (heartbeats, routine beats). A
//     host monitor is therefore declared in ONE place, the host row, and an id in
//     both places is refused rather than quietly counted once.
//   · tooling/ops/ensure-monitors.mjs creates the monitor a host row asks for and
//     writes its id back with `replaceHostRow()`.
//   · tooling/scripts/provision-backend.mjs step [7] adds a new Worker's host row
//     with `appendHostRow()`.
//
// 🔴 THE FILE IS HAND-FORMATTED, SO NO WRITER RE-SERIALISES IT. Measured
// 2026-09-26: `JSON.stringify(JSON.parse(text), null, 2)` differs from the file
// in 107 diff lines (blank lines between blocks, one-line monitor objects). A
// writer that re-serialised the whole file would rewrite every row to change one.
// So a write replaces or appends ONE element of `hosts` as text, and is then
// proven by parsing the result: it must equal the parsed original with exactly
// that one row changed, or nothing is written and the caller is told why.
//
// Nothing here reads the network, sets an exit code or decides a verdict.
// ─────────────────────────────────────────────────────────────────────────────
import { isDeepStrictEqual } from 'node:util';

export const REGISTER_REL = 'tooling/monitor-register.json';

/**
 * The ids the canary expects to find live, and what it cannot key on yet.
 *
 *   expected — one entry per monitor id: every host row's `monitor.id` (a monitor
 *              that watches two hosts is one id), then every `expectedMonitors`
 *              row of the ledger.
 *   pending  — the host rows with `monitor: null`: declared, with no monitor id
 *              yet (ensure-monitors has not created one, or the gap is a decision).
 *   problems — each one a broken canary, worded for verify-alarm-chains to print.
 */
export function expectedMonitors(register, ledger) {
  const problems = [];
  const pending = [];
  const byId = new Map();
  const hosts = Array.isArray(register?.hosts) ? register.hosts : [];
  if (hosts.length === 0) {
    problems.push(
      `COVERAGE LOST: ${REGISTER_REL} has no \`hosts\`, so not one host monitor id was read. The canary's host half ` +
        'comes from that file alone since 2026-09-26; reading nothing there would shrink the check while every other ' +
        'limb still printed ok.',
    );
  }
  for (const h of hosts) {
    const m = h?.monitor;
    if (m === null || m === undefined) {
      pending.push({ hostname: String(h?.hostname ?? ''), name: h?.gap?.create?.name ?? null, why: h?.gap?.why ?? null });
      continue;
    }
    const id = String(m.id ?? '');
    if (!/^[0-9]+$/.test(id)) {
      problems.push(
        `COVERAGE LOST: ${REGISTER_REL} host ${JSON.stringify(h?.hostname ?? '')} claims a monitor with no numeric \`id\`; ` +
          'the canary keys on the id. A host with no monitor yet is `monitor: null` with a `gap`.',
      );
      continue;
    }
    const cur = byId.get(id) ?? { id, name: m.name ?? '', from: [] };
    cur.from.push(`${REGISTER_REL} ${h.hostname}`);
    byId.set(id, cur);
  }
  const hostIds = new Set(byId.keys());
  const listed = ledger?.expectedMonitors;
  if (!Array.isArray(listed) || listed.length === 0) {
    problems.push(
      'COVERAGE LOST: `expectedMonitors` is missing or empty, so the canary can never fire for a monitor that is not ' +
        'a host. Never "fix" a failure by emptying it. (This key replaced `expectedMonitorNames` on 2026-09-03; ' +
        'if you are seeing this after an upgrade, the ledger still has the old name-keyed list.)',
    );
  }
  for (const row of Array.isArray(listed) ? listed : []) {
    const id = String(row?.id ?? '');
    if (!/^[0-9]+$/.test(id)) {
      problems.push(`COVERAGE LOST: \`expectedMonitors\` entry ${JSON.stringify(row)} has no numeric \`id\`; the canary keys on the id.`);
      continue;
    }
    if (hostIds.has(id)) {
      problems.push(
        `ONE PLACE PER ID: monitor id ${id} is in alarm-chains.json \`expectedMonitors\` AND in ${byId.get(id).from.join(', ')}. ` +
          `A host's monitor is declared on its host row; remove id ${id} from \`expectedMonitors\`, or the two lists can ` +
          'disagree about it and only one of them is ever read.',
      );
      continue;
    }
    if (byId.has(id)) {
      problems.push(`\`expectedMonitors\` lists monitor id ${id} twice; one of the two rows is never read.`);
      continue;
    }
    byId.set(id, { id, name: row.name ?? '', from: ['alarm-chains.json expectedMonitors'] });
  }
  return { expected: [...byId.values()], pending, problems };
}

// ── the one write: a host row, as text ─────────────────────────────────────

/** Where the JSON value that starts at or after `i` ends (exclusive). */
function skipWs(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}
function skipString(text, i) {
  // text[i] === '"'
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '"') return j + 1;
  }
  throw new Error('unterminated string');
}
function skipValue(text, i) {
  i = skipWs(text, i);
  if (text[i] === '"') return skipString(text, i);
  if (text[i] === '{' || text[i] === '[') {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (c === '"') { j = skipString(text, j) - 1; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    throw new Error('unbalanced brackets');
  }
  let j = i;
  while (j < text.length && !/[\s,}\]]/.test(text[j])) j++;
  return j;
}

/** The text span of the top-level `hosts` array and of each of its elements. */
function hostsSpan(text) {
  let i = skipWs(text, 0);
  if (text[i] !== '{') throw new Error(`${REGISTER_REL} is not a JSON object`);
  i++;
  for (;;) {
    i = skipWs(text, i);
    if (text[i] === '}') break;
    const keyEnd = skipString(text, i);
    const key = JSON.parse(text.slice(i, keyEnd));
    i = skipWs(text, keyEnd);
    if (text[i] !== ':') throw new Error(`${REGISTER_REL}: expected ':' after ${JSON.stringify(key)}`);
    const valueStart = skipWs(text, i + 1);
    const valueEnd = skipValue(text, valueStart);
    if (key === 'hosts') {
      if (text[valueStart] !== '[') throw new Error(`${REGISTER_REL}: \`hosts\` is not an array`);
      const elements = [];
      let j = valueStart + 1;
      for (;;) {
        j = skipWs(text, j);
        if (text[j] === ']') break;
        const end = skipValue(text, j);
        elements.push({ start: j, end });
        j = skipWs(text, end);
        if (text[j] === ',') j++;
      }
      return { open: valueStart, close: valueEnd - 1, elements };
    }
    i = skipWs(text, valueEnd);
    if (text[i] === ',') i++;
  }
  throw new Error(`${REGISTER_REL} has no top-level \`hosts\` array`);
}

const indentAt = (text, offset) => text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
const rowText = (row, indent) => JSON.stringify(row, null, 2).split('\n').join(`\n${indent}`);

function proven(before, after, expectHosts) {
  const want = { ...JSON.parse(before), hosts: expectHosts };
  if (!isDeepStrictEqual(JSON.parse(after), want)) {
    throw new Error(`the edited ${REGISTER_REL} does not parse to the original with one host row changed; nothing was written`);
  }
  return after;
}

/** `text` with `row` appended to `hosts`, at the indentation of the last row. */
export function appendHostRow(text, row) {
  const { open, close, elements } = hostsSpan(text);
  const hosts = JSON.parse(text).hosts;
  if (elements.length === 0) {
    const indent = `${indentAt(text, open)}  `;
    return proven(text, `${text.slice(0, open + 1)}\n${indent}${rowText(row, indent)}\n${text.slice(close)}`, [row]);
  }
  const last = elements.at(-1);
  const indent = indentAt(text, last.start);
  return proven(text, `${text.slice(0, last.end)},\n${indent}${rowText(row, indent)}${text.slice(last.end)}`, [...hosts, row]);
}

/** `text` with `hosts[index]` replaced by `row`, at that row's indentation. */
export function replaceHostRow(text, index, row) {
  const { elements } = hostsSpan(text);
  const at = elements[index];
  if (!at) throw new Error(`${REGISTER_REL} has no hosts[${index}]`);
  const hosts = JSON.parse(text).hosts.map((h, i) => (i === index ? row : h));
  return proven(text, `${text.slice(0, at.start)}${rowText(row, indentAt(text, at.start))}${text.slice(at.end)}`, hosts);
}
