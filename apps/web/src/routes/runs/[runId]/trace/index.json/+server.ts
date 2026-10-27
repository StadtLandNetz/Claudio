import { error, json } from '@sveltejs/kit';
import { serverI18n } from '#lib/i18n/index.js';
import { requireRunAccess } from '#lib/server/run-files.js';
import { openRunTrace } from '#lib/server/trace.js';
import type { RequestHandler } from './$types';
import { accountProvider } from '#lib/server/i18n.js';

/** The compact index of a run's Playwright trace, for the timeline. 404 while the trace is not there. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { t } = serverI18n(locals.locale, accountProvider(locals.user));
	await requireRunAccess(locals, params.runId);
	const trace = await openRunTrace(params.runId);
	if (!trace) error(404, t('common.fileNotFound'));
	return json(await trace.index(), {
		headers: { 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }
	});
};
