#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-bijection.mjs — the platform manifest's STORES and this
// repository's store CHANNELS are the same set, through a declared many-to-one
// mapping.
//
// Pipeline requirement: Private/requirements/ → [10]D-4 / [10]D-5, the store
// half. [ADR 067] decision 8 ("store paths made live").
//
// ── THE DEFECT THIS EXISTS FOR, MEASURED ─────────────────────────────────────
// 🔴 `Private/platform-state/manifest.json` listed a seventh store, `apps-gov-in`,
// with `publishPath: "manual upload, documented"` — while
// `grep -c apps-gov-in tooling/channel-register.json` returned 0, `ls
// Private/runbooks/store-submission-apps-gov-in.md` exited 2, and `grep -rl
// 'apps.gov.in' Private/runbooks/` exited 1. The state file was WRONG rather than
// merely incomplete, and it stayed wrong because NOTHING held the two sides
// together in either direction:
// `research/revamp-2026-09-05/revamp-full-coverage-audit-2026-09-07.md` §1
// decision 8c and §4 N1 record the measurement and the absence of a guard in the
// same sentence — "No guard checks this in either direction, which is exactly why
// the mismatch survived in prose for two days."
//
// A store that exists on one side and not the other is not a documentation
// nit. It is either a distribution path nobody has built (manifest ahead of the
// register) or a channel nobody's knowledge set knows about (register ahead of
// the manifest), and the second is how an agent ships to a store the owner does
// not know is armed.
//
// ── WHY THE MANIFEST SIDE IS DATA IN THIS FILE ───────────────────────────────
// 🔴 CI CANNOT SEE `Private/`. It is gitignored (.gitignore:22-23) and absent
// from the public checkout, exactly as assert-channel-register.mjs's header
// records for the OWNER_QUEUE and ADR citations it cannot resolve. A guard whose
// only left-hand side lived in that tree would be COVERAGE LOST on every CI run
// — which is silence dressed as rigour.
//
// So the manifest's store SET is declared here, as data, with the mapping each
// entry needs; and the drift between this declaration and the real
// `platform-state/manifest.json` is its own limb, which RUNS wherever the corpus
// is reachable and SAYS SO LOUDLY wherever it is not:
//
//     node tooling/ci/assert-store-bijection.mjs \
//       --manifest ../Nikatru_Platform_Private/platform-state/manifest.json
//
// Named-and-unreadable is COVERAGE LOST; not named at all is a printed limit.
// The distinction is the whole point: "I did not look" and "I looked and found
// nothing" must never share an exit code (C-COVERAGE-LOST-IS-NOT-PASS).
//
// ── THE MAPPING IS MANY-TO-ONE, AND THAT IS A FACT ABOUT ACCOUNTS ────────────
// The two sides have different cardinalities and always will. `manifest.json`
// counts PUBLISHER ACCOUNTS — one Apple Developer account, one Partner Center
// account — and `channel-register.json` counts RELEASE CHANNELS, because a
// review outcome, a listing tree and an artifact format are per channel. One
// Apple account carries two App Store Connect records (iOS and macOS); one
// Microsoft account carries the Microsoft Store and Edge Add-ons. Netting those
// out is what makes 7 stores and 9 store channels the SAME SET rather than a
// discrepancy — and writing the netting down as data is what stops the next
// reader from "fixing" the count.
//
// Usage:  node tooling/ci/assert-store-bijection.mjs [repoRoot] [--manifest <path>]
// Exit 0 = the two sides agree. 1 = they do not. 2 = COVERAGE LOST — a side was
// empty or unreadable, which is deliberately NOT a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTER = 'tooling/channel-register.json';
const MANIFEST_REL = 'platform-state/manifest.json';

/** THE DECLARED STORE SET, AND THE CHANNELS EACH STORE PUBLISHES THROUGH.
 *
 *  🔴 THIS IS A MIRROR OF `Private/platform-state/manifest.json` `stores[]`, AND
 *  A MIRROR WITH NOTHING COMPARING IT IS JUST A SECOND DECISION — the same rule
 *  assert-purchase-path.mjs §G4(e) states about `PurchaseRailKind`. The
 *  `--manifest` limb below is what compares it; without that limb this table
 *  would be a private opinion about somebody else's file.
 *
 *  `why` is required on every entry whose `channels` is not a single row of the
 *  same name: a many-to-one netting nobody explained is indistinguishable from a
 *  missing channel, and it is the netting that makes the counts differ. */
