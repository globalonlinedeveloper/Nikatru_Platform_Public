#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-arming.mjs — the ONE answer, for the three extension store lanes, to
// "may this run publish, must it refuse, or does it print an owner step?"
//
// 🔴 IT IMPORTS tooling/ci/channel-arming.mjs AND DOES NOT RESTATE IT. The
// arming rule — `served: true`, or `submittable: true` with a real `lane` — has
// exactly one implementation in this repository and three signing seams already
// read it. A fourth copy here would be the defect that module's own header
// names: two readings of one register that agree until the day they do not.
//
// ── THE THREE VERDICTS, AND WHY THE MIDDLE ONE IS NOT A SKIP ─────────────────
//   go       every declared credential is present and the register ARMS the row.
//            The caller publishes.
//   refuse   a credential is EMPTY and the register ARMS the row. Exit 1. This is
//            the fail-closed case: a channel that can reach a user, with no way
//            to authenticate, is a release that would half-ship.
//   pending  a credential is empty and the row is NOT armed. The caller PRINTS
//            the exact owner step and the release records
//            `pending_manual_publish`, which is what `record-deployment.mjs`
//            already accepts for a `submittable: false` store row.
//            [pipeline C-6]: a guard that blocks CI on work only the owner can do
//            blocks every merge in the repository. ADR 067 decision 8 puts ONE
//            MANUAL FIRST PUBLISH in front of every store, so `submittable:
//            false` here is a statement about the store account, not about this
//            code — and the day the owner flips it, the SAME run with the SAME
//            empty secret REFUSES instead. That flip is the register's on-switch.
//
// The fourth quadrant — credentials present, row NOT armed — is `pending` too,
// with its own loud line. A secret that exists for a channel nothing arms is not
// an authorisation to publish: the register is the switch, never the vault.
//
// ⚠️ NOTHING HERE READS OR PRINTS A SECRET VALUE. It reads `process.env[name]`
// only to ask whether it is a non-empty string, and reports NAMES.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armingOf, armingOfTool } from '../../tooling/ci/channel-arming.mjs';
import { CWS_SA_ENV, CWS_SA_DOC } from './publish-cws-token.mjs';

/** The repository root, resolved from THIS file rather than from the working
 *  directory: `extensions.yml` runs its steps with `working-directory: extensions`
 *  by default and with `.` on the platform steps, so a cwd-relative root would
 *  resolve differently depending on which kind of step called in. */
export const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const REGISTER = 'tooling/channel-register.json';

/** Where a TOOL declares its own per-store listing identity. `<tool>` is the id
 *  the release tag carries. */
export const TOOL_JSON_REL = 'extensions/Extension/<dir>/tool.json';

/**
 * Every tool.json under extensions/Extension/ that DECLARES `id`, as
 * { where } rows. Returns a LIST because zero and two are different failures and
 * the caller must be able to say which.
 *
 * The only thing it asks of a manifest is its `id`. A tool.json that declares
 * the id and nothing else resolves — which is what the gate self-test's minimal
 * fixtures are, and what a new tool looks like on its first day.
 */
function declaringToolJson(root, id) {
  const base = join(root, 'extensions', 'Extension');
  if (!existsSync(base)) return [];
  const out = [];
  for (const dir of readdirSync(base)) {
    const rel = `extensions/Extension/${dir}/tool.json`;
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    let tool;
    try { tool = JSON.parse(readFileSync(abs, 'utf8')); } catch { continue; }
    if (tool?.id === id) out.push({ where: rel });
  }
  return out;
}

/**
 * 🔴 `<dir>` IS NOT THE TOOL ID, AND ASSUMING IT WAS KILLED THE RELEASE LANE.
 * Measured 2026-09-12 by rehearsal run 34693076340: this file resolved
 * `extensions/Extension/fullshot/tool.json` and refused COVERAGE LOST, because the
 * directory is `Full_Screen_Shot` and the id `fullshot` is DECLARED INSIDE the file.
 * The lane died one gate after the two this session had already cleared.
 *
 * release-manifest.mjs had already settled this and says so at productSurfaces():
 * "a directory position is not a declaration — the day a non-extension product lives
 * under that root, a path rule would still call it one." That resolver SCANS
 * every tool.json under extensions/Extension/ and matches the declared id, and it is IMPORTED
 * here rather than reimplemented: two resolvers for one question is how they drift
 * apart, and this one drifted from the tree instead.
 */

