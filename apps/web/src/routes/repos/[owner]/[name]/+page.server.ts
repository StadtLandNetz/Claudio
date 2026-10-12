import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AnalysisRequestSchema, KNOWLEDGE_DOCS, LoginStepSchema, TestRunRequestSchema } from '@claudio/core';
import {
	createAnalysis,
	createTestRuns,
	createTestScript,
	deleteRole,
	dismissedFindingIds,
	getRepo,
	latestKnowledge,
	listAnalyses,
	listReviews,
	listRoles,
	listTestRuns,
	listTestScripts,
	testResultsByReview,
	removeRepo,
	roleUsername,
	saveRole,
	updateRepoSettings
} from '@claudio/db';
import { userToken } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { DEMO_FIXTURE, DEMO_REPO, demoPullRequest } from '#lib/server/demo.js';
import { createGithubClient, getBranchHead } from '@claudio/github';
import { renderMarkdown } from '#lib/markdown.js';
import { devFixtures } from '#lib/server/env.js';
import { githubErrorMessage, listOpenPulls, type GithubPull } from '#lib/server/github.js';
import { summarize } from '#lib/server/summary.js';
import type { Actions, PageServerLoad } from './$types';

async function loadRepo(params: { owner: string; name: string }) {
	const repo = await getRepo(db(), `${params.owner}/${params.name}`);
	if (!repo) error(404, 'Dieses Repository ist in Claudio nicht eingerichtet.');
	return repo;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const repo = await loadRepo(params);
	const [roles, reviews] = await Promise.all([listRoles(db(), repo.id), listReviews(db(), { repoId: repo.id, limit: 100 })]);
	const [dismissed, reviewTests] = await Promise.all([
		dismissedFindingIds(db(), reviews.map((r) => r.id)),
		testResultsByReview(db(), reviews.map((r) => r.id))
	]);

	let pulls: (GithubPull & { fixture?: boolean })[] = [];
	let pullsError: string | null = null;
	if (repo.fullName === DEMO_REPO && devFixtures()) {
		const pr = demoPullRequest();
		pulls = [
			{ number: pr.number, title: pr.title, author: pr.author ?? null, headRef: pr.headRef, draft: false, updatedAt: new Date().toISOString(), url: pr.url, fixture: true }
		];
	} else {
		const token = await userToken(locals.user!);
		if (!token) pullsError = 'Ohne GitHub-Anmeldung kann Claudio keine Pull Requests laden.';
		else
			try {
				pulls = await listOpenPulls(token, repo.fullName);
			} catch (e) {
				pullsError = githubErrorMessage(e);
			}
	}

	const isDemo = repo.fullName === DEMO_REPO && devFixtures();
	const [knowledge, analyses] = await Promise.all([latestKnowledge(db(), repo.id), listAnalyses(db(), { repoId: repo.id, limit: 20 })]);

	// Is the knowledge base older than the head of the analysed branch?
	let headSha: string | null = null;
	if (knowledge && !isDemo && knowledge.branch) {
		const token = await userToken(locals.user!);
		if (token) headSha = await getBranchHead(createGithubClient(token), repo.fullName, knowledge.branch).catch(() => null);
	}

	const batchId = url.searchParams.get('batch');
	const [tests, activeTestRuns, batchRuns] = await Promise.all([
		listTestScripts(db(), repo.id),
		listTestRuns(db(), { repoId: repo.id, activeOnly: true }, 100),
		batchId ? listTestRuns(db(), { batchId, repoId: repo.id }, 200) : Promise.resolve([])
	]);

	const tab = url.searchParams.get('tab');
	return {
		repo: {
			fullName: repo.fullName,
			isPrivate: repo.isPrivate,
			notes: repo.notes ?? '',
			extraAllowedHosts: repo.extraAllowedHosts,
			dataConfirmed: repo.dataConfirmed,
			defaultInstanceUrl: repo.defaultInstanceUrl ?? ''
		},
		roles: roles.map((r) => ({
			name: r.name,
			description: r.description ?? '',
			username: roleUsername(r),
			loginPath: r.loginPath,
			successUrlContains: r.successUrlContains ?? '',
			recipe: r.recipe ? JSON.stringify(r.recipe, null, 2) : ''
		})),
		reviews: reviews.map((r) => summarize(r, dismissed.get(r.id), undefined, reviewTests.get(r.id))),
		pulls,
		pullsError,
		knowledge: knowledge
			? {
					analysisId: knowledge.analysisId,
					commitSha: knowledge.commitSha,
					branch: knowledge.branch,
					analyzedAt: knowledge.analyzedAt,
					startedBy: knowledge.startedByLogin,
					complete: knowledge.status === 'completed',
					stale: headSha !== null && headSha !== knowledge.commitSha,
					headSha,
					docs: knowledge.docs.map((d) => ({ name: d.name, title: KNOWLEDGE_DOCS[d.name].title, html: renderMarkdown(d.content), chars: d.content.length }))
				}
			: null,
		analyses: analyses.map((a) => ({
			id: a.id,
			status: a.status,
			commitSha: a.commitSha,
			costUsd: a.costUsd,
			docCount: a.docCount,
			startedBy: a.startedByLogin,
			createdAt: a.createdAt
		})),
		tests: tests.map((t) => ({
			id: t.id,
			name: t.name,
			determinism: t.determinism,
			stepCount: t.steps?.length ?? 0,
			runInReviews: t.runInReviews,
			lastOutcome: t.lastOutcome,
			lastStatus: t.lastStatus,
			lastRunAt: t.lastRunAt,
			lastHealed: t.lastHealed
		})),
		activeTestRuns: activeTestRuns.length,
		batch: batchId
			? batchRuns.map((r) => ({ id: r.id, scriptName: r.scriptName, status: r.status, outcome: r.outcome, healed: r.healed, mode: r.mode, costUsd: r.costUsd }))
			: null,
		tab: tab === 'settings' || tab === 'reviews' || tab === 'knowledge' || tab === 'tests' ? tab : 'pulls',
		isNew: url.searchParams.has('new')
	};
};

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();

