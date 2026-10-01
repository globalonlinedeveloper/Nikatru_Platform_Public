// -----------------------------------------------------------------------------
// tech-currency.test.mjs - the reader of C-PIPELINE-ADAPTS-AND-STAYS-CURRENT
// proposes a change when a vendor retires what the tree runs on, and "I could
// not look" is never a pass.
//
// tooling/ops/check-tech-currency.mjs is findings B-9 (the locked constraint had
// no reader and no row) and B-11 (the duty matrix's deadline source had been
// fetched before its vendor page last changed, and nothing re-read it) of the
// round-2 review, 2026-09-29.
//
//   R0 GREEN CONTROL - a tree on node24 beside a changelog that retires node20
//      only as the thing migrated FROM is exit 0, and says what it read
//   B9 RED CONTROL - a changelog entry retiring node20 while a pinned action
//      uses node20 yields a proposal naming the action, and exit 1
//   N  the retirement sentence is read, not grepped: a migration TARGET is not
//      retired, a runner image and a toolchain pin are subjects too, and a
//      composite action is followed into the actions it uses
//   E  a Node major near its end of life is a proposal
//   B11 RED CONTROL - a duty source whose vendor dated its page after the row's
//      `fetched` is a proposal; an `enforced` date that passed after `fetched`
//      is a proposal; a source that answers 404 is a proposal
//   L  COULD NOT LOOK is exit 2: a dated vendor page with no date (the
//      machine-translated page), a feed that parses no item, a feed that never
//      reaches the window, an action whose metadata is gone, a schedule with no
//      row for a Node major the tree runs on, a read that outlives the plan
//   A1 the reader joins the ops-bounded-retry adoption sweep (vacuous-10)
//
// Run:  node --test tooling/ci/test/tech-currency.test.mjs
// -----------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  judge,
  judgeDuty,
  readAll,
  readText,
  retiresIn,
  runsUsing,
  parseActionRef,
  parseFeed,
  subjectsOf,
  pinnedActions,
  usesIn,
  vendorDate,
  CouldNotLook,
  CHANGELOG_FEED,
  CHANGELOG_PAGES,
  NODE_SCHEDULE,
  RAW,
  DAY_MS,
  isDutySourceHost,
} from '../../ops/check-tech-currency.mjs';
import { READ_ATTEMPTS } from '../../ops/bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPS = resolve(HERE, '..', '..', 'ops');
const NOW = Date.parse('2026-09-29T08:00:00Z');
const day = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toUTCString();
const iso = (daysFromNow) => new Date(NOW + daysFromNow * DAY_MS).toISOString().slice(0, 10);
const SHA = '0123456789abcdef0123456789abcdef01234567';
const nosleep = async () => {};

// ── fixtures ────────────────────────────────────────────────────────────────

