import type { Cookies } from '@sveltejs/kit';
import { createSession, deleteSession, freshAccessToken, getUser, type User } from '@claudio/db';
import { db } from './db.js';
import { allowedOrgs, allowedUsers } from './env.js';
import { fetchUserOrgs } from './github.js';

export const SESSION_COOKIE = 'claudio_session';
export const STATE_COOKIE = 'claudio_oauth_state';

export type SessionUser = Pick<User, 'id' | 'login' | 'name' | 'avatarUrl'>;

export async function startSession(cookies: Cookies, userId: number, secure: boolean): Promise<void> {
	const { token, expiresAt } = await createSession(db(), userId);
	cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires: expiresAt });
}

export async function endSession(cookies: Cookies): Promise<void> {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await deleteSession(db(), token);
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Applies CLAUDIO_ALLOWED_GITHUB_USERS / _ORGS. With neither set, every GitHub user may sign in. */
export async function isAllowed(login: string, token: string): Promise<boolean> {
	const users = allowedUsers();
	const orgs = allowedOrgs();
	if (users.length === 0 && orgs.length === 0) return true;
	if (users.includes(login.toLowerCase())) return true;
	if (orgs.length === 0) return false;
	const memberOf = await fetchUserOrgs(token);
	return memberOf.some((o) => orgs.includes(o));
}

/** The signed-in user's GitHub token, or null for the offline demo user. */
export async function userToken(user: SessionUser): Promise<string | null> {
	const row = await getUser(db(), user.id);
	return row ? freshAccessToken(db(), row) : null;
}

export function safeNext(next: string | null): string {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