/** The scan cannot continue and reporting "nothing to do" would be a lie about
 *  nothing. Callers exit 1 on this; a publish path that cannot find its own
 *  register must never fall through to "no credentials, therefore pending". */
export class ArmingCoverageLost extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

/** The register row for `channelId`, read from disk once. */
export function readChannel(channelId, root = REPO_ROOT) {
  const abs = join(root, REGISTER);
  if (!existsSync(abs)) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — ${REGISTER} does not exist under ${root}.`,
      'The arming answer, the owner step and the deferral all live on that row. Without the file this',
      'would decide "not armed" from an absence and publish nothing while reporting success.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new ArmingCoverageLost([`COVERAGE LOST — ${REGISTER} is not valid JSON — ${e.message}`]);
  }
  const row = (register.channels ?? []).find((c) => c.id === channelId);
  if (row === undefined) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — ${REGISTER} declares no "${channelId}" channel.`,
      'This lane exists to publish exactly that row. A missing row is not an unarmed row: it is a',
      'register this script can no longer be graded against.',
    ]);
  }
  return row;
}

/**
 * THE TOOL'S OWN LISTING IDENTITY on a store, read from
 * `extensions/Extension/<tool>/tool.json` `storeMetadata.stores.<key>.listingId`.
 *
 * 🔴 IT IS READ FROM THE TOOL AND NOT FROM THE ENVIRONMENT, AND THAT IS THE
 * WHOLE POINT. Until 2026-09-07 the Chrome item id and the Edge product id were
 * repository-global secrets (`CWS_ITEM_ID`, `EDGE_PRODUCT_ID`) on a lane that is
 * multi-tool by construction — `.github/workflows/extensions.yml` requires a tag
 * `^[a-z0-9][a-z0-9-]*-v<semver>$` and derives the tool from it. A second
 * extension's tag would have uploaded its package to the FIRST tool's listing
 * and printed `SUBMITTED — <the second tool>`: not a failure, a wrong success,
 * in the one act this repository treats as irreversible.
 *
 * The store KEY is not invented here either: it is the register row's own
 * `extensionStoreKey`, which `assert-channel-register.mjs` already holds against
 * `tool.json`'s `storeMetadata.stores` in both directions — so a store this
 * register claims and the tool has never heard of is already a build failure,
 * and this function inherits that agreement rather than restating it.
 *
 * A missing tool.json, a missing store row, or a store key the row does not
 * declare is COVERAGE LOST, never "no id, therefore not armed": deciding "unarmed"
 * from an absence is how a publish path reports success having published nothing,
 * or worse, having published somewhere else.
 */
