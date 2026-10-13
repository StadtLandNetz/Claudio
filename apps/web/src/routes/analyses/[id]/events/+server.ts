import { error } from '@sveltejs/kit';
import { getAnalysis } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { runEventStream } from '#lib/server/sse.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	const id = Number(params.id);
	const item = Number.isInteger(id) ? await getAnalysis(db(), id) : undefined;
	if (!item) error(404, 'Diese Analyse gibt es nicht.');
	await requireRepo(locals.user, item.repoId, 'read');
	return runEventStream(request, url, { analysisId: id }, async () => (await getAnalysis(db(), id))?.status ?? null);
};
