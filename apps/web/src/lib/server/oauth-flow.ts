import { randomBytes } from 'node:crypto';
import { redirect, type Cookies } from '@sveltejs/kit';
import type { Provider } from '@claudio/core';
import { clearAccess, upsertUser } from '@claudio/db';
import { oauth } from '@claudio/forge';
import { STATE_COOKIE, isAllowed, safeNext, startSession } from './auth.js';
import { db } from './db.js';
import { publicBaseUrl } from './env.js';

const callbackUrl = (provider: Provider, url: URL) => `${publicBaseUrl(url)}/auth/${provider}/callback`;
/** The login page names the provider in its error messages. */
const failed = (provider: Provider, code: string) => `/login?error=${code}&provider=${provider}`;

/** Sends the person to GitHub's or GitLab's consent page. */
export function startSignIn(provider: Provider, url: URL, cookies: Cookies): never {
	const p = oauth(provider);
	if (!p.configured()) redirect(303, failed(provider, 'config'));
	const state = randomBytes(16).toString('base64url');
	const next = safeNext(url.searchParams.get('next'));
	cookies.set(STATE_COOKIE, `${state}|${next}`, {
		path: '/auth',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 600
	});
	redirect(303, p.authorizeUrl(callbackUrl(provider, url), state), { external: true });
}

/** Back from the consent page: checks the state, the allowlist, and signs the person in. */
export async function finishSignIn(provider: Provider, url: URL, cookies: Cookies): Promise<never> {
	const p = oauth(provider);
	if (!p.configured()) redirect(303, failed(provider, 'config'));

	const [expected, next] = (cookies.get(STATE_COOKIE) ?? '').split('|');
	cookies.delete(STATE_COOKIE, { path: '/auth' });
	const code = url.searchParams.get('code');
	if (url.searchParams.get('error') === 'access_denied') redirect(303, failed(provider, 'denied'));
	if (!code || !expected || url.searchParams.get('state') !== expected) redirect(303, failed(provider, 'state'));

	let target = failed(provider, 'provider');
	try {
		const tokens = await p.exchangeCode(code, callbackUrl(provider, url));
		const token = tokens.accessToken;
		const profile = await p.fetchUser(token);
		if (!(await isAllowed(provider, profile.login, token))) {
			target = failed(provider, 'forbidden');
		} else {
			const user = await upsertUser(db(), { provider, ...profile, accessToken: token, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt });
			// Permissions are fetched fresh after every login, so changes on GitHub or GitLab apply right away.
			await clearAccess(db(), user.id);
			await startSession(cookies, user.id, url.protocol === 'https:');
			target = safeNext(next ?? null);
		}
	} catch (e) {
		console.error(`${provider} login failed`, e);
	}
	redirect(303, target);
}
