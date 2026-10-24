import { error, json } from '@sveltejs/kit';
import { proposeCriteria } from '@claudio/agent/criteria';
import { criterionText } from '@claudio/core';
import { getReview, latestKnowledge, repoAnthropicKey } from '@claudio/db';
import { createGithubClient, fetchPullRequestContext } from '@claudio/forge';
import { requireRepo } from '#lib/server/access.js';
import { keyOptional } from '#lib/server/anthropic.js';
import { userToken } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { DEMO_REPO, demoPullRequest } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import { githubErrorMessage } from '#lib/server/github.js';
import { isLocale, serverI18n } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';

/**
 * Proposes the acceptance criteria of a pull request before a review starts, so
 * a person can correct them. One short model call on the repository's key, no browser.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { t } = serverI18n(locals.locale);
	const body = (await request.json().catch(() => ({}))) as { repo?: unknown; pr?: unknown; followUpOf?: unknown; language?: unknown };
	const prNumber = Number(body.pr);
	if (typeof body.repo !== 'string' || !Number.isInteger(prNumber) || prNumber <= 0) error(400, t('review.checkInput'));
	const { repo } = await requireRepo(locals.user, body.repo, 'write');
	const apiKey = repoAnthropicKey(repo) ?? undefined;
	if (!apiKey && !keyOptional(repo)) return json({ error: t('system.noKey') }, { status: 400 });

	let pr;
	if (repo.fullName === DEMO_REPO && devFixtures()) {
		pr = demoPullRequest();
	} else {
		const token = await userToken(locals.user!);
		if (!token) return json({ error: t('review.prNeedsGithub') }, { status: 400 });
		try {
			pr = await fetchPullRequestContext(createGithubClient(token), repo.fullName, prNumber);
		} catch (e) {
			return json({ error: githubErrorMessage(e) }, { status: 502 });
		}
	}
	const [knowledge, prev] = await Promise.all([
		latestKnowledge(db(), repo.id),
		Number.isInteger(Number(body.followUpOf)) && Number(body.followUpOf) > 0 ? getReview(db(), Number(body.followUpOf)) : Promise.resolve(undefined)
	]);
	const previous = prev && prev.repoId === repo.id && prev.prNumber === prNumber ? prev.report?.acceptanceCriteria.map((a) => criterionText(a.criterion)) : undefined;
	const result = await proposeCriteria({
		pr,
		notes: repo.notes ?? undefined,
		routes: knowledge?.docs.find((d) => d.name === 'routes')?.content,
		previous,
		language: isLocale(body.language) ? body.language : locals.locale,
		apiKey
	});
	if (result.error && !result.criteria.length) return json({ error: t('review.criteriaFailed', { reason: result.error }) }, { status: 502 });
	return json({ criteria: result.criteria, remarks: result.remarks, costUsd: result.costUsd });
};
