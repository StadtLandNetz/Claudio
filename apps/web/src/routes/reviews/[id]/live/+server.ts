import { error } from '@sveltejs/kit';
import { getReview } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { liveFrame } from '#lib/server/live.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await getReview(db(), id))) error(404, 'Diesen Review gibt es nicht.');
	return liveFrame(async () => {
		const r = await getReview(db(), id);
		return r ? { status: r.status, runId: r.runId } : null;
	});
};
