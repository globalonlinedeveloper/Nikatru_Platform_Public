// fakes/objects.ts — an in-memory `ObjectStore`. tooling/ports/objects.json
// adapter `memory`; passes the same conformance suite as the binding
// (services/_shared/test/conformance/objects.ts). Never selectable in live.
import type { ObjectBody, ObjectInfo, ObjectListOptions, ObjectListPage, ObjectPutOptions, ObjectStore, ObjectValue } from '../objects';

/** The fake's page size when a list asks for none (R2's own is 1000). */
// @ceiling none — a test double's default page, mirroring R2's own list page; it bounds an in-memory Map in a test, not a platform resource
export const MEMORY_OBJECTS_PAGE = 1000;

export interface MemoryObjects extends ObjectStore {
  /** Stored keys, sorted, for assertions. */
  keys(): string[];
}

async function bytesOf(value: ObjectValue): Promise<Uint8Array> {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return new Uint8Array(await new Response(value).arrayBuffer());
}

export function memoryObjects(options: { now?: () => number } = {}): MemoryObjects {
  const now = options.now ?? (() => Date.now());
  const rows = new Map<string, { bytes: Uint8Array; info: ObjectInfo }>();

  const infoOf = (key: string): ObjectInfo | null => {
    const row = rows.get(key);
    return row ? { ...row.info, customMetadata: row.info.customMetadata ? { ...row.info.customMetadata } : undefined } : null;
  };

  return {
    async put(key: string, value: ObjectValue, opts?: ObjectPutOptions): Promise<ObjectInfo> {
      const bytes = await bytesOf(value);
      const info: ObjectInfo = { key, size: bytes.byteLength, uploaded: new Date(now()) };
      if (opts?.customMetadata) info.customMetadata = { ...opts.customMetadata };
      rows.set(key, { bytes, info });
      return infoOf(key) as ObjectInfo;
    },
    async get(key: string): Promise<ObjectBody | null> {
      const row = rows.get(key);
      const info = infoOf(key);
      if (!row || !info) return null;
      const copy = row.bytes.slice();
      return {
        ...info,
        text: async () => new TextDecoder().decode(copy),
        arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
      };
    },
    async head(key: string): Promise<ObjectInfo | null> {
      return infoOf(key);
    },
    async delete(key: string): Promise<void> {
      rows.delete(key);
    },
    async list(opts: ObjectListOptions = {}): Promise<ObjectListPage> {
      const prefix = opts.prefix ?? '';
      const limit = opts.limit ?? MEMORY_OBJECTS_PAGE;
      const after = opts.cursor ?? null;
      const names = [...rows.keys()].filter((k) => k.startsWith(prefix) && (after === null || k > after)).sort();
      const page = names.slice(0, limit);
      const objects = page.map((k) => infoOf(k) as ObjectInfo);
      return names.length <= limit ? { objects, truncated: false } : { objects, truncated: true, cursor: page[page.length - 1] };
    },
    keys(): string[] {
      return [...rows.keys()].sort();
    },
  };
}