export const DECLARED_STORES = [
  {
    store: 'google-play',
    channels: ['android-play'],
    why:
      'The manifest names the STORE ("google-play") and the register names the CHANNEL by its platform ' +
      'and store ("android-play"). One account, one channel — the ids differ and neither is renamed to ' +
      'suit this table: a register id is load-bearing in PurchaseChannel, in every listing path and in ' +
      'every deployment-environment template.',
  },
  {
    store: 'apple',
    channels: ['ios-appstore', 'macos-appstore'],
    why:
      'ONE Apple Developer account, TWO App Store Connect records — one per platform, each with its ' +
      'own metadata tree, its own review outcome and its own artifact format (.ipa and .pkg). ' +
      'manifest.json says so in the row itself: `channel: "ios + macos"`.',
  },
  {
    store: 'microsoft',
    channels: ['windows-store', 'edge-addons'],
    why:
      'ONE Partner Center account (Company, LIVE; its seller id is in nikatru/vendors/microsoft.md § APPENDED 2026-08-28, never in this tree) covers both the Microsoft Store ' +
      'and Edge Add-ons. manifest.json says so in the row itself: `channel: "windows + edge ' +
      'add-ons"`. The two register rows are different surfaces — an app and a browser extension — ' +
      'which is exactly why they cannot be one channel row.',
  },
  {
    store: 'chrome-web-store',
    channels: ['chrome-webstore'],
    why:
      'ONE store, TWO SPELLINGS, and the mismatch is the reason this entry carries a `why` at all: ' +
      'the manifest id is hyphenated (`chrome-web-store`) and the register id is not ' +
      '(`chrome-webstore`). Neither is renamed to please this guard — a register id is load-bearing ' +
      'in `PurchaseChannel`, in tool.json store keys and in every listing path — so the mapping ' +
      'carries the difference instead.',
  },
  {
    store: 'mozilla-amo',
    channels: ['amo'],
    why:
      'Same shape as the Chrome row: the manifest names the vendor (`mozilla-amo`) and the register ' +
      'names the storefront (`amo`), and the register row records why the id is not `firefox` — the ' +
      'store and the browser are different things.',
  },
  {
    store: 'snap-store',
    channels: ['linux-snap'],
    why: 'The manifest names the store, the register names the channel by its platform and store.',
  },
  {
    store: 'apps-gov-in',
    channels: ['apps-gov-in'],
    why: null,
  },
];

// ── argv ─────────────────────────────────────────────────────────────────────
// 🔴 A NO-VALUE FLAG IN A HAND-ROLLED LOOP EATS THE NEXT ARGUMENT, and a value
// that is itself a flag is a path nobody meant. `--manifest` at the end of argv
// binds `undefined`, which would otherwise read as "not asked for" — the exact
// silent-skip this guard's whole point is to refuse. So it is refused loudly.
const argv = process.argv.slice(2);
const flagAt = argv.indexOf('--manifest');
let manifestArg = null;
let manifestArgBroken = null;
if (flagAt >= 0) {
  const v = argv[flagAt + 1];
  if (v === undefined || v.startsWith('--')) manifestArgBroken = v === undefined ? '(nothing)' : v;
  else manifestArg = v;
}
// 🔴 `flagAt` IS -1 WHEN THE FLAG IS ABSENT, AND -1 + 1 IS 0 — WHICH IS THE ROOT.
// Written without this guard the filter drops argv[0], the positional repo root,
// on every invocation that passes no --manifest: the guard then re-scanned the
// REAL repository from a fixture root and every mutation in
// tooling/ci/test/store-bijection.test.mjs came back 0 while the control came
// back 0 too. Caught by that test on its first run, which is what it is for.
const positional = argv.filter((a, i) => !a.startsWith('--') && (flagAt < 0 || i !== flagAt + 1));
const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

