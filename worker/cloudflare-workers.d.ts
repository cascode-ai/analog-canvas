// The Workers runtime's own module, as far as the Worker uses it. The
// repository does not depend on @cloudflare/workers-types.

declare module "cloudflare:workers" {
  /** The base of a named entrypoint other Workers call over a service binding. */
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected readonly ctx: unknown;
    protected readonly env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
