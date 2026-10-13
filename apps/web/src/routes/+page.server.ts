import { dismissedFindingIds, listAnalyses, listReviews, testResultsByReview } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { summarize } from '#lib/server/summary.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { repos } = await visibleRepos(locals.user!);
	const repoIds = repos.map((r) => r.id);
	const [reviews, analyses] = await Promise.all([
		listReviews(db(), { limit: 40, repoIds }),
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
