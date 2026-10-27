import { dev } from '$app/env';
import { dismissedFindingIds, listAnalyses, listReviewDigests, testResultsByReview } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { devFixtures } from '#lib/server/env.js';
import { summarize } from '#lib/server/summary.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Signed-out visitors see the landing page; the page picks it by the layout's user.
	if (!locals.user) return { reviews: [], repoCount: 0, analyses: [], demoLogin: dev && devFixtures() };
	const { repos } = await visibleRepos(locals.user);
	const repoIds = repos.map((r) => r.id);
	const [reviews, analyses] = await Promise.all([
		listReviewDigests(db(), { limit: 40, repoIds }),
		listAnalyses(db(), { activeOnly: true, repoIds })
	]);
	const [dismissed, tests] = await Promise.all([
		dismissedFindingIds(db(), reviews.map((r) => r.id)),
		testResultsByReview(db(), reviews.map((r) => r.id))
	]);
	return {
		reviews: reviews.map((r) => summarize(r, dismissed.get(r.id), undefined, tests.get(r.id))),
		repoCount: repos.length,
		analyses: analyses.map((a) => ({ id: a.id, repo: a.repoFullName, status: a.status }))
	};
};