const RoleForm = z.object({
	name: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'Rollenname: Kleinbuchstaben, Ziffern, - oder _, beginnt mit einem Buchstaben.'),
	description: z.string().max(300),
	username: z.string().max(300),
	password: z.string().max(300),
	loginPath: z.string().regex(/^\//, 'Der Login-Pfad beginnt mit /.'),
	successUrlContains: z.string().max(300),
	recipe: z.string()
});

export const actions: Actions = {
	settings: async ({ params, request }) => {
		const repo = await loadRepo(params);
		const f = await request.formData();
		const defaultInstanceUrl = text(f.get('defaultInstanceUrl'));
		if (defaultInstanceUrl && !URL.canParse(defaultInstanceUrl)) return fail(400, { error: 'Die Standard-URL ist keine gültige Adresse.', form: 'settings' });
		const hosts = text(f.get('extraAllowedHosts'))
			.split(/[\s,]+/)
			.map((h) => h.trim())
			.filter(Boolean);
		await updateRepoSettings(db(), repo.id, {
			notes: text(f.get('notes')) || null,
			extraAllowedHosts: hosts,
			dataConfirmed: f.get('dataConfirmed') === 'on',
			defaultInstanceUrl: defaultInstanceUrl || null
		});
		return { saved: 'settings' };
	},

	role: async ({ params, request }) => {
		const repo = await loadRepo(params);
		const f = await request.formData();
		const parsed = RoleForm.safeParse(Object.fromEntries(['name', 'description', 'username', 'password', 'loginPath', 'successUrlContains', 'recipe'].map((k) => [k, text(f.get(k))])));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Eingaben prüfen.', form: 'role' });
		const v = parsed.data;
		let recipe = null;
		if (v.recipe) {
			try {
				recipe = z.array(LoginStepSchema).parse(JSON.parse(v.recipe));
			} catch {
				return fail(400, { error: 'Das Login-Rezept ist kein gültiges JSON-Array aus Login-Schritten.', form: 'role' });
			}
		}
		try {
			await saveRole(db(), repo.id, {
				name: v.name,
				description: v.description || null,
				username: v.username || undefined,
				password: v.password || undefined,
				loginPath: v.loginPath,
				successUrlContains: v.successUrlContains || null,
				recipe
			});
		} catch (e) {
			return fail(400, { error: (e as Error).message, form: 'role' });
		}
		return { saved: `role:${v.name}` };
	},

	deleteRole: async ({ params, request }) => {
		const repo = await loadRepo(params);
		await deleteRole(db(), repo.id, text((await request.formData()).get('name')));
		return { saved: 'deleted' };
	},

	analyze: async ({ params, request, locals }) => {
		const repo = await loadRepo(params);
		const roles = await listRoles(db(), repo.id);
		if (!repo.dataConfirmed || roles.length === 0) return fail(400, { error: 'Richte zuerst Rollen und die Datenschutz-Bestätigung ein.', form: 'analyze' });
		if ((await listAnalyses(db(), { repoId: repo.id, activeOnly: true })).length > 0) {
			return fail(400, { error: 'Für dieses Repository läuft schon eine Analyse.', form: 'analyze' });
		}
		const f = await request.formData();
		const fixture = repo.fullName === DEMO_REPO && devFixtures() ? DEMO_FIXTURE : null;
		const parsed = AnalysisRequestSchema.safeParse({
			repo: repo.fullName,
			instanceUrl: text(f.get('instanceUrl')),
			roles: f.getAll('roles').map(String),
			budget: f.get('budget'),
			language: 'de',
			extraInstructions: text(f.get('extraInstructions')) || undefined
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return fail(400, { error: issue?.path[0] === 'instanceUrl' ? 'Gib die vollständige Adresse einer laufenden Instanz an.' : (issue?.message ?? 'Eingaben prüfen.'), form: 'analyze' });
		}
		if (!fixture && !(await userToken(locals.user!))) return fail(400, { error: 'Zum Lesen des Codes brauchst du eine Anmeldung mit GitHub.', form: 'analyze' });
		const id = await createAnalysis(db(), { repoId: repo.id, request: parsed.data, fixture, startedBy: locals.user!.id });
		redirect(303, `/analyses/${id}`);
	},

	createTest: async ({ params, request, locals }) => {
		const repo = await loadRepo(params);
		const f = await request.formData();
		const input = {
			name: text(f.get('name')),
			description: text(f.get('description')),
			expectation: text(f.get('expectation')),
			roles: f.getAll('roles').map(String),
			runInReviews: f.get('runInReviews') === 'on'
		};
		if (!input.name || !input.description || !input.expectation) {
			return fail(400, { error: 'Name, Ablauf und erwartetes Ergebnis sind Pflicht.', form: 'createTest' });
		}
		const id = await createTestScript(db(), repo.id, input, locals.user!.id);
		redirect(303, `/tests/${id}?new=1`);
	},

	runTests: async ({ params, request, locals }) => {
		const repo = await loadRepo(params);
		if (!repo.dataConfirmed) return fail(400, { error: 'Bestätige zuerst in den Einstellungen, dass die Instanz nur Testdaten enthält.', form: 'runTests' });
		const f = await request.formData();
		const parsed = TestRunRequestSchema.safeParse({ repo: repo.fullName, instanceUrl: text(f.get('instanceUrl')), budget: f.get('budget') });
		if (!parsed.success) return fail(400, { error: 'Gib die vollständige Adresse einer laufenden Instanz an.', form: 'runTests' });
		const scripts = await listTestScripts(db(), repo.id);
		if (scripts.length === 0) return fail(400, { error: 'Es gibt noch keine Tests.', form: 'runTests' });
		const batchId = randomUUID().slice(0, 8);
		await createTestRuns(
			db(),
			scripts.map((s) => ({ scriptId: s.id, repoId: repo.id, request: parsed.data, batchId, startedBy: locals.user!.id }))
		);
		redirect(303, `/repos/${repo.fullName}?tab=tests&batch=${batchId}`);
	},

	remove: async ({ params }) => {
		const repo = await loadRepo(params);
		const [reviews, analyses] = await Promise.all([listReviews(db(), { repoId: repo.id, limit: 1 }), listAnalyses(db(), { repoId: repo.id, limit: 1 })]);
		if (reviews.length > 0 || analyses.length > 0) {
			return fail(400, { error: 'Repositories mit Reviews oder Analysen bleiben erhalten, damit Prüfprotokolle und Wissensbasis nicht verloren gehen.', form: 'remove' });
		}
		await removeRepo(db(), repo.id);
		redirect(303, '/repos');
	}
};
