import { error } from '@sveltejs/kit';
import type { Provider } from '@claudio/core';
import { cachedAccess, getRepo, getRepoById, listRepos, storeAccess, type AccessLevel, type Repo } from '@claudio/db';
import { ForgeAuthError, statusOf, type Forge } from '@claudio/forge';
import type { SessionUser } from './auth.js';
import { db } from './db.js';
import { DEMO_REPO } from './demo.js';
import { devFixtures } from './env.js';
import { userForge } from './forge.js';
import { requestI18n } from './i18n.js';

/** GitHub and GitLab permissions are cached this long; changes there show up after that at the latest. */
const TTL_MS = 15 * 60_000;
/** An older entry still answers once while GitHub or GitLab is asked again in the background; beyond this, the page waits. */
const STALE_MS = 24 * 3_600_000;
/** Users whose token GitHub or GitLab rejected during a background check: they get the "sign in again" notice. */
const tokenRejectedAt = new Map<number, number>();
const refreshing = new Set<string>();
const RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };

export const atLeast = (level: AccessLevel, min: AccessLevel) => RANK[level] >= RANK[min];

/** The provider rejected the user's token (expired or revoked): they must sign in again. */
const isAuthError = (e: unknown) => e instanceof ForgeAuthError || statusOf(e) === 401;

/** The level from the provider; null when it could not tell (the cache is kept). */
async function fetchLevel(forge: Forge, repo: Repo): Promise<AccessLevel | null> {
	try {
		return await forge.getAccessLevel(repo);
	} catch (e) {
		if (isAuthError(e)) throw e;
		return null;
	}
}

/** Asks the provider again for one repository without holding up the page that found the cache stale. */
function refreshInBackground(user: SessionUser, forge: Forge, repo: Repo): void {
	const key = `${user.id}:${repo.id}`;
	if (refreshing.has(key)) return;
	refreshing.add(key);
	fetchLevel(forge, repo)
		.then((level) => (level === null ? undefined : storeAccess(db(), user.id, repo.id, level)))
		.catch((e) => {
			if (isAuthError(e)) tokenRejectedAt.set(user.id, Date.now());
		})
		.finally(() => refreshing.delete(key));
}

/** The user's level on each repository, from the cache or fresh from GitHub or GitLab. */
export async function accessMap(user: SessionUser, repos?: Repo[]): Promise<Map<number, AccessLevel> & { authExpired?: boolean }> {
	const all = repos ?? (await listRepos(db()));
	const cache = await cachedAccess(db(), user.id);
	const forge = await userForge(user, user.provider);
	const out: Map<number, AccessLevel> & { authExpired?: boolean } = new Map();
	await Promise.all(
		all.map(async (repo) => {
			// The offline demo repo does not exist on GitHub; on the dev server everyone may use it.
			if (repo.fullName === DEMO_REPO && devFixtures()) return out.set(repo.id, 'admin');
			// A GitHub account sees no GitLab repositories and the other way round.
			if (repo.provider !== user.provider) return out.set(repo.id, 'none');
			const cached = cache.get(repo.id);
			const age = cached ? Date.now() - cached.checkedAt.getTime() : Infinity;
			if (cached && age < TTL_MS) return out.set(repo.id, cached.level);
			if (!forge) return out.set(repo.id, 'none');
			// A stale answer serves this page; the next one gets the provider's current one.
			if (cached && age < STALE_MS) {
				refreshInBackground(user, forge, repo);
				return out.set(repo.id, cached.level);
			}
			let level: AccessLevel | null;
			try {
				level = await fetchLevel(forge, repo);
				tokenRejectedAt.delete(user.id);
			} catch (e) {
				if (!isAuthError(e)) throw e;
				out.authExpired = true;
				level = null;
			}
			if (level === null) return out.set(repo.id, cached?.level ?? 'none');
			await storeAccess(db(), user.id, repo.id, level);
			out.set(repo.id, level);
		})
	);
	if ((tokenRejectedAt.get(user.id) ?? 0) > Date.now() - TTL_MS) out.authExpired = true;
	return out;
}

export async function accessTo(user: SessionUser, repo: Repo): Promise<AccessLevel> {
	return (await accessMap(user, [repo])).get(repo.id) ?? 'none';
}

/** Repositories the user may see. */
export async function visibleRepos(user: SessionUser): Promise<{ repos: Repo[]; levels: Map<number, AccessLevel>; authExpired: boolean }> {
	const all = await listRepos(db());
	const levels = await accessMap(user, all);
	return { repos: all.filter((r) => atLeast(levels.get(r.id) ?? 'none', 'read')), levels, authExpired: Boolean(levels.authExpired) };
}

const NEED = { none: 'system.needNone', read: 'system.needRead', write: 'system.needWrite', admin: 'system.needAdmin' } as const;

/**
 * Loads a repository and checks the user's level. Without read access the
 * repository does not exist for them (404); with too little access, 403.
 */
export async function requireRepo(user: SessionUser | null, ref: number | { provider: Provider; fullName: string }, min: AccessLevel = 'read'): Promise<{ repo: Repo; level: AccessLevel }> {
	const { t } = requestI18n();
	if (!user) error(401, t('system.notSignedIn'));
	const repo = typeof ref === 'number' ? await getRepoById(db(), ref) : await getRepo(db(), ref.provider, ref.fullName);
	if (!repo) error(404, t('system.notFound'));
	const level = await accessTo(user, repo);
	if (!atLeast(level, 'read')) error(404, t('system.notFound'));
	if (!atLeast(level, min)) error(403, t('system.needAccess', { need: t(NEED[min]), repo: repo.fullName }));
	return { repo, level };
}
