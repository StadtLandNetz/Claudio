import { listOpenHumanRequests, listRepos } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { DEMO_REPO } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null, repos: [], waiting: [] };
	const [repos, waiting] = await Promise.all([listRepos(db()), listOpenHumanRequests(db())]);
	const runPath = { review: 'reviews', analysis: 'analyses', test: 'test-runs' } as const;
	return {
		user: locals.user,
		// onGithub: false for the offline demo repo, which does not exist on GitHub.
		repos: repos.map((r) => ({ fullName: r.fullName, onGithub: !(devFixtures() && r.fullName === DEMO_REPO) })),
		// Runs paused for a person (CAPTCHA); shown on every page so nobody misses them.
		waiting: waiting.map((w) => ({ id: w.id, reason: w.reason, repo: w.repoFullName, href: `/${runPath[w.runKind]}/${w.runRefId}` }))
	};
};
