#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scan-secrets.mjs — a repo-side secret scanner that proves itself first.
//
// GitHub's push protection only matches KNOWN PROVIDER PATTERNS — a GitHub
// token, an AWS key, a Stripe key. The secrets this project actually holds are
// not that shape: the rclone crypt password is just a string, and
// `non_provider_patterns` (generic high-entropy detection) is off. So the exact
// class of credential we carry is the class push protection cannot see. And a
// service is not evidence: nothing in the repo scanned at all, so there was
// nothing to run locally and nothing to negative-test.
//
// ⚠️ THE SELF-TEST IS THE POINT, not a nicety. Before scanning the repo this
// plants a known secret in a temp directory and asserts the scanner flags it. A
// scanner that silently stopped detecting — wrong binary, broken config, a flag
// whose meaning changed between versions — would otherwise report "clean"
// forever, which is this repo's single most repeated failure mode.
//
// Scope, deliberately: scans the WORKING TREE, not full git history (CI checks
// out shallow, and history scanning is heavier separate work). Nothing private
// has ever entered this repo's history — verified 2026-07-26.
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-6.
//
// Usage:  node tooling/ci/scan-secrets.mjs [repoRoot] [--gitleaks <path>]
// Exit 0 = clean, 1 = a finding, a broken scanner, or a failed self-test.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const glIdx = args.indexOf('--gitleaks');
const gitleaks = glIdx >= 0 ? args[glIdx + 1] : 'gitleaks';
// 🔴 SAME OFF-BY-ONE AS scan-workflows.mjs, and worse here. `i !== glIdx + 1`
// alone drops args[0] whenever `--gitleaks` is absent, because indexOf returns
// -1 and -1 + 1 is 0 — the positional repoRoot's own index. The documented
// no-flag form `node scan-secrets.mjs <repoRoot>` therefore scanned
// process.cwd() instead: aimed at an empty directory it cleared the §1 COVERAGE
// LOST marker check against the repo it was standing in and printed "ok secret
// scan — no findings in the working tree" about a tree it never opened. The
// marker check exists precisely because gitleaks over the wrong directory looks
// identical to a clean repo — and the argument bug was feeding it the right
// directory by accident. Corpus triage 2026-08-01 (#28). Negative-tested with a
// stub scanner: restoring the -1 makes the no-flag form pass over the empty root.
const flagValueIdx = glIdx >= 0 ? glIdx + 1 : -1;
const positional = args.filter((a, i) => !a.startsWith('--') && i !== flagValueIdx);
const repoRoot = positional[0] ?? process.cwd();

/** A PEM header trips gitleaks' `private-key` rule. Chosen over a fake cloud key
 *  because provider rules get allowlisted and revised between releases, whereas
 *  this one is structural and stable. It is not a real key.
 *
 *  ASSEMBLED AT RUNTIME, deliberately. Written as a literal, this file itself
 *  was the only finding in the repo's first real scan — the scanner correctly
 *  flagged its own canary. The obvious fix was an allowlist entry, but every
 *  allowlist entry is a permanent hole in the net, so the better fix is to leave
 *  nothing to match: split across concatenation, the full marker never appears in
 *  any file on disk. If this splitting is ever "tidied" back into one string, the
 *  scan will flag this file again — which is the correct signal, not a bug. */
const DASHES = '-'.repeat(5);
const KEY_TAIL = `RSA ${'PRIVATE'} ${'KEY'}${DASHES}`;
const CANARY = [
  `${DASHES}BEGIN ${KEY_TAIL}`,
  'MIIEowIBAAKCAQEAxGZlNotARealKeyJustAStructuralCanaryForTheSelfTest0000',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  `${DASHES}END ${KEY_TAIL}`,
].join('\n');

