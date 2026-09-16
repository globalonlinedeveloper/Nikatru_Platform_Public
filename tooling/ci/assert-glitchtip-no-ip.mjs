#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-glitchtip-no-ip.mjs — NO crash or error event carries an IP address,
// from any client (Flutter app, chassis, brick, web) or any Worker.
//
// ── THE RULING THIS ENFORCES ─────────────────────────────────────────────────
// Owner ruling 2026-09-15 (nikatru OWNER_QUEUE A-8, register row
// O-CRASH-EVENT-IP-DROP): "Stop sending it." PR #123 found on 2026-08-03 that
// the crash event carried a /24-TRUNCATED IPv4 that sites/nikatru/privacy.html
// does not disclose, and truncated network data is still personal data under
// DPDP. The decision was not "truncate harder": crash reports carry NO IP at
// all, and privacy.html stays unchanged.
//
// ── WHERE THE /24 CAME FROM, BECAUSE IT IS NOT WHERE ANYONE LOOKED ───────────
// It was SERVER-SIDE. GlitchTip's ingest resolves a client IP from the HTTP
// request with django-ipware on EVERY event, independent of anything the SDK
// sends, and its `scrub_ip_addresses` flag only routes that value through
// `anonymize_ip()` — masks 255.255.255.0 and ffff:ffff:ffff:ffff::, i.e. an
// IPv4 /24 and an IPv6 /64 are KEPT. `scrub_ip_addresses` ANONYMISES, IT DOES
// NOT OMIT, and there is no env-level key in this GlitchTip that can express
// "discard". So `sendDefaultPii = false` on the client never touched that path,
// which is exactly why a client-side-only mental model let the leak survive.
// The live fix is to starve ipware of every header it reads — the eleven-header
// strip in the nginx hop in front of the sink — and that is what `--live` below
// measures. See Private/runbooks/operations.md A.2 and
// Private/runbooks/boxes/hostinger.md.
//
// ── WHAT THE OFFLINE LIMBS REFUSE (these are the merge-blocking ones) ────────
//   L1  any assignment to `sendDefaultPii` whose value is not `false`. That one
//       flag is what stops the SDK writing `user.ip_address = "{{auto}}"`, i.e.
//       ASKING the ingest to resolve and attach an address on the client's
//       behalf. ZERO assignments found is COVERAGE LOST, not a pass: it means
//       the scan stopped reaching the bootstrap, or the flag was renamed.
//   L2  any source on an event-building surface that writes an IP-BEARING FIELD
//       onto an event, or reads a client-IP HEADER at all. `CF-Connecting-IP`
//       is never read in a Worker and is never forwarded to the sink — that is
//       the whole posture of ADR 011 / ADR 020, and until now it was held by a
//       comment.
//   L3  the FREE-TEXT net: PiiScrubber must declare IPv4 and IPv6 rules AND
//       `scrubText` must apply both. This is the half neither layer of the live
//       fix can reach — the sink's key-based scrubber matches on FIELD NAME, so
//       `connect failed to 8.8.8.8` in an exception value went through it
//       untouched. A rule that exists but is not wired into `scrubText` is
//       exactly as absent as no rule, so BOTH are asserted.
//   L4  `beforeSend` is wired, and routes through `scrubEvent`. Without it the
//       whole of L3 is dead code on a live event.
//
// ── WHAT `--live` DOES, AND WHY IT IS NOT IN CI ──────────────────────────────
// It POSTs two synthetic events through the PUBLIC glitchtip.nikatru.com edge
// and reads them back through the GlitchTip API:
//   SUBJECT  no `user` in the payload, ten spoofed client-IP headers on the
//            request, plus whatever real `CF-Connecting-IP` Cloudflare's own
//            edge adds. Expect: no IP-bearing key and no IP-shaped value
//            anywhere in the stored event.
//   CONTROL  the same event with an explicit `user.ip_address` IN THE PAYLOAD.
//            Expect: the KEY comes back (its value may well be `[Filtered]` —
//            that is the sink's own scrubber working, and is still a pass for
//            the control). This is the NEGATIVE CONTROL, and it is the whole
//            reason the run can be trusted: without it, "no IP field" is
//            indistinguishable from "this API never returns a user object" or
//            "the event never landed", and a VOID result would read as a pass.
//            The 2026-09-02 on-box script has the same shape for the same
//            reason (Private/runbooks/config/glitchtip-boxb-privacy-test.sh),
//            differing only in HOW it makes the control: it bypasses nginx,
//            which needs SSH and cannot be done over HTTPS.
//
// 🔴 THE SPOOF LITERALS ARE NOT DOCUMENTATION RANGES, AND THAT IS MEASURED, NOT
// STYLISTIC. 203.0.113.x and 198.51.100.x are TEST-NET; Python's
// `ipaddress.is_global` is FALSE for them, so python_ipware DISCARDS them, no
// IP is ever resolved, and the run reports VOID in a way that looks like a
// broken stack. That voided two runs on 2026-09-02. Use genuinely
// globally-routable literals, which is why `1.2.3.4` and `8.8.8.8` are below.
//
// ⚠️ `CF-Connecting-IP` IS DELIBERATELY NOT ONE OF THE SPOOFED HEADERS HERE.
// Cloudflare's edge rejects any client request carrying one with error 1000
// before the origin is reached, so sending it would fail the probe for a reason
// that has nothing to do with the thing under test. Over the public edge that
// header is SET BY CLOUDFLARE anyway, to the caller's real address — which
// makes this the strongest of the three legs the on-box script records, not the
// weakest: it is the production path with a real client IP on it.
//
// --live is a LAPTOP AND RUNBOOK STEP, never merge-blocking. ci.yml's standing
// objection to a CI limb depending on the GlitchTip box stands, and it is the
// same split assert-glitchtip-project.mjs already runs on.
// It is declared as an on-demand ops duty (duty.laptop.glitchtip-no-ip-live in
// tooling/ops/register.json), and tooling/ci/assert-sink-disclosure.mjs names
// this file as the probe behind the `hostinger` row's transit-only `ip_address`:
// it exits 2 if this file, its `--live` leg or that duty row disappears.
//
// Usage:
//   node tooling/ci/assert-glitchtip-no-ip.mjs [--root <dir>] [--live]
// Exit 0 = no surface carries an IP. 1 = one does, and which. 2 = COVERAGE LOST
//          (the scan reached nothing, or a live leg could not be measured) or an
//          unknown flag. 2 IS NOT A PASS.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// why: `listDir`, never `readdirSync` — tooling/ci/assert-walks-bounded.mjs holds
// this for every guard, and the reason is measured: a bare listing descends into
// a nested checkout and reads another repository's sources as this tree's.
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const NAME = 'assert-glitchtip-no-ip';
const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const KNOWN = new Set(['--root', '--live', '--help', '-h']);
for (const a of argv) {
  if (a.startsWith('-') && !KNOWN.has(a)) {
    console.error(`${NAME}: unknown flag ${a}. Known: ${[...KNOWN].join(' ')}`);
    process.exit(2);
  }
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`usage: node tooling/ci/${NAME}.mjs [--root <dir>] [--live]`);
  process.exit(0);
}
const rIdx = argv.indexOf('--root');
const ROOT = rIdx === -1 ? resolve(HERE, '..', '..') : resolve(argv[rIdx + 1] ?? '');
const LIVE = argv.includes('--live');

