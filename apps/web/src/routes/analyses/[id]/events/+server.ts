import { error } from '@sveltejs/kit';
import { getAnalysis } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { runEventStream } from '#lib/server/sse.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await getAnalysis(db(), id))) error(404, 'Diese Analyse gibt es nicht.');
	return runEventStream(request, url, { analysisId: id }, async () => (await getAnalysis(db(), id))?.status ?? null);
};
