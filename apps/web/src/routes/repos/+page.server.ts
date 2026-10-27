import { PROVIDERS, ProviderSchema, parseRepoInput, repoHref, repoPath, type Provider } from '@claudio/core';
import { fail, redirect } from '@sveltejs/kit';
import { addRepo, clearAccess, lastReviewByRepo, listIdentities, unlinkIdentity } from '@claudio/db';
import { visibleRepos } from '#lib/server/access.js';
import { forget, swr } from '#lib/server/cache.js';
import { db } from '#lib/server/db.js';
import { createDemoRepo, DEMO_REPO } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import { forgeErrorMessage, userForge } from '#lib/server/forge.js';
import { gitlabBaseUrl, gitlabHost, oauth, type RepoSummary } from '@claudio/forge';
import { serverI18n } from '#lib/i18n/index.js';
import type { Actions, PageServerLoad } from './$types';
import { accountProvider } from '#lib/server/i18n.js';

const providerOf = (v: FormDataEntryValue | null): Provider | null => {
	const p = ProviderSchema.safeParse(String(v ?? ''));
	return p.success ? p.data : null;
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;
	const { repos } = await visibleRepos(user);
	const [lastReview, identities] = await Promise.all([lastReviewByRepo(db(), repos.map((r) => r.id)), listIdentities(db(), user.id)]);
	const added = new Set(repos.map((r) => repoPath(r)));

	// One block per provider the server is set up for (or the person has an account of):
	// the account's repositories to add, or a button to connect the account.
	const sources = await Promise.all(
		PROVIDERS.filter((p) => oauth(p).configured() || user.providers.includes(p)).map(async (provider) => {
			const { t } = serverI18n(locals.locale, provider);
			const connected = user.providers.includes(provider);
			const forge = connected ? await userForge(user, provider) : null;
			let list: RepoSummary[] = [];
			let error: string | null = null;
			if (forge) {
				try {
					// Paging through every repository of the account takes a while; a minute-old list is fine here.
					list = await swr(`${provider}-repos:${user.id}`, 60_000, 10 * 60_000, () => forge.listUserRepos());
				} catch (e) {
					error = forgeErrorMessage(e, provider);
				}
			} else if (connected) {
				error = t('common.noGithubSession');
			}
			return {
				provider,
				connected,
				canAdd: Boolean(forge),
				error,
				// Organisations with OAuth access restrictions must grant Claudio access before their repos show up.
				grantUrl: oauth(provider).grantUrl(),
				gitlabUrl: provider === 'gitlab' ? gitlabBaseUrl() : null,
				repos: list.map((g) => {
					const path = repoPath({ provider, fullName: g.fullName });
					return { ...g, path, added: added.has(path) };
				})
			};
		})
	);

	const takenProvider = url.searchParams.get('error') === 'taken' ? (ProviderSchema.safeParse(url.searchParams.get('provider')).data ?? 'github') : null;
	return {
		repos: repos.map((r) => ({
			fullName: r.fullName,
			provider: r.provider,
			path: repoPath(r),
			isPrivate: r.isPrivate,
			dataConfirmed: r.dataConfirmed,
			lastReview: lastReview.get(r.id) ?? null
		})),
		sources,
		accounts: identities.map((i) => ({ provider: i.provider, login: i.login, avatarUrl: i.avatarUrl })),
		gitlabMissing: !sources.some((s) => s.provider === 'gitlab'),
		takenError: takenProvider ? serverI18n(locals.locale, takenProvider).t('common.identityTaken') : null,
		demoAvailable: devFixtures() && !added.has(DEMO_REPO)
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const f = await request.formData();
		const provider = providerOf(f.get('provider')) ?? accountProvider(locals.user);
		const { t } = serverI18n(locals.locale, provider);
		// Accepts owner/name (group/…/project on GitLab) or a link to the repository.
		const fullName = parseRepoInput(String(f.get('fullName') ?? ''), provider, provider === 'gitlab' ? gitlabHost() : undefined);
		if (!fullName) return fail(400, { error: t('common.repoNameInvalid'), provider });
		const forge = await userForge(locals.user, provider);
		if (!forge) return fail(400, { error: t('common.addNeedsGithub'), provider });
		let info;
		try {
			info = await forge.getRepoInfo(fullName);
		} catch (e) {
			return fail(400, { error: forgeErrorMessage(e, provider), provider });
		}
		if (!info.canWrite) return fail(403, { error: t('common.addNeedsWrite'), provider });
		await addRepo(db(), { provider, fullName: info.fullName, externalId: info.externalId, isPrivate: info.isPrivate, defaultBranch: info.defaultBranch, createdBy: locals.user!.id });
		forget(`${provider}-repos:${locals.user!.id}`);
		redirect(303, repoHref({ provider, fullName: info.fullName }, 'tab=settings&new=1'));
	},
	/** Disconnects a GitHub or GitLab account; its repositories disappear from this person's view. */
	unlink: async ({ request, locals }) => {
		const provider = providerOf((await request.formData()).get('provider'));
		const { t } = serverI18n(locals.locale, provider ?? accountProvider(locals.user));
		if (!provider || !(await unlinkIdentity(db(), locals.user!.id, provider))) return fail(400, { error: t('common.lastIdentity'), provider });
		await clearAccess(db(), locals.user!.id);
		forget(`${provider}-repos:${locals.user!.id}`);
		return { unlinked: provider };
	},
	demo: async ({ locals }) => {
		if (!devFixtures()) return fail(404, { error: serverI18n(locals.locale, accountProvider(locals.user)).t('common.demoDisabled') });
		await createDemoRepo(db(), locals.user!.id);
		redirect(303, repoHref({ provider: 'github', fullName: DEMO_REPO }));
	}
};
