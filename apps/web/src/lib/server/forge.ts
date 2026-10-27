import type { Provider } from '@claudio/core';
import type { Repo } from '@claudio/db';
import { botForge, forgeFor, statusOf, type Forge } from '@claudio/forge';
import { userToken, type SessionUser } from './auth.js';
import { requestI18n } from './i18n.js';

/**
 * The signed-in person's access to a provider, or null: no connected account of
 * that provider, no token (offline demo user) or one that could not be renewed.
 */
export async function userForge(user: SessionUser | null, provider: Provider): Promise<Forge | null> {
	return (await userForgeState(user, provider)).forge;
}

/** Like userForge, and says whether a connected account's token expired (the person should connect it again). */
export async function userForgeState(user: SessionUser | null, provider: Provider): Promise<{ forge: Forge | null; expired: boolean }> {
	if (!user) return { forge: null, expired: false };
	const { token, expired } = await userToken(user, provider);
	return { forge: token ? forgeFor(provider, token) : null, expired };
}

/**
 * Who Claudio writes to GitHub or GitLab as: its own identity (GitHub App,
 * GitLab bot user) where it has one on the repository, otherwise the signed-in person.
 */
export async function forgeAs(repo: Repo, user: SessionUser | null): Promise<{ forge: Forge; as: 'app' | 'user' } | null> {
	const bot = await botForge(repo).catch(() => null);
	if (bot) return { forge: bot, as: 'app' };
	const forge = await userForge(user, repo.provider);
	return forge ? { forge, as: 'user' } : null;
}

/** Human-readable message for API errors (expired token, missing access), naming the provider. */
export function forgeErrorMessage(e: unknown, provider: Provider): string {
	const { t } = requestI18n(provider);
	const status = statusOf(e);
	if (status === 401) return t('system.githubExpired');
	if (status === 403) return t('system.githubForbidden');
	if (status === 404) return t('system.githubNotFound');
	return t('system.githubError', { message: (e as Error).message });
}
