// Types for tooling/help/search.mjs — the help centre's ONE ranker (lane
// help-search), imported by the Worker as the same bytes the sites and the
// extensions serve. Declared here because the module is plain JavaScript.
declare module '*/tooling/help/search.mjs' {
  export function search(
    index: unknown,
    query: string,
    opts?: { scopes?: readonly string[] | null; limit?: number },
  ): Array<{ id: string; score: number }>;
}
