import { error, fail, redirect } from '@sveltejs/kit';
import { ReviewRequestSchema, parseRepoPath, repoHref, repoPath } from '@claudio/core';
import { criterionText, verdict } from '@claudio/core';
import { createReview, createTestRuns, dismissedFindingIds, listRoles, listTestScripts, previousReviewOf } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { DEFAULT_AUTOMATION, resolveInstanceUrl } from '#lib/server/automation.js';
import { keyOptional } from '#lib/server/anthropic.js';
import { db } from '#lib/server/db.js';
import { DEMO_FIXTURE, DEMO_REPO, demoPullRequest } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import { forgeErrorMessage, userForge } from '#lib/server/forge.js';
import { serverI18n, type I18n } from '#lib/i18n/index.js';
import { budgetBlocks, runsPerViewport, viewportsOf } from '#lib/server/runs.js';
import type { Actions, PageServerLoad } from './$types';

async function context(url: URL, user: App.Locals['user'], t: I18n['t']) {
	const key = parseRepoPath(url.searchParams.get('repo') ?? '');
	if (!key) error(404, t('system.notFound'));
	const prNumber = Number(url.searchParams.get('pr'));
	const { repo } = await requireRepo(user, key, 'write');
	if (!Number.isInteger(prNumber) || prNumber <= 0) error(400, t('review.prNumberMissing'));
	const roles = await listRoles(db(), repo.id);
	if (!repo.dataConfirmed || roles.length === 0) redirect(303, repoHref(repo, 'tab=settings'));
	if (!repo.anthropicKeyEnc && !keyOptional(repo)) redirect(303, `${repoHref(repo, 'tab=settings')}#anthropic`);

	const fixture = repo.fullName === DEMO_REPO && devFixtures() ? DEMO_FIXTURE : null;
	let pr: { title: string; headRef: string; headSha: string | null; url: string } | null = null;
	let prError: string | null = null;
	if (fixture) {
		const p = demoPullRequest();
		if (p.number === prNumber) pr = { title: p.title, headRef: p.headRef, headSha: null, url: p.url };
	} else {
		const forge = await userForge(user, repo.provider);
		if (!forge) prError = t('review.prNeedsGithub');
		else
			try {
				const p = await forge.getChange(repo, prNumber);
				pr = { title: p.title, headRef: p.headRef, headSha: p.headSha ?? null, url: p.url };
			} catch (e) {
				prError = forgeErrorMessage(e);
			}
	}
	return { repo, roles, prNumber, pr, prError, fixture };
}

/** The latest finished review of this pull request: a new one can build on it (re-review). */
async function previousOf(repoId: number, prNumber: number) {
	const prev = await previousReviewOf(db(), repoId, prNumber);
	if (!prev?.report) return null;
	const dismissed = (await dismissedFindingIds(db(), [prev.id])).get(prev.id) ?? [];
	return {
		id: prev.id,
		createdAt: prev.createdAt,
		verdict: verdict(prev.report, prev.report.request.strictness, dismissed),
		openFindings: prev.report.findings.filter((f) => !dismissed.includes(f.id)).length,
		criteria: prev.report.acceptanceCriteria.map((a) => criterionText(a.criterion)),
		headSha: prev.headSha ?? prev.report.pr.headSha ?? null
	};
}

