// Display names and formatters depend on the language: see #lib/i18n (`i18n().labels`, `i18n().formatDate`).

export const isActive = (status: string) => status === 'queued' || status === 'running';

/** Preselected for manual test runs; tests inside PR reviews always run "quick". */
export const DEFAULT_TEST_BUDGET = 'standard';
