// ─────────────────────────────────────────────────────────────────────────────
// ports/objects.ts — THE OBJECT-STORE PORT. tooling/ports/objects.json is its
// registry; tooling/ports/README.md is the standard.
//
// ⏱ 2026-10-01 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-storage). The one writer
// is the nightly off-vendor export (services/platform/src/backup/index.ts), which
// takes an `ObjectStore`, never an `R2Bucket` (assert-ports limb 9). An R2 bucket
// satisfies this interface STRUCTURALLY; adapters/cloudflare.ts proves it at
// compile time and wraps nothing.
//
// THE EXIT IS ALREADY OPEN: R2 speaks the S3 API, so rclone reads the bucket
// today and would copy it to any S3 store tomorrow. The `s3` adapter is declared
// `draft` in the registry with that note and is deliberately not built — there
// is no second store to point it at, and an unbuilt adapter costs nothing.
//
// Like ports/kv.ts, a failed call REJECTS and a missing object is `null`: the
// backup run already turns every rejection into a red heartbeat row, and that
// policy stays at the call.
// ─────────────────────────────────────────────────────────────────────────────

/** The bytes a write may carry. */
export type ObjectValue = string | ArrayBuffer | ArrayBufferView | ReadableStream;

/** HTTP metadata a write may carry. Only the content type is used here. */
export interface ObjectHttpMetadata {
  contentType?: string;
}

export interface ObjectPutOptions {
  httpMetadata?: ObjectHttpMetadata;
  /** Small string pairs kept beside the object (the backup's sha256 and counts). */
  customMetadata?: Record<string, string>;
}

/** What `head`, `put` and `list` say about one object. */
export interface ObjectInfo {
  key: string;
  /** Bytes. */
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
}

/** An object with its body. Read the body once. */
export interface ObjectBody extends ObjectInfo {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ObjectListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

/** One page of objects; `cursor` is present while `truncated` is true. */
export interface ObjectListPage {
  objects: ObjectInfo[];
  truncated: boolean;
  cursor?: string;
}

/** The object-store port. An `R2Bucket` is one; `fakes/objects.ts` is another. */
export interface ObjectStore {
  put(key: string, value: ObjectValue, options?: ObjectPutOptions): Promise<ObjectInfo | null>;
  /** The object, or null when the key is absent. */
  get(key: string): Promise<ObjectBody | null>;
  /** The object's info without its body, or null when absent. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Deleting an absent key is not an error. */
  delete(key: string): Promise<void>;
  /** Objects in lexicographic key order, one page at a time. */
  list(options?: ObjectListOptions): Promise<ObjectListPage>;
}
