// check.ts — the assertions the port conformance suites share. No `vitest` and no
// `node:` import, so a suite reads the same in every carrier that runs it.

/** How a suite registers one scenario: vitest's `it`, or anything with its shape. */
export type Register = (name: string, run: () => Promise<void>) => void;

/** Throw unless `actual` and `expected` serialise identically. */
export function same(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

/** Throw unless `promise` rejects. */
export async function rejects(promise: Promise<unknown>, what: string): Promise<void> {
  let threw = false;
  try {
    await promise;
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${what}: expected a rejection, got a value`);
}

/** The runner's refusal when an adapter lacks what a scenario needs: never a skip. */
export function missingFixture(port: string, adapter: string, scenario: string, need: string): Error {
  return new Error(`${port} conformance: adapter \`${adapter}\` has no fixture for scenario \`${scenario}\` (${need}). A missing fixture is a failure, never a skip.`);
}
