// ─────────────────────────────────────────────────────────────────────────────
// windows-store-submission.test.mjs — tooling/release/submit-windows-store.mjs
// must be able to FAIL, and --submit must fail CLOSED at every preflight.
//
// ⏱ APPENDED 2026-09-07 — the paragraphs below are left EXACTLY as written; this
// corpus appends dated corrections rather than rewriting them. --submit is now
// IMPLEMENTED against primary sources fetched 2026-09-07, which is the outcome
// the refusal case below said its own failure would mean.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". A script that exists and has stopped working satisfies the
// letter of that limb and none of its point, which is why the dry run is wired
// into ci.yml on every push as well as into the dispatch workflow — and why it
// has these tests.
//
// 🔴 THE MOST IMPORTANT CASE IN THIS FILE IS THE ONE THAT ASSERTS A REFUSAL.
// `--submit` prints `UNVERIFIED:` for every Partner Center API fact that was not
// fetched from a primary source, and exits 1 BEFORE running any check. A guessed
// endpoint does not fail on a laptop; it fails against a live store account,
// mid-submission. If somebody later implements `--submit`, this test failing is
// the correct signal — it means the refusal is gone and the UNVERIFIED list must
// have been replaced by sourced facts, not deleted.
//
// The real end-to-end proof is recorded and is not in this file: on 2026-08-01
// the dry run validated a REAL 14.8 MiB subscriptiontracker.msix produced by
// `flutter build windows --release` + `dart run msix:create`. Fixtures cannot
// prove that; only running it could.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'release', 'submit-windows-store.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-mssubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const SENTINEL = 'PARTNER-CENTER-PENDING';

// ⏱ 2026-09-11 — A PLACEHOLDER IDENTITY IS NOW A --submit REFUSAL (REVIEW-stores-2026-09-10 #3).
// Every case below that is ABOUT a later preflight (the confirm phrase, PG-6, the citation
// tally, the citation mutation) therefore builds a tree whose identity is CONFIGURED: with the
// placeholder those cases would stop at the identity refusal and assert nothing about their
// own gate. The refusal itself has its own case, and the dry run still only prints.
const CONFIGURED_IDENTITY = {
  identityName: 'NikatruFixture.SubscriptionTracker',
  publisherDisplayName: 'Nikatru Fixture',
  publisher: 'CN=00000000-0000-0000-0000-000000000000',
};
const CONFIGURED = {
  mutateRegister: (reg) => Object.assign(reg.channels[0].packageIdentity, CONFIGURED_IDENTITY),
  pubspecOver: {
    identity_name: CONFIGURED_IDENTITY.identityName,
    publisher_display_name: CONFIGURED_IDENTITY.publisherDisplayName,
    publisher: CONFIGURED_IDENTITY.publisher,
  },
};

const FILES = {
  'README.md': 'derivation map\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'screenshots/README.md': 'slot\n',
  'search-terms.txt': 'a\nb\n',
};

