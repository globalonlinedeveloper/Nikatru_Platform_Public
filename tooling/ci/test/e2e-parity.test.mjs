// train st-e2e-parity (EN-07, EN-08, XP-02): the red controls of the parity
// legs — the leg register refuses a flow with no leg, the native driver refuses
// a device leg without its sign-in / core-flow lines or with a harness session
// in a form leg, the web grader refuses a token session in a form run, and the
// export verifier refuses a file that does not hold the server's rows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  CORE_FLOW_LINES,
  CORE_FLOW_PENDING_LINE,
  SIGN_IN_LINE,
  TOKEN_SESSION_LINE,
  NOTIFICATION_TAP_LINE,
  coreFlowDeclared,
  proofAppVersion,
  readProof,
  tapPointOf,
} from '../../e2e/native_auth_proof.mjs';
import { deriveSignIn, gradeSignIn, FORM_LINE, TOKEN_LINE } from '../../e2e/sign_in_via.mjs';
import { exportClaim, gradeExport } from '../../e2e/verify_export_csv.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-e2e-legs.mjs');
const REGISTER = 'tooling/e2e-leg-register.json';
const IT = 'apps/subscriptiontracker/integration_test';

function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-parity-'));
  for (const rel of [REGISTER, 'tooling/channel-register.json', '.github/workflows/e2e.yml', '.github/workflows/native-auth-proof.yml', 'pubspec.yaml']) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  for (const rel of [IT, 'apps/subscriptiontracker/lib', 'tooling/e2e']) {
    cpSync(join(REPO, rel), join(root, rel), { recursive: true });
  }
  return root;
}
const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const editRegister = (root, fn) => {
  const p = join(root, REGISTER);
  const r = JSON.parse(readFileSync(p, 'utf8'));
  fn(r);
  writeFileSync(p, JSON.stringify(r, null, 2));
};

