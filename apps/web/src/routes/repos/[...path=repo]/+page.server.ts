import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AnalysisRequestSchema, KNOWLEDGE_DOCS, LoginStepSchema, TestRunRequestSchema, parseHostList, parseRepoPath, repoHref, repoPath } from '@claudio/core';
import {
	type AccessLevel,
	createAnalysis,
	createTestRuns,
	runsPerViewport,
	createTestScript,
	deleteRole,
	dismissedFindingIds,
	getUser,
	latestKnowledge,
	listAnalyses,
	listReviewDigests,
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
	updateRepoSettings,
	DEFAULT_NOTIFICATIONS,
	budgetState,
	parseBudget,
	setMonthlyBudget,
	isSlackWebhookUrl,
	postSlack,
	setSlack,
	slackWebhookUrl,
	testMessage
} from '@claudio/db';
import { atLeast, requireRepo, visibleRepos } from '#lib/server/access.js';
import { checkAnthropicKey, keyOptional, noKeyMessage } from '#lib/server/anthropic.js';
import { swr } from '#lib/server/cache.js';
import { budgetBlocks, viewportsOf } from '#lib/server/runs.js';
import { githubAppSlug, githubApp, gitlabBotStatus, installationFor, repoWebUrl, type ChangeSummary } from '@claudio/forge';
import { db } from '#lib/server/db.js';
import { DEMO_FIXTURE, DEMO_REPO, demoPullRequest } from '#lib/server/demo.js';
import { DEFAULT_AUTOMATION, DEFAULT_AUTO_REVIEW } from '#lib/server/automation.js';
import { publicBaseUrl } from '#lib/server/env.js';
import { renderMarkdown } from '#lib/markdown.js';
import { devFixtures } from '#lib/server/env.js';
import { forgeErrorMessage, userForge } from '#lib/server/forge.js';
import { summarize } from '#lib/server/summary.js';
import { loadOverview } from '#lib/server/overview.js';
import { type I18n, serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';

/** The repository a page path names (the route's matcher only lets valid paths through). */
const repoKey = (path: string) => parseRepoPath(path) ?? error(404);

/** The repo of this page, if the user has at least `min` access on GitHub or GitLab (404 / 403 otherwise). */
async function loadRepo(params: { path: string }, user: App.Locals['user'], min: AccessLevel = 'read') {
	return (await requireRepo(user, repoKey(params.path), min)).repo;
}

const TABS = ['overview', 'pulls', 'reviews', 'tests', 'knowledge', 'settings'] as const;
type Tab = (typeof TABS)[number];
const tabOf = (v: string | null): Tab => ((TABS as readonly string[]).includes(v ?? '') ? (v as Tab) : 'overview');
/** GitHub's answers are reused for a short while: switching tabs or coming back must not ask again. */
const FRESH_MS = 30_000;
const STALE_MS = 10 * 60_000;

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { t } = serverI18n(locals.locale, locals.user?.provider);
	const tab = tabOf(url.searchParams.get('tab'));
	const { repo, level } = await requireRepo(locals.user, repoKey(params.path), 'read');
	const isDemo = repo.fullName === DEMO_REPO && devFixtures();
	const settings = tab === 'settings' && level === 'admin';
	// Each tab loads only what it shows. GitHub or GitLab is asked only for that, and the answers are cached briefly.
	const forge = !isDemo && (tab === 'overview' || tab === 'pulls' || tab === 'knowledge' || settings) ? await userForge(locals.user, repo.provider) : null;
	const base = publicBaseUrl(url);
	const batchId = tab === 'tests' ? url.searchParams.get('batch') : null;

	const pullsP = (async (): Promise<{ pulls: (ChangeSummary & { fixture?: boolean })[]; error: string | null }> => {
		if (tab !== 'pulls') return { pulls: [], error: null };
		if (isDemo) {
			const pr = demoPullRequest();
			return {
				pulls: [{ number: pr.number, title: pr.title, author: pr.author ?? null, headRef: pr.headRef, draft: false, updatedAt: new Date().toISOString(), url: pr.url, fixture: true }],
				error: null
			};
		}
		if (!forge) return { pulls: [], error: t('repo.pullsNoToken') };
		try {
			return { pulls: await swr(`pulls:${repo.id}`, FRESH_MS, STALE_MS, () => forge.listOpenChanges(repo)), error: null };
		} catch (e) {
			return { pulls: [], error: forgeErrorMessage(e) };
		}
	})();
	const overviewP = tab === 'overview' ? loadOverview(repo, forge, isDemo, t('repo.pullsNoToken')) : Promise.resolve(null);
	const reviewsP = tab === 'reviews' ? listReviewDigests(db(), { repoId: repo.id, limit: 100 }) : Promise.resolve([]);
	const knowledgeP = tab === 'knowledge' ? latestKnowledge(db(), repo.id) : Promise.resolve(null);
	const analysesP = tab === 'knowledge' ? listAnalyses(db(), { repoId: repo.id, limit: 20 }) : Promise.resolve([]);
	const testsP = tab === 'tests' ? listTestScripts(db(), repo.id) : Promise.resolve([]);
	const activeRunsP = tab === 'tests' ? listTestRuns(db(), { repoId: repo.id, activeOnly: true }, 100) : Promise.resolve([]);
	const batchP = batchId ? listTestRuns(db(), { batchId, repoId: repo.id }, 200) : Promise.resolve([]);
	const keySetByP = settings && repo.anthropicKeySetBy ? getUser(db(), repo.anthropicKeySetBy) : Promise.resolve(undefined);
	const learningsP = settings ? listLearnings(db(), repo.id) : Promise.resolve([]);
	// Other repos (where this user is admin) whose key can be copied over.
	const keySourcesP = (async (): Promise<{ id: number; fullName: string; hint: string }[]> => {
		if (!settings) return [];
		const { repos: visible, levels } = await visibleRepos(locals.user!);
		return visible
			.filter((r) => r.id !== repo.id && r.anthropicKeyEnc && atLeast(levels.get(r.id) ?? 'none', 'admin'))
			.map((r) => ({ id: r.id, fullName: r.fullName, hint: r.anthropicKeyHint ?? '' }));
	})();
	// Webhook health, shown in the settings.
	const webhookP = (async (): Promise<{ id: number; ok: boolean | null; status: string; by: string | null } | null> => {
		if (!settings || !repo.webhookId) return null;
		const hookId = repo.webhookId;
		const [owner, info] = await Promise.all([
			repo.automationUserId ? getUser(db(), repo.automationUserId) : Promise.resolve(undefined),
			forge ? swr(`hook:${repo.id}:${hookId}`, FRESH_MS, STALE_MS, () => forge.getWebhook(repo, hookId)).catch(() => null) : Promise.resolve(null)
		]);
		const code = info?.lastDelivery?.code ?? null;
		return {
			id: hookId,
			ok: code === null ? null : code >= 200 && code < 300,
			status: info
				? code
					? t('repo.webhookLastDelivery', { code, detail: info.lastDelivery?.message ? ` (${info.lastDelivery.message})` : '' })
					: t('repo.webhookNoDelivery')
				: t('repo.webhookStatusUnavailable'),
			by: owner?.login ?? null
		};
	})();
	// Environments of the review instances, suggested in the settings tab.
	const envP = (async (): Promise<{ environments: string[]; suggested: string | null }> => {
		if (!settings || !forge) return { environments: [], suggested: null };
		const f = forge;
		return swr(`env:${repo.id}`, 60_000, STALE_MS, async () => {
			const [environments, suggested] = await Promise.all([f.listEnvironmentNames(repo).catch(() => []), f.suggestPreviewEnvironment(repo).catch(() => null)]);
			return { environments, suggested };
		});
	})();

	const [overview, roles, reviews, knowledge, analyses, tests, activeTestRuns, batchRuns, keySetBy, learnings, keySources, webhook, env, pulls] = await Promise.all([
		overviewP,
		listRoles(db(), repo.id),
		reviewsP,
		knowledgeP,
		analysesP,
		testsP,
		activeRunsP,
		batchP,
		keySetByP,
		learningsP,
		keySourcesP,
		webhookP,
		envP,
		pullsP
	]);
	const branch = knowledge?.branch ?? null;
	const [dismissed, reviewTests, headSha] = await Promise.all([
		dismissedFindingIds(db(), reviews.map((r) => r.id)),
		testResultsByReview(db(), reviews.map((r) => r.id)),
		// Is the knowledge base older than the head of the analysed branch?
		branch && !isDemo && forge ? swr(`head:${repo.id}:${branch}`, 60_000, STALE_MS, () => forge.getBranchHead(repo, branch)).catch(() => null) : Promise.resolve(null)
	]);

	return {
		repo: {
			fullName: repo.fullName,
			provider: repo.provider,
			path: repoPath(repo),
			webUrl: repoWebUrl(repo),
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
		overview,
		pulls: pulls.pulls,
		pullsError: pulls.error,
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
		autoReview: { ...DEFAULT_AUTO_REVIEW, ...(repo.autoReview ?? {}) },
		budget: await budgetState(db(), repo),
		gitlabBot: settings && repo.provider === 'gitlab' ? await gitlabBot(repo) : null,
		githubApp: settings && repo.provider === 'github' && githubApp() ? { installed: Boolean(await installationFor(repo.fullName).catch(() => null)), slug: githubAppSlug() } : null,
		slack: settings ? { hint: repo.slackWebhookHint, notifications: { ...DEFAULT_NOTIFICATIONS, ...(repo.notifications ?? {}) } } : null,
		webhook,
		webhookUrl: `${base}/webhooks/${repo.provider}`,
		environments: env.environments,
		suggestedEnvironment: env.suggested,
		localBaseUrl: /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(base),
		lessons: repo.lessons ?? [],
		learningsInPrompt: LEARNINGS_IN_PROMPT,
		learnings: learnings.map((l) => {
			const kind = { review: ['reviews', t('repo.sourceReview')], analysis: ['analyses', t('repo.sourceAnalysis')], test: ['test-runs', t('repo.sourceTest')] }[l.runKind];
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
		tab,
		isNew: url.searchParams.has('new')
	};
};

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();

const GITLAB_ROLE = { admin: 'Maintainer', write: 'Developer', read: 'Reporter', none: '–' } as const;

/** The GitLab bot for the settings page: who it is, its role here, and when its token runs out. */
async function gitlabBot(repo: Parameters<typeof gitlabBotStatus>[0]) {
	const s = await gitlabBotStatus(repo).catch(() => ({ configured: true as const, username: null, level: 'none' as const, ok: false, expiresAt: null }));
	if (!s.configured) return { configured: false as const };
	const days = s.expiresAt ? (Date.parse(s.expiresAt) - Date.now()) / 86_400_000 : null;
	return { configured: true as const, username: s.username, role: GITLAB_ROLE[s.level], ok: s.ok, expiresAt: s.expiresAt, expiresSoon: days !== null && days < 14 };
}

const roleForm = (t: I18n['t']) =>
	z.object({
		name: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, t('repo.roleNameInvalid')),
		description: z.string().max(300),
		username: z.string().max(300),
		password: z.string().max(300),
		loginPath: z.string().regex(/^\//, t('repo.loginPathInvalid')),
		successUrlContains: z.string().max(300),
		recipe: z.string()
	});

export const actions: Actions = {
	settings: async ({ params, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const defaultInstanceUrl = text(f.get('defaultInstanceUrl'));
		if (defaultInstanceUrl && !URL.canParse(defaultInstanceUrl)) return fail(400, { error: t('repo.defaultUrlInvalid'), form: 'settings' });
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
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const parsed = roleForm(t).safeParse(Object.fromEntries(['name', 'description', 'username', 'password', 'loginPath', 'successUrlContains', 'recipe'].map((k) => [k, text(f.get(k))])));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? t('repo.checkInput'), form: 'role' });
		const v = parsed.data;
		let recipe = null;
		if (v.recipe) {
			try {
				recipe = z.array(LoginStepSchema).parse(JSON.parse(v.recipe));
			} catch {
				return fail(400, { error: t('repo.recipeInvalid'), form: 'role' });
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
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'write');
		const roles = await listRoles(db(), repo.id);
		if (!repo.dataConfirmed || roles.length === 0) return fail(400, { error: t('repo.analyzeNeedsSetup'), form: 'analyze' });
		if (!repo.anthropicKeyEnc && !keyOptional(repo)) return fail(400, { error: noKeyMessage(), form: 'analyze' });
		if ((await listAnalyses(db(), { repoId: repo.id, activeOnly: true })).length > 0) {
			return fail(400, { error: t('repo.analysisAlreadyRunning'), form: 'analyze' });
		}
		const blocked = await budgetBlocks(repo, t);
		if (blocked) return fail(400, { error: blocked, form: 'analyze' });
		const f = await request.formData();
		const fixture = repo.fullName === DEMO_REPO && devFixtures() ? DEMO_FIXTURE : null;
		const parsed = AnalysisRequestSchema.safeParse({
			repo: repo.fullName,
			provider: repo.provider,
			instanceUrl: text(f.get('instanceUrl')),
			roles: f.getAll('roles').map(String),
			budget: f.get('budget'),
			language: locals.locale,
			extraInstructions: text(f.get('extraInstructions')) || undefined
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return fail(400, { error: issue?.path[0] === 'instanceUrl' ? t('repo.instanceUrlRequired') : (issue?.message ?? t('repo.checkInput')), form: 'analyze' });
		}
		if (!fixture && !(await userForge(locals.user, repo.provider))) return fail(400, { error: t('repo.githubLoginForCode'), form: 'analyze' });
		const id = await createAnalysis(db(), { repoId: repo.id, request: parsed.data, fixture, startedBy: locals.user!.id });
		redirect(303, `/analyses/${id}`);
	},

	createTest: async ({ params, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'write');
		const f = await request.formData();
		const input = {
			name: text(f.get('name')),
			description: text(f.get('description')),
			expectation: text(f.get('expectation')),
			roles: f.getAll('roles').map(String),
			runInReviews: f.get('runInReviews') === 'on',
			allowedHosts: parseHostList(text(f.get('allowedHosts'))),
			allowAnyHost: f.get('allowAnyHost') === 'on',
			viewports: viewportsOf(f)
		};
		if (!input.name || !input.description || !input.expectation) {
			return fail(400, { error: t('repo.testFieldsRequired'), form: 'createTest' });
		}
		const id = await createTestScript(db(), repo.id, input, locals.user!.id);
		redirect(303, `/tests/${id}?new=1`);
	},

	runTests: async ({ params, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'write');
		if (!repo.dataConfirmed) return fail(400, { error: t('repo.confirmTestDataFirst'), form: 'runTests' });
		const f = await request.formData();
		const parsed = TestRunRequestSchema.safeParse({ repo: repo.fullName, provider: repo.provider, instanceUrl: text(f.get('instanceUrl')), budget: f.get('budget'), language: locals.locale });
		if (!parsed.success) return fail(400, { error: t('repo.instanceUrlRequired'), form: 'runTests' });
		const blocked = await budgetBlocks(repo, t);
		if (blocked) return fail(400, { error: blocked, form: 'runTests' });
		const scripts = await listTestScripts(db(), repo.id);
		if (scripts.length === 0) return fail(400, { error: t('repo.noTestsYet'), form: 'runTests' });
		const batchId = randomUUID().slice(0, 8);
		await createTestRuns(
			db(),
			runsPerViewport(scripts.map((s) => ({ scriptId: s.id, repoId: repo.id, request: parsed.data, batchId, startedBy: locals.user!.id, viewports: s.viewports?.length ? s.viewports : ['desktop'] })))
		);
		redirect(303, repoHref(repo, `tab=tests&batch=${batchId}`));
	},

	automation: async ({ params, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const template = text(f.get('instanceUrlTemplate'));
		if (template && !URL.canParse(template.replace(/\{[a-z_]+\}/g, 'x'))) {
			return fail(400, { error: t('repo.templateInvalid'), form: 'automation' });
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
				runTests: f.get('autoTests') !== 'none',
				testSelection: f.get('autoTests') === 'all' ? 'all' : 'affected',
				followUp: f.get('autoFollowUp') === 'on',
				viewports: viewportsOf(f)
			}
		);
		// Webhooks set up before deployments were supported do not send deployment events yet.
		if (text(f.get('deploymentEnvironment')) && repo.webhookId) {
			const forge = await userForge(locals.user, repo.provider);
			const hook = forge ? await forge.getWebhook(repo, repo.webhookId).catch(() => null) : null;
			if (forge && hook && !hook.complete) await forge.ensureWebhookEvents(repo, repo.webhookId).catch(() => undefined);
		}
		return { saved: 'automation' };
	},
	slack: async ({ params, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const url = text(f.get('webhookUrl'));
		if (url && !isSlackWebhookUrl(url)) return fail(400, { error: t('repo.slackUrlInvalid'), form: 'slack' });
		const pick = <T extends string>(v: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T =>
			(allowed as readonly string[]).includes(String(v)) ? (String(v) as T) : fallback;
		await setSlack(db(), repo.id, {
			// Empty keeps the stored webhook (the field never shows it); "remove" drops it.
			webhookUrl: f.get('removeWebhook') === 'on' ? null : url || undefined,
			notifications: {
				takeover: f.get('takeover') === 'on',
				reviews: pick(f.get('reviews'), ['all', 'changes', 'off'] as const, 'all'),
				automation: f.get('automationEvents') === 'on',
				tests: pick(f.get('tests'), ['failed', 'all', 'off'] as const, 'failed'),
				analyses: f.get('analyses') === 'on',
				mention: text(f.get('mention')).slice(0, 80)
			}
		});
		return { saved: 'slack' };
	},
	budget: async ({ params, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const raw = text((await request.formData()).get('monthlyBudget'));
		const usd = parseBudget(raw);
		if (raw && usd === null) return fail(400, { error: t('repo.budgetInvalid'), form: 'budget' });
		await setMonthlyBudget(db(), repo.id, usd);
		return { saved: 'budget' };
	},
	slackTest: async ({ params, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const hook = slackWebhookUrl(repo);
		if (!hook) return fail(400, { error: t('repo.slackMissing'), form: 'slack' });
		const err = await postSlack(hook, testMessage(repo.fullName, locals.locale));
		if (err) return fail(400, { error: t('repo.slackTestFailed', { reason: err }), form: 'slack' });
		return { saved: 'slackTest' };
	},

	installWebhook: async ({ params, locals, url }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const forge = await userForge(locals.user, repo.provider);
		if (!forge) return fail(400, { error: t('repo.githubLoginForWebhook'), form: 'webhook' });
		const secret = randomUUID() + randomUUID();
		try {
			if (repo.webhookId) await forge.deleteWebhook(repo, repo.webhookId);
			const id = await forge.createWebhook(repo, `${publicBaseUrl(url)}/webhooks/${repo.provider}`, secret);
			await setWebhook(db(), repo.id, { webhookId: id, secret, userId: locals.user!.id });
		} catch (e) {
			const status = (e as { status?: number }).status;
			return fail(400, {
				error: status === 404 || status === 403 ? t('repo.webhookForbidden') : t('repo.githubRejected', { message: (e as Error).message }),
				form: 'webhook'
			});
		}
		return { saved: 'webhook' };
	},

	removeWebhook: async ({ params, locals }) => {
		const repo = await loadRepo(params, locals.user, 'admin');
		const forge = await userForge(locals.user, repo.provider);
		if (repo.webhookId && forge) await forge.deleteWebhook(repo, repo.webhookId).catch(() => undefined);
		await setWebhook(db(), repo.id, null);
		return { saved: 'webhook-removed' };
	},

	setKey: async ({ params, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const f = await request.formData();
		const source = text(f.get('source'));
		let key = text(f.get('key'));
		if (source) {
			// Copy from another repository, only if the user is admin there too.
			const { repo: from } = await requireRepo(locals.user, Number(source), 'admin');
			key = repoAnthropicKey(from) ?? '';
			if (!key) return fail(400, { error: t('repo.keyNotInSource', { repo: from.fullName }), form: 'key' });
		}
		if (!key) return fail(400, { error: t('repo.keyRequired'), form: 'key' });
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
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const repo = await loadRepo(params, locals.user, 'admin');
		const [reviews, analyses] = await Promise.all([listReviews(db(), { repoId: repo.id, limit: 1 }), listAnalyses(db(), { repoId: repo.id, limit: 1 })]);
		if (reviews.length > 0 || analyses.length > 0) {
			return fail(400, { error: t('repo.removeBlocked'), form: 'remove' });
		}
		await removeRepo(db(), repo.id);
		redirect(303, '/repos');
	}
};
