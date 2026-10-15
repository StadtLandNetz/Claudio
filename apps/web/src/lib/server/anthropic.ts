import type { Repo } from '@claudio/db';
import { DEMO_REPO } from './demo.js';
import { devFixtures } from './env.js';
import { requestI18n } from './i18n.js';

export type KeyCheck = { ok: true } | { ok: false; reason: string; unverified?: boolean };

/** Asks Anthropic whether the key is valid (listing models costs nothing). */
export async function checkAnthropicKey(key: string): Promise<KeyCheck> {
	const { t } = requestI18n();
	if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, reason: t('system.keyMalformed') };
	if (key.startsWith('sk-ant-admin')) return { ok: false, reason: t('system.keyIsAdmin') };
	if (key.startsWith('sk-ant-oat')) return { ok: false, reason: t('system.keyIsSubscription') };
	try {
		const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
			headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
			signal: AbortSignal.timeout(8000)
		});
		if (res.ok) return { ok: true };
		const detail = await errorMessage(res);
		if (res.status === 401 || res.status === 403) return { ok: false, reason: t('system.keyRejected', { detail }) };
		return { ok: false, reason: t('system.keyCheckHttp', { status: res.status, detail }), unverified: true };
	} catch {
		return { ok: false, reason: t('system.keyCheckUnreachable'), unverified: true };
	}
}

/** Anthropic's own explanation (`{ error: { message } }`), as a suffix like ` ("…")`, or empty. */
async function errorMessage(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { error?: { message?: unknown } };
		const message = typeof body.error?.message === 'string' ? body.error.message.trim().slice(0, 200) : '';
		return message ? ` ("${message}")` : '';
	} catch {
		return '';
	}
}

/** The offline demo may run on the dev machine's own Claude login; real repos need their own key. */
export function keyOptional(repo: Pick<Repo, 'fullName'>): boolean {
	return devFixtures() && repo.fullName === DEMO_REPO;
}

/** Shown in the UI and posted to PRs, so it follows the request's language (German for webhooks). */
export const noKeyMessage = () => requestI18n().t('system.noKey');
