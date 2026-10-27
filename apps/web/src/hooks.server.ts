import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getSessionUser, setUserLocale } from '@claudio/db';
import { LOCALE_COOKIE, isLocale, pickLocale, translate } from '#lib/i18n/index.js';
import { SESSION_COOKIE } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';

// Webhooks authenticate with their HMAC signature instead of a session.
// /public/ serves single screenshots behind signed links (GitHub issues).
const PUBLIC_PATHS = ['/login', '/auth/', '/webhooks/', '/api/health', '/locale', '/public/'];

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const user = token ? await getSessionUser(db(), token) : null;

	// The cookie (this browser's choice) wins, then the person's stored choice, then the browser language.
	const cookie = event.cookies.get(LOCALE_COOKIE);
	const locale = pickLocale(cookie ?? user?.locale ?? undefined, event.request.headers.get('accept-language'));
	event.locals.locale = locale;
	// Stored per person, so automated runs post to GitHub in their language too.
	if (user && user.locale !== locale && (isLocale(cookie) || !user.locale)) await setUserLocale(db(), user.id, locale);
	event.locals.user = user ? { id: user.id, provider: user.provider, login: user.login, name: user.name, avatarUrl: user.avatarUrl } : null;

	const path = event.url.pathname;
	// The root itself is public (the landing page), but not everything below it, so it is not a prefix in PUBLIC_PATHS.
	if (!event.locals.user && path !== '/' && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))) {
		if (event.request.method !== 'GET' || path.startsWith('/runs/') || path.endsWith('/events') || path.endsWith('/live')) {
			return new Response(translate(locale, 'system.notSignedIn'), { status: 401 });
		}
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}
	return resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', locale) });
};
