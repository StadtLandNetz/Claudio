import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

export function githubOAuthConfig(): { clientId: string; clientSecret: string } | null {
	const clientId = env('GITHUB_CLIENT_ID');
	const clientSecret = env('GITHUB_CLIENT_SECRET');
	return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function publicBaseUrl(fallback: URL): string {
	return (env('PUBLIC_BASE_URL') ?? fallback.origin).replace(/\/$/, '');
}

function list(name: string): string[] {
	return (env(name) ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export const allowedUsers = () => list('CLAUDIO_ALLOWED_GITHUB_USERS');
export const allowedOrgs = () => list('CLAUDIO_ALLOWED_GITHUB_ORGS');
