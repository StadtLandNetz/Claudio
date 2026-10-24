import { getRequestEvent } from '$app/server';
import { DEFAULT_LOCALE, serverI18n, type I18n } from '#lib/i18n/index.js';

/**
 * Texts in the language of the current request (and naming the signed-in
 * person's GitHub or GitLab), for server code that has no `locals` at hand. Outside a request (webhooks without a browser, background
 * work) it falls back to German.
 */
export function requestI18n(): I18n {
	try {
		const { locals } = getRequestEvent();
		return serverI18n(locals.locale ?? DEFAULT_LOCALE, locals.user?.provider);
	} catch {
		return serverI18n(DEFAULT_LOCALE);
	}
}
