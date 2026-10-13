import { AnalysisRequestSchema, ReviewRequestSchema } from '@claudio/core';
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
	type AutoReviewDefaults,
	type Repo
} from '@claudio/db';
import {
	createGithubClient,
	decideTrigger,
	getPullHead,
	postPullRequestComment,
	reactToComment,
	renderInstanceUrl,
	setCommitStatus,
	type AutomationSettings
} from '@claudio/github';
import { NO_KEY_MESSAGE, keyOptional } from './anthropic.js';
import { db } from './db.js';
import { DEMO_FIXTURE, DEMO_REPO } from './demo.js';
import { devFixtures } from './env.js';

export const DEFAULT_AUTOMATION: AutomationSettings = {
	instanceUrlTemplate: '',
	onComment: true,
	onLabel: true,
	onPush: false,
	analyzeOnMerge: false,
	commitStatus: true
};

export const DEFAULT_AUTO_REVIEW: AutoReviewDefaults = {
	roles: [],
	budget: 'standard',
	strictness: 'normal',
	postComment: true,
	runTests: true
};

export type EventResult = { action: 'review' | 'analysis' | 'ignored'; reason: string; id?: number };

/** Token of the person who set up the automation; automated runs act on their behalf. */
async function automationToken(repo: Repo): Promise<{ token: string | null; userId: number }> {
	const userId = repo.automationUserId ?? repo.createdBy;
	const user = await getUser(db(), userId);
	return { token: user ? await freshAccessToken(db(), user) : null, userId };
}

/** Turns a verified GitHub event into a review or analysis job. */
export async function handleGithubEvent(repo: Repo, event: string, payload: Record<string, any>, baseUrl: string): Promise<EventResult> {
	const settings = repo.automation ?? DEFAULT_AUTOMATION;
	const decision = decideTrigger(event, payload, settings, repo.defaultBranch);
	if (decision.kind === 'ignore') return { action: 'ignored', reason: decision.reason };

	const fixture = repo.fullName === DEMO_REPO && devFixtures() ? DEMO_FIXTURE : null;
	const { token, userId } = await automationToken(repo);
	const github = token && !fixture ? createGithubClient(token) : null;

	// Every model call of this repo runs on its own key; without one, nothing starts.
	if (!repo.anthropicKeyEnc && !keyOptional(repo)) {
		if (github && decision.kind === 'review' && decision.trigger === 'comment') {
			await postPullRequestComment(github, repo.fullName, decision.prNumber, `Claudio kann diesen PR nicht prüfen: ${NO_KEY_MESSAGE}`).catch(() => undefined);
		}
		return { action: 'ignored', reason: 'no Anthropic API key for this repository' };
	}

	if (decision.kind === 'analysis') {
		if (!repo.defaultInstanceUrl) return { action: 'ignored', reason: 'no default instance URL for the analysis' };
		if ((await listAnalyses(db(), { repoId: repo.id, activeOnly: true })).length > 0) return { action: 'ignored', reason: 'an analysis is already running' };
		const roles = (await listRoles(db(), repo.id)).map((r) => r.name);
		const request = AnalysisRequestSchema.parse({ repo: repo.fullName, branch: decision.branch, instanceUrl: repo.defaultInstanceUrl, roles, budget: 'quick' });
		const id = await createAnalysis(db(), { repoId: repo.id, request, fixture, startedBy: userId });
		return { action: 'analysis', reason: `push to ${decision.branch}`, id };
	}

	// Review. Comment events carry no head commit; fetch it.
	let { headSha, branch, title } = decision;
	if ((!headSha || !branch) && github) {
		const head = await getPullHead(github, repo.fullName, decision.prNumber);
		if (!head.open) return { action: 'ignored', reason: 'pull request is closed' };
		({ sha: headSha, branch, title } = head);
	}
	if (!repo.dataConfirmed) return { action: 'ignored', reason: 'the repository is not cleared for reviews (test data confirmation missing)' };

	const template = settings.instanceUrlTemplate || (fixture ? repo.defaultInstanceUrl ?? '' : '');
	if (!template) {
		if (github && decision.trigger === 'comment') {
			await postPullRequestComment(github, repo.fullName, decision.prNumber, 'Claudio kann diesen PR nicht prüfen: In den Repo-Einstellungen fehlt die URL-Vorlage für die PR-Instanzen.').catch(() => undefined);
		}
		return { action: 'ignored', reason: 'no instance URL template' };
	}
	const instanceUrl = renderInstanceUrl(template, { number: decision.prNumber, branch: branch ?? '', sha: headSha ?? '' });

	if (await findActiveReview(db(), repo.id, decision.prNumber, decision.trigger === 'push' ? headSha : null)) {
		return { action: 'ignored', reason: 'a review of this pull request is already queued or running' };
	}

	const defaults = repo.autoReview ?? DEFAULT_AUTO_REVIEW;
	const roleNames = (await listRoles(db(), repo.id)).map((r) => r.name);
	const parsed = ReviewRequestSchema.safeParse({
		repo: repo.fullName,
		pr: decision.prNumber,
		instanceUrl,
		roles: defaults.roles.filter((r) => roleNames.includes(r)),
		budget: decision.budget ?? defaults.budget,
		strictness: defaults.strictness,
		postComment: defaults.postComment && !fixture,
		cloneRepo: !fixture
	});
	if (!parsed.success) return { action: 'ignored', reason: `invalid review request: ${parsed.error.issues[0]?.message}` };

	const id = await createReview(db(), {
		repoId: repo.id,
		prNumber: decision.prNumber,
		prTitle: title,
		request: parsed.data,
		fixture,
		startedBy: userId,
		trigger: decision.trigger,
		headSha
	});

	if (defaults.runTests) {
		const tests = (await listTestScripts(db(), repo.id)).filter((t) => t.runInReviews);
		await createTestRuns(
			db(),
			tests.map((t) => ({
				scriptId: t.id,
				repoId: repo.id,
				reviewId: id,
				request: { repo: repo.fullName, instanceUrl, budget: 'quick' as const, language: parsed.data.language, headed: false, rerecord: false },
				startedBy: userId
			}))
		);
	}

	// Visible feedback on GitHub. Failures here must not lose the review.
	if (github) {
		if (decision.trigger === 'comment' && decision.commentId) await reactToComment(github, repo.fullName, decision.commentId).catch(() => undefined);
		if (settings.commitStatus && headSha) {
			await setCommitStatus(github, repo.fullName, headSha, 'pending', 'Claudio prüft den Pull Request …', `${baseUrl}/reviews/${id}`).catch(() => undefined);
		}
	}
	return { action: 'review', reason: `${decision.trigger} on #${decision.prNumber}`, id };
}
