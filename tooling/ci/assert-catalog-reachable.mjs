#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-catalog-reachable.mjs — the public catalogue may not advertise a dead app.
//
// [pipeline S-7a] Private/company/pipeline/03-stamper.md — the open sub-item under S-7.
//
// WHY. `[3]S-7` proves a stamp WRITES itself into sites/_shared/_data/apps.json,
// and that half is genuinely verified on every push. Its second promise —
// "never publishes a hostname that will not resolve" — is FALSE IN PRODUCTION,
// and measurably so: under the wildcard `*.nikatru.com` ([ADR 006]) EVERY name
// resolves and almost every name fails. Measured 2026-07-29: `lingo.nikatru.com`
// and `zzz-nonexistent-app.nikatru.com` both return 522, while
// `subly.nikatru.com/version.json` returns 200. So "it resolves" proves nothing
// whatsoever, and the catalogue could publish a `live`, broken entry with
// nothing in the repo noticing. This is a PUBLIC file: a broken link in it is a
// broken promise a stranger sees first.
//
// ── WHY IT LEANS ON THE RESPONSE, NEVER ON RESOLUTION ────────────────────────
// The wildcard is exactly why DNS is worthless here. An entry is reachable only
// if the host ANSWERS.
//
// ── HOW A DEAD APP IS TOLD APART FROM A CI RUNNER WITH NO NETWORK ────────────
// This is the whole design problem, and it is solved without an external canary
// by reading the FAILURE KIND rather than adding a control host:
//   · an HTTP status (522, 404, 500 …) means the network worked and the app did
//     not — a REAL failure, and 522 is precisely the shape a dead subdomain
//     takes under the wildcard;
//   · a transport error (DNS, connect refused, timeout) means we never got an
//     answer at all. If EVERY entry fails that way, the runner has no network
//     and blaming the catalogue would be a lie → COVERAGE LOST, not a pass.
// A control URL would have added a third-party dependency that can itself go
// down, and would have made this guard fail for a reason unrelated to us.
//
// ── ONLY `live` ENTRIES ARE BINDING ──────────────────────────────────────────
// `[3]S-7a` decided the stamp writes `status: "preview"` until an app actually
// answers, and post_gen.dart:153 does. `preview` is a promise nobody has made
// yet, so it is skipped — but the count of skipped entries is PRINTED on every
// run, because marking everything `preview` is the one way to quietly empty this
// guard's domain, and a shrink nobody can see is the failure this repo keeps
// paying for.
//
// ── `--emit-url <slug>` — THE ORIGIN THE WEB LANE DEPLOYS TO ─────────────────
// [10]D-2b. `deploy-web.yml` is a matrix over the workspace app set and must
// therefore resolve "where does app <id> live" at run time rather than carry one
// app's hostname in its YAML. That answer already exists exactly once, in the
// catalogue this guard's whole subject is, and `tooling/monitor-register.json`
// already derives every watched hostname from the same file
// (`_derivation.appCatalogue`).
//
// 🔴 IT IS EMITTED FROM THE GUARD THAT ASSERTS THOSE URLS ANSWER, and that is
// the point rather than a shortcut — the same relationship
// assert-release-lane-generic.mjs `--emit-apps` has with the lanes it grades. A
// separate reader inlined in the workflow would be a second parse of one file,
// free to disagree with this one in the only way that reports "clean".
//
// It does NOT filter on `status`. `live` is a claim about a surface that already
// answers; an app is deployed BEFORE it can be live, so requiring `live` here
// would make the first deploy of every new app impossible. Reachability stays
// the business of the scan below.
//
// ═════════════════════════════════════════════════════════════════════════════
// [pipeline 10]D-11 — LIMBS 2 AND 3. The catalogue scan above is limb 1 (every
// advertised app answers). The two below assert the SHARED INFRASTRUCTURE those
// per-app URLs stand on, which nothing in this repository measured until now.
//
// ── LIMB 2 · THE WILDCARD IS ASSERTED, NOT ASSUMED ───────────────────────────
// Every sentence this repo has written about `*.nikatru.com` since [ADR 006] —
// including the header above — is an assumption about ONE Cloudflare DNS record
// that no check has ever looked at. A random name nobody has registered
// (`wc-<hex>.<apex>`, fresh every run) can only answer AT ALL because that
// record exists, so ANY HTTP status back is proof the wildcard is live. 522 is
// the expected answer and it is a PASS here — the same 522 that is a FAILURE in
// limb 1, because there it is a promise the catalogue made about a named app and
// here it is the wildcard doing exactly its job.
//
// 🔴 SECRET-FREE BY DESIGN. The obvious implementation asks the Cloudflare API
// "is the record still there", which needs a token in CI, and a guard that needs
// a credential is a guard that gets switched off the first time the credential
// expires. An HTTP request to a name that cannot resolve without the record
// proves the same fact from outside, with nothing to leak and nothing to rotate.
//
// ── LIMB 3 · THE CANONICAL HUB ANSWERS ───────────────────────────────────────
// `CANONICAL_HUB_URL` is IMPORTED from tooling/sites/generate-discovery.mjs —
// the module that writes the page — and never retyped here. That is the point of
// the limb: a second literal could be edited on one side and go on printing ok
// about a page nobody serves. Every generated landing links back to this URL, it
// is the `<link rel="canonical">` of the hub page, and it is what the sitemap and
// llms.txt publish, so a non-200 there is the studio's whole discovery surface
// dark while [12]W-9 still reports the committed bytes are correct — W-9 diffs
// FILES, and a file being right says nothing about the host serving it.
//
// ── THE FAILING CASES, RECORDED (F-10) ───────────────────────────────────────
//   · delete the wildcard record `c22c5ffc…` (`*.nikatru.com`, proxied CNAME) →
//     the nonce host NXDOMAINs while subly.nikatru.com still answers → RED, and
//     the message names the record class rather than blaming the network.
//   · the hub stops serving /apps/ (deploy root moved, Pages project deleted,
//     the directory renamed) → limb 3 sees a non-200 → RED.
//   · every probe in the run fails at the transport layer → COVERAGE LOST on
//     both limbs, never a claim about DNS: from here, an offline runner and a
//     deleted record are the same observation. Same convention as limb 1.
//   Decision-level cases are unit-tested in tooling/ci/test/catalog-reachable.test.mjs
//   against the exported `wildcardVerdict` / `hubVerdict`, because neither
//   failure can be produced against the live host from a fixture.
//
// ⚠️ BOTH LIMBS ARE SKIPPED — AND SAY SO ON STDOUT — WHEN THIS GUARD IS POINTED
// AT A TREE THAT IS NOT THIS REPOSITORY. The two constants describe THIS repo's
// published surface; asserting them against a fixture root in a temp directory
// would be asserting something that root never claimed, and would make every
// fixture test in the suite depend on the public internet. CI passes no root, so
// CI always probes. The skip is PRINTED, because a limb that stops running is
// this repository's most expensive recurring defect.
//
// Usage:  node tooling/ci/assert-catalog-reachable.mjs [repoRoot]
//         node tooling/ci/assert-catalog-reachable.mjs --emit-url <slug> [repoRoot]
// Exit 0 = every advertised app answered, the wildcard answered and the hub
// returned 200. 1 = one of those did not (or the scan broke).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { CANONICAL_HUB_URL } from '../sites/generate-discovery.mjs';

