import { error } from '@sveltejs/kit';
import { KNOWLEDGE_DOCS, sortBySeverity } from '@claudio/core';
import { countEvents, getAnalysis, knowledgeDocsOf, openHumanRequest, requestAnalysisAbort } from '@claudio/db';
import type { AccessLevel } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { runEvidenceFromDisk, runFindingsFromDisk, withAvailability } from '#lib/server/run-files.js';
import { renderMarkdown } from '#lib/markdown.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';

async function loadAnalysis(idParam: string, locals: App.Locals, min: AccessLevel = 'read') {
	const id = Number(idParam);
	const analysis = Number.isInteger(id) ? await getAnalysis(db(), id) : undefined;
	if (!analysis) error(404, serverI18n(locals.locale).t('analysis.notFound'));
	// Visible only with access to its repository on GitHub.
	await requireRepo(locals.user, analysis.repoId, min);
	return analysis;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const a = await loadAnalysis(params.id, locals, 'read');
	const [eventCount, docs] = await Promise.all([countEvents(db(), { analysisId: a.id }), knowledgeDocsOf(db(), a.id)]);
	return {
		analysis: {
			id: a.id,
			repo: a.repoFullName,
			status: a.status,
			instanceUrl: a.instanceUrl,
			request: a.request,
			branch: a.branch,
			commitSha: a.commitSha,
			previousCommitSha: a.report?.previousCommitSha ?? null,
			summaryHtml: a.report?.summary ? renderMarkdown(a.report.summary) : '',
			cost: a.report?.cost ?? null,
			errors: a.report?.errors ?? (a.error ? [a.error] : []),
			startedBy: a.startedByLogin,
			createdAt: a.createdAt,
			finishedAt: a.finishedAt,
			abortRequested: a.abortRequested,
			fixture: a.fixture
		},
		docs: docs.map((d) => ({ name: d.name, title: KNOWLEDGE_DOCS[d.name].title, html: renderMarkdown(d.content), chars: d.content.length })),
		// Older analyses kept these only in the run directory.
		evidence: (await withAvailability(a.runId, a.report?.evidence ?? (a.runId ? runEvidenceFromDisk(a.runId) : []))).filter((e) => e.kind === 'screenshot'),
		findings: sortBySeverity(a.report?.findings ?? (a.runId ? runFindingsFromDisk(a.runId) : [])),
		eventCount,
		human: await openHumanRequest(db(), 'analysis', a.id).then((h) => (h ? { id: h.id, reason: h.reason, kind: h.kind, context: h.context, options: h.options ?? [] } : null))
	};
};

export const actions: Actions = {
	abort: async ({ params, locals }) => {
		const a = await loadAnalysis(params.id, locals, 'write');
		await requestAnalysisAbort(db(), a.id);
		return { aborted: true };
	}
};
