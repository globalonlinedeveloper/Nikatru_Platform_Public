#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// web-a11y-tree.mjs — the BUILT web app, loaded in a real browser, exposes an
// accessibility tree whose controls carry roles and names.
//
//   node tooling/smoke/web-a11y-tree.mjs <bundleDir> [--chrome <bin>] [--timeout-ms N]
//
// ── WHY IT EXISTS (SYN-X1 C-16, train P39) ──────────────────────────────────
// Web is the one target this platform SERVES, and its main() force-enables
// semantics (`enableWebSemantics()`, apps/subscriptiontracker/lib/main.dart).
// Every a11y test in the repository runs on the Dart VM, where `kIsWeb` is a
// compile-time `false`, so that call is a line no Dart test can execute
// (web_semantics_test.dart says so). Until this script nothing loaded the
// built bundle and read the accessibility DOM a screen reader reads: a
// regression that left the canvas with no `flt-semantics` tree, or a control
// the browser computes no name for, was green in every lane.
//
// ── WHAT IT READS ───────────────────────────────────────────────────────────
// The bundle is served exactly as smoke-web-artifact.mjs serves it (its own
// base path, its own `_headers`) and booted to the same READY_SIGNAL. Then:
//   · the DOM — `flt-semantics` nodes, and the "Enable accessibility"
//     `flt-semantics-placeholder` Flutter leaves when semantics never started;
//   · the BROWSER'S OWN computed accessibility tree, over CDP
//     (`Accessibility.getFullAXTree`) — the roles and names Chrome hands to a
//     screen reader, not attributes this script guesses a meaning for.
//
// ── THE VERDICT (exit codes per AGENTS.md) ──────────────────────────────────
//   0  a semantics tree exists, no placeholder, ≥ 1 interactive node, and
//      every interactive node has a non-empty computed name.
//   1  a FINDING: no `flt-semantics` tree / the placeholder is still there /
//      an interactive node with no name (named by role and DOM id).
//   2  COVERAGE LOST: the bundle never booted, the browser could not be
//      reached, or the tree carried NO interactive node — a name check over
//      zero controls is a check that ranged over nothing, not a pass.
//
// The landing surface is whatever a fresh, signed-out browser opens on (the
// PR-lane build blanks the backend). That is a deliberate floor, not the
// whole claim: it proves the tree EXISTS in the shipped bundle and that the
// first screen a visitor reaches is nameable. Per-route roles and names stay
// the Dart sweeps' job (a11y_semantics_test.dart walks every route).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

import { READY_SIGNAL, basePrefix, oneLine, readBundleHeaders, serveBundle } from './smoke-web-artifact.mjs';

/** Roles a user ACTS on. A node in one of these with no computed name is the
 *  browser's reading of an unlabelled control (SC 4.1.2 Name, Role, Value). */
export const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

/** Fewer `flt-semantics` nodes than this is a tree that did not build: even
 *  the smallest screen this app opens on has a root, a scroll host, text and
 *  one control. */
export const MIN_SEMANTICS_NODES = 3;

const axValue = (v) => (v && typeof v === 'object' ? v.value : v);

/**
 * The pure verdict, so the suite can red every limb without a browser.
 *
 * @param {{semanticsNodes: number, placeholders: number, axNodes: Array<object>}} reading
 * @returns {{code: 0|1|2, lines: string[], interactive: number}}
 */
export function gradeA11yTree({ semanticsNodes, placeholders, axNodes }) {
  const fails = [];
  const lost = [];
  if (semanticsNodes < MIN_SEMANTICS_NODES) {
    fails.push(
      `the page carries ${semanticsNodes} \`flt-semantics\` node(s) (floor ${MIN_SEMANTICS_NODES}): the built app ` +
        'exposes NO accessibility tree, so a screen reader finds a canvas. enableWebSemantics() did not run, or ' +
        'ran after the first frame.',
    );
  }
  if (placeholders > 0) {
    fails.push(
      'the "Enable accessibility" `flt-semantics-placeholder` is still in the DOM: Flutter only removes it once ' +
        'semantics are on, so a screen-reader user lands on a button they must find before the app exists for them.',
    );
  }
  const live = (axNodes ?? []).filter((n) => !n.ignored);
  const interactive = live.filter((n) => INTERACTIVE_ROLES.has(String(axValue(n.role) ?? '')));
  const nameless = interactive.filter((n) => String(axValue(n.name) ?? '').trim() === '');
  for (const n of nameless) {
    fails.push(
      `a \`${axValue(n.role)}\` with NO accessible name (AX node ${n.nodeId}` +
        `${n.backendDOMNodeId ? `, DOM node ${n.backendDOMNodeId}` : ''}): a screen reader announces its role and ` +
        'nothing else (SC 4.1.2).',
    );
  }
  if (interactive.length === 0 && semanticsNodes >= MIN_SEMANTICS_NODES) {
    lost.push(
      `the browser's accessibility tree (${live.length} non-ignored node(s)) carries NO interactive node, so the ` +
        'name check ranged over nothing. The landing screen always offers at least one control; a tree with ' +
        'none is a tree this script could not read, not a clean one.',
    );
  }
  const lines = [];
  for (const f of fails) lines.push(`FAIL ${f}`);
  for (const l of lost) lines.push(`COVERAGE LOST — ${l}`);
  if (!fails.length && !lost.length) {
    const roles = [...new Set(interactive.map((n) => axValue(n.role)))].sort().join(', ');
    lines.push(`ok   ${semanticsNodes} flt-semantics node(s); no "Enable accessibility" placeholder`);
    lines.push(`ok   ${interactive.length} interactive node(s) in the browser's own AX tree (${roles}), every one named`);
  }
  return { code: fails.length ? 1 : lost.length ? 2 : 0, lines, interactive: interactive.length };
}