// `indexOf` returns -1 when the flag is absent, and -1 + 1 === 0 silently
// selects argv[0] — the off-by-one that shipped in assert-gate-passed.mjs and
// blocked both production deploys. Filtered explicitly, never by arithmetic.
const argv = process.argv.slice(2);
const emitAt = argv.indexOf('--emit-url');
const EMIT_SLUG = emitAt === -1 ? null : (argv[emitAt + 1] ?? null);
const positional = emitAt === -1 ? argv : argv.filter((_, i) => i !== emitAt && i !== emitAt + 1);

const ROOT = resolve(positional[0] ?? process.cwd());
const CATALOG = join(ROOT, 'sites', '_shared', '_data', 'apps.json');

const selfDir = dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

/** Is the tree under test the one `CANONICAL_HUB_URL` describes? Exported and
 *  taking its directory as an argument SO IT CAN BE TESTED BOTH WAYS without a
 *  network call: the suite asserts it is TRUE for the real repository root — the
 *  case CI actually runs, and the one a broken gate would silently turn off —
 *  and FALSE for a temp fixture root. Same reading as
 *  assert-discovery-surface.mjs's SCANNING_OWN_REPO, deliberately, so the repo
 *  has one answer to "is this my own tree" and not two. */
export function surfaceIsOurs(root, dir = selfDir) {
  return (dir + sep).startsWith(resolve(root) + sep);
}

