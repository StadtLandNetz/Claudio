import { error } from '@sveltejs/kit';
import { getTestRun } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { runEventStream } from '#lib/server/sse.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await getTestRun(db(), id))) error(404, 'Diesen Testlauf gibt es nicht.');
	return runEventStream(request, url, { testRunId: id }, async () => (await getTestRun(db(), id))?.status ?? null);
};
