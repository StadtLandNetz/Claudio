import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { addHumanInput, getHumanRequest } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';
import { accountProvider } from '#lib/server/i18n.js';

const InputSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('click'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
	z.object({ type: z.literal('type'), text: z.string().min(1).max(500) }),
	z.object({ type: z.literal('key'), key: z.enum(['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) }),
	z.object({ type: z.literal('scroll'), dy: z.number().min(-2000).max(2000) })
]);

/** One click or keystroke from the live view; the worker replays it in the run's browser. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { t } = serverI18n(locals.locale, accountProvider(locals.user));
	const req = await getHumanRequest(db(), Number(params.id));
	if (!req) error(404, t('common.unknownRequest'));
	await requireRepo(locals.user, req.repoId, 'write');
	if (req.status !== 'open') error(409, t('common.requestClosed'));
	const parsed = InputSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, t('common.invalidInput'));
	await addHumanInput(db(), req.id, parsed.data, locals.user!.id);
	return json({ ok: true });
};
