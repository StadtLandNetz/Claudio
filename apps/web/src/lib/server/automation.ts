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
	findPreviewDeployment,
	getPullHead,
	postPullRequestComment,
	pullsForCommit,
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
	commitStatus: true,
	deploymentEnvironment: ''
};

export const DEFAULT_AUTO_REVIEW: AutoReviewDefaults = {
	roles: [],
	budget: 'standard',
	strictness: 'normal',
	postComment: true,
	runTests: true
};

export type EventResult = { action: 'review' | 'analysis' | 'ignored'; reason: string; id?: number };

type Github = ReturnType<typeof createGithubClient>;

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

	if (!repo.dataConfirmed) return { action: 'ignored', reason: 'the repository is not cleared for reviews (test data confirmation missing)' };

	// A review instance finished deploying: review the open PR it belongs to.
	if (decision.kind === 'deployment') {
		if (!github) return { action: 'ignored', reason: 'no GitHub access to find the pull request' };
		const pulls = (await pullsForCommit(github, repo.fullName, decision.sha)).filter((p) => !p.draft);
		if (pulls.length === 0) return { action: 'ignored', reason: 'no open, non-draft pull request with this head commit' };
		const results = [];
		for (const p of pulls) {
			results.push(
				await queueReview(repo, settings, github, baseUrl, userId, fixture, {
					prNumber: p.number,
					headSha: decision.sha,
					title: p.title,
					trigger: 'deployment',
					instanceUrl: decision.url
				})
			);
		}
		return results.find((r) => r.action === 'review') ?? results[0]!;
	}

	// Review. Comment events carry no head commit; fetch it.
	let { headSha, branch, title } = decision;
	if ((!headSha || !branch) && github) {
		const head = await getPullHead(github, repo.fullName, decision.prNumber);
		if (!head.open) return { action: 'ignored', reason: 'pull request is closed' };
		({ sha: headSha, branch, title } = head);
	}

	const resolved = await resolveInstanceUrl(repo, settings, github, fixture, { prNumber: decision.prNumber, headSha, branch });
	if ('missing' in resolved) {
		if (github && decision.trigger === 'comment') {
			await postPullRequestComment(github, repo.fullName, decision.prNumber, `Claudio kann diesen PR nicht prüfen: ${resolved.missing}`).catch(() => undefined);
		}
		return { action: 'ignored', reason: resolved.reason };
	}

	const result = await queueReview(repo, settings, github, baseUrl, userId, fixture, {
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
	return result;
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
	pr: { prNumber: number; headSha: string | null; branch: string | null }
): Promise<{ url: string; source: 'deployment' | 'template'; note?: string } | { missing: string; reason: string }> {
	const env = settings.deploymentEnvironment?.trim();
	if (env && github && pr.headSha) {
		const found = await findPreviewDeployment(github, repo.fullName, { sha: pr.headSha, prNumber: pr.prNumber, environment: env }).catch(() => null);
		if (found) {
			return {
				url: found.url,
				source: 'deployment',
				note: found.exact ? undefined : `Für den neuesten Commit gibt es noch keine ${env}-Instanz; geprüft wird die von ${found.sha.slice(0, 7)}.`
			};
		}
	}
	const template = settings.instanceUrlTemplate || (fixture ? (repo.defaultInstanceUrl ?? '') : '');
	if (template) return { url: renderInstanceUrl(template, { number: pr.prNumber, branch: pr.branch ?? '', sha: pr.headSha ?? '' }), source: 'template' };
	if (env) return { missing: `Für diesen PR gibt es noch keine erfolgreiche Bereitstellung im Environment „${env}“.`, reason: `no ${env} deployment for this pull request` };
	return { missing: 'In den Repo-Einstellungen fehlt die URL-Vorlage für die PR-Instanzen.', reason: 'no instance URL template' };
}

async function queueReview(
	repo: Repo,
	settings: AutomationSettings,
	github: Github | null,
	baseUrl: string,
	userId: number,
	fixture: string | null,
	input: { prNumber: number; headSha: string | null; title: string | null; trigger: string; budget?: 'quick' | 'standard' | 'thorough'; instanceUrl: string }
): Promise<EventResult> {
	const { prNumber, headSha, title, trigger, instanceUrl } = input;
	if (await findActiveReview(db(), repo.id, prNumber, trigger === 'push' || trigger === 'deployment' ? headSha : null)) {
		return { action: 'ignored', reason: 'a review of this pull request is already queued or running' };
	}

	const defaults = repo.autoReview ?? DEFAULT_AUTO_REVIEW;
	const roleNames = (await listRoles(db(), repo.id)).map((r) => r.name);
	const parsed = ReviewRequestSchema.safeParse({
		repo: repo.fullName,
		pr: prNumber,
		instanceUrl,
		roles: defaults.roles.filter((r) => roleNames.includes(r)),
		budget: input.budget ?? defaults.budget,
		strictness: defaults.strictness,
		postComment: defaults.postComment && !fixture,
		cloneRepo: !fixture
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
	if (github && settings.commitStatus && headSha) {
		await setCommitStatus(github, repo.fullName, headSha, 'pending', 'Claudio prüft den Pull Request …', `${baseUrl}/reviews/${id}`).catch(() => undefined);
	}
	return { action: 'review', reason: `${trigger} on #${prNumber}`, id };
}
