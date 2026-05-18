/** chrome.storage.local — set when user finishes welcome flow */
export const ONBOARDING_DONE_KEY = "cortex_onboarding_done_v1";

/** One-time after fresh install: history scan + open-tab indexing kickoff */
export const FIRST_INSTALL_BACKFILL_DONE_KEY =
  "cortex_first_install_backfill_done_v1";

/** First-install history backfill matches Settings → Import (30 days, 500 URLs). */
export const FIRST_INSTALL_HISTORY_DAYS = 30;
export const FIRST_INSTALL_HISTORY_MAX_URLS = 500;