/** One RSS page. Each entry: { title, text, daysAgo, link }. */
function feed(entries) {
  const items = entries.map(
    (e) => `<item>
		<title>${e.title}</title>
		<link>${e.link ?? `https://github.blog/changelog/${e.title.toLowerCase().replace(/\W+/g, '-')}`}</link>
		<pubDate>${day(e.daysAgo)}</pubDate>
		<description><![CDATA[<p>${(e.text ?? '').slice(0, 80)}&#8230;</p>]]></description>
		<content:encoded><![CDATA[<html><body><p>${e.text ?? ''}</p></body></html>]]></content:encoded>
	</item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>GitHub Changelog</title>${items.join('\n')}</channel></rss>`;
}
/** The real Node 20 notice of 2026-09-23, abridged to the sentences that matter. */
const NODE20_GONE = {
  title: 'Node 20 is no longer available in GitHub Actions',
  text:
    'This is the final notification that Node 20 is no longer available on GitHub Actions runners. Runners now use Node 24 for JavaScript actions. ' +
    'If you maintain a JavaScript action, update its runs.using value to node24 and publish a new release as soon as possible.',
  daysAgo: 6,
};
const OLD = { title: 'An entry older than the window', text: 'Nothing here.', daysAgo: 400 };
const actionYml = (using, steps = '') => `name: fixture\nruns:\n  using: '${using}'\n${using === 'composite' ? `  steps:\n${steps}` : '  main: dist/index.js\n'}`;
const SCHEDULE = JSON.stringify({ v20: { start: '2023-04-18', end: '2026-04-30' }, v22: { start: '2024-04-24', end: '2027-04-30' }, v24: { start: '2025-05-06', end: '2028-04-30' } });

const DUTY_URL = 'https://developer.android.com/google/play/requirements/target-sdk';
const duty = (over = {}) => ({
  id: 'play-target-api-level',
  verification: 'primary-source',
  enforced: { targetSdkAtLeast: 36, inForceFrom: '2026-08-31' },
  source: { url: DUTY_URL, fetched: '2026-09-20', quote: 'the rule' },
  ...over,
});
const androidPage = (date) => `<!doctype html><html lang="en"><body><p>the rule</p><p>Last updated ${date} UTC.</p></body></html>`;

/** A repository root: one workflow pinning `uses`, a versions.json, a duty matrix. */
function tree({ uses = [`actions/fixture@${SHA} # v1`], versions = { node: '24', runner_ubuntu: 'ubuntu-24.04' }, duties = [duty()] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tech-currency-'));
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    `name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n${uses.map((u) => `      - uses: ${u}\n`).join('')}`,
  );
  writeFileSync(join(root, 'tooling', 'versions.json'), JSON.stringify(versions));
  writeFileSync(join(root, 'tooling', 'legal', 'duty-matrix.json'), JSON.stringify({ duties }));
  return root;
}

/** A fake network: URL -> [status, body]. Anything unlisted answers 404. */
function net(routes) {
  const asked = [];
  const doFetch = async (url, init) => {
    asked.push({ url, init });
    const r = routes[url];
    if (typeof r === 'function') return r(url, init);
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r[1], { status: r[0] });
  };
  return { doFetch, asked };
}
const actionUrl = (repo, name = 'action.yml', at = SHA) => `${RAW}/${repo}/${at}/${name}`;
const baseRoutes = (using = 'node24', entries = [NODE20_GONE, OLD]) => ({
  [DUTY_URL]: [200, androidPage('2026-09-16')],
  [CHANGELOG_FEED]: [200, feed(entries)],
  [NODE_SCHEDULE]: [200, SCHEDULE],
  [actionUrl('actions/fixture')]: [200, actionYml(using)],
});
const run = async (root, routes) => {
  const { doFetch, asked } = net(routes);
  const read = await readAll({ root, now: NOW, doFetch, sleep: nosleep });
  return { ...judge({ ...read, now: NOW }), read, asked };
};
// ── R0 / B9 ─────────────────────────────────────────────────────────────────

describe('R0 green control', () => {
  test('a tree on node24 beside the Node 20 notice is exit 0, and says what it read', async () => {
    const v = await run(tree(), baseRoutes('node24'));
    assert.equal(v.code, 0, v.lines.join('\n'));
    assert.match(v.lines[0], /^ok {2}tech currency/);
    assert.match(v.lines.join('\n'), /changelog - 1 entr\(ies\) since 2026-06-01 read over 1 page\(s\)/);
    assert.match(v.lines.join('\n'), /Node 24 - end of life 2028-04-30/);
  });
});

describe('B9 - a retirement of what the tree runs on is a proposal', () => {
  test('B9 RED CONTROL - the changelog retires node20 and a pinned action runs on node20: a proposal and exit 1', async () => {
    const v = await run(tree(), baseRoutes('node20'));
    assert.equal(v.code, 1, v.lines.join('\n'));
    const text = v.lines.join('\n');
    assert.match(text, /⚑ RETIRED - Node 20: the GitHub changelog of 2026-09-23 \("Node 20 is no longer available in GitHub Actions"\)/);
    assert.match(text, /used by: actions\/fixture@0123456789ab \(v1\) runs on node20/);
    // Node 20 is also past its end of life (2026-04-30), which is the second proposal.
    assert.match(text, /⚑ END OF LIFE - Node 20 reached end of life on 2026-04-30/);
    assert.equal(v.proposals, 2);
  });
  test('B9 the proposal also names the toolchain pin when versions.json pins that Node', async () => {
    const v = await run(tree({ versions: { node: '20' } }), baseRoutes('node24'));
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /used by: tooling\/versions\.json node = 20/);
  });
  test('B9 the action metadata is read at the PINNED ref, and every request carries a signal', async () => {
    const v = await run(tree(), baseRoutes('node20'));
    assert.ok(v.asked.some((a) => a.url === actionUrl('actions/fixture')), 'the action.yml at the pinned sha was not asked for');
    assert.ok(v.asked.every((a) => a.init?.signal), 'a request went out with no per-request ceiling');
    assert.ok(v.asked.every((a) => /^en/.test(a.init?.headers?.['accept-language'] ?? '')), 'a request named no language');
  });
});

