// ─────────────────────────────────────────────────────────────────────────────
// silent-server.mjs — a server that ACCEPTS a request and never answers it, and
// a runner that kills a reader still waiting on it at `killMs`.
//
// Row O-OPS-READER-NO-CEILING. The failure that row names is not a refused
// connection or an error status: both of those ANSWER. It is a socket that is
// accepted and then left silent, with no status, no error and no end. Before the
// shared per-request ceiling in tooling/ops/bounded-retry.mjs, a read like that
// held its job until timeout-minutes cancelled it. A case points a reader here
// with OPS_REQUEST_TIMEOUT_MS shortened and asserts that it ended by itself, as
// exit 2, rather than being killed.
//
// ⏱ 2026-09-24 — moved here from ops-verifiers.test.mjs, where it drove the
// GlitchTip pair, so prod-provenance.test.mjs drives check-prod-provenance.mjs
// against this server too instead of a copy of it. The code moved unchanged
// except that `runBounded` takes an absolute path and an optional `killMs`.
//
// `close()` destroys every socket before it closes the server: the readers use
// undici, which keeps sockets alive, and `server.close()` on its own waits for
// them to end (the ten-minute hang in ops-verifiers.test.mjs's header).
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The default kill. Each case sets its own { timeout } above it, so a missing
 *  ceiling is a red case, never a hung suite. */
export const KILL_MS = 45_000;

/** A loopback server that records each request's URL in `seen` and answers none. */
export const serveSilence = async () => {
  const seen = [];
  const sockets = new Set();
  const server = createServer((req) => { seen.push(req.url); });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    seen,
    close: () => { for (const s of sockets) s.destroy(); return new Promise((ok) => server.close(ok)); },
  };
};

/** Runs the script at the absolute `scriptPath` from the repository root, with
 *  `env` laid over this process's. `signal` is non-null when it was killed. */
export const runBounded = (scriptPath, env, { killMs = KILL_MS } = {}) =>
  new Promise((ok) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: REPO, env: { ...process.env, ...env }, timeout: killMs });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code, signal) => ok({ code, signal, out }));
  });
