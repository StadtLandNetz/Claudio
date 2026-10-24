import { AnalysisRequestSchema, ReviewRequestSchema, renderCommitStatus } from '@claudio/core';
import {
	createAnalysis,
	createReview,
	createTestRuns,
	findActiveReview,
	getUser,
	listAnalyses,
	listRoles,
	listTestScripts,
	freshAccessToken,
	notify,
	previousReviewOf,
	type AutoReviewDefaults,
	type Repo
} from '@claudio/db';
import {
	botClient,
	createGithubClient,
	decideTrigger,
	findPreviewDeployment,
	getPullHead,
	postPullRequestComment,
	pullsForCommit,
	reactToComment,
	renderInstanceUrl,
	setCommitStatus,
	type AutomationSettings
} from '@claudio/forge';
import { DEFAULT_LOCALE, isLocale, serverI18n, type Locale } from '#lib/i18n/index.js';
import { keyOptional } from './anthropic.js';
import { budgetBlocks, runsPerViewport } from './runs.js';
import { db } from './db.js';
import { DEMO_FIXTURE, DEMO_REPO } from './demo.js';
import { devFixtures } from './env.js';
import { requestI18n } from './i18n.js';

export const DEFAULT_AUTOMATION: AutomationSettings = {
	instanceUrlTemplate: '',
	onComment: true,
	onLabel: true,
	onPush: false,
	analyzeOnMerge: false,
	commitStatus: true,
	deploymentEnvironment: ''
};

export const DEFAULT_AUTO_REVIEW: AutoReviewDefaults = {
	roles: [],
	budget: 'standard',
	strictness: 'normal',
	postComment: true,
	runTests: true,
	followUp: true,
	viewports: ['desktop']
};

export type EventResult = {
	action: 'review' | 'analysis' | 'ignored';
	reason: string;
	id?: number;
	/** For Slack: why an automatic review did not start, in the language of the person it acts for. */
	notice?: string;
	prNumber?: number;
	prTitle?: string | null;
};

type Github = ReturnType<typeof createGithubClient>;

/**
 * The person who set up the automation: automated runs act with their token and
 * post to GitHub in their language.
 */
async function automationUser(repo: Repo): Promise<{ token: string | null; userId: number; locale: Locale }> {
	const userId = repo.automationUserId ?? repo.createdBy;
	const user = await getUser(db(), userId);
	return { token: user ? await freshAccessToken(db(), user) : null, userId, locale: isLocale(user?.locale) ? user.locale : DEFAULT_LOCALE };
}

/**
 * Turns a verified GitHub event into a review or analysis job, and tells the
 * repository's Slack channel about automatic reviews: started, or why not.
 */
export async function handleGithubEvent(repo: Repo, event: string, payload: Record<string, any>, baseUrl: string): Promise<EventResult> {
	const settings = repo.automation ?? DEFAULT_AUTOMATION;
	const decision = decideTrigger(event, payload, settings, repo.defaultBranch);
	if (decision.kind === 'ignore') return { action: 'ignored', reason: decision.reason };
	const result = await handleDecision(repo, settings, decision, baseUrl);
	if (decision.kind === 'review' || decision.kind === 'deployment') {
		const { locale } = await automationUser(repo);
		const prNumber = decision.kind === 'review' ? decision.prNumber : (result.prNumber ?? 0);
		const trigger = decision.kind === 'review' ? decision.trigger : 'deployment';
		// Duplicates (a review already runs) are not worth a message; reasons a person can fix are.
		const quiet = result.action === 'ignored' && (!result.notice || prNumber === 0);
		if (!quiet) {
			await notify(
				repo,
				{
					kind: 'automation',
					started: result.action === 'review',
					prNumber,
					prTitle: result.prTitle ?? (decision.kind === 'review' ? decision.title : null) ?? null,
					trigger,
					reason: result.notice ?? result.reason,
					reviewId: result.action === 'review' ? result.id : undefined
				},
				{ language: locale, baseUrl, log: (m) => console.log(`[webhook] ${m}`) }
			);
		}
	}
	return result;
}

type Decision = Exclude<ReturnType<typeof decideTrigger>, { kind: 'ignore' }>;

