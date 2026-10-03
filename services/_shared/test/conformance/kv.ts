// ─────────────────────────────────────────────────────────────────────────────
// conformance/kv.ts — WHAT ANY `KvStore` MUST DO. tooling/ports/kv.json names
// this file as its suite and `runKvConformance` as the runner; each adapter's
// conformance test CALLS the runner (assert-ports limb 6). Against the memory
// fake it runs in every Worker's `npm test` (services/_shared/test/ports-kv.test.ts);
// against the binding it is PENDING in the registry, because no Worker suite runs
// on workerd.
//
// The scenarios are what this portfolio relies on: a missing key is null, not a
// throw (sessionRevoked and the JWKS cache read a miss as "nothing there"); a
// JSON read of a JSON value round-trips; a TTL expires (every revocation record
// and the JWKS copy carry one); list pages by cursor and honours a prefix (the
// nightly export walks every key that way).
// ─────────────────────────────────────────────────────────────────────────────
import type { KvStore } from '../../src/ports/kv';
import { missingFixture, rejects, same, type Register } from './check';

/** A fresh, empty store, and — where the adapter can — a way to move its clock. */
export interface KvSubject {
  store: KvStore;
  /** Advance the store's clock by `ms`. Without it the TTL scenario FAILS. */
  advance?: (ms: number) => void;
}

export interface KvFixture {
  /** The registry's adapter id. */
  adapter: string;
  make(): KvSubject | Promise<KvSubject>;
}

interface Scenario {
  name: string;
  run(s: KvSubject, adapter: string): Promise<void>;
}

export const KV_SCENARIOS: readonly Scenario[] = [
  {
    name: 'missing-is-null',
    async run({ store }) {
      same(await store.get('absent'), null, 'text read of a missing key');
      same(await store.get('absent', 'json'), null, 'json read of a missing key');
    },
  },
  {
    name: 'put-get-text',
    async run({ store }) {
      await store.put('k', 'v1');
      same(await store.get('k'), 'v1', 'default (text) read');
      same(await store.get('k', 'text'), 'v1', 'explicit text read');
    },
  },
  {
    name: 'put-get-json',
    async run({ store }) {
      const record = { before: 1700000000, sessions: ['a', 'b'] };
      await store.put('rev:u', JSON.stringify(record));
      same(await store.get('rev:u', 'json'), record, 'json read');
    },
  },
  {
    name: 'json-read-of-non-json-rejects',
    async run({ store }) {
      await store.put('bad', 'not json {');
      await rejects(store.get('bad', 'json'), 'json read of a non-JSON value');
    },
  },
  {
    name: 'overwrite',
    async run({ store }) {
      await store.put('k', 'one');
      await store.put('k', 'two');
      same(await store.get('k'), 'two', 'the second write');
    },
  },
  {
    name: 'delete',
    async run({ store }) {
      await store.put('k', 'v');
      await store.delete('k');
      same(await store.get('k'), null, 'a deleted key');
      await store.delete('never-written');
      same(await store.get('never-written'), null, 'deleting an absent key is not an error');
    },
  },
  {
    name: 'ttl-expires',
    async run({ store, advance }, adapter) {
      if (!advance) throw missingFixture('kv', adapter, 'ttl-expires', 'advance');
      await store.put('jwks', '{"keys":[]}', { expirationTtl: 60 });
      await store.put('forever', 'x');
      advance(59_000);
      same(await store.get('jwks'), '{"keys":[]}', 'a key inside its TTL');
      advance(2_000);
      same(await store.get('jwks'), null, 'a key past its TTL');
      same(await store.get('forever'), 'x', 'a key written without a TTL');
      same((await store.list()).keys.map((k) => k.name), ['forever'], 'an expired key is not listed');
    },
  },
  {
    name: 'list-prefix-and-order',
    async run({ store }) {
      for (const k of ['p:c', 'p:a', 'q:z', 'p:b']) await store.put(k, k);
      const page = await store.list({ prefix: 'p:' });
      same(page.keys.map((k) => k.name), ['p:a', 'p:b', 'p:c'], 'prefixed keys, in order');
      same(page.list_complete, true, 'one page holds them all');
    },
  },
  {
    name: 'list-paginates',
    async run({ store }) {
      const names = ['k1', 'k2', 'k3', 'k4', 'k5'];
      for (const k of names) await store.put(k, k);
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await store.list({ limit: 2, cursor });
        pages++;
        seen.push(...page.keys.map((k) => k.name));
        if (page.list_complete) break;
        if (!page.cursor) throw new Error('an incomplete page carried no cursor');
        cursor = page.cursor;
        if (pages > 10) throw new Error('list did not terminate');
      }
      same(seen, names, 'every key, once, in order, across pages');
      same(pages, 3, 'five keys at two a page');
    },
  },
];

/** Register every scenario for `fixture` with `it`. A scenario the fixture cannot serve FAILS. */
export function runKvConformance(fixture: KvFixture, it: Register): void {
  for (const sc of KV_SCENARIOS) {
    it(`${fixture.adapter} · kv · ${sc.name}`, async () => sc.run(await fixture.make(), fixture.adapter));
  }
}
