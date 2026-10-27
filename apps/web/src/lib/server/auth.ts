import type { Cookies } from '@sveltejs/kit';
import { createSession, deleteSession, tokenFor, type User } from '@claudio/db';
import { db } from './db.js';
import type { Provider } from '@claudio/core';
import { oauth } from '@claudio/forge';
import { allowedGroups, allowedUsers } from './env.js';

export const SESSION_COOKIE = 'claudio_session';
export const STATE_COOKIE = 'claudio_oauth_state';

/** The signed-in person and the providers of the GitHub and GitLab accounts they connected. */
export type SessionUser = Pick<User, 'id' | 'login' | 'name' | 'avatarUrl'> & { providers: Provider[] };

export async function startSession(cookies: Cookies, userId: number, secure: boolean): Promise<void> {
	const { token, expiresAt } = await createSession(db(), userId);
	cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires: expiresAt });
}

export async function endSession(cookies: Cookies): Promise<void> {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await deleteSession(db(), token);
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/**
 * Applies CLAUDIO_ALLOWED_GITHUB_USERS / _ORGS and CLAUDIO_ALLOWED_GITLAB_USERS / _GROUPS.
 * Without any list, everybody may sign in. With lists for one provider only, the
 * other provider lets nobody in, so connecting GitLab does not open Claudio to all of gitlab.com.
 */
export async function isAllowed(provider: Provider, login: string, token: string): Promise<boolean> {
	const users = allowedUsers(provider);
	const groups = allowedGroups(provider);
	if (users.length === 0 && groups.length === 0) {
		const other: Provider = provider === 'github' ? 'gitlab' : 'github';
		return allowedUsers(other).length === 0 && allowedGroups(other).length === 0;
	}
	if (users.includes(login.toLowerCase())) return true;
	if (groups.length === 0) return false;
	const memberOf = await oauth(provider).memberships(token);
	// A member of a GitLab subgroup (slw/apps) counts for the group above it (slw).
	return memberOf.some((m) => groups.some((g) => m === g || m.startsWith(`${g}/`)));
}

/**
 * The signed-in person's token for a provider: null without a connected account
 * of it (or for the offline demo user); `expired` when the account's token could
 * not be renewed and the person should connect it again.
 */
export async function userToken(user: SessionUser, provider: Provider): Promise<{ token: string | null; expired: boolean }> {
	if (!user.providers.includes(provider)) return { token: null, expired: false };
	return tokenFor(db(), user.id, provider);
}

export function safeNext(next: string | null): string {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
