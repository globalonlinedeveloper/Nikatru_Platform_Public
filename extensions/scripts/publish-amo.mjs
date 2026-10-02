#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-amo.mjs — the Firefox (addons.mozilla.org) submission lane.
//
// 🔴 AMO IS THE ONE STORE WHOSE API CAN MAKE A FIRST SUBMISSION. [ADR 067]
// decision 8 puts one manual first publish in front of every store BECAUSE no
// store API allows one — except this one. `web-ext sign --channel listed`
// "creates a listing for your extension on AMO if --channel is set to listed and
// the extension isn't listed" (PRIMARY_SOURCES.webExtSign, fetched 2026-09-07).
// So the register row for `amo` is the only extension row that could honestly be
// armed before a human has touched a console — and it is still the register that
// decides, never this file.
//
// ── THE TOOL COMES FROM A LOCKED ISLAND, NEVER FROM THE REGISTRY AT RUN TIME ──
// ⏱ 2026-09-24 (EXT-3, O-WEB-EXT-FETCHED-AT-RUN-TIME): this lane used to run
// `npx --yes` for the pinned web-ext `sign`, which fetched the signer — and its whole
// dependency tree, loose — from the npm registry at the moment it held the AMO
// credentials. The exact version pinned the top package and nothing under it. The
// signer is now the binary `npm ci --ignore-scripts --prefix tooling/web-ext`
// installs from tooling/web-ext/package-lock.json, the same island the Firefox
// lint runs, and this script REFUSES when the binary is absent rather than
// fetching one. The version lives in tooling/web-ext/package.json (exact) and
// Renovate's npm manager proposes each move against the lockfile.
//
// ⚠️ VERSION 8 CHANGED WHAT `sign` DOES AND VERSION 10 IS WHAT WE PIN. The
// command reference for v10 records that `--use-submission-api` was REMOVED (it
// was the v7 preview of listing-creation) and that `--channel` is now REQUIRED.
// Both facts are why the flags below are spelled out rather than defaulted.
//
// ── THE FIRST SUBMIT CARRIES THE LISTING, AND THE DEFAULT SENDS NOTHING ─────
// ⏱ 2026-09-24 (EXT-3, O-AMO-FIRST-SUBMIT-SENDS-NO-METADATA): `sign` ran with no
// `--amo-metadata`, so the listing AMO creates on a first submit had no summary,
// no categories and no licence. The payload is now built by amo-metadata.mjs from
// files the repository grades, written beside the artifacts, and handed to
// web-ext as `--amo-metadata` (signArgv below). Run WITHOUT `--submit` this script
// is a dry run: it prints that payload and the exact argv and sends nothing — the
// owner reads the payload before typing the word. Only `--submit` spawns web-ext,
// and only after the `store-publish` environment is read back
// (lib/store-environment.mjs). After a successful sign the listing URL is READ
// BACK from AMO and printed as `LISTING_URL=<url>` for the [10]D-9 record; CI
// never writes it into tool.json.
//
// Usage:
//   node scripts/publish-amo.mjs --tool <id> [--source-dir <dir>] [--artifacts-dir <dir>]            dry run
//   node scripts/publish-amo.mjs --tool <id> --source-dir <dir> [--artifacts-dir <dir>] --submit     sign + submit
//
// Exit 0 = the dry run printed its payload; or published; or the register does
// not arm this channel and the owner step was printed. 1 = refused or failed.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { laneVerdict, ArmingCoverageLost, REPO_ROOT } from './publish-arming.mjs';
import { buildAmoMetadata, buildAmoListingAssets, PRIMARY_SOURCES as METADATA_SOURCES } from './amo-metadata.mjs';
import { requireStorePublishEnvironment } from './lib/store-environment.mjs';
import { storeSubmitter } from '../../tooling/release/submit-common.mjs';
import * as vocabulary from '../../contracts/store/vocabulary.js';

/** The pages this lane's flags and calls were read from. ⏱ 2026-09-29 (rv2
 *  EXL-12): three of these were cited in main() and defined nowhere, so the first
 *  real --submit would have thrown a ReferenceError after the environment gate and
 *  before the sign. Exported so the test holds every citation to a definition. */
