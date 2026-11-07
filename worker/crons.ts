/**
 * The Cron Triggers in wrangler.jsonc ("crons"), one per deployment because the Workers free plan
 * allows five per account. Production runs hourly: the run at NIGHTLY_HOUR_UTC is the nightly reset,
 * every other run only applies the market signals that have come due. The presenter deployment runs
 * NIGHTLY_CRON only: a reset, then the due signals. These live outside worker/index.ts because workerd treats
 * every named export of the entry module as an entrypoint and refuses to boot when one is not a
 * function or a handler object.
 */
export const HOURLY_CRON = "0 * * * *";
export const NIGHTLY_CRON = "0 4 * * *";
export const NIGHTLY_HOUR_UTC = 4;
