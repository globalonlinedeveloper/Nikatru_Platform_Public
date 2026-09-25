/* ============================================================================
   bidi-lib.mjs — Firefox, driven over raw WebDriver BiDi (2026-09-24, EXT-5).
   A library, not a suite.

   NO NEW DEPENDENCY, BY RULING: no Playwright-Firefox (it drives a patched
   Juggler build, not the Firefox a user installs), no geckodriver, no npx.
   Firefox itself serves BiDi when started with --remote-debugging-port, and
   Node 22+ has a global WebSocket, so this file is the whole client: launch,
   connect to /session, send commands, receive events.

   THE moz-extension HOST IS PINNED. Firefox gives each add-on a random UUID
   per profile, so moz-extension://<uuid>/pages/options.html is unguessable —
   unless the profile's `extensions.webextensions.uuids` pref names it first,
   which it is Firefox's own documented pref for. The suites set it in user.js
   before launch and navigate to the fixed host.

   Every call has a ceiling (BIDI_TIMEOUT_MS); a Firefox that never prints its
   BiDi endpoint is COVERAGE LOST (the caller decides the exit), never a hang.
   ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BIDI_TIMEOUT_MS = 60000;
export const FIREFOX_BIN = process.env.FS_E2E_FIREFOX || 'firefox';

/* `firefox --version` -> { text, major } or null when there is no Firefox. */
export function firefoxVersion(bin = FIREFOX_BIN) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000 });
  if (r.error || r.status !== 0) return null;
  const m = /(\d+)\.(\d+)(?:\.\d+)?/.exec(r.stdout || '');
  return m ? { text: (r.stdout || '').trim(), major: Number(m[1]) } : null;
}

function userJs(prefs) {
  return Object.entries(prefs).map(([k, v]) => 'user_pref(' + JSON.stringify(k) + ', ' + JSON.stringify(v) + ');').join('\n') + '\n';
}

/* Launches Firefox with a fresh profile and returns a connected client:
   { send(method, params), on(event, fn), close(), uuid, version, proc }. */
export async function launchFirefox({ addonId, bin = FIREFOX_BIN, extraPrefs = {} } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-gecko-'));
  const uuid = crypto.randomUUID();
  const prefs = {
    'browser.shell.checkDefaultBrowser': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'datareporting.policy.dataSubmissionEnabled': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
    'extensions.autoDisableScopes': 0,
    'extensions.webextensions.uuids': JSON.stringify(addonId ? { [addonId]: uuid } : {}),
    ...extraPrefs
  };
  fs.writeFileSync(path.join(profile, 'user.js'), userJs(prefs));
  const args = ['--no-remote', '--profile', profile, '--remote-debugging-port=0'];
  if (!process.env.HEADFUL) args.unshift('--headless');
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  const endpoint = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Firefox printed no "WebDriver BiDi listening on" line within ' + BIDI_TIMEOUT_MS + ' ms:\n' + buf.slice(-2000))), BIDI_TIMEOUT_MS);
    const read = d => {
      buf += d.toString();
      const m = /WebDriver BiDi listening on (ws:\/\/[^\s]+)/.exec(buf);
      if (m) { clearTimeout(t); resolve(m[1]); }
    };
    proc.stdout.on('data', read);
    proc.stderr.on('data', read);
    proc.on('exit', code => { clearTimeout(t); reject(new Error('Firefox exited ' + code + ' before serving BiDi:\n' + buf.slice(-2000))); });
  });
  const ws = new WebSocket(endpoint.replace(/\/$/, '') + '/session');
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('cannot open ' + endpoint + '/session')); });

  let next = 1;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject, t, method } = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(t);
      if (msg.type === 'error') reject(new Error(method + ': ' + msg.error + ' — ' + msg.message));
      else resolve(msg.result);
    } else if (msg.type === 'event' || msg.method) {
      for (const fn of handlers.get(msg.method) || []) fn(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out after ' + BIDI_TIMEOUT_MS + ' ms')); }, BIDI_TIMEOUT_MS);
    pending.set(id, { resolve, reject, t, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (event, fn) => { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); };

  const session = await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const close = async () => {
    try { await send('browser.close', {}); } catch (_) { /* already gone */ }
    try { ws.close(); } catch (_) { /* closed */ }
    try { proc.kill('SIGKILL'); } catch (_) { /* exited */ }
  };
  return { send, on, close, uuid, proc, profile, capabilities: session.capabilities || {} };
}

/* script.evaluate that returns a plain JSON value: the expression must
   evaluate to something JSON.stringify can carry. userActivation gives the
   call a transient user activation, which is what a click would. */
export async function evalJson(ff, context, expression, { userActivation = false } = {}) {
  const r = await ff.send('script.evaluate', {
    expression: '(async () => JSON.stringify(await (' + expression + ')))()',
    target: { context }, awaitPromise: true, userActivation
  });
  if (r.type === 'exception') {
    throw new Error('script.evaluate threw: ' + ((r.exceptionDetails && r.exceptionDetails.text) || JSON.stringify(r.exceptionDetails)));
  }
  const v = r.result && r.result.value;
  return v === undefined ? undefined : JSON.parse(v);
}

/* The first top-level browsing context, or a new tab. */
export async function topContext(ff) {
  const tree = await ff.send('browsingContext.getTree', {});
  if (tree.contexts && tree.contexts.length) return tree.contexts[0].context;
  return (await ff.send('browsingContext.create', { type: 'tab' })).context;
}
