#!/usr/bin/env node
// [pipeline C-6] Assert every FAIL-CLOSED seam has a real on-switch.
//
// WHY THIS EXISTS. Four capabilities in this repo shipped built, tested,
// documented and completely inert: the analytics rail (consent was never
// recorded by any code path), content packs (no pinned key, only a rejecting
// verifier), the entitlement cache (nothing fetches an entitlement) and
// PaywallGate (no consumer). None of them failed a test, because refusing IS
// their correct behaviour when the switch is off. A fail-closed default is good
// engineering; a fail-closed default with no proven open path is a dead feature
// that reports healthy.
//
// So this guard does not check that the code is correct. It checks that
// SOMETHING REAL CALLS IT — a non-test file under apps/ or the brick template.
//
// It also pins the privacy-policy version the app claims against the version the
// published policy actually carries. A consent artifact naming a policy version
// nobody was shown is worse than no artifact: it is a false compliance record.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const repo = process.cwd();
let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);

// ── the scan ────────────────────────────────────────────────────────────────
// Deliberately excludes test/ and integration_test/: a seam whose only caller is
// a test is exactly the state this guard exists to reject.
const SCAN_ROOTS = ['apps', 'tooling/bricks'];
const SKIP_DIR = new Set(['build', '.dart_tool', 'node_modules', 'test', 'integration_test']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      if (!SKIP_DIR.has(e)) walk(p, out);
    } else if (e.endsWith('.dart')) {
      out.push(p);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(repo, r)));

// COVERAGE SELF-CHECK. If the scan silently stops reaching the app tree this
// guard would pass every seam by finding nothing to contradict it — the exact
// "a check that stopped checking" failure this repo keeps hitting (F-10).
const MIN_FILES = 12;
if (files.length < MIN_FILES) {
  fail(`COVERAGE LOST — scanned only ${files.length} dart file(s) under ${SCAN_ROOTS.join(', ')}, expected >= ${MIN_FILES}. The scan is broken, not the tree.`);
} else {
  ok(`scan reaches ${files.length} non-test dart file(s)`);
}

const bodies = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const rel = (f) => f.replace(repo + sep, '').replaceAll('\\', '/');

// `declares` is not optional sugar. Searching for `foo(` finds the DECLARATION of
// foo as readily as a call to it, so a "does anything call this?" check that
// ignores declarations passes even when every real caller is deleted. That bug
// was live in this guard and was caught only by mutating the real repo — the
// fixture tests all passed. An assertion that cannot fail is worse than none.
const hits = (re, declares) =>
  [...bodies]
    .filter(([f, src]) => re.test(src) && !(declares && declares.test(src)))
    .map(([f]) => rel(f));

