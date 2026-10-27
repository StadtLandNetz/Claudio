<script lang="ts">
	import { enhance } from '$app/forms';
	import { forgeName } from '@claudio/core';
	import PageNav from '#lib/components/PageNav.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = i18n();
	// One search per provider block.
	let queries = $state<Record<string, string>>({});

	const filteredOf = (source: (typeof data.sources)[number]) => {
		const q = (queries[source.provider] ?? '').trim().toLowerCase();
		const list = q ? source.repos.filter((g) => g.fullName.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)) : source.repos;
		return list.slice(0, 60);
	};
	const both = $derived(data.accounts.length > 1);
</script>

<svelte:head><title>{i.t('common.reposTitle')}</title></svelte:head>

<div class="page-title">
	<div>
		<h1>{i.t('common.repositories')}</h1>
		<p class="lead">{i.t('common.reposIntro')}</p>
	</div>
</div>

<PageNav
	title={i.t('common.repositories')}
	sections={[
		{ id: 'eingerichtet', label: i.t('common.reposSetUp'), count: data.repos.length },
		...data.sources.map((s) => ({ id: s.provider === data.sources[0]?.provider ? 'hinzufuegen' : `hinzufuegen-${s.provider}`, label: i.with(s.provider).t('common.addFromGithub') })),
		{ id: 'konten', label: i.t('common.connectedAccounts') }
	]}
/>

