import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addRepo, saveRole, updateRepoSettings, type Db } from '@claudio/db';
import type { PullRequestContext } from '@claudio/forge';
import { projectRoot } from './env.js';

/** The offline demo: apps/demo-target with its fixture PR. Only used with CLAUDIO_DEV_FIXTURES=1. */
export const DEMO_REPO = 'vanderlars/dispo-demo';
export const DEMO_FIXTURE = 'demo';
export const DEMO_URL = 'http://127.0.0.1:4310';

export function demoPullRequest(): PullRequestContext {
	return JSON.parse(readFileSync(resolve(projectRoot, 'apps/demo-target/fixtures/pr-context.json'), 'utf8'));
}

export async function createDemoRepo(db: Db, userId: number): Promise<void> {
	const repo = await addRepo(db, { provider: 'github', fullName: DEMO_REPO, isPrivate: false, defaultBranch: 'main', createdBy: userId });
	await updateRepoSettings(db, repo.id, {
		notes: 'Demo-Dispositionsapp. Rollen: Disponent (legt Fahrten an), Admin. Datum im Format JJJJ-MM-TT.',
		extraAllowedHosts: [],
		dataConfirmed: true,
		defaultInstanceUrl: DEMO_URL
	});
	const base = { loginPath: '/login', successUrlContains: '/dashboard', recipe: null };
	await saveRole(db, repo.id, { ...base, name: 'dispatcher', description: 'Disponent', username: 'dispo@example.test', password: 'dispo' });
	await saveRole(db, repo.id, { ...base, name: 'admin', description: 'Administrator', username: 'admin@example.test', password: 'admin' });
}
