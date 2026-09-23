// ─────────────────────────────────────────────────────────────────────────────
// ops-bounded-retry.test.mjs — ONE dropped connection is not a verdict, an
// OUTAGE still is, and the tree holds exactly ONE reading of the difference.
//
// tooling/ops/bounded-retry.mjs is the shared half of row
// O-PAGES-FETCH-TRANSIENT-NOT-RETRIED. #852 fixed check-pages-deployments.mjs
// alone and recorded, in its own header, that ELEVEN more ops-watch readers had
// the same defect and that a shared module was the right home. This suite covers
// the module and the ADOPTION — because a helper nobody calls is a helper that
// cannot fail, and "eleven readers now import it" is exactly the claim that rots.
//
//   B1  the plan: the gaps, the summed ceiling, the derived wall ceiling
//   B2  classification: what is re-asked and what is an ANSWER
//   B3  transport failures, including the measured `TypeError: fetch failed`
//   B4  `Retry-After`: both RFC forms, clamped, and never faster than the plan
//   B5  the loop: transient-then-success is ok, persistent is COULD NOT LOOK
//   B6  the loop never swallows: the exhausted error is a plain CouldNotLook
//   B7  fetchWithBoundedRetry, the whole rule in one call
//   B8  ADOPTION — every reader in the class imports it, CALLS it, and no
//       rival reading of "is this transient?" survives anywhere in tooling/ops/
//   B9  status.mjs: unreached is exit 2, unhealthy is still exit 1
//
//   B10 the three Cloudflare readers, driven through their own `cf()`
//   B11 the class beyond ops-watch
//   B12 ⏱ 2026-09-22: the per-request ceiling. A read that never answers still
//       ends. B12 uses a REAL timer of a few ms, because the ceiling IS a timer;
//       it still touches no network.
//
// ── MUTATION PROOF, GREEN CONTROL FIRST, EACH RESTORED BYTE-EXACT ───────────
// Predictions written before each run. NINE of ten behaved as predicted; the
// tenth did not, and that is recorded rather than smoothed over, because it is
// the reason B10 exists at all.
//   · `isTransientLook` forced to `true`  (ALWAYS retry)   → 5 RED in B2/B3/B5
//   · `isTransientLook` forced to `false` (NEVER retry)    → 20 RED across B2–B7
//   · `isTransientStatus` widened to `status >= 400`       → B2 and B7 RED
//   · the exhausted throw replaced by `return []`          → 10 RED, B5 and B6
//   · `Math.max(gaps[i], asked)` → `asked`                 → 5 RED in B4/B5
//   · status.mjs's `kind === 'unreached'` bucket deleted   → ops-status.test.mjs
//     RED (exit 1 where 2 is owed) — and THIS suite stayed green, which is why
//     that case lives beside it rather than only here
//   · status.mjs's probeLive `classifyThrown` → `new Error`  → B9 RED
//   · check-turnstile-hosts.mjs re-asking a 403             → B10 RED
//   · check-retired-names-live.mjs forced to `attempts: 1`  → B10 RED
//
// 🔴 THE ONE THAT DID NOT FIRE, AND WHAT IT BOUGHT. Mutating
// check-wildcard-dns.mjs's `classifyThrown` back to a bare `new CouldNotLook` —
// so a dropped connection was re-asked ZERO times — passed B1–B9 IN FULL and
// passed that file's own 13 cases. An import is not a behaviour, and "it imports
// the shared module" is exactly the claim a refactor leaves true while the
// behaviour walks away. So each of the three readers took a `doFetch` seam and
// is now driven through it in B10; the same mutation, re-run against B10, went
// RED on two cases. The gap was measured, not reasoned about.
//
// ⚠️ NO TEST HERE TOUCHES THE NETWORK, and that is not tidiness: a test that
// needs a socket fails on exactly the blip this module exists to absorb. Every
// case injects `fetch`, `sleep` and the clock.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CouldNotLook,
  transientLook,
  isTransientLook,
  isTransientStatus,
  isTransportFailure,
  isSafeMethod,
  classifyThrown,
  backoffPlan,
  retryAfterMs,
  readWithBoundedRetry,
  fetchWithBoundedRetry,
  READ_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_CEILING_MS,
  RETRY_AFTER_CEILING_MS,
  RETRY_WALL_CEILING_MS,
  REQUEST_TIMEOUT_MS,
  READ_WALL_CEILING_MS,
  requestTimeoutMs,
} from '../../ops/bounded-retry.mjs';
import { probeLive, evaluateSurface, EXIT_UNHEALTHY, EXIT_CANNOT_LOOK } from '../../ops/status.mjs';
import { cf as cfWildcard } from '../../ops/check-wildcard-dns.mjs';
import { cf as cfTurnstile } from '../../ops/check-turnstile-hosts.mjs';
import { cf as cfRetired } from '../../ops/check-retired-names-live.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPS = resolve(HERE, '..', '..', 'ops');

/** A sleep that RECORDS instead of waiting, so the bound is PROVEN rather than
 *  spent. Every loop case injects this; none of them takes a real second. */
const recorder = () => {
  const slept = [];
  return { slept, sleep: async (ms) => void slept.push(ms) };
};

/** The smallest thing that answers `res.headers.get()` — a Response stub needs
 *  nothing else here, and building a real one would need a real body. */
