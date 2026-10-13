import { error } from '@sveltejs/kit';
import { KNOWLEDGE_DOCS, sortBySeverity } from '@claudio/core';
import { eventsSince, getAnalysis, knowledgeDocsOf, openHumanRequest, requestAnalysisAbort } from '@claudio/db';
import type { AccessLevel } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { runEvidenceFromDisk, runFindingsFromDisk, withAvailability } from '#lib/server/run-files.js';
import { renderMarkdown } from '#lib/markdown.js';
import type { Actions, PageServerLoad } from './$types';

async function loadAnalysis(idParam: string, user: App.Locals['user'], min: AccessLevel = 'read') {
	const id = Number(idParam);
	const analysis = Number.isInteger(id) ? await getAnalysis(db(), id) : undefined;
	if (!analysis) error(404, 'Diese Analyse gibt es nicht.');
	// Visible only with access to its repository on GitHub.
	await requireRepo(user, analysis.repoId, min);
	return analysis;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const a = await loadAnalysis(params.id, locals.user, 'read');
	const [events, docs] = await Promise.all([eventsSince(db(), { analysisId: a.id }, 0, 5000), knowledgeDocsOf(db(), a.id)]);
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
		events: events.map((e) => ({ seq: e.seq, line: e.line })),
		human: await openHumanRequest(db(), 'analysis', a.id).then((h) => (h ? { id: h.id, reason: h.reason } : null))
	};
};

export const actions: Actions = {
	abort: async ({ params, locals }) => {
		const a = await loadAnalysis(params.id, locals.user, 'write');
		await requestAnalysisAbort(db(), a.id);
		return { aborted: true };
	}
};
