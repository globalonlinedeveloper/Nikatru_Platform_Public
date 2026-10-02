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
  SIGN_IN_LINE,
  TOKEN_SESSION_LINE,
  NOTIFICATION_TAP_LINE,
  coreFlowDeclared,
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
  for (const rel of [REGISTER, 'tooling/channel-register.json', '.github/workflows/e2e.yml', 'pubspec.yaml']) {
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
