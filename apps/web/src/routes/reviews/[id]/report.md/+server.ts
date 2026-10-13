import { error } from '@sveltejs/kit';
import { StrictnessSchema, VerbositySchema, renderMarkdown } from '@claudio/core';
import { getReview, listFindings } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

/** The report as Markdown, with the strictness and verbosity chosen in the UI and without dismissed findings. */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const id = Number(params.id);
	const review = Number.isInteger(id) ? await getReview(db(), id) : undefined;
	if (!review?.report) error(404, 'Für diesen Review gibt es keinen Bericht.');
	await requireRepo(locals.user, review.repoId, 'read');
	const strictness = StrictnessSchema.catch(review.report.request.strictness).parse(url.searchParams.get('strictness'));
	const verbosity = VerbositySchema.catch(review.report.request.verbosity).parse(url.searchParams.get('verbosity'));
	const dismissedIds = (await listFindings(db(), review.id)).filter((r) => r.finding.status === 'dismissed').map((r) => r.finding.findingId);
	const markdown = renderMarkdown(review.report, verbosity, { strictness, dismissedIds });
	const name = `claudio-${review.repoFullName.replace('/', '-')}-pr${review.prNumber}-${verbosity}.md`;
	return new Response(markdown, {
		headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` }
	});
};
