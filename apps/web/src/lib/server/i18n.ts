import { getRequestEvent } from '$app/server';
import { DEFAULT_LOCALE, serverI18n, type I18n } from '#lib/i18n/index.js';

/**
 * Texts in the language of the current request, for server code that has no
 * `locals` at hand. Outside a request (webhooks without a browser, background
 * work) it falls back to German.
 */
export function requestI18n(): I18n {
	try {
		return serverI18n(getRequestEvent().locals.locale ?? DEFAULT_LOCALE);
	} catch {
		return serverI18n(DEFAULT_LOCALE);
	}
}
