import { error } from '@sveltejs/kit';
import { getAnalysis } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { liveViewStream } from '#lib/server/live.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await getAnalysis(db(), id))) error(404, 'Diese Analyse gibt es nicht.');
	return liveViewStream(request, async () => {
		const a = await getAnalysis(db(), id);
		return a ? { status: a.status, runId: a.runId } : null;
	});
};