const findings = [];
/** Structural failure — the scan did not reach enough to be evidence. Exit 2:
 *  COVERAGE LOST is deliberately NOT a pass and not a finding either. */
const coverageLost = (lines) => {
  console.error(`${NAME}: ✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

// ── the surfaces an event can be built on ───────────────────────────────────
// Named rather than globbed from the root: the question is "which trees can put
// a field on a crash event", and node_modules, build output and the site's
// vendored assets cannot. Each entry that is PRESENT must contribute files; a
// present directory that yields none is COVERAGE LOST below.
const SURFACES = [
  'packages',
  'apps',
  'services',
  'extensions',
  join('tooling', 'bricks'),
];
const CODE_EXT = new Set(['.dart', '.ts', '.tsx', '.js', '.mjs']);
const SKIP_DIR = new Set([
  'node_modules', 'build', '.dart_tool', 'dist', 'coverage', '.git', '.claude',
  'ios', 'macos', 'android', 'windows', 'linux', 'web',
]);

const files = [];
const walk = (abs) => {
  for (const e of listDir(abs, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(join(abs, e.name));
    } else if (CODE_EXT.has(extname(e.name).toLowerCase())) {
      files.push(join(abs, e.name));
    }
  }
};
const presentSurfaces = [];
for (const s of SURFACES) {
  const abs = join(ROOT, s);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
  presentSurfaces.push(s);
  const before = files.length;
  walk(abs);
  if (files.length === before) {
    coverageLost([
      `${s}/ exists but this scan found no .dart/.ts/.js source under it.`,
      'Every limb below then ranges over a smaller tree than the one that ships, and would still',
      'print ok. Either the layout moved or SKIP_DIR now excludes the code itself.',
    ]);
  }
}
if (presentSurfaces.length === 0 || files.length === 0) {
  coverageLost([
    `no event-building surface was found under ${ROOT}.`,
    `Looked for: ${SURFACES.join(', ')}.`,
    'With nothing scanned, "no source attaches an IP" is a statement about an empty set.',
  ]);
}

// ── TESTS ARE SCANNED SEPARATELY, AND THE REASON IS NOT CONVENIENCE ─────────
// Three test files in services/*/test FEED a spoofed `CF-Connecting-IP` into a
// Worker on purpose, to prove the Worker ignores it; one test in
// packages/telemetry/test sets `sendDefaultPii = true` on a fresh options object
// on purpose, because the SDK is born with it FALSE and the assertion could not
// otherwise fail. Every one of those is the defect's negative control, and a
// rule that refuses them would forbid proving the rule.
//
// ⚠️ SO THE SPLIT IS A REAL NARROWING AND IT IS PRINTED, not assumed away: the
// passing line states how many files were held out, and an empty PRODUCTION set
// is COVERAGE LOST below. What ships is the subject; what proves it is not.
const isTest = (abs) => {
  const r = relative(ROOT, abs).split(sep);
  const base = r[r.length - 1];
  return r.some((seg) => seg === 'test' || seg === 'tests' || seg === '__tests__')
    || /(_test\.dart|\.test\.(ts|tsx|js|mjs)|_test\.(ts|tsx|js|mjs))$/.test(base);
};
const production = files.filter((f) => !isTest(f));
const heldOut = files.length - production.length;
if (production.length === 0) {
  coverageLost([
    'every source this scan found is a test file, so the production surfaces were never read.',
    `Scanned ${files.length} file(s), all held out as tests. The subject of every limb below is what`,
    'ships; with none of it in view, "no source attaches an IP" is a statement about an empty set.',
  ]);
}

/** Comments blanked, LENGTH PRESERVED, so a line number still means something
 *  and a rule cannot be satisfied by a sentence. This matters more here than
 *  almost anywhere: services/_shared/src/error-sink.ts's header is a paragraph
 *  about `CF-Connecting-IP` explaining why it is never read, and a text grep
 *  reads that explanation as the defect it denies. */
const codeOf = (abs) => stripSourceComments(readFileSync(abs, 'utf8'), extname(abs).toLowerCase());
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// ── the detector's OWN control, run on every invocation ─────────────────────
// Every limb below reads COMMENT-STRIPPED source. If stripSourceComments ever
// regressed to a no-op for one of these extensions — it returns the source
// UNCHANGED and SILENTLY for an extension it does not know — L2 would start
// reporting every explanatory paragraph as a leak, and L1/L3 would start
// accepting a rule that exists only in prose. Two synthetic sources, one shape
// in a comment and one in code, must come out absent and present.
for (const ext of ['.dart', '.ts']) {
  const inComment = stripSourceComments(`// options.sendDefaultPii = true;\nconst x = 1;\n`, ext);
  const inCode = stripSourceComments(`options.sendDefaultPii = true;\n`, ext);
  if (inComment.includes('sendDefaultPii') || !inCode.includes('sendDefaultPii')) {
    coverageLost([
      `the comment reduction no longer distinguishes code from prose for ${ext}.`,
      `A marker in a comment survived as ${inComment.includes('sendDefaultPii')} (must be false) and one in`,
      `code as ${inCode.includes('sendDefaultPii')} (must be true).`,
      'Until that holds, every verdict below is a text grep over prose — which is the exact defect',
      'this guard exists to refuse, wearing the costume of the check that catches it.',
    ]);
  }
}

// ── L1 — the SDK never asks for default PII ─────────────────────────────────
const PII_FLAG = /sendDefaultPii\s*=\s*([A-Za-z0-9_.]+)/g;
let piiAssignments = 0;
for (const abs of production) {
  const code = codeOf(abs);
  for (const m of code.matchAll(PII_FLAG)) {
    piiAssignments++;
    if (m[1] !== 'false') {
      findings.push(
        `${rel(abs)}:${lineOf(code, m.index)} — sendDefaultPii = ${m[1]}. ` +
          'That flag is what makes the SDK write `user.ip_address = "{{auto}}"`, i.e. ask the ingest ' +
          'to resolve and attach the caller\'s address. The ruling is NO IP at all.',
      );
    }
  }
}
if (piiAssignments === 0) {
  coverageLost([
    'no assignment to `sendDefaultPii` was found on any scanned surface.',
    'On 2026-09-16 there was exactly one, in packages/telemetry/lib/src/telemetry_bootstrap.dart.',
    'Zero means the telemetry bootstrap left this scan, or the SDK renamed the flag and the posture',
    'is now whatever the vendor default happens to be. Both are COVERAGE LOST, and neither is a pass.',
  ]);
}

// ── L2 — no surface writes an IP field, or reads a client-IP header ─────────
// Two populations, deliberately kept apart because they fail for different
// reasons. FIELD names are what lands IN the event; HEADER names are the raw
// material an address is resolved FROM, and a Worker that reads one has already
// left the posture ADR 011 / ADR 020 describe, whatever it does with the value.
const IP_FIELDS = [
  'ip_address', 'ipAddress', 'remote_addr', 'remoteAddr', 'remoteAddress',
  'client_ip', 'clientIp', 'clientIP', 'x_forwarded_for', 'cf_connecting_ip',
  'true_client_ip', 'fastly_client_ip', 'x_real_ip', 'x_cluster_client_ip',
];
const IP_HEADERS = [
  'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip',
  'x-client-ip', 'fastly-client-ip', 'x-cluster-client-ip', 'forwarded-for',
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FIELD_RE = new RegExp(`\\b(${IP_FIELDS.map(escape).join('|')})\\b`, 'g');
const HEADER_RE = new RegExp(`(${IP_HEADERS.map(escape).join('|')})`, 'gi');
for (const abs of production) {
  const code = codeOf(abs);
  for (const m of code.matchAll(FIELD_RE)) {
    findings.push(
      `${rel(abs)}:${lineOf(code, m.index)} — names the IP-bearing field \`${m[1]}\` in code. ` +
        'A crash event carries no IP address, truncated or not (owner ruling 2026-09-15).',
    );
  }
  for (const m of code.matchAll(HEADER_RE)) {
    findings.push(
      `${rel(abs)}:${lineOf(code, m.index)} — reads the client-IP header \`${m[1]}\` in code. ` +
        'No Worker reads one and none is ever forwarded to the sink; that is the posture of ' +
        '[ADR 011] / [ADR 020], and Cloudflare\'s edge rejects a client request carrying one anyway.',
    );
  }
}

// ── L3 — the free-text net exists AND is wired ──────────────────────────────
const SCRUBBER_REL = 'packages/telemetry/lib/src/pii_scrubber.dart';
const scrubberAbs = join(ROOT, ...SCRUBBER_REL.split('/'));
if (!existsSync(scrubberAbs)) {
  coverageLost([
    `${SCRUBBER_REL} is not there.`,
    'It is the ONE value-level net over free text, and the only layer that can see an address typed',
    'into an exception value or a log line — the sink\'s own scrubber matches on FIELD NAME, not on',
    'value. Without the file there is nothing to assert and nothing scrubbing.',
  ]);
}
const scrubber = codeOf(scrubberAbs);
const IP_RULES = ['_ipv4', '_ipv6'];
for (const rule of IP_RULES) {
  if (!new RegExp(`static\\s+final\\s+RegExp\\s+${rule}\\s*=`).test(scrubber)) {
    findings.push(
      `${SCRUBBER_REL} — no \`${rule}\` rule is declared. An IP typed into an exception value, a log ` +
        'message or a breadcrumb reaches the sink in full: nothing else in the stack reads values.',
    );
  }
}
// The wiring, not the declaration. A rule nothing applies is exactly as absent
// as no rule, and reads as present to anyone grepping for the name.
const scrubTextBody = (() => {
  const at = scrubber.indexOf('String scrubText(');
  if (at === -1) return null;
  // To the end of the method: from the first `{` after the signature, balanced.
  let i = scrubber.indexOf('{', at);
  if (i === -1) return null;
  let depth = 0;
  for (let j = i; j < scrubber.length; j++) {
    if (scrubber[j] === '{') depth++;
    else if (scrubber[j] === '}') {
      depth--;
      if (depth === 0) return scrubber.slice(i, j + 1);
    }
  }
  return null;
})();
if (scrubTextBody === null) {
  coverageLost([
    `${SCRUBBER_REL} — could not read the body of \`scrubText\`.`,
    'The method was renamed or reshaped, so "is the IP rule applied" was never actually asked.',
  ]);
}
for (const rule of IP_RULES) {
  if (!scrubTextBody.includes(`replaceAll(${rule}`)) {
    findings.push(
      `${SCRUBBER_REL} — \`${rule}\` is never applied inside scrubText. A declared-but-unwired rule ` +
        'is exactly as absent as no rule, and reads as present to anyone grepping for its name.',
    );
  }
}

// ── L4 — the choke point is wired ───────────────────────────────────────────
const BOOTSTRAP_REL = 'packages/telemetry/lib/src/telemetry_bootstrap.dart';
const bootstrapAbs = join(ROOT, ...BOOTSTRAP_REL.split('/'));
if (!existsSync(bootstrapAbs)) {
  coverageLost([
    `${BOOTSTRAP_REL} is not there, so the one place the scrubber is installed could not be read.`,
  ]);
}
const bootstrap = codeOf(bootstrapAbs);
if (!/beforeSend\s*=/.test(bootstrap)) {
  findings.push(
    `${BOOTSTRAP_REL} — nothing assigns \`options.beforeSend\`. With no hook, every rule L3 just ` +
      'checked is dead code on a live event.',
  );
} else if (!/beforeSend\s*=[^;]*scrubEvent/.test(bootstrap)) {
  findings.push(
    `${BOOTSTRAP_REL} — \`beforeSend\` is assigned but does not route through \`scrubEvent\`. ` +
      'scrubEvent is the ONE choke point; a hook that bypasses it scrubs nothing.',
  );
}

if (findings.length) {
  console.error(`${NAME}: ${findings.length} surface(s) can put an IP address on a crash event:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}

console.log(
  `${NAME}: ${production.length} production source file(s) across ${presentSurfaces.length} surface(s) ` +
    `(${presentSurfaces.map((s) => s.split(sep).join('/')).join(', ')}), ${heldOut} test file(s) held out — ` +
    `${piiAssignments} sendDefaultPii assignment(s), all false; ` +
    'no IP-bearing field and no client-IP header read anywhere; the IPv4/IPv6 rules are declared ' +
    'AND applied in scrubText; beforeSend routes through scrubEvent.',
);

// ─────────────────────────────────────────────────────────────────────────────
// --live — the sink itself, measured, with a negative control.
// ─────────────────────────────────────────────────────────────────────────────
if (LIVE) {
  // 🔴 THE TOKEN GOES TO ONE HOST, PINNED HERE, for the same reason
  // assert-glitchtip-project.mjs pins it (CodeQL #293): a base read out of a
  // register any PR can edit would let a file edit decide where the next
  // operator's token was sent. A different instance for one run is an
  // operator's choice made in the environment, never a file edit.
  const GLITCHTIP_HOST = 'glitchtip.nikatru.com';
  const token = process.env.GLITCHTIP_TOKEN;
  if (!token) {
    console.error(`${NAME}: --live needs GLITCHTIP_TOKEN in the environment. Refusing to report a pass it did not make.`);
    process.exit(2);
  }
  const base = (process.env.GLITCHTIP_URL ?? `https://${GLITCHTIP_HOST}`).replace(/\/+$/, '');
  const declPath = join(ROOT, 'tooling', 'ops', 'glitchtip-project.json');
  if (!existsSync(declPath)) {
    coverageLost(['tooling/ops/glitchtip-project.json is not there, so --live has no project to probe.']);
  }
  const decl = JSON.parse(readFileSync(declPath, 'utf8'));
  const api = async (path, init) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON; `text` is the evidence */ }
    return { status: res.status, text, json };
  };

  // The DSN is READ OFF THE INSTANCE, not held as a second credential. One
  // token, one host, and the public key can never drift from the project the
  // declaration names.
  const keys = await api(`/api/0/projects/${decl.org}/${decl.project}/keys/`);
  if (keys.status !== 200 || !Array.isArray(keys.json) || keys.json.length === 0) {
    coverageLost([
      `could not read a project key for ${decl.org}/${decl.project} (HTTP ${keys.status}).`,
      'Without the DSN there is nothing to POST a probe event to, so nothing was measured.',
    ]);
  }
  const dsn = String(keys.json[0]?.dsn?.public ?? '');
  const parsed = /^https?:\/\/([0-9a-f]+)@[^/]+\/(\d+)$/.exec(dsn);
  if (!parsed) {
    coverageLost([`the project key's DSN is not a shape this probe can post to.`]);
  }
  const [, publicKey, projectId] = parsed;

  // Globally routable, NOT documentation ranges — see the header. Two different
  // literals so a control row can never be read as the subject's.
  const SPOOF_CONTROL = '1.2.3.4';
  const SPOOF_SUBJECT = '8.8.8.8';
  const SPOOFED_HEADERS = [
    'X-Forwarded-For', 'X-Real-IP', 'Client-IP', 'X-Client-IP', 'X-Forwarded',
    'X-Cluster-Client-IP', 'Forwarded-For', 'True-Client-IP', 'Fastly-Client-IP',
  ];
  const run = Date.now();
  const hex = () => [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

  const send = async (marker, spoof, user) => {
    const eventId = hex();
    const headers = {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${NAME}/1.0, sentry_key=${publicKey}`,
      Forwarded: `for=${spoof}`,
    };
    for (const h of SPOOFED_HEADERS) headers[h] = spoof;
    const body = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'other',
      level: 'error',
      logentry: { formatted: marker },
      exception: { values: [{ type: 'NikatruIpProbe', value: marker }] },
      ...(user ? { user } : {}),
    };
    const res = await fetch(`${base}/api/${projectId}/store/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { eventId, marker, status: res.status, text: (await res.text()).slice(0, 200) };
  };

  const subjectMarker = `nikatru-ip-probe-subject-${run}`;
  const controlMarker = `nikatru-ip-probe-control-${run}`;
  const subject = await send(subjectMarker, SPOOF_SUBJECT, null);
  const control = await send(controlMarker, SPOOF_CONTROL, { ip_address: SPOOF_CONTROL, id: controlMarker });
  console.log(`${NAME}: --live run ${run}`);
  console.log(`  SUBJECT  ${subject.eventId}  HTTP ${subject.status}  (no user in the payload, ${SPOOFED_HEADERS.length} spoofed headers + Cloudflare's real CF-Connecting-IP)`);
  console.log(`  CONTROL  ${control.eventId}  HTTP ${control.status}  (user.ip_address = ${SPOOF_CONTROL} in the payload)`);
  for (const leg of [subject, control]) {
    if (leg.status < 200 || leg.status >= 300) {
      coverageLost([
        `the ${leg === subject ? 'SUBJECT' : 'CONTROL'} event was refused by the sink (HTTP ${leg.status}).`,
        leg.text,
        'Nothing landed, so nothing was measured. A probe that could not send is not a probe that found no IP.',
      ]);
    }
  }

  // Ingest is asynchronous. Poll rather than sleep-and-hope, and give up loudly.
  const deadline = Date.now() + 90_000;
  let stored = null;
  while (Date.now() < deadline) {
    const events = await api(`/api/0/projects/${decl.org}/${decl.project}/events/?limit=50`);
    if (events.status === 200 && Array.isArray(events.json)) {
      const byId = (id) => events.json.find((e) => String(e.eventID ?? '').toLowerCase() === id.toLowerCase());
      const s = byId(subject.eventId);
      const c = byId(control.eventId);
      if (s && c) { stored = { subject: s, control: c }; break; }
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!stored) {
    coverageLost([
      'the two probe events did not both appear in the project event list within 90s.',
      'Reading "no IP" off an event that is not there is reading it off nothing, so this is not a pass.',
    ]);
  }

  // What counts as an IP in a stored event: an IP-BEARING KEY anywhere in the
  // JSON, or an IP-SHAPED VALUE anywhere in it. Both, because the two failure
  // modes are different — a restored `user.ip_address` is the structured leak,
  // and an address in a message is the free-text one L3 exists for.
  const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
  const KEY_SET = new Set(IP_FIELDS.map((f) => f.toLowerCase()));
  const scan = (node, path, out) => {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node)) {
      node.forEach((v, i) => scan(v, `${path}[${i}]`, out));
      return out;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (KEY_SET.has(k.toLowerCase())) out.keys.push(`${path}.${k} = ${JSON.stringify(v)}`);
        scan(v, `${path}.${k}`, out);
      }
      return out;
    }
    if (typeof node === 'string' && IPV4.test(node)) out.values.push(`${path} = ${JSON.stringify(node)}`);
    return out;
  };

  const controlHit = scan(stored.control, 'control', { keys: [], values: [] });
  if (controlHit.keys.length === 0) {
    coverageLost([
      'the CONTROL event came back with NO IP-bearing key, though one was sent in its payload.',
      'So this read-back cannot see an IP field even when there is one, and the subject\'s clean result',
      'is consistent with a blind probe. That is a VOID run, and a void control read as a pass is the',
      'single failure mode this leg exists to prevent.',
      `control event ${control.eventId} (${controlMarker})`,
    ]);
  }
  console.log(`  control sees ${controlHit.keys.length} IP-bearing key(s) — the read-back is not blind:`);
  for (const k of controlHit.keys) console.log(`    ${k}`);

  const subjectHit = scan(stored.subject, 'subject', { keys: [], values: [] });
  // The probe's own marker carries no address, so any IPv4 shape in the subject
  // came from the sink, not from us.
  if (subjectHit.keys.length || subjectHit.values.length) {
    console.error(`${NAME}: the live sink STORED an IP for the subject event ${subject.eventId}:`);
    for (const k of subjectHit.keys) console.error(`  key   ${k}`);
    for (const v of subjectHit.values) console.error(`  value ${v}`);
    console.error('  The eleven-header strip in front of the sink is not load-bearing any more, or');
    console.error('  cloudflared has been pointed past nginx straight at the ingest port — the one');
    console.error('  regression Private/runbooks/boxes/hostinger.md warns about by name.');
    process.exit(1);
  }
  console.log(`${NAME}: live check OK — subject event ${subject.eventId} carries no IP-bearing key and no IP-shaped value, while the control proves the read-back would have seen one.`);
}