/** ONE CANARY PER RULE. The PEM proves gitleaks detects SOMETHING; it says nothing
 *  about whether THIS repo's rules are loaded. "The scanner works" and "the scanner
 *  would catch our leak" are different claims and only the second one matters.
 *  Prefixes are assembled at runtime for the same reason the PEM is: written
 *  literally, this file becomes a finding in its own scan.
 *
 *  🔴 `id` IS THE RULE ID GITLEAKS MUST REPORT, and it is checked. Until 2026-08-05
 *  this loop only asserted that the scan EXITED NON-ZERO, i.e. that *something* was
 *  found — so a canary that happened to trip a neighbouring rule proved its own rule
 *  fired when it had not. The comment below claimed planting each canary alone
 *  prevented that; it does not, because one file can match two rules. The PII rules
 *  added the same day made it concrete: a GSTIN embeds a PAN as characters 3-12, so
 *  the GSTIN canary is a string the PAN rule is *nearly* able to match, and "nearly"
 *  is not a property to leave a self-test resting on. The report is now parsed and
 *  the RuleID compared. */
const U = '_';
const CANARIES = [
  { id: 'private-key', rule: 'private-key (gitleaks default)', file: 'planted.key', body: CANARY },
  {
    rule: 'nikatru-cloudflare-api-token',
    file: 'cf.env',
    body: `CLOUDFLARE_API_TOKEN=${'cfut'}${U}${'Kx7'.repeat(16)}`,
  },
  {
    rule: 'nikatru-supabase-pat',
    file: 'sb-pat.env',
    body: `SUPABASE_PAT=${'sbp'}${U}${'a9f'.repeat(14)}`,
  },
  {
    rule: 'nikatru-supabase-secret-key',
    file: 'sb-sec.env',
    body: `SUPABASE_SECRET_KEY=${'sb'}${U}${'secret'}${U}${'Vt5'.repeat(10)}`,
  },
  // ── the money rail's credentials ([pipeline 5]M-1/M-12, [ADR 004]) ────────
  // The destination secret is the highest-value credential this repo will ever
  // touch: holding it means being able to SIGN a notification, and a correctly
  // signed notification writes the shared entitlements table.
  {
    rule: 'nikatru-paddle-notification-secret',
    file: 'paddle-ntf.env',
    body: `PADDLE_NOTIFICATION_SECRET=${'pdl'}${U}${'ntfset'}${U}${'Wq2'.repeat(10)}`,
  },
  {
    rule: 'nikatru-paddle-live-api-key',
    file: 'paddle-live.env',
    body: `PADDLE_API_KEY=${'pdl'}${U}${'live'}${U}${'apikey'}${U}${'Zr8'.repeat(10)}`,
  },
  {
    rule: 'nikatru-paddle-sandbox-api-key',
    file: 'paddle-sbx.env',
    body: `PADDLE_API_KEY=${'pdl'}${U}${'sdbx'}${U}${'apikey'}${U}${'Jm4'.repeat(10)}`,
  },
  // ── Indian PII ───────────────────────────────────────────────────────────
  // These three rules exist because the proprietor's REAL PAN was committed to
  // this PUBLIC repository, in the PII scrubber's own test fixture, and every
  // existing control was consistent with it: .gitignore's exclusion of
  // `Personal/` is PATH-based and this was a string literal in ordinary source,
  // and every rule above is a CREDENTIAL rule, which has no opinion about a
  // national identity number. The class was unguarded, not the instance.
  //
  // Each body is a SHAPE, assembled at runtime, and deliberately outside the
  // real value space: all-Z letters, and an Aadhaar of repeated digits. None is
  // allowlisted in .gitleaks.toml — a canary that its own rule's allowlist
  // exempts is a canary that proves the allowlist works and the rule does not.
  {
    rule: 'nikatru-india-pan',
    file: 'pan.txt',
    body: `PAN=${'Z'.repeat(5)}${'9'.repeat(4)}Z`,
  },
  {
    // 15 chars: 2 digits, then a PAN-shaped run, then an entity/check triple.
    // The embedded PAN-shaped run is NOT separately matchable — no word
    // boundary either side of it — which is why the RuleID check below matters
    // more here than anywhere else in this list.
    rule: 'nikatru-india-gstin',
    file: 'gstin.txt',
    body: `GSTIN=${'33'}${'Z'.repeat(5)}${'9'.repeat(4)}Z${'1'}${'Z'.repeat(2)}`,
  },
  {
    // First digit must be 2-9: UIDAI never issues an Aadhaar starting 0 or 1,
    // which is exactly why the scrubber's test fixtures all start with 1 and
    // are provably outside the real space.
    rule: 'nikatru-india-aadhaar',
    file: 'aadhaar.txt',
    body: `AADHAAR=${'9'.repeat(4)}${'8'.repeat(4)}${'7'.repeat(4)}`,
  },
];

