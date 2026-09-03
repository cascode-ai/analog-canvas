/**
 * Stand-in for the `cloudflare:workers` runtime module under Vitest.
 *
 * `@cloudflare/containers` extends `DurableObject` from that module, which
 * exists only inside the Workers runtime. The Worker's entry module exports
 * the container class (a bound Durable Object class has to be exported from
 * the entry), so any test that imports the entry pulls the runtime module in.
 * Nothing in these tests constructs a container; the classes only need to be
 * defined. Wired up as a Vitest alias in vitest.config.ts.
 */
export class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}

export class WorkerEntrypoint<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}
