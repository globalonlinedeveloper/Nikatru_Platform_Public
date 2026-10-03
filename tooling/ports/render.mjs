#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render.mjs — THE PORT TABLES CODE READS, RENDERED FROM THE REGISTRIES.
//
//   node tooling/ports/render.mjs [--check] [--root <repoRoot>]
//
// Writes services/platform/src/generated/ports.ts from tooling/ports/payments.json:
// the payments adapter list per environment (id, status, environments, declared
// capabilities) and each rail's cancel path, DERIVED from its capabilities (`cancel`
// → api, `cancel-store` → store, neither → none). The Worker's composition root
// (services/platform/src/ports.ts) and lib/mor/registry.ts read these tables; no
// hand array restates them. The rail PRICE map (RAIL_PRICE_IDS[railId][appId][offeringId])
// is rendered by the generator that already owns the price ids,
// tooling/catalog/render-rail-prices.mjs, into routes/rail-price-ids.ts — one renderer
// per source register, never a hand merge.
//
// ⏱ 2026-10-01 · port-pay-client · and a DART target, packages/purchases/lib/src/generated/rails.dart:
// the register rail each APP channel sells through (tooling/channel-register.json `channels[]`
// `purchaseRail.rail`, the rows `purchaseRails` governs) and the client rail KIND each register
// rail is — `none`, a STORE-billed rail by its own id (a rail served by a `cancel-store` adapter's
// fee cells, the predicate port-switch's move rule reads), or `hosted` for every other rail:
// WHICH vendor serves a hosted page is the server's business, so the client never names one.
// `PurchaseRailKind.forChannel` reads this map; no switch in Dart restates the register.
//
// ⏱ 2026-10-03 · port-auth · and the TRUSTED ISSUERS, services/_shared/src/generated/ports.ts,
// from tooling/ports/auth.json `issuers`: each row's id, the Worker variable holding its origin,
// its issuer and JWKS paths, its algorithms and its audience. services/_shared/src/auth.ts
// (`trustedIssuers`) resolves them against a Worker's environment; nothing types an issuer URL.
//
// ⏱ 2026-10-03 · port-codehost · and the CODE HOST'S NAMES, from tooling/github-org.json (the org
// and the platform's repositories; tooling/ports/codehost.json names the host adapter): the platform
// Worker's services/platform/src/generated/codehost.ts (the owner and repo every dispatch and the
// ops watchdog address) and tooling/generated/codehost.mjs, which every script imports. Nothing
// else types the org (assert-no-dead-repo-names.mjs, its code-host limb).
//
// --check re-renders in memory and compares: exit 1 on any difference (a hand edit of
// a generated file, or a registry edit not re-rendered), 2 when a source cannot
// be read (COVERAGE LOST), 0 when current. Without --check it writes. assert-ports.mjs
// limb 3 runs `renderCheck` on every build. Row O-NO-PORT-SELECTS-AN-ADAPTER-BY-CONFIG.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAYMENTS_REGISTRY = 'tooling/ports/payments.json';
export const RENDERED_PORTS = 'services/platform/src/generated/ports.ts';
export const CHANNEL_REGISTER = 'tooling/channel-register.json';
export const FEE_REGISTER = 'tooling/catalog/fee-register.json';
export const RENDERED_RAILS_DART = 'packages/purchases/lib/src/generated/rails.dart';
export const AUTH_REGISTRY = 'tooling/ports/auth.json';
export const RENDERED_ISSUERS = 'services/_shared/src/generated/ports.ts';
export const CODEHOST_REGISTER = 'tooling/github-org.json';
export const CODEHOST_PORT = 'tooling/ports/codehost.json';
export const RENDERED_CODEHOST_TS = 'services/platform/src/generated/codehost.ts';
export const RENDERED_CODEHOST_MJS = 'tooling/generated/codehost.mjs';
/** Each code-host adapter's web and API origins: the host is the adapter, the names are the register's. */
export const CODEHOST_ORIGINS = Object.freeze({ github: Object.freeze({ web: 'https://github.com', api: 'https://api.github.com' }) });
const ENV_ORDER = ['test', 'sandbox', 'live'];

/** The rails an adapter serves: the `rail` of each of its fee cells. */
export const railsOf = (adapter, cells) => new Set((adapter?.cost?.feeCells ?? []).map((id) => cells?.[id]?.rail).filter(Boolean));

/** An adapter that fronts a STORE's own billing: only the store can bill or cancel (`cancel-store`). */
export const billsThroughStore = (adapter) => (adapter?.capabilities ?? []).includes('cancel-store');

