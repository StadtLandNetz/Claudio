import { redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { safeNext } from '#lib/server/auth.js';
import { devFixtures, githubOAuthConfig } from '#lib/server/env.js';
import { serverI18n, type MessageKey } from '#lib/i18n/index.js';
import type { PageServerLoad } from './$types';

const ERRORS: Record<string, MessageKey> = {
	config: 'common.loginErrorConfig',
	state: 'common.loginErrorState',
	denied: 'common.loginErrorDenied',
	forbidden: 'common.loginErrorForbidden',
	github: 'common.loginErrorGithub'
};

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	const code = url.searchParams.get('error');
	return {
		next,
		error: code ? serverI18n(locals.locale).t(ERRORS[code] ?? 'common.loginErrorGithub') : null,
		configured: githubOAuthConfig() !== null,
		devLogin: dev && devFixtures()
	};
};
