import { error, json } from '@sveltejs/kit';
import { proposeCriteria } from '@claudio/agent/criteria';
import { criterionText, parseRepoPath } from '@claudio/core';
import { getReview, latestKnowledge, repoAnthropicKey } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { keyOptional } from '#lib/server/anthropic.js';
import { db } from '#lib/server/db.js';
import { DEMO_REPO, demoPullRequest } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import { forgeErrorMessage, userForge } from '#lib/server/forge.js';
import { isLocale, serverI18n } from '#lib/i18n/index.js';
import type { RequestHandler } from './$types';
import { accountProvider } from '#lib/server/i18n.js';

/**
 * Proposes the acceptance criteria of a pull request before a review starts, so
 * a person can correct them. One short model call on the repository's key, no browser.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => ({}))) as { repo?: unknown; pr?: unknown; followUpOf?: unknown; language?: unknown };
	const prNumber = Number(body.pr);
	const key = typeof body.repo === 'string' ? parseRepoPath(body.repo) : null;
	const { t } = serverI18n(locals.locale, key?.provider ?? accountProvider(locals.user));
	if (!key || !Number.isInteger(prNumber) || prNumber <= 0) error(400, t('review.checkInput'));
	const { repo } = await requireRepo(locals.user, key, 'write');
	const apiKey = repoAnthropicKey(repo) ?? undefined;
	if (!apiKey && !keyOptional(repo)) return json({ error: t('system.noKey') }, { status: 400 });

	let pr;
	if (repo.fullName === DEMO_REPO && devFixtures()) {
		pr = demoPullRequest();
	} else {
		const forge = await userForge(locals.user, repo.provider);
		if (!forge) return json({ error: t('review.prNeedsGithub') }, { status: 400 });
		try {
			pr = await forge.fetchChangeContext(repo, prNumber);
		} catch (e) {
			return json({ error: forgeErrorMessage(e, repo.provider) }, { status: 502 });
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
