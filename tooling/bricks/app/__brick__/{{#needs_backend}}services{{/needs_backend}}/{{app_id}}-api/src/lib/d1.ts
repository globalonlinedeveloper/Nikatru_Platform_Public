/** ISO-8601 timestamp helper. */
export function nowIso(): string {
  return new Date().toISOString();
}