export const PRIMARY_SOURCES = Object.freeze({
  ...METADATA_SOURCES,
  webExtSign: 'https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign',
  webExtVersion: 'https://www.npmjs.com/package/web-ext',
});

/** addons.mozilla.org behind the one store contract (tooling/release/submit-common.mjs,
 *  tooling/ports/channels.json). `plan` is what main() does on `--submit`, in order;
 *  `upload` IS this script with `--submit`, arming and gate and all.
 *  🔴 TRAPS stores-01: `gecko.id` is PERMANENT once AMO signs it, and changing it
 *  publishes a DIFFERENT add-on. It is a value to CONFIRM, never to set: `validate`
 *  refuses a record whose manifest id is not the confirmed one (publish/identity.json,
 *  as publish-arming.mjs toolListingId() holds it), or that carries no confirmed id. */
export const amoSubmitter = storeSubmitter({
  channel: 'amo',
  vocabulary,
  script: 'extensions/scripts/publish-amo.mjs',
  steps: (artifact) => [
    { does: 'ask the register whether this channel is armed (publish-arming laneVerdict)', surface: 'local', call: 'tooling/channel-register.json', writes: false },
    { does: 'read the "store-publish" environment back and require its reviewer', surface: 'api', call: 'GET https://api.github.com/repos/{owner}/{repo}/environments/store-publish', writes: false },
    { does: 'build the listing payload the first submit carries (amo-metadata.mjs)', surface: 'local', call: 'amo-metadata.json', writes: false },
    { does: `sign ${artifact?.path ?? 'the unpacked firefox tree'} on the listed channel — the gecko.id it carries is CONFIRMED, never set`, surface: 'cli', call: 'web-ext sign --channel listed --amo-metadata <amo-metadata.json>', writes: true },
    { does: 'read the listing URL back', surface: 'api', call: `GET ${AMO_API}/addons/addon/{guid}/`, writes: false },
    { does: 'upload the previews while the listing has none', surface: 'api', call: `POST ${AMO_API}/addons/addon/{guid}/previews/`, writes: true },
    { does: 'set the privacy policy', surface: 'api', call: `PATCH ${AMO_API}/addons/addon/{guid}/`, writes: true },
  ],
  extraFindings: (record) => {
    const id = record?.geckoId ?? {};
    if (typeof id.confirmed !== 'string' || id.confirmed.trim() === '') {
      return [{ field: 'geckoId.confirmed', message: 'no confirmed gecko.id: it is a value to CONFIRM against publish/identity.json, never to set (stores-01)' }];
    }
    if (id.manifest !== id.confirmed) {
      return [{ field: 'geckoId.manifest', message: `the manifest's gecko.id ${JSON.stringify(id.manifest)} is not the confirmed ${JSON.stringify(id.confirmed)}; AMO fixes the id at first signing, so a changed one publishes a DIFFERENT add-on (stores-01)` }];
    }
    return [];
  },
  uploadArgv: (artifact) => ['--tool', artifact.tool, '--source-dir', artifact.path, '--submit'],
});

/** The island that holds the signer, repo-relative. */
const WEB_EXT_ISLAND = 'tooling/web-ext';

/** AMO's API root; the add-on detail is read back from it after the sign. */
const AMO_API = 'https://addons.mozilla.org/api/v5';

/**
 * The island's declared web-ext version, read from its package.json. EXACT: a
 * range there would let the lockfile and the declaration disagree about which
 * signer a rehearsal ran. A missing or non-exact declaration is a REFUSAL.
 */
function islandVersion(root) {
  const rel = `${WEB_EXT_ISLAND}/package.json`;
  let v;
  try {
    v = JSON.parse(readFileSync(join(root, rel), 'utf8')).devDependencies?.['web-ext'];
  } catch (e) {
    return { ok: false, why: `${rel} could not be read — ${e.message}` };
  }
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) {
    return { ok: false, why: `${rel} declares web-ext ${JSON.stringify(v)}; an exact three-part version is required.` };
  }
  return { ok: true, version: v };
}