export function toolListingId({ toolId, storeKey, root = REPO_ROOT }) {
  if (typeof toolId !== 'string' || toolId.trim() === '') {
    throw new ArmingCoverageLost([
      'COVERAGE LOST — no tool id was given, so no per-tool listing identity can be read.',
      'The release lane derives the tool from the tag; a publish with no tool is a publish with no destination.',
    ]);
  }
  if (typeof storeKey !== 'string' || storeKey.trim() === '') {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — the channel row for tool "${toolId}" declares no \`extensionStoreKey\`.`,
      `That key is the store's name in ${TOOL_JSON_REL}'s \`storeMetadata.stores\`, and`,
      'without it there is no row to read the listing id from.',
    ]);
  }
  /* Resolved by DECLARATION, never by directory name — see TOOL_JSON_REL above.
   *
   * ⚠️ IT DOES NOT REUSE release-manifest.mjs's productSurfaces(), AND THE FIRST
   * VERSION OF THIS FIX DID. That helper answers a DIFFERENT question — "which
   * products answer to this id and what SURFACE are they on" — and to answer it
   * it skips any tool.json whose `surface` field is missing or empty. Arming
   * never reads `surface`, so borrowing that resolver silently imported a
   * requirement this file does not have: every minimal tool.json became invisible
   * and SEVEN gate self-test cases went red, measured 2026-09-12 before merge.
   * Reusing a helper is right when the question is the same. It was not. */
  const surfaces = declaringToolJson(root, toolId);
  if (surfaces.length === 0) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — no extensions/Extension/*/tool.json under ${root} declares id "${toolId}".`,
      'The listing id lives on the tool, so a tool no manifest claims has no declared destination — and treating',
      'that as "not armed" would let a release with a mistyped tool id report a clean pending instead of stopping.',
      'NOTE the directory need not be named after the id: fullshot is declared inside Full_Screen_Shot/tool.json.',
    ]);
  }
  if (surfaces.length > 1) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — ${surfaces.length} manifests declare id "${toolId}": ${surfaces.map((x) => x.where).join(', ')}.`,
      'Two declarations of one id is ambiguous, and picking the first would make the destination depend on',
      'directory order. Zero and two are different failures and neither is "not armed".',
    ]);
  }
  const rel = surfaces[0].where;
  const abs = join(root, rel);
  let tool;
  try {
    tool = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new ArmingCoverageLost([`COVERAGE LOST — ${rel} is not valid JSON — ${e.message}`]);
  }
  const stores = tool?.storeMetadata?.stores;
  if (stores === undefined || stores === null || typeof stores !== 'object') {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — ${rel} declares no \`storeMetadata.stores\`.`,
      'That block is the STORE axis of the tool and the only place a per-store listing id can be declared.',
    ]);
  }
  if (!Object.prototype.hasOwnProperty.call(stores, storeKey)) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — ${rel} declares stores [${Object.keys(stores).join(', ')}] and the channel names "${storeKey}".`,
      'A store the register claims and the tool has never heard of is a listing nobody writes; publishing to it',
      'would be addressing a destination neither file describes.',
    ]);
  }
  const raw = stores[storeKey]?.listingId ?? null;
  // ⏱ 2026-09-24 (EXT-3): the tool's public listing URL for this store, from
  // `listings.<store>` ("Store URLs, once live. null until then"). The Chrome and
  // Edge publishers print it for the [10]D-9 record that follows their submit;
  // both stores need a manual first publish (ADR 067 decision 8), so a submit
  // through the API happens only after it is set. null is carried, never guessed.
  const url = tool?.listings?.[storeKey] ?? null;
  return {
    field: `${rel} storeMetadata.stores.${storeKey}.listingId`,
    listingId: typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null,
    listingUrl: typeof url === 'string' && /^https:\/\//.test(url.trim()) ? url.trim() : null,
  };
}

/**
 * The verdict.
 *
 * @param {object} o
 * @param {string} o.channelId      register row id, e.g. "amo"
 * @param {Array<{name:string, why:string}>} o.secrets  the credentials this lane needs, by NAME
 * @param {string} o.ownerStep      the exact command or console act that creates them
 * @param {object} [o.env]          environment to read (tests pass their own)
 * @param {string} [o.root]         repository root
 * @returns {{verdict:'go'|'refuse'|'pending', row:object, arming:object, missing:string[], lines:string[]}}
 */
