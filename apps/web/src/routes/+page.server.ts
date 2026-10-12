import { dismissedFindingIds, listAnalyses, listRepos, listReviews, testResultsByReview } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { summarize } from '#lib/server/summary.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [reviews, repos, analyses] = await Promise.all([
		listReviews(db(), { limit: 40 }),
		listRepos(db()),
		listAnalyses(db(), { activeOnly: true })
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
