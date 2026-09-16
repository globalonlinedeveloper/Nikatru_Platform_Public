// ─────────────────────────────────────────────────────────────────────────────
// glitchtip-no-ip.test.mjs — assert-glitchtip-no-ip.mjs must be able to FAIL,
// and must fail on the shapes that actually put an IP on a crash event.
//
// The guard holds one rule, from the owner ruling of 2026-09-15
// (O-CRASH-EVENT-IP-DROP): no crash or error event carries an IP address,
// truncated or not — so on every event-building surface the SDK's default-PII
// flag is off, nothing names an IP-bearing field or reads a client-IP header,
// and the free-text scrubber's IPv4/IPv6 rules exist AND are applied.
//
// 🔴 THE POSITIVE CONTROL IS NOT OPTIONAL and it comes first. Without a case
// that runs the guard against the REAL repository and demands exit 0, every
// refusal below is equally consistent with a guard that refuses everything.
//
// 🔴 AND THE PROSE CONTROL IS NOT OPTIONAL EITHER (R6). Every limb reads
// COMMENT-STRIPPED source, because services/_shared/src/error-sink.ts's header
// is a paragraph about `CF-Connecting-IP` explaining why it is never read — the
// exact sentence a text grep reports as the defect it denies. R6 plants both
// refused shapes in comments and requires exit 0. Without it the whole guard
// could regress into the grep it exists to replace and still look strict.
//
// Exit codes, each one read off the spawn result rather than after a pipe:
//   G    the real repository                                   -> 0
//   R1   `_ipv4` declared but never applied in scrubText        -> 1
//   R2   the `_ipv6` rule deleted                               -> 1
//   R3   sendDefaultPii = true in production                    -> 1
//   R4   a production file naming `ip_address`                  -> 1
//   R5   a production file reading `CF-Connecting-IP`           -> 1
//   R6   both shapes, but ONLY inside comments                  -> 0
//   R7   no sendDefaultPii assignment anywhere                  -> 2 COVERAGE LOST
//   R8   a root with no event-building surface                  -> 2 COVERAGE LOST
//   R9   pii_scrubber.dart gone                                 -> 2 COVERAGE LOST
//   R10  beforeSend never assigned                              -> 1
//   R11  beforeSend assigned, but not through scrubEvent        -> 1
//   R12  every source in the tree is a test file                -> 2 COVERAGE LOST
//   R13  an unknown flag                                        -> 2
//   R14  --live with no credential                              -> 2, never 0
//
// R14 matters more than it looks: a live leg that treated a missing token as
// "nothing to check" would print a pass it never made, which is the single
// failure this corpus keeps re-learning.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-glitchtip-no-ip.mjs');
const SCRUBBER_REL = 'packages/telemetry/lib/src/pii_scrubber.dart';
const BOOTSTRAP_REL = 'packages/telemetry/lib/src/telemetry_bootstrap.dart';
const REAL_SCRUBBER = readFileSync(join(REPO, ...SCRUBBER_REL.split('/')), 'utf8');
const REAL_BOOTSTRAP = readFileSync(join(REPO, ...BOOTSTRAP_REL.split('/')), 'utf8');

/** Run the guard. The exit code is read off the returned object on its own
 *  line — never through a pipe, which reports the LAST stage's status. */
