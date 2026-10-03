// ─────────────────────────────────────────────────────────────────────────────
// THE STORE-SCREENSHOT LANE'S NETWORK POSTURE.
//
// Subject: `tooling/store/capture-network-posture.mjs` and the two places
// `tooling/store/capture-play-screenshots.mjs` has to use it. The defect these
// cover is not hypothetical — every one of the EIGHT frames committed under
// `apps/subscriptiontracker/store/android-play/` carries a full-width
// "Could not reach the network. Some things may be out of date." band across
// the top, and `tooling/ci/assert-listing-assets.mjs` passed all eight, because
// its banner limb hunts `AppColors.warn` (#f59e0b) and this band is
// `errorContainer` (#ffdad6). Measured 2026-09-20: maxWARNRow 0.000 on seven of
// the eight and 0.003 on the last.
//
// ⚠️ NO LIMB HERE READS THE COMMITTED FRAMES. It would be red today and could
// only be made green by a workflow run this machine cannot perform — the live
// capture needs SUPABASE_SERVICE_ROLE_KEY, a CI-only secret. A guard over those
// bytes has to land in the SAME change as the re-captured bytes, which is this
// repo's standing rule for a floor and its subject; until then the refusal
// lives at capture time, where it stops the bad set being produced at all.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import { stripSourceComments, stripStringLiterals } from '../text-reductions.mjs';
import { decodeRgba, encodeRgba } from '../../store/png-codec.mjs';
import {
  LAUNCH_DEFINES,
  launchDefineArgs,
  scanTopBand,
  selfTestOfflineBannerDetector,
  BAND_ROW_FRACTION,
  RED_LEAD,
} from '../../store/capture-network-posture.mjs';
import { storeViewDefineArgs } from '../../store/capture-suite-scan.mjs';
import { sandboxBackend, productionD1Ids } from '../../store/capture-backend.mjs';
import { backendOf } from '../../e2e/backend.mjs';
import { mintMagicLinkTokenHash, MagicLinkRefused, TOKEN_HASH_SHAPE } from '../../e2e/magic_link.mjs';
import { parseWorkflow, workflowSteps, jobEnv, shellSegments } from '../workflow-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RUNNER = join(REPO, 'tooling', 'store', 'capture-play-screenshots.mjs');

/** A frame with `bandRows` of `bandRgb` on top of the app background, round-
 *  tripped through the real PNG encoder and decoder — the detector's true input
 *  is bytes, so a codec regression must be able to red these. */
function frame({ w = 200, h = 200, bandRgb, bandRows, bandWidth = w }) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBand = y < bandRows && x < bandWidth;
      const c = inBand ? bandRgb : [0xf4, 0xf4, 0xf8];
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 0xff;
    }
  }
  return decodeRgba(encodeRgba({ width: w, height: h, rgba }));
}

/** The measured colours the thresholds were placed between. */
const OFFLINE = [0xff, 0xda, 0xd6]; // ColorScheme.fromSeed(...).errorContainer
const WARN = [0xf5, 0x9e, 0x0b]; // AppColors.warn — the demo banner
const BG = [0xf4, 0xf4, 0xf8]; // AppColors.bg

describe('capture-network-posture — the offline-banner detector', () => {
  test('separates a banded frame from a clean one, in both directions', () => {
    const t = selfTestOfflineBannerDetector();
    assert.equal(t.ok, true);
    assert.equal(t.withBanner.banner, true);
    assert.equal(t.without.banner, false);
  });

  test('flags the offline banner actually found on the committed frames', () => {
    const r = scanTopBand(frame({ bandRgb: OFFLINE, bandRows: 14 }));
    assert.equal(r.banner, true);
    assert.equal(r.colour, '#ffdad6');
    assert.equal(r.fraction, 1);
    // 255 - max(218, 214) = 37, comfortably over the threshold.
    assert.equal(r.redLead, 37);
    assert.ok(r.redLead >= RED_LEAD);
  });

  test('flags the DEMO banner too — the same defect in another colour', () => {
    const r = scanTopBand(frame({ bandRgb: WARN, bandRows: 14 }));
    assert.equal(r.banner, true);
    assert.equal(r.redLead, 87);
  });

  test('clears a frame whose top is the app background', () => {
    const r = scanTopBand(frame({ bandRgb: BG, bandRows: 0 }));
    assert.equal(r.banner, false);
    // The clean case is FULL WIDTH too — it is the red lead that separates
    // them, not the coverage. A threshold on coverage alone would fail here.
    assert.equal(r.fraction, 1);
    assert.equal(r.redLead, -4);
  });

  test('clears a NARROW accent bar of an alarm colour — the false-positive direction', () => {
    // The live UI does paint AppColors.warn, as an accent a few px wide. 8 of
    // 200 columns is 4% of a row, two orders of magnitude under the threshold.
    const r = scanTopBand(frame({ bandRgb: WARN, bandRows: 14, bandWidth: 8 }));
    assert.equal(r.banner, false);
    assert.ok(r.fraction < BAND_ROW_FRACTION);
  });

  test('a band below the top window is not read as a top banner', () => {
    // 10% of 200 is 20 rows; a band starting at row 0 is what OfflineNotice
    // produces. A frame whose FIRST pixel is background cannot be banded.
    const r = scanTopBand(frame({ w: 200, h: 200, bandRgb: OFFLINE, bandRows: 0 }));
    assert.equal(r.banner, false);
  });
});

