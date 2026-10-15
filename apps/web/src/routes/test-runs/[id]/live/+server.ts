import { error } from '@sveltejs/kit';
import { getTestRun } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { serverI18n } from '#lib/i18n/index.js';
import { liveFrame } from '#lib/server/live.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	const item = Number.isInteger(id) ? await getTestRun(db(), id) : undefined;
	if (!item) error(404, serverI18n(locals.locale).t('test.runNotFound'));
	await requireRepo(locals.user, item.repoId, 'read');
	return liveFrame(async () => {
		const r = await getTestRun(db(), id);
		return r ? { status: r.status, runId: r.runId } : null;
	});
};
