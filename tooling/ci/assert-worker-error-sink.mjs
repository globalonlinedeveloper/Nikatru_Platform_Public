#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-worker-error-sink.mjs — [pipeline 11]E-8. A Worker's unhandled error
// is CAPTURED, not console-only.
//
// WHY THIS EXISTS. Measured at HEAD on 2026-08-02:
// `grep -rn "sentry\|glitchtip\|toucan" services/` returned ZERO HITS, while
// the Flutter app's crashes had been reaching GlitchTip since July. Both
// Workers' `app.onError` logged and returned 500 — and on Cloudflare Free
// `console.error` produces exactly one artefact nobody sees, because
// `wrangler tail` is a LIVE STREAM and there is no searchable history. So an
// unhandled error on the SHARED Worker (every stamped app's analytics, consent,
// entitlement and merchant-of-record traffic) was invisible the moment it
// happened, and the only person who ever knew was the user who got the 500.
//
// THIS GUARD IS THE STRUCTURE. The BEHAVIOUR — the envelope's shape, its
// release string, its privacy invariants, the fail-open paths — is asserted by
// `services/*/test/error-sink.test.ts`, which drives the REAL `onError` through
// the REAL app. Splitting them is deliberate: a source scan can tell you the
// wire is connected and can never tell you what travels down it, and a unit
// test can prove the module works while nothing calls it. Four capabilities in
// this repo shipped exactly that way (assert-seams-wired.mjs's header).
//
// FIVE LIMBS
//   1 · COVERAGE. The subject set is every `services/*/src/index.ts`, DERIVED,
//       floored at the 2 that exist today. A derived set that shrinks to
//       nothing iterates zero Workers and prints ok.
//   2 · Each entrypoint declares `app.onError(` and its handler CALLS the sink.
//       Not "the file mentions it" — the call must be inside the handler, or
//       the wire runs to a function nobody reaches.
//   3 · Each service HAS the sink module, exporting `reportWorkerError`.
//   4 · The release is not `API_VERSION`. That var is the literal "v1" in both
//       Workers and has never changed; using it as a release id would put every
//       error this factory ever reports into one bucket named after a URL
//       prefix — an attribution that cannot tell today's deploy from the one
//       that introduced the bug. Until [9]R-2 lands a real release id, the
//       release is the deployed SHA, and this limb is what stops it silently
//       becoming the constant again.
//   5 · The DEPLOY supplies both vars, per JOB. Checking only the source would
//       keep passing with a Worker that reads a variable no deploy sets — which
//       is a fail-closed sink with no proven open path, i.e. a dead feature that
//       reports healthy.
//
// Everything is read from COMMENT-STRIPPED source: a header comment explaining
// that a Worker reports its errors matches every pattern looking for it doing
// so, and this repository has shipped that defect twice.
//
// Usage:  node tooling/ci/assert-worker-error-sink.mjs [repoRoot]
// Exit 0 = every Worker's unhandled error reaches a declared sink.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const SERVICES = 'services';
const SINK_MODULE = 'src/lib/error-sink.ts';
const SINK_FN = 'reportWorkerError';
const DEPLOY_WORKFLOW = '.github/workflows/deploy-workers.yml';
/** The vars the sink needs at runtime, and the deploy must supply. */
const DEPLOY_VARS = ['GLITCHTIP_DSN', 'RELEASE'];

// Every Worker entrypoint that exists today, DERIVED from the services tree and
// floored: a scan that stops finding Workers iterates nothing and prints ok.
const MIN_WORKERS = 2;

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => {
  console.error(`✗ COVERAGE LOST — ${m}`);
  process.exit(1);
};

const rel = (p) => join(ROOT, ...p.split('/'));
const read = (p) => readFileSync(rel(p), 'utf8');

if (!existsSync(rel(SERVICES))) {
  coverageLost(`no ${SERVICES}/ directory under ${ROOT}. The scan is broken, not the tree.`);
}

