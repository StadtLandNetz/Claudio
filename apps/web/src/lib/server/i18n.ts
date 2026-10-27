import { getRequestEvent } from '$app/server';
import type { Provider } from '@claudio/core';
import { DEFAULT_LOCALE, serverI18n, type I18n } from '#lib/i18n/index.js';
import type { SessionUser } from './auth.js';

/**
 * The provider texts name when they are not about one repository: the person's
 * only connected account, else GitHub.
 */
export const accountProvider = (user: Pick<SessionUser, 'providers'> | null | undefined): Provider =>
	user?.providers.length === 1 ? user.providers[0]! : 'github';

/**
 * Texts in the language of the current request, for server code that has no
 * `locals` at hand. They name `provider` (a repository's GitHub or GitLab), else
 * the person's account. Outside a request (webhooks without a browser,
 * background work) it falls back to German.
 */
export function requestI18n(provider?: Provider): I18n {
	try {
		const { locals } = getRequestEvent();
		return serverI18n(locals.locale ?? DEFAULT_LOCALE, provider ?? accountProvider(locals.user));
	} catch {
		return serverI18n(DEFAULT_LOCALE, provider);
	}
}