/**
 * The store-billed rails, DERIVED from the registry: every rail a `cancel-store` adapter serves
 * (today RevenueCat's apple-iap and play-billing). A channel on one of these is billed by the
 * store: port-switch moves it only to another store biller (#1127 money review, finding 3), and
 * the client's rail kind for it is the store's own (the Dart render below).
 */
export function storeBilledRails(adapters, cells) {
  return new Set((adapters ?? []).filter(billsThroughStore).flatMap((a) => [...railsOf(a, cells)]));
}

/** The cancel path a rail's DECLARED capabilities give it. */
export function cancelPathOf(capabilities) {
  const caps = new Set(capabilities ?? []);
  if (caps.has('cancel')) return 'api';
  if (caps.has('cancel-store')) return 'store';
  return 'none';
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const list = (xs) => `[${xs.map(q).join(', ')}]`;

/** The generated module's bytes for one payments registry document. */
export function renderPortsTs(doc) {
  const adapters = (doc?.adapters ?? []).filter((a) => a && typeof a.id === 'string');
  const ids = adapters.map((a) => a.id);
  const L = [
    '// GENERATED by tooling/ports/render.mjs from tooling/ports/payments.json.',
    '// Do not edit: `node tooling/ports/render.mjs --check` re-renders this file and fails on any difference,',
    '// and assert-ports.mjs limb 3 runs that check on every build. Change the registry, then re-render.',
    '',
    `export type PaymentsAdapterId = ${ids.map(q).join(' | ') || 'never'};`,
    "export type PortEnvironment = 'test' | 'sandbox' | 'live';",
    "export type RailCancelPath = 'api' | 'store' | 'none';",
    '',
    'export interface PaymentsAdapterRow {',
    '  readonly id: PaymentsAdapterId;',
    '  readonly status: string;',
    '  readonly environments: readonly PortEnvironment[];',
    '  readonly capabilities: readonly string[];',
    '  readonly cancelPath: RailCancelPath;',
    '}',
    '',
    '// Every payments adapter, in registry order, with the environments it may serve.',
    'export const PAYMENTS_ADAPTERS: readonly PaymentsAdapterRow[] = [',
  ];
  for (const a of adapters) {
    const envs = ENV_ORDER.filter((e) => (a.environments ?? []).includes(e));
    L.push(
      `  { id: ${q(a.id)}, status: ${q(a.status)}, environments: ${list(envs)}, capabilities: ${list(a.capabilities ?? [])}, cancelPath: ${q(cancelPathOf(a.capabilities))} },`,
    );
  }
  L.push('];', '');
  L.push('// How each rail cancels, DERIVED from its declared capabilities (cancel → api, cancel-store → store).');
  L.push('export const RAIL_CANCEL_PATH: Readonly<Record<string, RailCancelPath>> = {');
  for (const a of adapters) L.push(`  ${a.id}: ${q(cancelPathOf(a.capabilities))},`);
  L.push('};', '');
  // The inbound rails that verify REAL money: every non-fake, non-retired adapter declaring `verify`. The
  // composition root builds MOR_VERIFIERS from this list, and the money guards (assert-mor-adapters,
  // assert-money-config, assert-purchase-path, the policy-claims rail row) read the provider set from it.
  const moneyRails = adapters.filter((a) => a.status !== 'fake' && a.status !== 'retired' && (a.capabilities ?? []).includes('verify'));
  L.push('// The inbound rails that verify real money (non-fake adapters declaring `verify`), in registry order.');
  L.push(`export const MOR_VERIFIER_IDS = ${list(moneyRails.map((a) => a.id))} as const satisfies readonly PaymentsAdapterId[];`, '');
  // The web checkout rail: the ONE real adapter that declares `checkout`. Two would need a per-channel
  // selection (channel-register purchaseRails) the checkout route does not read yet, so two render null
  // and the route refuses rather than guessing.
  const sellers = adapters.filter((a) => a.status !== 'fake' && a.status !== 'retired' && a.status !== 'draft' && (a.capabilities ?? []).includes('checkout'));
  L.push('// The web checkout rail: the one non-fake adapter declaring `checkout` (null when zero or several do).');
  L.push(`export const CHECKOUT_RAIL_ID: PaymentsAdapterId | null = ${sellers.length === 1 ? q(sellers[0].id) : 'null'};`, '');
  L.push('// The adapter ids per environment: the set a deploy of that environment may select.');
  L.push('export const PAYMENTS_ADAPTERS_BY_ENVIRONMENT: Readonly<Record<PortEnvironment, readonly PaymentsAdapterId[]>> = {');
  for (const e of ENV_ORDER) L.push(`  ${e}: ${list(adapters.filter((a) => (a.environments ?? []).includes(e)).map((a) => a.id))},`);
  L.push('};');
  return `${L.join('\n')}\n`;
}

/** The trusted-issuer module's bytes for one auth registry document (port-auth). */
export function renderIssuersTs(doc) {
  const rows = (doc?.issuers ?? []).filter((r) => r && typeof r.id === 'string');
  const L = [
    '// GENERATED by tooling/ports/render.mjs from tooling/ports/auth.json `issuers`.',
    '// Do not edit: `node tooling/ports/render.mjs --check` re-renders this file and fails on any difference,',
    '// and assert-ports.mjs limb 3 runs that check on every build. Change the registry, then re-render.',
    '',
    'export interface AuthIssuerRow {',
    '  readonly id: string;',
    '  /** The Worker variable holding this issuer\'s origin. */',
    '  readonly originEnv: string;',
    '  readonly issuerPath: string;',
    '  readonly jwksPath: string;',
    '  readonly algorithms: readonly string[];',
    '  readonly audience: string;',
    '}',
    '',
    '// The issuers a Worker trusts, in order; the FIRST is the primary (its key set is the one cached in KV).',
    'export const AUTH_ISSUERS: readonly AuthIssuerRow[] = [',
  ];
  for (const r of rows) {
    L.push(`  { id: ${q(r.id)}, originEnv: ${q(r.originEnv)}, issuerPath: ${q(r.issuerPath)}, jwksPath: ${q(r.jwksPath)}, algorithms: ${list(r.algorithms ?? [])}, audience: ${q(r.audience)} },`);
  }
  L.push('];');
  return `${L.join('\n')}\n`;
}

/** The auth registry, or {lost}. A registry with no issuer row renders a module that trusts nobody: LOST, never "current". */
export function readIssuerSource(root) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(root, AUTH_REGISTRY), 'utf8'));
  } catch (e) {
    return { lost: `${AUTH_REGISTRY} could not be read (${e.message})` };
  }
  if (!Array.isArray(doc?.issuers) || doc.issuers.length === 0) {
    return { lost: `${AUTH_REGISTRY} lists no issuer; a table of zero rows is current by construction` };
  }
  return { doc };
}

