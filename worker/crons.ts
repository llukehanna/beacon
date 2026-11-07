/**
 * The one Cron Trigger in wrangler.jsonc ("crons"): hourly, because the Workers free plan allows
 * five per account. The run at NIGHTLY_HOUR_UTC is the nightly reset; every other run only applies
 * the market signals that have come due. These live outside worker/index.ts because workerd treats
 * every named export of the entry module as an entrypoint and refuses to boot when one is not a
 * function or a handler object.
 */
export const HOURLY_CRON = "0 * * * *";
export const NIGHTLY_HOUR_UTC = 4;
