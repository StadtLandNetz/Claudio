import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AnalysisRequestSchema, KNOWLEDGE_DOCS, LoginStepSchema, TestRunRequestSchema, parseHostList } from '@claudio/core';
import {
	type AccessLevel,
	createAnalysis,
	createTestRuns,
	createTestScript,
	deleteRole,
	dismissedFindingIds,
	getUser,
	latestKnowledge,
	listAnalyses,
	listReviews,
	listRoles,
	listTestRuns,
	listTestScripts,
	removeLesson,
	deleteLearning,
	listLearnings,
	LEARNINGS_IN_PROMPT,
	removeRepo,
	repoAnthropicKey,
	setAnthropicKey,
	roleUsername,
	saveRole,
	setWebhook,
	testResultsByReview,
	updateAutomation,
	updateRepoSettings
} from '@claudio/db';
import { atLeast, requireRepo, visibleRepos } from '#lib/server/access.js';
import { NO_KEY_MESSAGE, checkAnthropicKey, keyOptional } from '#lib/server/anthropic.js';
import { userToken } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { DEMO_FIXTURE, DEMO_REPO, demoPullRequest } from '#lib/server/demo.js';
import { WEBHOOK_EVENTS, addWebhookEvents, createGithubClient, createRepoWebhook, deleteRepoWebhook, getBranchHead, getRepoWebhook, listEnvironmentNames } from '@claudio/github';
import { DEFAULT_AUTOMATION, DEFAULT_AUTO_REVIEW } from '#lib/server/automation.js';
import { publicBaseUrl } from '#lib/server/env.js';
import { renderMarkdown } from '#lib/markdown.js';
import { devFixtures } from '#lib/server/env.js';
import { githubErrorMessage, listOpenPulls, type GithubPull } from '#lib/server/github.js';
import { summarize } from '#lib/server/summary.js';
import type { Actions, PageServerLoad } from './$types';