/** The installed signer binary. Never `npx`: absent means refuse, not fetch. */
const webExtBin = (root) => join(root, WEB_EXT_ISLAND, 'node_modules', '.bin', process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext');

/**
 * THE ONE ARGV `web-ext sign` RUNS WITH. Exported so the test holds it: a sign
 * without `--amo-metadata` is the defect this unit closes.
 * `--approval-timeout 0`: "Set to 0 to disable waiting for approval"
 * (lib/program.js in the island) — a listed first submit waits for a human
 * review that can take days, and the job must not sit on it.
 */
export function signArgv({ sourceDir, artifactsDir, metadataPath }) {
  return [
    'sign',
    '--channel', 'listed',
    '--source-dir', sourceDir,
    '--artifacts-dir', artifactsDir,
    '--amo-metadata', metadataPath,
    '--approval-timeout', '0',
  ];
}

/** An AMO API JWT: HS256 over {iss, jti, iat, exp}, per AMO's authentication docs.
 *  Exported for store-key-keepalive.mjs, whose scheduled probe signs the same way. */
export function amoJwt(issuer, secret, now = Math.floor(Date.now() / 1000)) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/**
 * The listing URL, READ BACK from AMO after the sign rather than typed at
 * dispatch. Only an https://addons.mozilla.org/ URL is accepted.
 */
export async function readListingUrl({ guid, issuer, secret, fetchImpl = fetch }) {
  const url = `${AMO_API}/addons/addon/${encodeURIComponent(guid)}/`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { authorization: `JWT ${amoJwt(issuer, secret)}`, accept: 'application/json' } });
  } catch (e) {
    return { ok: false, why: `could not reach ${url} (${e.message})` };
  }
  if (!res.ok) return { ok: false, why: `HTTP ${res.status} from ${url}` };
  const body = await res.json().catch(() => ({}));
  if (typeof body.url !== 'string' || !body.url.startsWith('https://addons.mozilla.org/')) {
    return { ok: false, why: `${url} answered with url ${JSON.stringify(body.url)}, not an https://addons.mozilla.org/ listing` };
  }
  return { ok: true, url: body.url };
}

/**
 * THE LISTING'S SCREENSHOTS AND PRIVACY POLICY, sent after the sign (rv2 EXL-12).
 * The add-on create takes neither, so without this the API-created listing goes
 * public with no screenshots and no policy (Chrome and Edge get theirs from the
 * human at the manual first publish; AMO has no such human). Previews are uploaded
 * only while the listing has NONE — a re-run after a partial failure, or a later
 * version, must not stack duplicates — and the policy PATCH is idempotent.
 * Exported, with fetch injectable, so the test holds both calls.
 */
export async function completeListing({ guid, issuer, secret, previews, privacyPolicy, fetchImpl = fetch, readFile = readFileSync }) {
  const base = `${AMO_API}/addons/addon/${encodeURIComponent(guid)}/`;
  const auth = () => ({ authorization: `JWT ${amoJwt(issuer, secret)}` });
  const lines = [];
  const call = async (url, init) => {
    try {
      const res = await fetchImpl(url, init);
      return res.ok ? { ok: true, res } : { ok: false, why: `HTTP ${res.status} from ${init.method || 'GET'} ${url}` };
    } catch (e) {
      return { ok: false, why: `could not reach ${url} (${e.message})` };
    }
  };
  const detail = await call(base, { headers: { ...auth(), accept: 'application/json' } });
  if (!detail.ok) return { ok: false, why: detail.why, lines };
  const have = (await detail.res.json().catch(() => ({}))).previews;
  let uploaded = 0;
  if (Array.isArray(have) && have.length > 0) {
    lines.push(`     previews: the listing already has ${have.length}; none uploaded (never stacked).`);
  } else {
    for (let i = 0; i < previews.length; i++) {
      const file = previews[i];
      const form = new FormData();
      form.set('image', new Blob([readFile(file)], { type: 'image/png' }), basename(file));
      form.set('position', String(i));
      const r = await call(`${base}previews/`, { method: 'POST', headers: auth(), body: form });
      if (!r.ok) return { ok: false, why: `preview ${basename(file)}: ${r.why}`, lines, uploaded };
      uploaded++;
    }
    lines.push(`     previews: ${uploaded} uploaded (${previews.map((f) => basename(f)).join(', ')}).`);
  }
  const pol = await call(`${base}eula_policy/`, {
    method: 'PATCH',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ privacy_policy: privacyPolicy }),
  });
  if (!pol.ok) return { ok: false, why: `privacy policy: ${pol.why}`, lines, uploaded };
  lines.push(`     privacy policy: set (${Object.values(privacyPolicy)[0].length} characters).`);
  return { ok: true, lines, uploaded };
}

