import { redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { oauth } from '@claudio/forge';
import { safeNext } from '#lib/server/auth.js';
import { devFixtures } from '#lib/server/env.js';
import { serverI18n, type MessageKey } from '#lib/i18n/index.js';
import type { PageServerLoad } from './$types';

const ERRORS: Record<string, MessageKey> = {
	config: 'common.loginErrorConfig',
	state: 'common.loginErrorState',
	denied: 'common.loginErrorDenied',
	forbidden: 'common.loginErrorForbidden',
	provider: 'common.loginErrorGithub',
	github: 'common.loginErrorGithub'
};

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	const code = url.searchParams.get('error');
	// Errors name the provider the person tried to sign in with.
	const provider = url.searchParams.get('provider') === 'gitlab' ? 'gitlab' : 'github';
	const key = code === 'config' && provider === 'gitlab' ? 'common.loginErrorConfigGitlab' : (ERRORS[code ?? ''] ?? 'common.loginErrorGithub');
	return {
		next,
		error: code ? serverI18n(locals.locale, provider).t(key) : null,
		providers: { github: oauth('github').configured(), gitlab: oauth('gitlab').configured() },
		devLogin: dev && devFixtures()
	};
};