// ── the two hosts limbs 2 and 3 probe, BOTH DERIVED FROM ONE DEFINITION ──────
// The apex, the scheme and the port all come out of the imported hub URL, so
// this file contains no hostname of its own at all. That is asserted by the
// suite — with comments stripped, the guard's CODE must not contain the apex as
// a literal — because "derive it" is a rule that only holds until someone in a
// hurry pastes the string back in.
export const HUB_URL = CANONICAL_HUB_URL;
export const WILDCARD_APEX = new URL(HUB_URL).hostname;

/** A name nobody has ever registered, fresh every run. FRESH IS LOAD-BEARING: a
 *  fixed nonce could be created as a real record (or cached anywhere along the
 *  path) and would then answer for a reason that has nothing to do with the
 *  wildcard, which is a probe that has quietly stopped testing its subject. */
export function nonceUrl() {
  const u = new URL(HUB_URL);
  return `${u.protocol}//wc-${randomBytes(4).toString('hex')}.${u.hostname}${u.port ? `:${u.port}` : ''}/`;
}

/** LIMB 2's decision, as a pure function of one probe result plus whether
 *  anything ELSE in the same run got an HTTP answer. Pure so that the two
 *  failing paths — which cannot be produced against the live host — have real
 *  tests instead of a comment claiming they work.
 *
 *  @param {{url: string, verdict: object, othersAnswered: boolean}} arg
 *  @returns {{ok: true, line: string} | {ok: false, coverageLost: boolean, lines: string[]}}
 */
export function wildcardVerdict({ url, verdict, othersAnswered }) {
  if (verdict && verdict.status !== undefined) {
    return {
      ok: true,
      line:
        `ok  wildcard DNS answers — ${url} returned HTTP ${verdict.status}. Nobody registered that name, so it ` +
        `can only resolve because the proxied wildcard CNAME \`*.${WILDCARD_APEX}\` is still in DNS. Every app ` +
        'subdomain this catalogue publishes rests on that one record, and this run just proved it is there.',
    };
  }
  const how = verdict?.transport ?? 'no answer';
  if (othersAnswered) {
    return {
      ok: false,
      coverageLost: false,
      lines: [
        `✗ THE WILDCARD DNS RECORD IS GONE — ${url} could not be reached at all (${how}), while other probes in`,
        '  this same run DID get HTTP answers. So this is DNS, not the runner.',
        '',
        `  THE RECORD CLASS: a PROXIED WILDCARD CNAME — \`*.${WILDCARD_APEX}\` → \`${WILDCARD_APEX}\` — in Cloudflare`,
        '  DNS ([ADR 006]). It is the ONLY thing that makes `<slug>` names resolve for an app nobody created a',
        '  record for, which is every app this factory ships. Without it the catalogue goes on publishing',
        '  hostnames that NXDOMAIN, and limb 1 above degrades into transport errors that read as "the runner is',
        '  offline" — a dead studio reported as a flaky CI job. Restore the record before touching anything else.',
      ],
    };
  }
  return {
    ok: false,
    coverageLost: true,
    lines: [
      `✗ COVERAGE LOST — ${url} got no answer (${how}), and NOTHING ELSE in this run answered either.`,
      '  An offline runner and a deleted wildcard record are the same observation from here. This exits 1',
      '  because the check did not get to run, and naming a cause it cannot observe would be the more',
      '  expensive mistake — the same reading limb 1 takes on the all-transport-failure case.',
    ],
  };
}

