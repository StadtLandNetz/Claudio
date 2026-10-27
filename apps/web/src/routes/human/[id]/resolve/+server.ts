import { error, json } from '@sveltejs/kit';
import { answerHumanRequest, closeHumanRequest, getHumanRequest } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';
import { accountProvider } from '#lib/server/i18n.js';

/**
 * The person is done (resolved) or gives up (cancelled); the worker continues the run
 * either way. For a question of the agent, `answer` carries the reply.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { t } = serverI18n(locals.locale, accountProvider(locals.user));
	const req = await getHumanRequest(db(), Number(params.id));
	if (!req) error(404, t('common.unknownRequest'));
	await requireRepo(locals.user, req.repoId, 'write');
	const body = (await request.json().catch(() => ({}))) as { status?: string; answer?: unknown };
	const status = body.status === 'cancelled' ? 'cancelled' : 'resolved';
	const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
	if (req.kind === 'question' && status === 'resolved') {
		if (!answer) error(400, t('common.answerMissing'));
		await answerHumanRequest(db(), req.id, answer, locals.user!.id);
		return json({ ok: true, status });
	}
	await closeHumanRequest(db(), req.id, status, locals.user!.id);
	return json({ ok: true, status });
};
