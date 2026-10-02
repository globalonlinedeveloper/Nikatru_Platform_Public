#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// new-channel.mjs — scaffold a STORE CHANNEL: a register row, a port adapter and
// a submitter skeleton that the dry-run contract already grades.
//
// ⏱ 2026-10-01 (port-channels, O-CHANNELS-HAVE-NO-SUBMIT-CONTRACT). Adding a
// store is a row plus an adapter (tooling/ports/channels.json, whose _why says
// so), and this is the command that writes the three pieces in the shapes the
// guards read:
//   · the tooling/channel-register.json row — `served: false`, `submittable:
//     false`, every fact a store has to answer left null for the owner's reading;
//   · the tooling/ports/channels.json adapter — `status: draft`, so it earns
//     nothing until it is built; a matching `candidates` entry is moved into it;
//   · the submitter skeleton — tooling/release/submit-<id>.mjs (an app channel)
//     or extensions/scripts/publish-<id>.mjs (an extension channel), exporting a
//     ChannelSubmitter whose `--submit` REFUSES until it is written.
// And it prints the OWNER STEPS, which it never performs: no account is opened,
// no term is accepted and no store is called by anything here.
//
// 🔴 A DRY RUN UNLESS `--write`. With no mode, or `--dry-run`, it prints all
// three pieces and the owner steps and writes NOTHING. `--write` writes them and
// refuses when any of the three already exists. `--dry-run --write` is refused.
//
// 🔴 TRAPS shell-13: a no-value flag in a hand-rolled argv loop eats the next
// argument, and a `--dry-run` written last once UPLOADED. So the flags are two
// declared sets: a VALUED flag takes the next argument and refuses one that
// starts with `--`; a SWITCH never takes one; anything in neither is refused.
//
// After `--write`, the contract test (tooling/release/test/submitters.contract
// .test.mjs) is RED until the new channel has a fixture in
// tooling/release/test/fixtures/submitters.json — that is the forcing function,
// not a fault.
//
// Usage:
//   node tooling/kit/new-channel.mjs --id <channel-id> [--name <name>] [--surface app|extension]
//                                    [--dry-run | --write] [--root <dir>]
//
// Exit: 0 printed (dry run) or written · 1 refused: the channel or a file already
// exists · 2 usage, or COVERAGE LOST — a register it must read is absent.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REGISTER_REL = 'tooling/channel-register.json';
export const PORT_REL = 'tooling/ports/channels.json';
/** The text the channels array ends on; the row is inserted before it. */
const CHANNELS_END = '\n  ],\n  "disqualified"';

export const VALUED = new Set(['--id', '--name', '--surface', '--root']);
export const SWITCHES = new Set(['--dry-run', '--write']);

/** argv → { opts, errors }. Pure. */
export function parseArgs(argv) {
  const opts = { switches: new Set() };
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (SWITCHES.has(a)) opts.switches.add(a);
    else if (VALUED.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) errors.push(`${a} needs a value${v === undefined ? '' : `, and the next argument is the flag ${v}`}`);
      else {
        opts[a.slice(2)] = v;
        i++;
      }
    } else errors.push(`unknown argument ${JSON.stringify(a)}`);
  }
  if (opts.switches.has('--dry-run') && opts.switches.has('--write')) errors.push('--dry-run and --write together: pick one');
  if (opts.id === undefined) errors.push('--id <channel-id> is required');
  else if (!/^[a-z][a-z0-9-]*$/.test(opts.id)) errors.push(`--id ${JSON.stringify(opts.id)} is not a channel id (lower-case letters, digits, hyphens)`);
  if (opts.surface !== undefined && !['app', 'extension'].includes(opts.surface)) errors.push(`--surface must be app or extension, not ${JSON.stringify(opts.surface)}`);
  return { opts, errors };
}

