import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getSessionUser } from '@claudio/db';
import { SESSION_COOKIE } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';

// Webhooks authenticate with their HMAC signature instead of a session.
const PUBLIC_PATHS = ['/login', '/auth/', '/webhooks/'];

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const user = token ? await getSessionUser(db(), token) : null;
	event.locals.user = user ? { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl } : null;

	const path = event.url.pathname;
	if (!event.locals.user && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))) {
		if (event.request.method !== 'GET' || path.startsWith('/runs/') || path.endsWith('/events') || path.endsWith('/live')) {
			return new Response('Nicht angemeldet', { status: 401 });
		}
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}
	return resolve(event);
};
