// ─────────────────────────────────────────────────────────────────────────────
// e2e-auth-target.test.mjs — the two target-aware E2E harness steps, exercised
// against a real HTTP server rather than exempted.
//
// `tooling/e2e/captcha_posture.mjs` and `tooling/e2e/assert_one_issuer.mjs` are
// the halves of the cutover blocker that assert a DIFFERENT fact depending on
// which auth stack `e2e.yml` pointed the run at. Every other file under
// `tooling/e2e/` carries an entry in assert-guard-coverage's
// NO_NEGATIVE_TEST_NEEDED map, on the honest ground that a fixture cannot model
// a live deletion or a live consent row. These two are not in that class: both
// take an HTTP answer and turn it into an exit code, and an HTTP answer is
// exactly what a loopback server can produce. So they get real failing cases.
//
// 🔴 WHAT IS ACTUALLY BEING PROTECTED. Each script has a branch that must exit 1
// on a response that LOOKS ordinary:
//   · hosted answering `captcha_failed` — hosted Supabase has begun enforcing a
//     captcha, so a web build carrying TURNSTILE_SITE_KEY may be one nobody can
//     sign in to. Silence here would be a deploy that breaks sign-in.
//   · boxa answering `invalid_credentials` — the captcha gate on the auth box is
//     OFF, which is an open anonymous signup, not a test failure.
//   · boxa's session being ACCEPTED by the Worker — the Workers now trust two
//     issuers, which nothing in services/ implements and nobody decided.
// A green control precedes each of those, because a case that fails for the
// wrong reason is not a case at all.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CAPTCHA_POSTURE = join(REPO, 'tooling', 'e2e', 'captcha_posture.mjs');
const ONE_ISSUER = join(REPO, 'tooling', 'e2e', 'assert_one_issuer.mjs');

/** What the fake GoTrue / Worker should answer on this case. Mutated per test. */
const plan = {
  tokenStatus: 400,
  tokenBody: { error_code: 'invalid_credentials' },
  generateLinkStatus: 200,
  generateLinkBody: { hashed_token: 'pkce_deadbeefdeadbeefdeadbeefdeadbeef' },
  verifyStatus: 200,
  verifyBody: { access_token: 'header.payload.signature' },
  apiStatus: 200,
  apiBody: [],
};

let server;
let origin;

/** A token whose PAYLOAD is real base64url JSON and whose signature is a
 *  placeholder. `assert_one_issuer.mjs` never verifies a signature — the
 *  deployed Worker does, and what the Worker did is the assertion — so the only
 *  property a fixture token needs is a payload that decodes. Built per case
 *  rather than pinned, because the `iss` under test has to carry THIS run's
 *  loopback origin: the script compares it against the SUPABASE_URL it was given.
 */
