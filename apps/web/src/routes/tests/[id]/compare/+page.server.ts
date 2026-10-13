import { error } from '@sveltejs/kit';
import { describeStep, resolveStepTemplates } from '@claudio/core';
import { getTestRun, getTestScript } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { runFileUrl } from '#lib/server/run-files.js';
import type { PageServerLoad } from './$types';

const runTagOf = (runId: string) => runId.split('-').slice(-2).join('');

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const script = await getTestScript(db(), Number(params.id));
	if (!script) error(404, 'Diesen Test gibt es nicht.');
	await requireRepo(locals.user, script.repoId, 'read');
	const ids = [Number(url.searchParams.get('a')), Number(url.searchParams.get('b'))];
	const runs = await Promise.all(ids.map((id) => (Number.isInteger(id) ? getTestRun(db(), id) : undefined)));
	if (runs.some((r) => !r || r.scriptId !== script.id)) error(404, 'Wähle zwei Läufe dieses Tests aus.');

	const view = runs.map((run) => {
		const r = run!.report;
		const ctx = r ? { runTag: runTagOf(r.runId), now: new Date(r.createdAt) } : null;
		const final = r?.evidence.find((e) => e.label === 'Endzustand' && e.path);
		return {
			id: run!.id,
			createdAt: run!.createdAt,
			status: run!.status,
			outcome: run!.outcome,
			healed: run!.healed,
			mode: run!.mode,
			stepsVersion: run!.stepsVersion,
			durationMs: r?.cost.durationMs ?? null,
			costUsd: run!.costUsd,
			judge: r?.judge ?? null,
			finalShot: r && final ? runFileUrl(r.runId, final.path!) : null,
			// Only executed steps line up between runs; discarded recording attempts would shift the rows.
			steps: (r?.steps ?? [])
				.filter((s) => s.ok || s.step.action.startsWith('expect_') || r?.mode === 'replay')
				.map((s) => ({ text: describeStep(ctx ? resolveStepTemplates(s.step, ctx) : s.step), ok: s.ok, error: s.error ?? null, durationMs: s.durationMs }))
		};
	});

	const rows = Array.from({ length: Math.max(view[0]!.steps.length, view[1]!.steps.length) }, (_, i) => ({
		a: view[0]!.steps[i] ?? null,
		b: view[1]!.steps[i] ?? null
	}));
	return { script: { id: script.id, name: script.name, repo: script.repoFullName }, a: view[0]!, b: view[1]!, rows };
};
