import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { signIn } from '@claudio/db';
import { startSession } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { devFixtures } from '#lib/server/env.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';
import { accountProvider } from '#lib/server/i18n.js';

/** Offline demo login without GitHub. Only on the dev server with CLAUDIO_DEV_FIXTURES=1. */
export const POST: RequestHandler = async ({ cookies, locals }) => {
	if (!dev || !devFixtures()) error(404, serverI18n(locals.locale, accountProvider(locals.user)).t('common.notFound'));
	const user = await signIn(db(), { provider: 'github', externalId: 0, login: 'demo', name: 'Demo (ohne GitHub)', avatarUrl: null, accessToken: '' });
	await startSession(cookies, user.id, false);
	redirect(303, '/');
};
