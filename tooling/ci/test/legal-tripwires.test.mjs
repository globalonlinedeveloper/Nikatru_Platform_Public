// ─────────────────────────────────────────────────────────────────────────────
// legal-tripwires.test.mjs — assert-legal-tripwires.mjs must be able to FAIL.
//
// [pipeline K-13]. The recorded mutation run is against a scratch COPY OF THE
// REAL REPOSITORY, 8/8 as intended.
//
// The two limbs worth reading twice:
//   · THE SOURCE-HOST ALLOWLIST. Roughly thirty dead claims entered this
//     project's corpus because a compliance-vendor blog said so, and each read
//     as authoritative. A claim that cannot be re-verified is not evidence.
//   · COULD-NOT-ESTABLISH MAY NOT CARRY A URL. The mark means nobody has read
//     the primary text; a plausible URL beside it converts an honest gap into a
//     false citation, which is strictly worse than the gap.
//
// ⚠️ A FIXTURE AGREES WITH WHATEVER MISUNDERSTANDING WROTE IT. These are the
// regression net; the mutation run against the real tree is the proof.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-legal-tripwires.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-tripwires-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const write = (root, relPath, body) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

const BASE = {
  sourceHosts: { allowed: ['indiacode.nic.in', 'support.google.com'] },
  statuses: {
    implemented: 'an artefact discharges it',
    'not-started': 'nothing built',
    'owner-gated': 'blocked on the owner; prints',
    watching: 'no duty today; the trigger is written down',
  },
  verificationKinds: {
    'primary-source': 'read from the body that wrote the rule',
    'in-tree': 'verifiable inside this repository',
    'COULD-NOT-ESTABLISH': 'nobody has read the primary text; MUST NOT carry a URL',
  },
  requirements: { 'K-1': 'first duty', 'K-2': 'second duty' },
  duties: [
    {
      id: 'built-thing',
      requirement: 'K-1',
      duty: 'a thing that is built',
      status: 'implemented',
      artefact: 'tooling/legal/duty-matrix.json',
      trigger: 'already live; the guard is the tripwire',
      verification: 'in-tree',
      reviewBy: '2099-01-01',
    },
    {
      id: 'sourced-thing',
      requirement: 'K-2',
      duty: 'a rule somebody else wrote',
      status: 'not-started',
      trigger: 'the day we submit to that store',
      verification: 'primary-source',
      source: { url: 'https://support.google.com/x', fetched: '2026-07-29', quote: 'the rule, verbatim' },
    },
    {
      id: 'unread-thing',
      requirement: 'K-2',
      duty: 'a rule nobody here has read',
      status: 'watching',
      trigger: 'the day a market row declares that country',
      verification: 'COULD-NOT-ESTABLISH',
      wouldNeed: 'the statute text on indiacode.nic.in, read directly',
    },
    {
      id: 'owner-thing',
      requirement: 'K-1',
      duty: 'a duty blocked on the owner',
      status: 'owner-gated',
      ownerItem: 'O-3',
      trigger: 'before the first paid sale',
      verification: 'in-tree',
    },
  ],
};

function fixture(mutate = (m) => m) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });
  const matrix = mutate(structuredClone(BASE)) ?? structuredClone(BASE);
  write(root, join('tooling', 'legal', 'duty-matrix.json'), JSON.stringify(matrix, null, 2));
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-legal-tripwires — the baseline fixture is valid input', () => {
  test('a complete matrix passes', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });

  test('owner-gated rows PRINT rather than failing the build', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /OWNER-GATED \(O-3\) · owner-thing/);
  });

  test('unread rules PRINT every run, so "never got round to it" cannot become "does not apply"', () => {
    const r = run(fixture());
    assert.match(out(r), /UNVERIFIED · unread-thing/);
  });
});