function tokenWithPayload(payload) {
  const seg = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(payload)}.signature-is-never-checked-here`;
}

/** The shape the live stacks are supposed to mint: `iss` = SUPABASE_URL +
 *  `/auth/v1`, byte for byte, which is what services/_shared/src/auth.ts:88
 *  hands `jwtVerify`. Set once the loopback port is known. */
let goodToken;

before(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // Bodies are read and discarded: what is under test is how the SCRIPT reads
    // an answer, not what GoTrue does with a request.
    req.resume();
    if (path === '/auth/v1/token') return answer(plan.tokenStatus, plan.tokenBody);
    if (path === '/auth/v1/admin/generate_link') {
      return answer(plan.generateLinkStatus, plan.generateLinkBody);
    }
    if (path === '/auth/v1/verify') return answer(plan.verifyStatus, plan.verifyBody);
    if (path === '/v1/subscriptions') return answer(plan.apiStatus, plan.apiBody);
    return answer(404, { error: 'no such route in the fake' });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  goodToken = tokenWithPayload({ iss: `${origin}/auth/v1`, sub: 'fixture-user-id', role: 'authenticated' });
});

after(async () => {
  await new Promise((done) => server.close(done));
});

/** Runs one of the two scripts and resolves with its exit code and output.
 *
 * 🔴 ASYNC, AND `spawnSync` IS THE BUG IT REPLACES. The fake GoTrue above lives
 * in THIS process, so a synchronous spawn blocks the event loop that has to
 * answer the child's request: the child waits for a response nobody can send and
 * the parent waits for a child that cannot finish. Measured 2026-09-07 — the
 * suite hung rather than failed, which is the worse of the two.
 */
function run(script, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script], {
      cwd: REPO,
      env: {
        ...process.env,
        SUPABASE_URL: origin,
        SUPABASE_ANON_KEY: 'anon-key-for-the-fake',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-the-fake',
        E2E_EMAIL: 'subscriptiontracker-e2e+fixture@nikatru.com',
        API_BASE_URL: origin,
        ...env,
      },
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => done({ code, out }));
  });
}

describe('captcha_posture.mjs — what the target does with a token it never asked for', () => {
  test('GREEN CONTROL · hosted ignores the token and checks the password', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'invalid_credentials' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /MEASURED: hosted GoTrue IGNORED the captcha token/);
  });

  test('hosted answering captcha_failed FAILS — it has started enforcing a gate', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'captcha_failed' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Captcha posture changed/);
  });

  test('GREEN CONTROL · boxa refuses at the captcha before the password', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'captcha_failed' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Box A REFUSED the request at the captcha/);
  });

  test('boxa answering invalid_credentials FAILS — the gate is off', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'invalid_credentials' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Box A captcha gate is not answering/);
  });

  test('a 200 on the sign-in FAILS on either target — nobody signed anybody in', async () => {
    plan.tokenStatus = 200;
    plan.tokenBody = { access_token: 'this-should-never-happen' };
    const hosted = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(hosted.code, 1, hosted.out);
    const boxa = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(boxa.code, 1, boxa.out);
  });

  test('an unknown target FAILS rather than defaulting to the safe-looking one', async () => {
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'staging' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /must be "hosted" or "boxa"/);
  });

  test('a missing SUPABASE_ANON_KEY FAILS rather than probing with an empty one', async () => {
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted', SUPABASE_ANON_KEY: '' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Missing required env var: SUPABASE_ANON_KEY/);
  });
});

describe('assert_one_issuer.mjs — the Workers trust exactly one issuer', () => {
  before(() => {
    plan.generateLinkStatus = 200;
    plan.generateLinkBody = { hashed_token: 'pkce_deadbeefdeadbeefdeadbeefdeadbeef' };
    plan.verifyStatus = 200;
    // Was the literal `header.payload.signature` until 2026-09-22. The script now
    // READS the payload back, so the default session has to be one a reader can
    // read; the old placeholder survives as T3's undecodable case, where it is
    // the point rather than a stand-in.
    plan.verifyBody = { access_token: goodToken };
  });

  test('GREEN CONTROL · hosted mints a session the Worker accepts', async () => {
    plan.apiStatus = 200;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ASSERTED: the deployed Worker accepts a hosted-minted session/);
  });

  test('hosted being refused 401 FAILS — the Workers no longer trust the project they are configured for', async () => {
    plan.apiStatus = 401;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /One-issuer check/);
  });

  test('GREEN CONTROL · boxa is refused 401, and the refusal is the pass', async () => {
    plan.apiStatus = 401;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Refusal here is the PASS/);
  });

  test('boxa being ACCEPTED FAILS, and says so as a security finding', async () => {
    plan.apiStatus = 200;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /trust TWO issuers/);
  });

  test('no access_token FAILS before the Worker is ever asked', async () => {
    plan.apiStatus = 200;
    plan.verifyStatus = 403;
    plan.verifyBody = { error_code: 'otp_expired' };
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Could not mint a session/);
    plan.verifyStatus = 200;
    plan.verifyBody = { access_token: goodToken };
  });

  test('generate_link answering without a hashed_token FAILS rather than sending an empty one', async () => {
    plan.generateLinkBody = { action_link: 'https://example.invalid/verify' };
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /No hashed_token in generate_link response/);
    plan.generateLinkBody = { hashed_token: 'pkce_deadbeefdeadbeefdeadbeefdeadbeef' };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE `iss` READBACK — added 2026-09-22 for O-PHASE5-ISSUER-SUFFIX.
  //
  // 🔴 WHAT IS BEING PROTECTED HERE IS A READING, NOT A VERDICT. The step's
  // 401-on-boxa / 200-on-hosted assertion is unchanged and is exercised by the
  // six cases above. These four hold the three lines that were added to READ the
  // live issuer out of the token, because `BOXA_SUPABASE_URL` is a repository
  // secret: in a real log the value prints `***`, so the only evidence that
  // survives is the PATH and two yes/no comparisons computed in-process.
  // T2 is the defect the row was opened for — an issuer that is the bare URL,
  // missing the `/auth/v1` suffix the Workers build their JWKS check from — and
  // it must READ as "no" while the step still passes, or the reading would only
  // ever be available on a run that had already failed for another reason.
  // ───────────────────────────────────────────────────────────────────────────

  test('T1 · an iss equal to SUPABASE_URL + /auth/v1 reads "yes" on both comparisons', async () => {
    plan.apiStatus = 200;
    plan.verifyBody = { access_token: goodToken };
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^iss path {4}: \/auth\/v1$/m);
    assert.match(r.out, /^iss host equals SUPABASE_URL host: yes$/m);
    assert.match(r.out, /^iss equals SUPABASE_URL \+ \/auth\/v1: yes$/m);
    assert.doesNotMatch(r.out, /READ BACK, NOT ASSERTED/);
  });

  test('T2 · an iss WITHOUT the /auth/v1 suffix reads "no", prints the wrong path, and still passes', async () => {
    plan.apiStatus = 200;
    // The historical shape: GOTRUE_JWT_ISSUER set to the bare project URL.
    plan.verifyBody = { access_token: tokenWithPayload({ iss: origin, sub: 'fixture-user-id' }) };
    const bare = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(bare.code, 0, bare.out); // the reading reports; the assertion judges
    assert.match(bare.out, /^iss path {4}: \/$/m);
    assert.match(bare.out, /^iss host equals SUPABASE_URL host: yes$/m);
    assert.match(bare.out, /^iss equals SUPABASE_URL \+ \/auth\/v1: no$/m);
    assert.match(bare.out, /READ BACK, NOT ASSERTED/);
    assert.match(bare.out, /ASSERTED: the deployed Worker accepts a hosted-minted session/);

    // 🔴 AND THE NEAR MISS, because `jwtVerify`'s `issuer` is a string compare:
    // one trailing slash is a different issuer and must not read as "yes".
    plan.verifyBody = { access_token: tokenWithPayload({ iss: `${origin}/auth/v1/` }) };
    const slash = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(slash.code, 0, slash.out);
    assert.match(slash.out, /^iss host equals SUPABASE_URL host: yes$/m);
    assert.match(slash.out, /^iss equals SUPABASE_URL \+ \/auth\/v1: no$/m);
    plan.verifyBody = { access_token: goodToken };
  });

  test('T3 · a token the reader cannot decode FAILS the step with exit 2, on all four ways it can fail', async () => {
    plan.apiStatus = 200;
    const undecodable = [
      ['not three segments', 'header.payload'],
      ['a payload that is not JSON', 'header.payload.signature'],
      ['JSON that is not an object', tokenWithPayload(['iss', 'https://example.invalid/auth/v1'])],
      ['an object with no iss', tokenWithPayload({ sub: 'fixture-user-id', role: 'authenticated' })],
    ];
    for (const [why, token] of undecodable) {
      plan.verifyBody = { access_token: token };
      const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
      // 2, not 1: the one-issuer FACT is untouched — the Worker answered 200 and
      // the assertion below it passed — and the run still fails, because a step
      // that cannot take its reading must not report one.
      assert.equal(r.code, 2, `${why}: ${r.out}`);
      assert.match(r.out, /::error title=Issuer readback::/);
      assert.match(r.out, /ASSERTED: the deployed Worker accepts a hosted-minted session/);
      assert.doesNotMatch(r.out, /^iss equals SUPABASE_URL \+ \/auth\/v1: (yes|no)$/m);
    }
    plan.verifyBody = { access_token: goodToken };
  });

  test('T4 · nothing the readback prints carries the token, the payload or the service key', async () => {
    plan.apiStatus = 200;
    plan.verifyBody = { access_token: goodToken };
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 0, r.out);
    // The ONLY line allowed to carry the token is the one that tells Actions to
    // mask it, and it has to be there: without it the raw token reaches the log.
    const masks = r.out.split('\n').filter((l) => l.startsWith('::add-mask::'));
    assert.ok(masks.includes(`::add-mask::${goodToken}`), 'the access token is not masked');
    const payloadSegment = goodToken.split('.')[1];
    for (const line of r.out.split('\n').filter((l) => !l.startsWith('::add-mask::'))) {
      assert.ok(!line.includes(goodToken), `a line carries the whole token: ${line}`);
      assert.ok(!line.includes(payloadSegment), `a line carries the payload segment: ${line}`);
      assert.ok(!line.includes('service-role-key-for-the-fake'), `a line carries the service key: ${line}`);
      assert.ok(!line.includes('pkce_deadbeef'), `a line carries the magic-link token: ${line}`);
      assert.ok(!line.includes('fixture-user-id'), `a line carries a claim other than iss: ${line}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DELIVERY SHAPE OF THE RESOLVED SECRETS — added 2026-09-07 after the