// ── N ───────────────────────────────────────────────────────────────────────

describe('N - the retirement sentence is read, not grepped', () => {
  const node = (n) => ({ id: `node${n}`, label: `Node ${n}`, re: new RegExp(`\\bnode(?:\\.js|js)?[\\s-]?${n}\\b`, 'i'), users: ['x'] });
  test('a migration TARGET is not retired: "from Node 20 to Node 24 before Node 20 is removed"', () => {
    const s = 'Migrate from Node 20 to Node 24 before Node 20 is removed from the runners.';
    assert.equal(retiresIn(s, node(20)), true);
    assert.equal(retiresIn(s, node(24)), false);
  });
  test('a sentence with no retirement phrase retires nothing', () => {
    assert.equal(retiresIn('Node 24 is incompatible with macOS 13.4 and earlier.', node(24)), false);
  });
  test('"Deprecation of Node 20 on GitHub Actions runners" retires node20', () => {
    assert.equal(retiresIn('Deprecation of Node 20 on GitHub Actions runners', node(20)), true);
  });
  test('a runner image the versions.json pins is a subject, and its retirement is a proposal', async () => {
    const routes = baseRoutes('node24', [{ title: 'The Ubuntu 24.04 runner image will be retired', text: 'The ubuntu-24.04 image is deprecated and will be removed on 2027-03-01.', daysAgo: 3 }]);
    const v = await run(tree(), routes);
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /⚑ RETIRED - the ubuntu-24\.04 runner image/);
    assert.match(v.lines.join('\n'), /used by: tooling\/versions\.json runner_ubuntu = ubuntu-24\.04/);
  });
  test('the ubuntu-latest migration notice retires nothing we pin (the real entry of 2026-09-17)', async () => {
    const routes = baseRoutes('node24', [
      {
        title: 'Ubuntu 26 generally available and latest migration',
        text: 'The ubuntu-latest label will migrate from Ubuntu 24.04 to Ubuntu 26.04. Ubuntu 26.04 includes updated, and in some cases removed, tools. If you are not ready to move, pin your workflows to ubuntu-24.04 to stay on the current image.',
        daysAgo: 12,
      },
    ]);
    const v = await run(tree(), routes);
    assert.equal(v.code, 0, v.lines.join('\n'));
  });
  test('a remote composite action is followed into the actions it uses', async () => {
    const routes = {
      ...baseRoutes('node24'),
      [actionUrl('actions/fixture')]: [200, actionYml('composite', `    - uses: inner/tool@${SHA} # v3\n`)],
      [actionUrl('inner/tool')]: [200, actionYml('node20')],
    };
    const v = await run(tree(), routes);
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /used by: inner\/tool@0123456789ab \(v3\) runs on node20/);
  });
  test('action.yaml is read when action.yml is absent', async () => {
    const routes = { ...baseRoutes('node24'), [actionUrl('actions/fixture')]: undefined, [actionUrl('actions/fixture', 'action.yaml')]: [200, actionYml('node20')] };
    const v = await run(tree(), routes);
    assert.equal(v.code, 1, v.lines.join('\n'));
  });
  test('parseActionRef skips local paths, docker images and reusable workflows', () => {
    assert.equal(parseActionRef('./.github/actions/setup-node'), null);
    assert.equal(parseActionRef('docker://alpine:3'), null);
    assert.equal(parseActionRef('owner/repo/.github/workflows/x.yml@abc'), null);
    assert.deepEqual(parseActionRef(`github/codeql-action/init@${SHA}`), { owner: 'github', repo: 'codeql-action', path: 'init', at: SHA, id: `github/codeql-action/init@${SHA}` });
  });
  test('usesIn reads the ref and its version comment', () => {
    assert.deepEqual(usesIn(`      - uses: actions/checkout@${SHA} # v7.0.1\n`), [{ ref: `actions/checkout@${SHA}`, tag: 'v7.0.1' }]);
  });
  test('runsUsing reads quoted and bare runtimes, and nothing outside `runs:`', () => {
    assert.equal(runsUsing("runs:\n  using: 'node24'\n"), 'node24');
    assert.equal(runsUsing('runs:\n  using: composite\n'), 'composite');
    assert.equal(runsUsing('inputs:\n  using:\n    description: x\n'), null);
  });
  test('the real tree pins remote actions the walk can see', () => {
    const actions = pinnedActions([{ rel: 'ci.yml', text: readFileSync(resolve(OPS, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8') }]);
    assert.ok(actions.length >= 3, `only ${actions.length} remote action(s) found in ci.yml; the walk stopped reaching it`);
    assert.ok(actions.some((a) => a.owner === 'actions' && a.repo === 'checkout'), 'actions/checkout is not among them');
  });
  test('subjectsOf names every runtime, the Node, Java and Xcode pins and each runner label', () => {
    const subjects = subjectsOf({ versions: { node: '24', java: '17', xcode: '26', runner_macos: 'macos-26', runner_windows: 'windows-2025' }, actions: [], runtimes: new Map() });
    assert.deepEqual(subjects.map((s) => s.id).sort(), ['java17', 'node24', 'runner:macos-26', 'runner:windows-2025', 'xcode26']);
    const win = subjects.find((s) => s.id === 'runner:windows-2025');
    assert.equal(win.re.test('Windows Server 2025 is deprecated'), true);
  });
});

// ── E ───────────────────────────────────────────────────────────────────────

describe('E - a Node major near its end of life is a proposal', () => {
  test('Node 22 ending in 30 days is exit 1', async () => {
    const routes = { ...baseRoutes('node24'), [NODE_SCHEDULE]: [200, JSON.stringify({ v22: { end: iso(30) }, v24: { end: '2028-04-30' } })] };
    const v = await run(tree({ versions: { node: '22' } }), routes);
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /⚑ END OF LIFE - Node 22 reaches end of life on \S+, in 30 day\(s\)/);
  });
  test('Node 24 in 2028 is a printed note, not a proposal', async () => {
    const v = await run(tree(), baseRoutes('node24'));
    assert.equal(v.code, 0, v.lines.join('\n'));
  });
});

// ── B11 ─────────────────────────────────────────────────────────────────────

describe('B11 - the duty matrix sources are re-read, and their EOL dates are read', () => {
  test('B11 RED CONTROL - a vendor page dated AFTER the row was fetched is a proposal and exit 1', async () => {
    const d = duty({ source: { url: 'https://developer.android.com/google/play/requirements/target-sdk', fetched: '2026-08-04', quote: 'q' }, enforced: {} });
    const routes = { ...baseRoutes('node24'), [d.source.url]: [200, androidPage('2026-09-16')] };
    const v = await run(tree({ duties: [d] }), routes);
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /⚑ SOURCE CHANGED - duty play-target-api-level: its vendor dated \S+ 2026-09-16, after it was read on 2026-08-04/);
  });
  test('B11 RED - a duty source on a host this reader does not pin is NOT requested: COVERAGE LOST (CodeQL #524)', async () => {
    const url = 'https://developer.android.com.evil.example/google/play/requirements/target-sdk';
    const d = duty({ source: { url, fetched: '2026-08-04', quote: 'q' }, enforced: {} });
    let asked = false;
    const routes = { ...baseRoutes('node24'), [url]: () => { asked = true; return [200, androidPage('2026-09-16')]; } };
    const v = await run(tree({ duties: [d] }), routes);
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /not on a vendor host this reader pins \(developer\.android\.com, developer\.apple\.com, learn\.microsoft\.com, support\.google\.com\) — it was not requested/);
    assert.equal(asked, false, 'the foreign host was requested');
    assert.equal(isDutySourceHost('https://developer.android.com/x'), true, 'GREEN control: a pinned host is allowed');
  });
  test('B11 control: a vendor page dated before the row was fetched is unchanged', () => {
    const v = judgeDuty(duty({ enforced: {} }), { status: 200, html: androidPage('2026-09-16') }, NOW);
    assert.deepEqual(v.proposals, []);
    assert.match(v.notes[0], /vendor date 2026-09-16 <= fetched 2026-09-20/);
  });
  test('B11 an enforced date that PASSED after the row was fetched is a proposal (the target-sdk row on 2026-09-29, before its re-read)', () => {
    const v = judgeDuty(duty({ source: { url: 'https://developer.android.com/x', fetched: '2026-08-04' } }), { status: 200, html: androidPage('2026-08-01') }, NOW);
    assert.equal(v.proposals.length, 1, v.proposals.join('\n'));
    assert.match(v.proposals[0], /DEADLINE PASSED SINCE THE SOURCE WAS READ - duty play-target-api-level: enforced\.inForceFrom 2026-08-31 has passed/);
  });
  test('B11 control: an enforced date that passed BEFORE the row was fetched is not', () => {
    const v = judgeDuty(duty(), { status: 200, html: androidPage('2026-09-16') }, NOW);
    assert.deepEqual(v.proposals, []);
  });
  test('B11 an enforced date inside the lead window is printed, not proposed', () => {
    const v = judgeDuty(duty({ enforced: { extensionAvailableTo: iso(33) } }), { status: 200, html: androidPage('2026-09-16') }, NOW);
    assert.deepEqual(v.proposals, []);
    assert.ok(v.notes.some((n) => /enforced\.extensionAvailableTo \S+ is in 33 day\(s\)/.test(n)), v.notes.join('\n'));
  });
  test('B11 a cited page that answers 404 is a proposal: the source moved', async () => {
    const d = duty({ enforced: {} });
    const v = await run(tree({ duties: [d] }), { ...baseRoutes('node24'), [DUTY_URL]: undefined });
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /⚑ SOURCE GONE - duty play-target-api-level/);
  });
  test('B11 an undated vendor is read and not compared', () => {
    const v = judgeDuty(duty({ enforced: {}, source: { url: 'https://support.google.com/x', fetched: '2026-07-29' } }), { status: 200, html: '<p>rule</p>' }, NOW);
    assert.deepEqual(v.proposals, []);
    assert.deepEqual(v.lost, []);
    assert.match(v.notes[0], /does not date its pages/);
  });
  test('B11 learn.microsoft.com is dated by its ms.date meta', () => {
    assert.deepEqual(vendorDate('https://learn.microsoft.com/en-us/x', '<meta name="ms.date" content="2026-09-14T00:00:00Z" />').date, '2026-09-14');
  });
  test('B11 the committed duty matrix gives the reader rows to read, among them the target-sdk row', () => {
    const m = JSON.parse(readFileSync(resolve(OPS, '..', 'legal', 'duty-matrix.json'), 'utf8'));
    const rows = m.duties.filter((d) => d.verification === 'primary-source' && d.source?.url && d.source?.fetched);
    assert.ok(rows.length >= 5, `only ${rows.length} primary-source row(s)`);
    assert.ok(rows.some((d) => d.id === 'play-target-api-level' && d.enforced?.inForceFrom), 'the target-sdk row, with its EOL date, is not among them');
  });
});