async function main(argv) {
  const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const TOOL = opt('tool');
  /* DEFAULT MOVED 2026-09-12 (O-EXT-DIST-NOT-FLAT): the unpacked tree is no longer
     left in the RELEASE directory, which release-manifest.mjs requires to be flat.
     The workflow passes --source-dir explicitly; this default follows it so a hand
     run reads the same tree the lane does. */
  const SOURCE_DIR = opt('source-dir', 'build/unpacked-firefox');
  const ARTIFACTS_DIR = opt('artifacts-dir', 'dist/amo');
  const SUBMIT = argv.includes('--submit');
  const root = opt('repo-root') ?? REPO_ROOT;

  const die = (lines) => {
    console.error('');
    for (const l of lines) console.error(l);
    console.error('\npublish-amo: FAILED');
    process.exitCode = 1;
  };

  if (TOOL === null || TOOL.trim() === '') {
    die(['FAIL --tool <id> is required. Without it this lane cannot say WHICH extension it would sign,',
      '     and a submission under the wrong add-on id is not recoverable.']);
    return;
  }

  // A refusal of the payload (a placeholder licence, an empty reviewer note) stops
  // a dry run as loudly as a submit. On --submit the register is asked FIRST: an
  // unarmed or uncredentialled channel answers before anything is read for AMO.
  const metadataPath = resolve(ARTIFACTS_DIR, 'amo-metadata.json');
  const args = signArgv({ sourceDir: SOURCE_DIR, artifactsDir: ARTIFACTS_DIR, metadataPath });
  const payload = () => {
    const meta = buildAmoMetadata({ toolId: TOOL, root: join(root, 'extensions') });
    if (!meta.ok) die([...meta.why.map((l) => `FAIL ${l}`), '     amo-metadata.mjs refused the listing payload, so nothing may be sent to addons.mozilla.org.']);
    return meta.ok ? meta.payload : null;
  };
  const assets = () => {
    const a = buildAmoListingAssets({ toolId: TOOL, root: join(root, 'extensions') });
    if (!a.ok) die([...a.why.map((l) => `FAIL ${l}`), '     amo-metadata.mjs refused the listing assets, so the listing would go public without them.']);
    return a.ok ? a : null;
  };

  if (!SUBMIT) {
    const dry = payload();
    if (dry === null) return;
    console.log('publish-amo: the listing payload the first submit would carry (--amo-metadata):');
    console.log(JSON.stringify(dry, null, 2));
    const dryAssets = assets();
    if (dryAssets === null) return;
    console.log(`publish-amo: after the sign, POST ${dryAssets.previews.length} preview(s) while the listing has none: ${dryAssets.previews.map((f) => basename(f)).join(', ')}`);
    console.log(`publish-amo: after the sign, PATCH eula_policy privacy_policy (${Object.values(dryAssets.privacyPolicy)[0].length} characters, closing with ${dryAssets.policyUrl})`);
    console.log(`→    web-ext ${args.join(' ')}`);
    console.log('publish-amo: DRY RUN — nothing was sent to addons.mozilla.org. Pass --submit to sign and submit.');
    return;
  }

  let result = null;
  try {
    // The tool is passed for the SAME reason the other two lanes pass it, and the
    // answer is different in kind rather than absent: AMO reads the add-on id from
    // the package manifest in --source-dir, so this lane addresses no id of its own.
    // Declaring it on the tool anyway keeps all three destinations readable in one
    // place and keeps the verdict shape identical across the three stores.
    result = laneVerdict('amo', { toolId: TOOL, ...(opt('repo-root') === null ? {} : { root: opt('repo-root') }) });
  } catch (e) {
    if (e instanceof ArmingCoverageLost) {
      die(e.lines);
      return;
    }
    throw e;
  }
  for (const l of result.lines) console.log(l);
  if (result.verdict === 'refuse') {
    process.exitCode = 1;
    return;
  }
  if (result.verdict !== 'go') return;

  const listingPayload = payload();
  if (listingPayload === null) return;
  const listingAssets = assets();
  if (listingAssets === null) return;
  if (!existsSync(SOURCE_DIR)) {
    die([
      `FAIL --source-dir ${SOURCE_DIR} does not exist.`,
      '     The pack step writes the unpacked Firefox tree that web-ext signs. With it absent this',
      '     would sign whatever the working directory happens to be, which is how the wrong bytes',
      '     reach a store.',
    ]);
    return;
  }
  let guid = null;
  try {
    guid = JSON.parse(readFileSync(join(SOURCE_DIR, 'manifest.json'), 'utf8'))?.browser_specific_settings?.gecko?.id ?? null;
  } catch (e) {
    die([`FAIL ${SOURCE_DIR}/manifest.json could not be read — ${e.message}`]);
    return;
  }
  if (typeof guid !== 'string' || guid === '') {
    die([`FAIL ${SOURCE_DIR}/manifest.json declares no browser_specific_settings.gecko.id, so the listing cannot be read back after the sign.`]);
    return;
  }
  const declared = islandVersion(root);
  const bin = webExtBin(root);
  if (!declared.ok) {
    die([`FAIL ${declared.why}`, '     The signer version is declared once, in the island; this lane will not guess one.']);
    return;
  }
  if (!existsSync(bin)) {
    die([
      `FAIL ${bin} does not exist.`,
      `     Install the locked signer first: npm ci --ignore-scripts --prefix ${WEB_EXT_ISLAND}`,
      '     This lane never fetches a signer from the registry at run time, so an absent binary is a refusal.',
    ]);
    return;
  }

  // [ADR 031] class A — immediately before the first store call.
  const gate = await requireStorePublishEnvironment();
  for (const l of gate.lines) (gate.ok ? console.log : console.error)(l);
  if (!gate.ok) {
    die(['     NOT SUBMITTED: the store-publish environment was not shown to gate this run.']);
    return;
  }

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(listingPayload, null, 2)}\n`);
  console.log(`→    web-ext ${declared.version} (${WEB_EXT_ISLAND}) ${args.join(' ')}  (tool "${TOOL}")`);
  console.log(`     flags read from ${PRIMARY_SOURCES.webExtSign}; the version is exact against ${PRIMARY_SOURCES.webExtVersion}`);
  const r = spawnSync(bin, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      WEB_EXT_API_KEY: process.env.AMO_JWT_ISSUER,
      WEB_EXT_API_SECRET: process.env.AMO_JWT_SECRET,
    },
  });
  if (r.status !== 0) {
    die([
      `FAIL web-ext ${declared.version} sign exited ${r.status === null ? `on signal ${r.signal}` : r.status}.`,
      '     AMO is the one channel whose API creates the listing, so a failure here is a submission',
      '     that did not happen — not a listing left half-made. Read the tool output above.',
    ]);
    return;
  }
  const listing = await readListingUrl({ guid, issuer: process.env.AMO_JWT_ISSUER, secret: process.env.AMO_JWT_SECRET });
  if (!listing.ok) {
    die([
      `FAIL web-ext signed and SUBMITTED ${TOOL}, and the listing URL could not be read back: ${listing.why}.`,
      `     The submission HAPPENED. Record it by hand against the add-on ${guid} (source: ${PRIMARY_SOURCES.addonsApi}).`,
    ]);
    return;
  }
  console.log(`LISTING_URL=${listing.url}`);
  const done = await completeListing({ guid, issuer: process.env.AMO_JWT_ISSUER, secret: process.env.AMO_JWT_SECRET,
    previews: listingAssets.previews, privacyPolicy: listingAssets.privacyPolicy });
  for (const l of done.lines) console.log(l);
  if (!done.ok) {
    die([
      `FAIL ${TOOL} was signed and SUBMITTED, and its listing is INCOMPLETE: ${done.why}.`,
      '     Re-running this lane is safe (previews are uploaded only while the listing has none), or add',
      `     them in the AMO Developer Hub. The listing must not go public without them (source: ${PRIMARY_SOURCES.addonsApi}).`,
    ]);
    return;
  }
  console.log(`publish-amo: SUBMITTED — ${TOOL} signed and submitted for listing on addons.mozilla.org.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
