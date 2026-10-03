// ─────────────────────────────────────────────────────────────────────────────
// conformance/objects.ts — WHAT ANY `ObjectStore` MUST DO. tooling/ports/
// objects.json names this file as its suite and `runObjectsConformance` as the
// runner. Against the memory fake it runs in every Worker's `npm test`
// (services/_shared/test/ports-objects.test.ts); against the bucket it is PENDING,
// because no Worker suite runs on workerd.
//
// The scenarios are what the nightly export relies on: a missing object is null;
// bytes round-trip exactly (the manifest's sha256 is of the stored bytes); the
// custom metadata comes back; list pages by cursor (the retention sweep walks the
// whole bucket that way); delete removes and an absent delete is not an error.
// ─────────────────────────────────────────────────────────────────────────────
import type { ObjectStore } from '../../src/ports/objects';
import { same, type Register } from './check';

export interface ObjectsFixture {
  /** The registry's adapter id. */
  adapter: string;
  /** A fresh, empty store. */
  make(): ObjectStore | Promise<ObjectStore>;
}

interface Scenario {
  name: string;
  run(store: ObjectStore): Promise<void>;
}

export const OBJECTS_SCENARIOS: readonly Scenario[] = [
  {
    name: 'missing-is-null',
    async run(store) {
      same(await store.get('absent'), null, 'get of a missing object');
      same(await store.head('absent'), null, 'head of a missing object');
    },
  },
  {
    name: 'put-get-text',
    async run(store) {
      await store.put('manifests/latest.json', '{"complete":true}', { httpMetadata: { contentType: 'application/json' } });
      const got = await store.get('manifests/latest.json');
      if (!got) throw new Error('a written object read back as null');
      same(got.key, 'manifests/latest.json', 'key');
      same(await got.text(), '{"complete":true}', 'text body');
      same(got.size, 17, 'size in bytes');
    },
  },
  {
    name: 'put-get-bytes',
    async run(store) {
      const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x7f]);
      await store.put('kv/x/2026-10-01.json.gz', bytes.buffer.slice(0));
      const got = await store.get('kv/x/2026-10-01.json.gz');
      if (!got) throw new Error('a written object read back as null');
      same([...new Uint8Array(await got.arrayBuffer())], [...bytes], 'the bytes, exactly');
    },
  },
  {
    name: 'custom-metadata-round-trips',
    async run(store) {
      await store.put('d1/a.json.gz', 'x', { customMetadata: { sha256: 'ab12', keys: '3', truncated: 'false' } });
      const info = await store.head('d1/a.json.gz');
      if (!info) throw new Error('head of a written object was null');
      same(info.customMetadata, { sha256: 'ab12', keys: '3', truncated: 'false' }, 'custom metadata');
      same(info.size, 1, 'size from head');
    },
  },
  {
    name: 'overwrite',
    async run(store) {
      await store.put('k', 'one');
      await store.put('k', 'two');
      same(await (await store.get('k'))?.text(), 'two', 'the second write');
    },
  },
  {
    name: 'delete',
    async run(store) {
      await store.put('k', 'v');
      await store.delete('k');
      same(await store.head('k'), null, 'a deleted object');
      await store.delete('never-written');
    },
  },
  {
    name: 'list-prefix-and-order',
    async run(store) {
      for (const k of ['d1/b', 'kv/a', 'd1/a', 'manifests/latest.json']) await store.put(k, k);
      const page = await store.list({ prefix: 'd1/' });
      same(page.objects.map((o) => o.key), ['d1/a', 'd1/b'], 'prefixed keys, in order');
      same(page.truncated, false, 'one page holds them all');
    },
  },
  {
    name: 'list-paginates',
    async run(store) {
      const keys = ['o1', 'o2', 'o3', 'o4', 'o5'];
      for (const k of keys) await store.put(k, k);
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await store.list({ limit: 2, cursor });
        pages++;
        seen.push(...page.objects.map((o) => o.key));
        if (!page.truncated) break;
        if (!page.cursor) throw new Error('a truncated page carried no cursor');
        cursor = page.cursor;
        if (pages > 10) throw new Error('list did not terminate');
      }
      same(seen, keys, 'every object, once, in order, across pages');
      same(pages, 3, 'five objects at two a page');
    },
  },
];

/** Register every scenario for `fixture` with `it`. */
export function runObjectsConformance(fixture: ObjectsFixture, it: Register): void {
  for (const sc of OBJECTS_SCENARIOS) {
    it(`${fixture.adapter} · objects · ${sc.name}`, async () => sc.run(await fixture.make()));
  }
}
