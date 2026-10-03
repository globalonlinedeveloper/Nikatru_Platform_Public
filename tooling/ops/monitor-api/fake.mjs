// ─────────────────────────────────────────────────────────────────────────────
// monitor-api/fake.mjs — the `fake` adapter of the ops MONITOR API: a GlitchTip
// uptime-monitor API served from the test's own process on 127.0.0.1, so a
// script under test runs its REAL request code (GLITCHTIP_URL pointed here; the
// credential-origin pin admits loopback only) against an answer the test
// controls. Never selectable outside a test: it is not a URL anyone can be
// configured with, it exists only while the test that started it runs.
//
//   serveFakeMonitorApi(answer)   answer(method, url, body) → [status, json];
//                                 every request is recorded in `seen`.
//   statefulMonitors(list, org)   an `answer` that keeps a monitor list and
//                                 serves list / GET one / POST / PUT the way
//                                 GlitchTip does (`projectID` out, `project` in).
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';

export const ADAPTER = 'fake';

/** A GlitchTip served from this process. Resolves to `{ url, seen, close }`. */
export async function serveFakeMonitorApi(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body });
      const [status, json] = answer(req.method, req.url, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

/**
 * An `answer` holding `list` (monitors as GlitchTip RETURNS them). A POST takes
 * the REQUEST shape (`project`) and stores the RESPONSE shape (`projectID`), as
 * the live instance does; a PUT is a full replace. `monitors` is the live list.
 */
export function statefulMonitors(list = [], org = 'nikatru') {
  const monitors = list.map((m) => ({ ...m }));
  let next = Math.max(0, ...monitors.map((m) => Number(m.id) || 0)) + 1;
  const base = `/api/0/organizations/${org}/monitors/`;
  const asResponse = (id, body) => {
    const { project, ...rest } = body ?? {};
    return { ...rest, id, projectID: project ?? null };
  };
  const answer = (method, url, body) => {
    if (url === base && method === 'GET') return [200, monitors];
    if (url === base && method === 'POST') {
      const m = asResponse(next++, body);
      monitors.push(m);
      return [201, m];
    }
    const one = url.startsWith(base) ? /^(\d+)\/$/.exec(url.slice(base.length)) : null;
    const i = one ? monitors.findIndex((m) => String(m.id) === one[1]) : -1;
    if (i < 0) return [404, { detail: 'Not Found' }];
    if (method === 'GET') return [200, monitors[i]];
    if (method === 'PUT') {
      monitors[i] = asResponse(monitors[i].id, body);
      return [200, monitors[i]];
    }
    return [405, { detail: 'Method Not Allowed' }];
  };
  return { answer, monitors };
}
