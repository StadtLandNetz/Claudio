import { listOpenHumanRequests } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { DEMO_REPO } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { locale: locals.locale, user: null, repos: [], waiting: [], authExpired: false };
	const [{ repos, authExpired }, allWaiting] = await Promise.all([visibleRepos(locals.user), listOpenHumanRequests(db())]);
	const visible = new Set(repos.map((r) => r.id));
	const waiting = allWaiting.filter((w) => visible.has(w.repoId));
	const runPath = { review: 'reviews', analysis: 'analyses', test: 'test-runs' } as const;
	return {
		locale: locals.locale,
		user: locals.user,
		authExpired,
		// onGithub: false for the offline demo repo, which does not exist on GitHub.
		repos: repos.map((r) => ({ fullName: r.fullName, onGithub: !(devFixtures() && r.fullName === DEMO_REPO) })),
		// Runs paused for a person (CAPTCHA); shown on every page so nobody misses them.
		waiting: waiting.map((w) => ({ id: w.id, reason: w.reason, repo: w.repoFullName, href: `/${runPath[w.runKind]}/${w.runRefId}` }))
	};
};
