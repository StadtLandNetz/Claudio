import { fail, redirect } from '@sveltejs/kit';
import { addRepo, listReviews } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { userToken } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { createDemoRepo, DEMO_REPO } from '#lib/server/demo.js';
import { devFixtures, githubOAuthConfig } from '#lib/server/env.js';
import { getRepoInfo, githubErrorMessage, listUserRepos, type GithubRepo } from '#lib/server/github.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { repos } = await visibleRepos(locals.user!);
	const reviews = await listReviews(db(), { limit: 500, repoIds: repos.map((r) => r.id) });
	const lastReview = new Map<number, Date>();
	for (const r of reviews) if (!lastReview.has(r.repoId)) lastReview.set(r.repoId, r.createdAt);

	const token = await userToken(locals.user!);
	let github: GithubRepo[] = [];
	let githubError: string | null = null;
	if (token) {
		try {
			github = await listUserRepos(token);
		} catch (e) {
			githubError = githubErrorMessage(e);
		}
	} else {
		githubError = 'Du bist ohne GitHub angemeldet. Melde dich mit GitHub an, um deine Repositories zu laden.';
	}

	const added = new Set(repos.map((r) => r.fullName));
	return {
		repos: repos.map((r) => ({
			fullName: r.fullName,
			isPrivate: r.isPrivate,
			dataConfirmed: r.dataConfirmed,
			lastReview: lastReview.get(r.id) ?? null
		})),
		github: github.map((g) => ({ ...g, added: added.has(g.fullName) })),
		githubError,
		demoAvailable: devFixtures() && !added.has(DEMO_REPO),
		// Organisations with OAuth access restrictions must grant Claudio access before their repos show up.
		grantUrl: githubOAuthConfig() ? `https://github.com/settings/connections/applications/${githubOAuthConfig()!.clientId}` : null,
		hasToken: Boolean(token)
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		// Accepts owner/name or a GitHub URL.
		const fullName = String((await request.formData()).get('fullName') ?? '')
			.trim()
			.replace(/^https?:\/\/github\.com\//i, '')
			.replace(/\.git$/i, '')
			.replace(/\/+$/, '');
		if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return fail(400, { error: 'Gib das Repository als besitzer/name an.' });
		const token = await userToken(locals.user!);
		if (!token) return fail(400, { error: 'Zum Hinzufügen brauchst du eine Anmeldung mit GitHub.' });
		let info;
		try {
			info = await getRepoInfo(token, fullName);
		} catch (e) {
			return fail(400, { error: githubErrorMessage(e) });
		}
		if (!info.canWrite) return fail(403, { error: 'Zum Einrichten in Claudio brauchst du Schreibrechte an diesem Repository auf GitHub.' });
		await addRepo(db(), { fullName: info.fullName, isPrivate: info.isPrivate, defaultBranch: info.defaultBranch, createdBy: locals.user!.id });
		redirect(303, `/repos/${info.fullName}?tab=settings&new=1`);
	},
	demo: async ({ locals }) => {
		if (!devFixtures()) return fail(404, { error: 'Die Demo ist nicht aktiviert.' });
		await createDemoRepo(db(), locals.user!.id);
		redirect(303, `/repos/${DEMO_REPO}`);
	}
};