// ── the seams ───────────────────────────────────────────────────────────────
// REQUIRED_COVERAGE: every fail-closed seam this repo owns. `wired: false` means
// the requirement is DEFERRED with a written owner — it is reported, never
// silently absent, so the count of dead capabilities can never drift unnoticed.
const REQUIRED_COVERAGE = [
  {
    id: 'consent',
    what: 'ConsentController.record — the analytics on-switch',
    wired: true,
    // The decision path itself, and the UI that triggers it. Both, because
    // deleting either one silently re-breaks the rail.
    needs: [
      { re: /ConsentPurpose\.analytics\s*,[\s\S]{0,200}?granted:/, label: 'a real record() call' },
      {
        re: /recordAnalyticsConsent\s*\(/,
        // Must be found somewhere OTHER than the file declaring it.
        declares: /(?:Future<void>\s+)?recordAnalyticsConsent\s*\(\s*\n?\s*WidgetRef/,
        label: 'a UI caller',
      },
    ],
  },
  // Checked by `checkPackVerifier()` below rather than by the caller scan: the
  // implementation lives in packages/core, which is not an app tree, and its
  // "on-switch" has two halves with different owners.
  {
    id: 'pack_verifier',
    what: 'PackVerifier — content packs cannot load without a real impl',
    wired: false,
    deferred: 'checked separately — see the pack_verifier section below',
  },
  {
    id: 'entitlements',
    what: 'entitlement fetch — PaywallGate has nothing real to gate',
    wired: false,
    deferred: 'stage 5, money rail (owner decision 2026-07-26)',
  },
];

let liveSeams = 0;
for (const seam of REQUIRED_COVERAGE) {
  if (!seam.wired) {
    console.log(`--   ${seam.id} — DEFERRED: ${seam.deferred}`);
    continue;
  }
  liveSeams++;
  for (const need of seam.needs) {
    const found = hits(need.re, need.declares);
    if (found.length === 0) {
      fail(`${seam.id} — ${need.label} NOT FOUND in any non-test file. ${seam.what}. A seam whose only caller is a test is a dead capability.`);
    } else {
      ok(`${seam.id} — ${need.label} at ${found[0]}${found.length > 1 ? ` (+${found.length - 1} more)` : ''}`);
    }
  }
}

if (liveSeams === 0) {
  fail('COVERAGE LOST — no seam in REQUIRED_COVERAGE is marked wired, so this guard asserted nothing.');
}

// ── the pack verifier ───────────────────────────────────────────────────────
// TWO HALVES, DIFFERENT OWNERS, and conflating them is how this seam stayed dead
// for months while looking designed:
//   (a) a real non-rejecting implementation exists  → agent's job, asserted here
//   (b) production signing keys are pinned          → OWNER'S job (OWNER_QUEUE S-3)
// Half (b) cannot be a build failure — it would block every CI run on work only
// the owner can do — but it is REPORTED on every run, so "packs still cannot load
// in production" can never quietly become invisible.
const VERIFIER_IMPL = 'packages/core/lib/src/content/ed25519_pack_verifier.dart';
const CORE_BARREL = 'packages/core/lib/nikatru_core.dart';
const KEYS_FILE = 'packages/core/lib/src/content/pack_verifier.dart';
try {
  const impl = readFileSync(join(repo, VERIFIER_IMPL), 'utf8');
  const barrel = readFileSync(join(repo, CORE_BARREL), 'utf8');
  const keys = readFileSync(join(repo, KEYS_FILE), 'utf8');

  if (!/class\s+\w+\s+implements\s+PackVerifier/.test(impl)) {
    fail(`${VERIFIER_IMPL} declares no PackVerifier implementation. Without one the only impl is RejectingPackVerifier and NO pack can ever load.`);
  } else if (/return\s+false\s*;?\s*\}?\s*$/.test(impl.trim())) {
    fail(`${VERIFIER_IMPL} looks like it unconditionally rejects — that is RejectingPackVerifier with extra steps.`);
  } else {
    ok('pack_verifier — a real PackVerifier implementation exists');
  }

  if (!barrel.includes('ed25519_pack_verifier.dart')) {
    fail(`${CORE_BARREL} does not export the verifier, so no app can reach it.`);
  } else {
    ok('pack_verifier — exported from the core barrel');
  }

  // Half (b). Parsed, not grepped for prose: the surrounding doc comment talks
  // about keys at length, so a naive text search would "find" keys that the map
  // does not contain.
  const mapBody = keys.match(/kContentPackPublicKeys\s*=\s*<String,\s*String>\{([\s\S]*?)\}/)?.[1] ?? '';
  const pinnedCount = (mapBody.match(/['"][^'"]+['"]\s*:/g) ?? []).length;
  if (pinnedCount === 0) {
    console.log('--   pack_verifier — 0 production keys pinned: packs CANNOT load in production yet. OWNER-GATED (OWNER_QUEUE S-3, generate the signing keypair). The implementation is proven against a test keypair.');
  } else {
    ok(`pack_verifier — ${pinnedCount} production key(s) pinned`);
  }
} catch (e) {
  fail(`pack_verifier check could not run: ${e.message}`);
}

// ── the policy-version pin ──────────────────────────────────────────────────
const POLICY_HTML = 'sites/nikatru/privacy.html';
const POLICY_CONST = 'apps/subly/lib/state/analytics_providers.dart';
try {
  const html = readFileSync(join(repo, POLICY_HTML), 'utf8');
  const dart = readFileSync(join(repo, POLICY_CONST), 'utf8');
  const published = html.match(/data-policy-version="([^"]+)"/)?.[1];
  const claimed = dart.match(/kPrivacyPolicyVersion\s*=\s*'([^']+)'/)?.[1];
  if (!published) {
    fail(`${POLICY_HTML} has no data-policy-version attribute — the consent artifact cannot name what the user was shown.`);
  } else if (!claimed) {
    fail(`${POLICY_CONST} has no kPrivacyPolicyVersion constant.`);
  } else if (published !== claimed) {
    fail(`policy version DRIFT — app claims '${claimed}', ${POLICY_HTML} publishes '${published}'. Every consent artifact would name a policy the user never saw.`);
  } else {
    ok(`policy version pinned — app and published policy both '${claimed}'`);
  }
} catch (e) {
  fail(`policy version check could not run: ${e.message}`);
}

if (failed) {
  console.error('\nassert-seams-wired: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-seams-wired: ok');
}
