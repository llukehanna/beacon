/**
 * Stand-in for the `cloudflare:workers` runtime module under Vitest, which runs in Node. workerd
 * supplies the real one; this mirrors the one member the Worker uses.
 */
export class WorkerEntrypoint<Env = unknown> {
  protected readonly ctx: { waitUntil(promise: Promise<unknown>): void };
  protected readonly env: Env;
  constructor(ctx: { waitUntil(promise: Promise<unknown>): void }, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