/** Pre-fills the instance: the PR's GitHub deployment, the URL template, or the repo's default instance. */
async function suggestedInstance(ctx: Awaited<ReturnType<typeof context>>, user: App.Locals['user'], t: I18n['t']): Promise<{ url: string; source: string | null; note?: string }> {
	const { repo, pr, prNumber, fixture } = ctx;
	const fallback = { url: repo.defaultInstanceUrl ?? '', source: null };
	if (!pr) return fallback;
	const forge = fixture ? null : await userForge(user, repo.provider);
	const settings = repo.automation ?? DEFAULT_AUTOMATION;
	const resolved = await resolveInstanceUrl(repo, settings, forge, fixture, { prNumber, headSha: pr.headSha, branch: pr.headRef }).catch(() => null);
	if (!resolved || 'missing' in resolved) return fallback;
	return {
		url: resolved.url,
		source: resolved.source === 'deployment' ? t('review.sourceDeployment', { env: resolved.environment ?? settings.deploymentEnvironment ?? '' }) : t('review.sourceTemplate'),
		note: 'note' in resolved ? resolved.note : undefined
	};
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const { t } = serverI18n(locals.locale, locals.user?.provider);
	const ctx = await context(url, locals.user, t);
	const { repo, roles, prNumber, pr, prError } = ctx;
	const instance = await suggestedInstance(ctx, locals.user, t);
	const [tests, previous] = await Promise.all([listTestScripts(db(), repo.id).then((all) => all.filter((t) => t.runInReviews)), previousOf(repo.id, prNumber)]);
	return {
		budgetBlocked: await budgetBlocks(repo, t),
		previous,
		reviewTests: tests.map((t) => t.name),
		repo: repo.fullName,
		repoPath: repoPath(repo),
		prNumber,
		pr,
		prError,
		roles: roles.map((r) => ({ name: r.name, description: r.description })),
		defaultInstanceUrl: instance.url,
		instanceSource: instance.source,
		instanceNote: instance.note ?? null
	};
};

/** The criteria from the form: one per field, empty ones dropped; none means the agent derives them itself. */
function criteriaOf(f: FormData): string[] | undefined {
	const list = f
		.getAll('criteria')
		.map((v) => String(v).replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.slice(0, 40);
	return list.length ? list : undefined;
}

export const actions: Actions = {
	default: async ({ url, request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		const { repo, prNumber, pr, fixture } = await context(url, locals.user, t);
		if (!pr) return fail(400, { error: t('review.prLoadFailed') });
		const blocked = await budgetBlocks(repo, t);
		if (blocked) return fail(400, { error: blocked });
		const f = await request.formData();
		const parsed = ReviewRequestSchema.safeParse({
			repo: repo.fullName,
			provider: repo.provider,
			pr: prNumber,
			instanceUrl: String(f.get('instanceUrl') ?? '').trim(),
			roles: f.getAll('roles').map(String),
			driver: 'playwright',
			budget: f.get('budget'),
			verbosity: f.get('verbosity'),
			strictness: f.get('strictness'),
			language: f.get('language'),
			postComment: f.get('postComment') === 'on' && !fixture,
			cloneRepo: !fixture,
			extraInstructions: String(f.get('extraInstructions') ?? '').trim() || undefined,
			criteria: criteriaOf(f),
			viewports: viewportsOf(f),
			followUpOf: f.get('followUp') === 'on' ? (await previousOf(repo.id, prNumber))?.id : undefined
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const message = issue?.path[0] === 'instanceUrl' ? t('review.instanceUrlInvalid') : (issue?.message ?? t('review.checkInput'));
			return fail(400, { error: message });
		}
		const id = await createReview(db(), {
			repoId: repo.id,
			prNumber,
			prTitle: pr.title,
			request: parsed.data,
			fixture,
			startedBy: locals.user!.id
		});
		// Regression tests of the repo run against the same instance, after the review (worker order).
		if (f.get('runTests') === 'on') {
			const tests = (await listTestScripts(db(), repo.id)).filter((t) => t.runInReviews);
			await createTestRuns(
				db(),
				runsPerViewport(tests.map((t) => ({
					scriptId: t.id,
					repoId: repo.id,
					reviewId: id,
					request: { repo: repo.fullName, provider: repo.provider, instanceUrl: parsed.data.instanceUrl, budget: 'quick' as const, language: parsed.data.language, headed: false, rerecord: false },
					startedBy: locals.user!.id,
					viewports: t.viewports?.length ? t.viewports : ['desktop']
				})))
			);
		}
		redirect(303, `/reviews/${id}`);
	}
};
