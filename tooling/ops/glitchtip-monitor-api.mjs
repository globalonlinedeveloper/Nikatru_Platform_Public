// ─────────────────────────────────────────────────────────────────────────────
// glitchtip-monitor-api.mjs — the ONE module that talks to GlitchTip's uptime
// monitor API for a WRITER: what a request body must carry, how each call is
// retried, and the threshold policy every GET monitor is held to.
//
// ⏱ 2026-09-26 (O-SERVICE-KIT-UNBUILT, E-b2). MOVED out of
// tooling/ops/set-monitor-thresholds.mjs, whose PUT is a full replace over live
// monitors, so that tooling/ops/ensure-monitors.mjs, which CREATES them, sends the
// same body through the same code. One API module and two commands, each with one
// kind of write: set-monitor-thresholds PUTs over existing ids, ensure-monitors
// POSTs the ones tooling/monitor-register.json declares and GlitchTip does not
// have yet. The two blocks below are set-monitor-thresholds' own, verbatim.
//
// It reads no file other than the vault (and only when a caller asks for the
// vault token), sets no exit code and decides nothing: each caller keeps its own
// verdict. Its requests go through tooling/ops/bounded-retry.mjs: a GET that
// meets a dropped wire, a 429 or a 5xx is asked again on that module's plan; a
// POST or a PUT is sent exactly ONCE, because re-sending a write whose answer was
// lost is a different decision from re-asking a read (verify-alarm-chains.mjs
// draws the same line).
//
// ## 🔴 THE REQUEST AND THE RESPONSE DO NOT USE THE SAME KEY FOR THE PROJECT,
// ## AND GETTING THAT WRONG DETACHES EVERY MONITOR FROM ITS ALERTS
// Measured on this instance (GlitchTip 6.2.2) on 2026-08-11, the hard way:
//
//   · the RESPONSE calls it `projectID`, and its value is a STRING — `"1"`.
//   · the REQUEST calls it **`project`**, and it is ALSO a string. Sending
//     `project: 1` as an integer is rejected: HTTP 422,
//     `{"loc":["body","payload","project"],"msg":"Input should be a valid string"}`.
//   · sending the RESPONSE's key, `projectID`, is **accepted with HTTP 200 and
//     silently ignored** — the field is not in the input schema, so the project
//     falls to its default of null.
//
// That last line is the whole hazard. Echoing a monitor's own representation
// straight back — the obvious, careful-looking thing to do — returns 200 and
// detaches the monitor from its project. GlitchTip resolves recipients by
// joining alert → project → monitor, so a null project means **an empty
// recipient set**: the dashboard still draws the monitor, still turns it red,
// and tells nobody. That precise failure already happened once to monitor 6 and
// is written up in `register.json` under `duty.laptop.nikatru-daily-backup` —
// "it went Down 13 times of 41 checks telling nobody".
//
// It happened AGAIN on 2026-08-11, to all nine monitors at once, from this very
// script — and the read-back diff below is the only reason it was noticed and
// repaired within the minute rather than discovered by an outage nobody was
// told about. The guard caught the guard's own author. Keep the diff.
//
// The threshold field is `confirmationThreshold` in both directions. Note the
// upstream Python model spells these `confirmation_threshold` and `project`;
// reading field names off the source rather than off the wire is what produced
// the broken body in the first place.
//
// 🔴 PUT IS A FULL REPLACE. There is no PATCH route (`apps/uptime/api.py`
// registers POST/GET/PUT/DELETE and no `@router.patch`), and the handler does
// `payload.dict()` rather than `exclude_unset`, so **every field absent from the
// body is reset to its schema default** — including the project, which is how a
// monitor ends up with `project_id = NULL`, an empty recipient set, and a
// dashboard that draws it red while it tells nobody. That exact failure already
// happened to monitor 6 and is written up in `register.json`
// (`duty.laptop.nikatru-daily-backup`). So this script never composes a body: it
// GETs the monitor, changes ONE field, PUTs the whole thing back, and then
// re-GETs and diffs every field to prove nothing else moved. A write that
// cannot show what it changed is a write nobody can trust.
//
// ("this script" and "the read-back diff below" in the two blocks above are
// set-monitor-thresholds.mjs, where they were written; the diff is still there.)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyThrown, transientLook, isTransientStatus, isSafeMethod, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VAULT = join(ROOT, '.claude', 'secrets.env');

/** The instance and the organisation, from the environment, with the defaults
 *  set-monitor-thresholds has always used. */
export const BASE = process.env.GLITCHTIP_URL || 'https://glitchtip.nikatru.com';
export const ORG = process.env.GLITCHTIP_ORG || 'nikatru';

