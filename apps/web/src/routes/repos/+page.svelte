<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = i18n();
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = q ? data.github.filter((g) => g.fullName.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)) : data.github;
		return list.slice(0, 60);
	});
</script>

<svelte:head><title>{i.t('common.reposTitle')}</title></svelte:head>

<h1>{i.t('common.repositories')}</h1>
<p class="muted lead">{i.t('common.reposIntro')}</p>

{#if form?.error}
	<p class="notice error" role="alert">{form.error}</p>
{/if}

<section class="block">
	<h2>{i.t('common.reposSetUp')}</h2>
	{#if data.repos.length > 0}
		<ul class="repos sheet">
			{#each data.repos as repo (repo.fullName)}
				<li>
					<a href="/repos/{repo.fullName}">{repo.fullName}</a>
					<span class="faint">
						{repo.lastReview ? i.t('common.lastReview', { date: i.formatDate(repo.lastReview) }) : i.t('common.noReviewYet')}
					</span>
					{#if !repo.dataConfirmed}
						<a class="setup" href="/repos/{repo.fullName}?tab=settings">{i.t('common.finishSetup')}</a>
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

<section class="block" id="hinzufuegen">
	<div class="gh-head">
		<h2>{i.t('common.addFromGithub')}</h2>
		{#if data.github.length > 0}
			<label class="search">
				<span class="visually-hidden">{i.t('common.searchRepos')}</span>
				<input type="search" placeholder={i.t('common.searchPlaceholder')} bind:value={query} />
			</label>
		{/if}
	</div>

	{#if data.githubError}
		<p class="notice">{data.githubError}</p>
	{:else if filtered.length === 0}
		<p class="muted">{i.t('common.noRepoMatches', { query })}</p>
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
						<a class="btn small" href="/repos/{repo.fullName}">{i.t('common.open')}</a>
					{:else}
						<form method="POST" action="?/add">
							<input type="hidden" name="fullName" value={repo.fullName} />
							<button class="btn small primary" type="submit">{i.t('common.add')}</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
		{#if data.github.length > filtered.length && !query}
			<p class="faint more">{i.t('common.moreRepos', { shown: filtered.length, total: data.github.length })}</p>
		{/if}
	{/if}

	{#if data.hasToken}
		<form method="POST" action="?/add" class="by-name sheet">
			<label class="field">
				<span>{i.t('common.repoNotListed')}</span>
				<input type="text" name="fullName" required placeholder={i.t('common.repoNamePlaceholder')} />
				<small>
					{i.t('common.orgReposHint')}
					{#if data.grantUrl}<a href={data.grantUrl} target="_blank" rel="noopener noreferrer">{i.t('common.manageGrant')}</a>{/if}
				</small>
			</label>
			<button class="btn primary" type="submit">{i.t('common.add')}</button>
		</form>
	{/if}
</section>

<style>
	.lead {
		margin: 0.25rem 0 1.75rem;
	}
	.block {
		margin-bottom: 2.25rem;
		display: grid;
		gap: 0.75rem;
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
		gap: 0.75rem 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--rule);
		flex-wrap: wrap;
	}
	li:last-child {
		border-bottom: 0;
	}
	.repos a:first-child {
		font-weight: 700;
	}
	.setup {
		margin-left: auto;
		font-size: 0.875rem;
		color: var(--major);
	}
	.demo {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.gh-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.search {
		width: min(20rem, 100%);
	}
	.name {
		flex: 1;
		min-width: 12rem;
	}
	.tag {
		font-size: 0.75rem;
		color: var(--ink-3);
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		padding: 0 0.45rem;
		margin-left: 0.35rem;
	}
	.more {
		margin-top: 0.25rem;
	}
	.by-name {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		padding: 1rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.by-name .field {
		flex: 1;
		min-width: 16rem;
	}
</style>