const answer = (status, headers = {}) => ({
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B1 — the plan is arithmetic, and every ceiling is DERIVED from it', () => {
  test('three attempts at 1000 ms give two doubling gaps', () => {
    assert.deepEqual(backoffPlan(3, 1000), [1000, 2000]);
    assert.deepEqual(backoffPlan(READ_ATTEMPTS, RETRY_BASE_MS), [1000, 2000]);
  });

  test('N attempts give N-1 gaps — nothing is waited for after the last try', () => {
    for (const n of [1, 2, 3, 5]) assert.equal(backoffPlan(n, 100).length, Math.max(0, n - 1));
  });

  test('RETRY_CEILING_MS is the SUM of the plan, not a second copy of it', () => {
    assert.equal(RETRY_CEILING_MS, backoffPlan().reduce((a, b) => a + b, 0));
    assert.equal(RETRY_CEILING_MS, 3000);
  });

  test('RETRY_WALL_CEILING_MS is DERIVED from the attempts and the Retry-After clamp', () => {
    assert.equal(RETRY_WALL_CEILING_MS, (READ_ATTEMPTS - 1) * RETRY_AFTER_CEILING_MS);
  });

  test('the numbers are the ones #852 proved, so adopting the module moves no behaviour', () => {
    assert.equal(READ_ATTEMPTS, 3);
    assert.equal(RETRY_BASE_MS, 1000);
  });

  test('a nonsense plan is EMPTY rather than infinite — zero, negative, fractional', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) assert.deepEqual(backoffPlan(bad, 1000), []);
    assert.deepEqual(backoffPlan(3, -1), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B2 — what is re-asked, and what is an ANSWER', () => {
  test('GREEN CONTROL — a marked transient IS re-asked', () => {
    assert.equal(isTransientLook(transientLook('the wire dropped')), true);
  });

  test('🔴 RED CONTROL — a plain CouldNotLook is an ANSWER and is NOT re-asked', () => {
    assert.equal(isTransientLook(new CouldNotLook('HTTP 403: Authentication error')), false);
  });

  test('a message is never enough — classification is MARKED at the throw site', () => {
    // The exact text `transientLook` would have produced, thrown as a plain
    // CouldNotLook. If the predicate ever went back to matching on words, this
    // would be re-asked; it must not be.
    assert.equal(isTransientLook(new CouldNotLook('the request did not answer (TypeError: fetch failed)')), false);
  });

  test('429 and 5xx are "not now"', () => {
    for (const s of [429, 500, 502, 503, 504, 599]) assert.equal(isTransientStatus(s), true, `HTTP ${s}`);
  });

  test('🔴 RED CONTROL — every other 4xx is an ANSWER: retrying a 404 only spends the ceiling', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) assert.equal(isTransientStatus(s), false, `HTTP ${s}`);
  });

  test('2xx and 3xx are not transient either — a success is not a thing to re-ask', () => {
    for (const s of [200, 204, 301, 304]) assert.equal(isTransientStatus(s), false, `HTTP ${s}`);
  });

  test('a non-status is not transient — an API shape change is not a blip', () => {
    for (const s of [undefined, null, 'oops', 5.5]) assert.equal(isTransientStatus(s), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B3 — transport failures, including the one that was MEASURED', () => {
  test('🔴 `TypeError: fetch failed` — the failure ops-watch run 35478397730 hit', () => {
    assert.equal(isTransportFailure(new TypeError('fetch failed')), true);
  });

  test('the real reason hangs off `.cause`, and the chain is walked', () => {
    const e = new TypeError('fetch failed');
    e.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    assert.equal(isTransportFailure(e), true);
  });

  test('the named connection-level codes', () => {
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET']) {
      assert.equal(isTransportFailure(Object.assign(new Error('x'), { code })), true, code);
    }
  });

  test('an abort is a transport failure — a probe the runner gave up on saw nothing either', () => {
    assert.equal(isTransportFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
    assert.equal(isTransportFailure(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), true);
  });

  test('🔴 RED CONTROL — a PROGRAMMING TypeError is NOT a blip', () => {
    // The shape a bug in a reader produces. Re-asking it three times makes the
    // log longer and changes nothing.
    assert.equal(isTransportFailure(new TypeError("Cannot read properties of undefined (reading 'id')")), false);
  });

  test('🔴 RED CONTROL — an ordinary Error is not the wire', () => {
    assert.equal(isTransportFailure(new Error('success:false')), false);
    assert.equal(isTransportFailure(null), false);
    assert.equal(isTransportFailure('a string'), false);
  });

  test('classifyThrown routes each one to the right class', () => {
    assert.equal(isTransientLook(classifyThrown(new TypeError('fetch failed'), 'msg')), true);
    const answered = classifyThrown(new Error('not JSON'), 'msg');
    assert.ok(answered instanceof CouldNotLook);
    assert.equal(isTransientLook(answered), false);
  });

  test('only safe methods are re-asked unless a caller says otherwise', () => {
    assert.equal(isSafeMethod('GET'), true);
    assert.equal(isSafeMethod('get'), true);
    assert.equal(isSafeMethod(undefined), true);
    assert.equal(isSafeMethod('PUT'), false);
    assert.equal(isSafeMethod('POST'), false);
    // The D1 and GlitchTip reads are POSTs that ARE reads; the decision is the
    // caller's to record, which is what the parameter is for.
    assert.equal(isSafeMethod('POST', ['GET', 'POST']), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B4 — Retry-After is honoured, clamped, and never makes us ask FASTER', () => {
  test('delta-seconds', () => {
    assert.equal(retryAfterMs(answer(429, { 'retry-after': '3' })), 3000);
  });

  test('an HTTP-date, against an injected clock', () => {
    const now = Date.parse('2026-09-21T10:00:00Z');
    assert.equal(retryAfterMs(answer(429, { 'retry-after': 'Mon, 21 Sep 2026 10:00:04 GMT' }), { now }), 4000);
  });

  test('CLAMPED to the stated ceiling — an honoured header is not an unbounded wait', () => {
    assert.equal(retryAfterMs(answer(429, { 'retry-after': '600' })), RETRY_AFTER_CEILING_MS);
  });

  test('absent, unreadable, negative or already past all answer null — the plan stays in charge', () => {
    assert.equal(retryAfterMs(answer(429)), null);
    assert.equal(retryAfterMs(answer(429, { 'retry-after': '' })), null);
    assert.equal(retryAfterMs(answer(429, { 'retry-after': 'soon' })), null);
    assert.equal(retryAfterMs(answer(429, { 'retry-after': '-5' })), null);
    const now = Date.parse('2026-09-21T10:00:00Z');
    assert.equal(retryAfterMs(answer(429, { 'retry-after': 'Mon, 21 Sep 2026 09:59:00 GMT' }), { now }), null);
  });

  test('a response with no headers at all does not throw', () => {
    assert.equal(retryAfterMs({ status: 429 }), null);
    assert.equal(retryAfterMs(undefined), null);
  });

  test('🔴 a server asking for LONGER slows us down', async () => {
    const { slept, sleep } = recorder();
    await assert.rejects(
      readWithBoundedRetry(async () => {
        throw transientLook('HTTP 429', { retryAfterMs: 4000 });
      }, { sleep }),
      (e) => e instanceof CouldNotLook,
    );
    assert.deepEqual(slept, [4000, 4000], 'the server asked for 4 s and got 4 s, not the plan’s 1 s and 2 s');
  });

  test('🔴 RED CONTROL — a server asking for LESS can never speed us up', async () => {
    const { slept, sleep } = recorder();
    await assert.rejects(
      readWithBoundedRetry(async () => {
        throw transientLook('HTTP 429', { retryAfterMs: 1 });
      }, { sleep }),
      (e) => e instanceof CouldNotLook,
    );
    assert.deepEqual(slept, [1000, 2000], 'the plan’s own gaps must survive a header asking for less');
  });

  test('no header at all leaves the plan exactly as it was', async () => {
    const { slept, sleep } = recorder();
    await assert.rejects(
      readWithBoundedRetry(async () => {
        throw transientLook('the wire dropped');
      }, { sleep }),
      (e) => e instanceof CouldNotLook,
    );
    assert.deepEqual(slept, [1000, 2000]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B5 — a blip is not an outage, and an outage is not a pass', () => {
  test('GREEN CONTROL — a read that works first time is not slept on at all', async () => {
    const { slept, sleep } = recorder();
    assert.equal(await readWithBoundedRetry(async () => 'rows', { sleep }), 'rows');
    assert.deepEqual(slept, []);
  });

  test('🔴 a transient failure FOLLOWED BY A SUCCESS reads as ok — the measured case', async () => {
    const { slept, sleep } = recorder();
    let n = 0;
    const got = await readWithBoundedRetry(
      async () => {
        n += 1;
        if (n === 1) throw transientLook('TypeError: fetch failed');
        return 'rows';
      },
      { sleep },
    );
    assert.equal(got, 'rows');
    assert.equal(n, 2);
    assert.deepEqual(slept, [1000], 'one gap, because one attempt failed');
  });

  test('a failure on the second attempt is still recovered by the third', async () => {
    let n = 0;
    const got = await readWithBoundedRetry(
      async () => {
        n += 1;
        if (n < 3) throw transientLook('HTTP 503');
        return 'rows';
      },
      { sleep: async () => {} },
    );
    assert.equal(got, 'rows');
    assert.equal(n, READ_ATTEMPTS);
  });

  test('🔴 A PERSISTENT FAILURE IS STILL COULD NOT LOOK, NEVER A PASS', async () => {
    let n = 0;
    await assert.rejects(
      readWithBoundedRetry(
        async () => {
          n += 1;
          throw transientLook('TypeError: fetch failed');
        },
        { sleep: async () => {} },
      ),
      (e) => e instanceof CouldNotLook && /all 3 attempt\(s\)/.test(e.message),
    );
    assert.equal(n, READ_ATTEMPTS, 'the bound BINDS — three attempts, not four and not forever');
  });

  test('the plan is BOUNDED — the sleeps are the plan and nothing more', async () => {
    const { slept, sleep } = recorder();
    await assert.rejects(
      readWithBoundedRetry(async () => { throw transientLook('down'); }, { sleep }),
      (e) => e instanceof CouldNotLook,
    );
    assert.equal(
      slept.reduce((a, b) => a + b, 0),
      RETRY_CEILING_MS,
      'a run that slept more than the stated ceiling has a ceiling that describes nothing',
    );
  });

  test('nothing is slept on AFTER the final failure — that time buys nothing', async () => {
    const { slept, sleep } = recorder();
    await assert.rejects(
      readWithBoundedRetry(async () => { throw transientLook('down'); }, { sleep }),
      (e) => e instanceof CouldNotLook,
    );
    assert.equal(slept.length, READ_ATTEMPTS - 1);
  });

  test('🔴 RED CONTROL — an ANSWER escapes on the FIRST attempt', async () => {
    const { slept, sleep } = recorder();
    let n = 0;
    await assert.rejects(
      readWithBoundedRetry(
        async () => {
          n += 1;
          throw new CouldNotLook('answered HTTP 403: Authentication error');
        },
        { sleep },
      ),
      (e) => e instanceof CouldNotLook && /403/.test(e.message),
    );
    assert.equal(n, 1, 'a revoked token does not improve in two seconds');
    assert.deepEqual(slept, []);
  });

  test('🔴 RED CONTROL — a bug in the reader escapes at once and is not disguised', async () => {
    let n = 0;
    await assert.rejects(
      readWithBoundedRetry(async () => {
        n += 1;
        throw new TypeError("Cannot read properties of undefined (reading 'id')");
      }),
      (e) => e instanceof TypeError,
    );
    assert.equal(n, 1);
  });

  test('the retry is SAID OUT LOUD — a run that needed one is not silently clean', async () => {
    const notes = [];
    let n = 0;
    await readWithBoundedRetry(
      async () => {
        n += 1;
        if (n === 1) throw transientLook('fetch failed');
        return 'ok';
      },
      { sleep: async () => {}, note: (m) => notes.push(m) },
    );
    assert.equal(notes.length, 1);
    assert.match(notes[0], /attempt 1\/3 failed/);
    assert.match(notes[0], /re-asking in 1s/);
  });

  test('attempts: 1 is honest — one try, no gaps, and still not a pass', async () => {
    const { slept, sleep } = recorder();
    await assert.rejects(
      readWithBoundedRetry(async () => { throw transientLook('down'); }, { sleep, attempts: 1 }),
      (e) => e instanceof CouldNotLook && /all 1 attempt\(s\)/.test(e.message),
    );
    assert.deepEqual(slept, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B6 — the exhausted failure is never swallowed, and never re-loops', () => {
  test('the thrown error SAYS why an outage is not forgiven', async () => {
    const e = await readWithBoundedRetry(
      async () => { throw transientLook('HTTP 503'); },
      { sleep: async () => {} },
    ).catch((x) => x);
    assert.match(e.message, /is an OUTAGE, not a blip, so this is COULD NOT LOOK and not a pass/);
  });

  test('🔴 it is a PLAIN CouldNotLook — an exhausted failure cannot be sent round a second loop', async () => {
    const e = await readWithBoundedRetry(
      async () => { throw transientLook('HTTP 503'); },
      { sleep: async () => {} },
    ).catch((x) => x);
    assert.ok(e instanceof CouldNotLook);
    assert.equal(isTransientLook(e), false, 'a caller that re-wraps must not get an infinite retry');
  });

  test('🔴 RED CONTROL — the exhausted path does not return a value', async () => {
    // The mutation "return [] when the plan is exhausted" is the shape that turns
    // a Cloudflare outage into a green sweep. Nothing may come back from here.
    let returned = Symbol('nothing');
    try {
      returned = await readWithBoundedRetry(async () => { throw transientLook('down'); }, { sleep: async () => {} });
      assert.fail(`the exhausted plan RETURNED ${JSON.stringify(returned)} instead of throwing`);
    } catch (e) {
      assert.ok(e instanceof CouldNotLook);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B7 — fetchWithBoundedRetry: the whole rule in one call', () => {
  test('GREEN CONTROL — a 200 comes straight back', async () => {
    const res = await fetchWithBoundedRetry(async () => answer(200), { sleep: async () => {} });
    assert.equal(res.status, 200);
  });

  test('a 429 then a 200 reads as ok', async () => {
    let n = 0;
    const res = await fetchWithBoundedRetry(
      async () => (n++ === 0 ? answer(429) : answer(200)),
      { sleep: async () => {} },
    );
    assert.equal(res.status, 200);
    assert.equal(n, 2);
  });

  test('a dropped wire then a 200 reads as ok', async () => {
    let n = 0;
    const res = await fetchWithBoundedRetry(
      async () => {
        if (n++ === 0) throw new TypeError('fetch failed');
        return answer(200);
      },
      { sleep: async () => {} },
    );
    assert.equal(res.status, 200);
  });

  test('🔴 a persistent 503 is COULD NOT LOOK, never a Response to grade', async () => {
    await assert.rejects(
      fetchWithBoundedRetry(async () => answer(503), { sleep: async () => {} }),
      (e) => e instanceof CouldNotLook && /all 3 attempt\(s\)/.test(e.message),
    );
  });

  test('🔴 RED CONTROL — a 403 comes back as a RESPONSE on the first attempt', async () => {
    let n = 0;
    const res = await fetchWithBoundedRetry(
      async () => {
        n += 1;
        return answer(403);
      },
      { sleep: async () => {} },
    );
    assert.equal(res.status, 403, 'the caller grades an answer; the helper does not hide it');
    assert.equal(n, 1);
  });

  test('`describe` keeps each reader’s own wording', async () => {
    const e = await fetchWithBoundedRetry(async () => answer(503), {
      sleep: async () => {},
      describe: (why) => `the monitor list: ${why}`,
    }).catch((x) => x);
    assert.match(e.message, /the monitor list: the request answered HTTP 503/);
  });

  test('a Retry-After on the response reaches the loop', async () => {
    const { slept, sleep } = recorder();
    await assert.rejects(
      fetchWithBoundedRetry(async () => answer(429, { 'retry-after': '4' }), { sleep }),
      (e) => e instanceof CouldNotLook,
    );
    assert.deepEqual(slept, [4000, 4000]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B8 — ADOPTION: the class imports it, and no rival reading exists', () => {
  // 🔴 THE SUBJECT SET IS DERIVED, NEVER LISTED. A hand-written list here would
  // be a second copy of "which readers talk to the network", and the copy is the
  // one that rots: a twelfth reader added next month would be "covered" by a
  // suite that has never heard of it. So the tree is read.
  const readers = readdirSync(OPS)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.d.mts'))
    .map((f) => ({ name: f, src: readFileSync(join(OPS, f), 'utf8') }))
    .filter(({ name }) => name !== 'bounded-retry.mjs');

  /**
   * Does this file touch the network AT ALL?
   *
   * 🔴 IT WAS `/\bfetch\(/` AND THAT WENT BLIND ON THE FILES THIS CHANGE FIXED.
   * Measured 2026-09-21: `status.mjs` and `check-pages-deployments.mjs` both
   * answer ZERO to `\bfetch\(` — because the `doFetch` test seam renamed the call
   * site, and `\b` does not match inside `doFetch(`. So the sweep that decides
   * "which readers must not hold a rival retry" silently stopped covering the two
   * readers this row cares about most. A private `ATTEMPTS` added to either would
   * not have been caught.
   *
   * The lesson is not "add doFetch to the regex": it is that ONE spelling is not
   * a measurement. A sibling lane undercounted a row by two on exactly this shape
   * — a `Date.parse` grep that could not see `new Date('20…')`. Every mechanism a
   * reader here could reach the network by is listed, and the list is asserted
   * NON-EMPTY per mechanism that exists, so a new one cannot join silently.
   */
  const TOUCHES_NETWORK = [
    /\bfetch\s*\(/, // the plain call
    /\bdoFetch\s*\(/, // the injected seam this change introduced
    // ⏱ 2026-09-22: `}` joined the class. provision-apple.mjs binds
    // `fetchImpl = fetch }` as a destructuring default, which the `[;,)\n]` form
    // could not see, so that reader was outside every limb of this block.
    /=\s*(globalThis\.)?fetch\s*[;,)}\n]/, // fetch bound to another name
    /from ['"]node:https?['"]/, // the stdlib clients
    /\b(https?)\.(request|get)\s*\(/,
    /from ['"](undici|axios|got|node-fetch)['"]/,
    /['"`](curl|wget)\b/, // a shell reaching out
  ];
  const touchesNetwork = (src) => TOUCHES_NETWORK.some((re) => re.test(src));

  /** A reader that turns a network read into a run-level verdict: it reaches the
   *  network AND it decides an exit code. `record-deployment.mjs` and the
   *  uploaders perform ACTIONS rather than reporting verdicts, and are excluded
   *  BY THAT TEST rather than by name. */
  const verdictReaders = readers.filter(
    ({ src }) => touchesNetwork(src) && /process\.exitCode|process\.exit\(|EXIT_CANNOT_LOOK/.test(src),
  );

  test('🔴 the network sweep REACHES the files this change fixed — one spelling is not a measurement', () => {
    // The regression control for the blindness above. Both of these hold a
    // `doFetch` seam and match `\bfetch\(` ZERO times; if the sweep narrows back
    // to one spelling, they drop out of every assertion in this block and the
    // rival-loop check goes quietly vacuous over them.
    for (const name of ['status.mjs', 'check-pages-deployments.mjs']) {
      const r = readers.find((x) => x.name === name);
      assert.ok(r, `${name} is gone from tooling/ops — this control lost its subject`);
      assert.equal(/\bfetch\(/.test(r.src), false, `${name} unexpectedly matches \`fetch(\` again — re-read this control`);
      assert.equal(touchesNetwork(r.src), true, `${name} reaches the network but the sweep cannot see it`);
      assert.ok(
        verdictReaders.some((x) => x.name === name),
        `${name} is a verdict reader and must be inside the swept set`,
      );
    }
  });

  test('the class is NOT EMPTY — a sweep over nothing prints the same ok as a complete one', () => {
    assert.ok(verdictReaders.length >= 10, `only ${verdictReaders.length} verdict readers found; the walk stopped reaching tooling/ops`);
  });

  test('🔴 EVERY ops-watch reader in the class imports the shared plan', () => {
    // The twelve steps ops-watch.yml runs. DERIVED from the workflow, so a reader
    // that joins the lane joins this assertion in the same change.
    const wf = readFileSync(resolve(OPS, '..', '..', '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    const invoked = [...wf.matchAll(/node tooling\/ops\/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]);
    const unique = [...new Set(invoked)];
    assert.ok(unique.length >= 12, `ops-watch.yml yielded ${unique.length} readers; the parse stopped working`);
    const missing = unique.filter((name) => {
      const r = readers.find((x) => x.name === name);
      return r && touchesNetwork(r.src) && !/from '\.\/bounded-retry\.mjs'/.test(r.src);
    });
    assert.deepEqual(missing, [], `these ops-watch readers still hold a private reading of "is this transient?"`);
  });

  /** The ONE reader whose loop is NOT a transient retry, with the reason, in the
   *  shape assert-guard-coverage.mjs's NOT_A_SCANNER uses. An exemption without a
   *  reason is an exemption that outlives its reason.
   *
   *  ⚠️ IT IS ASSERTED TO BE LIVE below, so a stale entry is a failure rather than
   *  a silent widening — the exact defect the `staleExemptions` limb of
   *  assert-guard-coverage.mjs exists for. */
  const NOT_A_TRANSIENT_RETRY = new Map([
    [
      'post-deploy-smoke.mjs',
      'its ATTEMPTS/GAP_MS loop is a PROPAGATION POLL, not a retry: it re-asks an answer that ' +
        'SUCCEEDED but is still serving the previous build, which is a different question from ' +
        '"was that a blip" and legitimately has different numbers (6 × 10 s ≈ one minute, sized to ' +
        'CDN propagation, against this module\'s 3 attempts over 3 s sized to one dropped socket). ' +
        'Folding the two together would either make a deploy smoke give up on propagation after ' +
        'three seconds or make every ops-watch reader wait a minute on a dead endpoint.',
    ],
  ]);

  test('the exemption is LIVE — a reason that outlived its file is not an exemption', () => {
    for (const name of NOT_A_TRANSIENT_RETRY.keys()) {
      const r = readers.find((x) => x.name === name);
      assert.ok(r, `${name} is exempted here but no longer exists in tooling/ops/`);
      assert.match(r.src, /^\s*const\s+ATTEMPTS\s*=/m, `${name} no longer has the loop it is exempted for`);
    }
  });

  test('🔴 IMPORTING IT IS NOT USING IT — every importer CALLS one of the two entry points', () => {
    // An import nothing calls is the shape a refactor leaves behind, and it reads
    // exactly like adoption from the outside. This is the wiring limb, the same
    // one run-page-anchor.test.mjs carries per caller: the BEHAVIOUR of the plan
    // is proven above and, end to end through a reader, in B9 and in
    // pages-deployments.test.mjs; this is what stops a reader quietly leaving.
    const wired = [];
    for (const { name, src } of readers) {
      if (!/from '\.\/bounded-retry\.mjs'/.test(src)) continue;
      // `export { … } from` is a re-export, not a call — it must not count.
      const uses = /readWithBoundedRetry\(|fetchWithBoundedRetry\(/.test(src);
      if (!uses) wired.push(name);
    }
    assert.deepEqual(wired, [], 'these readers import the shared plan and never run it');
  });

  test('🔴 NO RIVAL LOOP — no reader declares its own attempt count or its own transient predicate', () => {
    const rivals = [];
    for (const { name, src } of readers) {
      if (!touchesNetwork(src)) continue;
      if (NOT_A_TRANSIENT_RETRY.has(name)) continue;
      // The shapes a fork takes: a private attempts constant, a private status
      // predicate, or a private CouldNotLook class.
      if (/^\s*const\s+(ATTEMPTS|READ_ATTEMPTS|RETRY_ATTEMPTS)\s*=/m.test(src)) rivals.push(`${name}: a private attempt count`);
      if (/^\s*(const|function)\s+transientStatus\b/m.test(src)) rivals.push(`${name}: a private transient-status predicate`);
      if (/^\s*(export\s+)?class\s+CouldNotLook\b/m.test(src)) rivals.push(`${name}: a private CouldNotLook class`);
    }
    assert.deepEqual(rivals, [], 'two readings of "is this transient?" eventually disagree, silently');
  });

  test('the shared class is the ONE class — every reader re-exports it rather than declaring one', () => {
    for (const { name, src } of readers) {
      if (!/CouldNotLook/.test(src)) continue;
      assert.doesNotMatch(src, /^\s*(export\s+)?class\s+CouldNotLook\b/m, `${name} declares its own CouldNotLook`);
    }
  });

  // ── ⏱ APPENDED 2026-09-22: THE PER-REQUEST CEILING LIMB (row O-OPS-READER-NO-CEILING) ──
  // The retry plan bounds how many times a reader asks. It said nothing about
  // how long ONE ask may take, so a socket that accepted and never answered held
  // the job until its `timeout-minutes`. The helper now arms a ceiling per attempt
  // and hands the read a `signal`. That only helps a call that PASSES the signal
  // on, so the limb below checks every call site, not every import.

  /** The source with comments blanked out. Offsets and newlines are kept, so a
   *  line number means the same thing in both. String and regex literals are
   *  stepped over whole, so a `//` inside a URL is not a comment and a quote
   *  inside a regex does not open a string. */
  function blankComments(src) {
    let out = '';
    let i = 0;
    let prev = ''; // the last significant code character, to tell `/` (divide) from `/` (regex)
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '/' && n === '/') {
        while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; }
        continue;
      }
      if (c === '/' && n === '*') {
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i += 1; }
        out += '  ';
        i += 2;
        continue;
      }
      const regexStart = c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev)
        || /(?:^|[^\w$])(?:return|typeof|case|void|throw|yield|await|delete|in|of|else|do)\s*$/.test(out.slice(-24)));
      if (c === "'" || c === '"' || c === '`' || regexStart) {
        const close = c;
        let inClass = false;
        out += c;
        i += 1;
        while (i < src.length) {
          const d = src[i];
          out += d;
          i += 1;
          if (d === '\\') { out += src[i] ?? ''; i += 1; continue; }
          if (regexStart && d === '[') inClass = true;
          else if (regexStart && d === ']') inClass = false;
          else if (d === close && !inClass) break;
          else if (d === '\n' && close !== '`') break; // an unterminated literal ends at the line
        }
        prev = close;
        continue;
      }
      if (!/\s/.test(c)) prev = c;
      out += c;
      i += 1;
    }
    return out;
  }

  /** The argument list of the call whose `(` is at `open`, up to its matching `)`,
   *  with string contents dropped: a `signal` inside a message is not a signal. */
  function argsAt(code, open) {
    let depth = 0;
    let args = '';
    for (let i = open; i < code.length; i += 1) {
      const c = code[i];
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
        args += `${c}${c}`;
        i = j;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) return args.slice(1); }
      args += c;
    }
    return args.slice(1);
  }

  /** Every call to `fetch`, `doFetch`, or any name `fetch` is bound to, with its
   *  line and whether its argument list names `signal`. The aliases are read from
   *  the file (`X = fetch`, `X = globalThis.fetch`, a `fetchImpl = fetch` default),
   *  so the `f(url)` the TOUCHES_NETWORK list already knows about is a site here too. */
  function networkSites(src) {
    const code = blankComments(src);
    const aliases = new Set(['fetch', 'doFetch']);
    for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=\s*(?:globalThis\.)?fetch\b(?![\w$.])/g)) aliases.add(m[1]);
    const names = [...aliases].map((a) => a.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('|');
    const call = new RegExp(`(?<![\\w$])(?<!function\\s)(${names})\\s*\\(`, 'g');
    return [...code.matchAll(call)].map((m) => {
      const open = m.index + m[0].length - 1;
      return {
        line: code.slice(0, m.index).split('\n').length,
        callee: m[1],
        signal: /\bsignal\b/.test(argsAt(code, open)),
      };
    });
  }

  /** The files whose calls do NOT pass a signal, each with the reason. These are
   *  not ops-watch readers (measured 2026-09-22: no step of ops-watch.yml runs
   *  them), so row O-OPS-READER-NO-CEILING does not cover them. Each one is a
   *  named follow-on, not a pass.
   *
   *  ⚠️ LIVE, like NOT_A_TRANSIENT_RETRY: an entry whose file is gone, or whose
   *  every call now passes a signal, fails the test below. An exemption that
   *  outlived its reason would hide the next unbounded call in that file. */
  const NO_CEILING_YET = new Map([
    ['await-pr-checks.mjs', 'a laptop tool that waits on a PR; no workflow runs it. Follow-on.'],
    ['post-deploy-smoke.mjs', 'the Play-edit calls run in the deploy and submit workflows, not ops-watch; each job has its own timeout-minutes. Its probe calls already pass a signal. Follow-on.'],
    ['provision-apple.mjs', 'App Store Connect provisioning, run by ci.yml, not ops-watch. Only visible here since `}` joined TOUCHES_NETWORK (2026-09-22). Follow-on.'],
    ['safe-rerun.mjs', 'run by ci.yml to re-run a failed job, not by ops-watch. Follow-on.'],
    ['set-monitor-thresholds.mjs', 'a one-off writer run by hand; no workflow runs it. Follow-on.'],
    ['triage-failed-runs.mjs', 'a laptop triage tool; no workflow runs it. Follow-on.'],
    ['verify-password-reset-revokes.mjs', 'a hand-run proof against a live project (B11 records why it is not converted). Follow-on.'],
  ]);

  const sitesByFile = readers
    .filter(({ src }) => touchesNetwork(src))
    .map(({ name, src }) => ({ name, sites: networkSites(src) }));

  test('🔴 EVERY network call under tooling/ops passes the signal, or its file is a LIVE exemption', () => {
    const unbounded = [];
    let checked = 0;
    for (const { name, sites } of sitesByFile) {
      checked += sites.length;
      if (NO_CEILING_YET.has(name)) continue;
      for (const s of sites) if (!s.signal) unbounded.push(`tooling/ops/${name}:${s.line} ${s.callee}(…) names no signal`);
    }
    const exempted = sitesByFile.filter(({ name }) => NO_CEILING_YET.has(name)).reduce((n, f) => n + f.sites.filter((s) => !s.signal).length, 0);
    console.log(`# per-request ceiling: ${checked} network call sites checked in ${sitesByFile.length} files; ${exempted} unsignalled sites in ${NO_CEILING_YET.size} exempted files`);
    assert.ok(checked >= 20, `only ${checked} call sites found; the site finder stopped reaching tooling/ops`);
    assert.deepEqual(unbounded, [], 'a call that drops the signal has no per-request ceiling: one silent socket holds the job until timeout-minutes');
  });

  test('🔴 every file the sweep says touches the network has a call site the limb can check', () => {
    // A file that reaches the network by a mechanism the site finder cannot
    // parse (node:https, a curl child) would pass the limb above with zero
    // sites. This is the NON-EMPTY rule applied per file.
    const blind = sitesByFile.filter(({ sites }) => sites.length === 0).map(({ name }) => name);
    assert.deepEqual(blind, [], 'these files touch the network but no fetch-like call was found in them');
  });

  test('the no-ceiling exemptions are LIVE: the file exists and still holds an unsignalled call', () => {
    for (const name of NO_CEILING_YET.keys()) {
      const f = sitesByFile.find((x) => x.name === name);
      assert.ok(f, `${name} is exempted here but is gone from tooling/ops, or no longer touches the network`);
      assert.ok(f.sites.some((s) => !s.signal), `${name}: every call passes a signal now; remove its exemption`);
    }
  });

  test('🔴 NO RIVAL CEILING: no importer of the shared plan arms its own timer', () => {
    // Two ceilings on one request disagree the same way two retry loops do. The
    // three 20 s ceilings and status.mjs's own AbortSignal.timeout were folded
    // into the helper on 2026-09-22; status.mjs keeps its 10 s by passing
    // `timeoutMs`, which can only shorten the shared ceiling.
    const rivals = [];
    for (const { name, src } of readers) {
      if (!/from '\.\/bounded-retry\.mjs'/.test(src)) continue;
      const code = blankComments(src);
      if (/AbortSignal\.timeout\s*\(/.test(code)) rivals.push(`${name}: AbortSignal.timeout(`);
      if (/new\s+AbortController\s*\(/.test(code)) rivals.push(`${name}: new AbortController(`);
    }
    assert.deepEqual(rivals, [], 'pass the signal the helper hands you, or its timeoutMs option; never a second timer');
  });

  test('the module states its numbers AND why they are those numbers', () => {
    const src = readFileSync(join(OPS, 'bounded-retry.mjs'), 'utf8');
    // Not prose-matching for its own sake: the row's closes clause requires "a
    // small, STATED number of attempts and a STATED ceiling", and a constant
    // whose reason is nowhere is the magic constant it forbids.
    assert.match(src, /READ_ATTEMPTS = 3, RETRY_BASE_MS = 1000/);
    assert.match(src, /RETRY_AFTER_CEILING_MS = 5000\./);
    assert.match(src, /timeout-minutes: 5/, 'the Retry-After clamp must show the arithmetic it fits inside');
    // ⏱ 2026-09-22: the per-request ceiling states its number and its sum too.
    assert.match(src, /REQUEST_TIMEOUT_MS = 15 000./);
    assert.match(src, /READ_WALL_CEILING_MS is DERIVED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B9 — status.mjs: UNREACHED is exit 2, UNHEALTHY is still exit 1', () => {
  const surface = { hostname: 'api.example.test', url: 'https://api.example.test/h', expectedStatus: 200, dataBearing: false, monitorId: 9 };

  test('🔴 a probe that never answered is its OWN kind, and it is not "unreachable"', () => {
    const v = evaluateSurface(surface, { unreached: 'fetch failed' });
    assert.equal(v.ok, false, 'it is never a skip and never a pass');
    assert.equal(v.kind, 'unreached');
    assert.match(v.reason, /NOTHING ANSWERED/);
  });

  test('🔴 RED CONTROL — a surface that ANSWERED the wrong status is still a FINDING', () => {
    const v = evaluateSurface(surface, { status: 503, body: 'down' });
    assert.equal(v.ok, false);
    assert.notEqual(v.kind, 'unreached', 'a 503 is an answer: the thing is broken, and that is exit 1');
    assert.equal(v.kind, 'status');
  });

  test('GREEN CONTROL — the expected status still passes', () => {
    assert.equal(evaluateSurface(surface, { status: 200, body: '' }).ok, true);
  });

  test('the two exit codes are distinct, and the file says which is which', () => {
    assert.equal(EXIT_UNHEALTHY, 1);
    assert.equal(EXIT_CANNOT_LOOK, 2);
  });

  test('🔴 probeLive: a dropped connection FOLLOWED BY A SUCCESS is a normal answer', async () => {
    let n = 0;
    const probe = await probeLive(surface, {
      sleep: async () => {},
      doFetch: async () => {
        n += 1;
        if (n === 1) throw new TypeError('fetch failed');
        return { status: 200, text: async () => '{"ok":true}' };
      },
    });
    assert.deepEqual(probe, { status: 200, body: '{"ok":true}' });
    assert.equal(evaluateSurface(surface, probe).ok, true);
  });

  test('🔴 probeLive: a connection that NEVER answers is `unreached`, after the bound binds', async () => {
    let n = 0;
    const probe = await probeLive(surface, {
      sleep: async () => {},
      doFetch: async () => {
        n += 1;
        throw new TypeError('fetch failed');
      },
    });
    assert.equal(n, READ_ATTEMPTS);
    assert.ok(probe.unreached, `expected unreached, got ${JSON.stringify(probe)}`);
    assert.equal(evaluateSurface(surface, probe).kind, 'unreached');
  });

  test('🔴 RED CONTROL — probeLive does NOT re-ask an answer: a 502 is graded on first sight', async () => {
    let n = 0;
    const probe = await probeLive(surface, {
      sleep: async () => {},
      doFetch: async () => {
        n += 1;
        return { status: 502, text: async () => 'bad gateway' };
      },
    });
    assert.equal(n, 1, 'a 502 IS the symptom this reader grades; re-asking it only delays the red');
    assert.equal(probe.status, 502);
    assert.equal(evaluateSurface(surface, probe).kind, 'status');
  });

  test('a body that dies MID-READ is the wire dropping, and is re-asked', async () => {
    let n = 0;
    const probe = await probeLive(surface, {
      sleep: async () => {},
      doFetch: async () => {
        n += 1;
        return {
          status: 200,
          text: async () => {
            if (n === 1) throw Object.assign(new Error('terminated'), { code: 'UND_ERR_SOCKET' });
            return '{"ok":true}';
          },
        };
      },
    });
    assert.equal(probe.body, '{"ok":true}');
    assert.equal(n, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B10 — THE THREE CLOUDFLARE READERS, DRIVEN THROUGH THEIR OWN `cf()`.
//
// 🔴 THIS BLOCK EXISTS BECAUSE THE IMPORT-SHAPED ASSERTIONS ABOVE WERE MEASURED
// INSUFFICIENT. On 2026-09-21 a mutation that put a bare `new CouldNotLook` back
// at check-wildcard-dns.mjs's throw site — so a dropped connection was re-asked
// ZERO times — passed B8 in full and passed that file's own 13 cases. An import
// is not a behaviour. Each reader now takes a `doFetch` and is driven here.
//
// The three are asserted SEPARATELY rather than in a loop over a list, because
// the whole point is that each one really calls the shared plan; a loop that
// took the function from a table would pass if two of the three were the same
// function.
// ─────────────────────────────────────────────────────────────────────────────
describe('B10 — the Cloudflare readers re-ask a blip and still refuse an outage', () => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const bad = (status) => ({
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({ success: false }),
    text: async () => `HTTP ${status}`,
  });
  const BODY = { success: true, result: [{ id: 'z' }] };

  // What a good read returns: check-wildcard-dns hands back the whole body, the
  // other two unwrap `.result`.
  const whole = (b) => b;
  const result = (b) => b.result;

  // ⏱ 2026-09-21 — FIVE CHECKS, FIFTEEN DECLARATIONS, NO LOOP. These were once
  // declared inside a `for` over a table, which assert-no-loop-cases.mjs refuses:
  // a loop is ONE declaration to coverage-manifest.json however many readers it
  // iterates, so dropping a reader from the table would delete three cases the
  // ratchet could not see. The checks are shared functions; every case below is
  // its own `test(`, and each names its reader's `cf` directly.
  async function greenControl(cf, unwrap) {
    let n = 0;
    const got = await cf('/zones', 't', {
      sleep: async () => {},
      doFetch: async () => {
        n += 1;
        return ok(BODY);
      },
    });
    assert.deepEqual(got, unwrap(BODY));
    assert.equal(n, 1);
  }

  async function blipThenSuccess(cf, unwrap) {
    let n = 0;
    const got = await cf('/zones', 't', {
      sleep: async () => {},
      doFetch: async () => {
        n += 1;
        if (n === 1) throw new TypeError('fetch failed');
        return ok(BODY);
      },
    });
    assert.deepEqual(got, unwrap(BODY));
    assert.equal(n, 2, 'the blip must be re-asked exactly once, not zero times and not five');
  }

  async function persistentIsCouldNotLook(cf) {
    let n = 0;
    await assert.rejects(
      cf('/zones', 't', {
        sleep: async () => {},
        doFetch: async () => {
          n += 1;
          throw new TypeError('fetch failed');
        },
      }),
      (e) => e instanceof CouldNotLook && /all 3 attempt\(s\)/.test(e.message),
    );
    assert.equal(n, READ_ATTEMPTS);
  }

  async function rateLimitThenSuccess(cf, unwrap) {
    let n = 0;
    const got = await cf('/zones', 't', {
      sleep: async () => {},
      doFetch: async () => (n++ === 0 ? bad(429) : ok(BODY)),
    });
    assert.deepEqual(got, unwrap(BODY));
    assert.equal(n, 2);
  }

  async function forbiddenIsNotReasked(cf) {
    let n = 0;
    await assert.rejects(
      cf('/zones', 't', {
        sleep: async () => {},
        doFetch: async () => {
          n += 1;
          return bad(403);
        },
      }),
      (e) => e instanceof CouldNotLook && /403/.test(e.message),
    );
    assert.equal(n, 1, 'a revoked token does not improve in two seconds');
  }

  // ── check-wildcard-dns ─────────────────────────────────────────────────────
  test('check-wildcard-dns — GREEN CONTROL: one clean read, one attempt', () => greenControl(cfWildcard, whole));
  test('🔴 check-wildcard-dns — a dropped connection FOLLOWED BY A SUCCESS reads as ok', () =>
    blipThenSuccess(cfWildcard, whole));
  test('🔴 check-wildcard-dns — a PERSISTENT failure is still COULD NOT LOOK, never a pass', () =>
    persistentIsCouldNotLook(cfWildcard));
  test('check-wildcard-dns — a 429 then a success reads as ok', () => rateLimitThenSuccess(cfWildcard, whole));
  test('🔴 RED CONTROL — check-wildcard-dns does NOT re-ask a 403: an answer is an answer', () =>
    forbiddenIsNotReasked(cfWildcard));

  // ── check-turnstile-hosts ──────────────────────────────────────────────────
  test('check-turnstile-hosts — GREEN CONTROL: one clean read, one attempt', () => greenControl(cfTurnstile, result));
  test('🔴 check-turnstile-hosts — a dropped connection FOLLOWED BY A SUCCESS reads as ok', () =>
    blipThenSuccess(cfTurnstile, result));
  test('🔴 check-turnstile-hosts — a PERSISTENT failure is still COULD NOT LOOK, never a pass', () =>
    persistentIsCouldNotLook(cfTurnstile));
  test('check-turnstile-hosts — a 429 then a success reads as ok', () => rateLimitThenSuccess(cfTurnstile, result));
  test('🔴 RED CONTROL — check-turnstile-hosts does NOT re-ask a 403: an answer is an answer', () =>
    forbiddenIsNotReasked(cfTurnstile));

  // ── check-retired-names-live ───────────────────────────────────────────────
  test('check-retired-names-live — GREEN CONTROL: one clean read, one attempt', () => greenControl(cfRetired, result));
  test('🔴 check-retired-names-live — a dropped connection FOLLOWED BY A SUCCESS reads as ok', () =>
    blipThenSuccess(cfRetired, result));
  test('🔴 check-retired-names-live — a PERSISTENT failure is still COULD NOT LOOK, never a pass', () =>
    persistentIsCouldNotLook(cfRetired));
  test('check-retired-names-live — a 429 then a success reads as ok', () => rateLimitThenSuccess(cfRetired, result));
  test('🔴 RED CONTROL — check-retired-names-live does NOT re-ask a 403: an answer is an answer', () =>
    forbiddenIsNotReasked(cfRetired));
});

// ─────────────────────────────────────────────────────────────────────────────
// B11 — THE TWO READERS OUTSIDE ops-watch THAT ARE STILL IN THE CLASS.
//
// The sweep clause says "any other ops reader that turns a single fetch failure
// into a run-level verdict" — which is not the same set as "the readers
// ops-watch.yml invokes". symbolication-proof.mjs runs from its own workflow and
// was in the class; verify-password-reset-revokes.mjs is in it too and is
// DELIBERATELY not converted, with the reason recorded here rather than in a
// commit message nobody re-reads.
// ─────────────────────────────────────────────────────────────────────────────
describe('B11 — the class beyond ops-watch', () => {
  test('🔴 symbolication-proof.mjs re-asks a dropped read rather than discarding the run', () => {
    const src = readFileSync(join(OPS, 'symbolication-proof.mjs'), 'utf8');
    assert.match(src, /from '\.\/bounded-retry\.mjs'/);
    // BOTH of its GETs, not one: `fetchProjectEvents` sits inside a 300 s poll
    // loop that a THROWN fetch escapes entirely, and `fetchInstanceVersion`
    // degrades the version limb silently rather than failing.
    assert.equal(
      (src.match(/fetchWithBoundedRetry\(/g) ?? []).length,
      2,
      'both GlitchTip reads must go through the shared plan',
    );
  });

  test('verify-password-reset-revokes.mjs is NOT converted, and the reason is recorded', () => {
    const src = readFileSync(join(OPS, 'verify-password-reset-revokes.mjs'), 'utf8');
    // 🔴 THIS ASSERTS THE CURRENT STATE, NOT AN IDEAL ONE, and it is here so the
    // omission is a decision somebody can find rather than a file that was
    // missed. Its fetches include a SIGNUP and a PASSWORD RESET — non-idempotent
    // POSTs where re-sending a request whose response was lost may create a
    // second account or a second reset token. `isSafeMethod` is the seam for
    // recording that per call; making that judgement blind was not worth doing
    // in the same change as eleven mechanical conversions. It is invoked by no
    // workflow today, so nothing scheduled is exposed.
    assert.doesNotMatch(src, /from '\.\/bounded-retry\.mjs'/);
    assert.match(src, /\bfetch\(/, 'if this file stopped making requests the exemption is stale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B12 — THE PER-REQUEST CEILING (row O-OPS-READER-NO-CEILING, 2026-09-22)
//
// A read that NEVER answers must still end, as COULD NOT LOOK, after exactly the
// planned number of attempts. Each case shortens the ceiling to a few ms through
// `timeoutMs` (which can only shorten it) and records the sleeps, so no case
// waits a real second. Each case also carries its own `{ timeout }`: a helper
// that armed no ceiling makes these cases fail by THAT timeout, never hang.
// ─────────────────────────────────────────────────────────────────────────────
describe('B12 — the per-request ceiling: a read that never answers still ends', () => {
  const never = () => new Promise(() => {});

  test('🔴 a never-answering read that HONOURS the signal ends as COULD NOT LOOK after exactly `attempts` calls', { timeout: 5000 }, async () => {
    const { slept, sleep } = recorder();
    const notes = [];
    let calls = 0;
    let aborted = 0;
    const err = await readWithBoundedRetry(
      (_attempt, { signal }) => {
        calls += 1;
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => { aborted += 1; reject(signal.reason); }, { once: true });
        });
      },
      { sleep, note: (m) => notes.push(m), timeoutMs: 20 },
    ).then(() => null, (e) => e);
    assert.ok(err instanceof CouldNotLook, `ended as ${err?.name}: ${err?.message}`);
    assert.equal(calls, READ_ATTEMPTS);
    assert.equal(aborted, READ_ATTEMPTS, 'each attempt got its OWN signal, and each one fired');
    assert.equal(slept.length, READ_ATTEMPTS - 1, 'the plan ran between attempts, as for any blip');
    assert.equal(notes.length, READ_ATTEMPTS - 1);
    assert.match(notes[0], /no answer within 0\.02s \(the per-request ceiling, attempt 1\)/);
  });

  test('🔴 a never-answering read that IGNORES the signal ends the same way', { timeout: 5000 }, async () => {
    const { slept, sleep } = recorder();
    let calls = 0;
    const err = await readWithBoundedRetry(
      () => { calls += 1; return never(); },
      { sleep, timeoutMs: 20 },
    ).then(() => null, (e) => e);
    assert.ok(err instanceof CouldNotLook, `ended as ${err?.name}: ${err?.message}`);
    assert.equal(calls, READ_ATTEMPTS, 'the race ends the attempt even when the read never looks at its signal');
    assert.equal(slept.length, READ_ATTEMPTS - 1);
  });

  test('🔴 fetchWithBoundedRetry hands the signal to doFetch, and a silent server ends the same way', { timeout: 5000 }, async () => {
    const seen = [];
    const err = await fetchWithBoundedRetry(
      ({ signal }) => { seen.push(signal); return never(); },
      { sleep: async () => {}, timeoutMs: 20 },
    ).then(() => null, (e) => e);
    assert.ok(err instanceof CouldNotLook, `ended as ${err?.name}: ${err?.message}`);
    assert.equal(seen.length, READ_ATTEMPTS);
    assert.ok(seen.every((s) => s instanceof AbortSignal && s.aborted), 'every attempt got a signal, and every one fired');
    assert.equal(new Set(seen).size, READ_ATTEMPTS, 'a FRESH signal per attempt: a spent one would abort the retry at once');
  });

  test('🔴 a caller signal that aborts first wins, and is never re-asked', { timeout: 5000 }, async () => {
    const { slept, sleep } = recorder();
    const caller = new AbortController();
    const reason = new Error('the caller stopped');
    let calls = 0;
    setTimeout(() => caller.abort(reason), 10).unref?.();
    const err = await readWithBoundedRetry(
      () => { calls += 1; return never(); },
      { sleep, signal: caller.signal, timeoutMs: 2000 },
    ).then(() => null, (e) => e);
    assert.equal(err, reason, 'the caller\'s own reason comes back, not a COULD NOT LOOK');
    assert.equal(calls, 1);
    assert.deepEqual(slept, []);
  });

  test('a caller signal already aborted means no call at all', { timeout: 5000 }, async () => {
    const reason = new Error('already stopped');
    let calls = 0;
    const err = await readWithBoundedRetry(
      () => { calls += 1; return 'rows'; },
      { signal: AbortSignal.abort(reason) },
    ).then(() => null, (e) => e);
    assert.equal(err, reason);
    assert.equal(calls, 0);
  });

  test('GREEN CONTROL — a read that answers inside the ceiling is untouched', { timeout: 5000 }, async () => {
    const { slept, sleep } = recorder();
    let signalSeen = null;
    const got = await readWithBoundedRetry(
      async (_attempt, { signal }) => { signalSeen = signal; return 'rows'; },
      { sleep, timeoutMs: 1000 },
    );
    assert.equal(got, 'rows');
    assert.deepEqual(slept, []);
    assert.equal(signalSeen.aborted, false);
  });

  test('`timeoutMs` and OPS_REQUEST_TIMEOUT_MS only SHORTEN the ceiling; nonsense is ignored', () => {
    assert.equal(requestTimeoutMs(undefined, {}), REQUEST_TIMEOUT_MS);
    assert.equal(requestTimeoutMs(10_000, {}), 10_000);
    assert.equal(requestTimeoutMs(60_000, {}), REQUEST_TIMEOUT_MS, 'a caller may not LENGTHEN it');
    assert.equal(requestTimeoutMs(undefined, { OPS_REQUEST_TIMEOUT_MS: '50' }), 50);
    assert.equal(requestTimeoutMs(10_000, { OPS_REQUEST_TIMEOUT_MS: '50' }), 50);
    for (const bad of ['', '0', '-5', 'abc', null]) {
      assert.equal(requestTimeoutMs(bad, { OPS_REQUEST_TIMEOUT_MS: bad }), REQUEST_TIMEOUT_MS, `${JSON.stringify(bad)} is not a ceiling`);
    }
  });

  test('the wall ceiling of one read is DERIVED, and ten of them fit a 10-minute job', () => {
    assert.equal(READ_WALL_CEILING_MS, READ_ATTEMPTS * REQUEST_TIMEOUT_MS + RETRY_WALL_CEILING_MS);
    // ops-watch's reader jobs are `timeout-minutes: 10`. Ten silent reads at the
    // full ceiling must fit inside one job; the heartbeats and glitchtip jobs run
    // more than ten, which is why each of their steps carries its own ceiling.
    assert.ok(10 * READ_WALL_CEILING_MS <= 600_000, `10 × ${READ_WALL_CEILING_MS} ms exceeds a 600 s job`);
  });
});
