import { repoPath } from '@claudio/core';
import { countsByRepo, listOpenHumanRequests } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { keyOptional } from '#lib/server/anthropic.js';
import { db } from '#lib/server/db.js';
import { DEMO_REPO } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// Reading the path makes SvelteKit run this load again on every navigation, so the sidebar
	// follows added repositories and changed access instead of keeping the first page's list.
	void url.pathname;
	if (!locals.user) return { locale: locals.locale, user: null, repos: [], waiting: [], authExpired: false };
	const [{ repos, levels, authExpired }, allWaiting] = await Promise.all([visibleRepos(locals.user), listOpenHumanRequests(db())]);
	const counts = await countsByRepo(db(), repos.map((r) => r.id));
	const visible = new Set(repos.map((r) => r.id));
	const waiting = allWaiting.filter((w) => visible.has(w.repoId));
	const runPath = { review: 'reviews', analysis: 'analyses', test: 'test-runs' } as const;
	return {
		locale: locals.locale,
		user: locals.user,
		authExpired,
		// The sidebar shows each repository with its own menu: counts, and whether an admin still has to finish the setup.
		repos: repos.map((r) => {
			const c = counts.get(r.id) ?? { tests: 0, reviews: 0, roles: 0 };
			return {
				fullName: r.fullName,
				path: repoPath(r),
				// false for the offline demo repo, which does not exist on GitHub.
				onGithub: !(devFixtures() && r.fullName === DEMO_REPO),
				level: levels.get(r.id) ?? 'read',
				testCount: c.tests,
				reviewCount: c.reviews,
				// The repo page's "ready" rule: data confirmed, a role, and a key (the demo needs none).
				setupIncomplete: !(r.dataConfirmed && c.roles > 0 && (Boolean(r.anthropicKeyEnc) || keyOptional(r)))
			};
		}),
		// Runs paused for a person (CAPTCHA); shown on every page so nobody misses them.
		waiting: waiting.map((w) => ({ id: w.id, reason: w.reason, repo: w.repoFullName, href: `/${runPath[w.runKind]}/${w.runRefId}` }))
	};
};