// ── L ───────────────────────────────────────────────────────────────────────

describe('L - could not look is exit 2, never green', () => {
  test('a dated vendor page with no date is exit 2 - the machine-translated page developer.android.com serves with no language', async () => {
    const d = duty({ enforced: {} });
    const routes = { ...baseRoutes('node24'), [d.source.url]: [200, '<!doctype html><html lang="bn-x-mtfrom-en"><p>সর্বশেষ আপডেট 2026-09-16 UTC।</p></html>'] };
    const v = await run(tree({ duties: [d] }), routes);
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /is on a host that dates its pages .* and this page carried no date/);
  });
  test('a feed that parses no item is exit 2: the grammar changed', async () => {
    const v = await run(tree(), { ...baseRoutes('node24'), [CHANGELOG_FEED]: [200, '<rss><channel></channel></rss>'] });
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /no <item> parsed/);
  });
  test('a feed that never reaches the lookback window is exit 2', async () => {
    const routes = baseRoutes('node24');
    for (let p = 1; p <= CHANGELOG_PAGES; p += 1) routes[p === 1 ? CHANGELOG_FEED : `${CHANGELOG_FEED}?paged=${p}`] = [200, feed([{ title: `recent ${p}`, text: 'x', daysAgo: 1 }])];
    const v = await run(tree(), routes);
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /had not reached 2026-06-01; the window was not covered/);
  });
  test('control: a feed that ENDS (404 on the next page) before the window is fully read, not lost', async () => {
    const routes = { ...baseRoutes('node24'), [CHANGELOG_FEED]: [200, feed([NODE20_GONE])] };
    const v = await run(tree(), routes);
    assert.equal(v.code, 0, v.lines.join('\n'));
  });
  test('an action whose action.yml and action.yaml are both gone is exit 2', async () => {
    const v = await run(tree(), { ...baseRoutes('node24'), [actionUrl('actions/fixture')]: undefined });
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /the runtime of actions\/fixture@\S+ was not read: .*neither action\.yml nor action\.yaml/);
  });
  test('a schedule with no row for a Node major the tree runs on is exit 2', async () => {
    const v = await run(tree(), { ...baseRoutes('node24'), [NODE_SCHEDULE]: [200, JSON.stringify({ v22: { end: '2027-04-30' } })] });
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /has no end date for v24/);
  });
  test('a read that outlives the bounded plan is exit 2, after exactly READ_ATTEMPTS asks', async () => {
    let n = 0;
    const routes = { ...baseRoutes('node24'), [NODE_SCHEDULE]: () => { n += 1; return new Response('busy', { status: 503 }); } };
    const v = await run(tree(), routes);
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.equal(n, READ_ATTEMPTS);
    assert.match(v.lines.join('\n'), /the Node\.js release schedule: .*503/);
  });
  test('a proposal read from what WAS read stands beside a lost read: exit 1, and both print', async () => {
    const v = await run(tree(), { ...baseRoutes('node20'), [NODE_SCHEDULE]: [500, 'x'] });
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /COULD NOT LOOK/);
  });
  test('readText: a 404 is an ANSWER, asked once', async () => {
    let n = 0;
    const r = await readText('https://x.test/a', { doFetch: async () => { n += 1; return new Response('', { status: 404 }); }, sleep: nosleep });
    assert.equal(r.status, 404);
    assert.equal(n, 1);
  });
  test('readText: a dropped wire on every attempt is CouldNotLook', async () => {
    await assert.rejects(
      readText('https://x.test/a', { doFetch: async () => { throw new TypeError('fetch failed'); }, sleep: nosleep }),
      (e) => e instanceof CouldNotLook,
    );
  });
  test('a tree that pins no remote action is exit 2: the walk read nothing', async () => {
    const v = await run(tree({ uses: ['./.github/actions/local'] }), baseRoutes('node24'));
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /no workflow under .* pins a remote action/);
  });
  test('parseFeed reads title, date and body out of CDATA', () => {
    const [it] = parseFeed(feed([NODE20_GONE]));
    assert.equal(it.title, 'Node 20 is no longer available in GitHub Actions');
    assert.equal(it.date, '2026-09-23');
    assert.match(it.text, /update its runs\.using value to node24/);
  });
});