describe('the coverage relation, both directions', () => {
  test('a declared requirement with no row FAILS', () => {
    const r = run(fixture((m) => {
      m.duties = m.duties.filter((d) => d.requirement !== 'K-2');
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO row in tooling\/legal\/duty-matrix\.json/);
  });

  test('a row naming an undeclared requirement FAILS', () => {
    const r = run(fixture((m) => {
      m.duties[0].requirement = 'K-99';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names requirement/);
  });

  test('two rows sharing an id FAIL', () => {
    const r = run(fixture((m) => {
      m.duties.push({ ...structuredClone(m.duties[0]) });
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /share the id/);
  });
});

describe('the source-host allowlist', () => {
  test('a law-firm or compliance-vendor URL FAILS the row', () => {
    const r = run(fixture((m) => {
      m.duties[1].source.url = 'https://www.example-law-firm.com/insights/dpdp-explained';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not on the primary-source allowlist/);
  });

  test('an allowlisted host with no fetched date FAILS — a rule read at an unknown time', () => {
    const r = run(fixture((m) => {
      delete m.duties[1].source.fetched;
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /with no `fetched` date/);
  });

  test('a source that is not a URL at all FAILS', () => {
    const r = run(fixture((m) => {
      m.duties[1].source.url = 'the DPDP act, probably';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not a URL/);
  });

  test('an EMPTY allowlist is COVERAGE LOST — absent it accepts everything, empty it rejects everything', () => {
    const r = run(fixture((m) => {
      m.sourceHosts.allowed = [];
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('a matrix where NO row carries a source is COVERAGE LOST — the allowlist would range over nothing', () => {
    const r = run(fixture((m) => {
      delete m.duties[1].source;
      m.duties[1].verification = 'in-tree';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NOT ONE duty row carried a checkable source URL/);
  });
});

describe('every tripwire has a stateable trigger', () => {
  test('a row with no trigger FAILS', () => {
    const r = run(fixture((m) => {
      delete m.duties[0].trigger;
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `trigger`/);
  });

  test('a status outside the matrix\'s own dictionary FAILS', () => {
    const r = run(fixture((m) => {
      m.duties[0].status = 'probably-fine';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not in the matrix's own\s+`statuses` dictionary/);
  });

  test('a verification kind outside the dictionary FAILS', () => {
    const r = run(fixture((m) => {
      m.duties[0].verification = 'vibes';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not in the\s+matrix's own `verificationKinds`/);
  });
});

describe('COULD-NOT-ESTABLISH means what it says', () => {
  test('an unread row given a plausible URL FAILS', () => {
    const r = run(fixture((m) => {
      m.duties[2].source = { url: 'https://indiacode.nic.in/invented', fetched: '2026-08-01' };
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is marked COULD-NOT-ESTABLISH and carries a source URL/);
  });

  test('an unread row that does not say what to read FAILS', () => {
    const r = run(fixture((m) => {
      delete m.duties[2].wouldNeed;
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /does not say what would have to be read/);
  });
});

describe('"implemented" means something exists', () => {
  test('an artefact that has been deleted FAILS', () => {
    const r = run(fixture((m) => {
      m.duties[0].artefact = 'tooling/ci/assert-nothing.mjs';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /and that artefact does not exist/);
  });

  test('an `implemented` row naming no artefact FAILS', () => {
    const r = run(fixture((m) => {
      delete m.duties[0].artefact;
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /claims status `implemented` and names no `artefact`/);
  });

  test('a matrix where no row names an artefact at all is COVERAGE LOST', () => {
    const r = run(fixture((m) => {
      m.duties[0].status = 'not-started';
      delete m.duties[0].artefact;
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NOT ONE duty row named an artefact/);
  });
});

describe('a review date is a promise something has to keep', () => {
  test('a review date in the past FAILS', () => {
    const r = run(fixture((m) => {
      m.duties[0].reviewBy = '2020-01-01';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /was due for review on 2020-01-01/);
  });

  test('a malformed review date FAILS rather than being ignored', () => {
    const r = run(fixture((m) => {
      m.duties[0].reviewBy = 'sometime next year';
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not a YYYY-MM-DD date/);
  });
});

describe('owner-gated rows still owe an owner', () => {
  test('an owner-gated row naming nobody FAILS', () => {
    const r = run(fixture((m) => {
      delete m.duties[3].ownerItem;
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is owner-gated and names no `ownerItem`/);
  });
});

describe('coverage self-checks', () => {
  test('a missing matrix is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'tooling', 'legal', 'duty-matrix.json'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('an empty duties array is COVERAGE LOST — it satisfies every limb, over nothing', () => {
    const r = run(fixture((m) => {
      m.duties = [];
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no duties/);
  });

  test('an empty requirements map is COVERAGE LOST — nothing could ever be found missing', () => {
    const r = run(fixture((m) => {
      m.requirements = {};
      return m;
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no `requirements`/);
  });

  test('an unparseable matrix is COVERAGE LOST', () => {
    const root = fixture();
    writeFileSync(join(root, 'tooling', 'legal', 'duty-matrix.json'), '{ nope');
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /is not valid JSON/);
  });
});
