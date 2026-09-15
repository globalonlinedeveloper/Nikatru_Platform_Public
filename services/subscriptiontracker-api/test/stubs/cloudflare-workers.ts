// Test stub for the workerd built-in `cloudflare:workers` (see vitest.config.ts).
// The runtime base class stores the execution context and the environment on
// the instance; a subclass reads `this.env`. Nothing else is modelled.
export class WorkerEntrypoint<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