function run(root, extra = [], env = undefined) {
  const r = spawnSync(process.execPath, [GUARD, '--root', root, ...extra], {
    encoding: 'utf8',
    env: env ?? process.env,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'glitchtip-no-ip-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const write = (root, rel, body) => {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

/**
 * A minimal tree carrying exactly the files the limbs read: the REAL scrubber
 * and the REAL bootstrap (so a fixture cannot encode a belief about them that
 * the shipping files do not hold), plus one ordinary Worker source.
 * `mutate(rel, body)` may change or, by returning null, delete any of them.
 */
function stage(name, mutate = null) {
  const root = join(TMP, name);
  const files = {
    [SCRUBBER_REL]: REAL_SCRUBBER,
    [BOOTSTRAP_REL]: REAL_BOOTSTRAP,
    'services/demo/src/sink.ts': 'export const sink = (service: string) => ({ service });\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    const next = mutate ? mutate(rel, body) : body;
    if (next === null) continue;
    write(root, rel, next);
  }
  return root;
}

describe('the real tree passes, which is what makes every refusal mean something', () => {
  test('G — the real repository: exit 0, and the counts are printed', () => {
    const r = run(REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /production source file\(s\)/);
    assert.match(r.out, /sendDefaultPii assignment\(s\), all false/);
  });

  test('G2 — the minimal fixture tree also passes, so the fixtures are valid input', () => {
    const r = run(stage('green'));
    assert.equal(r.code, 0, r.out);
  });
});

describe('the free-text net — declared AND wired', () => {
  test('R1 — _ipv4 declared but never applied inside scrubText: exit 1', () => {
    const root = stage('r1', (rel, body) =>
      rel === SCRUBBER_REL
        ? body.replace('out = out.replaceAll(_ipv4, redactedToken);', '')
        : body);
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /_ipv4` is never applied inside scrubText/);
  });

  test('R2 — the _ipv6 rule deleted outright: exit 1', () => {
    const root = stage('r2', (rel, body) =>
      rel === SCRUBBER_REL
        ? body.replace('static final RegExp _ipv6 =', 'static final RegExp _notIpv6 =')
        : body);
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `_ipv6` rule is declared/);
  });

  test('R9 — pii_scrubber.dart gone: exit 2 COVERAGE LOST, not a finding', () => {
    const root = stage('r9', (rel, body) => (rel === SCRUBBER_REL ? null : body));
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});

describe('the SDK posture', () => {
  test('R3 — sendDefaultPii = true in production: exit 1', () => {
    const root = stage('r3', (rel, body) =>
      rel === BOOTSTRAP_REL
        ? body.replace('options.sendDefaultPii = false;', 'options.sendDefaultPii = true;')
        : body);
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /sendDefaultPii = true/);
  });

  test('R7 — no sendDefaultPii assignment at all: exit 2 COVERAGE LOST', () => {
    const root = stage('r7', (rel, body) =>
      rel === BOOTSTRAP_REL
        ? body.replace('options.sendDefaultPii = false;', '')
        : body);
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /sendDefaultPii/);
  });
});

describe('IP fields and client-IP headers on an event surface', () => {
  test('R4 — a production file naming ip_address: exit 1', () => {
    const root = stage('r4');
    write(root, 'services/demo/src/leak.ts', 'export const u = { ip_address: req.ip };\n');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ip_address/);
  });

  test('R5 — a production file reading CF-Connecting-IP: exit 1', () => {
    const root = stage('r5');
    write(root, 'services/demo/src/leak.ts', "export const ip = req.headers.get('CF-Connecting-IP');\n");
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /client-IP header/);
  });

  // 🔴 THE PROSE CONTROL. Both refused shapes, in comments only. The real
  // error-sink.ts carries exactly this — a paragraph naming the header in order
  // to say it is never read — so a guard that went red here would be red on the
  // file that documents the correct posture, and a guard that is GREEN here on
  // a text grep is not reading code at all.
  test('R6 — both shapes, but only inside comments: exit 0', () => {
    const root = stage('r6');
    write(
      root,
      'services/demo/src/documented.ts',
      [
        '// NO client IP. `CF-Connecting-IP` is never read here or anywhere in this',
        '// Worker, and no ip_address field is ever attached to an event.',
        '/* x-forwarded-for and remote_addr are not read either. */',
        'export const ok = true;',
        '',
      ].join('\n'),
    );
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });

  // The same shapes in a TEST file are the negative control of the rule, not a
  // breach of it: three suites feed a spoofed CF-Connecting-IP to prove the
  // Worker ignores it. The held-out count is printed so the narrowing is visible.
  test('R6b — the same shapes in a test file: exit 0, and the hold-out is printed', () => {
    const root = stage('r6b');
    write(root, 'services/demo/test/sink.test.ts', "it('ignores it', () => req.headers.set('CF-Connecting-IP', '1.2.3.4'));\n");
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /test file\(s\) held out/);
  });
});

describe('the choke point', () => {
  test('R10 — beforeSend never assigned: exit 1', () => {
    const root = stage('r10', (rel, body) =>
      rel === BOOTSTRAP_REL
        ? body.replace('options.beforeSend = (event, hint) => scrubEvent(event);', '')
        : body);
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /nothing assigns/);
  });

  test('R11 — beforeSend assigned, but not through scrubEvent: exit 1', () => {
    const root = stage('r11', (rel, body) =>
      rel === BOOTSTRAP_REL
        ? body.replace(
            'options.beforeSend = (event, hint) => scrubEvent(event);',
            'options.beforeSend = (event, hint) => event;',
          )
        : body);
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not route through/);
  });
});

describe('the scan refuses to range over nothing', () => {
  test('R8 — a root with no event-building surface: exit 2 COVERAGE LOST', () => {
    const root = join(TMP, 'r8');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'readme.md'), '# nothing here\n');
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('R12 — every source is a test file: exit 2 COVERAGE LOST', () => {
    const root = join(TMP, 'r12');
    mkdirSync(join(root, 'services', 'demo', 'test'), { recursive: true });
    writeFileSync(join(root, 'services', 'demo', 'test', 'a.test.ts'), 'export const a = 1;\n');
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});

describe('argument and credential handling', () => {
  test('R13 — an unknown flag: exit 2, and the known flags are named', () => {
    const r = run(REPO, ['--no-such-flag']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /unknown flag/);
  });

  test('R14 — --live with no credential: exit 2, and never a reported pass', () => {
    const env = { ...process.env };
    delete env.GLITCHTIP_TOKEN;
    const r = run(REPO, ['--live'], env);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /Refusing to report a pass it did not make/);
    assert.doesNotMatch(r.out, /live check OK/);
  });
});
