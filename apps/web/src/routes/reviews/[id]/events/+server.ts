import { error } from '@sveltejs/kit';
import { getReview } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { runEventStream } from '#lib/server/sse.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await getReview(db(), id))) error(404, 'Diesen Review gibt es nicht.');
	return runEventStream(request, url, { reviewId: id }, async () => (await getReview(db(), id))?.status ?? null);
};
