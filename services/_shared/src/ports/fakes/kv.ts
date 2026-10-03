// fakes/kv.ts — an in-memory `KvStore`: a Map with TTL. tooling/ports/kv.json
// adapter `memory`; passes the same conformance suite as the binding
// (services/_shared/test/conformance/kv.ts). Never selectable in live.
import type { KvListOptions, KvListPage, KvPutOptions, KvStore } from '../kv';

/** The fake's page size when a list asks for none (KV's own is 1000). */
// @ceiling none — a test double's default page, mirroring KV's own list page; it bounds an in-memory Map in a test, not a platform resource
export const MEMORY_KV_PAGE = 1000;

export interface MemoryKvOptions {
  /** Milliseconds since the epoch; injectable so a test can expire a key. */
  now?: () => number;
}

export interface MemoryKv extends KvStore {
  /** Live (unexpired) keys, for assertions. */
  readonly size: number;
}

export function memoryKv(options: MemoryKvOptions = {}): MemoryKv {
  const now = options.now ?? (() => Date.now());
  const rows = new Map<string, { value: string; expiresAt: number | null }>();

  const live = (key: string): string | null => {
    const row = rows.get(key);
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt <= now()) {
      rows.delete(key);
      return null;
    }
    return row.value;
  };

  function get(key: string, type?: 'text'): Promise<string | null>;
  function get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  async function get(key: string, type: 'text' | 'json' = 'text'): Promise<unknown> {
    const value = live(key);
    if (value === null) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  return {
    get,
    async put(key: string, value: string, opts?: KvPutOptions): Promise<void> {
      const ttl = opts?.expirationTtl;
      if (ttl !== undefined && !(Number.isFinite(ttl) && ttl > 0)) throw new TypeError(`memoryKv: expirationTtl must be a positive number of seconds, got ${ttl}`);
      rows.set(key, { value: String(value), expiresAt: ttl === undefined ? null : now() + ttl * 1000 });
    },
    async delete(key: string): Promise<void> {
      rows.delete(key);
    },
    async list(opts: KvListOptions = {}): Promise<KvListPage> {
      const prefix = opts.prefix ?? '';
      const limit = opts.limit ?? MEMORY_KV_PAGE;
      const names = [...rows.keys()].filter((k) => k.startsWith(prefix) && live(k) !== null).sort();
      // The cursor is the last key served: stable across writes, opaque to the caller.
      const after = opts.cursor ?? null;
      const rest = after === null ? names : names.filter((k) => k > after);
      const page = rest.slice(0, limit);
      const complete = rest.length <= limit;
      const keys = page.map((name) => {
        const exp = rows.get(name)?.expiresAt;
        return exp === null || exp === undefined ? { name } : { name, expiration: Math.floor(exp / 1000) };
      });
      return complete ? { keys, list_complete: true } : { keys, list_complete: false, cursor: page[page.length - 1] };
    },
    get size(): number {
      return [...rows.keys()].filter((k) => live(k) !== null).length;
    },
  };
}