/** The repo of this page, if the user has at least `min` access on GitHub (404 / 403 otherwise). */
async function loadRepo(params: { owner: string; name: string }, user: App.Locals['user'], min: AccessLevel = 'read') {
	return (await requireRepo(user, `${params.owner}/${params.name}`, min)).repo;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { repo, level } = await requireRepo(locals.user, `${params.owner}/${params.name}`, 'read');
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

	// Webhook health, shown in the settings.
	let webhook: { id: number; ok: boolean | null; status: string; by: string | null } | null = null;
	if (repo.webhookId) {
		const owner = repo.automationUserId ? await getUser(db(), repo.automationUserId) : undefined;
		const token = await userToken(locals.user!);
		const info = token && !isDemo ? await getRepoWebhook(createGithubClient(token), repo.fullName, repo.webhookId).catch(() => null) : null;
		const code = info?.lastResponse?.code ?? null;
		webhook = {
			id: repo.webhookId,
			ok: code === null ? null : code >= 200 && code < 300,
			status: info ? (code ? `Letzte Zustellung: HTTP ${code}${info.lastResponse?.message ? ` (${info.lastResponse.message})` : ''}` : 'Noch keine Zustellung') : 'Status nicht abrufbar',
			by: owner?.login ?? null
		};
	}
	const base = publicBaseUrl(url);

	// GitHub environments, suggested for the review instances (settings tab only).
	let environments: string[] = [];
	if (url.searchParams.get('tab') === 'settings' && !isDemo && level === 'admin') {
		const token = await userToken(locals.user!);
		if (token) environments = await listEnvironmentNames(createGithubClient(token), repo.fullName).catch(() => []);
	}

	// Anthropic key: status, and other repos (where this user is admin) whose key can be copied over.
	const keySetBy = repo.anthropicKeySetBy ? await getUser(db(), repo.anthropicKeySetBy) : undefined;
	let keySources: { fullName: string; hint: string }[] = [];
	if (level === 'admin') {
		const { repos: visible, levels } = await visibleRepos(locals.user!);
		keySources = visible
			.filter((r) => r.id !== repo.id && r.anthropicKeyEnc && atLeast(levels.get(r.id) ?? 'none', 'admin'))
			.map((r) => ({ fullName: r.fullName, hint: r.anthropicKeyHint ?? '' }));
	}

	const tab = url.searchParams.get('tab');
	return {
		repo: {
			fullName: repo.fullName,
			isPrivate: repo.isPrivate,
			notes: repo.notes ?? '',
			extraAllowedHosts: repo.extraAllowedHosts,
			dataConfirmed: repo.dataConfirmed,
			defaultInstanceUrl: repo.defaultInstanceUrl ?? '',
			defaultBranch: repo.defaultBranch
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
		anthropicKey: repo.anthropicKeyEnc
			? { hint: repo.anthropicKeyHint ?? '', by: keySetBy?.login ?? null, at: repo.anthropicKeySetAt }
			: null,
		keyOptional: keyOptional(repo),
		keySources,
		automation: repo.automation ?? DEFAULT_AUTOMATION,
		autoReview: repo.autoReview ?? DEFAULT_AUTO_REVIEW,
		webhook,
		webhookUrl: `${base}/webhooks/github`,
		environments,
		localBaseUrl: /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(base),
		lessons: repo.lessons ?? [],
		learningsInPrompt: LEARNINGS_IN_PROMPT,
		learnings: (await listLearnings(db(), repo.id)).map((l) => {
			const kind = { review: ['reviews', 'Review'], analysis: ['analyses', 'Analyse'], test: ['test-runs', 'Testlauf'] }[l.runKind];
			return { id: l.id, text: l.text, at: l.createdAt, source: `${kind[1]} #${l.runRefId}`, href: `/${kind[0]}/${l.runRefId}` };
		}),
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
		level,
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
	settings: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const defaultInstanceUrl = text(f.get('defaultInstanceUrl'));
		if (defaultInstanceUrl && !URL.canParse(defaultInstanceUrl)) return fail(400, { error: 'Die Standard-URL ist keine gültige Adresse.', form: 'settings' });
		const hosts = parseHostList(text(f.get('extraAllowedHosts')));
		await updateRepoSettings(db(), repo.id, {
			notes: text(f.get('notes')) || null,
			extraAllowedHosts: hosts,
			dataConfirmed: f.get('dataConfirmed') === 'on',
			defaultInstanceUrl: defaultInstanceUrl || null
		});
		return { saved: 'settings' };
	},

	role: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
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

	deleteRole: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		await deleteRole(db(), repo.id, text((await request.formData()).get('name')));
		return { saved: 'deleted' };
	},

	analyze: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'write');
		const roles = await listRoles(db(), repo.id);
		if (!repo.dataConfirmed || roles.length === 0) return fail(400, { error: 'Richte zuerst Rollen und die Datenschutz-Bestätigung ein.', form: 'analyze' });
		if (!repo.anthropicKeyEnc && !keyOptional(repo)) return fail(400, { error: NO_KEY_MESSAGE, form: 'analyze' });
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
		const repo = await loadRepo(params, locals.user, 'write');
		const f = await request.formData();
		const input = {
			name: text(f.get('name')),
			description: text(f.get('description')),
			expectation: text(f.get('expectation')),
			roles: f.getAll('roles').map(String),
			runInReviews: f.get('runInReviews') === 'on',
			allowedHosts: parseHostList(text(f.get('allowedHosts'))),
			allowAnyHost: f.get('allowAnyHost') === 'on'
		};
		if (!input.name || !input.description || !input.expectation) {
			return fail(400, { error: 'Name, Ablauf und erwartetes Ergebnis sind Pflicht.', form: 'createTest' });
		}
		const id = await createTestScript(db(), repo.id, input, locals.user!.id);
		redirect(303, `/tests/${id}?new=1`);
	},

	runTests: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'write');
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

	automation: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const template = text(f.get('instanceUrlTemplate'));
		if (template && !URL.canParse(template.replace(/\{[a-z_]+\}/g, 'x'))) {
			return fail(400, { error: 'Die URL-Vorlage ergibt keine gültige Adresse.', form: 'automation' });
		}
		const pick = <T extends string>(v: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T =>
			(allowed as readonly string[]).includes(String(v)) ? (String(v) as T) : fallback;
		await updateAutomation(
			db(),
			repo.id,
			{
				instanceUrlTemplate: template,
				onComment: f.get('onComment') === 'on',
				onLabel: f.get('onLabel') === 'on',
				onPush: f.get('onPush') === 'on',
				analyzeOnMerge: f.get('analyzeOnMerge') === 'on',
				commitStatus: f.get('commitStatus') === 'on',
				deploymentEnvironment: text(f.get('deploymentEnvironment'))
			},
			{
				roles: f.getAll('autoRoles').map(String),
				budget: pick(f.get('autoBudget'), ['quick', 'standard', 'thorough'] as const, 'standard'),
				strictness: pick(f.get('autoStrictness'), ['lenient', 'normal', 'strict'] as const, 'normal'),
				postComment: f.get('autoComment') === 'on',
				runTests: f.get('autoTests') === 'on'
			}
		);
		// Webhooks set up before deployments were supported do not send deployment events yet.
		if (text(f.get('deploymentEnvironment')) && repo.webhookId) {
			const token = await userToken(locals.user!);
			const github = token ? createGithubClient(token) : null;
			const hook = github ? await getRepoWebhook(github, repo.fullName, repo.webhookId).catch(() => null) : null;
			if (github && hook && !WEBHOOK_EVENTS.every((e) => hook.events.includes(e))) {
				await addWebhookEvents(github, repo.fullName, repo.webhookId).catch(() => undefined);
			}
		}
		return { saved: 'automation' };
	},

	installWebhook: async ({ params, locals, url }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const token = await userToken(locals.user!);
		if (!token) return fail(400, { error: 'Zum Einrichten brauchst du eine Anmeldung mit GitHub.', form: 'webhook' });
		const secret = randomUUID() + randomUUID();
		const github = createGithubClient(token);
		try {
			if (repo.webhookId) await deleteRepoWebhook(github, repo.fullName, repo.webhookId);
			const id = await createRepoWebhook(github, repo.fullName, `${publicBaseUrl(url)}/webhooks/github`, secret);
			await setWebhook(db(), repo.id, { webhookId: id, secret, userId: locals.user!.id });
		} catch (e) {
			const status = (e as { status?: number }).status;
			return fail(400, {
				error: status === 404 || status === 403 ? 'GitHub erlaubt das nicht: Für Webhooks brauchst du Admin-Rechte am Repository.' : `GitHub hat abgelehnt: ${(e as Error).message}`,
				form: 'webhook'
			});
		}
		return { saved: 'webhook' };
	},

	removeWebhook: async ({ params, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const token = await userToken(locals.user!);
		if (repo.webhookId && token) await deleteRepoWebhook(createGithubClient(token), repo.fullName, repo.webhookId).catch(() => undefined);
		await setWebhook(db(), repo.id, null);
		return { saved: 'webhook-removed' };
	},

	setKey: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const source = text(f.get('source'));
		let key = text(f.get('key'));
		if (source) {
			// Copy from another repository, only if the user is admin there too.
			const { repo: from } = await requireRepo(locals.user, source, 'admin');
			key = repoAnthropicKey(from) ?? '';
			if (!key) return fail(400, { error: `In ${from.fullName} ist kein Key hinterlegt.`, form: 'key' });
		}
		if (!key) return fail(400, { error: 'Trage einen Key ein oder wähle ein Repository, aus dem er übernommen wird.', form: 'key' });
		const check = await checkAnthropicKey(key);
		if (!check.ok && !(check.unverified && f.get('force') === 'on')) {
			return fail(400, { error: check.reason, unverified: check.unverified ?? false, form: 'key' });
		}
		await setAnthropicKey(db(), repo.id, key, locals.user!.id);
		return { saved: 'key' };
	},

	removeKey: async ({ params, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		await setAnthropicKey(db(), repo.id, null, locals.user!.id);
		return { saved: 'key-removed' };
	},

	removeLearning: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'write');
		const f = await request.formData();
		await deleteLearning(db(), repo.id, Number(f.get('id')));
		return { saved: 'learning' };
	},

	removeLesson: async ({ params, request, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		await removeLesson(db(), repo.id, { reviewId: Number(f.get('reviewId')), findingId: text(f.get('findingId')) });
		return { saved: 'lesson' };
	},

	remove: async ({ params, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const [reviews, analyses] = await Promise.all([listReviews(db(), { repoId: repo.id, limit: 1 }), listAnalyses(db(), { repoId: repo.id, limit: 1 })]);
		if (reviews.length > 0 || analyses.length > 0) {
			return fail(400, { error: 'Repositories mit Reviews oder Analysen bleiben erhalten, damit Prüfprotokolle und Wissensbasis nicht verloren gehen.', form: 'remove' });
		}
		await removeRepo(db(), repo.id);
		redirect(303, '/repos');
	}
};
