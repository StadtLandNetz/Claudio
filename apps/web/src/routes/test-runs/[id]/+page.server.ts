import { error } from '@sveltejs/kit';
import { describeStep, resolveStepTemplates, sortBySeverity, repoPath } from '@claudio/core';
import { countEvents, getTestRun, openHumanRequest, requestTestRunAbort } from '@claudio/db';
import type { AccessLevel } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { serverI18n } from '#lib/i18n/index.js';
import { fileAvailability, runFileUrl, withAvailability } from '#lib/server/run-files.js';
import { TRACE_INDEX_PATH, viewerAvailable } from '#lib/server/trace.js';
import type { Actions, PageServerLoad } from './$types';

async function loadRun(idParam: string, locals: App.Locals, min: AccessLevel = 'read') {
	const user = locals.user;
	const id = Number(idParam);
	const run = Number.isInteger(id) ? await getTestRun(db(), id) : undefined;
	if (!run) error(404, serverI18n(locals.locale, locals.user?.provider).t('test.runNotFound'));
	// Visible only with access to its repository on GitHub.
	await requireRepo(user, run.repoId, min);
	return run;
}

/** Same tag the runner used for {{run}}, so the page shows the actual test data. */
const runTagOf = (runId: string) => runId.split('-').slice(-2).join('');

export const load: PageServerLoad = async ({ params, locals }) => {
	const run = await loadRun(params.id, locals, 'read');
	const eventCount = await countEvents(db(), { testRunId: run.id });
	const r = run.report;
	const tplCtx = r ? { runTag: runTagOf(r.runId), now: new Date(r.createdAt) } : null;
	// The whole trace stays only in the (ephemeral) run directory: offered for download while it is there.
	// The timeline also works from the worker's copy in the database, kept like the screenshots.
	const available = await fileAvailability(r?.runId);
	return {
		viewerAvailable: viewerAvailable(),
		run: {
			id: run.id,
			scriptId: run.scriptId,
			scriptName: run.scriptName,
			repo: run.repoFullName,
			repoPath: repoPath({ provider: run.repoProvider, fullName: run.repoFullName }),
			status: run.status,
			outcome: run.outcome,
			healed: run.healed,
			instanceUrl: run.instanceUrl,
			budget: run.request.budget,
			viewport: run.request.viewport ?? 'desktop',
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
					runId: r.runId,
					traceUrl: available('trace.zip') ? runFileUrl(r.runId, 'trace.zip') : null,
					timeline: available('trace.zip') || available(TRACE_INDEX_PATH),
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
					evidence: (await withAvailability(r.runId, r.evidence.filter((e) => e.path && e.kind === 'screenshot'))).map((e) => ({
						id: e.id,
						label: e.label,
						url: e.url,
						expired: e.expired,
						kind: e.kind,
						viewport: e.viewport,
						note: e.note ?? '',
						createdAt: e.createdAt
					})),
					findings: sortBySeverity(r.findings),
					cost: r.cost,
					errors: r.errors
				}
			: null,
		eventCount,
		human: await openHumanRequest(db(), 'test', run.id).then((h) => (h ? { id: h.id, reason: h.reason, kind: h.kind, context: h.context, options: h.options ?? [] } : null))
	};
};

export const actions: Actions = {
	abort: async ({ params, locals }) => {
		const run = await loadRun(params.id, locals, 'write');
		await requestTestRunAbort(db(), run.id);
		return { aborted: true };
	}
};