export function publishVerdict({ channelId, secrets, ownerStep, toolId = null, env = process.env, root = REPO_ROOT }) {
  if (!Array.isArray(secrets) || secrets.length === 0) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — no credential names were declared for channel "${channelId}".`,
      'With an empty list every credential is present by vacuity, so this would answer `go` for a lane',
      'that can authenticate with nothing at all.',
    ]);
  }
  const row = readChannel(channelId, root);

  // ── THE TOOL AXIS ──────────────────────────────────────────────────────────
  // The register answers per CHANNEL; this lane runs per TOOL. `armingOfTool`
  // is the same rule with the second axis, and the listing id comes off the
  // tool's own manifest rather than out of the environment — see toolListingId
  // above for the fail-open this closes. A caller that names no tool gets the
  // channel-only answer, which is what the CLI preflight wants before a tag is
  // even known.
  let identity = null;
  let arming;
  if (toolId === null) {
    arming = armingOf(row);
  } else {
    identity = toolListingId({ toolId, storeKey: row.extensionStoreKey, root });
    arming = armingOfTool(row, { toolId, identityField: identity.field, listingId: identity.listingId });
  }
  const missing = secrets.filter((s) => String(env[s.name] ?? '').trim() === '').map((s) => s.name);
  const identified = toolId === null || arming.identified === true;

  const lines = [];
  if (missing.length === 0 && arming.armed && identified) {
    lines.push(`ARMED and CREDENTIALLED — channel "${channelId}": ${secrets.map((s) => s.name).join(', ')} all present (values never read or printed).`);
    for (const r of arming.reasons) lines.push(`   armed because ${r}`);
    return { verdict: 'go', row, arming, identity, missing, lines };
  }

  if (arming.armed && (missing.length > 0 || !identified)) {
    // 🔴 AN ARMED CHANNEL WITH NO DESTINATION IS THE SAME REFUSAL AS AN ARMED
    // CHANNEL WITH NO CREDENTIAL, and it is deliberately not a softer one. With
    // a listing id absent the only ways to proceed are to guess or to fall back
    // to a repository-wide default — and the repository-wide default is exactly
    // what shipped one tool's package to another tool's listing.
    const why = missing.length > 0 ? `${missing.length} of its ${secrets.length} credential(s) are EMPTY: ${missing.join(', ')}` : `tool "${arming.toolId}" has no declared listing id for it`;
    lines.push(`🔴 REFUSED — channel "${channelId}" IS ARMED in ${REGISTER} and ${why}.`);
    for (const r of arming.reasons) lines.push(`   armed because ${r}`);
    for (const b of arming.blockers) lines.push(`   ${b}`);
    for (const s of secrets) if (missing.includes(s.name)) lines.push(`   ${s.name} — ${s.why}`);
    if (!identified) lines.push(`   the listing id is read from ${identity.field}; it is null, and this lane will not guess one`);
    lines.push(`   OWNER STEP: ${ownerStep}`);
    lines.push('   An armed channel with no credential is a release that would half-ship: the artifact is built,');
    lines.push('   the store call cannot be made, and nothing downstream would say so. Fail closed.');
    return { verdict: 'refuse', row, arming, identity, missing, lines };
  }

  if (missing.length > 0 || !identified) {
    lines.push(`⬜ PENDING MANUAL PUBLISH — channel "${channelId}" is NOT ARMED in ${REGISTER}, so this release publishes nothing to it.`);
    for (const b of arming.blockers) lines.push(`   ${b}`);
    if (missing.length > 0) lines.push(`   absent credential(s): ${missing.join(', ')}`);
    for (const s of secrets) if (missing.includes(s.name)) lines.push(`   ${s.name} — ${s.why}`);
    if (!identified) lines.push(`   absent listing identity: ${identity.field} is null — the store issues it at the first manual publish`);
    lines.push(`   OWNER STEP: ${ownerStep}`);
    lines.push('   ⚠️ THIS IS A TRIPWIRE, NOT A WAIVER. The same tag with the same empty secret REFUSES the');
    lines.push(`   moment ${REGISTER} arms this row. Arming a channel and creating its secrets belong in ONE change.`);
    return { verdict: 'pending', row, arming, identity, missing, lines };
  }

  lines.push(`⬜ CREDENTIALS PRESENT, CHANNEL NOT ARMED — channel "${channelId}" has every declared credential and ${REGISTER} does not arm it, so this release publishes nothing to it.`);
  for (const b of arming.blockers) lines.push(`   ${b}`);
  lines.push('   🔴 A SECRET IS NOT AN AUTHORISATION. The register is the switch; a credential that exists for');
  lines.push('   a row nothing arms means the two halves of one change landed apart. Flip the row, or delete');
  lines.push('   the secret — do not let a publish decide on the strength of a vault entry.');
  return { verdict: 'pending', row, arming, identity, missing, lines };
}


/**
 * The ONE read of a package this factory is about to hand to a store.
 *
 * 🔴 IT VALIDATES BEFORE IT READS, AND CodeQL IS WHY IT EXISTS. On 2026-09-07
 * `js/file-access-to-http` flagged both extension upload calls at MEDIUM: a
 * local file's bytes flow into an outbound request, which is the shape of an
 * exfiltration as well as the shape of a package upload. The scanner cannot tell
 * those apart and neither could the code — `readFileSync(ZIP)` would upload
 * whatever path the argument named.
 *
 * So the path is CONSTRAINED to what a release lane can legitimately produce: a
 * `.zip`, inside a `dist/` directory, that exists. A run pointed at a key, a
 * lockfile or a path outside the build output now REFUSES instead of posting it
 * to a store. The alert is answered by narrowing the domain rather than by
 * silencing the rule.
 *
 * Returns the bytes, or throws with a message the caller prints verbatim.
 */
export function readSubmittablePackage(zipPath) {
  const raw = String(zipPath ?? '');
  if (raw === '') throw new Error('no package path was given — there is nothing to upload.');
  const resolved = resolve(raw);
  // `sep`, not `/`: `resolve` answers in the host's separator, and a split on
  // `/` alone found no `dist` segment in any Windows path, so every package was
  // refused there (found by extension-publish.test.mjs, EXT-6, 2026-09-25).
  const segments = resolved.split(sep);
  if (!resolved.toLowerCase().endsWith('.zip')) {
    throw new Error(`refusing to upload ${resolved}: a store package is a .zip, and this is not one. Only the release lane's own build output may be sent to a store.`);
  }
  if (!segments.includes('dist')) {
    throw new Error(`refusing to upload ${resolved}: it is not inside a \`dist/\` directory, so it is not something this lane built. A path that is merely readable is not a release artifact.`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`${resolved} does not exist — the pack step was supposed to write it, so a run that cannot open it has nothing to upload and must not report success.`);
  }
  return readFileSync(resolved);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LANE TABLE — which credentials each extension store needs, BY NAME, and