/** COVERAGE LOST is fatal on the spot and exits 2, never 1 and never 0: every
 *  comparison below quantifies over the thing that is missing, so continuing
 *  would report "the two sides agree" over nothing. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-store-bijection: COVERAGE LOST');
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PURE COMPARISONS — exported so both directions are exercised without a
// filesystem, the split assert-xcode-floor.mjs uses for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

/** The declared table, flattened to `channel id -> store id`, plus every way the
 *  table itself can be wrong. A channel claimed by two stores is refused here
 *  rather than silently resolving to whichever entry came last. */
export function flatten(declared) {
  const owner = new Map();
  const duplicated = [];
  const malformed = [];
  for (const e of declared ?? []) {
    if (!e || typeof e.store !== 'string' || e.store.trim() === '') {
      malformed.push(`an entry with no \`store\` id: ${JSON.stringify(e)}`);
      continue;
    }
    if (!Array.isArray(e.channels) || e.channels.length === 0) {
      malformed.push(`store "${e.store}" names no channels. A store that maps to nothing is a store this guard cannot hold to anything.`);
      continue;
    }
    const manyToOne = e.channels.length > 1 || e.channels[0] !== e.store;
    if (manyToOne && (typeof e.why !== 'string' || e.why.trim().length < 20)) {
      malformed.push(
        `store "${e.store}" maps to [${e.channels.join(', ')}] and says nothing about WHY. A netting nobody ` +
          'explained is indistinguishable from a missing channel, and it is the netting that makes the two counts differ.',
      );
    }
    for (const c of e.channels) {
      if (typeof c !== 'string' || c.trim() === '') {
        malformed.push(`store "${e.store}" names a channel that is not a non-empty string: ${JSON.stringify(c)}`);
        continue;
      }
      if (owner.has(c)) duplicated.push(`${c} (claimed by "${owner.get(c)}" and "${e.store}")`);
      else owner.set(c, e.store);
    }
  }
  return { owner, duplicated, malformed };
}

/** The bijection itself, in BOTH directions. `registerStoreChannels` is the id
 *  set of every `kind: "store"` row in the register. */
export function compare(declared, registerStoreChannels) {
  const { owner, duplicated, malformed } = flatten(declared);
  const inRegister = new Set(registerStoreChannels);
  const declaredOnly = [...owner.keys()].filter((c) => !inRegister.has(c));
  const registerOnly = [...inRegister].filter((c) => !owner.has(c));
  return { owner, duplicated, malformed, declaredOnly, registerOnly };
}

/** The declared store id set against the real manifest's. Order-insensitive. */
export function compareManifest(declared, manifestStoreIds) {
  const mine = new Set((declared ?? []).map((e) => e?.store).filter((s) => typeof s === 'string'));
  const theirs = new Set(manifestStoreIds);
  return {
    onlyInGuard: [...mine].filter((s) => !theirs.has(s)),
    onlyInManifest: [...theirs].filter((s) => !mine.has(s)),
    compared: theirs.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RUN
// ─────────────────────────────────────────────────────────────────────────────
if (manifestArgBroken !== null) {
  coverageLost([
    `--manifest was given ${manifestArgBroken} as its value.`,
    'A flag that binds nothing reads afterwards exactly like a flag nobody passed, so the drift limb',
    'would report a printed limit while the caller believed it had asked for the comparison.',
  ]);
}

const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist under ${ROOT}.`,
    'The right-hand side of the bijection is the register\'s store rows; with no register there is no',
    'set to compare the platform manifest against, and every limb below would agree with everything.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}

const channels = Array.isArray(register.channels) ? register.channels : [];
const registerStoreChannels = channels
  .filter((c) => c && c.kind === 'store' && typeof c.id === 'string')
  .map((c) => c.id);

if (registerStoreChannels.length === 0) {
  coverageLost([
    `${REGISTER} declares ZERO \`kind: "store"\` channels.`,
    'An empty right-hand side makes every declared store "missing" or nothing at all, depending on',
    'which direction is read first — and a bijection over an empty set is satisfied by any left-hand',
    'side including one somebody emptied.',
  ]);
}
if (DECLARED_STORES.length === 0) {
  coverageLost([
    'the declared store table in this guard is EMPTY.',
    'It is the mirror of platform-state/manifest.json `stores[]`; empty, this guard would certify that',
    'no store is missing a channel by knowing about no stores at all.',
  ]);
}