/** 🔴 THE OTHER HALF, AND THE HALF THAT WAS MISSING. Every canary above proves a
 *  rule FIRES. Nothing proved a rule STAYS QUIET, and a secret scanner that
 *  fires on ordinary source does not get fixed — it gets allowlisted until it
 *  guards nothing, or switched off.
 *
 *  That is not a hypothetical. The Indian-PII rules were first written with a
 *  plain `\b…\b` Aadhaar pattern, and measured against the real scanner it fired
 *  on FIVE classes of tracked file: every UUID test fixture (a UUID's first two
 *  groups are eight digits, a hyphen, then four more — which IS the 4-4-4 shape)
 *  and sites/nikatru/contact.html (the business's own published phone number,
 *  twelve digits behind a `+`). It would have reddened every build. The canary
 *  check failed first, so CI never reached the tree scan and never said so.
 *
 *  ⚠️ The offending literals are NOT written out in this comment, and neither are
 *  the placeholders in .gitleaks.toml's. Both files became findings in their own
 *  scan for exactly that, which is the same trap the PEM canary above documents:
 *  a rule's own documentation sits inside the rule's blast radius.
 *
 *  Each body below is a REAL LINE from a tracked file. Digits are assembled at
 *  runtime for the same reason the secrets above are: a rule loosened tomorrow
 *  should fail HERE, in a named test with a reason, rather than turn this file
 *  into a finding in its own scan. */
const D = (s) => s.replace(/\./g, '');
const NEGATIVE_CANARIES = [
  {
    why: 'a UUID contains a 4-4-4 digit run — every uuid fixture in services/platform/test/',
    file: 'uuid.ts',
    body: `const OTHER = '${D('2222.2222')}-2222-4222-8222-${D('2222.2222.2222')}';`,
  },
  {
    why: "sites/nikatru/contact.html — the business's own published phone number",
    file: 'contact.html',
    body: `<a href="tel:+${D('9194.9849.8011')}">+91 ${D('9498.4')} ${D('9801.1')}</a>`,
  },
  {
    why: 'packages/telemetry/test/pii_scrubber_test.dart — scrubber fixtures start with 1, outside the UIDAI value space',
    file: 'scrubber.dart',
    body: `scrubber.scrubText('Aadhaar: ${D('1234.5678.9012')}'); scrubber.scrubText('Aadhaar ${D('1111')}-${D('2222')}-${D('3333')} x');`,
  },
  {
    why: 'the canonical PAN documentation placeholder, allowlisted by exact value',
    file: 'pan-placeholder.txt',
    body: 'PAN ABCDE1234F submitted',
  },
];

/** TESTABILITY SEAM, and the only reason it exists: the behaviour that matters
 *  most here is "the wrapper FAILS when the scanner stops detecting", and that
 *  cannot be exercised with the real binary — a working gitleaks always detects.
 *  So a `.mjs`/`.js` value for --gitleaks is executed with node, letting the
 *  tests substitute a scanner that detects nothing. Real CI passes a real
 *  binary path and never takes this branch. */
const asJs = /\.m?js$/.test(gitleaks);
const exe = asJs ? process.execPath : gitleaks;
const lead = asJs ? [gitleaks] : [];

const CONFIG = join(repoRoot, '.gitleaks.toml');

function runGitleaks(sourceDir, extra = []) {
  return spawnSync(
    exe,
    [...lead, 'detect', '--no-git', '--redact', '--config', CONFIG, '--source', sourceDir, ...extra],
    { encoding: 'utf8', cwd: repoRoot },
  );
}