{#if form?.error && !form.provider}
	<p class="notice error" role="alert">{form.error}</p>
{/if}

<section class="block" id="eingerichtet">
	<h2>{i.t('common.reposSetUp')}</h2>
	{#if data.repos.length > 0}
		<ul class="repos sheet">
			{#each data.repos as repo (repo.path)}
				<li>
					<a href="/repos/{repo.path}">{repo.fullName}</a>
					{#if both}<span class="tag">{forgeName(repo.provider)}</span>{/if}
					<span class="faint">
						{repo.lastReview ? i.t('common.lastReview', { date: i.formatDate(repo.lastReview) }) : i.t('common.noReviewYet')}
					</span>
					{#if !repo.dataConfirmed}
						<a class="setup" href="/repos/{repo.path}?tab=settings">{i.t('common.finishSetup')}</a>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">{i.t('common.noReposYet')}</p>
	{/if}
	{#if data.demoAvailable}
		<form method="POST" action="?/demo" class="demo">
			<button class="btn" type="submit">{i.t('common.createDemo')}</button>
			<span class="faint">{i.t('common.demoHintBefore')} <code>apps/demo-target</code> {i.t('common.demoHintAfter')}</span>
		</form>
	{/if}
</section>

{#each data.sources as source, k (source.provider)}
	{@const fi = i.with(source.provider)}
	{@const filtered = filteredOf(source)}
	<section class="block" id={k === 0 ? 'hinzufuegen' : `hinzufuegen-${source.provider}`}>
		<div class="gh-head">
			<h2>{fi.t('common.addFromGithub')}</h2>
			{#if source.repos.length > 0}
				<label class="search">
					<span class="visually-hidden">{i.t('common.searchRepos')}</span>
					<input type="search" placeholder={i.t('common.searchPlaceholder')} bind:value={queries[source.provider]} />
				</label>
			{/if}
		</div>

		{#if form?.error && form.provider === source.provider}
			<p class="notice error" role="alert">{form.error}</p>
		{/if}

		{#if !source.connected}
			<div class="connect sheet">
				<p>{fi.t('common.connectHint')}</p>
				<a class="btn primary" href="/auth/{source.provider}?next={encodeURIComponent(`/repos#hinzufuegen-${source.provider}`)}" data-sveltekit-reload>
					{fi.t('common.connectProvider')}
				</a>
			</div>
		{:else if source.error}
			<p class="notice">{source.error}</p>
		{:else if filtered.length === 0}
			<p class="muted">{i.t('common.noRepoMatches', { query: queries[source.provider] ?? '' })}</p>
		{:else}
			<ul class="gh sheet">
				{#each filtered as repo (repo.fullName)}
					<li>
						<div class="name">
							<strong>{repo.fullName}</strong>
							{#if repo.isPrivate}<span class="tag">{i.t('common.private')}</span>{/if}
							{#if repo.description}<p class="faint">{repo.description}</p>{/if}
						</div>
						{#if repo.added}
							<a class="btn small" href="/repos/{repo.path}">{i.t('common.open')}</a>
						{:else}
							<form method="POST" action="?/add">
								<input type="hidden" name="provider" value={source.provider} />
								<input type="hidden" name="fullName" value={repo.fullName} />
								<button class="btn small primary" type="submit">{i.t('common.add')}</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
			{#if source.repos.length > filtered.length && !queries[source.provider]}
				<p class="faint more">{i.t('common.moreRepos', { shown: filtered.length, total: source.repos.length })}</p>
			{/if}
		{/if}

		{#if source.canAdd}
			<form method="POST" action="?/add" class="by-name sheet">
				<input type="hidden" name="provider" value={source.provider} />
				<label class="field">
					<span>{i.t('common.repoNotListed')}</span>
					<input
						type="text"
						name="fullName"
						required
						placeholder={source.gitlabUrl ? i.t('common.repoNamePlaceholderGitlab', { host: source.gitlabUrl }) : i.t('common.repoNamePlaceholder')}
					/>
					<small>
						{i.t('common.orgReposHint')}
						{#if source.grantUrl}<a href={source.grantUrl} target="_blank" rel="noopener noreferrer">{fi.t('common.manageGrant')}</a>{/if}
					</small>
				</label>
				<button class="btn primary" type="submit">{i.t('common.add')}</button>
			</form>
		{/if}
	</section>
{/each}

<section class="block" id="konten">
	<h2>{i.t('common.connectedAccounts')}</h2>
	{#if data.takenError}
		<p class="notice error" role="alert">{data.takenError}</p>
	{/if}
	<p class="faint">{i.t('common.connectedAccountsHint')}</p>
	<ul class="repos sheet">
		{#each data.accounts as account (account.provider)}
			<li>
				<span class="tag">{forgeName(account.provider)}</span>
				<strong>@{account.login}</strong>
				{#if data.accounts.length > 1}
					<form method="POST" action="?/unlink" use:enhance class="unlink">
						<input type="hidden" name="provider" value={account.provider} />
						<button class="btn small" type="submit">{i.t('common.disconnect')}</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
	{#if data.gitlabMissing}
		<p class="faint">{i.t('common.gitlabNotConfigured')}</p>
	{/if}
</section>

<style>
	.connect {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.9rem 1rem;
	}
	.connect p {
		margin: 0;
		max-width: 46rem;
	}
	.unlink {
		margin-left: auto;
	}
	.notice {
		margin-bottom: 1rem;
	}
	.block .notice {
		margin-bottom: 0;
	}
	.block {
		display: grid;
		gap: 0.6rem;
	}
	.block + .block {
		margin-top: 1.75rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.repos li,
	.gh li {
		display: flex;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		flex-wrap: wrap;
	}
	li:last-child {
		border-bottom: 0;
	}
	/* Set-up rows lead to the repo; the GitHub rows only carry a button */
	.repos li:hover {
		background: var(--sunken);
	}
	.repos a:first-child {
		font-weight: 500;
		color: var(--ink);
	}
	.setup {
		margin-left: auto;
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--major);
	}
	.demo {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}
	.gh-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.search {
		width: min(18rem, 100%);
	}
	.name {
		flex: 1;
		min-width: 12rem;
	}
	.name strong {
		font-weight: 500;
	}
	.name p {
		margin-top: 0.1rem;
	}
	.tag {
		margin-left: 0.25rem;
	}
	.by-name {
		display: flex;
		align-items: flex-end;
		gap: 0.6rem;
		padding: 1rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}
	.by-name .field {
		flex: 1;
		min-width: 16rem;
	}
</style>
