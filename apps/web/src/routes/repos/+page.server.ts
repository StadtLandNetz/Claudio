import { fail, redirect } from '@sveltejs/kit';
import { addRepo, lastReviewByRepo } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { userToken } from '#lib/server/auth.js';
import { forget, swr } from '#lib/server/cache.js';
import { db } from '#lib/server/db.js';
import { createDemoRepo, DEMO_REPO } from '#lib/server/demo.js';
import { devFixtures, githubOAuthConfig } from '#lib/server/env.js';
import { getRepoInfo, githubErrorMessage, listUserRepos, type GithubRepo } from '#lib/server/github.js';
import { serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { t } = serverI18n(locals.locale);
	const { repos } = await visibleRepos(locals.user!);
	const [lastReview, token] = await Promise.all([lastReviewByRepo(db(), repos.map((r) => r.id)), userToken(locals.user!)]);

	let github: GithubRepo[] = [];
	let githubError: string | null = null;
	if (token) {
		try {
			// Paging through every repository of the account takes a while; a minute-old list is fine here.
			github = await swr(`github-repos:${locals.user!.id}`, 60_000, 10 * 60_000, () => listUserRepos(token));
		} catch (e) {
			githubError = githubErrorMessage(e);
		}
	} else {
		githubError = t('common.noGithubSession');
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
		const { t } = serverI18n(locals.locale);
		// Accepts owner/name or a GitHub URL.
		const fullName = String((await request.formData()).get('fullName') ?? '')
			.trim()
			.replace(/^https?:\/\/github\.com\//i, '')
			.replace(/\.git$/i, '')
			.replace(/\/+$/, '');
		if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return fail(400, { error: t('common.repoNameInvalid') });
		const token = await userToken(locals.user!);
		if (!token) return fail(400, { error: t('common.addNeedsGithub') });
		let info;
		try {
			info = await getRepoInfo(token, fullName);
		} catch (e) {
			return fail(400, { error: githubErrorMessage(e) });
		}
		if (!info.canWrite) return fail(403, { error: t('common.addNeedsWrite') });
		await addRepo(db(), { fullName: info.fullName, isPrivate: info.isPrivate, defaultBranch: info.defaultBranch, createdBy: locals.user!.id });
		forget(`github-repos:${locals.user!.id}`);
		redirect(303, `/repos/${info.fullName}?tab=settings&new=1`);
	},
	demo: async ({ locals }) => {
		if (!devFixtures()) return fail(404, { error: serverI18n(locals.locale).t('common.demoDisabled') });
		await createDemoRepo(db(), locals.user!.id);
		redirect(303, `/repos/${DEMO_REPO}`);
	}
};