// ── 0. COVERAGE: the scan must actually reach the repository ─────────────────
// [pipeline F-10] The self-test below proves the SCANNER still detects. It says
// nothing about whether the scanner is pointed at anything. gitleaks over an
// empty or wrong directory exits 0 and prints no findings, which is byte-for-byte
// the same result as a clean repo — so a mistyped path, a checkout that did not
// happen, or a relocated working directory would report "clean" forever. These
// markers are the tree this repo actually has; their absence means the scan is
// broken, not that the tree is clean.
//
// ORDER MATTERS, and this moved AHEAD of the binary check on 2026-08-01: "you
// are not pointed at a repository" is the most basic failure there is — more
// basic than "the scanner is missing", let alone "this repository's rules are
// wrong" — and it is the only one that can be checked without any scanner at
// all. Which is also what makes the argument handling negative-testable in CI,
// where no binary is installed: the corpus-triage defect (#28) was precisely
// that `<repoRoot>` was being dropped, and no test could reach far enough into
// this file to see it.
if (!existsSync(repoRoot)) {
  console.error(`✗ repo root does not exist: ${repoRoot}`);
  process.exit(1);
}
const MARKERS = ['.github/workflows', 'tooling/ci', 'packages', 'apps'];
const absent = MARKERS.filter((m) => !existsSync(join(repoRoot, m)));
if (absent.length) {
  console.error(`✗ COVERAGE LOST — "${repoRoot}" is missing: ${absent.join(', ')}`);
  console.error('  The scan is broken, not the tree. gitleaks over the wrong directory');
  console.error('  exits 0 with no findings, which is indistinguishable from a clean repo.');
  process.exit(1);
}

// ── 1. the scanner must exist at all ─────────────────────────────────────────
const version = spawnSync(exe, [...lead, 'version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error(`✗ gitleaks not runnable at "${gitleaks}" — ${version.error?.message ?? `exit ${version.status}`}`);
  console.error('  Install it in the job, or pass --gitleaks <path>.');
  process.exit(1);
}
console.log(`gitleaks ${(version.stdout ?? '').trim()}`);

// ── 2. THE RULE SET MUST EXIST, and both runs must use the SAME one ──────────
// 🔴 THE DEFECT THIS CLOSES. `--config` used to be applied ONLY to the real scan,
// and only if the file happened to exist. The SELF-TEST ran on gitleaks' defaults.
// So the self-test could never prove the repo's own rules work — and until
// 2026-07-28 there were none, leaving Cloudflare (`cfut_`) and Supabase (`sbp_`)
// credentials — two of three vendors — completely undetectable while every check
// printed ok. runGitleaks now passes --config on EVERY invocation.
if (!existsSync(CONFIG)) {
  console.error(`✗ COVERAGE LOST — ${CONFIG} is missing. gitleaks would fall back to default rules,`);
  console.error('  which match GitHub tokens and private keys but NOT Cloudflare or Supabase.');
  console.error('  The scan would report clean while blind to two of three vendors.');
  process.exit(1);
}

// ── 3. SELF-TEST: prove the scanner detects EVERY shape we care about ────────
// One canary per rule, each planted ALONE so a pass proves that specific rule
// fired rather than another rule matching first and masking a dead one.
const RULES_IN_CONFIG = (readFileSync(CONFIG, 'utf8').match(/^\s*id\s*=/gm) ?? []).length;
const CUSTOM_CANARIES = CANARIES.length - 1; // minus the gitleaks-default PEM
if (CUSTOM_CANARIES !== RULES_IN_CONFIG) {
  console.error(
    `✗ COVERAGE LOST — ${CONFIG} declares ${RULES_IN_CONFIG} rule(s) but ${CUSTOM_CANARIES} ` +
      'canary/canaries are planted. A rule with no canary is never proven to fire.',
  );
  process.exit(1);
}
for (const c of CANARIES) {
  const expectedRuleId = c.id ?? c.rule; // every custom rule's `rule` IS its id
  const canaryDir = mkdtempSync(join(tmpdir(), 'nikatru-canary-'));
  // The report is written OUTSIDE the scanned directory. Inside it, gitleaks
  // would be writing a file full of findings into the tree it is scanning.
  const reportDir = mkdtempSync(join(tmpdir(), 'nikatru-canary-report-'));
  const reportPath = join(reportDir, 'findings.json');
  try {
    writeFileSync(join(canaryDir, c.file), `${c.body}\n`);
    const run = runGitleaks(canaryDir, ['--report-format', 'json', '--report-path', reportPath]);
    // 🔴 EXIT CODE IS NOT ENOUGH, and this is the whole reason the report is
    // parsed. A non-zero exit says SOMETHING matched. It does not say THIS rule
    // matched — and a canary that trips a neighbouring rule while its own rule
    // is dead exits non-zero and reads exactly like a healthy self-test. That is
    // this repo's most repeated failure shape wearing a green tick.
    let firedIds = [];
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8') || '[]');
      firedIds = (Array.isArray(report) ? report : []).map((f) => f.RuleID);
    } catch {
      firedIds = [];
    }
    if (run.status === 0 || !firedIds.includes(expectedRuleId)) {
      console.error(`✗ SELF-TEST FAILED — rule "${expectedRuleId}" did not fire on its own planted canary.`);
      if (run.status !== 0 && firedIds.length) {
        console.error(`  Something else did fire (${[...new Set(firedIds)].join(', ')}), which is exactly the`);
        console.error('  masking case an exit-code-only check cannot tell apart from success.');
      } else {
        console.error('  The scan found nothing at all. It would have reported this repository "clean"');
        console.error('  while blind to that shape.');
      }
      console.error('  Do not trust a passing scan until this is fixed.');
      process.exit(1);
    }
  } finally {
    rmSync(canaryDir, { recursive: true, force: true });
    rmSync(reportDir, { recursive: true, force: true });
  }
}
console.log(`ok  self-test — a planted secret is still detected (${CANARIES.length} shapes)`);