const CHROME_CANDIDATES = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];

/** Counts read from the page DOM. `flt-semantics-host` hangs off the
 *  `flt-glass-pane`'s shadow root in some engine builds, so both are walked. */
const DOM_READING = `(() => {
  const roots = [document];
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  let semanticsNodes = 0, placeholders = 0;
  for (const r of roots) {
    semanticsNodes += r.querySelectorAll('flt-semantics').length;
    placeholders += r.querySelectorAll('flt-semantics-placeholder').length;
  }
  return { semanticsNodes, placeholders };
})()`;

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  const bundle = positional[0] ? resolve(positional[0]) : null;
  const timeoutMs = Number(flag('timeout-ms', '90000'));
  const lostExit = (msg) => {
    console.error(`COVERAGE LOST — web-a11y-tree: ${oneLine(msg)}`);
    process.exit(2);
  };
  if (!bundle || !existsSync(bundle) || !statSync(bundle).isDirectory()) {
    lostExit(`${bundle ?? '(no bundle directory given)'} is not a built web bundle. Usage: web-a11y-tree.mjs <bundleDir>`);
  }

  const server = serveBundle(bundle, () => {}, readBundleHeaders(bundle) ?? []);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}${basePrefix(bundle)}`;
  console.log(`serving ${bundle} at ${base}`);

  const profile = mkdtempSync(join(tmpdir(), 'nikatru-a11y-'));
  let chrome = null;
  let ws = null;
  const cleanup = () => {
    try { ws?.close(); } catch { /* already closed */ }
    try { chrome?.kill(); } catch { /* already gone */ }
    try { server.close(); } catch { /* already closed */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  const lost = (msg) => {
    cleanup();
    lostExit(msg);
  };

  const explicit = flag('chrome', process.env.CHROME_EXECUTABLE);
  const candidates = explicit ? [explicit] : CHROME_CANDIDATES;
  let devtools = null;
  for (const bin of candidates) {
    const child = spawn(bin, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      // A phone window: the layout a first-time visitor on a phone reaches.
      '--window-size=430,932',
      'about:blank',
    ]);
    const url = await new Promise((done) => {
      let buf = '';
      const t = setTimeout(() => done(null), 25000);
      child.on('error', () => { clearTimeout(t); done(null); });
      child.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) { clearTimeout(t); done(m[1]); }
      });
      child.on('exit', () => { clearTimeout(t); done(null); });
    });
    if (url) { chrome = child; devtools = url; break; }
    try { child.kill(); } catch { /* already gone */ }
  }
  if (!devtools) lost(`no headless Chrome could be started (tried: ${candidates.join(', ')}), so no tree was read.`);
  // The bundle's base href and every CDP command go down this socket (CodeQL #571,
  // js/file-access-to-http): it is held to the loopback Chrome this script launched.
  if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(devtools)) lost(`Chrome announced DevTools at ${devtools}, which is not loopback; refusing to send anything to it.`);

  ws = new WebSocket(devtools);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', () => j(new Error('devtools socket refused')));
  }).catch((e) => lost(e.message));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((done) => {
      const id = ++seq;
      pending.set(id, done);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.result?.targetId, flatten: true });
  const session = attached.result?.sessionId;
  if (!session) lost('could not attach to a browser tab, so nothing was loaded.');
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  // BEFORE navigation: the event fires once and does not replay.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: READY_SIGNAL.install }, session);
  await send('Page.navigate', { url: base }, session);

  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true }, session)).result?.result?.value;
  const started = Date.now();
  let ready = false;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 250));
    if ((await evaluate(READY_SIGNAL.expression)) === true) { ready = true; break; }
  }
  if (!ready) lost(`the bundle never reached \`${READY_SIGNAL.id}\` within ${timeoutMs} ms, so there was no tree to read.`);

  // The semantics tree is built from the frame AFTER the first one, so it is
  // polled for rather than read once. The poll ends on the first non-empty
  // reading that has held for two consecutive polls (the tree has settled).
  let dom = { semanticsNodes: 0, placeholders: 0 };
  let last = -1;
  const treeStarted = Date.now();
  while (Date.now() - treeStarted < 15000) {
    await new Promise((r) => setTimeout(r, 500));
    dom = (await evaluate(DOM_READING)) ?? dom;
    if (dom.semanticsNodes >= MIN_SEMANTICS_NODES && dom.semanticsNodes === last) break;
    last = dom.semanticsNodes;
  }

  await send('Accessibility.enable', {}, session);
  const ax = await send('Accessibility.getFullAXTree', {}, session);
  if (ax.error || !Array.isArray(ax.result?.nodes)) {
    lost(`the browser returned no accessibility tree: ${JSON.stringify(ax.error ?? {})}`);
  }
  const verdict = gradeA11yTree({ ...dom, axNodes: ax.result.nodes });
  for (const l of verdict.lines) (verdict.code ? console.error : console.log)(oneLine(l));
  console.log(`\nweb-a11y-tree: ${verdict.code === 0 ? 'ok' : verdict.code === 1 ? 'FAILED' : 'COVERAGE LOST'}`);
  cleanup();
  process.exit(verdict.code);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join('tooling', 'smoke', 'web-a11y-tree.mjs'))) {
  await main();
}
