import { error } from '@sveltejs/kit';
import { getReview } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { liveFrame } from '#lib/server/live.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	const item = Number.isInteger(id) ? await getReview(db(), id) : undefined;
	if (!item) error(404, serverI18n(locals.locale).t('review.reviewNotFound'));
	await requireRepo(locals.user, item.repoId, 'read');
	return liveFrame(async () => {
		const r = await getReview(db(), id);
		return r ? { status: r.status, runId: r.runId } : null;
	});
};