async function handleDecision(repo: Repo, settings: AutomationSettings, decision: Decision, baseUrl: string): Promise<EventResult> {
	const fixture = repo.fullName === DEMO_REPO && devFixtures() ? DEMO_FIXTURE : null;
	const { token, userId, locale } = await automationUser(repo);
	const { t } = serverI18n(locale);
	// Claudio's own identity (GitHub App) when installed; otherwise the token of the person who set up the automation.
	const bot = fixture ? null : await botClient(repo.fullName).catch(() => null);
	const github = bot ?? (token && !fixture ? createGithubClient(token) : null);

	// Every model call of this repo runs on its own key; without one, nothing starts.
	if (!repo.anthropicKeyEnc && !keyOptional(repo)) {
		if (github && decision.kind === 'review' && decision.trigger === 'comment') {
			await postPullRequestComment(github, repo.fullName, decision.prNumber, t('system.cannotReview', { reason: t('system.noKey') })).catch(() => undefined);
		}
		return { action: 'ignored', reason: 'no Anthropic API key for this repository', notice: t('system.noKey') };
	}

	if (decision.kind === 'analysis') {
		if (!repo.defaultInstanceUrl) return { action: 'ignored', reason: 'no default instance URL for the analysis' };
		if ((await listAnalyses(db(), { repoId: repo.id, activeOnly: true })).length > 0) return { action: 'ignored', reason: 'an analysis is already running' };
		const roles = (await listRoles(db(), repo.id)).map((r) => r.name);
		const request = AnalysisRequestSchema.parse({ repo: repo.fullName, branch: decision.branch, instanceUrl: repo.defaultInstanceUrl, roles, budget: 'quick' });
		const id = await createAnalysis(db(), { repoId: repo.id, request, fixture, startedBy: userId });
		return { action: 'analysis', reason: `push to ${decision.branch}`, id };
	}

	if (!repo.dataConfirmed) return { action: 'ignored', reason: 'the repository is not cleared for reviews (test data confirmation missing)', notice: t('system.notCleared') };
	const blocked = await budgetBlocks(repo, t);
	if (blocked) {
		if (github && decision.kind === 'review' && decision.trigger === 'comment') {
			await postPullRequestComment(github, repo.fullName, decision.prNumber, t('system.cannotReview', { reason: blocked })).catch(() => undefined);
		}
		return { action: 'ignored', reason: 'monthly budget used up', notice: blocked, prNumber: decision.kind === 'review' ? decision.prNumber : undefined };
	}

	// A review instance finished deploying: review the open PR it belongs to.
	if (decision.kind === 'deployment') {
		if (!github) return { action: 'ignored', reason: 'no GitHub access to find the pull request' };
		const pulls = (await pullsForCommit(github, repo.fullName, decision.sha)).filter((p) => !p.draft);
		if (pulls.length === 0) return { action: 'ignored', reason: 'no open, non-draft pull request with this head commit' };
		const results = [];
		for (const p of pulls) {
			results.push(
				await queueReview(repo, settings, github, baseUrl, userId, locale, fixture, {
					prNumber: p.number,
					headSha: decision.sha,
					title: p.title,
					trigger: 'deployment',
					instanceUrl: decision.url
				})
			);
		}
		const started = results.find((r) => r.action === 'review') ?? results[0]!;
		return { ...started, prNumber: pulls[0]!.number, prTitle: pulls[0]!.title };
	}

	// Review. Comment events carry no head commit; fetch it.
	let { headSha, branch, title } = decision;
	if ((!headSha || !branch) && github) {
		const head = await getPullHead(github, repo.fullName, decision.prNumber);
		if (!head.open) return { action: 'ignored', reason: 'pull request is closed' };
		({ sha: headSha, branch, title } = head);
	}

	const resolved = await resolveInstanceUrl(repo, settings, github, fixture, { prNumber: decision.prNumber, headSha, branch }, locale);
	if ('missing' in resolved) {
		if (github && decision.trigger === 'comment') {
			await postPullRequestComment(github, repo.fullName, decision.prNumber, t('system.cannotReview', { reason: resolved.missing })).catch(() => undefined);
		}
		return { action: 'ignored', reason: resolved.reason, notice: resolved.missing, prNumber: decision.prNumber, prTitle: title };
	}

	const result = await queueReview(repo, settings, github, baseUrl, userId, locale, fixture, {
		prNumber: decision.prNumber,
		headSha,
		title,
		trigger: decision.trigger,
		budget: decision.budget,
		instanceUrl: resolved.url
	});
	if (result.action === 'review' && github && decision.trigger === 'comment' && decision.commentId) {
		await reactToComment(github, repo.fullName, decision.commentId).catch(() => undefined);
	}
	return { ...result, prNumber: decision.prNumber, prTitle: title };
}

/**
 * Where the PR's review instance runs: its GitHub deployment in the configured
 * environment, else the repo's URL template.
 */
