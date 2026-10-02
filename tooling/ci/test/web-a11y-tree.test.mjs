// web-a11y-tree.test.mjs — every limb of tooling/smoke/web-a11y-tree.mjs's
// verdict, red AND green, without a browser (SYN-X1 C-16, train P39).
//
// The browser half is exercised against a real built bundle in ci.yml's
// `web-artifacts` job; what is pinned here is that the verdict over a reading
// can fail on each defect it names, so a refactor that made it always-green
// reds this suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INTERACTIVE_ROLES, MIN_SEMANTICS_NODES, gradeA11yTree } from '../../smoke/web-a11y-tree.mjs';

const ax = (nodeId, role, name, extra = {}) => ({
  nodeId: String(nodeId),
  role: { type: 'role', value: role },
  name: { type: 'computedString', value: name },
  ...extra,
});

/** What a healthy sign-in landing looks like through CDP: a root, static
 *  text, two named fields and a named button. */
const healthy = () => ({
  semanticsNodes: 12,
  placeholders: 0,
  axNodes: [
    ax(1, 'RootWebArea', ''),
    ax(2, 'generic', ''),
    ax(3, 'StaticText', 'Sign in'),
    ax(4, 'textbox', 'Email'),
    ax(5, 'textbox', 'Password'),
    ax(6, 'button', 'Sign in'),
    ax(7, 'link', 'Forgot password?'),
  ],
});

test('GREEN CONTROL — a tree with named controls and no placeholder passes', () => {
  const v = gradeA11yTree(healthy());
  assert.equal(v.code, 0, v.lines.join('\n'));
  assert.equal(v.interactive, 4);
  assert.match(v.lines.join('\n'), /4 interactive node\(s\).*button, link, textbox.*every one named/);
});

test('RED — no flt-semantics tree is a finding, not a pass', () => {
  const v = gradeA11yTree({ ...healthy(), semanticsNodes: 0 });
  assert.equal(v.code, 1);
  assert.match(v.lines.join('\n'), /0 `flt-semantics` node\(s\).*NO accessibility tree/);
});

test(`RED — a tree under the floor (${MIN_SEMANTICS_NODES}) is a tree that did not build`, () => {
  const v = gradeA11yTree({ ...healthy(), semanticsNodes: MIN_SEMANTICS_NODES - 1 });
  assert.equal(v.code, 1);
});

test('RED — the "Enable accessibility" placeholder still present', () => {
  const v = gradeA11yTree({ ...healthy(), placeholders: 1 });
  assert.equal(v.code, 1);
  assert.match(v.lines.join('\n'), /flt-semantics-placeholder/);
});

test('RED — a nameless control is named by role and DOM node', () => {
  const r = healthy();
  r.axNodes.push(ax(8, 'button', '   ', { backendDOMNodeId: 42 }));
  const v = gradeA11yTree(r);
  assert.equal(v.code, 1);
  assert.match(v.lines.join('\n'), /a `button` with NO accessible name \(AX node 8, DOM node 42\)/);
});

test('RED — every interactive role is graded, not only buttons', () => {
  for (const role of INTERACTIVE_ROLES) {
    const r = healthy();
    r.axNodes.push(ax(99, role, ''));
    assert.equal(gradeA11yTree(r).code, 1, `a nameless ${role} passed`);
  }
});

test('an IGNORED nameless node is not a control a reader reaches', () => {
  const r = healthy();
  r.axNodes.push(ax(9, 'button', '', { ignored: true }));
  assert.equal(gradeA11yTree(r).code, 0);
});

test('COVERAGE LOST (2) — a tree with no interactive node ranged over nothing', () => {
  const r = healthy();
  r.axNodes = r.axNodes.filter((n) => !INTERACTIVE_ROLES.has(n.role.value));
  const v = gradeA11yTree(r);
  assert.equal(v.code, 2);
  assert.match(v.lines.join('\n'), /COVERAGE LOST — .*NO interactive node/);
});

test('a missing AX tree is COVERAGE LOST, never a pass', () => {
  const v = gradeA11yTree({ semanticsNodes: 12, placeholders: 0, axNodes: undefined });
  assert.equal(v.code, 2);
});