/** Re-render the trusted-issuer module in memory and compare. {ok, lost, detail}. */
export function renderIssuersCheck(root) {
  const src = readIssuerSource(root);
  if (src.lost) return { ok: false, lost: true, detail: src.lost };
  return compareRendered(root, RENDERED_ISSUERS, renderIssuersTs(src.doc), AUTH_REGISTRY);
}

/**
 * The code host's names, or {lost}: the org, the PUBLIC platform repository (the one this tree is,
 * which every dispatch and default addresses), the private one, and the selected host adapter.
 */
export function readCodehostSource(root) {
  let org;
  let port;
  try {
    org = JSON.parse(readFileSync(join(root, CODEHOST_REGISTER), 'utf8'));
  } catch (e) {
    return { lost: `${CODEHOST_REGISTER} could not be read (${e.message})` };
  }
  try {
    port = JSON.parse(readFileSync(join(root, CODEHOST_PORT), 'utf8'));
  } catch (e) {
    return { lost: `${CODEHOST_PORT} could not be read (${e.message})` };
  }
  const platform = Array.isArray(org?.platform) ? org.platform : [];
  const pub = platform.filter((p) => p?.visibility === 'PUBLIC');
  const priv = platform.filter((p) => p?.visibility === 'PRIVATE');
  if (typeof org?.org !== 'string' || !/^[A-Za-z0-9-]+$/.test(org.org)) return { lost: `${CODEHOST_REGISTER} names no org` };
  if (pub.length !== 1) return { lost: `${CODEHOST_REGISTER} names ${pub.length} PUBLIC platform repositories; the dispatch target must be exactly one` };
  const host = (port?.adapters ?? []).find((a) => a && a.status !== 'draft' && a.status !== 'retired' && a.status !== 'fake');
  const origins = host ? CODEHOST_ORIGINS[host.id] : undefined;
  if (!origins) return { lost: `${CODEHOST_PORT} selects no host adapter whose origins render.mjs knows (${Object.keys(CODEHOST_ORIGINS).join(', ')})` };
  return { names: { host: host.id, org: org.org, platformRepo: pub[0].repo, privateRepo: priv[0]?.repo ?? null, ...origins } };
}