function tree({
  mutateRegister = null,
  fields = {},
  omitFiles = [],
  withArtifact = false,
  artifactBytes = 1024,
  pubspecOver = {},
  noMsixConfig = false,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    storeMetadataContract: {
      requiredFiles: ['README.md', 'title.txt', 'short-description.txt', 'long-description.txt', 'category.txt', 'privacy-policy-url.txt', 'support-url.txt', 'screenshots/README.md'],
      urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
      perChannel: { 'windows-store': { additionalFiles: ['search-terms.txt'], maxLines: { 'search-terms.txt': { max: 7, source: 'MS Store Policies v7.19 §10.1.3' } } } },
    },
    channels: [
      {
        id: 'windows-store',
        kind: 'store',
        served: false,
        submittable: true,
        platforms: ['windows'],
        artifactFormats: ['.msix'],
        storeMetadataDir: 'apps/{app}/store/windows-store',
        ownerQueue: 'A-2',
        packageIdentity: {
          notYetConfiguredSentinel: SENTINEL,
          identityName: SENTINEL,
          publisherDisplayName: SENTINEL,
          publisher: `CN=${SENTINEL}`,
        },
        submission: { runbook: 'Private/runbooks/store-submission-windows.md' },
      },
    ],
  };
  if (mutateRegister) mutateRegister(register);

  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('catalog/apps.json', JSON.stringify([{ slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' }]));

  const cfg = {
    display_name: 'Subly',
    publisher_display_name: SENTINEL,
    identity_name: SENTINEL,
    publisher: `CN=${SENTINEL}`,
    store: 'true',
    build_windows: 'false',
    output_path: 'build/windows/msix',
    output_name: 'subscriptiontracker',
    ...pubspecOver,
  };
  write(
    'apps/subscriptiontracker/pubspec.yaml',
    noMsixConfig ? 'name: subscriptiontracker\n' : ['name: subscriptiontracker', '', 'msix_config:', ...Object.entries(cfg).map(([k, v]) => `  ${k}: ${v}`), ''].join('\n'),
  );

  for (const [rel, body] of Object.entries(FILES)) {
    if (omitFiles.includes(rel)) continue;
    write(`apps/subscriptiontracker/store/windows-store/${rel}`, fields[rel] ?? body);
  }
  if (withArtifact) write('apps/subscriptiontracker/build/windows/msix/subscriptiontracker.msix', 'x'.repeat(artifactBytes));
  return root;
}

/** ⏱ 2026-09-12 — THE LANE IS NOW PART OF THE BASELINE, so the cases below
 *  reach the gate each of them is about. PG-1b refuses `--submit` outside GitHub
 *  Actions, and it sits right after the typed confirm phrase, so a run without
 *  GITHUB_ACTIONS stops there and never reaches PG-2, PG-3 or PG-6. A test that
 *  blanked GITHUB_REPOSITORY to reach PG-6 would now be graded by PG-1b instead
 *  and would pass for the wrong reason — which is why the default is set here,
 *  once, and the cases that are ABOUT the lane clear it explicitly. */
function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MS_STORE_TENANT_ID: '', MS_STORE_CLIENT_ID: '', MS_STORE_CLIENT_SECRET: '', MS_STORE_PRODUCT_ID: '', MS_STORE_SELLER_ID: '',
      GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'globalonlinedeveloper/Nikatru_Platform_Public',
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('submit-windows-store — the submission path is walkable, and --submit fails closed', () => {
  test('--dry-run PASSES over a complete tree and a real artifact, and sends nothing', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run', '--app', 'subscriptiontracker']);
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN OK — nothing was sent to Microsoft/);
    assert.match(out, /artifact apps\/subscriptiontracker\/build\/windows\/msix\/subscriptiontracker\.msix/);
  });

  // ── THE FOUR PREFLIGHTS OF THE REAL --submit PATH ─────────────────────────
  // 🔴 THE TEST THAT USED TO STAND HERE ASSERTED A REFUSAL, and its own header
  // said what its failure would mean: "If somebody later implements `--submit`,
  // this test failing is the correct signal — it means the refusal is gone and
  // the UNVERIFIED list must have been replaced by SOURCED FACTS, not deleted."
  // That is what happened on 2026-09-07. Six of the seven UNVERIFIED lines were
  // replaced by pages fetched that day and recorded in `PRIMARY_SOURCES`; the
  // seventh (raw-HTTP transport) survives in `UNSOURCED` with the limb it
  // refuses. The cases below are what replaces the refusal — one per preflight,
  // because a submission that fails without saying which gate stopped it sends
  // somebody to a console to find out.
  const CREDS = {
    MS_STORE_TENANT_ID: 'tenant-fixture',
    MS_STORE_CLIENT_ID: 'client-fixture',
    MS_STORE_CLIENT_SECRET: 'the-actual-secret',
    MS_STORE_PRODUCT_ID: 'product-fixture',
    MS_STORE_SELLER_ID: 'seller-fixture',
  };

  test('--submit FAILS CLOSED with no credentials, NAMING the empty secrets', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE']);
    assert.equal(code, 1, out);
    assert.match(out, /5 of 5 Microsoft Store credential\(s\) are EMPTY: MS_STORE_TENANT_ID, MS_STORE_CLIENT_ID, MS_STORE_CLIENT_SECRET, MS_STORE_PRODUCT_ID, MS_STORE_SELLER_ID/);
    assert.match(out, /green tick over a store that received nothing/);
  });

  test('--submit REFUSES a package identity that is still the Partner Center placeholder, naming it', () => {
    // Credentials present and the confirm phrase typed: the ONLY thing wrong is the identity.
    const { code, out } = run(tree({ withArtifact: true }), ['--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE'], CREDS);
    assert.equal(code, 1, out);
    assert.match(out, /PLACEHOLDER PACKAGE IDENTITY — --submit REFUSED: all 3 identity field\(s\) are still PARTNER-CENTER-PENDING/);
    assert.doesNotMatch(out, /primary sources — \d+ citation\(s\) present/, 'the placeholder walked past the problems block toward the upload');
  });

  test('--dry-run only PRINTS the placeholder — the account step is owner work, not a defect', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run', '--app', 'subscriptiontracker']);
    assert.equal(code, 0, out);
    assert.match(out, /PACKAGE IDENTITY NOT YET CONFIGURED — all 3 field\(s\) are PARTNER-CENTER-PENDING/);
    assert.doesNotMatch(out, /--submit REFUSED/);
  });

  test('--submit REFUSES without the typed confirm phrase', () => {
    const { code, out } = run(tree({ withArtifact: true, ...CONFIGURED }), ['--submit', '--app', 'subscriptiontracker'], CREDS);
    assert.equal(code, 1, out);
    assert.match(out, /--submit requires --confirm SUBMIT-TO-MICROSOFT-STORE/);
    assert.doesNotMatch(out, /the-actual-secret/);
  });

  test('--submit REFUSES on a WRONG confirm phrase — a near miss is not a confirmation', () => {
    const { code, out } = run(tree({ withArtifact: true, ...CONFIGURED }), ['--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STOR'], CREDS);
    assert.equal(code, 1, out);
    assert.match(out, /--submit requires --confirm SUBMIT-TO-MICROSOFT-STORE/);
  });

  test('--submit FAILS CLOSED with no GITHUB_TOKEN — PG-6 cannot read the approval gate', () => {
    const { code, out } = run(tree({ withArtifact: true, ...CONFIGURED }), ['--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE'], {
      ...CREDS,
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
    });
    assert.equal(code, 1, out);
    assert.match(out, /needs GITHUB_REPOSITORY and GITHUB_TOKEN to read the publish environment/);
    assert.match(out, /environments/);
  });

  test('--submit prints the sourced-citation tally before it touches anything remote', () => {
    const { out } = run(tree({ withArtifact: true, ...CONFIGURED }), ['--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE'], {
      ...CREDS,
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
    });
    assert.match(out, /primary sources — \d+ citation\(s\) present/);
  });

  // 🔴 THE MUTATION THAT PROVES THE CITATIONS ARE LOAD-BEARING. Blanking one URL
  // in PRIMARY_SOURCES must make --submit REFUSE naming it. Without this case the
  // block is a comment: a citation nothing reads is a citation nobody has to keep
  // true, which is exactly how the seven UNVERIFIED lines came to exist.
  //
  // The mutated copy is written into a FIXTURE TREE together with the flat
  // tooling/ci sources it spawns, because the script resolves
  // assert-submission-safety.mjs relative to ITSELF — `shell-16`: a guard copied
  // out of tooling/ci dies on LOAD with exit 1, which reads exactly like the
  // mutation being caught. Copying its siblings is what keeps the red honest.
  test('MUTATION: a blanked primary source makes --submit refuse, naming the key', () => {
    const root = tree({ withArtifact: true, ...CONFIGURED });
    cpSync(join(REPO, 'tooling', 'ci'), join(root, 'tooling', 'ci'), {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).includes('test'),
    });
    const mutated = join(root, 'tooling', 'release', 'submit-windows-store.mjs');
    mkdirSync(dirname(mutated), { recursive: true });
    // Its shared preamble travels with it, or the copy dies on LOAD (the same shell-16 red).
    cpSync(join(REPO, 'tooling', 'release', 'submit-common.mjs'), join(root, 'tooling', 'release', 'submit-common.mjs'));
    const source = readFileSync(SCRIPT, 'utf8');
    const before = source.match(/msstoreCli: '(https:\/\/[^']+)'/);
    assert.ok(before !== null, 'the msstoreCli citation is not where this mutation expects it');
    writeFileSync(mutated, source.replace(before[0], "msstoreCli: ''"));

    // GREEN CONTROL FIRST: the UNMUTATED copy in the same fixture tree gets past
    // the citation check and stops at PG-6, so a red below is about the citation
    // and not about the copy.
    const controlPath = join(root, 'tooling', 'release', 'control.mjs');
    writeFileSync(controlPath, source);
    const control = spawnSync(
      process.execPath,
      [controlPath, '--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE', '--repo-root', root],
      { encoding: 'utf8', env: { ...process.env, ...CREDS, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: '', GH_TOKEN: '' } },
    );
    const controlOut = `${control.stdout ?? ''}${control.stderr ?? ''}`;
    assert.match(controlOut, /primary sources — \d+ citation\(s\) present/, controlOut);

    const r = spawnSync(
      process.execPath,
      [mutated, '--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE', '--repo-root', root],
      { encoding: 'utf8', env: { ...process.env, ...CREDS, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: '', GH_TOKEN: '' } },
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /the primary source for "msstoreCli" is ""/);
    assert.doesNotMatch(out, /primary sources — \d+ citation\(s\) present/);
  });

  // ── ⏱ 2026-09-12 · PG-1b · THE LANE ───────────────────────────────────────
  // The approval [ADR 031] requires exists in exactly one place — a GitHub
  // environment on a JOB — and it is recorded in a run's history. PG-6 asks
  // whether that gate EXISTS; only this asks whether THIS process went through
  // it. submit-play.mjs:321 and submit-snap.mjs:359 have had the check since
  // their submit paths existed; this file's landed in #627 without it, so every
  // other gate was satisfiable on a laptop (five `export`s for PG-3, a personal
  // token with `repo` scope for PG-6, which answers the environments API exactly
  // as a runner's does).
  test('PG-1b --submit REFUSES outside GitHub Actions, naming the lane', () => {
    const { code, out } = run(
      tree({ withArtifact: true, ...CONFIGURED }),
      ['--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE'],
      { ...CREDS, GITHUB_ACTIONS: '', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'ghs-x' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--submit runs only inside GitHub Actions \(GITHUB_ACTIONS=true and GITHUB_REPOSITORY set\)/);
    assert.match(out, /submission from a laptop is not "the same thing without the paperwork" — it is the control/);
    assert.doesNotMatch(out, /primary sources — \d+ citation\(s\) present/, 'it must stop BEFORE the later gates, not after them');
  });

  test('PG-1b REFUSES inside Actions with no GITHUB_REPOSITORY — half a lane is not a lane', () => {
    const { code, out } = run(
      tree({ withArtifact: true, ...CONFIGURED }),
      ['--submit', '--app', 'subscriptiontracker', '--confirm', 'SUBMIT-TO-MICROSOFT-STORE'],
      { ...CREDS, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: '', GITHUB_TOKEN: 'ghs-x' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--submit runs only inside GitHub Actions/);
  });

  test('PG-1b comes AFTER the typed confirm phrase — a run with no phrase is refused for the phrase', () => {
    // Order is the message a person reads first. "You did not type the phrase"
    // is actionable; "you are not in Actions" sent to somebody who never
    // intended to submit is not.
    const { code, out } = run(
      tree({ withArtifact: true, ...CONFIGURED }),
      ['--submit', '--app', 'subscriptiontracker'],
      { ...CREDS, GITHUB_ACTIONS: '', GITHUB_REPOSITORY: '' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--submit requires --confirm SUBMIT-TO-MICROSOFT-STORE/);
    assert.doesNotMatch(out, /runs only inside GitHub Actions/);
  });

  test('the three submit lanes all carry the same lane gate — none of them is the easy way round', () => {
    // A gate two of three scripts carry is a gate with a door beside it.
    for (const rel of ['submit-play.mjs', 'submit-snap.mjs', 'submit-windows-store.mjs']) {
      const src = readFileSync(join(REPO, 'tooling', 'release', rel), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      assert.match(
        src,
        /process\.env\.GITHUB_ACTIONS \?\? ''\) !== 'true'/,
        `${rel} does not refuse --submit outside GitHub Actions, so its approval gate can be walked around`,
      );
    }
  });

  // ── ⏱ 2026-09-12 · THE HEADER MUST NOT SAY THE SCRIPT CANNOT SHIP ─────────
  // It did, for five days after #627 gave it a real submit path: "`--submit`
  // REFUSES, loudly, with `UNVERIFIED: <what>`" and "NOTHING HERE IS LIVE AND
  // NOTHING HERE CAN BE". That is the sentence a reader checks BEFORE deciding
  // how carefully to read the rest.
  test('the header describes the submit path that exists, not the refusal that was replaced', () => {
    const header = readFileSync(SCRIPT, 'utf8').split('\nimport ')[0];
    // The two retracted sentences survive only INSIDE the dated correction that
    // retracts them — this corpus appends rather than rewrites — so the check is
    // that neither is a LIVE claim any more, not that the words are gone.
    assert.match(header, /🔴 CORRECTED 2026-09-12/);
    assert.doesNotMatch(header, /^\/\/ 🔴 NOTHING HERE IS LIVE AND NOTHING HERE CAN BE/m);
    assert.doesNotMatch(header, /^\/\/ `--submit`\s+REFUSES, loudly/m);
    assert.doesNotMatch(header, /--submit --app <id>\s+\(refuses\)/);
    assert.match(header, /`--submit`\s+REALLY SUBMITS, and is gated/);
    for (const gate of ['PG-1', 'PG-1b', 'PG-2', 'PG-3', 'PG-6']) {
      assert.ok(header.includes(gate), `the header must name ${gate}, the gate a reader has to satisfy`);
    }
    // What IS still true, and must stay said: the account does not exist yet.
    // ⏱ 2026-09-22 — no longer true, and the pin moves with it. The account is
    // verified and the identity is real, so what must stay said is the DATED
    // correction naming the real identityName; the two lines this pinned before
    // survive only inside the paragraph that correction supersedes.
    assert.match(header, /⏱ CORRECTED 2026-09-22/);
    assert.match(header, /60210NIKATRU\.NikatruSubscriptionTracker/);
    assert.match(header, /Nothing has been submitted/);
  });

  test('the seven UNVERIFIED lines are gone and what survives is named in UNSOURCED', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    assert.ok(!source.includes('--submit is NOT IMPLEMENTED'), 'the refusal is back');
    assert.match(source, /const UNSOURCED = Object\.freeze\(\[/);
    assert.match(source, /const PRIMARY_SOURCES = Object\.freeze\(\{/);
    // limb 4 of assert-release-provenance.mjs reads BOTH of these out of the
    // script with comments stripped; they are asserted here too so a refactor
    // that drops one is caught by this suite as well as by that guard.
    assert.match(source.replace(/^\s*\/\/.*$/gm, ''), /\/environments\//);
    assert.match(source.replace(/^\s*\/\/.*$/gm, ''), /protection_rules/);
  });

  test('FAILS when neither --dry-run nor --submit is given', () => {
    const { code, out } = run(tree(), []);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when both --dry-run and --submit are given', () => {
    const { code, out } = run(tree(), ['--dry-run', '--submit']);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when a listing field is missing', () => {
    const { code, out } = run(tree({ withArtifact: true, omitFiles: ['title.txt'] }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /title\.txt is missing/);
  });

  test('FAILS when a listing field is emptied', () => {
    const { code, out } = run(tree({ withArtifact: true, fields: { 'category.txt': '  \n' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('FAILS on more than 7 search terms, citing the policy', () => {
    const { code, out } = run(tree({ withArtifact: true, fields: { 'search-terms.txt': 'a\nb\nc\nd\ne\nf\ng\nh\n' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /has 8 entries; the limit is 7/);
    assert.match(out, /10\.1\.3/);
  });

  test('FAILS when the .msix is absent and --allow-missing-artifact was NOT passed', () => {
    const { code, out } = run(tree(), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /subscriptiontracker\.msix does not exist/);
  });

  test('PASSES with --allow-missing-artifact, and SAYS the package was not validated', () => {
    const { code, out } = run(tree(), ['--dry-run', '--allow-missing-artifact']);
    assert.equal(code, 0, out);
    assert.match(out, /NO PACKAGED ARTIFACT/);
    assert.match(out, /the package was not/);
  });

  test('FAILS on a zero-byte .msix', () => {
    const { code, out } = run(tree({ withArtifact: true, artifactBytes: 0 }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /ZERO bytes/);
  });

  test('FAILS when the register and the pubspec disagree about the package identity', () => {
    const { code, out } = run(tree({ withArtifact: true, pubspecOver: { identity_name: 'Nikatru.Subly' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /package identity DISAGREES/);
  });

  test('FAILS when msix_config.store is not true — the Store re-signs, we hold no key', () => {
    const { code, out } = run(tree({ withArtifact: true, pubspecOver: { store: 'false' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /msix_config\.store is "false", not true/);
  });

  test('FAILS when the pubspec has no msix_config block at all', () => {
    const { code, out } = run(tree({ withArtifact: true, noMsixConfig: true }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /declares no `msix_config:` block/);
  });

  test('PRINTS the identity gap while every field is the sentinel, and still exits 0', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /PACKAGE IDENTITY NOT YET CONFIGURED/);
  });

  test('PRINTS which credentials are absent and never their values', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /CREDENTIALS NOT CONFIGURED — 5 of 5 absent/);
  });

  test('reports credentials as present without printing them', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run'], {
      MS_STORE_TENANT_ID: 'tenant-secret-value',
      MS_STORE_CLIENT_ID: 'client-secret-value',
      MS_STORE_CLIENT_SECRET: 'the-actual-secret',
      MS_STORE_PRODUCT_ID: 'product-secret-value',
      MS_STORE_SELLER_ID: 'seller-secret-value',
    });
    assert.equal(code, 0, out);
    assert.match(out, /credentials — all 5 environment variable\(s\) present/);
    assert.doesNotMatch(out, /the-actual-secret/);
  });

  test('COVERAGE LOST when storeMetadataContract.requiredFiles is emptied', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.storeMetadataContract.requiredFiles = []) }), ['--dry-run']);
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register declares no windows-store row', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.channels = []) }), ['--dry-run']);
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST — .*declares no "windows-store" channel/);
  });

  test('FAILS when the channel stops being submittable', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.channels[0].submittable = false) }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /is not marked `submittable`/);
  });

  test('FAILS when the packaging output format is not one the channel accepts', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.channels[0].artifactFormats = ['.appx']) }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /matches none of the formats channel "windows-store" accepts/);
  });
});