// constraints-and-traps review's M1 and the carry-forward review's §5.3.
//
// The first pass resolved the target in the preflight and handed the three
// values on through `$GITHUB_ENV`. That is job-wide: every later step in the
// job inherits them, including `nanasess/setup-chromedriver` and
// `actions/upload-artifact`, neither of which ever saw SUPABASE_SERVICE_ROLE_KEY
// on origin/main (bound per step there, at five places). The register row this
// unit wrote for that name calls it "the key that BYPASSES THE TURNSTILE GATE",
// so the blast radius of a job-wide binding is the whole point.
//
// These cases hold the SHAPE that replaced it. Each one runs its predicate
// against the real file first (the green control) and then against a mutated
// copy that reintroduces exactly the defect (the mutation), so a case that
// passes because the predicate stopped looking is caught by its own sibling.
// ─────────────────────────────────────────────────────────────────────────────
const E2E_YML = join(REPO, '.github', 'workflows', 'e2e.yml');

/** Splits the `e2e` job's steps into { name, env, text } — the same 6/8/10-space
 *  shape assert-green-means-ran.mjs:165-207 reads, deliberately: a step this
 *  splitter and that guard disagree about is a step nobody is grading. */
function e2eSteps(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^ {2}e2e:\s*$/.test(l));
  if (at === -1) throw new Error('no e2e job in e2e.yml');
  const blocks = [];
  let inSteps = false;
  for (const line of lines.slice(at + 1)) {
    if (/^ {2}\S/.test(line)) break; // the next job
    if (/^ {4}steps:\s*$/.test(line)) { inSteps = true; continue; }
    if (!inSteps) continue;
    if (/^ {6}-/.test(line)) blocks.push([line]);
    else if (blocks.length) blocks[blocks.length - 1].push(line);
  }
  return blocks.map((block) => {
    const body = block.join('\n');
    const name = body.match(/name:\s*(.+)$/m)?.[1]?.trim() ?? '(unnamed)';
    const env = new Map();
    const envAt = block.findIndex((l) => /^ {8}env:\s*$/.test(l));
    if (envAt !== -1) {
      for (const l of block.slice(envAt + 1)) {
        const m = l.match(/^ {10}([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/);
        if (!m) break;
        env.set(m[1], m[2].trim());
      }
    }
    return { name, env, text: body };
  });
}

/** The three resolved identity names this workflow may not hand to a whole job. */
const JOB_WIDE = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

/** FINDING for every line that writes a resolved identity value job-wide. */
function jobWideWrites(text) {
  return text
    .split('\n')
    .filter((l) => JOB_WIDE.some((n) => new RegExp(`echo "${n}=`).test(l)));
}

/** FINDING when the preflight has no fail-closed empty-sitekey limb. */
function sitekeyLimbMissing(text) {
  const steps = e2eSteps(text);
  const pre = steps.find((s) => /sitekey must be present/.test(s.name));
  if (!pre) return ['no sitekey preflight step at all'];
  const bad = [];
  if (!/-z\s+"\$TURNSTILE_SITE_KEY"/.test(pre.text)) bad.push('no -z "$TURNSTILE_SITE_KEY" test');
  if (!pre.env.has('TURNSTILE_SITE_KEY')) bad.push('the preflight env does not bind TURNSTILE_SITE_KEY');
  if (!/TURNSTILE_SITE_KEY is unset[\s\S]*?exit 1/.test(pre.text)) bad.push('the empty branch does not end the job');
  // 🔴 AND IT MUST RUN BEFORE ANYTHING REAL. A fail-closed check that sits after
  // the drive step refuses a run that already happened.
  const at = steps.indexOf(pre);
  const drive = steps.findIndex((s) => /Run integration tests/.test(s.name));
  if (drive !== -1 && at > drive) bad.push('the sitekey check runs after the suite it is supposed to gate');
  // 🔴 AND IT MUST NOT LIVE INSIDE THE SECRETS PREFLIGHT. assert-green-means-ran
  // section B1 asks only whether that step contains ANY exit, so a third refusal
  // there makes green-means-ran.test.mjs's "does not exit non-zero" mutation
  // pass with both secret refusals removed — measured EXIT 0 where it expects 1.
  // env, not text: a block ends at the next step's , so the trailing   // of the NEXT step is part of this one's text — the binding is the fact.
  const secrets = steps.find((s) => /secrets must be present/.test(s.name));
  if (secrets && secrets.env.has('TURNSTILE_SITE_KEY')) {
    bad.push('the sitekey check is folded back into the secrets preflight, blunting section B1');
  }
  return bad;
}

/** What each harness script needs from the resolved set, read off its own header. */
const NEEDS = new Map([
  ['tooling/e2e/provision_user.mjs', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']],
  ['tooling/e2e/captcha_posture.mjs', ['SUPABASE_URL', 'SUPABASE_ANON_KEY']],
  ['tooling/e2e/assert_one_issuer.mjs', ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']],
  ['tooling/e2e/verify_purged.mjs', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']],
  ['tooling/e2e/purge.mjs', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']],
]);

/** FINDING for every step that runs a script needing a name it does not bind. */
function unboundConsumers(text) {
  const bad = [];
  for (const step of e2eSteps(text)) {
    for (const [script, names] of NEEDS) {
      if (!step.text.includes(script)) continue;
      for (const n of names) if (!step.env.has(n)) bad.push(`${step.name} runs ${script} without binding ${n}`);
    }
  }
  return bad;
}

/** FINDING when a binding can hand back the OTHER target's value.
 *
 * 🔴 THE `secrets.BOXA_` GUARD-CLAUSE IS THE LIMB THIS FUNCTION WAS MISSING, NOT
 * A FILTER. Until 2026-09-07 this loop opened with
 * `if (!/secrets\.BOXA_/.test(value)) continue;`, so a binding whose value never
 * NAMES a Box A secret was skipped before any check ran — and that is precisely
 * the wrong shape. `unboundConsumers()` above only asks whether the NAME is
 * bound; nothing asked what it was bound TO. The eighteen consuming bindings are
 * eighteen hand-copied ternaries with no source of truth, and re-binding one of
 * them to the raw `${{ secrets.SUPABASE_URL }}` left this suite at 25/25, EXIT 0
 * (measured on head f045baf9, step "Provision throwaway confirmed user"). At
 * run time that is an `auth_target=boxa` run provisioning its throwaway user on
 * the HOSTED PRODUCTION project while the run is named boxa — verbatim the false
 * green tooling/publishable-inputs.json's E2E_AUTH_TARGET residual says this
 * axis exists to make impossible. One limb, one place, and every future
 * consuming step is graded for free.
 */
function crossContaminating(text) {
  const bad = [];
  for (const step of e2eSteps(text)) {
    for (const [name, value] of step.env) {
      if (!JOB_WIDE.includes(name)) continue;
      if (!/secrets\.BOXA_/.test(value)) {
        if (/secrets\.(SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)\b/.test(value)) {
          bad.push(
            `${step.name}: ${name} resolves to the hosted secret with no target axis at all — ` +
              'an auth_target=boxa run would drive this step against the hosted production project',
          );
        }
        continue;
      }
      if (!/== 'hosted' && secrets\./.test(value)) bad.push(`${step.name}: ${name} falls back instead of resolving`);
      if (!/\|\| '' \}\}$/.test(value)) bad.push(`${step.name}: ${name} has no empty final arm`);
    }
  }
  return bad;
}

/** FINDING when the SECRETS preflight ends the job anywhere but the one place it
 *  is allowed to.
 *
 * 🔴 WHY A COUNT AND NOT A SHAPE. assert-green-means-ran.mjs section B1
 * (:378-385) asks whether a step that reads a secret and branches on its
 * emptiness contains ANY `exit <n>`; it cannot tell which branch exits. So the
 * moment step `pre` holds a SECOND `exit`, that guard goes green over the
 * deletion of the first — measured on head f045baf9, where an unreachable
 * `auth_target` refusal kept the guard at EXIT 0 while the missing-secret
 * refusal was gone, against EXIT 1 for the identical deletion on origin/main.
 * The count is the property; the arm was hoisted into its own step to restore it.
 */
function preflightExits(text) {
  const pre = e2eSteps(text).find((s) => /secrets must be present/.test(s.name));
  if (!pre) return ['no secrets preflight step at all'];
  return pre.text.split('\n').filter((l) => /^\s*exit\s+[1-9]\d*\s*$/.test(l));
}

describe('e2e.yml — the resolved auth values are bound per step, never job-wide', () => {
  const real = readFileSync(E2E_YML, 'utf8');

  test('GREEN CONTROL · no SUPABASE_* value is written to $GITHUB_ENV', () => {
    assert.deepEqual(jobWideWrites(real), []);
  });

  test('MUTATION · re-adding the $GITHUB_ENV write is caught', () => {
    const mutated = real.replace(
      'echo "E2E_AUTH_TARGET=${TARGET}" >> "$GITHUB_ENV"',
      'echo "SUPABASE_SERVICE_ROLE_KEY=${key}" >> "$GITHUB_ENV"',
    );
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.equal(jobWideWrites(mutated).length, 1);
  });

  test('GREEN CONTROL · every consuming step binds the names its script needs', () => {
    assert.deepEqual(unboundConsumers(real), []);
  });

  test('MUTATION · dropping one per-step SUPABASE_SERVICE_ROLE_KEY binding is caught', () => {
    const line = real.split('\n').find((l) => /^ {10}SUPABASE_SERVICE_ROLE_KEY:/.test(l));
    assert.ok(line, 'no per-step SUPABASE_SERVICE_ROLE_KEY binding to remove');
    const mutated = real.replace(`${line}\n`, '');
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.ok(unboundConsumers(mutated).length >= 1, 'the removal was not seen');
  });

  test('GREEN CONTROL · no binding can fall back to the other target', () => {
    assert.deepEqual(crossContaminating(real), []);
  });

  test('MUTATION · re-binding one step to the raw hosted secret is caught', () => {
    // The proven hole, shipped as its own case. On head f045baf9 this exact edit
    // left the suite at 25/25 EXIT 0, because crossContaminating() skipped any
    // value that did not name `secrets.BOXA_` before checking anything.
    const line = real.split('\n').find((l) => /^ {10}SUPABASE_URL: .*BOXA_SUPABASE_URL/.test(l));
    assert.ok(line, 'no three-armed SUPABASE_URL binding to flatten');
    const mutated = real.replace(line, '          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}');
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    const found = crossContaminating(mutated);
    assert.ok(found.length >= 1, 'the raw hosted binding was not seen');
    assert.match(found[0], /no target axis at all/);
  });

  test('MUTATION · re-binding the service-role key to the raw hosted secret is caught', () => {
    const line = real.split('\n').find((l) => /^ {10}SUPABASE_SERVICE_ROLE_KEY: .*BOXA_SUPABASE_SERVICE_ROLE_KEY/.test(l));
    assert.ok(line, 'no three-armed SUPABASE_SERVICE_ROLE_KEY binding to flatten');
    const mutated = real.replace(line, '          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.ok(crossContaminating(mutated).length >= 1, 'the raw hosted binding was not seen');
  });

  test('GREEN CONTROL · the secrets preflight ends the job in exactly one place', () => {
    assert.deepEqual(preflightExits(real), ['            exit 1']);
  });

  test('MUTATION · a second `exit` folded back into the secrets preflight is caught', () => {
    const mutated = real.replace(
      "          if [ \"$TARGET\" = 'boxa' ]; then\n",
      "          if [ \"$TARGET\" = 'nonsense' ]; then\n            echo \"::error title=E2E cannot run::unknown target\"\n            exit 1\n          elif [ \"$TARGET\" = 'boxa' ]; then\n",
    );
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.equal(preflightExits(mutated).length, 2);
  });

  test('MUTATION · the two-armed ternary (an empty BOXA_* silently reads hosted) is caught', () => {
    const two = "${{ inputs.auth_target == 'boxa' && secrets.BOXA_SUPABASE_URL || secrets.SUPABASE_URL }}";
    const three = real.split('\n').find((l) => /^ {10}SUPABASE_URL: .*BOXA_SUPABASE_URL/.test(l));
    assert.ok(three, 'no three-armed SUPABASE_URL binding to weaken');
    const mutated = real.replace(three, `          SUPABASE_URL: ${two}`);
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.ok(crossContaminating(mutated).length >= 1, 'the weakening was not seen');
  });
});

describe('e2e.yml — an empty TURNSTILE_SITE_KEY refuses the run', () => {
  const real = readFileSync(E2E_YML, 'utf8');

  test('GREEN CONTROL · the preflight carries the fail-closed sitekey limb', () => {
    assert.deepEqual(sitekeyLimbMissing(real), []);
  });

  test('MUTATION · removing the -z test is caught', () => {
    const mutated = real.replace('if [ -z "$TURNSTILE_SITE_KEY" ]; then', 'if false; then');
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.ok(sitekeyLimbMissing(mutated).includes('no -z "$TURNSTILE_SITE_KEY" test'));
  });

  test('MUTATION · softening the limb to a message that does not end the job is caught', () => {
    const mutated = real.replace(
      /\n {12}exit 1\n {10}fi\n {10}echo "TURNSTILE_SITE_KEY is set/,
      '\n          fi\n          echo "TURNSTILE_SITE_KEY is set',
    );
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.ok(sitekeyLimbMissing(mutated).includes('the empty branch does not end the job'));
  });

  test('MUTATION · unbinding the variable from the sitekey preflight env is caught', () => {
    const mutated = real.replace(
      '        env:\n          TURNSTILE_SITE_KEY: ${{ vars.TURNSTILE_SITE_KEY }}\n        run: |\n          set -uo pipefail\n          if [ -z "$TURNSTILE_SITE_KEY" ]',
      '        run: |\n          set -uo pipefail\n          if [ -z "$TURNSTILE_SITE_KEY" ]',
    );
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.ok(sitekeyLimbMissing(mutated).includes('the preflight env does not bind TURNSTILE_SITE_KEY'));
  });

  test('MUTATION · folding the sitekey check back into the secrets preflight is caught', () => {
    // The exact regression this split exists to prevent: with the check inside
    // the secrets step, assert-green-means-ran's B1 sees an `exit` that belongs
    // to a different branch and its own mutation case passes for the wrong
    // reason. Proven separately by running that case — EXIT 0 where it expects 1.
    // Anchored on HOSTED_URL, not on TARGET: the auth_target validation step
    // binds TARGET too and comes first, so a TARGET anchor would fold the
    // sitekey into the WRONG step and the case would pass over nothing.
    const mutated = real.replace(
      '          HOSTED_URL: ${{ secrets.SUPABASE_URL }}\n',
      '          HOSTED_URL: ${{ secrets.SUPABASE_URL }}\n          TURNSTILE_SITE_KEY: ${{ vars.TURNSTILE_SITE_KEY }}\n',
    );
    assert.notEqual(mutated, real, 'the mutation did not apply — agents-05');
    assert.ok(
      sitekeyLimbMissing(mutated).includes('the sitekey check is folded back into the secrets preflight, blunting section B1'),
    );
  });

  test('the drive step still passes the sitekey through as a --dart-define', () => {
    assert.match(real, /--dart-define=TURNSTILE_SITE_KEY="\$TURNSTILE_SITE_KEY"/);
  });
});
