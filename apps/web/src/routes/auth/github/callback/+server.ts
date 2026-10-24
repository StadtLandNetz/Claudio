import { redirect } from '@sveltejs/kit';
import { clearAccess, upsertUser } from '@claudio/db';
import { STATE_COOKIE, isAllowed, safeNext, startSession } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { githubOAuthConfig, publicBaseUrl } from '#lib/server/env.js';
import { exchangeCode } from '@claudio/forge';
import { fetchGithubUser } from '#lib/server/github.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const config = githubOAuthConfig();
	if (!config) redirect(303, '/login?error=config');

	const [expected, next] = (cookies.get(STATE_COOKIE) ?? '').split('|');
	cookies.delete(STATE_COOKIE, { path: '/auth' });
	const code = url.searchParams.get('code');
	if (url.searchParams.get('error') === 'access_denied') redirect(303, '/login?error=denied');
	if (!code || !expected || url.searchParams.get('state') !== expected) redirect(303, '/login?error=state');

	let target = '/login?error=github';
	try {
		const tokens = await exchangeCode(config.clientId, config.clientSecret, code, `${publicBaseUrl(url)}/auth/github/callback`);
		const token = tokens.accessToken;
		const profile = await fetchGithubUser(token);
		if (!(await isAllowed(profile.login, token))) {
			target = '/login?error=forbidden';
		} else {
			const user = await upsertUser(db(), { ...profile, accessToken: token, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt });
			// Permissions are fetched fresh after every login, so changes on GitHub apply right away.
			await clearAccess(db(), user.id);
			await startSession(cookies, user.id, url.protocol === 'https:');
			target = safeNext(next ?? null);
		}
	} catch (e) {
		console.error('GitHub login failed', e);
	}
	redirect(303, target);
};