describe('limb FLOWS — every flow, a leg or an equivalent on every target', () => {
  test('green control: the real tree passes', () => {
    const root = realTree();
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /user flow\(s\) × 6 target\(s\)/);
  });
  test('🔴 removing the edit leg on web exits 1', () => {
    const root = realTree();
    editRegister(root, (r) => {
      delete r.flows.list.find((f) => f.id === 'edit-price').legs.web;
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /flow "edit-price" has neither a leg nor a declared equivalent on web/);
  });
  test('🔴 removing the edit step from the web suite exits 1 (anchor stops resolving)', () => {
    const root = realTree();
    const p = join(root, IT, 'app_test.dart');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/await editPriceAndReadBack\([^;]*?newPrice: '8\.88'[^;]*?\);/s, ''));
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /flow "edit-price" on web: 2 of 2 anchor/);
  });
  test('🔴 an anchor that survives only in a comment does not resolve', () => {
    const root = realTree();
    const p = join(root, IT, 'native_auth_proof_test.dart');
    writeFileSync(p, readFileSync(p, 'utf8').replace('await walkCoreFlow(tester, _pumpFor);', '// await walkCoreFlow(tester, _pumpFor);'));
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /flow "edit-price" on android/);
  });
  test('🔴 an equivalent proven by a target with no leg exits 1', () => {
    const root = realTree();
    editRegister(root, (r) => {
      r.flows.list.find((f) => f.id === 'notification-tap').equivalents.ios.provenBy = 'macos';
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /flow "notification-tap" on ios is an equivalent `provenBy` "macos"/);
  });
  test('🔴 no flows list is COVERAGE LOST (exit 2)', () => {
    const root = realTree();
    editRegister(root, (r) => {
      delete r.flows;
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 2);
  });
  // ⏱ 2026-10-02 · lead ruling on #1143: a flow with no leg waits in
  // `flows.pending`, owned by a row and printed every run.
  test('green control: the pending sign-up flow is printed with its row', () => {
    const root = realTree();
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
    // The row id is read from the register, not written here: a test file is no
    // place to cite a row.
    const pending = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8')).flows.pending;
    const row = pending.find((p) => p.id === 'sign-up-check-inbox').row.split(' ')[0];
    assert.match(row, /^O-[A-Z0-9-]+$/);
    assert.ok(r.stdout.includes(`flow "sign-up-check-inbox" has NO leg on any target yet — pending under ${row}`), r.stdout);
  });
  test('🔴 a pending flow with no row exits 1', () => {
    const root = realTree();
    editRegister(root, (r) => {
      r.flows.pending[0].row = 'the lead will decide';
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /pending flow "sign-up-check-inbox" names no register row/);
  });
  // ⏱ 2026-10-02 · lead ruling on #1143: a leg red on its last dispatch is
  // PARKED — pending, citing a run and its failure, skipped and SAID in the
  // suite, and defaulted off in the workflows so main never requires it.
  test('green control: the parked legs are printed with their runs', () => {
    const root = realTree();
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
    const runs = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8')).flows.park.runs;
    for (const k of Object.keys(runs)) assert.ok(r.stdout.includes(`${k} (run ${runs[k].run})`), r.stdout);
  });
  test('🔴 a pending leg parked by no run exits 1', () => {
    const root = realTree();
    editRegister(root, (r) => {
      delete r.flows.list.find((f) => f.id === 'edit-price').legs.web.parkedBy;
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /flow "edit-price" on web is pending, parked by null/);
  });
  test('🔴 a park with no verbatim failure exits 1', () => {
    const root = realTree();
    editRegister(root, (r) => {
      r.flows.park.runs['native-core-flow'].failure = [];
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /flows\.park\.runs\.native-core-flow quotes no failure/);
  });
  test('🔴 a suite that skips without SAYING so exits 1', () => {
    const root = realTree();
    const p = join(root, IT, 'native_auth_proof_test.dart');
    writeFileSync(p, readFileSync(p, 'utf8').replace('debugPrint(kCoreFlowPendingLine);', ''));
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /skip anchor\(s\) "debugPrint\(kCoreFlowPendingLine\)" no longer resolve/);
  });
  test('🔴 a workflow that walks the parked legs by default exits 1', () => {
    const root = realTree();
    const p = join(root, '.github/workflows/e2e.yml');
    writeFileSync(p, readFileSync(p, 'utf8').replace("E2E_PENDING_FLOWS: ${{ inputs.pending_flows || 'skip' }}", 'E2E_PENDING_FLOWS: run'));
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /may now be required on main/);
  });
  test('🔴 a parked run no leg cites any more exits 1', () => {
    const root = realTree();
    editRegister(root, (r) => {
      r.flows.park.runs.stale = { ...r.flows.park.runs['web-changed-flows'] };
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /flows\.park\.runs\.stale .* is cited by no pending leg/);
  });
  test('🔴 a flow both walked and pending exits 1', () => {
    const root = realTree();
    editRegister(root, (r) => {
      r.flows.pending.push({ id: 'edit-price', row: r.flows.pending[0].row, why: ['dup'] });
    });
    const r = run(root);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /flows\.pending carries a flow with no id, or one already in flows\.list or pending \("edit-price"\)/);
  });
});

describe('the native driver reads the device leg back', () => {
  const BASE = [
    'NK_PROOF step=sign-up-registered answer=attestation_required',
    'NK_PROOF step=recover-unregistered answer=attestation_required',
    'NK_PROOF step=sign-out outcome=ok',
  ];
  const form = [SIGN_IN_LINE, ...BASE, ...CORE_FLOW_LINES].join('\n');
  test('green: a form leg with every core-flow line', () => {
    assert.deepEqual(readProof(form, { callback: false, coreFlow: true }), []);
  });
  test('🔴 a declared device leg with no sign-in line fails', () => {
    const out = form.replace(SIGN_IN_LINE, '');
    assert.match(readProof(out, { callback: false }).join('\n'), /missing "NK_PROOF step=sign-in outcome=ok"/);
  });
  test('🔴 a form leg whose session came from the harness token fails', () => {
    const out = `${form}\n${TOKEN_SESSION_LINE}`;
    assert.match(readProof(out, { callback: false }).join('\n'), /came from the harness token/);
  });
  test('a token leg needs the session line, not the form line', () => {
    const out = [TOKEN_SESSION_LINE, ...BASE, ...CORE_FLOW_LINES].join('\n');
    assert.deepEqual(readProof(out, { callback: false, coreFlow: true, signIn: 'token' }), []);
    assert.match(readProof(BASE.join('\n'), { callback: false, signIn: 'token' }).join('\n'), /via=harness-token/);
  });
  test('🔴 each missing core-flow line fails, by name', () => {
    for (const line of CORE_FLOW_LINES) {
      const out = form.replace(line, '');
      assert.match(readProof(out, { callback: false, coreFlow: true }).join('\n'), new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
  test('🔴 the notification tap line is required when the leg taps', () => {
    assert.match(readProof(form, { callback: false, notificationTap: true }).join('\n'), /notification-tap/);
    assert.deepEqual(readProof(`${form}\n${NOTIFICATION_TAP_LINE}`, { callback: false, notificationTap: true }), []);
  });
  test('a parked leg needs the pending line instead of the flow and tap lines', () => {
    const parked = [SIGN_IN_LINE, ...BASE, CORE_FLOW_PENDING_LINE].join('\n');
    assert.deepEqual(readProof(parked, { callback: false, coreFlow: true, notificationTap: true, flowsParked: true }), []);
  });
  test('🔴 a parked leg that does not SAY it skipped fails', () => {
    const out = [SIGN_IN_LINE, ...BASE].join('\n');
    assert.match(readProof(out, { callback: false, coreFlow: true, flowsParked: true }).join('\n'), /core-flow outcome=pending/);
  });
  test('🔴 a run leg whose suite skipped the flows fails', () => {
    const out = `${form}\n${CORE_FLOW_PENDING_LINE}`;
    assert.match(readProof(out, { callback: false, coreFlow: true }).join('\n'), /skipped the flows this run asked it to walk/);
  });
  // 🔬 E2E 36994942854: the web walk passed and sign_in_via --grade found no
  // sign-in line — a browser `debugPrint` never reaches the drive log. Every
  // NK_E2E line the web suite emits goes through e2eLine (reportData → the
  // host driver's stdout), and the driver prints `e2e_lines`.
  test('🔴 the web suite emits no NK_E2E line through debugPrint alone', () => {
    const scan = (src) => [...src.matchAll(/debugPrint\(\s*'NK_E2E[^']*'/g)].length;
    const suite = readFileSync(join(REPO, IT, 'app_test.dart'), 'utf8');
    assert.equal(scan(suite), 0);
    assert.ok(/e2eLine\(binding, 'NK_E2E step=sign-in via=form'\)/.test(suite));
    assert.equal(scan("debugPrint('NK_E2E step=sign-in via=form');"), 1, 'the scan must catch the shape that went red');
    const driver = readFileSync(join(REPO, 'apps/subscriptiontracker/test_driver/integration_test.dart'), 'utf8');
    assert.match(driver, /data\?\['e2e_lines'\]/);
  });
  test('the driver and the Dart steps print the SAME pending line', () => {
    const dart = readFileSync(join(REPO, IT, 'flow_steps.dart'), 'utf8');
    const m = /const String kCoreFlowPendingLine =\s*'([^']+)';/.exec(dart);
    assert.equal(m?.[1], CORE_FLOW_PENDING_LINE);
  });
  test('the driver and the Dart steps print the SAME core-flow lines', () => {
    const dart = readFileSync(join(REPO, IT, 'flow_steps.dart'), 'utf8');
    const block = /const List<String> kCoreFlowLines = <String>\[([\s\S]*?)\];/.exec(dart)?.[1] ?? '';
    assert.deepEqual([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]), [...CORE_FLOW_LINES]);
  });
  test('coreFlowDeclared reads the REAL tree, and ignores a comment', () => {
    assert.equal(coreFlowDeclared(REPO, 'subscriptiontracker'), true);
    const root = mkdtempSync(join(tmpdir(), 'nikatru-core-'));
    mkdirSync(join(root, 'apps/demo/integration_test'), { recursive: true });
    writeFileSync(join(root, 'apps/demo/integration_test/native_auth_proof_test.dart'), '// await walkCoreFlow(tester, p);\n');
    assert.equal(coreFlowDeclared(root, 'demo'), false);
    rmSync(root, { recursive: true, force: true });
  });
  test('tapPointOf finds the notification row by its exact title', () => {
    const xml = '<hierarchy><node text="Other" bounds="[0,0][10,10]"/><node index="1" text="NK tap proof" bounds="[100,200][300,260]"/></hierarchy>';
    assert.deepEqual(tapPointOf(xml, 'NK tap proof'), { x: 200, y: 230 });
    assert.equal(tapPointOf(xml, 'NK tap'), null);
  });
});

// ⏱ 2026-10-02 · dispatch 36971560167: a device leg built with no APP_VERSION
// stamped `dev`, production's consent ingest refused it (422 unreleased_build),
// and no target recorded the terms acceptance. The driver's stamp is held to the
// server's own shape: the literal below must be the one build-stamp.ts exports.
describe('a device leg is stamped the way production accepts an E2E row', () => {
  const E2E_RUN_LITERAL = 'export const E2E_RUN = /^e2e-(\\d{1,9})-([0-9a-f]{7})$/;';
  const E2E_RUN = /^e2e-(\d{1,9})-([0-9a-f]{7})$/;
  test('the server still accepts exactly this shape', () => {
    const src = readFileSync(join(REPO, 'services/platform/src/lib/build-stamp.ts'), 'utf8');
    assert.ok(src.includes(E2E_RUN_LITERAL), 'build-stamp.ts E2E_RUN moved — re-read it and update this pin and proofAppVersion together');
    assert.match(src, /consent_artifacts: \['released-build', 'e2e-run'\]/);
  });
  test('green: a CI run makes an accepted stamp', () => {
    const v = proofAppVersion({ GITHUB_RUN_NUMBER: '312', GITHUB_SHA: 'ABCDEF0123456789abcdef0123456789abcdef01' });
    assert.equal(v, 'e2e-312-abcdef0');
    assert.match(v, E2E_RUN);
  });
  test('🔴 off CI, or with a malformed run or sha, there is no stamp (the driver refuses on CI)', () => {
    assert.equal(proofAppVersion({}), null);
    assert.equal(proofAppVersion({ GITHUB_RUN_NUMBER: '12a', GITHUB_SHA: 'abcdef0' }), null);
    assert.equal(proofAppVersion({ GITHUB_RUN_NUMBER: '12', GITHUB_SHA: 'xyz' }), null);
    assert.doesNotMatch('dev', E2E_RUN);
  });
});

// ⏱ 2026-10-02 · dispatch 36970477400: the drive step runs in apps/<app>, and a
// root-relative `node tooling/e2e/sign_in_via.mjs` died MODULE_NOT_FOUND before
// Chrome walked anything. Every step scoped to an app directory names a root
// script from $GITHUB_WORKSPACE.
/** PURE. `node tooling/…` calls inside steps whose working-directory is apps/<app>. */
function rootScriptsInAppSteps(yml) {
  const found = [];
  for (const block of String(yml).split(/\n(?= {6}- (?:name|uses|id):)/)) {
    if (!/\n\s+working-directory: apps\//.test(block)) continue;
    for (const m of block.matchAll(/node\s+(tooling\/\S+)/g)) found.push(m[1]);
  }
  return found;
}
describe('a step run in an app directory reaches root scripts through the workspace', () => {
  const yml = readFileSync(join(REPO, '.github/workflows/e2e.yml'), 'utf8');
  test('e2e.yml: none is root-relative', () => {
    assert.match(yml, /node "\$GITHUB_WORKSPACE\/tooling\/e2e\/sign_in_via\.mjs" --derive/);
    assert.deepEqual(rootScriptsInAppSteps(yml), []);
  });
  test('🔴 the shape that failed dispatch 36970477400 is found', () => {
    const bad = yml.replace('node "$GITHUB_WORKSPACE/tooling/e2e/sign_in_via.mjs" --derive', 'node tooling/e2e/sign_in_via.mjs --derive');
    assert.notEqual(bad, yml);
    assert.deepEqual(rootScriptsInAppSteps(bad), ['tooling/e2e/sign_in_via.mjs']);
  });
});

describe('the web E2E signs in through the form when it can, and is graded on it', () => {
  test('derive: a pass TEST key or no gate is the form; a real key is the token; unset refuses', () => {
    assert.equal(deriveSignIn({ siteKey: '1x00000000000000000000AA', captchaGate: 'yes' }), 'form');
    assert.equal(deriveSignIn({ siteKey: '0x4AAAAAAAreal', captchaGate: 'no' }), 'form');
    assert.equal(deriveSignIn({ siteKey: '0x4AAAAAAAreal', captchaGate: 'yes' }), 'token');
    assert.equal(deriveSignIn({ siteKey: '2x00000000000000000000AB', captchaGate: 'yes' }), 'token');
    assert.equal(deriveSignIn({ siteKey: '1x00000000000000000000AA', captchaGate: '' }), null);
  });
  test('🔴 a form run whose session came from the harness token is red', () => {
    assert.deepEqual(gradeSignIn(FORM_LINE, 'form'), []);
    assert.match(gradeSignIn(TOKEN_LINE, 'form').join('\n'), /harness token/);
    assert.match(gradeSignIn('', 'form').join('\n'), /did not sign in through the form/);
    assert.deepEqual(gradeSignIn(TOKEN_LINE, 'token'), []);
  });
  test('🔴 the exported file must hold the rows the server held, the edited one at its price', () => {
    const claim = exportClaim('x\nNK_E2E step=export rows=3 name=E2E Probe B 1 price=8.88\n');
    assert.deepEqual(claim, { rows: 3, name: 'E2E Probe B 1', price: '8.88' });
    const body = '\uFEFFname,price,currency,cycle\nA,1.00,USD,monthly\nE2E Probe B 1,8.88,USD,monthly\nC,2.00,USD,yearly\n';
    assert.deepEqual(gradeExport(body, claim), []);
    assert.match(gradeExport(body.replace('8.88', '7.77'), claim).join('\n'), /edited price/);
    assert.match(gradeExport(body.replace('C,2.00,USD,yearly\n', ''), claim).join('\n'), /holds 2 row/);
  });
});
