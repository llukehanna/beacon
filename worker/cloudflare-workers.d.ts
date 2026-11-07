/** The part of the workerd runtime module the Worker uses (no @cloudflare/workers-types here). */
declare module "cloudflare:workers" {
  export class WorkerEntrypoint<Env = unknown> {
    protected readonly ctx: { waitUntil(promise: Promise<unknown>): void };
    protected readonly env: Env;
    constructor(ctx: { waitUntil(promise: Promise<unknown>): void }, env: Env);
  }
}
