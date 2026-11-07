/**
 * The two Cron Triggers in wrangler.jsonc ("crons"). They live outside worker/index.ts because
 * workerd treats every named export of the entry module as an entrypoint and refuses to boot when
 * one is not a function or a handler object.
 */
export const NIGHTLY_CRON = "0 4 * * *";
export const HOURLY_CRON = "0 * * * *";
export const NIGHTLY_HOUR_UTC = 4;
