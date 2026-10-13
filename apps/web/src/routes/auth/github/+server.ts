import { randomBytes } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import { STATE_COOKIE, safeNext } from '#lib/server/auth.js';
import { githubOAuthConfig, publicBaseUrl } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies }) => {
	const config = githubOAuthConfig();
	if (!config) redirect(303, '/login?error=config');
	const state = randomBytes(16).toString('base64url');
	const next = safeNext(url.searchParams.get('next'));
	cookies.set(STATE_COOKIE, `${state}|${next}`, {
		path: '/auth',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 600
	});
	const authorize = new URL('https://github.com/login/oauth/authorize');
	authorize.searchParams.set('client_id', config.clientId);
	authorize.searchParams.set('redirect_uri', `${publicBaseUrl(url)}/auth/github/callback`);
	authorize.searchParams.set('scope', 'repo read:user read:org');
	authorize.searchParams.set('state', state);
	redirect(303, authorize.toString(), { external: true });
};
