import { error } from '@sveltejs/kit';
import { getReview } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { runEventStream } from '#lib/server/sse.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';
import { accountProvider } from '#lib/server/i18n.js';

export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	const id = Number(params.id);
	const item = Number.isInteger(id) ? await getReview(db(), id) : undefined;
	if (!item) error(404, serverI18n(locals.locale, accountProvider(locals.user)).t('review.reviewNotFound'));
	await requireRepo(locals.user, item.repoId, 'read');
	return runEventStream(request, url, { reviewId: id }, async () => (await getReview(db(), id))?.status ?? null);
};