const camel = (id) => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** The three pieces and the owner steps for `id`. Pure: every input is passed in. */
export function scaffold({ id, name, surface, candidate }) {
  const display = name ?? candidate?.name ?? id;
  const script = surface === 'extension' ? `extensions/scripts/publish-${id}.mjs` : `tooling/release/submit-${id}.mjs`;
  const symbol = `${camel(id)}Submitter`;
  const reason = candidate?.deferral?.reason ?? `${display} is a channel to evaluate: no developer account exists, so nothing is submitted.`;
  const row = {
    id,
    name: display,
    platforms: [],
    kind: 'store',
    surface,
    storefrontKey: null,
    served: false,
    submittable: false,
    purchaseRail: null,
    artifactFormats: [],
    signing: { keyKind: null },
    minimumToolchain: [],
    lane: null,
    deploymentEnvironment: null,
    storeMetadataDir: surface === 'extension' ? `extensions/Extension/{tool}/store/${id}` : `apps/{app}/store/${id}`,
    ownerQueue: null,
    accountStatus: { status: 'none', asOf: null, note: 'Scaffolded by tooling/kit/new-channel.mjs. No account is open; every null above is read from the store, never guessed.' },
    deferral: { reason, alsoBlockedBy: 'the owner steps new-channel.mjs printed' },
    notes: [],
  };
  const adapter = {
    id,
    vendor: null,
    channel: id,
    status: 'draft',
    impl: { file: script, symbol },
    capabilities: ['validate', 'plan', 'upload', 'status'],
    secrets: [],
    identity: [],
    environments: ['test'],
    cost: { feeCells: candidate?.commission?.cell ? [candidate.commission.cell] : [], unit: null },
    conformance: { file: 'tooling/release/test/submitters.contract.test.mjs' },
    exportDuty: candidate?.exportDuty ?? 'UNREAD: what leaves with us (the listing, rendered from app.yaml), what stays (reviews, ratings) and what is permanent (the app id) — read from the store before the adapter is built.',
    readAt: null,
    account: { kind: 'unrecorded', source: `${REGISTER_REL} channels[${id}].accountStatus — no account yet` },
  };
  const common = surface === 'extension' ? '../../tooling/release/submit-common.mjs' : './submit-common.mjs';
  const submitter = `#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ${script.split('/').pop()} — the ${display} channel (${id}). SKELETON, scaffolded by
// tooling/kit/new-channel.mjs: the ChannelSubmitter is in place so the dry-run
// contract grades it, and \`--submit\` REFUSES until the store's calls are read from
// a primary source and written here, each citing its URL.
// ─────────────────────────────────────────────────────────────────────────────
import { storeSubmitter, invokedAsScript } from '${common}';

export const ${symbol} = storeSubmitter({
  channel: '${id}',
  script: '${script}',
  steps: (artifact) => [
    { does: \`upload \${artifact?.path ?? 'the artifact'} by hand: no submission API is sourced yet\`, surface: 'console', call: '${display} developer console', writes: true },
  ],
  uploadArgv: (artifact) => ['--submit', '--app', artifact.app],
});

if (invokedAsScript(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--submit')) {
    console.error('FAIL --submit is NOT BUILT for ${id}: no store call is sourced. Nothing was sent.');
    process.exit(1);
  }
  for (const s of ${symbol}.plan({ path: '<artifact>' }, { dryRun: true })) console.log(\`→    \${s.step}. [\${s.surface}] \${s.does}\`);
}
`;
  const ownerSteps = candidate?.deferral?.ownerSteps ?? [
    `open a ${display} developer account, and record its kind (individual or organization) — an entity change later has to move it`,
    `read ${display}'s developer terms and record the commission as a tooling/catalog/fee-register.json cell, with the date read and its URL`,
    'read the listing fields and limits the store publishes, with their sources, into the register row',
  ];
  const agentSteps = [
    `add a recorded fixture for ${id} to tooling/release/test/fixtures/submitters.json — the contract test is red until it exists`,
    `add the ${id} row's storeMetadataContract.perChannel entry and the metadata tree it names`,
  ];
  return { script, symbol, row, adapter, submitter, ownerSteps, agentSteps };
}

