import { error } from '@sveltejs/kit';
import { getTestRun } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { runEventStream } from '#lib/server/sse.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	const id = Number(params.id);
	const item = Number.isInteger(id) ? await getTestRun(db(), id) : undefined;
	if (!item) error(404, 'Diesen Testlauf gibt es nicht.');
	await requireRepo(locals.user, item.repoId, 'read');
	return runEventStream(request, url, { testRunId: id }, async () => (await getTestRun(db(), id))?.status ?? null);
};