const workers = listDir(rel(SERVICES), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .filter((name) => existsSync(rel(`${SERVICES}/${name}/src/index.ts`)))
  .sort();

if (workers.length < MIN_WORKERS) {
  coverageLost(
    `${workers.length} Worker entrypoint(s) found under ${SERVICES}/*/src/index.ts, fewer than the ${MIN_WORKERS} that exist today. ` +
      'Every limb below quantifies over that set, so a shrunken one certifies the Workers it can still see and says ' +
      'nothing at all about the rest.',
  );
}

/** The balanced body of the `app.onError(` call, or null. Read as a span rather
 *  than by line so a multi-line handler is seen whole — a line-oriented match
 *  would find the `onError(` and none of what it does. */
function onErrorBody(src) {
  const at = src.indexOf('app.onError(');
  if (at === -1) return null;
  const open = at + 'app.onError'.length;
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** The lines of ONE job of a workflow — the define must sit in the job that
 *  deploys the Worker it is about, not merely somewhere in the file. */
function jobBody(yaml, jobName) {
  const lines = yaml.split('\n');
  const jobsAt = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsAt === -1) return null;
  const startsKey = (l) => /^ {2}[^\s#][^\n]*:/.test(l);
  let start = -1;
  for (let i = jobsAt + 1; i < lines.length; i++) {
    if (start === -1) {
      if (new RegExp(`^ {2}${jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(lines[i])) start = i;
      continue;
    }
    if (startsKey(lines[i]) || /^\S/.test(lines[i])) return lines.slice(start, i).join('\n');
  }
  return start === -1 ? null : lines.slice(start).join('\n');
}

const deployText = existsSync(rel(DEPLOY_WORKFLOW)) ? read(DEPLOY_WORKFLOW) : null;
if (deployText === null) {
  coverageLost(
    `${DEPLOY_WORKFLOW} does not exist, so limb 5 cannot ask whether any deploy supplies the sink's vars — ` +
      'and a Worker reading a variable no deploy sets is a fail-closed sink with no proven open path.',
  );
}

let wired = 0;
for (const name of workers) {
  const entryPath = `${SERVICES}/${name}/src/index.ts`;
  const entry = stripSourceComments(read(entryPath), '.ts');
  let problems = 0;

  // ── 2 · the handler exists and CALLS the sink ─────────────────────────────
  const handler = onErrorBody(entry);
  if (handler === null) {
    fail(
      `${entryPath} declares no \`app.onError(\`, so an unhandled error takes Hono's default path and this ` +
        'Worker reports nothing at all.',
    );
    problems++;
  } else if (!handler.includes(`${SINK_FN}(`)) {
    fail(
      `${entryPath}'s \`app.onError\` does not call \`${SINK_FN}(\`. It logs and returns 500 — and on Free, ` +
        '`console.error` goes to a `wrangler tail` stream nobody is watching, with no searchable history behind it. ' +
        'The error is invisible the moment it happens.',
    );
    problems++;
  }

  // ── 3 · the sink module is there ──────────────────────────────────────────
  const sinkPath = `${SERVICES}/${name}/${SINK_MODULE}`;
  if (!existsSync(rel(sinkPath))) {
    fail(`${sinkPath} does not exist, so \`${SINK_FN}\` in ${entryPath} resolves to nothing.`);
    problems++;
  } else {
    const sink = stripSourceComments(read(sinkPath), '.ts');
    if (!new RegExp(`export\\s+(async\\s+)?function\\s+${SINK_FN}\\b`).test(sink)) {
      fail(`${sinkPath} does not export \`${SINK_FN}\`.`);
      problems++;
    }
    if (!/\bfetch\s*\(/.test(sink)) {
      fail(
        `${sinkPath} performs no \`fetch\` — a sink that does not leave the isolate is a log line with more steps.`,
      );
      problems++;
    }
    if (!/\bserver_name\b/.test(sink)) {
      fail(
        `${sinkPath}'s payload carries no \`server_name\`. Both Workers report into the same GlitchTip project, so ` +
          'a report that cannot say WHICH Worker produced it is a report nobody can act on.',
      );
      problems++;
    }
    // ── 4 · the release is not the constant ─────────────────────────────────
    if (!/\brelease\b/.test(sink)) {
      fail(`${sinkPath}'s payload carries no \`release\`, so every error lands unattributed to a deploy.`);
      problems++;
    }
    if (/\bAPI_VERSION\b/.test(sink)) {
      fail(
        `${sinkPath} reads \`API_VERSION\`. That var is the literal "v1" in both Workers and has never changed, so ` +
          'using it as a release id groups every error this factory will ever report into one bucket named after a ' +
          'URL prefix — an attribution that cannot tell today\'s deploy from the one that introduced the bug. ' +
          'Until [9]R-2 lands a real release id, the release is the deployed SHA supplied as `--var RELEASE:`.',
      );
      problems++;
    }
  }

  // ── 5 · the deploy supplies the vars, in THIS Worker's job ────────────────
  const job = jobBody(deployText, name);
  if (job === null) {
    fail(
      `COVERAGE LOST — ${DEPLOY_WORKFLOW} has no job named \`${name}\`, so this scan cannot tell whether that ` +
        "Worker's deploy supplies the sink's vars. A renamed job silently removes the only end-to-end half of this check.",
    );
    problems++;
  } else {
    for (const v of DEPLOY_VARS) {
      // No `#` before the match: a flag behind a comment marker is prose, and
      // inside a folded scalar that `#` is a shell comment swallowing the rest
      // of the line too. Same rule as the crash-sink check in
      // assert-seams-wired.mjs, learned the same way.
      if (!new RegExp(`^[^#\\n]*--var ${v}:`, 'm').test(job)) {
        fail(
          `${DEPLOY_WORKFLOW} job \`${name}\` does not pass \`--var ${v}:\`. The Worker reads a variable no deploy ` +
            'sets, so the sink is fail-closed with no proven open path — a dead feature that reports healthy, which ' +
            'is exactly the shape [pipeline C-6] exists to reject.',
        );
        problems++;
      }
    }
  }

  if (problems === 0) {
    ok(`${name} — onError calls ${SINK_FN}, the sink POSTs a named+released envelope, and the deploy supplies ${DEPLOY_VARS.join(' + ')}`);
    wired++;
  }
}

const summary =
  `worker error sink — ${wired}/${workers.length} Worker(s) report unhandled errors to a declared sink ` +
  `(${workers.join(', ')}); behaviour is asserted by services/*/test/error-sink.test.ts`;

if (failed) {
  console.error(`\n${summary}`);
  console.error('assert-worker-error-sink: FAILED');
  process.exit(1);
}
ok(summary);