/** Run with `argv`; returns the exit code. `log`/`err` are injectable for the tests. */
export function main(argv, { log = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const { opts, errors } = parseArgs(argv);
  if (errors.length) {
    for (const e of errors) err(`FAIL ${e}`);
    err('usage: node tooling/kit/new-channel.mjs --id <channel-id> [--name <name>] [--surface app|extension] [--dry-run | --write] [--root <dir>]');
    return 2;
  }
  const root = resolve(opts.root ?? join(HERE, '..', '..'));
  const write = opts.switches.has('--write');
  let register;
  let port;
  let registerText;
  let portText;
  try {
    registerText = readFileSync(join(root, REGISTER_REL), 'utf8');
    register = JSON.parse(registerText);
    portText = readFileSync(join(root, PORT_REL), 'utf8');
    port = JSON.parse(portText);
  } catch (e) {
    err(`FAIL COVERAGE LOST — ${e.message}. new-channel reads ${REGISTER_REL} and ${PORT_REL}, and scaffolds nothing it cannot check against them.`);
    return 2;
  }
  if ((register.channels ?? []).some((c) => c.id === opts.id)) {
    err(`FAIL ${opts.id} is already a ${REGISTER_REL} row. A store is scaffolded once.`);
    return 1;
  }
  if ((port.adapters ?? []).some((a) => a.id === opts.id)) {
    err(`FAIL ${opts.id} is already an adapter in ${PORT_REL}.`);
    return 1;
  }
  const candidate = (port.candidates ?? []).find((c) => c.id === opts.id) ?? null;
  const s = scaffold({ id: opts.id, name: opts.name, surface: opts.surface ?? 'app', candidate });

  log(`new-channel: ${opts.id}${candidate ? ` — from the ${PORT_REL} candidate "${candidate.name}"` : ''} — ${write ? 'WRITE' : 'DRY RUN (nothing is written; pass --write)'}`);
  log(`\n── the ${REGISTER_REL} row ──`);
  log(JSON.stringify(s.row, null, 2));
  log(`\n── the ${PORT_REL} adapter${candidate ? ' (replaces the candidate)' : ''} ──`);
  log(JSON.stringify(s.adapter, null, 2));
  log(`\n── the submitter skeleton: ${s.script} (exports ${s.symbol}) ──`);
  log(s.submitter);
  log('── OWNER STEPS (printed, never performed) ──');
  s.ownerSteps.forEach((o, i) => log(`  ${i + 1}. ${o}`));
  log('── then, the agent ──');
  s.agentSteps.forEach((o) => log(`  · ${o}`));

  if (!write) {
    log('\nnew-channel: DRY RUN — nothing was written. Pass --write to scaffold these three pieces.');
    return 0;
  }
  const at = registerText.lastIndexOf(CHANNELS_END);
  if (at === -1) {
    err(`FAIL COVERAGE LOST — ${REGISTER_REL} no longer ends its channels array on ${JSON.stringify(CHANNELS_END)}; the row cannot be placed without rewriting the file.`);
    return 2;
  }
  const rowText = `,\n${JSON.stringify(s.row, null, 2).replace(/^/gm, '    ')}`;
  const nextRegister = registerText.slice(0, at) + rowText + registerText.slice(at);
  const parsed = JSON.parse(nextRegister);
  if (parsed.channels.at(-1)?.id !== opts.id) {
    err(`FAIL the inserted row did not land as the last channel of ${REGISTER_REL}; nothing was written.`);
    return 1;
  }
  port.adapters = [...port.adapters, s.adapter];
  if (candidate) port.candidates = port.candidates.filter((c) => c.id !== opts.id);
  mkdirSync(dirname(join(root, s.script)), { recursive: true });
  // The submitter is written FIRST and exclusively ('wx'): one call both checks
  // and creates, so no check-then-write race (CodeQL js/file-system-race), and
  // when it already exists nothing at all has been written yet.
  try {
    writeFileSync(join(root, s.script), s.submitter, { flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    err(`FAIL ${s.script} already exists; new-channel never overwrites a submitter.`);
    return 1;
  }
  writeFileSync(join(root, REGISTER_REL), nextRegister);
  writeFileSync(join(root, PORT_REL), `${JSON.stringify(port, null, 2)}\n`);
  log(`\nnew-channel: WROTE ${REGISTER_REL}, ${PORT_REL} and ${s.script}.`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