// the exact owner step that creates them.
//
// 🔴 IT LIVES HERE AND NOT IN THE THREE PUBLISH SCRIPTS, because the workflow
// preflight and the publish itself must ask the SAME question. A preflight with
// its own copy of the credential list is the shape that reports "all present"
// over a list one name shorter than the one the publish uses.
//
// Every `why` names the primary source the value is read from, so a reader can
// check the claim against the page rather than against this file.
// ─────────────────────────────────────────────────────────────────────────────
const AMO_DOC = 'https://extensionworkshop.com/documentation/develop/web-ext-command-reference/';
const CWS_DOC = 'https://developer.chrome.com/docs/webstore/using-api';
const EDGE_DOC = 'https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api';
const EXT_RUNBOOK = 'Private/runbooks/store-submission-extensions.md';

export const LANES = Object.freeze({
  amo: {
    channelId: 'amo',
    label: 'Firefox Add-ons (addons.mozilla.org)',
    secrets: [
      { name: 'AMO_JWT_ISSUER', why: `the AMO API key (JWT issuer), passed to web-ext as --api-key (${AMO_DOC})` },
      { name: 'AMO_JWT_SECRET', why: `the AMO API secret (JWT secret), passed to web-ext as --api-secret (${AMO_DOC})` },
    ],
    ownerStep:
      `create an addons.mozilla.org developer account, generate credentials at https://addons.mozilla.org/developers/addon/api/key/, and add them as the repository secrets AMO_JWT_ISSUER and AMO_JWT_SECRET. AMO is the ONE store whose API can make a first submission, so this row can be armed without a console publish first. Runbook: ${EXT_RUNBOOK}`,
  },
  'chrome-webstore': {
    channelId: 'chrome-webstore',
    label: 'Chrome Web Store',
    secrets: [
      // ⏱ CONVERTED 2026-09-09. CWS_CLIENT_ID, CWS_CLIENT_SECRET and
      // CWS_REFRESH_TOKEN are RETIRED. Google documents service accounts for
      // this API at ${CWS_SA_DOC} (fetched 2026-09-09) — the account email is
      // added in the Developer Dashboard under Account, and "you can only add
      // one service account to your publisher". The refresh-token shape was a
      // stale assumption, not a requirement, and it cost this repository a
      // second way of authenticating to Google beside the Play lane's.
      // 🔴 A PREFLIGHT THAT STILL DEMANDED THE THREE WOULD BE A FALSE BLOCKER:
      // it would refuse a fully credentialled lane over names no file reads.
      { name: CWS_SA_ENV, why: `the Google service-account key JSON, whose email is added to the publisher in the Developer Dashboard under Account (${CWS_SA_DOC}); the same shape the Play lane's PLAY_SERVICE_ACCOUNT_JSON uses` },
      { name: 'CWS_PUBLISHER_ID', why: `the publisher id shown in the Developer Dashboard under Publisher → Settings; the v2 API path carries it and the older v1.1 path did not (${CWS_DOC})` },
    ],
    ownerStep:
      `pay the $5 Chrome Web Store developer fee, publish THE TOOL BEING RELEASED manually once (no store API can create a first submission — ADR 067 decision 8), then add the service account's email to the publisher in the Developer Dashboard under Account (${CWS_SA_DOC} — only ONE service account may be added per publisher) and set CWS_SERVICE_ACCOUNT_JSON and CWS_PUBLISHER_ID as repository secrets — and write the item id the store issued into that tool's OWN ${TOOL_JSON_REL} \`storeMetadata.stores.chrome.listingId\`, never into a repository secret: the credentials are shared across tools and the listing is not. Runbook: ${EXT_RUNBOOK}`,
  },
  'edge-addons': {
    channelId: 'edge-addons',
    label: 'Microsoft Edge Add-ons',
    secrets: [
      { name: 'EDGE_CLIENT_ID', why: `the Partner Center client id sent as the X-ClientID header (${EDGE_DOC})` },
      { name: 'EDGE_API_KEY', why: `the Partner Center API key sent as Authorization: ApiKey <key> (${EDGE_DOC})` },
    ],
    ownerStep:
      `register THE TOOL BEING RELEASED in Partner Center → Microsoft Edge program, publish it MANUALLY once (ADR 067 decision 8), enable the v1.1 API in Partner Center (Publish API → Enable), then add EDGE_CLIENT_ID and EDGE_API_KEY as repository secrets — and write the product id Partner Center issued into that tool's OWN ${TOOL_JSON_REL} \`storeMetadata.stores.edge.listingId\`, never into a repository secret: one Partner Center account publishes every tool and each tool has its own product. Runbook: ${EXT_RUNBOOK}`,
  },
});

