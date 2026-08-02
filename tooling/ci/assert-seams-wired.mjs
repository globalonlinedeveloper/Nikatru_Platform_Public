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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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
// 🔴 apps/probe is a GITIGNORED LOCAL STAMP — present on a dev box, never in a
// fresh CI checkout. Scanning it makes this guard's answer depend on whether
// somebody happened to run `mason make`, which is not a property of the
// repository. Found 2026-08-01 while mutation-testing the secure_session seam:
// with the call deleted from BOTH real call sites the guard still printed `ok`,
// satisfied entirely by a throwaway stamp — a caller check that cannot fail.
// assert-package-boundaries.mjs already excludes it for the same reason.
const SKIP_PATH = [join('apps', 'probe')];

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

const files = SCAN_ROOTS.flatMap((r) => walk(join(repo, r))).filter(
  (f) => !SKIP_PATH.some((skip) => f.startsWith(join(repo, skip) + sep)),
);

// COVERAGE SELF-CHECK. If the scan silently stops reaching the app tree this
// guard would pass every seam by finding nothing to contradict it — the exact
// "a check that stopped checking" failure this repo keeps hitting (F-10).
const MIN_FILES = 12;
if (files.length < MIN_FILES) {
  fail(`COVERAGE LOST — scanned only ${files.length} dart file(s) under ${SCAN_ROOTS.join(', ')}, expected >= ${MIN_FILES}. The scan is broken, not the tree.`);
} else {
  ok(`scan reaches ${files.length} non-test dart file(s)`);
}

/**
 * Blank Dart comments and string literals, preserving offsets and newlines.
 *
 * 🔴 ADDED 2026-08-02, AND IT WAS A LIVE HOLE. Every `needs` anchor in this file
 * matched the RAW source, so commenting a call out — one `//`, the exact edit
 * somebody makes while debugging — left this guard printing `ok` for a seam
 * with no caller at all. Found by mutating the real brick: prefixing
 * `await prompter.requestReview();` with `//` kept the whole guard at exit 0.
 * That is the repo's own recorded rule ("assert on structure, never by grepping
 * prose") applied to the one guard whose entire subject is whether real code
 * calls a seam.
 *
 * Hand-rolled rather than a regex: a regex cannot tell `//` inside a string from
 * a comment. It lives here rather than in a shared module because every `.mjs`
 * directly under tooling/ci is a GUARD to assert-guard-coverage.mjs, and any
 * `.mjs` in a subdirectory of tooling/ci is a hard COVERAGE LOST.
 */
function stripDart(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; out += '  '; i += 2; if (depth === 0) break; continue; }
        out += blank(src[i]); i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      const start = i;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') break;
        j++;
      }
      for (const ch of src.slice(start, j)) out += blank(ch);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const bodies = new Map(files.map((f) => [f, stripDart(readFileSync(f, 'utf8'))]));
const rel = (f) => f.replace(repo + sep, '').replaceAll('\\', '/');

// `declares` is not optional sugar. Searching for `foo(` finds the DECLARATION of
// foo as readily as a call to it, so a "does anything call this?" check that
// ignores declarations passes even when every real caller is deleted. That bug
// was live in this guard and was caught only by mutating the real repo — the
// fixture tests all passed. An assertion that cannot fail is worse than none.
// `scope` narrows WHERE a caller counts. Without it, a seam the brick is
// supposed to drive can be kept green by an unrelated caller in apps/ — which is
// the same "assertion that cannot fail" in a wider costume: delete the brick's
// call, some other tree still matches, the guard prints ok, and every stamped
// app ships the dead capability.
const hits = (re, declares, scope) =>
  [...bodies]
    .filter(([f, src]) => re.test(src) && !(declares && declares.test(src)))
    .map(([f]) => rel(f))
    .filter((r) => !scope || r.startsWith(scope));

