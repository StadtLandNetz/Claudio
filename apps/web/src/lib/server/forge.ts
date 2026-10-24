import type { Provider } from '@claudio/core';
import type { Repo } from '@claudio/db';
import { botForge, forgeFor, statusOf, type Forge } from '@claudio/forge';
import { userToken, type SessionUser } from './auth.js';
import { requestI18n } from './i18n.js';

/**
 * The signed-in person's access to a provider, or null: no token (offline demo
 * user, expired sign-in) or an account of the other provider.
 */
export async function userForge(user: SessionUser | null, provider: Provider): Promise<Forge | null> {
	if (!user || user.provider !== provider) return null;
	const token = await userToken(user);
	return token ? forgeFor(provider, token) : null;
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

/** Human-readable message for API errors (expired token, missing access). */
export function forgeErrorMessage(e: unknown): string {
	const { t } = requestI18n();
	const status = statusOf(e);
	if (status === 401) return t('system.githubExpired');
	if (status === 403) return t('system.githubForbidden');
	if (status === 404) return t('system.githubNotFound');
	return t('system.githubError', { message: (e as Error).message });
}