// ── A1 ──────────────────────────────────────────────────────────────────────

describe('A1 - the reader is inside the adoption sweep (vacuous-10)', () => {
  const src = readFileSync(join(OPS, 'check-tech-currency.mjs'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  test('it imports the shared plan and CALLS it', () => {
    assert.match(src, /from '\.\/bounded-retry\.mjs'/);
    assert.match(code, /\bfetchWithBoundedRetry\s*\(/);
  });
  test('its network call is spelled doFetch( - the spelling ops-bounded-retry B8 matches', () => {
    assert.match(code, /\bdoFetch\s*\(/);
    assert.match(code, /process\.exitCode/);
  });
  test('process.exit() is not called, and no timer of its own is armed', () => {
    assert.equal(/process\.exit\(/.test(code), false);
    assert.equal(/setTimeout\(|AbortSignal\.timeout\(/.test(code), false);
  });
  test('ops-watch.yml runs it in the tech-currency job on the Monday slot', () => {
    const wf = readFileSync(resolve(OPS, '..', '..', '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    const job = wf.slice(wf.indexOf('\n  tech-currency:'), wf.indexOf('\n  alert:'));
    assert.match(job, /node tooling\/ops\/check-tech-currency\.mjs/);
    assert.match(job, /github\.event\.schedule == '45 7 \* \* 1'/);
  });
});
