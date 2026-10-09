// Node has no `cloudflare:workers`, the Workers runtime's own module, so
// vitest.config.ts resolves it here for tests that load the Worker's entry in
// Node (its Durable Objects, its routes). Nothing here stands in for the
// runtime's behaviour: a named entrypoint is called over a real service
// binding in workerd (render-and-grade.test.ts).

export class WorkerEntrypoint<Env = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
