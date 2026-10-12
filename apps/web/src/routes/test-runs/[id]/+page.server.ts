import { error } from '@sveltejs/kit';
import { describeStep, resolveStepTemplates, sortBySeverity } from '@claudio/core';
import { eventsSince, getTestRun, requestTestRunAbort } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { runFileUrl } from '#lib/server/run-files.js';
import type { Actions, PageServerLoad } from './$types';

async function loadRun(idParam: string) {
	const id = Number(idParam);
	const run = Number.isInteger(id) ? await getTestRun(db(), id) : undefined;
	if (!run) error(404, 'Diesen Testlauf gibt es nicht.');
	return run;
}

/** Same tag the runner used for {{run}}, so the page shows the actual test data. */
const runTagOf = (runId: string) => runId.split('-').slice(-2).join('');

export const load: PageServerLoad = async ({ params }) => {
	const run = await loadRun(params.id);
	const events = await eventsSince(db(), { testRunId: run.id }, 0, 5000);
	const r = run.report;
	const tplCtx = r ? { runTag: runTagOf(r.runId), now: new Date(r.createdAt) } : null;
	return {
		run: {
			id: run.id,
			scriptId: run.scriptId,
			scriptName: run.scriptName,
			repo: run.repoFullName,
			status: run.status,
			outcome: run.outcome,
			healed: run.healed,
			instanceUrl: run.instanceUrl,
			budget: run.request.budget,
			rerecord: run.request.rerecord,
			reviewId: run.reviewId,
			stepsVersion: run.stepsVersion,
			startedBy: run.startedByLogin,
			createdAt: run.createdAt,
			finishedAt: run.finishedAt,
			abortRequested: run.abortRequested,
			error: run.error
		},
		report: r
			? {
					mode: r.mode,
					summary: r.summary,
					healedAt: r.healedAt ?? null,
					judge: r.judge ?? null,
					finalUrl: r.finalUrl ?? '',
					savedSteps: r.compiledSteps?.length ?? 0,
					determinismProposal: r.determinismProposal ?? null,
					steps: r.steps.map((s) => ({
						index: s.index,
						text: describeStep(tplCtx ? resolveStepTemplates(s.step, tplCtx) : s.step),
						ok: s.ok,
						error: s.error ?? null,
						durationMs: s.durationMs,
						healed: s.healed,
						assertion: s.step.action.startsWith('expect_')
					})),
					evidence: r.evidence.filter((e) => e.path && e.kind === 'screenshot').map((e) => ({ id: e.id, label: e.label, url: runFileUrl(r.runId, e.path!) })),
					findings: sortBySeverity(r.findings),
					cost: r.cost,
					errors: r.errors
				}
			: null,
		events: events.map((e) => ({ seq: e.seq, line: e.line }))
	};
};

export const actions: Actions = {
	abort: async ({ params }) => {
		const run = await loadRun(params.id);
		await requestTestRunAbort(db(), run.id);
		return { aborted: true };
	}
};
