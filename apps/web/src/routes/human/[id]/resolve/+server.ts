import { error, json } from '@sveltejs/kit';
import { closeHumanRequest, getHumanRequest } from '@claudio/db';
import { db } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

/** The person is done (resolved) or gives up (cancelled); the worker continues the run either way. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const req = await getHumanRequest(db(), Number(params.id));
	if (!req) error(404, 'Unbekannte Anfrage.');
	const body = (await request.json().catch(() => ({}))) as { status?: string };
	const status = body.status === 'cancelled' ? 'cancelled' : 'resolved';
	await closeHumanRequest(db(), req.id, status, locals.user!.id);
	return json({ ok: true, status });
};