/** LIMB 3's decision, same shape and for the same reason. 200 or nothing: this
 *  is the one URL [12]W-2a/W-2c name, so "it 404s but something else serves the
 *  apps" is not a pass. A 200 reached through a redirect DOES pass and the line
 *  NAMES the final URL — the hub still answers, and where it landed is a fact
 *  the log must carry rather than swallow. */
export function hubVerdict({ url, verdict, othersAnswered }) {
  if (verdict && verdict.status === 200) {
    return {
      ok: true,
      line:
        `ok  canonical hub answers — ${url} returned 200` +
        (verdict.redirected ? ` (after a redirect to ${verdict.finalUrl})` : '') +
        '. It is the ONE hub URL ([12]W-2a/W-2c, knowledge/decisions/026-canonical-hub-url.md), imported from ' +
        'tooling/sites/generate-discovery.mjs rather than retyped, and it is what every generated landing, the ' +
        'sitemap and llms.txt point a stranger at.',
    };
  }
  if (verdict && verdict.status !== undefined) {
    return {
      ok: false,
      coverageLost: false,
      lines: [
        `✗ THE CANONICAL HUB DID NOT ANSWER 200 — ${url} returned HTTP ${verdict.status}.`,
        '  [12]W-9 diffs the committed BYTES of that page and would still report them correct: a file being',
        '  right says nothing about the host serving it. This is the whole discovery surface dark — every',
        '  generated landing links back here, the sitemap and llms.txt publish this address, and it is the',
        '  canonical URL the hub page declares about itself.',
      ],
    };
  }
  const how = verdict?.transport ?? 'no answer';
  if (othersAnswered) {
    return {
      ok: false,
      coverageLost: false,
      lines: [
        `✗ THE CANONICAL HUB COULD NOT BE REACHED AT ALL — ${url} (${how}), while other probes in this same run`,
        '  got HTTP answers. So this is the hub, not the network.',
      ],
    };
  }
  return {
    ok: false,
    coverageLost: true,
    lines: [
      `✗ COVERAGE LOST — ${url} got no answer (${how}), and NOTHING ELSE in this run answered either.`,
      '  Whether the hub is down or the runner is offline cannot be told apart from here, so neither is claimed.',
    ],
  };
}

/** Attempts per entry. A single blip must not fail a build; a dead app must.
 *  Bounded deliberately: worst case is ATTEMPTS × TIMEOUT_MS per entry, and a
 *  guard that can hang is worse than one that can fail — a hanging CI step looks
 *  exactly like a slow network, which is the one thing this guard exists to
 *  distinguish. */
const ATTEMPTS = 2;
const TIMEOUT_MS = 8000;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

/** Same as fail(), but for the post-fetch paths — see the note beside `done`. */
let softFailed = false;
function failSoft(lines) {
  for (const l of lines) console.error(l);
  softFailed = true;
}

