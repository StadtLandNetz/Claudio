import { error } from '@sveltejs/kit';
import { serverI18n } from '#lib/i18n/index.js';
import { requireRunAccess } from '#lib/server/run-files.js';
import { openRunTrace } from '#lib/server/trace.js';
import type { RequestHandler } from './$types';

const FRAME = /^page@[0-9a-f]{1,64}-\d{1,16}\.jpeg$/;

/** One screencast frame out of the trace archive. Frames never change, so the browser may keep them. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { t } = serverI18n(locals.locale, locals.user?.provider);
	if (!FRAME.test(params.file)) error(404, t('common.fileNotFound'));
	await requireRunAccess(locals, params.runId);
	const trace = await openRunTrace(params.runId);
	const frame = trace && (await trace.frame(params.file));
	if (!frame) error(404, t('common.fileNotFound'));
	return new Response(new Uint8Array(frame), {
		headers: {
			'content-type': 'image/jpeg',
			'content-length': String(frame.length),
			'cache-control': 'private, max-age=86400, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
