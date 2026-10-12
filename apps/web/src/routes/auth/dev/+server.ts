import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { upsertUser } from '@claudio/db';
import { startSession } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { devFixtures } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

/** Offline demo login without GitHub. Only on the dev server with CLAUDIO_DEV_FIXTURES=1. */
export const POST: RequestHandler = async ({ cookies }) => {
	if (!dev || !devFixtures()) error(404, 'Nicht gefunden');
	const user = await upsertUser(db(), { githubId: 0, login: 'demo', name: 'Demo (ohne GitHub)', avatarUrl: null, accessToken: '' });
	await startSession(cookies, user.id, false);
	redirect(303, '/');
};