// ── the run ───────────────────────────────────────────────────────────────
// 🔴 EVERYTHING BELOW IS GATED ON `isMain`, and that is what makes the pure
// helpers above testable. Importing this module must not probe the network or
// set an exit code — the [10]D-11 limbs' decision functions are unit-tested by
// tooling/ci/test/catalog-reachable.test.mjs, which imports them from here.
// The nine spawn tests in that same file are this gate's negative test: if
// `isMain` ever computed false for a real invocation, the guard would print
// nothing and exit 0, and every one of them would fail.
if (isMain) {
  if (!existsSync(CATALOG)) {
    fail([
      `✗ COVERAGE LOST — no catalogue at ${CATALOG}.`,
      '  [S-7] the stamp writes this file; without it there is nothing to check and nothing to trust.',
    ]);
  }

  let entries;
  try {
    entries = JSON.parse(readFileSync(CATALOG, 'utf8'));
  } catch (err) {
    fail([`✗ catalogue is not valid JSON: ${err.message}`]);
  }
  if (!Array.isArray(entries)) fail(['✗ catalogue is not a JSON array.']);
  if (entries.length === 0) {
    fail([
      '✗ COVERAGE LOST — the catalogue is empty.',
      '  Every check below would range over nothing and report success.',
    ]);
  }

  // ── the emit mode, BEFORE any network work ───────────────────────────────────
  // Deliberately after the catalogue's structural floors and before the probes:
  // this mode answers one question ("what origin does app <slug> publish to") and
  // must not be able to fail — or hang for ATTEMPTS × TIMEOUT_MS — because a
  // hostname unrelated to it is down. It fails LOUDLY on every "I could not tell"
  // case, because the caller is a deploy lane and an empty answer there resolves
  // to `/version.json` — a smoke against the runner's own filesystem, which is the
  // green-over-nothing shape this repository keeps paying for.
  if (emitAt !== -1) {
    if (!EMIT_SLUG || EMIT_SLUG.startsWith('-')) {
      fail([
        '✗ --emit-url needs an app slug: `--emit-url <slug>`.',
        `  Got ${EMIT_SLUG === null ? 'nothing' : JSON.stringify(EMIT_SLUG)}. An unresolved slug would emit an empty`,
        '  origin and the caller would probe a path with no host at all.',
      ]);
    }
    const row = entries.find((e) => e && e.slug === EMIT_SLUG);
    if (!row) {
      fail([
        `✗ the catalogue declares no app with slug "${EMIT_SLUG}".`,
        `  It holds: ${entries.map((e) => e?.slug ?? '<no slug>').join(', ')}.`,
        '  [3]S-7 makes the stamp write this row; an app in the pub workspace with no catalogue row is an app',
        '  the web lane can build and cannot address, so this is a real fault and not a missing convenience.',
      ]);
    }
    const url = typeof row.url === 'string' ? row.url.trim().replace(/\/+$/, '') : '';
    if (!/^https:\/\/[^\s/]+/.test(url)) {
      fail([
        `✗ the catalogue row for "${EMIT_SLUG}" declares url ${JSON.stringify(row.url ?? null)}, which is not an https origin.`,
        '  The deploy lane appends `/version.json` to this value and the deployment record publishes it verbatim.',
      ]);
    }
    console.log(`site_url=${url}`);
    process.exit(0);
  }

  const live = entries.filter((e) => e && e.status === 'live');
  const skipped = entries.length - live.length;

  /** One request. Returns {ok} | {status} | {transport} — the three cases the
   *  network/app distinction rests on. */
  async function probe(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      // GET, not HEAD: Workers and static hosts routinely answer HEAD differently
      // (or not at all), so HEAD can report a failure the real visitor never sees.
      const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
      // 🔴 THE BODY MUST BE DRAINED, and it is not politeness. An unconsumed body
      // leaves the socket checked out of the pool, so the later `process.exit()`
      // tears down a connection that is still live — on Windows that surfaced as
      // the guard CRASHING with 0xC0000409 instead of exiting 1, and only on the
      // retrying (5xx) path, which is what made it look like a 522-specific bug.
      await res.arrayBuffer().catch(() => {});
      // `redirected`/`finalUrl` carried through for limb 3: a hub that answers
      // 200 only after a hop still answers, but WHERE it landed must appear in
      // the log rather than be swallowed by a bare "200".
      const where = { redirected: res.redirected, finalUrl: res.url };
      return res.ok ? { ok: true, status: res.status, ...where } : { status: res.status, ...where };
    } catch (err) {
      return { transport: err?.cause?.code ?? err?.name ?? String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Retry only transport errors and 5xx — a 404 is a settled answer, not a blip. */
  async function probeWithRetries(url) {
    let last;
    for (let i = 0; i < ATTEMPTS; i++) {
      last = await probe(url);
      if (last.ok) return last;
      if (last.status && last.status < 500) return last;
      if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
    return last;
  }

  const results = [];
  for (const e of live) {
    if (!e.url) {
      results.push({ slug: e.slug ?? '<no slug>', verdict: { status: 0 }, missingUrl: true });
      continue;
    }
    results.push({ slug: e.slug ?? '<no slug>', url: e.url, verdict: await probeWithRetries(e.url) });
  }

  const answered = results.filter((r) => r.verdict.ok);
  const httpFailures = results.filter((r) => !r.verdict.ok && r.verdict.status !== undefined);
  const transportFailures = results.filter((r) => r.verdict.transport !== undefined);

  // ── [10]D-11 limbs 2 and 3 — the infrastructure the per-app URLs stand on ──
  // Probed AFTER the catalogue so "did anything else answer?" is a fact about
  // this run rather than a second guess at the network. See the header for why
  // both are skipped (loudly) when the tree under test is not this repository.
  const surface = [];
  if (surfaceIsOurs(ROOT)) {
    const nonce = nonceUrl();
    // ANY status settles limb 2, so retry only the no-answer case — a 522 is the
    // expected reply here and re-requesting it would burn a round trip proving
    // something already proven.
    let wildcard;
    for (let i = 0; i < ATTEMPTS; i++) {
      wildcard = await probe(nonce);
      if (wildcard.status !== undefined) break;
      if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
    const hub = await probeWithRetries(HUB_URL);

    // `missingUrl` rows carry a synthesised `{status: 0}` and are NOT evidence
    // that anything answered — counting them would let a catalogue full of
    // url-less entries turn a genuine offline run into a confident DNS verdict.
    const catalogueAnswers = results.filter((r) => !r.missingUrl).map((r) => r.verdict);
    const gotAnswer = (v) => v !== undefined && v.status !== undefined;
    surface.push(
      wildcardVerdict({
        url: nonce,
        verdict: wildcard,
        othersAnswered: catalogueAnswers.some(gotAnswer) || gotAnswer(hub),
      }),
    );
    surface.push(
      hubVerdict({
        url: HUB_URL,
        verdict: hub,
        othersAnswered: catalogueAnswers.some(gotAnswer) || gotAnswer(wildcard),
      }),
    );
  } else {
    // PRINTED, never silent. A limb that stops running is this repository's most
    // expensive recurring defect, and the skip must be visible in the log of the
    // run that took it.
    console.log(
      `⚠  [10]D-11 limbs 2 (wildcard) and 3 (canonical hub) NOT probed — this run is scanning ${ROOT}, ` +
        `which is not the tree ${HUB_URL} describes. CI passes no root, so CI always probes them.`,
    );
  }

  // 🔴 FROM HERE ON, EXIT VIA `process.exitCode` AND NEVER `process.exit()`.
  // Calling process.exit() after a fetch tears down undici's still-open pool
  // mid-flight, and on Windows that is not a tidy race — it aborts the process
  // (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit 127) AFTER
  // printing "ok", so the guard reports success and returns a failure code. A
  // guard whose exit code contradicts its own output is worse than no guard.
  // Setting exitCode lets the loop drain and the process end on its own.
  const done = (code) => { process.exitCode = code; };

  // The network-is-down case. Only claim it when NOTHING got through and every
  // failure was a transport error — a single unreachable host among answering
  // ones is that host's problem, not the runner's.
  if (live.length > 0 && transportFailures.length === live.length) {
    failSoft([
      `✗ COVERAGE LOST — all ${live.length} live entry(ies) failed at the transport layer, none returned`,
      '  any HTTP status.',
      '',
      '  ⚠️ THIS GUARD CANNOT TELL YOU WHICH OF TWO THINGS HAPPENED, and says so rather than picking one:',
      '     · the runner has no network — nothing is wrong with the catalogue; or',
      '     · every advertised host is genuinely unreachable — everything is wrong with it.',
      '  Both are failures, so this exits 1 either way. It is stated as COVERAGE LOST because the check',
      '  did not get to run, and claiming a specific cause it cannot observe would be the more expensive',
      `  mistake. (Note: any \`*.${WILDCARD_APEX}\` name RESOLVES under the wildcard and answers 522, so a real`,
      '  catalogue entry reaches the HTTP branch above — a transport error here points off-wildcard.)',
      ...transportFailures.map((r) => `    ${r.slug} → ${r.url} — ${r.verdict.transport}`),
    ]);
    done(1);
  }

  // Skipped entirely when the transport branch already fired: every entry would
  // be re-listed there, and one defect reported twice reads as two defects.
  const problems = [];
  if (!softFailed) {
  for (const r of httpFailures) {
    if (r.missingUrl) {
      problems.push(`${r.slug} — marked \`live\` with no \`url\`. An advertised app nobody can open.`);
      continue;
    }
    problems.push(
      `${r.slug} — marked \`live\` but ${r.url} answered HTTP ${r.verdict.status}. ` +
        (r.verdict.status === 522
          ? 'A 522 under the wildcard is what a subdomain with NOTHING BEHIND IT looks like — the name ' +
            `resolves because \`*.${WILDCARD_APEX}\` answers every name, and there is no origin. `
          : '') +
        'The catalogue is public: fix the deploy, or set `status` back to "preview" until it answers.',
    );
  }
  for (const r of transportFailures) {
    problems.push(
      `${r.slug} — marked \`live\` but ${r.url} could not be reached at all (${r.verdict.transport}), ` +
        'while other entries answered. So this is the app, not the network.',
    );
  }

  }

  if (problems.length) {
    console.error(`✗ catalogue reachability — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('');
    console.error('  [pipeline S-7a] a `live` entry is a promise to a stranger that the link works.');
    console.error(`  Catalogue: sites/_shared/_data/apps.json`);
    done(1);
  }

  if (!softFailed && !problems.length) {
  for (const r of answered) console.log(`    ${r.slug} → ${r.url} (${r.verdict.status})`);
  if (skipped > 0) {
    // Printed on every run, pass or fail. Marking entries `preview` is the one way
    // to empty this guard's domain, so the shrink must be visible.
    console.log(`⚠  ${skipped} entry(ies) not marked \`live\` and therefore NOT probed.`);
  }
  console.log(
    `ok  catalogue reachability — ${answered.length} of ${live.length} live entry(ies) answered; ` +
      `${entries.length} entry(ies) in the catalogue, ${skipped} unprobed`,
  );
  }

  // ── limbs 2 and 3 report LAST, and INDEPENDENTLY of limb 1's verdict ───────
  // Deliberately not folded into `problems` above: that block is [3]S-7a's, and
  // its message tells the reader to fix a deploy or set an entry back to
  // `preview` — advice that is actively wrong for a missing DNS record. One
  // fault, one message, pointing at the thing that is actually broken.
  for (const v of surface) {
    if (v.ok) {
      console.log(v.line);
      continue;
    }
    for (const l of v.lines) console.error(l);
    console.error('  [pipeline 10]D-11 — the catalogue\'s per-app URLs all stand on these two.');
    done(1);
  }
}