describe('capture-network-posture — the launch defines', () => {
  test('SKIP_REMOTE_CONFIG is declared true, with the reason it is there', () => {
    assert.equal(LAUNCH_DEFINES.SKIP_REMOTE_CONFIG?.value, 'true');
    // The reason is the whole entry: a define with no stated cause is one the
    // next reader deletes to "simplify the command line".
    assert.match(LAUNCH_DEFINES.SKIP_REMOTE_CONFIG.why, /cross-origin/i);
  });

  test('launchDefineArgs emits the argv pair flutter drive accepts', () => {
    assert.deepEqual(launchDefineArgs(), ['--dart-define', 'SKIP_REMOTE_CONFIG=true']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RUNNER HAS TO USE BOTH HALVES.
//
// Structural, over the runner's CODE with comments stripped — this file's
// subject is a module whose whole failure mode is being present and unused, and
// that module's name appears a dozen times in the runner's prose. A grep that
// counted those would pass on a runner that imports nothing (grep-02).
// ─────────────────────────────────────────────────────────────────────────────
describe('capture-play-screenshots.mjs uses the network posture it declares', () => {
  const code = stripSourceComments(readFileSync(RUNNER, 'utf8'), '.mjs');

  test('imports the module rather than re-implementing it', () => {
    assert.match(code, /from\s+'\.\/capture-network-posture\.mjs'/);
  });

  test('pushes the launch defines onto the drive command line', () => {
    assert.match(code, /defines\.push\(\s*\.\.\.launchDefineArgs\(\)\s*\)/);
  });

  test('self-tests the detector before it starts a browser', () => {
    const selfTest = code.indexOf('selfTestOfflineBannerDetector(');
    // 🔴 THE CALL SITE, NOT THE DECLARATION — and the difference reddened this
    // test on its first run. `function chromedriverPath()` is declared near the
    // top of the runner and INVOKED 180 lines later, so `indexOf('chromedriverPath(')`
    // measured the declaration and reported the self-test as late when it is
    // early. An ordering assertion has to name the thing that happens, not the
    // thing that is defined.
    // ⚠️ AND NOT `=\s*chromedriverPath\(\)` EITHER, since 2026-09-22: the call
    // site became conditional (`NATIVE ? null : chromedriverPath()`) when the
    // runner learned to drive a native binary, and an assertion tied to the
    // shape of the assignment reddened on a change that did not move it. The
    // SEMICOLON is what separates the call from the declaration, which is the
    // distinction this test was written to make.
    const browser = code.search(/chromedriverPath\(\);/);
    assert.ok(selfTest !== -1, 'the runner never calls selfTestOfflineBannerDetector');
    assert.ok(browser !== -1, 'the runner never invokes chromedriverPath()');
    // Refusing after the drive costs a browser, a provisioned Supabase user and
    // a CI run — the same argument the account-address self-test already makes.
    assert.ok(selfTest < browser, 'the detector self-test runs AFTER chromedriver is resolved');
  });

  test('scans every captured frame and records a banner as a problem', () => {
    // ⏱ 2026-09-22 · WAS /scanTopBand\(\s*decodeRgba\(/ — one expression. The
    // decoded frame is now HELD, because the row-edge check below reads the
    // same pixels and decoding a 1080x1920 frame twice per check is the kind
    // of waste that gets a check removed. Both halves are still pinned: the
    // frame is decoded, and the banner scan is what reads it.
    assert.match(code, /img = decodeRgba\(/);
    assert.match(code, /band = scanTopBand\(img\)/);
    assert.match(code, /band\?\.banner/);
    assert.match(code, /problems\.push\(/);
  });

  // ⏱ 2026-09-22 (store-frame-followup) · O-STORE-FRAME-FAB-COVERS-A-PRICE-ROW's no-human-eye
  // half. A frame whose fold geometry the drive never published is a frame
  // nobody examined, which is the failure mode this whole file exists for.
  test('reads the fold line of every frame, and proves the detector first', () => {
    const selfTest = code.search(/selfTestFoldLineDetector\(\)/);
    // ⏱ 2026-09-23 · WAS /=\s*chromedriverPath\(\)/. Rebased onto the store-
    // screenshots stack, the call site is `NATIVE ? null : chromedriverPath();`,
    // which that regex never matched (-1), so `selfTest < browser` read false on
    // an order that had not moved. Same call-site anchor as the offline-banner
    // limb above: the semicolon separates the call from the declaration.
    const browser = code.search(/chromedriverPath\(\);/);
    assert.ok(selfTest !== -1, 'the runner never calls selfTestFoldLineDetector');
    assert.ok(browser !== -1, 'the runner never invokes chromedriverPath()');
    assert.ok(selfTest < browser, 'the row-edge self-test runs AFTER chromedriver is resolved');
    assert.match(code, /foldLineProblems\(img, fold/);
    // Absent geometry is named, never silently skipped: a problem on a live
    // run, COVERAGE LOST (exit 2) on --proof.
    assert.match(code, /coverageLost\.push\(why\)/);
    assert.match(code, /process\.exit\(2\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKFLOW HAS TO REACH THE DRIVE THROUGH THE RUNNER.
//
// The defines and the pixel scan both live in `capture-play-screenshots.mjs`,
// so a workflow that called `flutter drive` for itself would walk straight past
// every limb above while still producing files in the listing directory. This
// is the one limb that is about the YAML, and it is the honest version of
// "assert the network flags are present in the workflow": there is no emulator
// in this lane to pin a status bar on — `-d web-server --browser-name=chrome`
// is a headless Chrome viewport — so the network posture is carried by the
// runner, and what the workflow owes is to use it.
// ─────────────────────────────────────────────────────────────────────────────
describe('store-screenshots.yml captures through the runner', () => {
  const yml = readFileSync(join(REPO, '.github', 'workflows', 'store-screenshots.yml'), 'utf8');
  /** Comment lines dropped: this file is mostly prose, and it names the runner
   *  in it. A grep over the raw YAML would pass on a workflow that only talks
   *  about the script (grep-02). */
  const steps = yml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  test('invokes capture-play-screenshots.mjs rather than flutter drive directly', () => {
    assert.match(steps, /node tooling\/store\/capture-play-screenshots\.mjs/);
    assert.doesNotMatch(steps, /flutter\s+drive/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CAPTURE'S CONSENT ROWS ARE STAMPED AND PURGED (pipeline B-17, 2026-09-23).
//
// Every live drive answers the consent prompt, and the app uploads that answer
// to production platform_db `consent_artifacts`. Run 35818960378's Linux job
// left two such rows stamped `dev`: the capture passed no APP_VERSION, and its
// purge step carried no platform_db id and no install id to delete by. The
// runner now stamps cap-<run>-<sha7> (tooling/e2e/app-version-stamp.mjs) and
// records each drive's install id in E2E_CONSENT_LEDGER; the purge step reads
// the same ledger. These limbs hold each job's two steps to that contract.
//
// The checker below is a line reader over the workflow, not a YAML library:
// a job is a two-space key under `jobs:`, a step starts at `      - `, and a
// step's env is the block under its `env:` key. Full-line comments are dropped
// first, because this workflow's prose names every variable it sets (grep-02).
// ─────────────────────────────────────────────────────────────────────────────
const CAPTURE_INVOCATION = /\bnode tooling\/store\/capture-play-screenshots\.mjs\b/;
const PURGE_INVOCATION = /\bnode tooling\/e2e\/purge\.mjs\b/;

/** jobs → steps, each step with its first line, its env map and its env lines.
 *  ⏱ 2026-09-26: each job also carries its own `env:` (keys at 4, entries at 6), because
 *  a per-app lane binds `APP` there (O-STORE-LANES-HARD-WIRE-ONE-APP). */
function workflowJobs(text) {
  const jobs = [];
  let inJobs = false;
  let job = null;
  let step = null;
  let inEnv = false;
  let inJobEnv = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    if (/^jobs:\s*$/.test(raw)) {
      inJobs = true;
      return;
    }
    if (!inJobs) return;
    const jm = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(raw);
    if (jm) {
      job = { name: jm[1], line: i + 1, steps: [], env: {} };
      jobs.push(job);
      step = null;
      inEnv = false;
      inJobEnv = false;
      return;
    }
    if (!job) return;
    const jk = /^ {4}([A-Za-z_-]+):/.exec(raw);
    if (jk) inJobEnv = jk[1] === 'env';
    const je = inJobEnv ? /^ {6}([A-Z][A-Z0-9_]*):\s*(.*?)\s*$/.exec(raw) : null;
    if (je) {
      job.env[je[1]] = je[2];
      return;
    }
    if (/^ {6}- /.test(raw)) {
      step = { line: i + 1, env: {}, envLine: {}, text: '' };
      job.steps.push(step);
      inEnv = false;
    } else if (/^ {0,5}\S/.test(raw)) {
      // Back out to a job key (`runs-on:`, `steps:`): no step owns this line.
      step = null;
      inEnv = false;
    }
    if (!step) return;
    step.text += `${raw}\n`;
    const key = /^ {6}(?:- | {2})([A-Za-z_-]+):/.exec(raw);
    if (key) {
      inEnv = key[1] === 'env';
      return;
    }
    const em = inEnv ? /^ {10}([A-Z][A-Z0-9_]*):\s*(.*?)\s*$/.exec(raw) : null;
    if (em) {
      step.env[em[1]] = em[2];
      step.envLine[em[1]] = i + 1;
    }
  });
  return jobs;
}

/** A step output a purge may take its platform database from (⏱ 2026-09-26). */
const STEP_PLATFORM_DB = /^\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.platform_db\s*\}\}$/;

/** The capture/purge contract, per job that runs the capture. Pure.
 *  ⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP): the lane takes its app at dispatch. A
 *  `--app "$APP"` is the job env's APP (the gate's checked output), and the purge's
 *  PLATFORM_D1_DATABASE_ID may be `${{ steps.<id>.outputs.platform_db }}` of an EARLIER step
 *  that runs tooling/e2e/backend.mjs --env sandbox --emit-output: the sandbox id, resolved. */
function checkCaptureConsentWiring(text, platformDbId) {
  const findings = [];
  const spawners = [];
  for (const job of workflowJobs(text)) {
    const capture = job.steps.find((s) => CAPTURE_INVOCATION.test(s.text));
    if (!capture) continue;
    spawners.push(job.name);
    const bound = (v) => {
      const u = String(v ?? '').replace(/^(['"])(.*)\1$/, '$2');
      return /^\$\{?APP\}?$/.test(u) ? (job.env.APP ?? u) : u;
    };
    const app = bound(/--app\s+(\S+)/.exec(capture.text)?.[1] ?? null) || null;
    const ledger = capture.env.E2E_CONSENT_LEDGER ?? null;
    if (!ledger) {
      findings.push({ rule: 'capture-ledger', job: job.name, line: capture.line, msg: `job ${job.name}: the capture step at :${capture.line} carries no E2E_CONSENT_LEDGER` });
    }
    const purge = job.steps.find((s) => PURGE_INVOCATION.test(s.text));
    if (!purge) {
      findings.push({ rule: 'purge-step', job: job.name, line: capture.line, msg: `job ${job.name}: runs the capture at :${capture.line} and has no purge step` });
      continue;
    }
    if (!/^ {8}if: always\(\)\s*$/m.test(purge.text)) {
      findings.push({ rule: 'purge-always', job: job.name, line: purge.line, msg: `job ${job.name}: the purge step at :${purge.line} is not \`if: always()\`` });
    }
    const out = STEP_PLATFORM_DB.exec(purge.env.PLATFORM_D1_DATABASE_ID ?? '');
    const resolver = out
      ? job.steps.find(
          (s) =>
            s.line < purge.line &&
            new RegExp(`^ {8}id: ${out[1]}\\s*$`, 'm').test(s.text) &&
            /\bnode tooling\/e2e\/backend\.mjs\b/.test(s.text) &&
            /\s--env sandbox(?=\s|$)/.test(s.text) &&
            /\s--emit-output(?=\s|$)/.test(s.text),
        )
      : null;
    if (purge.env.PLATFORM_D1_DATABASE_ID !== platformDbId && !resolver) {
      findings.push({
        rule: 'purge-platform-db',
        job: job.name,
        line: purge.line,
        msg: `job ${job.name}: the purge step at :${purge.line} carries PLATFORM_D1_DATABASE_ID=${purge.env.PLATFORM_D1_DATABASE_ID ?? '(unset)'}, not the sandbox platform database's ${platformDbId}`,
      });
    }
    if (!app || bound(purge.env.E2E_APP_ID) !== app) {
      findings.push({ rule: 'purge-app-id', job: job.name, line: purge.line, msg: `job ${job.name}: the purge step at :${purge.line} carries E2E_APP_ID=${purge.env.E2E_APP_ID ?? '(unset)'}, not the captured --app ${app ?? '(none)'}` });
    }
    if (!ledger || purge.env.E2E_CONSENT_LEDGER !== ledger) {
      findings.push({ rule: 'purge-ledger', job: job.name, line: purge.line, msg: `job ${job.name}: the purge step at :${purge.line} carries E2E_CONSENT_LEDGER=${purge.env.E2E_CONSENT_LEDGER ?? '(unset)'}, not its capture step's ${ledger ?? '(unset)'}` });
    }
  }
  return { spawners, findings };
}

describe('store-screenshots.yml purges the consent rows its capture writes', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'store-screenshots.yml');
  const yml = readFileSync(WORKFLOW, 'utf8');
  // S20 (2026-09-25, capsand-b): the capture writes to the SANDBOX Workers, so
  // its purge deletes from the sandbox platform database — the id
  // sandboxBackend() reads from services/platform/wrangler.jsonc env.sandbox,
  // the same reading capture-backend.mjs refuses a production id through.
  const SANDBOX = sandboxBackend();
  const PLATFORM_DB_ID = SANDBOX.platform.sandboxIds['d1:PLATFORM_DB'] ?? null;
  const real = checkCaptureConsentWiring(yml, PLATFORM_DB_ID);
  const of = (rule) => real.findings.filter((f) => f.rule === rule).map((f) => f.msg);

  test('every capture job has an always() purge carrying the SANDBOX platform database\'s id', () => {
    assert.ok(PLATFORM_DB_ID, 'services/platform/wrangler.jsonc env.sandbox declares no PLATFORM_DB database_id');
    assert.ok(!productionD1Ids(SANDBOX).has(PLATFORM_DB_ID), `the purge id ${PLATFORM_DB_ID} is a production database`);
    // Pinned by NAME: a job that stopped matching the capture invocation would
    // otherwise shrink the census and pass every rule below over less.
    assert.deepEqual(real.spawners, ['capture', 'capture-linux', 'capture-desktop-native', 'capture-ios']);
    assert.deepEqual([...of('purge-step'), ...of('purge-always'), ...of('purge-platform-db')], []);
  });

  test('…and E2E_APP_ID names the app the capture drives', () => {
    assert.deepEqual(of('purge-app-id'), []);
    // ⏱ 2026-09-26: the gate's checked app, in all four purges; no app id in the file.
    assert.equal((yml.match(/^ {10}E2E_APP_ID: \$\{\{ needs\.gate\.outputs\.app \}\}$/gm) ?? []).length, 4);
  });

  test('…and the purge reads the E2E_CONSENT_LEDGER its capture step writes', () => {
    assert.deepEqual([...of('capture-ledger'), ...of('purge-ledger')], []);
    assert.equal(real.findings.length, 0, real.findings.map((f) => f.msg).join('\n'));
  });

  test('🔴 a purge without PLATFORM_D1_DATABASE_ID is named, with its job and line', () => {
    const lines = yml.split(/\r?\n/);
    const linux = workflowJobs(yml).find((j) => j.name === 'capture-linux');
    const purge = linux.steps.find((s) => PURGE_INVOCATION.test(s.text));
    const at = purge.envLine.PLATFORM_D1_DATABASE_ID;
    assert.ok(at, 'capture-linux purge carries no PLATFORM_D1_DATABASE_ID to remove');
    const mutated = lines.filter((_, i) => i !== at - 1).join('\n');
    const { findings } = checkCaptureConsentWiring(mutated, PLATFORM_DB_ID);
    assert.deepEqual(
      findings.map((f) => `${f.rule} ${f.job} :${f.line}`),
      [`purge-platform-db capture-linux :${purge.line}`],
    );
    assert.match(findings[0].msg, /PLATFORM_D1_DATABASE_ID=\(unset\)/);
  });

  test('🔴 a purge pointed back at the PRODUCTION platform database is named', () => {
    const production = SANDBOX.platform.productionIds['d1:PLATFORM_DB'];
    assert.ok(production && production !== PLATFORM_DB_ID, 'services/platform/wrangler.jsonc binds no separate production PLATFORM_DB');
    const linux = workflowJobs(yml).find((j) => j.name === 'capture-linux');
    const purge = linux.steps.find((s) => PURGE_INVOCATION.test(s.text));
    const at = purge.envLine.PLATFORM_D1_DATABASE_ID;
    const lines = yml.split(/\r?\n/);
    // ⏱ 2026-09-26: the value is the resolver's output now, so the mutation writes the id in its place.
    lines[at - 1] = lines[at - 1].replace(/PLATFORM_D1_DATABASE_ID: .*$/, `PLATFORM_D1_DATABASE_ID: ${production}`);
    const { findings } = checkCaptureConsentWiring(lines.join('\n'), PLATFORM_DB_ID);
    assert.deepEqual(
      findings.map((f) => `${f.rule} ${f.job} :${f.line}`),
      [`purge-platform-db capture-linux :${purge.line}`],
    );
    assert.ok(findings[0].msg.includes(`PLATFORM_D1_DATABASE_ID=${production}`), findings[0].msg);
  });

  test('🔴 a purge whose platform_db comes from a resolver that is not the SANDBOX\'s is named', () => {
    // ⏱ 2026-09-26: `--env sandbox` dropped from capture-linux's resolver step, so it resolves production.
    const linux = workflowJobs(yml).find((j) => j.name === 'capture-linux');
    const resolverStep = linux.steps.find((s) => /\bnode tooling\/e2e\/backend\.mjs\b/.test(s.text));
    assert.ok(resolverStep, 'capture-linux runs no tooling/e2e/backend.mjs step to mutate');
    const purge = linux.steps.find((s) => PURGE_INVOCATION.test(s.text));
    const lines = yml.split(/\r?\n/);
    const at = lines.findIndex((l, i) => i >= resolverStep.line - 1 && /tooling\/e2e\/backend\.mjs/.test(l));
    lines[at] = lines[at].replace(' --env sandbox', '');
    const { findings } = checkCaptureConsentWiring(lines.join('\n'), PLATFORM_DB_ID);
    assert.deepEqual(
      findings.map((f) => `${f.rule} ${f.job} :${f.line}`),
      [`purge-platform-db capture-linux :${purge.line}`],
    );
  });

  test('🔴 a capture step without E2E_CONSENT_LEDGER is named, and so is its purge', () => {
    const lines = yml.split(/\r?\n/);
    const linux = workflowJobs(yml).find((j) => j.name === 'capture-linux');
    const capture = linux.steps.find((s) => CAPTURE_INVOCATION.test(s.text));
    const at = capture.envLine.E2E_CONSENT_LEDGER;
    assert.ok(at, 'capture-linux capture step carries no E2E_CONSENT_LEDGER to remove');
    const mutated = lines.filter((_, i) => i !== at - 1).join('\n');
    const { findings } = checkCaptureConsentWiring(mutated, PLATFORM_DB_ID);
    assert.deepEqual(
      findings.map((f) => `${f.rule} ${f.job}`),
      ['capture-ledger capture-linux', 'purge-ledger capture-linux'],
    );
    assert.equal(findings[0].line, capture.line);
  });
});

describe('capture-play-screenshots.mjs stamps its drive and refuses without a ledger', () => {
  const code = stripSourceComments(readFileSync(RUNNER, 'utf8'), '.mjs');

  test('imports the one stamp module and pushes the store-capture stamp onto the drive', () => {
    assert.match(code, /from\s+'\.\.\/e2e\/app-version-stamp\.mjs'/);
    assert.match(code, /appVersionDefine\(\s*\{\s*lane:\s*'store-capture',\s*live:\s*!PROOF\s*\}\s*\)/);
    assert.match(code, /defines\.push\(\s*\.\.\.STAMP_DEFINE\s*\)/);
    // One source for the value: the runner never spells its own APP_VERSION.
    assert.doesNotMatch(code, /['`]APP_VERSION=(?:cap|dev|rehearsal)/);
  });

  test('the logged drive command leaves APP_VERSION readable', () => {
    assert.match(code, /m\[2\] === 'APP_VERSION' \|\|/);
  });

  /** A bare env: only what node needs to start, the five posture-gate vars
   *  dummied past that gate, and nothing that looks like Actions. PATH is node's
   *  own directory, so neither chromedriver nor flutter can be found even if a
   *  refusal under test were missing; `--out` is a throwaway directory, so no
   *  pre-drive clean can reach the committed listing. */
  const bareRun = (extra) => {
    const out = mkdtempSync(join(tmpdir(), 'nk-lane-stamp-'));
    try {
      const env = { PATH: dirname(process.execPath) };
      for (const k of ['SystemRoot', 'TEMP', 'TMP']) if (process.env[k]) env[k] = process.env[k];
      for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'E2E_EMAIL', 'E2E_PASSWORD', 'E2E_TOKEN_HASH']) env[k] = 'x';
      Object.assign(env, extra);
      const r = spawnSync(process.execPath, [RUNNER, '--app', 'subscriptiontracker', '--out', out], {
        encoding: 'utf8',
        env,
        timeout: 120_000,
      });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };

  test('🔴 a live run with no stamp source REFUSES before chromedriver, naming APP_VERSION', () => {
    const r = bareRun({});
    assert.equal(r.code, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /needs an APP_VERSION stamp/);
    assert.match(r.stderr, /GITHUB_RUN_NUMBER/);
    assert.match(r.stderr, /STORE_CAPTURE_APP_VERSION/);
    assert.doesNotMatch(r.stdout, /^chromedriver:/m);
    assert.doesNotMatch(r.stdout, /^flutter /m);
  });

  test('🔴 a live run with a stamp but no E2E_CONSENT_LEDGER REFUSES, naming it', () => {
    const r = bareRun({ STORE_CAPTURE_APP_VERSION: 'rehearsal-1790000000' });
    assert.equal(r.code, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /needs E2E_CONSENT_LEDGER and it is not set/);
    assert.doesNotMatch(r.stdout, /^chromedriver:/m);
    assert.doesNotMatch(r.stdout, /^flutter /m);
  });

  test('the local rehearsal supplies both, and hands its purge the same ledger', () => {
    const reh = stripSourceComments(
      readFileSync(join(REPO, 'tooling', 'store', 'rehearse-capture-locally.mjs'), 'utf8'),
      '.mjs',
    );
    assert.match(reh, /const rehearsalStamp = `rehearsal-\$\{Math\.floor\(Date\.now\(\) \/ 1000\)\}`;/);
    assert.match(reh, /const consentLedger = join\(scratch, 'store-capture-consent\.json'\);/);
    assert.match(reh, /STORE_CAPTURE_APP_VERSION: rehearsalStamp,/);
    // The capture env and the purge env: the ledger twice, nothing else writes it.
    assert.equal((reh.match(/E2E_CONSENT_LEDGER: consentLedger,/g) ?? []).length, 2);
    // The purge targets the SANDBOX databases, as sandboxBackend() reads them
    // from the wrangler configs, and no production database id is in the file.
    assert.match(reh, /import \{ sandboxBackend, CaptureBackendRefused \} from '\.\/capture-backend\.mjs';/);
    assert.match(reh, /PLATFORM_D1_DATABASE_ID: SANDBOX\.platform\.sandboxIds\['d1:PLATFORM_DB'\],/);
    // The app's sandbox database is not handed over at all: purge.mjs resolves
    // it from E2E_APP_ID. The one database key the purge env sets is the
    // platform one, the consent switch.
    assert.deepEqual([...new Set(reh.match(/\b[A-Z][A-Z0-9_]*_D1_DATABASE_ID(?=:)/g) ?? [])], ['PLATFORM_D1_DATABASE_ID']);
    const production = [...productionD1Ids(sandboxBackend())];
    assert.equal(production.length, 2, `expected the two production D1 ids, read ${production.join(', ')}`);
    for (const id of production) assert.ok(!reh.includes(id), `the rehearsal names production database ${id}`);
    // What purge.mjs resolves beside a ledger is the `env.sandbox` block's
    // APP_DB, never the top level's: on a fixture, the synthetic sandbox id...
    const SBX_APP_DB = '44444444-4444-4444-8444-444444444444';
    const wrangler = JSON.stringify({
      d1_databases: [
        { binding: 'APP_DB', database_id: '55555555-5555-4555-8555-555555555555' },
        { binding: 'PLATFORM_DB', database_id: '66666666-6666-4666-8666-666666666666' },
      ],
      env: {
        sandbox: {
          d1_databases: [
            { binding: 'APP_DB', database_id: SBX_APP_DB },
            { binding: 'PLATFORM_DB', database_id: '77777777-7777-4777-8777-777777777777' },
          ],
        },
      },
    });
    const read = (rel) => {
      if (rel === 'services/subscriptiontracker-api/wrangler.jsonc') return wrangler;
      throw new Error(`the fixture has no ${rel}`);
    };
    assert.equal(backendOf('subscriptiontracker', { env: 'sandbox', read, appIds: ['subscriptiontracker'] }).appDb, SBX_APP_DB);
    // ...and on the real tree, an id that is not a production one.
    assert.ok(
      !production.includes(backendOf('subscriptiontracker', { env: 'sandbox' }).appDb),
      "the app's sandbox APP_DB resolves to a production database",
    );
    assert.match(reh, /E2E_APP_ID: APP,/);
    // The purge is still the one in `finally`, after the capture.
    assert.ok(reh.indexOf('STORE_CAPTURE_APP_VERSION: rehearsalStamp') < reh.indexOf("'purge the throwaway user'"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CAPTURE SUITE'S OWN CONTRACT — run 35483690951 (2026-09-20).
//
// That run captured all four phone frames and created all six subscriptions,
// then failed with "Multiple exceptions (2) were detected" and NOT ONE WORD of
// either exception in the 601-line step log. The cause is the channel gap the
// suite documents three times: FlutterError dumps through `debugPrint`, which
// under `flutter drive -d web-server` is the BROWSER's console. `reportData` is
// the one channel that reaches the host, so these limbs hold the suite to
// using it — and to chaining rather than swallowing, because a handler that
// ate the errors would turn that red run GREEN.
// ─────────────────────────────────────────────────────────────────────────────
describe('store_screenshots_test.dart reports its framework errors to the host', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const dart = stripSourceComments(readFileSync(SUITE, 'utf8'), '.dart');

  test('collects FlutterError details into binding.reportData', () => {
    assert.match(dart, /FlutterError\.onError\s*=/);
    assert.match(dart, /binding\.reportData\s*=/);
    assert.match(dart, /'flutterErrors'/);
  });

  test('CHAINS to the previous handler instead of swallowing the error', () => {
    // Without this call flutter_test never accumulates the details, the test
    // passes, and an unexamined set reaches a store listing.
    assert.match(dart, /previous\?\.call\(details\)/);
  });

  test('installs the reporter inside the test body, not in main()', () => {
    // TestWidgetsFlutterBinding.runTest ASSIGNS FlutterError.onError when the
    // test starts, so a handler installed in main() is overwritten before the
    // first widget builds and would report an empty list on a run with two
    // exceptions in it.
    const install = dart.indexOf('installErrorReporter()');
    const appMain = dart.indexOf('await app.main()');
    assert.ok(install !== -1, 'the suite never installs the error reporter');
    assert.ok(appMain !== -1, 'the suite never calls app.main()');
    assert.ok(install < appMain, 'the reporter is installed after app.main()');
  });

  test('restores the handler, as flutter_test requires of any changed global', () => {
    assert.match(dart, /restoreErrorReporter\(\)/);
  });
});

describe('store_screenshots_test.dart seeds a category per subscription', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const src = readFileSync(SUITE, 'utf8');
  const dart = stripSourceComments(src, '.dart');

  /** The seed table, parsed out of the source rather than grepped for: the
   *  category names also appear in the prose above it. */
  // ⏱ 2026-09-22 · THREE OR FOUR COLUMNS. The fourth is the renewal offset in
  // days, added so the six rows stop tying in `SubMath.upcoming`; the filter
  // takes either shape so this reader could re-base before the column landed.
  const rows = [...dart.matchAll(/<String>\[([^\]]*)\]/g)]
    .map((m) => m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')))
    .filter((r) => (r.length === 3 || r.length === 4) && /^\d+\.\d{2}$/.test(r[1]));

  test('every illustrative row carries a name, a price and a category', () => {
    assert.equal(rows.length, 6);
    for (const [name, price, category] of rows) {
      assert.ok(name.length > 0, `row ${name} has no name`);
      assert.ok(Number(price) > 0, `row ${name} has no price`);
      assert.ok(category.length > 0, `row ${name} has no category`);
    }
  });

  test('no row is left in the Other bucket the old listing showed', () => {
    // Insights rendered one slice reading "Other $93" on every published frame
    // because all six rows fell through to the sheet's _uncategorised fallback.
    for (const [name, , category] of rows) {
      assert.notEqual(category, 'Other', `${name} would still group as Other`);
    }
    assert.equal(new Set(rows.map((r) => r[2])).size, 6, 'categories are not distinct');
  });

  test('the renewal offsets are distinct, so the upcoming block never ties', () => {
    // ⏱ 2026-09-22. Every row used to keep the sheet's default renewal, so all
    // six tied on `daysUntil` and the order on screen was input order: append
    // order on phone, the server's order on tablet. The two viewports could
    // therefore list the same board differently, which is a listing defect no
    // count or total can see. Distinct offsets are what remove the tie.
    const offsets = rows.filter((r) => r.length === 4).map((r) => r[3]);
    assert.equal(offsets.length, 6, 'not every illustrative row carries a renewal offset');
    for (const o of offsets) assert.match(o, /^\d+$/, `offset "${o}" is not a whole number of days`);
    const days = offsets.map(Number);
    assert.equal(new Set(days).size, 6, 'two rows renew on the same day, so they tie in upcoming');
    // Nothing at 0 or 1: "Due today"/"tomorrow" are states this set does not
    // mean to photograph, and a 0 would also expire mid-drive.
    assert.ok(Math.min(...days) >= 2, 'an offset of 0 or 1 puts a Due today/tomorrow label in the frame');
    assert.ok(Math.min(...days) <= 5, 'no row is inside the accent window, so the frame shows only the muted state');
  });

  test('every category exists in the sheet vocabulary, which is DERIVED from the budget caps', () => {
    // add_subscription_sheet.dart builds its dropdown from
    // DemoData.budget().categories — so a cap rename silently removes a value
    // the suite still asks for, and the run fails at the dropdown.
    const demo = readFileSync(
      join(REPO, 'apps', 'subscriptiontracker', 'lib', 'data', 'seed', 'demo_data.dart'), 'utf8',
    );
    const vocabulary = [...demo.matchAll(/BudgetCap\('([^']+)'/g)].map((m) => m[1]);
    assert.ok(vocabulary.length >= 10, `read only ${vocabulary.length} budget caps`);
    for (const [name, , category] of rows) {
      assert.ok(vocabulary.includes(category), `"${category}" (${name}) is not an offered category`);
    }
  });

  test('the suite actually chooses the category in the sheet, with a reachability limb', () => {
    // ⏱ 2026-10-03: by KEY, never by type. The sheet builds a second
    // DropdownButtonFormField<String> (the currency, ST-E2), so a type finder
    // matches two fields and its findsOneWidget refuses a correct sheet.
    assert.match(dart, /final Finder categoryField = find\.byKey\(E2EKeys\.addCategory\);/);
    assert.doesNotMatch(dart, /find\.byType\(\s*DropdownButtonFormField<String>/);
    assert.match(dart, /find\.text\(row\[2\]\)\.hitTestable\(\)/);
    assert.match(dart, /ensureVisible\(categoryField\)/);
    // …and the key the suite finds is the one the sheet gives the category dropdown.
    const sheet = stripSourceComments(readFileSync(
      join(REPO, 'apps', 'subscriptiontracker', 'lib', 'features', 'add', 'add_subscription_sheet.dart'), 'utf8',
    ), '.dart');
    assert.match(sheet, /Widget _categoryField\([^)]*\)\s*\{[\s\S]*?_dropdown<String>\(\s*key: E2EKeys\.addCategory,/);
  });

  test('the seeding walk takes the pick step\'s "Add by hand" before it types (#1130)', () => {
    // Runs 36955800549, 36955811141 and 36955814987 reached Home and stopped
    // with "The add sheet did not open": since #1130 the FAB opens the
    // catalogue pick step, and `addName` is one tap further.
    const at = dart.indexOf('Future<void> addThroughSheet(List<String> row) async {');
    assert.ok(at !== -1, 'addThroughSheet is gone');
    const body = dart.slice(at);
    const fab = body.indexOf('await tester.tap(find.byKey(E2EKeys.fabAdd));');
    const byHand = body.indexOf('await tester.tap(byHand);');
    const typed = body.indexOf('await tester.enterText(find.byKey(E2EKeys.addName), row[0]);');
    assert.ok(fab !== -1 && byHand !== -1 && typed !== -1, 'the FAB, Add by hand and the name entry are not all in addThroughSheet');
    assert.ok(fab < byHand && byHand < typed, 'addThroughSheet does not go FAB -> Add by hand -> type the name, in that order');
    assert.match(body, /final Finder byHand = find\.byKey\(E2EKeys\.addByHand\);/);
    assert.match(body, /byHand\.hitTestable\(\),\s*findsOneWidget/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE VERDICT, AND THE ALLOWLIST THAT MUST NEVER BECOME A MUTE BUTTON.
//
// Run 35488534460 raised two exceptions and the reporter printed both. One is
// harness-side (a focus-traversal sort reading `rect` off an inactive Focus
// element during a flutter_test-synthesised didChangeViewFocus dispatch); the
// other was a REAL lane defect — TURNSTILE_SITE_KEY absent from a live web
// build (ADR 084) — and is fixed at the cause rather than allowlisted.
//
// These limbs hold the allowlist narrow: every entry carries a date, a why, and
// MORE THAN the assertion text, because "Cannot get renderObject of inactive
// element" is a real defect almost anywhere else in the tree.
// ─────────────────────────────────────────────────────────────────────────────
describe('store_screenshots_test.dart classifies exceptions instead of ignoring them', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const raw = readFileSync(SUITE, 'utf8');
  const dart = stripSourceComments(raw, '.dart');

  /** The allowlist, parsed out of the source as entries rather than grepped:
   *  every id and needle also appears in the prose that justifies it. */
  /** Every allowlist entry, read out of the typed `_Benign` list. Sliced by
   *  index rather than matched across fields: `stripSourceComments` blanks the
   *  long `why` comments between them, and a regex spanning that failed to
   *  match text that reads fine by eye. */
  const entryIds = [...dart.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  const fieldAfter = (id, field) => {
    const at = dart.indexOf(`id: '${id}'`);
    const m = new RegExp(`${field}: '([^']*)'`).exec(dart.slice(at));
    return m ? m[1] : null;
  };
  const needlesOfEntry = (id) => {
    const at = dart.indexOf(`id: '${id}'`);
    const from = dart.indexOf('needles: <String>[', at);
    const to = dart.indexOf(']', from);
    if (from === -1 || to === -1) return [];
    return [...dart.slice(from, to).matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };
  const entries = entryIds.map((id) => ({
    id,
    dated: fieldAfter(id, 'dated'),
    seenIn: fieldAfter(id, 'seenIn'),
    needles: needlesOfEntry(id),
  }));

  test('the allowlist is small and every entry is dated to a real run', () => {
    assert.ok(entries.length >= 1, 'the allowlist parsed as empty — the regex or the shape moved');
    assert.ok(entries.length <= 3, `${entries.length} benign entries is no longer an allowlist`);
    for (const e of entries) {
      assert.match(e.dated, /^\d{4}-\d{2}-\d{2}$/, `${e.id} has no ISO date`);
      assert.match(e.seenIn, /run \d+/, `${e.id} does not name the run it was seen in`);
    }
  });

  test('no entry matches on the assertion text alone', () => {
    // A signature of one sentence would suppress that sentence everywhere. Each
    // entry must also pin the framework PATH that makes it benign.
    for (const e of entries) {
      assert.ok(e.needles.length >= 3, `${e.id} has only ${e.needles.length} needle(s)`);
      assert.ok(
        e.needles.some((n) => n.includes('package:flutter')),
        `${e.id} pins no framework frame, so it would match the same words raised anywhere`,
      );
    }
  });

  test('the focus-traversal entry pins the harness frame that makes it harness-side', () => {
    const focus = entries.find((e) => e.id === 'focus-traversal-inactive-element');
    assert.ok(focus, 'the entry for run 35488534460 exception 1 is gone');
    // flutter_test/src/window.dart in the stack IS the claim: the view-focus
    // event is synthesised by the test binding, not by the app.
    assert.ok(focus.needles.includes('package:flutter_test/src/window.dart'));
    assert.ok(focus.needles.includes('WidgetsBindingObserver.didChangeViewFocus'));
    assert.ok(focus.needles.includes('Cannot get renderObject of inactive element'));
  });

  test('an UNMATCHED exception is still forwarded, and still fails the run', () => {
    // The forward is the whole verdict mechanism; a blanket suppression would
    // be this line without the condition.
    assert.match(dart, /if\s*\(id == null\)\s*previous\?\.call\(details\)/);
    assert.match(dart, /expect\(\s*unmatched,\s*isEmpty/);
  });

  test('a benign match is recorded and reported, never merely dropped', () => {
    assert.match(dart, /flutterErrors\.add\(text\)/);
    assert.match(dart, /'verdict'/);
  });

  test('the timeline marks every captured frame, so WHEN an error fired is readable', () => {
    // Order alone cannot say whether an exception preceded a capture; that is
    // the question run 35488534460's report could not answer about itself.
    assert.equal((dart.match(/markFrame\('/g) ?? []).length, 4);
    assert.match(dart, /FRAME \$frame written/);
  });
});

describe('the capture lane passes the captcha site key ADR 084 requires', () => {
  const runner = stripSourceComments(
    readFileSync(join(REPO, 'tooling', 'store', 'capture-play-screenshots.mjs'), 'utf8'), '.mjs',
  );
  const yml = readFileSync(
    join(REPO, '.github', 'workflows', 'store-screenshots.yml'), 'utf8',
  ).split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

  test('the runner refuses a LIVE WEB capture with no TURNSTILE_SITE_KEY', () => {
    assert.match(runner, /pass\('TURNSTILE_SITE_KEY'\)/);
    // 🔴 `&& !NATIVE` SINCE 2026-09-22, AND THE TEST SAYS SO RATHER THAN
    // LOOSENING. TurnstileGate renders in the WEB build; the desktop and Apple
    // builds sign in without it, so requiring the variable on a native drive
    // would refuse a run over a gate that build does not have — the mirror of
    // the defect this refusal was added for. Written as the exact condition, so
    // widening the exemption to, say, every non-Play channel is still red.
    assert.match(runner, /else if \(!PROOF && !NATIVE\)/);
  });

  test('--proof is exempt, because a demo build has no captcha posture to get wrong', () => {
    // TurnstileGate.postureFor: not backend-live => notOnThisChannel, inert.
    assert.match(runner, /if \(process\.env\.TURNSTILE_SITE_KEY\) pass\('TURNSTILE_SITE_KEY'\)/);
  });

  test('the workflow supplies it as a VARIABLE and fails closed, like e2e.yml', () => {
    // 🔴 BOTH OCCURRENCES, COUNTED — AND A MUTATION PROVED WHY. The first
    // version of this limb was `assert.match(...)`, which passes on ANY one
    // hit. The variable is referenced twice on purpose: once by the preflight
    // step that fails closed, and once by the `Capture the set` step whose env
    // actually reaches the build. Blanking only the second leaves a run whose
    // preflight says the key is present and whose build never receives it —
    // exactly the state this whole increment exists to remove — and the
    // `match` form went GREEN on that mutation.
    const refs = yml.match(/TURNSTILE_SITE_KEY: \$\{\{ vars\.TURNSTILE_SITE_KEY \}\}/g) ?? [];
    assert.equal(refs.length, 2, `expected the preflight and capture steps to reference it; found ${refs.length}`);
    assert.match(yml, /if \[ -z "\$TURNSTILE_SITE_KEY" \]; then/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SIGNATURE, RUN AGAINST THE REAL BYTES IT WAS WRITTEN FROM.
//
// The limbs above assert the allowlist's SHAPE. These run its actual needles
// over the two exceptions run 35488534460 really raised, captured verbatim from
// that run's `flutterErrors` into fixtures/. That is the difference between "the
// entry has enough needles" and "the entry matches the thing it names and
// nothing else" — and it is the closest a Node test can get to the Dart
// classifier without driving a browser.
//
// ⚠️ WHAT IT STILL CANNOT PROVE: that the handler FORWARDS the unmatched one at
// runtime. That limb is structural (`if (id == null) previous?.call(details)`)
// and its real proof is the next capture run.
// ─────────────────────────────────────────────────────────────────────────────
describe('the benign signature separates the two exceptions run 35488534460 raised', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const dart = stripSourceComments(readFileSync(SUITE, 'utf8'), '.dart');
  const FIX = join(REPO, 'tooling', 'ci', 'test', 'fixtures', 'store-shots-run-35488534460');
  const focusText = readFileSync(join(FIX, 'exception-1-focus-traversal.txt'), 'utf8');
  const turnstileText = readFileSync(join(FIX, 'exception-2-turnstile.txt'), 'utf8');

  /** The classifier, in the one form a Node test can apply: every needle must
   *  appear. Mirrors `benignId` in the suite. */
  const needlesOf = (id) => {
    const at = dart.indexOf(`id: '${id}'`);
    assert.notEqual(at, -1, `no allowlist entry with id ${id}`);
    const from = dart.indexOf('needles: <String>[', at);
    const to = dart.indexOf(']', from);
    assert.ok(from !== -1 && to !== -1, `entry ${id} has no needles list`);
    return [...dart.slice(from, to).matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };
  const matches = (needles, text) => needles.every((n) => text.includes(n));

  test('it MATCHES the focus-traversal exception it was written for', () => {
    assert.equal(matches(needlesOf('focus-traversal-inactive-element'), focusText), true);
  });

  test('it does NOT match the turnstile exception — that one was fixed at the cause', () => {
    // ADR 084's misconfiguration is a real lane defect, not framework noise:
    // the fix is passing vars.TURNSTILE_SITE_KEY, not an allowlist entry.
    assert.equal(matches(needlesOf('focus-traversal-inactive-element'), turnstileText), false);
  });

  test('the fixture really is the harness path, not an app path', () => {
    // The two frames that carry the whole "cannot reach the pixels" argument.
    assert.match(focusText, /flutter_test\/src\/window\.dart .* \[_handleViewFocusChanged\]/);
    assert.match(focusText, /focus_traversal\.dart .* findFirstFocus/);
    // And it is reported, not rethrown: the widgets library caught it.
    assert.match(focusText, /^Exception caught by widgets library/);
  });

  test('no allowlist entry matches the turnstile exception at all', () => {
    const ids = [...dart.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    for (const id of ids) {
      assert.equal(
        matches(needlesOf(id), turnstileText), false,
        `entry ${id} would suppress the ADR 084 misconfiguration, which is a real defect`,
      );
    }
  });
});

describe('a failed capture keeps its frames for diagnosis', () => {
  const yml = readFileSync(
    join(REPO, '.github', 'workflows', 'store-screenshots.yml'), 'utf8',
  );
  const steps = yml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

  test('failure() uploads the frames under a name that cannot be mistaken for the set', () => {
    assert.match(steps, /if: failure\(\)/);
    assert.match(steps, /name: FAILED-not-a-listing-set-/);
    // The success artifact keeps its own name, so nothing downstream that
    // looks for the real set can ever be handed unvetted bytes.
    // ⏱ 2026-09-26: the set is named for the gate's checked app (O-STORE-LANES-HARD-WIRE-ONE-APP).
    assert.match(steps, /name: play-screenshots-\$\{\{ needs\.gate\.outputs\.app \}\}/);
  });

  test('the diagnostic upload never masks an earlier failure with its own', () => {
    // A run that died before the drive has no frames; `error` there would
    // replace the real cause with "no files found".
    assert.match(steps, /if-no-files-found: ignore/);
    // The real set still fails closed when it is empty.
    assert.match(steps, /if-no-files-found: error/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-24 — O-DESKTOP-CAPTURE-HAS-NO-SHUTTER. A desktop drive is told the
// geometry its layer shutter imposes and checks (STORE_CAPTURE_VIEW); a web or
// simulator drive is told none, and the suite refuses one there. Behavioural by
// import, then ONE structural check that the runner's native arm is where the
// pair is spread: a helper nobody spreads is the present-and-unused failure the
// launch-define describe above exists for.
// ─────────────────────────────────────────────────────────────────────────────
describe('a desktop capture is told its geometry, and only a desktop capture', () => {
  test('storeViewDefineArgs emits the two-token STORE_CAPTURE_VIEW pair for linux', () => {
    assert.deepEqual(
      storeViewDefineArgs({ flutterDevice: 'linux', cssWidth: 1280, cssHeight: 800, dpr: 2 }),
      ['--dart-define', 'STORE_CAPTURE_VIEW=1280x800@2'],
    );
  });

  test('storeViewDefineArgs emits the same pair for windows', () => {
    assert.deepEqual(
      storeViewDefineArgs({ flutterDevice: 'windows', cssWidth: 1280, cssHeight: 800, dpr: 2 }),
      ['--dart-define', 'STORE_CAPTURE_VIEW=1280x800@2'],
    );
  });

  test('storeViewDefineArgs emits the same pair for macos', () => {
    assert.deepEqual(
      storeViewDefineArgs({ flutterDevice: 'macos', cssWidth: 1280, cssHeight: 800, dpr: 2 }),
      ['--dart-define', 'STORE_CAPTURE_VIEW=1280x800@2'],
    );
  });

  test('storeViewDefineArgs emits nothing for an iOS simulator, which photographs through the plugin', () => {
    assert.deepEqual(
      storeViewDefineArgs({ flutterDevice: 'iPhone 17 Pro Max', cssWidth: 440, cssHeight: 956, dpr: 3 }),
      [],
    );
  });

  test('storeViewDefineArgs emits nothing for a web capture (flutterDevice null)', () => {
    assert.deepEqual(storeViewDefineArgs({ flutterDevice: null, cssWidth: 360, cssHeight: 640, dpr: 3 }), []);
  });

  test('the runner spreads it into the NATIVE drive arm, and the web arm carries none', () => {
    const code = stripSourceComments(readFileSync(RUNNER, 'utf8'), '.mjs');
    const nativeAt = code.indexOf('const args = NATIVE');
    assert.notEqual(nativeAt, -1, 'the runner no longer builds `const args = NATIVE ? … : …`');
    const webAt = code.indexOf(': [', nativeAt);
    assert.notEqual(webAt, -1, 'the web arm `: [` after `const args = NATIVE` is gone');
    const webEnd = code.indexOf('];', webAt);
    assert.match(code.slice(nativeAt, webAt), /\.\.\.storeViewDefineArgs\(cap\)/);
    assert.doesNotMatch(code.slice(webAt, webEnd), /storeViewDefineArgs/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L-PIN — the capture binary is pinned to the host it was given (F1, row
// O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS). A capture handed a sandbox
// API_BASE_URL still wrote to production: apiClientProvider preferred the
// config document's apiBaseUrl, and under SKIP_REMOTE_CONFIG that document is
// the compiled seed, which names the production API. The decision is now
// apiBaseFor (proved both ways by test/api_base_pin_test.dart); these two
// source reads hold the provider to calling it and the harness to refusing an
// unpinned build that can reach an API.
// ─────────────────────────────────────────────────────────────────────────────
describe('the capture binary is pinned to the host it was given (F1)', () => {
  test('L-PIN: apiClientProvider decides its host through apiBaseFor, never `cfg?.apiBaseUrl ??`', () => {
    const PROVIDER = join(
      REPO, 'apps', 'subscriptiontracker', 'lib', 'state', 'providers', 'subscriptions.dart',
    );
    const code = stripSourceComments(readFileSync(PROVIDER, 'utf8'), '.dart');
    const start = code.indexOf('apiClientProvider = Provider<ApiClient>');
    assert.notEqual(start, -1, 'subscriptions.dart no longer declares apiClientProvider = Provider<ApiClient>');
    const end = code.indexOf('});', start);
    assert.notEqual(end, -1, 'the apiClientProvider body has no closing `});`');
    const body = code.slice(start, end);
    assert.match(body, /apiBaseFor\(/);
    assert.doesNotMatch(body, /cfg\?\.apiBaseUrl\s*\?\?/);
  });

  test('L-PIN: the harness refuses an API-reaching build that was not given the pin', () => {
    const SUITE = join(
      REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
    );
    const dart = stripSourceComments(readFileSync(SUITE, 'utf8'), '.dart');
    assert.match(dart, /AppConfig\.pinnedBackend\s*\|\|\s*!AppConfig\.isApiConfigured/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A DRY RUN OPENS NO PULL REQUEST, AND EVERY CAPTURE JOB PRECHECKS ITS APP FIRST
// (O-SCREENSHOT-DRIVER-IS-ONE-APPS, 2026-09-26).
//
// "A dry run opens no pull request" is a property of the `if:` lines, and nothing
// short of a dispatch can observe it; a dispatch is the parent's act, never a
// test's. So this reads those lines: every step that pushes a branch or opens a
// pull request is `if: ${{ !inputs.dry_run }}`; the success upload is gated the
// same way, and one sibling upload gated `${{ inputs.dry_run }}` carries the set as
// dry-run-<channel>-<app> from the same paths. And each capture job's first step
// after checkout runs capture-precheck.mjs on the app and the channel that job
// captures, with no `if:` of its own.
//
// Read through workflow-scan.mjs, the one workflow parse (comments blanked, `run: |`
// joined), because the lane's prose names every command this looks for. Each
// mutation is written to a temporary root and parsed from there.
// ─────────────────────────────────────────────────────────────────────────────
const LANE_REL = '.github/workflows/store-screenshots.yml';
const NOT_DRY = '${{ !inputs.dry_run }}';
const DRY = '${{ inputs.dry_run }}';
const PR_WRITE = /(?:^|\s)(?:gh\s+pr\s+create|git\s+push)(?=\s|$)/;
const PRECHECK_CALL = /(?:^|\s)node\s+tooling\/store\/capture-precheck\.mjs(?=\s|$)/;
const UPLOAD_ACTION = /^actions\/upload-artifact@/;
const NON_SUCCESS_IF = /(?:failure|always|cancelled)\s*\(\s*\)/;
const flagOf = (seg, name) => {
  const m = seg.match(new RegExp(`(?:^|\\s)${name}(?:=|\\s+)(\\S+)`));
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : null;
};
const condOf = (s) => (s.cond === null ? null : s.cond.replace(/\s+/g, ' ').trim());

/** The dry-run and precheck contract over a parsed lane. Pure. */
function checkDryRunLane(wf) {
  const findings = [];
  const census = { prSteps: [], uploadPairs: [], prechecks: [] };
  const find = (rule, job, line, msg) => findings.push({ rule, job, line, msg });

  const head = wf.lines.slice(0, wf.jobsAt ?? wf.lines.length);
  const at = head.findIndex((l) => /^ {6}dry_run:\s*$/.test(l.text));
  if (at === -1) {
    find('dry-run-input', null, null, 'on.workflow_dispatch.inputs declares no dry_run');
  } else {
    const body = [];
    for (let i = at + 1; i < head.length && (head[i].text.trim() === '' || /^ {8}\S/.test(head[i].text)); i++) body.push(head[i].text.trim());
    for (const want of ['type: boolean', 'default: false', 'required: false']) {
      if (!body.includes(want)) find('dry-run-input', null, head[at].n, `the dry_run input at :${head[at].n} does not say \`${want}\``);
    }
  }

  for (const job of wf.jobs.values()) {
    const steps = workflowSteps(job);
    const capture = steps.find((s) => s.run && CAPTURE_INVOCATION.test(s.run.text));
    if (!capture) continue;
    const env = jobEnv(job);
    const bound = (v) => (v !== null && /^\$\{?STORE_CHANNEL\}?$/.test(v) ? (env.get('STORE_CHANNEL')?.value ?? v) : v);
    const captureSeg = shellSegments(capture.run.text).find((x) => CAPTURE_INVOCATION.test(x));
    const channel = bound(flagOf(captureSeg, '--channel')) ?? 'android-play';

    for (const s of steps) {
      if (!s.run || !shellSegments(s.run.text).some((x) => PR_WRITE.test(x))) continue;
      census.prSteps.push(job.name);
      if (condOf(s) !== NOT_DRY) {
        find('pr-step-ungated', job.name, s.first, `job ${job.name}: the step at :${s.first} pushes a branch or opens a pull request under \`if: ${s.cond ?? '(none)'}\`, not \`if: ${NOT_DRY}\``);
      }
    }

    const uploads = steps.filter((s) => s.uses && UPLOAD_ACTION.test(s.uses) && !NON_SUCCESS_IF.test(s.cond ?? ''));
    const real = uploads.filter((s) => condOf(s) === NOT_DRY);
    const dry = uploads.filter((s) => condOf(s) === DRY);
    for (const s of uploads.filter((u) => !real.includes(u) && !dry.includes(u))) {
      find('upload-ungated', job.name, s.first, `job ${job.name}: the set upload at :${s.first} is \`if: ${s.cond ?? '(none)'}\`, neither ${NOT_DRY} nor ${DRY}`);
    }
    if (real.length !== 1 || dry.length !== 1) {
      find('upload-pair', job.name, capture.first, `job ${job.name}: ${real.length} set upload(s) under ${NOT_DRY} and ${dry.length} under ${DRY}, where the lane needs one of each`);
    } else {
      census.uploadPairs.push(job.name);
      const want = `dry-run-${channel}-\${{ needs.gate.outputs.app }}`;
      const name = dry[0].with.get('name')?.value ?? null;
      if (name !== want) find('dry-run-name', job.name, dry[0].first, `job ${job.name}: the dry-run upload at :${dry[0].first} is named ${name ?? '(none)'}, not ${want}`);
      const a = real[0].with.get('path')?.value ?? null;
      const b = dry[0].with.get('path')?.value ?? null;
      if (a === null || a !== b) find('dry-run-paths', job.name, dry[0].first, `job ${job.name}: the dry-run upload at :${dry[0].first} uploads ${JSON.stringify(b)}, and the set upload at :${real[0].first} uploads ${JSON.stringify(a)}`);
    }

    const checkoutAt = steps.findIndex((s) => s.uses && /^actions\/checkout@/.test(s.uses));
    const next = checkoutAt === 0 ? (steps[1] ?? null) : null;
    const seg = next?.run ? shellSegments(next.run.text).find((x) => PRECHECK_CALL.test(x)) : undefined;
    if (seg === undefined) {
      find('precheck-first', job.name, next?.first ?? capture.first, `job ${job.name}: the step after checkout does not run tooling/store/capture-precheck.mjs`);
      continue;
    }
    census.prechecks.push(job.name);
    if (next.cond !== null) find('precheck-if', job.name, next.first, `job ${job.name}: the precheck at :${next.first} carries \`if: ${next.cond}\``);
    if (flagOf(seg, '--app') !== flagOf(captureSeg, '--app')) {
      find('precheck-app', job.name, next.first, `job ${job.name}: the precheck at :${next.first} checks --app ${flagOf(seg, '--app')}, and the capture at :${capture.first} drives --app ${flagOf(captureSeg, '--app')}`);
    }
    if (bound(flagOf(seg, '--channel')) !== channel) {
      find('precheck-channel', job.name, next.first, `job ${job.name}: the precheck at :${next.first} checks --channel ${flagOf(seg, '--channel')}, and the job captures ${channel}`);
    }
  }
  return { census, findings };
}

/** The lane text, parsed from a temporary root (ADR 072). */
function parseLaneText(text) {
  const root = mkdtempSync(join(tmpdir(), 'nk-lane-dry-run-'));
  try {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, LANE_REL), text);
    return parseWorkflow(root, LANE_REL);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('store-screenshots.yml: a dry run opens no pull request, and each job prechecks its app first', () => {
  const yml = readFileSync(join(REPO, LANE_REL), 'utf8');
  const lane = parseWorkflow(REPO, LANE_REL);
  const real = checkDryRunLane(lane);
  const JOBS = ['capture', 'capture-linux', 'capture-desktop-native', 'capture-ios'];
  /** The file line (1-based) of the first line at or after `from` matching `re`. */
  const lineOf = (re, from = 1) => yml.split('\n').findIndex((l, i) => i >= from - 1 && re.test(l)) + 1;
  const job = (name) => lane.jobs.get(name);
  const stepNamed = (jobName, re) => workflowSteps(job(jobName)).find((s) => re.test(s.name ?? ''));

  test('the lane holds the contract, in all four capture jobs', () => {
    assert.deepEqual(real.findings.map((f) => f.msg), []);
    // Pinned by NAME: a job that stopped matching would shrink the census and pass every rule over less.
    assert.deepEqual(real.census.prSteps, JOBS);
    assert.deepEqual(real.census.uploadPairs, JOBS);
    assert.deepEqual(real.census.prechecks, JOBS);
  });

  test('🔴 the Snap pull-request step without its dry-run gate is named, with its line', () => {
    const propose = stepNamed('capture-linux', /^Propose the set/);
    const gate = lineOf(/^ {8}if: \$\{\{ !inputs\.dry_run \}\}$/, propose.first);
    assert.ok(gate > propose.first && gate <= propose.last, `capture-linux's propose step at :${propose.first} carries no dry-run gate to remove`);
    const lines = yml.split('\n');
    lines.splice(gate - 1, 1);
    const { findings } = checkDryRunLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job} :${f.line}`), [`pr-step-ungated capture-linux :${propose.first}`]);
  });

  test('🔴 a Play set upload with its dry-run gate removed is named twice: ungated, and the pair broken', () => {
    const upload = stepNamed('capture', /^Upload the screenshot set$/);
    const gate = lineOf(/^ {8}if: \$\{\{ !inputs\.dry_run \}\}$/, upload.first);
    assert.ok(gate > upload.first && gate <= upload.last, 'the Play set upload carries no dry-run gate to remove');
    const lines = yml.split('\n');
    lines.splice(gate - 1, 1);
    const { findings } = checkDryRunLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job}`), ['upload-ungated capture', 'upload-pair capture']);
  });

  test('🔴 a Play dry-run upload one directory short is named', () => {
    const dry = stepNamed('capture', /^Upload the DRY-RUN screenshot set$/);
    const tablet = lineOf(/^ {12}apps\/\$\{\{ needs\.gate\.outputs\.app \}\}\/store\/android-play\/screenshots-tablet\/$/, dry.first);
    assert.ok(tablet > dry.first && tablet <= dry.last, 'the Play dry-run upload names no tablet directory to remove');
    const lines = yml.split('\n');
    lines.splice(tablet - 1, 1);
    const { findings } = checkDryRunLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job} :${f.line}`), [`dry-run-paths capture :${dry.first}`]);
  });

  test('🔴 a desktop dry-run artifact named for one store instead of the dispatched channel is named', () => {
    const dry = stepNamed('capture-desktop-native', /^Upload the DRY-RUN screenshot set$/);
    const at = lineOf(/^ {10}name: dry-run-\$\{\{ inputs\.channel \}\}-/, dry.first);
    assert.ok(at > dry.first && at <= dry.last, 'the desktop dry-run upload has no channel-named artifact to mutate');
    const lines = yml.split('\n');
    lines[at - 1] = lines[at - 1].replace('dry-run-${{ inputs.channel }}-', 'dry-run-windows-store-');
    const { findings } = checkDryRunLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job} :${f.line}`), [`dry-run-name capture-desktop-native :${dry.first}`]);
  });

  test('🔴 an iOS job whose precheck is gone is named', () => {
    const pre = stepNamed('capture-ios', /^Precheck/);
    assert.ok(pre, 'capture-ios has no precheck step to remove');
    const lines = yml.split('\n');
    lines.splice(pre.first - 1, pre.last - pre.first + 1);
    const { findings } = checkDryRunLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job}`), ['precheck-first capture-ios']);
  });

  test('🔴 a Snap precheck of the wrong channel is named', () => {
    const pre = stepNamed('capture-linux', /^Precheck/);
    const lines = yml.split('\n');
    const at = lineOf(/--channel linux-snap$/, pre.first);
    assert.ok(at >= pre.first && at <= pre.last, 'capture-linux\'s precheck names no --channel linux-snap to mutate');
    lines[at - 1] = lines[at - 1].replace('--channel linux-snap', '--channel android-play');
    const { findings } = checkDryRunLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job} :${f.line}`), [`precheck-channel capture-linux :${pre.first}`]);
  });

  test('🔴 a dry_run input that defaults to true is named', () => {
    const at = lineOf(/^ {6}dry_run:\s*$/);
    const def = lineOf(/^ {8}default: false$/, at);
    assert.ok(at > 0 && def > at, 'the lane declares no dry_run default to mutate');
    const lines = yml.split('\n');
    lines[def - 1] = lines[def - 1].replace('default: false', 'default: true');
    const { findings } = checkDryRunLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => f.rule), ['dry-run-input']);
    assert.match(findings[0].msg, /does not say `default: false`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CAPTURE SIGNS IN WITH THE ONE-TIME TOKEN, NEVER THE CAPTCHA FORM
// (2026-09-28, after Store screenshots run 36315636919).
//
// The Play capture of run 36315636919 typed the provisioned password into the
// login form, and the production auth box refused it `captcha_failed`: the
// password grant is Turnstile-gated and a headless driver has no captcha token.
// The nightly e2e had already moved to the single-use magic-link token its
// provision step mints; the capture job minted the same token and never spent
// it. These limbs hold the capture to the e2e's path, through ONE helper, and
// red the day it goes back to the form:
//   · the helper is declared once, in integration_test/magic_link_sign_in.dart,
//     and both suites import it — neither declares its own;
//   · the capture suite reads E2E_TOKEN_HASH and no E2E_PASSWORD, its
//     `if (AppConfig.isBackendLive)` branch spends the token, and every
//     login-form key it still touches sits in that branch's `else` — a demo build;
//   · the runner requires the token, mints each later drive's through the one
//     minter provision_user.mjs also calls, and deletes the service-role key
//     from its env before its first child process;
//   · every capture job hands its capture step the provision step's token.
// Each limb is a pure function over TEXT, so every red case below mutates the
// real file's text, never a hand-built fixture.
// ─────────────────────────────────────────────────────────────────────────────
const SIGN_IN = {
  capture: 'apps/subscriptiontracker/integration_test/store_screenshots_test.dart',
  e2e: 'apps/subscriptiontracker/integration_test/app_test.dart',
  helper: 'apps/subscriptiontracker/integration_test/magic_link_sign_in.dart',
  runner: 'tooling/store/capture-play-screenshots.mjs',
  provision: 'tooling/e2e/provision_user.mjs',
  minter: 'tooling/e2e/magic_link.mjs',
  lane: '.github/workflows/store-screenshots.yml',
};
const readSignIn = () => Object.fromEntries(Object.entries(SIGN_IN).map(([k, rel]) => [k, readFileSync(join(REPO, rel), 'utf8')]));

const HELPER_DECL = /\bFuture<bool>\s+signInWithMagicToken\s*\(/g;
const HELPER_IMPORT = /^import\s+'magic_link_sign_in\.dart';/m;
const LOGIN_KEY = /\bE2EKeys\.login(?:Email|Password|Submit)\b/g;
const PROVISION_STEP = /\bnode tooling\/e2e\/provision_user\.mjs\b/;
const RUNNER_MINTER_IMPORT = /import\s*\{[^}]*\bmintMagicLinkTokenHash\b[^}]*\}\s*from\s*'\.\.\/e2e\/magic_link\.mjs'/;
const PROVISION_MINTER_IMPORT = /import\s*\{[^}]*\bmintMagicLinkTokenHash\b[^}]*\}\s*from\s*'\.\/magic_link\.mjs'/;
const LATER_DRIVE_MINT =
  /if\s*\([^)]*\bdriveIndex > 0\b[^)]*\)\s*\{\s*defines\[tokenAt\] = `E2E_TOKEN_HASH=\$\{await nextSignInToken\(cap\)\}`;/;

/** The `{…}` block whose `{` is at [open], as [open, close]; null if unclosed. */
function braceBlock(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return [open, i];
  }
  return null;
}

/** Every `if (AppConfig.isBackendLive) {…} else {…}` in [bare] — comments AND
 *  string literals blanked, offsets kept, so a brace in a string cannot
 *  unbalance a block. */
function liveBranches(bare) {
  const out = [];
  for (const m of bare.matchAll(/\bif\s*\(\s*AppConfig\.isBackendLive\s*\)\s*\{/g)) {
    const then = braceBlock(bare, m.index + m[0].length - 1);
    if (!then) continue;
    const e = /^\s*else\s*\{/.exec(bare.slice(then[1] + 1));
    out.push({ then, els: e ? braceBlock(bare, then[1] + e[0].length) : null });
  }
  return out;
}

const lineAt = (text, i) => text.slice(0, i).split('\n').length;

/** The sign-in contract over the seven files' text. Pure. */
function captureSignInFindings(t) {
  const findings = [];
  const add = (rule, msg) => findings.push({ rule, msg });
  const dart = (src) => stripSourceComments(src, '.dart');
  const capture = dart(t.capture);
  const bare = stripStringLiterals(capture);

  // ONE helper, imported by both suites.
  const declared = (src) => (dart(src).match(HELPER_DECL) ?? []).length;
  if (declared(t.helper) !== 1) add('one-helper', `${SIGN_IN.helper} declares signInWithMagicToken ${declared(t.helper)} time(s), not once`);
  for (const k of ['capture', 'e2e']) {
    if (declared(t[k]) !== 0) add('one-helper', `${SIGN_IN[k]} declares its own signInWithMagicToken: a fork of the shared helper`);
    if (!HELPER_IMPORT.test(dart(t[k]))) add('one-helper', `${SIGN_IN[k]} does not import 'magic_link_sign_in.dart'`);
  }

  // The capture suite reads the token, and no password.
  if (!/String\.fromEnvironment\(\s*'E2E_TOKEN_HASH'\s*\)/.test(capture)) add('token-define', `${SIGN_IN.capture} reads no E2E_TOKEN_HASH define`);
  if (/fromEnvironment\(\s*'E2E_PASSWORD'\s*\)/.test(capture)) {
    add('no-password', `${SIGN_IN.capture} reads E2E_PASSWORD: a live build would carry a password to type into the captcha-gated form`);
  }

  // The live branch spends the token; the form lives only in its `else`.
  const spend = liveBranches(bare).find(({ then }) => /\bsignInWithMagicToken\(\s*tester\s*,\s*tokenHash\b/.test(capture.slice(then[0], then[1])));
  if (!spend) add('token-live', `no if (AppConfig.isBackendLive) branch of ${SIGN_IN.capture} calls signInWithMagicToken(tester, tokenHash, …)`);
  for (const m of capture.matchAll(LOGIN_KEY)) {
    const inDemo = spend?.els && m.index > spend.els[0] && m.index < spend.els[1];
    if (!inDemo) {
      add('form-live', `${SIGN_IN.capture}:${lineAt(capture, m.index)} touches ${m[0]} outside the demo (else) branch of the live token sign-in: a live build would go back to the captcha-gated form`);
    }
  }

  // The runner: requires the token, mints through the one minter, drops the key.
  const runner = stripSourceComments(t.runner, '.mjs');
  const need = /\bconst need = \[([^\]]*)\]/.exec(runner);
  if (!need || !/'E2E_TOKEN_HASH'/.test(need[1])) add('runner-need', `${SIGN_IN.runner}'s posture gate \`need\` does not require E2E_TOKEN_HASH`);
  if (!RUNNER_MINTER_IMPORT.test(runner)) add('runner-mint', `${SIGN_IN.runner} does not import mintMagicLinkTokenHash from ../e2e/magic_link.mjs`);
  if (!LATER_DRIVE_MINT.test(runner)) add('runner-mint', `${SIGN_IN.runner} does not hand each drive after the first a freshly minted E2E_TOKEN_HASH`);
  // chromedriverPath() is the first call that starts a child (its PATH probe).
  const dropAt = runner.indexOf('delete process.env.SUPABASE_SERVICE_ROLE_KEY;');
  const firstChildAt = runner.indexOf('chromedriverPath();');
  if (dropAt === -1 || firstChildAt === -1 || dropAt > firstChildAt) {
    add('runner-key', `${SIGN_IN.runner} does not delete SUPABASE_SERVICE_ROLE_KEY from its env before its first child process`);
  }

  // One request: the minter makes it, provision_user calls the minter.
  const minter = stripSourceComments(t.minter, '.mjs');
  const provision = stripSourceComments(t.provision, '.mjs');
  if ((minter.match(/\/auth\/v1\/admin\/generate_link/g) ?? []).length !== 1) add('one-minter', `${SIGN_IN.minter} does not make the generate_link request exactly once`);
  if (/generate_link/.test(provision) || !PROVISION_MINTER_IMPORT.test(provision)) {
    add('one-minter', `${SIGN_IN.provision} mints its token itself rather than through ./magic_link.mjs`);
  }

  // Every capture step is handed the provision step's token.
  const jobs = [];
  for (const job of workflowJobs(t.lane)) {
    const cap = job.steps.find((st) => CAPTURE_INVOCATION.test(st.text));
    if (!cap) continue;
    jobs.push(job.name);
    const out = /^\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.token_hash\s*\}\}$/.exec(cap.env.E2E_TOKEN_HASH ?? '');
    const provisioned =
      out && job.steps.some((st) => st.line < cap.line && PROVISION_STEP.test(st.text) && new RegExp(`^ {8}id: ${out[1]}\\s*$`, 'm').test(st.text));
    if (!provisioned) {
      add('workflow-token', `job ${job.name}: the capture step at :${cap.line} carries E2E_TOKEN_HASH=${cap.env.E2E_TOKEN_HASH ?? '(unset)'}, not an earlier provision_user.mjs step's token_hash`);
    }
  }
  return { findings, jobs, loginKeys: [...capture.matchAll(LOGIN_KEY)].length, spend: Boolean(spend) };
}

describe('the capture signs in with the one-time token, never the captcha form', () => {
  const real = readSignIn();
  const rules = (t) => captureSignInFindings(t).findings.map((f) => f.rule);
  /** The real texts with ONE file's text replaced, asserting the edit took. */
  const mutated = (key, fn) => {
    const after = fn(real[key]);
    assert.notEqual(after, real[key], `the mutation of ${SIGN_IN[key]} changed nothing — the case would pass vacuously`);
    return { ...real, [key]: after };
  };

  test('GREEN CONTROL · one helper, a live token branch, the form only in the demo branch, all four jobs handed the token', () => {
    const r = captureSignInFindings(real);
    assert.deepEqual(r.findings, []);
    assert.ok(r.spend, 'the live token branch was not found');
    // Pinned by name, so a census that shrank cannot pass over less.
    assert.deepEqual(r.jobs, ['capture', 'capture-linux', 'capture-desktop-native', 'capture-ios']);
    assert.ok(r.loginKeys >= 3, `the demo branch touches ${r.loginKeys} login key(s); email, password and submit are expected there`);
  });

  test('🔴 the live branch going back to the form is named, with its line', () => {
    const t = mutated('capture', (s) =>
      s.replace('await signInWithMagicToken(tester, tokenHash, pumpFor: pumpFor);', 'await tester.tap(find.byKey(E2EKeys.loginSubmit));'),
    );
    const f = captureSignInFindings(t).findings;
    assert.deepEqual([...new Set(f.map((x) => x.rule))].sort(), ['form-live', 'token-live']);
    assert.match(f.find((x) => x.rule === 'form-live').msg, /store_screenshots_test\.dart:\d+ touches E2EKeys\.loginSubmit outside the demo/);
  });

  test('🔴 a form submit hoisted out of the if/else, ahead of the live branch, is named', () => {
    const t = mutated('capture', (s) =>
      s.replace('    if (AppConfig.isBackendLive) {\n      expect(\n        tokenHash,', '    await tester.tap(find.byKey(E2EKeys.loginSubmit));\n    if (AppConfig.isBackendLive) {\n      expect(\n        tokenHash,'),
    );
    assert.deepEqual(rules(t), ['form-live']);
  });

  test('🔴 reading E2E_PASSWORD back into the capture suite is named', () => {
    const t = mutated('capture', (s) =>
      s.replace(
        "  const String tokenHash = String.fromEnvironment('E2E_TOKEN_HASH');",
        "  const String tokenHash = String.fromEnvironment('E2E_TOKEN_HASH');\n  const String password = String.fromEnvironment('E2E_PASSWORD');",
      ),
    );
    assert.deepEqual(rules(t), ['no-password']);
  });

  test('🔴 a capture suite that no longer reads the token is named', () => {
    const t = mutated('capture', (s) => s.replace("String.fromEnvironment('E2E_TOKEN_HASH')", "String.fromEnvironment('E2E_TOKEN')"));
    assert.deepEqual(rules(t), ['token-define']);
  });

  test('🔴 a capture suite that forks the helper instead of importing it is named', () => {
    const t = mutated('capture', (s) =>
      `${s.replace("import 'magic_link_sign_in.dart';\n", '')}\nFuture<bool> signInWithMagicToken(WidgetTester tester, String tokenHash) async => false;\n`,
    );
    assert.deepEqual(rules(t), ['one-helper', 'one-helper']);
  });

  test('🔴 the e2e suite forking it back is named too — ONE helper, both callers', () => {
    const t = mutated('e2e', (s) => `${s}\nFuture<bool> signInWithMagicToken(WidgetTester t, String h) async => false;\n`);
    assert.deepEqual(rules(t), ['one-helper']);
  });

  test('🔴 a runner whose posture gate stops requiring the token is named', () => {
    const t = mutated('runner', (s) => s.replace(", 'E2E_PASSWORD', 'E2E_TOKEN_HASH'];", ", 'E2E_PASSWORD'];"));
    assert.deepEqual(rules(t), ['runner-need']);
  });

  test('🔴 a runner that hands every drive the one spent token is named', () => {
    const t = mutated('runner', (s) => s.replace('driveIndex > 0 && tokenAt', 'driveIndex < 0 && tokenAt'));
    assert.deepEqual(rules(t), ['runner-mint']);
  });

  test('🔴 a runner that leaves the service-role key in its env for its children is named', () => {
    const t = mutated('runner', (s) => s.replace('delete process.env.SUPABASE_SERVICE_ROLE_KEY;', ''));
    assert.deepEqual(rules(t), ['runner-key']);
  });

  test('🔴 provision_user.mjs minting its own token again is named', () => {
    const t = mutated('provision', (s) => `${s}\nawait fetch(url + '/auth/v1/admin/generate_link', { method: 'POST' });\n`);
    assert.deepEqual(rules(t), ['one-minter']);
  });

  test('🔴 a capture job whose capture step is not handed the token is named, with its job', () => {
    const ios = workflowJobs(real.lane).find((j) => j.name === 'capture-ios');
    const cap = ios?.steps.find((st) => CAPTURE_INVOCATION.test(st.text));
    const at = cap?.envLine.E2E_TOKEN_HASH;
    assert.ok(at, 'the capture-ios capture step carries no E2E_TOKEN_HASH to remove');
    const t = mutated('lane', (s) => s.split('\n').filter((_, i) => i !== at - 1).join('\n'));
    const f = captureSignInFindings(t).findings;
    assert.deepEqual(f.map((x) => x.rule), ['workflow-token']);
    assert.match(f[0].msg, /^job capture-ios: /);
  });

  test('🔴 a token taken from a step that is not the provisioner is named', () => {
    const t = mutated('lane', (s) =>
      s.replace('E2E_TOKEN_HASH: ${{ steps.user.outputs.token_hash }}', 'E2E_TOKEN_HASH: ${{ steps.backend.outputs.token_hash }}'),
    );
    assert.deepEqual(rules(t), ['workflow-token']);
  });
});

describe('capture-play-screenshots.mjs mints a sign-in token for every drive after the first', () => {
  /** A live, bare env past the posture gate, the stamp, the ledger and the
   *  sandbox backend — the refusals above the one under test — and nothing that
   *  looks like Actions. PATH is node's own directory, so no chromedriver. */
  const liveRun = (extra) => {
    const out = mkdtempSync(join(tmpdir(), 'nk-lane-token-'));
    try {
      const env = { PATH: dirname(process.execPath) };
      for (const k of ['SystemRoot', 'TEMP', 'TMP']) if (process.env[k]) env[k] = process.env[k];
      for (const k of ['SUPABASE_ANON_KEY', 'E2E_EMAIL', 'E2E_PASSWORD', 'E2E_TOKEN_HASH']) env[k] = 'x';
      Object.assign(env, {
        SUPABASE_URL: sandboxBackend().platform.supabaseUrl,
        STORE_CAPTURE_APP_VERSION: 'rehearsal-1790000000',
        E2E_CONSENT_LEDGER: join(out, 'ledger.json'),
        ...extra,
      });
      const r = spawnSync(process.execPath, [RUNNER, '--app', 'subscriptiontracker', '--out', join(out, 'set')], {
        encoding: 'utf8',
        env,
        timeout: 120_000,
      });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };

  test('🔴 a live Play run (two viewports) with no SUPABASE_SERVICE_ROLE_KEY REFUSES before chromedriver, naming it', () => {
    const r = liveRun({});
    assert.equal(r.code, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /a live capture of 2 viewports needs SUPABASE_SERVICE_ROLE_KEY and it is not set/);
    assert.doesNotMatch(r.stderr, /chromedriver was not found/);
    assert.doesNotMatch(r.stdout, /^flutter /m);
  });

  test('GREEN CONTROL · with the key, the same run passes that limb and stops at chromedriver', () => {
    const r = liveRun({ SUPABASE_SERVICE_ROLE_KEY: 'x' });
    assert.equal(r.code, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(r.stderr, /chromedriver was not found on PATH/);
  });
});

describe('tooling/e2e/magic_link.mjs — the one minter', () => {
  /** A fetch that records its calls and answers [status] with [body]. */
  const fakeFetch = (status, body) => {
    const calls = [];
    const f = async (url, init) => {
      calls.push({ url, init });
      return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
    };
    return { f, calls };
  };
  /** A hashed_token of the shape GoTrue issues: hex SHA-224, 56 characters. */
  const HEX56 = 'a1'.repeat(28);

  test('posts a magiclink generate_link for the address with the service key, and returns hashed_token', async () => {
    const { f, calls } = fakeFetch(200, { hashed_token: HEX56, action_link: 'x' });
    const got = await mintMagicLinkTokenHash({ url: 'https://auth-api.nikatru.com/', serviceKey: 'k', email: 'a@b.invalid', fetchImpl: f });
    assert.equal(got, HEX56);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://auth-api.nikatru.com/auth/v1/admin/generate_link');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
    assert.deepEqual(JSON.parse(calls[0].init.body), { type: 'magiclink', email: 'a@b.invalid' });
  });

  test('🔴 a non-2xx answer is refused with its status', async () => {
    const { f } = fakeFetch(403, { msg: 'nope' });
    await assert.rejects(
      mintMagicLinkTokenHash({ url: 'https://auth-api.nikatru.com', serviceKey: 'k', email: 'e', fetchImpl: f }),
      (e) => e instanceof MagicLinkRefused && /generate_link failed: HTTP 403/.test(e.message),
    );
  });

  test('🔴 an answer with no hashed_token is refused, naming the keys it had', async () => {
    const { f } = fakeFetch(200, { action_link: 'x', email_otp: '1' });
    await assert.rejects(
      mintMagicLinkTokenHash({ url: 'https://auth-api.nikatru.com', serviceKey: 'k', email: 'e', fetchImpl: f }),
      (e) => e instanceof MagicLinkRefused && /No hashed_token .*keys: action_link, email_otp/.test(e.message),
    );
  });

  test('🔴 an empty input is refused before any request is made', async () => {
    const { f, calls } = fakeFetch(200, { hashed_token: HEX56 });
    await assert.rejects(
      mintMagicLinkTokenHash({ url: 'https://auth-api.nikatru.com', serviceKey: '', email: 'e', fetchImpl: f }),
      (e) => e instanceof MagicLinkRefused && /serviceKey is empty/.test(e.message),
    );
    assert.equal(calls.length, 0);
  });

  // ⏱ 2026-09-30 — the service-role key goes to its issuer or nowhere
  // (tooling/ops/credential-origin.mjs; CodeQL #532/#533).
  test('🔴 a url that is not the auth issuer is refused before any request is made', async () => {
    const { f, calls } = fakeFetch(200, { hashed_token: HEX56 });
    for (const url of ['https://auth.example.invalid', 'https://auth-api.nikatru.com.evil.invalid', 'https://evil.invalid/auth-api.nikatru.com']) {
      await assert.rejects(
        mintMagicLinkTokenHash({ url, serviceKey: 'k', email: 'e', fetchImpl: f }),
        (e) => e instanceof MagicLinkRefused && /refusing to send the Supabase auth credential .*not its issuer/.test(e.message),
        `minted against ${url}`,
      );
    }
    assert.equal(calls.length, 0);
  });

  test('🔴 a hashed_token that is not a hex digest is refused — a newline in it would write step outputs of its own', async () => {
    assert.ok(TOKEN_HASH_SHAPE.test(HEX56), 'GREEN CONTROL: the shape GoTrue issues must pass');
    for (const bad of [`${HEX56}\nuser_id=00000000-0000-0000-0000-000000000000`, 'short', HEX56.toUpperCase(), `${HEX56}=`]) {
      const { f } = fakeFetch(200, { hashed_token: bad });
      await assert.rejects(
        mintMagicLinkTokenHash({ url: 'https://auth-api.nikatru.com', serviceKey: 'k', email: 'e', fetchImpl: f }),
        // The refusal names the length, never the value: it is a credential.
        (e) => e instanceof MagicLinkRefused && /not a hex digest \(\d+ characters\)/.test(e.message) && !e.message.includes(bad),
        `accepted ${JSON.stringify(bad)}`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY CAPTURE JOB FINISHES ITS CAPTURE BEFORE IT PROPOSES IT
// (O-CAPTURE-LEAVES-DERIVED-SETS-STALE, AR-D3b, 2026-09-27).
//
// A Play re-capture changes the source of the apps.gov.in set. The pull request
// this lane opens is GITHUB_TOKEN's, so ci.yml never runs on it, and until this
// date its `git add` named the capture directories only: the derived set stayed
// stale and nothing said so. Each capture job now runs
// tooling/store/finish-capture.mjs on the channel it captured (every set whose
// register entry declares `derivedFrom` on that channel is re-derived, and each
// written path is printed), then tooling/ci/assert-derived-sets.mjs, and the pull
// request step adds `SHOTS`, which carries the finish step's printed paths.
//
// ORDER, per job: the capture, then every capture guard (listing assets, device
// coverage), then the finish step, then assert-derived-sets, then the pull
// request, and the throwaway-user purge stays the job's LAST step (`always()`).
// Neither new step carries an `if:`: a dry run re-derives and checks too; it
// uploads the capture directories only and proposes nothing.
// ─────────────────────────────────────────────────────────────────────────────
const FINISH_CALL = /(?:^|\s)node\s+(?:--single-threaded\s+)?tooling\/store\/finish-capture\.mjs(?=\s|$)/;
const DERIVED_CALL = /(?:^|\s)node\s+tooling\/ci\/assert-derived-sets\.mjs(?=\s|$)/;
const CAPTURE_GUARD_CALL = /(?:^|\s)node\s+(?:--single-threaded\s+)?tooling\/ci\/assert-(?:listing-assets|play-device-coverage)\.mjs(?=\s|$)/;
const runs = (s, re) => Boolean(s.run) && shellSegments(s.run.text).some((x) => re.test(x));

/** The finish-capture contract over a parsed lane. Pure. */
function checkFinishLane(wf) {
  const findings = [];
  const census = [];
  const find = (rule, job, line, msg) => findings.push({ rule, job, line, msg });
  for (const job of wf.jobs.values()) {
    const steps = workflowSteps(job);
    const capture = steps.find((s) => s.run && CAPTURE_INVOCATION.test(s.run.text));
    if (!capture) continue;
    const env = jobEnv(job);
    const bound = (v) => (v !== null && /^\$\{?STORE_CHANNEL\}?$/.test(v) ? (env.get('STORE_CHANNEL')?.value ?? v) : v);
    const captureSeg = shellSegments(capture.run.text).find((x) => CAPTURE_INVOCATION.test(x));
    const channel = bound(flagOf(captureSeg, '--channel')) ?? 'android-play';

    const finishes = steps.filter((s) => runs(s, FINISH_CALL));
    if (finishes.length !== 1) {
      find('finish-missing', job.name, capture.first, `job ${job.name}: ${finishes.length} step(s) run tooling/store/finish-capture.mjs, where the job needs exactly one`);
      continue;
    }
    const finish = finishes[0];
    const seg = shellSegments(finish.run.text).find((x) => FINISH_CALL.test(x));
    if (finish.id === null) find('finish-id', job.name, finish.first, `job ${job.name}: the finish step at :${finish.first} has no id, so its printed paths cannot reach the pull request`);
    if (finish.cond !== null) find('finish-if', job.name, finish.first, `job ${job.name}: the finish step at :${finish.first} carries \`if: ${finish.cond}\``);
    if (flagOf(seg, '--app') !== flagOf(captureSeg, '--app')) find('finish-app', job.name, finish.first, `job ${job.name}: the finish step at :${finish.first} finishes --app ${flagOf(seg, '--app')}, and the capture drives --app ${flagOf(captureSeg, '--app')}`);
    if (bound(flagOf(seg, '--channel')) !== channel) find('finish-channel', job.name, finish.first, `job ${job.name}: the finish step at :${finish.first} finishes --channel ${flagOf(seg, '--channel')}, and the job captures ${channel}`);

    const lastGuard = steps.filter((s) => runs(s, CAPTURE_GUARD_CALL)).map((s) => s.index).reduce((a, b) => Math.max(a, b), -1);
    if (lastGuard === -1 || finish.index < lastGuard || finish.index < capture.index) {
      find('finish-before-guards', job.name, finish.first, `job ${job.name}: the finish step at :${finish.first} does not follow the capture and every capture guard`);
    }
    const checks = steps.filter((s) => runs(s, DERIVED_CALL));
    if (checks.length !== 1 || checks[0].index < finish.index || checks[0].cond !== null) {
      find('derived-check', job.name, finish.first, `job ${job.name}: needs one ungated tooling/ci/assert-derived-sets.mjs step after the finish step at :${finish.first}; found ${checks.map((s) => `:${s.first}`).join(', ') || 'none'}`);
    }
    const prs = steps.filter((s) => s.run && shellSegments(s.run.text).some((x) => PR_WRITE.test(x)));
    const pr = prs[0];
    if (prs.length !== 1 || pr.index < finish.index || (checks[0] && pr.index < checks[0].index)) {
      find('finish-after-pr', job.name, finish.first, `job ${job.name}: the finish step at :${finish.first} and its check must both come BEFORE the one pull-request step`);
    }
    if (pr) {
      const shots = pr.env.get('SHOTS')?.value ?? '';
      if (!finish.id || !shots.includes(`\${{ steps.${finish.id}.outputs.paths }}`)) {
        find('shots-omit-derived', job.name, pr.first, `job ${job.name}: the pull request at :${pr.first} takes SHOTS=${JSON.stringify(shots)}, which omits the finish step's printed paths`);
      }
      if (!pr.run.text.includes('for d in $SHOTS') || !shellSegments(pr.run.text).some((x) => /(?:^|\s)git\s+add\s+-f\s+"\$d"\s*$/.test(x))) {
        find('shots-not-added', job.name, pr.first, `job ${job.name}: the pull request at :${pr.first} does not \`git add -f\` every entry of SHOTS`);
      }
      if (/apps-gov-in/.test(`${pr.run.text} ${shots}`)) {
        find('shots-hand-listed', job.name, pr.first, `job ${job.name}: the pull request at :${pr.first} names a derived channel by hand; the finish step's output is the one list`);
      }
    }
    const purge = steps.find((s) => s.run && PURGE_INVOCATION.test(s.run.text));
    if (!purge || purge.index !== steps.length - 1 || (pr && purge.index < pr.index)) {
      find('purge-not-last', job.name, purge?.first ?? capture.first, `job ${job.name}: the throwaway-user purge is not the job's last step`);
    }
    if (!findings.some((f) => f.job === job.name)) census.push(job.name);
  }
  return { census, findings };
}

describe('store-screenshots.yml: every capture job finishes its capture before it proposes it', () => {
  const yml = readFileSync(join(REPO, LANE_REL), 'utf8');
  const real = checkFinishLane(parseWorkflow(REPO, LANE_REL));
  const JOBS = ['capture', 'capture-linux', 'capture-desktop-native', 'capture-ios'];
  const lane = parseWorkflow(REPO, LANE_REL);
  const stepNamed = (jobName, re) => workflowSteps(lane.jobs.get(jobName)).find((s) => re.test(s.name ?? ''));
  const lineOf = (re, from = 1) => yml.split('\n').findIndex((l, i) => i >= from - 1 && re.test(l)) + 1;

  test('the lane holds the contract, in all four capture jobs', () => {
    assert.deepEqual(real.findings.map((f) => f.msg), []);
    // Pinned by NAME: a job that stopped matching would shrink the census and pass every rule over less.
    assert.deepEqual(real.census, JOBS);
  });

  test('🔴 the Play pull request without the finish step\'s paths in SHOTS is named', () => {
    const pr = stepNamed('capture', /^Propose the set/);
    const at = lineOf(/^ {10}SHOTS: .*\$\{\{ steps\.finish\.outputs\.paths \}\}$/, pr.first);
    assert.ok(at > pr.first && at <= pr.last, 'the Play pull request carries no SHOTS line with the finish output to remove');
    const lines = yml.split('\n');
    lines[at - 1] = lines[at - 1].replace(' ${{ steps.finish.outputs.paths }}', '');
    const { findings } = checkFinishLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job} :${f.line}`), [`shots-omit-derived capture :${pr.first}`]);
  });

  test('🔴 a Play pull request that hand-lists the derived directory is named', () => {
    const pr = stepNamed('capture', /^Propose the set/);
    const at = lineOf(/^ {10}SHOTS: /, pr.first);
    assert.ok(at > pr.first && at <= pr.last, 'the Play pull request carries no SHOTS line to extend');
    const lines = yml.split('\n');
    lines[at - 1] = `${lines[at - 1]} apps/\${{ needs.gate.outputs.app }}/store/apps-gov-in/screenshots`;
    const { findings } = checkFinishLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job}`), ['shots-hand-listed capture']);
  });

  test('🔴 a Snap finish step moved after the pull request is named, and so is its check', () => {
    const finish = stepNamed('capture-linux', /^Re-derive every set/);
    const purge = stepNamed('capture-linux', /^Purge the throwaway user/);
    assert.ok(finish && purge, 'capture-linux has no finish step or no purge step to reorder');
    const lines = yml.split('\n');
    const block = lines.slice(finish.first - 1, finish.last);
    const moved = [...lines.slice(0, purge.first - 1), ...block, '', ...lines.slice(purge.first - 1)];
    moved.splice(finish.first - 1, finish.last - finish.first + 1);
    const { findings } = checkFinishLane(parseLaneText(moved.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job}`), ['derived-check capture-linux', 'finish-after-pr capture-linux']);
  });

  test('🔴 a desktop finish step gated to real runs only is named', () => {
    const finish = stepNamed('capture-desktop-native', /^Re-derive every set/);
    assert.ok(finish, 'capture-desktop-native has no finish step to gate');
    const lines = yml.split('\n');
    lines.splice(finish.first, 0, '        if: ${{ !inputs.dry_run }}');
    const { findings } = checkFinishLane(parseLaneText(lines.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job}`), ['finish-if capture-desktop-native']);
  });

  test('🔴 an iOS purge that is no longer the last step is named', () => {
    const pr = stepNamed('capture-ios', /^Propose the sets/);
    const purge = stepNamed('capture-ios', /^Purge the throwaway user/);
    assert.ok(pr && purge && purge.first > pr.last, 'capture-ios has no purge after its pull request to move');
    const lines = yml.split('\n');
    const block = lines.slice(purge.first - 1, purge.last);
    const kept = lines.slice(0, purge.first - 1).concat(lines.slice(purge.last));
    const moved = [...kept.slice(0, pr.first - 1), ...block, '', ...kept.slice(pr.first - 1)];
    const { findings } = checkFinishLane(parseLaneText(moved.join('\n')));
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.job}`), ['purge-not-last capture-ios']);
  });
});
