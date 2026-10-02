// ─────────────────────────────────────────────────────────────────────────────
// personal-site.test.mjs — tooling/sites/generate-personal-site.mjs and
// tooling/sites/css-cascade.mjs, over the REAL founder's homepage and over
// fixtures that reproduce what it shipped before 2026-10-02.
//
// Each red control is the audit's defect, rebuilt as the smallest input that has
// it (rajasekarselvam.com audit, 2026-10-02):
//   · §D8   the work list rendered in the browser from an EMPTY array
//   · §D5   `sameAs` naming the company site, and no ProfilePage / WebSite
//   · §2.8  the dark contact-button override above the rule it overrides, and the
//           white-on-gradient pair the "obvious" cascade fix would have shipped
//   · §2.7  the collapsed menu's links still in the tab order
// The real page is graded by the same functions, so a green here is the page.
//
// Run:  node --test tooling/ci/test/personal-site.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  PAGE, LLMS, SITEMAP, REGISTRY, CHANNELS, IDENTITY,
  workGrid, statusLine, llmsWork, personGraph, applyRegion, pageContract,
  structuredDataFindings, closedMenuFindings, jsonLdNodes, CONTRAST_PAIRS,
  PROFILE, CV_PAGE, MANIFEST, ENTITY_SURFACES, profileProblems, typedFactFindings, profileGraphFindings,
  cvPage, withoutRegions,
} from '../../sites/generate-personal-site.mjs';
import { contrastFindings, deadDeclarations, inlineCss, parseRules, winning } from '../../sites/css-cascade.mjs';
import { entityContext } from '../../entity/facts.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GEN = join(REPO, 'tooling', 'sites', 'generate-personal-site.mjs');
const read = (rel) => readFileSync(join(REPO, ...rel.split('/')), 'utf8');
const REAL = read(PAGE);
const CHANNEL_ROWS = JSON.parse(read(CHANNELS)).channels;
const CTX = entityContext(JSON.parse(read(IDENTITY)));
const OWNER = JSON.parse(read(PROFILE));
const MSME = JSON.parse(read(ENTITY_SURFACES)).facts['msme-established'].template;

const APP = { slug: 'fixture-app', name: 'Fixture App', tagline: 'A fixture tagline', status: 'live', listings: { web: 'https://example.test/app', play: null, appstore: null, mac: null, microsoft: null, linux: null } };

/** The homepage CSS as it shipped before 2026-10-02, cut to the rules the defects live in. */
const OLD_CSS = `
  :root{--ink:#0B1220;--primary:#2563EB;--teal:#0F766E;--on-accent:#FFFFFF;--bg:#F6F8FC;--card:#FFFFFF}
  @media (prefers-color-scheme: dark){
    :root{--bg:#0B1220;--card:#111C33;--primary:#6E9BFF;--teal:#17C3A2;--on-accent:#0B1220}
    .mail{background:linear-gradient(90deg,var(--primary),var(--teal))}
  }
  .skip{position:absolute;background:var(--primary);color:var(--on-accent)}
  :focus-visible{outline:2px solid var(--primary)}
  .btn-p{background:linear-gradient(90deg,var(--primary),var(--teal));color:var(--on-accent)}
  .mail{display:inline-block;background:var(--ink);color:#fff}
  .mail:hover{background:#1B2A4A}
  @media(max-width:640px){
    .nav-links{position:absolute;max-height:0;overflow:hidden;transition:max-height .28s ease}
    .nav-links.open{max-height:320px}
  }`;
const page = (css, body = '') => `<!doctype html><html lang="en"><head><style>${css}</style></head><body>${body}</body></html>`;
const NAV = '<div class="nav-links" id="navLinks"><a href="#about">About</a><a href="#work">Work</a></div>';

