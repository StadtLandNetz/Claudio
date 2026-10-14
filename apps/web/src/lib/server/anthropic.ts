import type { Repo } from '@claudio/db';
import { DEMO_REPO } from './demo.js';
import { devFixtures } from './env.js';

export type KeyCheck = { ok: true } | { ok: false; reason: string; unverified?: boolean };

/** Asks Anthropic whether the key is valid (listing models costs nothing). */
export async function checkAnthropicKey(key: string): Promise<KeyCheck> {
	if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, reason: 'Das sieht nicht wie ein Anthropic-API-Key aus (beginnt mit sk-ant-).' };
	if (key.startsWith('sk-ant-admin')) return { ok: false, reason: 'Das ist ein Admin-Key. Claudio braucht einen normalen API-Key (console.anthropic.com → API Keys, beginnt mit sk-ant-api).' };
	if (key.startsWith('sk-ant-oat')) return { ok: false, reason: 'Das ist ein Token eines Claude-Abos (claude setup-token). Claudio braucht einen API-Key aus der Anthropic Console (beginnt mit sk-ant-api).' };
	try {
		const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
			headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
			signal: AbortSignal.timeout(8000)
		});
		if (res.ok) return { ok: true };
		const detail = await errorMessage(res);
		if (res.status === 401 || res.status === 403) return { ok: false, reason: `Anthropic hat den Key abgelehnt${detail}. Prüfe, ob er vollständig kopiert und nicht widerrufen ist.` };
		return { ok: false, reason: `Anthropic antwortete mit HTTP ${res.status}${detail}; der Key konnte nicht geprüft werden.`, unverified: true };
	} catch {
		return { ok: false, reason: 'Anthropic war nicht erreichbar; der Key konnte nicht geprüft werden.', unverified: true };
	}
}

/** Anthropic's own explanation (`{ error: { message } }`), as a suffix like ` („…“)`, or empty. */
async function errorMessage(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { error?: { message?: unknown } };
		const message = typeof body.error?.message === 'string' ? body.error.message.trim().slice(0, 200) : '';
		return message ? ` („${message}“)` : '';
	} catch {
		return '';
	}
}

/** The offline demo may run on the dev machine's own Claude login; real repos need their own key. */
export function keyOptional(repo: Pick<Repo, 'fullName'>): boolean {
	return devFixtures() && repo.fullName === DEMO_REPO;
}

export const NO_KEY_MESSAGE = 'Für dieses Repository ist kein Anthropic-API-Key hinterlegt. Ein Admin kann ihn in den Einstellungen eintragen.';
