import { parseRepoInput, repoHref, repoPath } from '@claudio/core';
import { fail, redirect } from '@sveltejs/kit';
import { addRepo, lastReviewByRepo } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { forget, swr } from '#lib/server/cache.js';
import { db } from '#lib/server/db.js';
import { createDemoRepo, DEMO_REPO } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import { forgeErrorMessage, userForge } from '#lib/server/forge.js';
import { gitlabBaseUrl, gitlabHost, oauth, type RepoSummary } from '@claudio/forge';
import { serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { t } = serverI18n(locals.locale, locals.user?.provider);
	const { repos } = await visibleRepos(locals.user!);
	const provider = locals.user!.provider;
	const [lastReview, forge] = await Promise.all([lastReviewByRepo(db(), repos.map((r) => r.id)), userForge(locals.user, provider)]);

	let github: RepoSummary[] = [];
	let githubError: string | null = null;
	if (forge) {
		try {
			// Paging through every repository of the account takes a while; a minute-old list is fine here.
			github = await swr(`${provider}-repos:${locals.user!.id}`, 60_000, 10 * 60_000, () => forge.listUserRepos());
		} catch (e) {
			githubError = forgeErrorMessage(e);
		}
	} else {
		githubError = t('common.noGithubSession');
	}

	const added = new Set(repos.filter((r) => r.provider === provider).map((r) => r.fullName));
	return {
		repos: repos.map((r) => ({
			fullName: r.fullName,
			path: repoPath(r),
			isPrivate: r.isPrivate,
			dataConfirmed: r.dataConfirmed,
			lastReview: lastReview.get(r.id) ?? null
		})),
		github: github.map((g) => ({ ...g, path: repoPath({ provider, fullName: g.fullName }), added: added.has(g.fullName) })),
		githubError,
		demoAvailable: devFixtures() && !added.has(DEMO_REPO),
		// Organisations with OAuth access restrictions must grant Claudio access before their repos show up.
		grantUrl: oauth(provider).grantUrl(),
		hasToken: Boolean(forge),
		gitlabUrl: provider === 'gitlab' ? gitlabBaseUrl() : null
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const { t } = serverI18n(locals.locale, locals.user?.provider);
		// Accepts owner/name (group/…/project on GitLab) or a link to the repository.
		const provider = locals.user!.provider;
		const fullName = parseRepoInput(String((await request.formData()).get('fullName') ?? ''), provider, provider === 'gitlab' ? gitlabHost() : undefined);
		if (!fullName) return fail(400, { error: t('common.repoNameInvalid') });
		const forge = await userForge(locals.user, provider);
		if (!forge) return fail(400, { error: t('common.addNeedsGithub') });
		let info;
		try {
			info = await forge.getRepoInfo(fullName);
		} catch (e) {
			return fail(400, { error: forgeErrorMessage(e) });
		}
		if (!info.canWrite) return fail(403, { error: t('common.addNeedsWrite') });
		await addRepo(db(), { provider, fullName: info.fullName, externalId: info.externalId, isPrivate: info.isPrivate, defaultBranch: info.defaultBranch, createdBy: locals.user!.id });
		forget(`${provider}-repos:${locals.user!.id}`);
		redirect(303, repoHref({ provider, fullName: info.fullName }, 'tab=settings&new=1'));
	},
	demo: async ({ locals }) => {
		if (!devFixtures()) return fail(404, { error: serverI18n(locals.locale, locals.user?.provider).t('common.demoDisabled') });
		await createDemoRepo(db(), locals.user!.id);
		redirect(303, repoHref({ provider: 'github', fullName: DEMO_REPO }));
	}
};