const HEADER = (src) => [
  `// GENERATED by tooling/ports/render.mjs from ${src}.`,
  '// Do not edit: `node tooling/ports/render.mjs --check` re-renders this file and fails on any difference,',
  '// and assert-ports.mjs limb 3 runs that check on every build. Change the register, then re-render.',
];

/** The platform Worker's code-host module (port-codehost). */
export function renderCodehostTs(n) {
  return `${[
    ...HEADER(`${CODEHOST_REGISTER} (the code host, ${CODEHOST_PORT})`),
    '',
    `export const CODEHOST_ORG = ${q(n.org)};`,
    `export const PLATFORM_REPO = ${q(n.platformRepo)};`,
    `export const CODEHOST_API_ORIGIN = ${q(n.api)};`,
    '',
    '/** The repository every workflow dispatch and the ops watchdog address. */',
    'export const PLATFORM_REPO_REF = { owner: CODEHOST_ORG, repo: PLATFORM_REPO } as const;',
  ].join('\n')}\n`;
}

/** The scripts' code-host module (port-codehost). */
export function renderCodehostMjs(n) {
  return `${[
    ...HEADER(`${CODEHOST_REGISTER} (the code host, ${CODEHOST_PORT})`),
    '',
    'export const CODEHOST = Object.freeze({',
    `  host: ${q(n.host)},`,
    `  org: ${q(n.org)},`,
    `  platformRepo: ${q(n.platformRepo)},`,
    `  privateRepo: ${n.privateRepo === null ? 'null' : q(n.privateRepo)},`,
    `  webOrigin: ${q(n.web)},`,
    `  apiOrigin: ${q(n.api)},`,
    '});',
    '',
    '/** `<org>/<repo>` — the form GITHUB_REPOSITORY and `gh --repo` take. */',
    'export const repoSlug = (repo = CODEHOST.platformRepo) => `${CODEHOST.org}/${repo}`;',
    '',
    '/** The platform repository\'s slug: the default of every script that addresses this tree. */',
    'export const PLATFORM_REPO_SLUG = repoSlug();',
    '',
    '/** A repository\'s web URL on the host. */',
    'export const repoUrl = (repo = CODEHOST.platformRepo) => `${CODEHOST.webOrigin}/${repoSlug(repo)}`;',
  ].join('\n')}\n`;
}

/** Re-render both code-host modules in memory and compare. {ok, lost, detail}. */
export function renderCodehostCheck(root) {
  const src = readCodehostSource(root);
  if (src.lost) return { ok: false, lost: true, detail: src.lost };
  const a = compareRendered(root, RENDERED_CODEHOST_TS, renderCodehostTs(src.names), CODEHOST_REGISTER);
  const b = compareRendered(root, RENDERED_CODEHOST_MJS, renderCodehostMjs(src.names), CODEHOST_REGISTER);
  const bad = [a, b].filter((r) => !r.ok);
  if (!bad.length) return { ok: true, lost: false, detail: `${a.detail}; ${b.detail}` };
  return { ok: false, lost: bad.every((r) => r.lost), detail: bad.map((r) => r.detail).join('; ') };
}

/**
 * The file's text, or null when it does not exist. ONE read, never an exists-then-read
 * pair: a check between the test and the use is a file-system race (CodeQL
 * js/file-system-race, #1127). Any error but ENOENT — a directory, a permission — throws,
 * and the callers turn it into LOST rather than into "absent".
 */