export async function resolveInstanceUrl(
	repo: Repo,
	settings: AutomationSettings,
	github: Github | null,
	fixture: string | null,
	pr: { prNumber: number; headSha: string | null; branch: string | null },
	locale?: Locale
): Promise<{ url: string; source: 'deployment' | 'template'; environment?: string; note?: string } | { missing: string; reason: string }> {
	const { t } = locale ? serverI18n(locale) : requestI18n();
	const env = settings.deploymentEnvironment?.trim();
	if (env && github && pr.headSha) {
		const lookup = (environment?: string) =>
			findPreviewDeployment(github, repo.fullName, { sha: pr.headSha!, prNumber: pr.prNumber, environment }).catch(() => null);
		// The configured environment first; then any non-production one, in case the setting names the wrong environment.
		const found = (await lookup(env)) ?? (await lookup());
		if (found) {
			const notes = [
				found.environment.toLowerCase() !== env.toLowerCase()
					? t('system.instanceOtherEnvironment', { env, found: found.environment })
					: null,
				found.exact ? null : t('system.instanceEarlierCommit', { sha: found.sha.slice(0, 7) })
			].filter(Boolean);
			return { url: found.url, source: 'deployment', environment: found.environment, note: notes.join(' ') || undefined };
		}
	}
	const template = settings.instanceUrlTemplate || (fixture ? (repo.defaultInstanceUrl ?? '') : '');
	if (template) return { url: renderInstanceUrl(template, { number: pr.prNumber, branch: pr.branch ?? '', sha: pr.headSha ?? '' }), source: 'template' };
	if (env) return { missing: t('system.instanceNoDeployment', { env }), reason: `no ${env} deployment for this pull request` };
	return { missing: t('system.instanceNoTemplate'), reason: 'no instance URL template' };
}

async function queueReview(
	repo: Repo,
	settings: AutomationSettings,
	github: Github | null,
	baseUrl: string,
	userId: number,
	locale: Locale,
	fixture: string | null,
	input: { prNumber: number; headSha: string | null; title: string | null; trigger: string; budget?: 'quick' | 'standard' | 'thorough'; instanceUrl: string }
): Promise<EventResult> {
	const { prNumber, headSha, title, trigger, instanceUrl } = input;
	if (await findActiveReview(db(), repo.id, prNumber, trigger === 'push' || trigger === 'deployment' ? headSha : null)) {
		return { action: 'ignored', reason: 'a review of this pull request is already queued or running' };
	}

	const defaults = { ...DEFAULT_AUTO_REVIEW, ...(repo.autoReview ?? {}) };
	const roleNames = (await listRoles(db(), repo.id)).map((r) => r.name);
	// A pull request that was reviewed before gets a re-review: the earlier findings re-checked, only the changes tested.
	const previous = defaults.followUp ? await previousReviewOf(db(), repo.id, prNumber) : undefined;
	const parsed = ReviewRequestSchema.safeParse({
		repo: repo.fullName,
		pr: prNumber,
		instanceUrl,
		roles: defaults.roles.filter((r) => roleNames.includes(r)),
		budget: input.budget ?? defaults.budget,
		strictness: defaults.strictness,
		postComment: defaults.postComment && !fixture,
		// The report, the PR comment and the commit status follow the language of the person the run acts for.
		language: locale,
		cloneRepo: !fixture,
		followUpOf: previous?.id,
		viewports: defaults.viewports?.length ? defaults.viewports : ['desktop']
	});
	if (!parsed.success) return { action: 'ignored', reason: `invalid review request: ${parsed.error.issues[0]?.message}` };

	const id = await createReview(db(), {
		repoId: repo.id,
		prNumber,
		prTitle: title,
		request: parsed.data,
		fixture,
		startedBy: userId,
		trigger,
		headSha
	});

	if (defaults.runTests) {
		const tests = (await listTestScripts(db(), repo.id)).filter((t) => t.runInReviews);
		await createTestRuns(
			db(),
			runsPerViewport(tests.map((t) => ({
				scriptId: t.id,
				repoId: repo.id,
				reviewId: id,
				request: { repo: repo.fullName, instanceUrl, budget: 'quick' as const, language: parsed.data.language, headed: false, rerecord: false },
				startedBy: userId,
				viewports: t.viewports?.length ? t.viewports : ['desktop']
			})))
		);
	}

	// Visible feedback on GitHub. Failures here must not lose the review.
	if (github && settings.commitStatus && headSha) {
		await setCommitStatus(github, repo.fullName, headSha, 'pending', renderCommitStatus(locale, { kind: 'pending' }), `${baseUrl}/reviews/${id}`).catch(() => undefined);
	}
	return { action: 'review', reason: `${trigger} on #${prNumber}`, id };
}
