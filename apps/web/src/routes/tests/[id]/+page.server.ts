import { error, fail, redirect } from '@sveltejs/kit';
import { DeterminismSchema, TestRunRequestSchema, describeStep, parseHostList } from '@claudio/core';
import {
	createTestRun,
	deleteTestScript,
	getRepoById,
	getTestScript,
	listRoles,
	listTestRuns,
	resetTestSteps,
	updateTestScript
} from '@claudio/db';
import { db } from '#lib/server/db.js';
import type { Actions, PageServerLoad } from './$types';

async function loadScript(idParam: string) {
	const id = Number(idParam);
	const script = Number.isInteger(id) ? await getTestScript(db(), id) : undefined;
	if (!script) error(404, 'Diesen Test gibt es nicht.');
	return script;
}

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();

export const load: PageServerLoad = async ({ params, url }) => {
	const script = await loadScript(params.id);
	const [repo, roles, runs] = await Promise.all([getRepoById(db(), script.repoId), listRoles(db(), script.repoId), listTestRuns(db(), { scriptId: script.id }, 50)]);
	return {
		script: {
			id: script.id,
			repo: script.repoFullName,
			name: script.name,
			description: script.description,
			expectation: script.expectation,
			roles: script.roles ?? [],
			determinism: script.determinism,
			runInReviews: script.runInReviews,
			allowedHosts: script.allowedHosts ?? [],
			allowAnyHost: script.allowAnyHost,
			stepsVersion: script.stepsVersion,
			stepsUpdatedAt: script.stepsUpdatedAt,
			steps: (script.steps ?? []).map((s) => ({ text: describeStep(s), assertion: s.action.startsWith('expect_') }))
		},
		roles: roles.map((r) => r.name),
		defaultInstanceUrl: repo?.defaultInstanceUrl ?? '',
		dataConfirmed: repo?.dataConfirmed ?? false,
		runs: runs.map((r) => ({
			id: r.id,
			status: r.status,
			outcome: r.outcome,
			mode: r.mode,
			healed: r.healed,
			stepsVersion: r.stepsVersion,
			costUsd: r.costUsd,
			durationMs: r.report?.cost.durationMs ?? null,
			reviewId: r.reviewId,
			startedBy: r.startedByLogin,
			createdAt: r.createdAt
		})),
		isNew: url.searchParams.has('new')
	};
};

export const actions: Actions = {
	update: async ({ params, request }) => {
		const script = await loadScript(params.id);
		const f = await request.formData();
		const determinism = DeterminismSchema.safeParse(f.get('determinism'));
		const input = {
			name: text(f.get('name')),
			description: text(f.get('description')),
			expectation: text(f.get('expectation')),
			roles: f.getAll('roles').map(String),
			runInReviews: f.get('runInReviews') === 'on',
			allowedHosts: parseHostList(text(f.get('allowedHosts'))),
			allowAnyHost: f.get('allowAnyHost') === 'on',
			determinism: determinism.success ? determinism.data : script.determinism
		};
		if (!input.name || !input.description || !input.expectation) return fail(400, { error: 'Name, Ablauf und erwartetes Ergebnis sind Pflicht.', form: 'update' });
		await updateTestScript(db(), script.id, input);
		return { saved: true };
	},
	run: async ({ params, request, locals }) => {
		const script = await loadScript(params.id);
		const repo = await getRepoById(db(), script.repoId);
		if (!repo?.dataConfirmed) return fail(400, { error: 'Bestätige zuerst in den Repo-Einstellungen, dass die Instanz nur Testdaten enthält.', form: 'run' });
		const f = await request.formData();
		const parsed = TestRunRequestSchema.safeParse({
			repo: script.repoFullName,
			instanceUrl: text(f.get('instanceUrl')),
			budget: f.get('budget'),
			rerecord: f.get('rerecord') === 'on'
		});
		if (!parsed.success) return fail(400, { error: 'Gib die vollständige Adresse einer laufenden Instanz an.', form: 'run' });
		const id = await createTestRun(db(), { scriptId: script.id, repoId: script.repoId, request: parsed.data, startedBy: locals.user!.id });
		redirect(303, `/test-runs/${id}`);
	},
	reset: async ({ params }) => {
		const script = await loadScript(params.id);
		await resetTestSteps(db(), script.id);
		return { saved: true };
	},
	delete: async ({ params }) => {
		const script = await loadScript(params.id);
		await deleteTestScript(db(), script.id);
		redirect(303, `/repos/${script.repoFullName}?tab=tests`);
	}
};