describe('the work list is a function of the catalogue (audit §D8)', () => {
  test('RED CONTROL: a catalogue with one live app renders EXACTLY one entry, linking OUT to its storefront page', () => {
    const html = workGrid([APP], CHANNEL_ROWS);
    assert.equal((html.match(/<li\b/g) ?? []).length, 1, html);
    assert.match(html, /href="https:\/\/nikatru\.com\/apps\/fixture-app"/);
    assert.doesNotMatch(html, /href="\/apps\//, 'a same-site /apps/ link would make the root app-facing (R12-05)');
    assert.match(html, /of \d+ channels? live/);
  });

  test('RED CONTROL: an EMPTY catalogue renders a true "first app coming" line, never a blank list', () => {
    const html = workGrid([], CHANNEL_ROWS);
    assert.doesNotMatch(html, /<ul|<li/);
    assert.match(html, /The first app is coming/);
    assert.match(statusLine([], CHANNEL_ROWS), /My first app is on its way/);
    assert.match(llmsWork([], CHANNEL_ROWS), /The first app is coming/);
  });

  test('two live apps render two entries and the hero counts them', () => {
    const two = [APP, { ...APP, slug: 'second', name: 'Second' }];
    assert.equal((workGrid(two, CHANNEL_ROWS).match(/<li\b/g) ?? []).length, 2);
    assert.match(statusLine(two, CHANNEL_ROWS), /Live now: 2 apps/);
  });

  test('the REAL page carries one entry per live app in the registry, and no client-side list', () => {
    const live = JSON.parse(read(REGISTRY)).filter((a) => a.status === 'live');
    const region = REAL.slice(REAL.indexOf('<!-- PS:work -->'), REAL.indexOf('<!-- /PS:work -->'));
    assert.equal((region.match(/<li\b/g) ?? []).length, live.length, region);
    assert.doesNotMatch(REAL, /var\s+PROJECTS|innerHTML\s*=/);
  });

  test('a page whose region sentinels are missing is REFUSED, never silently kept', () => {
    assert.throws(() => applyRegion('<p>no sentinels</p>', 'work', 'x'), /expected exactly one <!-- PS:work --> … <!-- \/PS:work --> pair, found 0/);
    assert.throws(() => applyRegion('<!-- PS:work --><!-- PS:work --><!-- /PS:work -->', 'work', 'x'), /found 2 opening/);
  });
});

describe('structured data: the person, not the company (audit §D5/§D6)', () => {
  test('RED CONTROL: a Person sameAs the company site FAILS — the old page\'s JSON-LD', () => {
    const old = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","@id":"https://rajasekarselvam.com/#person","image":"https://rajasekarselvam.com/og-image.png","worksFor":{"@id":"https://nikatru.com/#org"},"sameAs":["https://nikatru.com/"]}</script>';
    const f = structuredDataFindings(old);
    assert.ok(f.some((x) => /sameAs https:\/\/nikatru\.com\/\. sameAs asserts IDENTITY/.test(x)), f.join('\n'));
    assert.ok(f.some((x) => /no ProfilePage whose mainEntity is the Person/.test(x)));
    assert.ok(f.some((x) => /no WebSite node/.test(x)));
    assert.ok(f.some((x) => /image is the social card/.test(x)));
  });

  test('the REAL page parses: ProfilePage → Person, a WebSite, the portrait, worksFor the org, and no sameAs to nikatru.com', () => {
    const nodes = jsonLdNodes(REAL);
    const person = nodes.find((n) => n['@type'] === 'Person');
    assert.ok(person, 'no Person');
    assert.equal(nodes.find((n) => n['@type'] === 'ProfilePage')?.mainEntity?.['@id'], person['@id']);
    assert.ok(nodes.some((n) => n['@type'] === 'WebSite'));
    assert.match(person.image, /rajasekar-v4\.jpg$/);
    assert.equal(person.worksFor.name, OWNER.role.employer);
    for (const n of nodes) {
      for (const u of [].concat(n.sameAs ?? [])) {
        const host = new URL(u).hostname;
        assert.ok(host !== 'nikatru.com' && !host.endsWith('.nikatru.com'), `${n['@type']} sameAs ${u}`);
      }
    }
    assert.equal(nodes.find((n) => n['@type'] === 'Organization')?.founder?.['@id'], person['@id'], 'the company relation is founder/worksFor');
    assert.deepEqual(structuredDataFindings(REAL), []);
  });

  test('the generator REFUSES a sameAs naming the company, and renders a real profile', () => {
    assert.throws(() => personGraph(CTX, ['https://nikatru.com/'], OWNER), /sameAs asserts identity/);
    assert.throws(() => personGraph(CTX, ['https://www.nikatru.com/about'], OWNER), /sameAs asserts identity/);
    const g = personGraph(CTX, ['https://github.com/fixture-person'], OWNER);
    assert.deepEqual(g['@graph'].find((n) => n['@type'] === 'Person').sameAs, [OWNER.links.linkedin, 'https://github.com/fixture-person']);
  });

  test('the JSON-LD sits inside <!--email_off-->, like the visible address', () => {
    const at = REAL.indexOf('application/ld+json');
    assert.ok(REAL.lastIndexOf('<!--email_off-->', at) > REAL.lastIndexOf('<!--/email_off-->', at), 'the JSON-LD is not inside an email_off region');
  });
});

describe('the cascade, not one rule, decides a colour (audit §2.8)', () => {
  test('RED CONTROL: the old dark-mode .mail override, above the base rule, is reported as never applying', () => {
    const dead = deadDeclarations(parseRules(OLD_CSS));
    assert.ok(dead.some((d) => d.selector === '.mail' && d.prop === 'background' && d.scheme === 'dark' && d.lostTo === 'var(--ink)'), JSON.stringify(dead));
    assert.ok(pageContract(page(OLD_CSS, NAV)).some((f) => /`\.mail\{background\}` inside @media \(prefers-color-scheme: dark\) never applies/.test(f)));
  });

  test('RED CONTROL: the "obvious" fix — the override moved below — measures white on the gradient and FAILS 4.5:1', () => {
    const moved = OLD_CSS.replace('.mail{background:linear-gradient(90deg,var(--primary),var(--teal))}', '') +
      '\n@media (prefers-color-scheme: dark){.mail{background:linear-gradient(90deg,var(--primary),var(--teal))}}';
    const rules = parseRules(moved);
    assert.deepEqual(deadDeclarations(rules).filter((d) => d.selector === '.mail'), [], 'the override now wins');
    const { findings } = contrastFindings(rules, CONTRAST_PAIRS.filter((p) => p.label === 'contact button (.mail)'));
    assert.equal(findings.length, 1, findings.join('\n'));
    assert.match(findings[0], /contact button \(\.mail\) \(dark\): 2\.\d\d:1 \(#FFFFFF on #/);
  });

  test('RED CONTROL: light --primary as the focus ring is under 3:1 on the sticky nav over the page', () => {
    const { findings } = contrastFindings(parseRules(OLD_CSS), CONTRAST_PAIRS.filter((p) => /sticky nav/.test(p.label)));
    assert.match(findings.join('\n'), /focus ring on the sticky nav over the page \(light\): 2\.9\d:1/);
  });

  test('the REAL page: no dead scheme override, and every declared pair clears its floor in both schemes', () => {
    const rules = parseRules(inlineCss(REAL));
    assert.deepEqual(deadDeclarations(rules), []);
    const { findings, graded } = contrastFindings(rules, CONTRAST_PAIRS);
    assert.deepEqual(findings, []);
    assert.equal(graded.length, CONTRAST_PAIRS.length * 2, 'every pair graded in both schemes — none skipped');
  });

  test('`!important` beats a later normal declaration, and an unknown media feature is not applied', () => {
    const rules = parseRules('.a{color:#000!important}.a{color:#fff}@media (hover:hover){.a{color:#f00!important}}');
    assert.equal(winning(rules, '.a', 'color', { scheme: 'light', width: 1280 }).value, '#000');
  });
});

describe('the collapsed mobile menu takes no focus (audit §2.7)', () => {
  test('RED CONTROL: the old menu, clipped by max-height alone, leaves its links focusable', () => {
    const f = closedMenuFindings(page(OLD_CSS, NAV), parseRules(OLD_CSS));
    assert.ok(f.some((x) => /collapsed menu \(\.nav-links\) resolves visibility to its default, so its 2 link\(s\) stay in the tab order/.test(x)), f.join('\n'));
  });

  test('the REAL page: no focusable link inside the closed menu at 375px; visible when open and on desktop', () => {
    const rules = parseRules(inlineCss(REAL));
    assert.deepEqual(closedMenuFindings(REAL, rules), []);
    assert.equal(winning(rules, '.nav-links', 'visibility', { scheme: 'light', width: 375 }).value, 'hidden');
    assert.equal(winning(rules, '.nav-links.open', 'visibility', { scheme: 'dark', width: 375 }).value, 'visible');
    assert.equal(winning(rules, '.nav-links', 'visibility', { scheme: 'light', width: 1280 }), null);
  });

  test('an inert container passes without CSS', () => {
    assert.deepEqual(closedMenuFindings('<div class="nav-links" id="navLinks" inert><a href="#a">A</a></div>', []), []);
  });
});

describe('every personal fact renders from the profile (site-rs-wave2)', () => {
  const FIX = { ...OWNER, role: { ...OWNER.role }, experience: { ...OWNER.experience } };

  test('the REAL profile is renderable and carries no year', () => {
    assert.deepEqual(profileProblems(OWNER, CTX), []);
  });

  test('RED CONTROL: a profile carrying a start year is REFUSED — the site shows no start year or date', () => {
    const f = profileProblems({ ...FIX, experience: { label: 'Since 2019' } }, CTX);
    assert.ok(f.some((x) => /"experience\.label" carries a year/.test(x)), f.join('\n'));
    assert.ok(f.some((x) => /shown as "<N>\+ years"/.test(x)), f.join('\n'));
    assert.ok(profileProblems({ ...FIX, role: { ...FIX.role, title: '' } }, CTX).some((x) => /"role\.title" is missing/.test(x)));
    assert.ok(profileProblems({ ...FIX, name: 'Someone Else' }, CTX).some((x) => /one person, one spelling/.test(x)));
  });

  test('RED CONTROL: a fact typed into the page OUTSIDE a generated region fails the comparison', () => {
    assert.deepEqual(typedFactFindings(new Map([[PAGE, REAL]]), OWNER), [], 'green control: the real page');
    const typed = REAL.replace('<section id="work"', `<p>${OWNER.role.employer} since forever</p>\n<section id="work"`);
    const f = typedFactFindings(new Map([[PAGE, typed]]), OWNER);
    assert.equal(f.length, 1, f.join('\n'));
    assert.match(f[0], /"Cognizant" \(profile role\.employer\) is typed outside a generated region/);
    const li = typedFactFindings(new Map([[PAGE, REAL.replace('</nav>', `<a href="${OWNER.links.linkedin}">in</a></nav>`)]]), OWNER);
    assert.ok(li.some((x) => /profile links\.linkedin/.test(x)), li.join('\n'));
  });

  test('the hero, about, contact and footer are generated regions holding the profile', () => {
    for (const name of ['head', 'hero', 'about', 'contact', 'footer']) {
      const body = REAL.slice(REAL.indexOf(`<!-- PS:${name} -->`), REAL.indexOf(`<!-- /PS:${name} -->`));
      assert.ok(body.length > 20, `PS:${name} is empty`);
    }
    const region = (n) => REAL.slice(REAL.indexOf(`<!-- PS:${n} -->`), REAL.indexOf(`<!-- /PS:${n} -->`));
    assert.ok(region('hero').includes(OWNER.headline), 'the one-line description is the hero line');
    for (const v of [OWNER.role.title, OWNER.role.employer, OWNER.location.locality, OWNER.experience.label, OWNER.education.degree, OWNER.education.field]) {
      assert.ok(region('about').includes(v), `about lacks ${v}`);
    }
    assert.ok(region('contact').includes(OWNER.links.linkedin) && region('footer').includes(OWNER.links.linkedin));
    // The og:image alt describes the social card as drawn (a re-cut card is a follow-up); nothing else may say it.
    assert.doesNotMatch(withoutRegions(REAL).replace(/<meta (property|name)="(og|twitter):image:alt"[^>]*>/g, ''), /Independent software developer/i, 'the retired role survives outside the image alt');
  });

  test('RED CONTROL: the Person node carries jobTitle, worksFor, alumniOf, locality/region and sameAs from the profile', () => {
    assert.deepEqual(profileGraphFindings(REAL, OWNER), []);
    const at = REAL.indexOf('<!-- PS:jsonld -->');
    const ld = REAL.slice(at).replace(`"jobTitle": "${OWNER.role.title}"`, '"jobTitle": "Independent Software Developer"').replace(`"${OWNER.links.linkedin}"`, '"https://example.test/x"');
    const f = profileGraphFindings(REAL.slice(0, at) + ld, OWNER);
    assert.ok(f.some((x) => /jobTitle/.test(x)) && f.some((x) => /sameAs \(the LinkedIn profile\)/.test(x)), f.join('\n'));
  });

  test('the CV: one page from the same source, no template slot, served at /cv again', () => {
    const cv = cvPage(OWNER, CTX, MSME);
    assert.equal(read(CV_PAGE), cv, 'the committed cv.html is the generator output');
    assert.doesNotMatch(cv.replace(/<!--[\s\S]*?-->/g, ''), /\[[A-Z][A-Za-z]*(?:[ /&—-]+[A-Za-z]+)*\]/, 'a template slot survived');
    assert.match(cv, /<link rel="canonical" href="https:\/\/rajasekarselvam\.com\/cv">/);
    assert.match(cv, /@media print\{/);
    assert.doesNotMatch(cv.replace(/<!-- FACT:([a-z-]+) -->[\s\S]*?<!-- \/FACT:\1 -->/g, ''), /\b(19|20)\d{2}\b/, 'a year outside the company FACT region');
    assert.doesNotMatch(read('sites/rajasekarselvam/_redirects'), /^\/cv/m, '/cv still redirects home');
    assert.match(read(SITEMAP), /<loc>https:\/\/rajasekarselvam\.com\/cv<\/loc>/);
  });
});

describe('the whole contract, and the CLI', () => {
  test('the REAL page satisfies the whole contract, the shared skip-link class included', () => {
    assert.deepEqual(pageContract(REAL), []);
    assert.match(REAL, /<a class="skip-link" href="#main">/);
  });

  let TMP;
  before(() => {
    TMP = mkdtempSync(join(tmpdir(), 'nikatru-personal-site-'));
    for (const rel of [PAGE, LLMS, SITEMAP, REGISTRY, CHANNELS, IDENTITY, PROFILE, CV_PAGE, MANIFEST, ENTITY_SURFACES]) {
      mkdirSync(join(TMP, dirname(rel)), { recursive: true });
      cpSync(join(REPO, rel), join(TMP, rel));
    }
  });
  after(() => TMP && rmSync(TMP, { recursive: true, force: true }));
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [GEN, TMP, ...args], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  test('--check over the committed bytes is green; a catalogue change makes it STALE and writes nothing; write mode makes it green', () => {
    assert.equal(cli('--check').code, 0, 'green control first');
    const reg = JSON.parse(readFileSync(join(TMP, REGISTRY), 'utf8'));
    reg.push({ ...APP });
    writeFileSync(join(TMP, REGISTRY), JSON.stringify(reg));
    const before = readFileSync(join(TMP, PAGE), 'utf8');
    const stale = cli('--check');
    assert.equal(stale.code, 1, stale.out);
    assert.match(stale.out, /STALE sites\/rajasekarselvam\/index\.html/);
    assert.equal(readFileSync(join(TMP, PAGE), 'utf8'), before, '--check wrote a byte');
    assert.equal(cli().code, 0);
    assert.equal(cli('--check').code, 0);
    assert.ok(readFileSync(join(TMP, PAGE), 'utf8').includes('href="https://nikatru.com/apps/fixture-app"'), 'the new app is not linked out');
    assert.match(readFileSync(join(TMP, LLMS), 'utf8'), /Fixture App \(https:\/\/nikatru\.com\/apps\/fixture-app\)/);
  });

  test('RED CONTROL (CLI): a profile change makes the page and the CV STALE; a typed fact fails --check', () => {
    assert.equal(cli('--check').code, 0, 'green control first');
    const prof = JSON.parse(readFileSync(join(TMP, PROFILE), 'utf8'));
    prof.role.title = 'Fixture Title';
    writeFileSync(join(TMP, PROFILE), JSON.stringify(prof));
    const stale = cli('--check');
    assert.equal(stale.code, 1, stale.out);
    assert.match(stale.out, /STALE sites\/rajasekarselvam\/index\.html/);
    assert.match(stale.out, /STALE sites\/rajasekarselvam\/cv\.html/);
    assert.equal(cli().code, 0);
    assert.match(readFileSync(join(TMP, CV_PAGE), 'utf8'), /Fixture Title/);
    const pageText = readFileSync(join(TMP, PAGE), 'utf8');
    writeFileSync(join(TMP, PAGE), pageText.replace('</main>', '<p>Fixture Title</p>\n</main>'));
    const typed = cli('--check');
    assert.equal(typed.code, 1, typed.out);
    assert.match(typed.out, /CONTRACT sites\/rajasekarselvam\/index\.html: "Fixture Title" \(profile role\.title\) is typed outside a generated region/);
    writeFileSync(join(TMP, PAGE), pageText);
  });

  test('a missing input is COVERAGE LOST, exit 2', () => {
    rmSync(join(TMP, CHANNELS));
    const r = cli('--check');
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/channel-register\.json could not be read/);
  });
});
