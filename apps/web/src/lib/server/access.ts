import { error } from '@sveltejs/kit';
import { cachedAccess, getRepo, getRepoById, listRepos, storeAccess, type AccessLevel, type Repo } from '@claudio/db';
import { createGithubClient } from '@claudio/github';
import { userToken, type SessionUser } from './auth.js';
import { db } from './db.js';
import { DEMO_REPO } from './demo.js';
import { devFixtures } from './env.js';

/** GitHub permissions are cached this long; changes on GitHub show up after that at the latest. */
const TTL_MS = 15 * 60_000;
const RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };

export const atLeast = (level: AccessLevel, min: AccessLevel) => RANK[level] >= RANK[min];

/** Maps GitHub's repository permissions onto Claudio's three levels. */
function fromGithub(p: { admin?: boolean; maintain?: boolean; push?: boolean; pull?: boolean } | undefined): AccessLevel {
	if (p?.admin) return 'admin';
	if (p?.maintain || p?.push) return 'write';
	if (p?.pull) return 'read';
	return 'none';
}

/** GitHub rejected the user's token (expired or revoked): they must sign in again. */
export class GithubAuthExpired extends Error {}

async function fetchLevel(token: string, fullName: string): Promise<AccessLevel | null> {
	const [owner, repo] = fullName.split('/') as [string, string];
	try {
		const { data } = await createGithubClient(token).rest.repos.get({ owner, repo });
		return fromGithub(data.permissions);
	} catch (e) {
		const status = (e as { status?: number }).status;
		if (status === 401) throw new GithubAuthExpired();
		// 404/403: no access (GitHub hides private repos). Anything else: unknown, keep the cache.
		return status === 404 || status === 403 ? 'none' : null;
	}
}

/** The user's level on each repository, from the cache or fresh from GitHub. */
export async function accessMap(user: SessionUser, repos?: Repo[]): Promise<Map<number, AccessLevel> & { authExpired?: boolean }> {
	const all = repos ?? (await listRepos(db()));
	const cache = await cachedAccess(db(), user.id);
	const token = await userToken(user);
	const out: Map<number, AccessLevel> & { authExpired?: boolean } = new Map();
	await Promise.all(
		all.map(async (repo) => {
			// The offline demo repo does not exist on GitHub; on the dev server everyone may use it.
			if (repo.fullName === DEMO_REPO && devFixtures()) return out.set(repo.id, 'admin');
			const cached = cache.get(repo.id);
			if (cached && Date.now() - cached.checkedAt.getTime() < TTL_MS) return out.set(repo.id, cached.level);
			if (!token) return out.set(repo.id, 'none');
			let level: AccessLevel | null;
			try {
				level = await fetchLevel(token, repo.fullName);
			} catch (e) {
				if (!(e instanceof GithubAuthExpired)) throw e;
				out.authExpired = true;
				level = null;
			}
			if (level === null) return out.set(repo.id, cached?.level ?? 'none');
			await storeAccess(db(), user.id, repo.id, level);
			out.set(repo.id, level);
		})
	);
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

const NEED: Record<AccessLevel, string> = {
	none: '',
	read: 'Lesezugriff',
	write: 'Schreibrechte',
	admin: 'Admin-Rechte'
};

/**
 * Loads a repository and checks the user's level. Without read access the
 * repository does not exist for them (404); with too little access, 403.
 */
export async function requireRepo(user: SessionUser | null, ref: number | string, min: AccessLevel = 'read'): Promise<{ repo: Repo; level: AccessLevel }> {
	if (!user) error(401, 'Nicht angemeldet');
	const repo = typeof ref === 'number' ? await getRepoById(db(), ref) : await getRepo(db(), ref);
	if (!repo) error(404, 'Nicht gefunden.');
	const level = await accessTo(user, repo);
	if (!atLeast(level, 'read')) error(404, 'Nicht gefunden.');
	if (!atLeast(level, min)) error(403, `Dafür brauchst du ${NEED[min]} am Repository ${repo.fullName} auf GitHub.`);
	return { repo, level };
}
