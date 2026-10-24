import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Provider } from '@claudio/core';

/** Monorepo root: apps/web is two levels down. Override with CLAUDIO_ROOT. */
export const projectRoot = resolve(process.env.CLAUDIO_ROOT ?? resolve(process.cwd(), '../..'));

// Web, worker and CLI share one .env at the repo root. Vite does not put it into process.env.
const envFile = resolve(projectRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const runsRoot = resolve(projectRoot, process.env.CLAUDIO_RUNS_DIR ?? 'runs');

export function env(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value === '' ? undefined : value;
}

export const devFixtures = () => process.env.CLAUDIO_DEV_FIXTURES === '1';

export function publicBaseUrl(fallback: URL): string {
	return (env('PUBLIC_BASE_URL') ?? fallback.origin).replace(/\/$/, '');
}

function list(name: string): string[] {
	return (env(name) ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

/** Who may sign in with a provider: user names, and organisations (GitHub) or groups (GitLab). */
export const allowedUsers = (provider: Provider) => list(provider === 'gitlab' ? 'CLAUDIO_ALLOWED_GITLAB_USERS' : 'CLAUDIO_ALLOWED_GITHUB_USERS');
export const allowedGroups = (provider: Provider) => list(provider === 'gitlab' ? 'CLAUDIO_ALLOWED_GITLAB_GROUPS' : 'CLAUDIO_ALLOWED_GITHUB_ORGS');