const { owner, duplicated, malformed, declaredOnly, registerOnly } = compare(DECLARED_STORES, registerStoreChannels);

for (const m of malformed) problems.push(`the declared store table is malformed — ${m}`);
for (const d of duplicated) {
  problems.push(
    `channel "${d}" is claimed by TWO stores. One channel publishes through one publisher account; two ` +
      'claims means the account a submission runs under depends on which entry a reader consults.',
  );
}
for (const c of declaredOnly) {
  problems.push(
    `store "${owner.get(c)}" maps to channel "${c}", which no \`kind: "store"\` row in ${REGISTER} declares. ` +
      'The platform manifest claims a distribution path this repository cannot release to — the exact shape ' +
      '`apps-gov-in` had on 2026-09-07, where manifest.json also claimed the path was "documented" and no ' +
      'runbook existed.',
  );
}
for (const c of registerOnly) {
  problems.push(
    `${REGISTER} declares store channel "${c}" and the platform manifest's store set does not reach it. ` +
      'A channel the knowledge set has never heard of is a store an agent could arm without the owner ever ' +
      'reading that it exists.',
  );
}

// ── the drift limb: this table versus the real manifest ──────────────────────
// The one limb that can tell a correct mirror from a stale one. It runs wherever
// the corpus is reachable and states its absence where it is not — never a
// silent skip, because silence here would let the table above rot into a second
// decision about a file nobody re-read.
const manifestPath = manifestArg !== null ? resolve(manifestArg) : join(ROOT, 'Private', MANIFEST_REL);
if (existsSync(manifestPath)) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    coverageLost([
      `${manifestPath} was named and does not parse — ${e.message}`,
      'Being asked to compare against a file and failing to read it is not the same as not being asked.',
    ]);
  }
  const stores = Array.isArray(manifest.stores) ? manifest.stores : null;
  if (stores === null || stores.length === 0) {
    coverageLost([
      `${manifestPath} carries no \`stores[]\` array.`,
      'The drift comparison would then find every declared store "only in the guard", which is a true',
      'sentence about a file this guard failed to read rather than a finding about the platform.',
    ]);
  }
  const ids = stores.map((s) => s?.id).filter((s) => typeof s === 'string');
  const { onlyInGuard, onlyInManifest, compared } = compareManifest(DECLARED_STORES, ids);
  for (const s of onlyInGuard) {
    problems.push(
      `this guard declares store "${s}" and ${MANIFEST_REL} does not list it. The mirror has outlived the ` +
        'file it mirrors, so the bijection above is being held against a store set nobody maintains.',
    );
  }
  for (const s of onlyInManifest) {
    problems.push(
      `${MANIFEST_REL} lists store "${s}" and this guard's declared table does not. A store added to the ` +
        'knowledge set and not to this table is a store this guard cannot notice is missing a channel — the ' +
        'defect it exists for, one level up.',
    );
  }
  if (onlyInGuard.length === 0 && onlyInManifest.length === 0) {
    ok(`drift — ${compared} store(s) in ${manifestPath} and this guard's declared table are the same set`);
  }
} else if (manifestArg !== null) {
  coverageLost([
    `--manifest named ${manifestPath}, which does not exist.`,
    'A caller that asked for the drift comparison and got a printed limit instead would read the ok line',
    'as agreement between two files, one of which was never opened.',
  ]);
} else {
  prints.push(
    `DRIFT LIMB NOT RUN — ${MANIFEST_REL} lives in the private corpus, which is gitignored (.gitignore:22-23) ` +
      `and absent from this checkout, so the declared store table above was compared to the register only. ` +
      'Run it where the corpus is reachable: ' +
      'node tooling/ci/assert-store-bijection.mjs --manifest <path to platform-state/manifest.json>. ' +
      'A stated limit, not a pass.',
  );
}

// ── report ───────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('   ── printed, not failed (the corpus is not on this checkout) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-store-bijection: FAILED');
  process.exit(1);
}
ok(
  `store bijection — ${DECLARED_STORES.length} declared store(s) map onto ${owner.size} of ` +
    `${registerStoreChannels.length} store channel(s) in ${REGISTER}, and every store channel is claimed`,
);