export function readIfPresent(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

const dq = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;

/**
 * The client rail kind of each register rail: `none` stays `none`, a store-billed rail keeps its
 * own id (the client must tell Play Billing from StoreKit), and every other rail is `hosted`.
 */
export function railKindOf(rail, stores) {
  if (rail === 'none') return 'none';
  return stores.has(rail) ? rail : 'hosted';
}

/**
 * The Dart module's bytes: {text} or {lost}. `channelDoc` is tooling/channel-register.json, `doc`
 * the payments registry, `cells` the fee-register cells. Only APP channels are rendered — an
 * extension is sold from the Worker, never from a Dart client.
 */
export function renderRailsDart(channelDoc, doc, cells) {
  const dictionary = channelDoc?.purchaseRails?.rails;
  if (!dictionary || typeof dictionary !== 'object') return { lost: `${CHANNEL_REGISTER} has no purchaseRails.rails dictionary` };
  const rows = (Array.isArray(channelDoc?.channels) ? channelDoc.channels : [])
    .filter((c) => c?.surface === 'app' && typeof c?.id === 'string' && typeof c?.purchaseRail?.rail === 'string');
  if (!rows.length) return { lost: `${CHANNEL_REGISTER} has no app channel carrying a purchaseRail.rail; a rail map of zero rows is current by construction` };
  for (const r of rows) {
    if (!(r.purchaseRail.rail in dictionary)) return { lost: `${CHANNEL_REGISTER} channel \`${r.id}\` takes rail \`${r.purchaseRail.rail}\`, which purchaseRails.rails does not define` };
  }
  const stores = storeBilledRails(doc?.adapters, cells);
  if (!stores.size) return { lost: `no store-billed rail was derived from ${PAYMENTS_REGISTRY} (no \`cancel-store\` adapter with fee cells in ${FEE_REGISTER}); every store channel would render as hosted` };
  const L = [
    '// GENERATED by tooling/ports/render.mjs from tooling/channel-register.json (`channels[].purchaseRail.rail`,',
    '// governed by `purchaseRails`) and tooling/ports/payments.json (the store-billed rails: those a',
    '// `cancel-store` adapter serves, by tooling/catalog/fee-register.json cells).',
    '// Do not edit: `node tooling/ports/render.mjs --check` re-renders this file and fails on any difference,',
    '// and assert-ports.mjs limb 3 runs that check on every build. Change the register, then re-render.',
    '',
    '/// The client rail kind (`PurchaseRailKind.wire`) each APP channel sells through, keyed by the',
    '/// channel\'s register id: `none`, a store-billed rail by its own id, or `hosted` — which vendor',
    '/// serves a hosted page is the server\'s business, so no vendor is named here.',
    'const Map<String, String> kChannelRailKind = <String, String>{',
    ...rows.map((r) => `  ${dq(r.id)}: ${dq(railKindOf(r.purchaseRail.rail, stores))},`),
    '};',
  ];
  return { text: `${L.join('\n')}\n` };
}

/** Read the three sources the Dart render needs: {channelDoc, doc, cells} or {lost}. */
export function readRailSources(root) {
  const out = {};
  for (const [key, rel] of [['channelDoc', CHANNEL_REGISTER], ['doc', PAYMENTS_REGISTRY], ['fee', FEE_REGISTER]]) {
    try { out[key] = JSON.parse(readFileSync(join(root, rel), 'utf8')); } catch (e) {
      return { lost: `${rel} could not be read (${e.message})` };
    }
  }
  return { channelDoc: out.channelDoc, doc: out.doc, cells: out.fee?.cells ?? {} };
}

/** Compare one rendered file with what is on disk. {ok, lost, detail}. */
function compareRendered(root, rel, want, source) {
  let have;
  try {
    have = readIfPresent(join(root, rel));
  } catch (e) {
    return { ok: false, lost: true, detail: `${rel} could not be read (${e.message})` };
  }
  if (have === null) return { ok: false, lost: false, detail: `${rel} does not exist; run node tooling/ports/render.mjs` };
  if (have !== want) {
    const a = have.split('\n');
    const b = want.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
    return {
      ok: false,
      lost: false,
      detail: `${rel} differs from its render at line ${i + 1}: have ${JSON.stringify(a[i] ?? '<eof>')}, want ${JSON.stringify(b[i] ?? '<eof>')}. A generated file is never hand-edited; re-render from ${source}.`,
    };
  }
  return { ok: true, lost: false, detail: `${rel} matches ${source}` };
}

/** Re-render the Dart rail map in memory and compare. {ok, lost, detail}. */
export function renderRailsCheck(root) {
  const src = readRailSources(root);
  if (src.lost) return { ok: false, lost: true, detail: src.lost };
  const r = renderRailsDart(src.channelDoc, src.doc, src.cells);
  if (r.lost) return { ok: false, lost: true, detail: r.lost };
  return compareRendered(root, RENDERED_RAILS_DART, r.text, `${CHANNEL_REGISTER} and ${PAYMENTS_REGISTRY}`);
}

/** Re-render every target in memory and compare. {ok, lost, detail}. */
export function renderCheck(root) {
  const ts = renderPortsCheck(root);
  const dart = renderRailsCheck(root);
  const issuers = renderIssuersCheck(root);
  const codehost = renderCodehostCheck(root);
  const bad = [ts, dart, issuers, codehost].filter((r) => !r.ok);
  if (!bad.length) return { ok: true, lost: false, detail: `${ts.detail}; ${dart.detail}; ${issuers.detail}; ${codehost.detail}` };
  // A finding outranks a coverage loss: exit 1 when any target differs, 2 only when every failure could not look.
  const finding = bad.find((r) => !r.lost);
  return { ok: false, lost: !finding, detail: bad.map((r) => r.detail).join('; ') };
}

/** Re-render the TS ports table in memory and compare. {ok, lost, detail}. */
export function renderPortsCheck(root) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(root, PAYMENTS_REGISTRY), 'utf8'));
  } catch (e) {
    return { ok: false, lost: true, detail: `${PAYMENTS_REGISTRY} could not be read (${e.message})` };
  }
  if (!Array.isArray(doc?.adapters) || doc.adapters.length === 0) {
    return { ok: false, lost: true, detail: `${PAYMENTS_REGISTRY} lists no adapter; a table of zero rows is current by construction` };
  }
  const want = renderPortsTs(doc);
  const abs = join(root, RENDERED_PORTS);
  let have;
  try {
    have = readIfPresent(abs);
  } catch (e) {
    return { ok: false, lost: true, detail: `${RENDERED_PORTS} could not be read (${e.message})` };
  }
  if (have === null) return { ok: false, lost: false, detail: `${RENDERED_PORTS} does not exist; run node tooling/ports/render.mjs` };
  if (have !== want) {
    const a = have.split('\n');
    const b = want.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
    return {
      ok: false,
      lost: false,
      detail: `${RENDERED_PORTS} differs from its render at line ${i + 1}: have ${JSON.stringify(a[i] ?? '<eof>')}, want ${JSON.stringify(b[i] ?? '<eof>')}. A generated file is never hand-edited; re-render from ${PAYMENTS_REGISTRY}.`,
    };
  }
  return { ok: true, lost: false, detail: `${RENDERED_PORTS} matches ${PAYMENTS_REGISTRY} (${doc.adapters.length} adapter(s))` };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const at = args.indexOf('--root');
  const root = resolve(at >= 0 ? args[at + 1] ?? '.' : process.cwd());
  for (const a of args) {
    if (a.startsWith('--') && a !== '--check' && a !== '--root') {
      console.error(`render: REFUSED — unknown flag ${a}`);
      process.exit(2);
    }
  }
  if (check) {
    const r = renderCheck(root);
    if (r.ok) console.log(`ok   render --check — ${r.detail}`);
    else console.error(`${r.lost ? 'LOST' : 'FAIL'} render --check — ${r.detail}`);
    process.exit(r.ok ? 0 : r.lost ? 2 : 1);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(root, PAYMENTS_REGISTRY), 'utf8'));
  } catch (e) {
    console.error(`LOST render — ${PAYMENTS_REGISTRY} could not be read (${e.message})`);
    process.exit(2);
  }
  const src = readRailSources(root);
  if (src.lost) {
    console.error(`LOST render — ${src.lost}`);
    process.exit(2);
  }
  const rails = renderRailsDart(src.channelDoc, src.doc, src.cells);
  if (rails.lost) {
    console.error(`LOST render — ${rails.lost}`);
    process.exit(2);
  }
  const issuerSrc = readIssuerSource(root);
  if (issuerSrc.lost) {
    console.error(`LOST render — ${issuerSrc.lost}`);
    process.exit(2);
  }
  const codehostSrc = readCodehostSource(root);
  if (codehostSrc.lost) {
    console.error(`LOST render — ${codehostSrc.lost}`);
    process.exit(2);
  }
  for (const [rel, want] of [
    [RENDERED_PORTS, renderPortsTs(doc)],
    [RENDERED_RAILS_DART, rails.text],
    [RENDERED_ISSUERS, renderIssuersTs(issuerSrc.doc)],
    [RENDERED_CODEHOST_TS, renderCodehostTs(codehostSrc.names)],
    [RENDERED_CODEHOST_MJS, renderCodehostMjs(codehostSrc.names)],
  ]) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    let have;
    try {
      have = readIfPresent(abs);
    } catch (e) {
      console.error(`LOST render — ${rel} could not be read (${e.message})`);
      process.exit(2);
    }
    if (have !== want) writeFileSync(abs, want);
    console.log(`ok   render — ${have === want ? 'unchanged' : 'wrote'} ${rel}`);
  }
}

const IS_MAIN = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) main();