// The vault quotes its values; a reader that keeps the quotes sends
// `Bearer "…"` and gets a 400 that reads exactly like a revoked token.
const unquote = (v) => v.replace(/^(['"])([\s\S]*)\1$/, '$2');
function vault(key) {
  if (!existsSync(VAULT)) return null;
  for (const line of readFileSync(VAULT, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    if (line.slice(0, i).trim() === key) return unquote(line.slice(i + 1).trim());
  }
  return null;
}

/** GLITCHTIP_TOKEN from the environment, else from the local vault. Only
 *  set-monitor-thresholds asks for the vault; ensure-monitors reads the
 *  environment alone, as verify-monitors and verify-alarm-chains do, so a run
 *  with the variable empty is a deterministic "no credential" on any machine. */
export function vaultToken() {
  return process.env.GLITCHTIP_TOKEN?.trim() || vault('GLITCHTIP_TOKEN');
}

/// THE POLICY — and it is [ADR 043] decision 2, not this script's own opinion.
///
/// · GET monitors → 2. They run every 60 s, so two consecutive failures means
///   about two minutes of continuous failure before anyone is told. A real
///   outage still pages within ~2 min, while a single blip and an ALTERNATING
///   flap (fail, ok, fail, ok — the pattern that actually produced the 122
///   emails) never reach two and are silent. ADR 043 priced this against the
///   real check rows and against the precedent already inside this install:
///   monitors 11 and 12 were created with 2 and neither has ever flapped.
///
/// · HEARTBEAT monitors → NOT MANAGED HERE, deliberately. ADR 043 says "leave
///   6 and 16 alone". Their intervals are 12 h and 3 h, so each extra
///   confirmation costs a whole interval of detection latency, and turning
///   "the daily backup stopped" into a 24 h-late finding is a real cost that
///   the ADR did not price. Monitor 6 HAS flapped (14 down checks, 11
///   transitions, including 8 consecutive downs 30 s apart on 2026-07-27), so
///   there is a case to answer — but it is a decision to take with evidence,
///   not a number to slip in inside a script. Raised as a follow-up on ADR 043.
///
/// A type absent from this map is reported and left untouched.
///
/// ⏱ 2026-09-26: moved here from set-monitor-thresholds.mjs, which imports it,
/// so that ensure-monitors creates each GET monitor AT this threshold instead of
/// at GlitchTip's default of 1 (the flap above). One number, read by both.
export const POLICY = { GET: 2 };

/**
 * One call. Resolves to `{ status, body }` for every ANSWER, whatever its status,
 * exactly as set-monitor-thresholds' own `api()` did: the caller reads the status.
 *
 * A GET is retried on bounded-retry.mjs's plan when the wire drops or the server
 * says "not now" (429/5xx). If every attempt says "not now", the last such answer
 * is returned, so the caller still sees `HTTP 503` and says it could not look. A
 * wire that never answers throws, as a bare `fetch` did. A write is attempted
 * exactly once, for the reason in the header.
 */
export async function api(method, path, body, { token, base = BASE, sleep, note } = {}) {
  const verb = method.toUpperCase();
  let lastAnswer = null;
  const read = async (_attempt, { signal }) => {
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method: verb,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw classifyThrown(err, `${verb} ${path} did not answer (${err?.name ?? 'error'}: ${err?.message ?? err})`);
    }
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      /* a 204 or an error page — status is what matters */
    }
    const answer = { status: res.status, body: parsed };
    if (isTransientStatus(res.status)) {
      lastAnswer = answer;
      throw transientLook(`${verb} ${path} → HTTP ${res.status}`, { retryAfterMs: retryAfterMs(res) });
    }
    return answer;
  };
  try {
    return await readWithBoundedRetry(read, { attempts: isSafeMethod(verb) ? undefined : 1, sleep, note });
  } catch (err) {
    if (lastAnswer) return lastAnswer;
    throw err;
  }
}

/**
 * 🔴 EVERY FIELD THE SCHEMA ACCEPTS, keyed as the REQUEST spells them. Omitting
 * one resets it (PUT is a full replace, above), and `project` — the REQUEST key —
 * carries the value the RESPONSE calls `projectID`. They are different names for
 * the same field and using the response's name here is accepted-and-ignored,
 * which nulls the project and silently empties the monitor's recipient list.
 *
 * `representation` is a monitor as GlitchTip returns it (set-monitor-thresholds
 * passes its own GET of the monitor); `set` names the fields this write changes.
 * ensure-monitors builds the same shape for a monitor that does not exist yet,
 * so a create and a replace can never disagree about what a body holds.
 */
export function requestBodyFrom(representation, set = {}) {
  return {
    monitorType: representation.monitorType,
    name: representation.name,
    url: representation.url,
    expectedStatus: representation.expectedStatus,
    expectedBody: representation.expectedBody,
    interval: representation.interval,
    timeout: representation.timeout,
    project: representation.projectID,
    ...set,
  };
}