// ── 3b. THE NEGATIVE SELF-TEST: prove the rules stay QUIET on ordinary source ─
for (const n of NEGATIVE_CANARIES) {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-negcanary-'));
  const reportDir = mkdtempSync(join(tmpdir(), 'nikatru-negcanary-report-'));
  const reportPath = join(reportDir, 'findings.json');
  try {
    writeFileSync(join(dir, n.file), `${n.body}\n`);
    const run = runGitleaks(dir, ['--report-format', 'json', '--report-path', reportPath]);
    if (run.status !== 0) {
      let fired = [];
      try {
        const report = JSON.parse(readFileSync(reportPath, 'utf8') || '[]');
        fired = [...new Set((Array.isArray(report) ? report : []).map((f) => f.RuleID))];
      } catch {
        /* keep the message useful even if the report is unreadable */
      }
      console.error(`✗ FALSE POSITIVE — a rule fired on ordinary source: ${n.why}`);
      console.error(`  rule(s): ${fired.join(', ') || '(report unreadable)'}`);
      console.error('  This line is real, it is tracked, and this scan runs on every push — so the build');
      console.error('  is now red for everyone. Narrow the rule. Do NOT widen the allowlist: an allowlist');
      console.error('  entry is a permanent hole, and a scanner that cries wolf gets switched off.');
      process.exit(1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(reportDir, { recursive: true, force: true });
  }
}
console.log(`ok  negative self-test — no rule fires on ordinary source (${NEGATIVE_CANARIES.length} real tracked lines)`);

const reportDir = mkdtempSync(join(tmpdir(), 'nikatru-scan-'));
const reportPath = join(reportDir, 'findings.json');

const real = runGitleaks(repoRoot, ['--report-format', 'json', '--report-path', reportPath]);

if (real.status !== 0) {
  console.error('✗ secret scan found something:');
  // Report WHERE, never WHAT. `--redact` hides the value; without a parsed
  // report gitleaks' console output says only "leaks found: N", which is not
  // actionable — you cannot judge a false positive you cannot locate.
  try {
    const findings = JSON.parse(readFileSync(reportPath, 'utf8'));
    for (const f of findings) {
      console.error(`    ${f.File}:${f.StartLine}  rule=${f.RuleID}  ${f.Description ?? ''}`);
    }
  } catch {
    console.error(real.stdout ?? '');
    console.error(real.stderr ?? '');
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
  console.error('  If this is a false positive, allowlist it in .gitleaks.toml — but note that');
  console.error('  every allowlist entry is a hole in the net, so make it as narrow as possible.');
  process.exit(1);
}
rmSync(reportDir, { recursive: true, force: true });

console.log('ok  secret scan — no findings in the working tree');