// The template every stamped app is born from — the scope for anything the
// CHASSIS must carry, as opposed to anything some app happens to do.
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

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
  {
    id: 'secure_session',
    what: 'initNikatruAuth — the only call that keeps the refresh token out of plaintext [G-43]',
    wired: true,
    // 🔴 ADDED 2026-08-01 AFTER THE SEAM WAS FOUND DEAD. This guard's whole
    // subject is "does anything real call it", and `initNikatruAuth` — a
    // function whose own doc says "the brick calls this" — had ZERO callers
    // tree-wide: its declaration plus two fixture strings. Meanwhile the brick
    // initialised Supabase nowhere (a backend-live stamp died at launch) and the
    // one shipping app called `Supabase.initialize` bare (refresh token in
    // plaintext). It was not listed here, so C-6 could not count it — the very
    // gap 02-STAGE-2-OWNER-BRIEF called out: "auth is not even a deferred row".
    needs: [
      {
        re: /initNikatruAuth\s*\(/,
        // Belt and braces: packages/ is outside SCAN_ROOTS so the declaration is
        // not in scope anyway, but an anchor that would match a declaration if
        // the scan ever widened is an anchor that stops meaning anything.
        declares: /Future<void>\s+initNikatruAuth\(/,
        label: 'a real caller (not a test)',
      },
      {
        re: /secureStore:\s*FlutterSecureStore\(/,
        label: 'a real platform secure store handed to it',
      },
    ],
  },
  {
    id: 'reminders',
    what: 'NotificationService.scheduleDaily — the reminders toggle\'s only real effect',
    wired: true,
    // 🔴 ADDED 2026-08-01 AFTER THE SEAM WAS FOUND DEAD (full-corpus review).
    // The brick's reminder switch called `requestPermission()` and persisted the
    // answer; `scheduleDaily`, `showNow` and `init` had ZERO call sites in the
    // whole template. So every app this factory stamps primed the user, spent
    // the ONE OS permission prompt most platforms ever grant, showed the switch
    // as ON — and never scheduled a notification. Nothing went red, because the
    // flag it did persist was persisted correctly. This is precisely the
    // fail-closed-with-no-open-path shape, and the seam was not on this list, so
    // C-6 could not count it.
    needs: [
      {
        re: /\.scheduleDaily\(/,
        // The interface, the NoOp and the adapter all declare the name; only a
        // CALL through a receiver counts. packages/ is outside SCAN_ROOTS, but
        // an anchor that would match a declaration if the scan widened is an
        // anchor that stops meaning anything.
        declares: /Future<void>\s+scheduleDaily\(/,
        // Scoped to the brick: this is the CHASSIS's reminder, inherited by
        // every app the factory stamps. A caller in apps/ would say nothing
        // about that and would keep this green with the template's own call
        // deleted.
        scope: BRICK_APP,
        label: 'a real scheduleDaily call site in the stamped chassis',
      },
      {
        re: /applyReminderChoice\(/,
        declares: /Future<bool>\s+applyReminderChoice\(/,
        scope: BRICK_APP,
        label: 'a UI caller that turns the switch into a schedule',
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
    what: 'entitlement fetch — the answer PaywallGate gates on',
    wired: true,
    // 🔴 WIRED 2026-08-01. This row read `wired: false, deferred: "stage 5"`
    // and had NO `needs` array at all — which is the shape the whole guard is
    // about, one level up: a seam that is honestly declared dead asserts
    // nothing, and the moment somebody flips the boolean without adding needs,
    // `liveSeams` increments, ZERO assertions run, and a dead seam is certified
    // live. That is strictly worse than the honest `false` it replaced, which is
    // why MIN_NEEDS below exists.
    //
    // THREE needs, not one, because the seam has three separable halves and
    // deleting any one of them silently re-breaks the rail:
    //   · the FETCH happens at all (the thing that had never existed);
    //   · the answer REACHES A GATE (a fetch nothing consults is the same dead
    //     capability wearing a network call);
    //   · the CHECKOUT can be started (a gate with no way past it is a promise
    //     the app cannot keep).
    needs: [
      {
        re: /\.fetch\(\s*\n?\s*appId:/,
        // packages/ is outside SCAN_ROOTS so the interface's own declaration is
        // not in scope — but an anchor that would match a declaration if the
        // scan ever widened is an anchor that stops meaning anything.
        declares: /Future<Result<Entitlements>>\s+fetch\(/,
        scope: BRICK_APP,
        label: 'a real EntitlementTransport.fetch call in the stamped chassis',
      },
      {
        re: /PaywallGate\(\s*\n?\s*locked:/,
        scope: BRICK_APP,
        label: 'a PaywallGate whose lock comes from that answer',
      },
      {
        re: /\.startCheckout\(/,
        declares: /Future<CheckoutStart>\s+startCheckout\(/,
        scope: BRICK_APP,
        label: 'a checkout the gate can be got past',
      },
    ],
  },
];

// 🔒 THE FLOOR THAT STOPS A DEAD SEAM BEING CERTIFIED LIVE.
// `wired: true, needs: []` passes every loop below by iterating nothing, and it
// increments `liveSeams`, so the coverage self-check at the bottom is satisfied
// too. Two is the minimum that can express "the thing exists AND something
// reaches it", which is the distinction this entire guard was written for.
const MIN_NEEDS = 2;

let liveSeams = 0;
for (const seam of REQUIRED_COVERAGE) {
  if (!seam.wired) {
    console.log(`--   ${seam.id} — DEFERRED: ${seam.deferred}`);
    continue;
  }
  liveSeams++;
  if ((seam.needs?.length ?? 0) < MIN_NEEDS) {
    fail(
      `COVERAGE LOST — seam \`${seam.id}\` is marked wired but declares ${seam.needs?.length ?? 0} need(s), fewer than ${MIN_NEEDS}. A wired seam with no needs iterates zero assertions and certifies itself live, which is strictly worse than an honest \`wired: false\`.`,
    );
    continue;
  }
  for (const need of seam.needs) {
    const found = hits(need.re, need.declares, need.scope);
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

// ── [pipeline 12]W-7b · SOME SEAMS MAY HAVE EXACTLY ONE CALLER ───────────────
//
// Everything above proves AT LEAST ONE caller. A handful of seams need the
// opposite bound as well, and this guard had no shape for it.
//
// The review prompt is the case. iOS silently DISCARDS requests beyond its
// quota and shows nothing, so a second call site is not a second prompt — it is
// the one prompt the app ever gets, spent at whatever moment that second caller
// happened to fire, with no error anywhere. The requirement's wording ("exposes
// no public trigger a button could call") is a claim about source shape that no
// unit test can express, which is exactly why it went unnoticed while
// `requestReview()` shipped public on the interface, on the NoOp and on the
// adapter.
//
// 🔴 MATCH THE CALL, NEVER THE IDENTIFIER — the house rule this file already
// paid for twice. `requestReview` appears in three declarations; an identifier
// match is green against a codebase with zero callers AND against one with ten.
// `allowed` names the ONE legitimate call site; anything else is a failure that
// prints where it found it.
const EXCLUSIVE_TRIGGERS = [
  {
    id: 'review_prompt',
    // The call, through a receiver. The abstract declaration
    // (review_prompter.dart), the NoOp override and the concrete @override all
    // contain the bare name.
    re: /\.requestReview\(/,
    allowed: [`${BRICK_APP}/lib/state/providers.dart`],
    why:
      'ReviewPromptController.maybeAsk is the only thing allowed to ask, because the decision belongs to ' +
      'ReviewGate and nothing else can know whether the quota is worth spending. iOS discards requests past ' +
      'its quota SILENTLY, so a second caller does not produce a second prompt — it produces no prompt, and ' +
      'no error, on the launch that mattered.',
  },
];

for (const t of EXCLUSIVE_TRIGGERS) {
  // No `scope`: the point is to find a caller ANYWHERE the scan reaches, which
  // is what a narrower scan would hide.
  const found = hits(t.re, undefined, undefined);
  const extra = found.filter((f) => !t.allowed.includes(f));
  const missing = t.allowed.filter((a) => !found.includes(a));
  if (found.length === 0) {
    // The at-least-one half. Without it, deleting the only caller turns this
    // check GREEN — an "at most one" rule is satisfied by zero, which is the
    // most obvious way for a bound like this to stop meaning anything.
    fail(
      `${t.id} — NOTHING calls it. ${t.why} An "at most one caller" rule is satisfied by zero callers, so ` +
        'this half is what stops the bound certifying a dead seam.',
    );
  } else if (missing.length) {
    fail(
      `${t.id} — the one permitted call site ${missing.join(', ')} no longer calls it (found instead: ` +
        `${found.join(', ')}). Either the caller moved, in which case update the allowlist deliberately, or ` +
        'the prompt is now asked from somewhere that cannot know whether it is worth asking.',
    );
  } else if (extra.length) {
    fail(
      `${t.id} — ${extra.length} additional call site(s): ${extra.join(', ')}. ${t.why} If a second caller is ` +
        'genuinely wanted, it belongs behind the same gate, not beside it.',
    );
  } else {
    ok(`${t.id} — exactly one caller (${found[0]}), which is the bound this seam needs`);
  }
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
// EVERY file that claims a policy version, not just the first one written.
// The brick template gained its own `kPrivacyPolicyVersion` when analytics were
// wired into it — and a single-file check would have let the TEMPLATE drift
// silently, so every app stamped afterwards would ship a consent artifact naming
// a policy its users were never shown. A false compliance record is worse than
// none. Add a file here the moment it declares the constant.
const POLICY_CONSTS = [
  'apps/subly/lib/state/analytics_providers.dart',
  'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart',
];
try {
  const html = readFileSync(join(repo, POLICY_HTML), 'utf8');
  const published = html.match(/data-policy-version="([^"]+)"/)?.[1];
  if (!published) {
    fail(`${POLICY_HTML} has no data-policy-version attribute — the consent artifact cannot name what the user was shown.`);
  } else {
    let checked = 0;
    for (const file of POLICY_CONSTS) {
      let dart;
      try {
        dart = readFileSync(join(repo, file), 'utf8');
      } catch {
        fail(`${file} declares a policy version in the coverage list but could not be read.`);
        continue;
      }
      const claimed = dart.match(/kPrivacyPolicyVersion\s*=\s*'([^']+)'/)?.[1];
      if (!claimed) {
        fail(`${file} has no kPrivacyPolicyVersion constant.`);
      } else if (published !== claimed) {
        fail(`policy version DRIFT — ${file} claims '${claimed}', ${POLICY_HTML} publishes '${published}'. Every consent artifact would name a policy the user never saw.`);
      } else {
        checked++;
      }
    }
    // Coverage self-check: an emptied list would silently assert nothing.
    if (checked === POLICY_CONSTS.length && checked > 0) {
      ok(`policy version pinned — ${checked} file(s) and the published policy all '${published}'`);
    } else if (POLICY_CONSTS.length === 0) {
      fail('COVERAGE LOST — no file is checked against the published policy version.');
    }
  }
} catch (e) {
  fail(`policy version check could not run: ${e.message}`);
}

// ── the crash sink is a fail-closed seam too, and it was closed ──────────────
// TelemetryBootstrap falls back to a NoOp client when the DSN is empty — correct
// behaviour, and indistinguishable from working. No workflow passed
// GLITCHTIP_DSN, so the ONLY shipping app initialised the no-op client and a
// real user's crash reached nobody. Nothing failed; the chassis was built,
// tested and declared, and the last wire was never connected.
//
// BOTH ENDS are asserted on purpose. Checking only the workflow would keep
// passing if main.dart stopped reading the value, and checking only main.dart
// would keep passing if the deploy stopped supplying it. Either half alone is a
// check watching one end of a pipe.
{
  const DEPLOY = 'deploy-web.yml';
  const wfPath = join(repo, '.github', 'workflows', DEPLOY);
  const entry = join(repo, 'apps', 'subly', 'lib', 'main.dart');
  if (!existsSync(wfPath)) {
    fail(`COVERAGE LOST — ${DEPLOY} is gone, so the crash-sink check is watching a deploy that no longer exists.`);
  } else if (!existsSync(entry)) {
    fail('COVERAGE LOST — apps/subly/lib/main.dart is gone; the consumer half of the crash-sink check cannot be verified.');
  } else {
    const wf = readFileSync(wfPath, 'utf8');
    const main = readFileSync(entry, 'utf8');
    // 🔴 NO `#` BEFORE THE MATCH (2026-08-01 full-corpus review). This tested
    // the RAW workflow text, so commenting the define out — one `#`, the exact
    // edit somebody makes while debugging build flags — still counted as
    // "supplied", and the shipped build initialised the NoOp client with this
    // guard printing ok. Worse: the define sits in a `run: >` folded scalar,
    // where that `#` is a SHELL comment that also swallows the rest of the
    // line. A define behind a comment marker is prose, not a flag; the match
    // must sit on a line with no `#` anywhere before it.
    const supplied = /^[^#\n]*--dart-define=GLITCHTIP_DSN=/m.test(wf);
    const consumed = /String\.fromEnvironment\(\s*'GLITCHTIP_DSN'/.test(main);
    if (!consumed) {
      fail("apps/subly/lib/main.dart no longer reads String.fromEnvironment('GLITCHTIP_DSN') — the deploy would be supplying a value nothing consumes.");
    } else if (!supplied) {
      fail(`${DEPLOY} does not pass --dart-define=GLITCHTIP_DSN. The shipped build initialises a NoOp telemetry client, so production crashes reach nobody and nothing goes red.`);
    } else {
      ok('crash sink wired — deploy supplies GLITCHTIP_DSN and the app reads it');
    }
  }
}

if (failed) {
  console.error('\nassert-seams-wired: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-seams-wired: ok');
}