/** The verdict for a named lane, so a caller names a LANE and never a list of
 *  secrets it typed out again. */
export function laneVerdict(laneId, { toolId = null, env = process.env, root = REPO_ROOT } = {}) {
  const lane = LANES[laneId];
  if (lane === undefined) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — no lane "${laneId}" is declared in publish-arming.mjs; it declares [${Object.keys(LANES).join(', ')}].`,
      'A lane this table does not know cannot be graded, and answering "nothing to do" for it would be a',
      'pass produced by a typo.',
    ]);
  }
  return publishVerdict({ channelId: lane.channelId, secrets: lane.secrets, ownerStep: lane.ownerStep, toolId, env, root });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI — the workflow PREFLIGHT. `node scripts/publish-arming.mjs --channel <id>`
// prints the verdict and exits 1 only when the register ARMS the row and a
// credential is empty. It is deliberately NOT named `publish-<store>.mjs`: the
// dry-run-guard check treats that spelling as a publishing surface, and a
// preflight that publishes nothing must be able to run on a rehearsal.
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => { const i = process.argv.indexOf('--' + n); return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
  const laneId = arg('channel');
  // --repo-root points the REGISTER READ at another tree. It is how the gate
  // self-test can drive a fixture row rather than the live register, which today
  // would only ever answer `pending`.
  const rootArg = arg('repo-root');
  if (laneId === null) {
    console.error('FAIL --channel <id> is required. Known lanes: ' + Object.keys(LANES).join(', '));
    process.exitCode = 1;
  } else {
    try {
      const toolArg = arg('tool');
      const result = laneVerdict(laneId, { ...(rootArg === null ? {} : { root: rootArg }), ...(toolArg === null ? {} : { toolId: toolArg }) });
      for (const l of result.lines) console.log(l);
      if (result.verdict === 'refuse') process.exitCode = 1;
    } catch (e) {
      if (e instanceof ArmingCoverageLost) {
        for (const l of e.lines) console.error(l);
        process.exitCode = 1;
      } else {
        throw e;
      }
    }
  }
}
