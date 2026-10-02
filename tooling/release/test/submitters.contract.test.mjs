// submitters.contract.test.mjs — every store submitter, dry, against one contract.
//
// ⏱ 2026-10-01 (port-channels, O-CHANNELS-HAVE-NO-SUBMIT-CONTRACT). The subject
// set is tooling/ports/channels.json, never a list in this file: each adapter's
// impl {file, symbol} is imported and run through submitterConformance
// (tooling/release/submit-common.mjs), against the recorded fixture in
// fixtures/submitters.json, under a fetch stub and a child_process stub. So a
// channel added to the port is tested the day it is added, and one added without
// a fixture fails here rather than passing on nothing.
//
// The second block proves the runner can FAIL (vacuous-03): one synthetic
// submitter per limb, each broken in exactly the way the limb exists to catch.
// The real-tree red controls are in the PR body: delete `plan` from a real
// submitter, or make one fetch inside `plan`, and the first block reds.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  submitterConformance,
  submitterProblems,
  storeSubmitter,
  invokedAsScript,
  listingContractOf,
  SUBMITTER_METHODS,
} from '../submit-common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const readJson = (rel) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
const PORT = readJson('tooling/ports/channels.json');
const REGISTER = readJson('tooling/channel-register.json');
const FIXTURES = JSON.parse(readFileSync(join(HERE, 'fixtures', 'submitters.json'), 'utf8')).channels;

const codeAdapters = PORT.adapters.filter((a) => a.status !== 'external');
const load = async (a) => (await import(pathToFileURL(join(REPO, a.impl.file)).href))[a.impl.symbol];

describe('every store channel has one submitter, and every submitter passes the dry-run contract', () => {
  it('the adapters are the register\'s `kind: store` rows, both ways', () => {
    const stores = REGISTER.channels.filter((c) => c.kind === 'store').map((c) => c.id).sort();
    const adapters = PORT.adapters.map((a) => a.channel).sort();
    assert.ok(stores.length >= 9, `the register carries ${stores.length} store rows; the measured set is 9`);
    assert.deepEqual(adapters, stores);
  });

  it('every code adapter has a recorded fixture, and no fixture names a channel without one', () => {
    assert.deepEqual(Object.keys(FIXTURES).sort(), codeAdapters.map((a) => a.channel).sort());
  });

  it('an external adapter is a row that publishes no submission API', () => {
    for (const a of PORT.adapters.filter((x) => x.status === 'external')) {
      const row = REGISTER.channels.find((c) => c.id === a.channel);
      assert.equal(row.submittable, false, `${a.channel} is external but its row is submittable`);
      assert.equal(typeof row.noSubmissionApi, 'string', `${a.channel} is external but its row records no noSubmissionApi`);
    }
  });

  for (const a of codeAdapters) {
    it(`${a.channel}: ${a.impl.file} ${a.impl.symbol} conforms — no network, no spawn`, async () => {
      const submitter = await load(a);
      assert.ok(submitter, `${a.impl.file} exports no ${a.impl.symbol}`);
      assert.equal(submitter.channel, a.channel);
      assert.deepEqual(await submitterConformance(submitter, FIXTURES[a.channel]), []);
    });
  }

  it('upload() refuses without { dryRun: false } — before it spawns anything', async () => {
    for (const a of codeAdapters) {
      const submitter = await load(a);
      assert.throws(() => submitter.upload(FIXTURES[a.channel].artifact, {}), /needs \{ dryRun: false \}/);
      assert.throws(() => submitter.upload(FIXTURES[a.channel].artifact, { dryRun: true }), /needs \{ dryRun: false \}/);
    }
  });
});

describe("the stores' own rules, in validate()", () => {
  const amo = codeAdapters.find((a) => a.channel === 'amo');
  const win = codeAdapters.find((a) => a.channel === 'windows-store');

  it('AMO: an unconfirmed gecko.id is refused — it is a value to CONFIRM, never to set (stores-01)', async () => {
    const s = await load(amo);
    const good = FIXTURES.amo.good;
    const f = s.validate({ ...good, geckoId: { manifest: good.geckoId.manifest } });
    assert.deepEqual(f.map((x) => x.field), ['geckoId.confirmed']);
  });

  it('AMO: a manifest gecko.id that differs from the confirmed one is refused — it would publish a different add-on', async () => {
    const s = await load(amo);
    const good = FIXTURES.amo.good;
    const f = s.validate({ ...good, geckoId: { manifest: 'fullshot2@nikatru.com', confirmed: good.geckoId.confirmed } });
    assert.deepEqual(f.map((x) => x.field), ['geckoId.manifest']);
    assert.match(f[0].message, /DIFFERENT add-on/);
  });

  it('AMO: no plan step sets the id', async () => {
    const s = await load(amo);
    const steps = s.plan(FIXTURES.amo.artifact, { dryRun: true });
    assert.ok(steps.some((x) => /CONFIRMED, never set/.test(x.does)));
    assert.ok(!steps.some((x) => /\bset\b.*gecko|gecko\.id\s*=/.test(`${x.call} ${x.does}`.replace('CONFIRMED, never set', ''))));
  });

  it('Microsoft Store: a submission edited in Partner Center is refused — the API created it, so the edit burned it (stores-07)', async () => {
    const s = await load(win);
    const f = s.validate({ ...FIXTURES['windows-store'].good, submission: { partnerCenterEdits: ['listing'] } });
    assert.deepEqual(f.map((x) => x.field), ['submission.partnerCenterEdits']);
  });

  it('a sourced store limit is enforced from the register, not from this file', async () => {
    const play = await load(codeAdapters.find((a) => a.channel === 'android-play'));
    const max = listingContractOf('android-play').maxChars['title.txt'];
    assert.ok(Number.isInteger(max));
    const f = play.validate({ ...FIXTURES['android-play'].good, fields: { ...FIXTURES['android-play'].good.fields, 'title.txt': 'x'.repeat(max + 1) } });
    assert.deepEqual(f.map((x) => x.field), ['title.txt']);
  });
});

