import type { Repo } from '@claudio/db';
import { DEMO_REPO } from './demo.js';
import { devFixtures } from './env.js';

export type KeyCheck = { ok: true } | { ok: false; reason: string; unverified?: boolean };

/** Asks Anthropic whether the key is valid (listing models costs nothing). */
export async function checkAnthropicKey(key: string): Promise<KeyCheck> {
	if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, reason: 'Das sieht nicht wie ein Anthropic-API-Key aus (beginnt mit sk-ant-).' };
	try {
		const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
			headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
			signal: AbortSignal.timeout(8000)
		});
		if (res.ok) return { ok: true };
		if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Anthropic hat den Key abgelehnt. Prüfe, ob er vollständig kopiert und nicht widerrufen ist.' };
		return { ok: false, reason: `Anthropic antwortete mit HTTP ${res.status}; der Key konnte nicht geprüft werden.`, unverified: true };
	} catch {
		return { ok: false, reason: 'Anthropic war nicht erreichbar; der Key konnte nicht geprüft werden.', unverified: true };
	}
}

/** The offline demo may run on the dev machine's own Claude login; real repos need their own key. */
export function keyOptional(repo: Pick<Repo, 'fullName'>): boolean {
	return devFixtures() && repo.fullName === DEMO_REPO;
}

export const NO_KEY_MESSAGE = 'Für dieses Repository ist kein Anthropic-API-Key hinterlegt. Ein Admin kann ihn in den Einstellungen eintragen.';