// ── the runner can fail: one broken submitter per limb ──────────────────────
const good = FIXTURES['linux-snap'];
const honest = () =>
  storeSubmitter({
    channel: 'linux-snap',
    script: 'tooling/release/submit-snap.mjs',
    steps: (artifact) => [{ does: `upload ${artifact.path}`, surface: 'cli', call: 'snapcraft upload', writes: true }],
    uploadArgv: () => [],
  });
const mutate = (over) => ({ ...honest(), ...over });

describe('submitterConformance can fail, limb by limb (vacuous-03)', () => {
  it('green control: the honest synthetic submitter conforms', async () => {
    assert.deepEqual(await submitterConformance(honest(), good), []);
  });

  it('🔴 a submitter missing `plan` fails the shape', async () => {
    const { plan, ...noPlan } = honest();
    assert.equal(typeof plan, 'function');
    assert.deepEqual(submitterProblems(noPlan), ['has no `plan` function']);
    assert.deepEqual(await submitterConformance(noPlan, good), ['the submitter has no `plan` function']);
    for (const m of SUBMITTER_METHODS) {
      const s = { ...honest() };
      delete s[m];
      assert.match((await submitterConformance(s, good)).join('\n'), new RegExp(`has no \`${m}\` function`));
    }
  });

  it('🔴 a plan that fetches is counted, and fails', async () => {
    const r = await submitterConformance(
      mutate({
        plan: (artifact, opts) => {
          globalThis.fetch('https://dashboard.snapcraft.io/').catch(() => {});
          return honest().plan(artifact, opts);
        },
      }),
      good,
    );
    assert.match(r.join('\n'), /network call\(s\) during validate\/plan\/status/);
  });

  it('🔴 a plan that spawns is counted through an ESM `import { spawnSync }`, and fails', async () => {
    const r = await submitterConformance(
      mutate({
        plan: (artifact, opts) => {
          try {
            spawnSync('snapcraft', ['whoami']);
          } catch {
            /* the stub refuses; the count is what is graded */
          }
          return honest().plan(artifact, opts);
        },
      }),
      good,
    );
    assert.match(r.join('\n'), /[1-9]\d* process spawn\(s\)/);
    // and the stub is gone afterwards: the real binding is back
    assert.equal(spawnSync(process.execPath, ['-e', '0']).status, 0);
  });

  it('🔴 a validate that accepts anything fails, naming the first required field', async () => {
    const r = await submitterConformance(mutate({ validate: () => [] }), good);
    assert.match(r.join('\n'), /validate\(\) accepted a record with no README\.md/);
  });

  it('🔴 a validate that refuses the good record fails', async () => {
    const r = await submitterConformance(mutate({ validate: () => [{ field: 'x', message: 'no' }] }), good);
    assert.match(r.join('\n'), /refused the good fixture/);
  });

  it('🔴 a non-deterministic plan fails', async () => {
    let n = 0;
    const r = await submitterConformance(
      mutate({ plan: (a, o) => { if (o?.dryRun !== true) throw new Error('dry only'); return [{ step: 1, does: `run ${n++}`, surface: 'cli', writes: true }]; } }),
      good,
    );
    assert.match(r.join('\n'), /not deterministic/);
  });

  it('🔴 a plan that writes through both the API and the console fails (stores-07)', async () => {
    const r = await submitterConformance(
      mutate({
        plan: (a, o) => {
          if (o?.dryRun !== true) throw new Error('dry only');
          return [
            { step: 1, does: 'create the submission', surface: 'api', writes: true },
            { step: 2, does: 'edit its listing', surface: 'console', writes: true },
          ];
        },
      }),
      good,
    );
    assert.match(r.join('\n'), /writes through both the API and the console/);
  });

  it('🔴 a plan that runs without { dryRun: true } fails', async () => {
    const r = await submitterConformance(mutate({ plan: () => [{ step: 1, does: 'x', surface: 'cli', writes: true }] }), good);
    assert.match(r.join('\n'), /ran without \{ dryRun: true \}/);
  });

  it('🔴 a status for another channel fails', async () => {
    const r = await submitterConformance(mutate({ status: () => ({ channel: 'amo' }) }), good);
    assert.match(r.join('\n'), /status\(\) answered for "amo"/);
  });
});

describe('the submit scripts are importable, and their CLI is unchanged', () => {
  it('a script with no mode still refuses, exit 1, when it is the entry point', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'tooling/release/submit-play.mjs')], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /exactly one of --dry-run, --submit and --sync-listing is required/);
  });

  it('invokedAsScript: true for the file itself and through a symlink, false for another file and for no argv[1]', () => {
    const file = join(REPO, 'tooling/release/submit-snap.mjs');
    const url = pathToFileURL(file).href;
    assert.equal(invokedAsScript(url, file), true);
    assert.equal(invokedAsScript(url, join(REPO, 'tooling/release/submit-play.mjs')), false);
    assert.equal(invokedAsScript(url, undefined), false);
    const dir = mkdtempSync(join(tmpdir(), 'invoked-'));
    try {
      let linked = true;
      try {
        symlinkSync(file, join(dir, 'link.mjs'));
      } catch {
        linked = false; // a host that cannot create symlinks (Windows without the privilege)
      }
      if (linked) assert.equal(invokedAsScript(url, join(dir, 'link.mjs')), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
