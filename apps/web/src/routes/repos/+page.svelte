<script lang="ts">
	import { formatDate } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = q ? data.github.filter((g) => g.fullName.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)) : data.github;
		return list.slice(0, 60);
	});
</script>

<svelte:head><title>Repositories · Claudio</title></svelte:head>

<h1>Repositories</h1>
<p class="muted lead">Claudio prüft Pull Requests der Repositories, die hier eingerichtet sind.</p>

{#if form?.error}
	<p class="notice error" role="alert">{form.error}</p>
{/if}

<section class="block">
	<h2>Eingerichtet</h2>
	{#if data.repos.length > 0}
		<ul class="repos sheet">
			{#each data.repos as repo (repo.fullName)}
				<li>
					<a href="/repos/{repo.fullName}">{repo.fullName}</a>
					<span class="faint">
						{repo.lastReview ? `Letzter Review ${formatDate(repo.lastReview)}` : 'Noch kein Review'}
					</span>
					{#if !repo.dataConfirmed}
						<a class="setup" href="/repos/{repo.fullName}?tab=settings">Einrichtung abschließen</a>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">Noch keins. Wähle unten ein Repository aus deinem GitHub-Konto.</p>
	{/if}
	{#if data.demoAvailable}
		<form method="POST" action="?/demo" class="demo">
			<button class="btn" type="submit">Demo-Repository anlegen</button>
			<span class="faint">Die Dispo-Demo aus <code>apps/demo-target</code> mit fertigem Beispiel-PR, ganz ohne GitHub.</span>
		</form>
	{/if}
</section>

<section class="block" id="hinzufuegen">
	<div class="gh-head">
		<h2>Aus GitHub hinzufügen</h2>
		{#if data.github.length > 0}
			<label class="search">
				<span class="visually-hidden">Repositories durchsuchen</span>
				<input type="search" placeholder="Repository suchen" bind:value={query} />
			</label>
		{/if}
	</div>

	{#if data.githubError}
		<p class="notice">{data.githubError}</p>
	{:else if filtered.length === 0}
		<p class="muted">Kein Repository passt zu „{query}“.</p>
	{:else}
		<ul class="gh sheet">
			{#each filtered as repo (repo.fullName)}
				<li>
					<div class="name">
						<strong>{repo.fullName}</strong>
						{#if repo.isPrivate}<span class="tag">privat</span>{/if}
						{#if repo.description}<p class="faint">{repo.description}</p>{/if}
					</div>
					{#if repo.added}
						<a class="btn small" href="/repos/{repo.fullName}">Öffnen</a>
					{:else}
						<form method="POST" action="?/add">
							<input type="hidden" name="fullName" value={repo.fullName} />
							<button class="btn small primary" type="submit">Hinzufügen</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
		{#if data.github.length > filtered.length && !query}
			<p class="faint more">Die {filtered.length} zuletzt geänderten von {data.github.length} Repositories. Suche, um weitere zu finden.</p>
		{/if}
	{/if}

	{#if data.hasToken}
		<form method="POST" action="?/add" class="by-name sheet">
			<label class="field">
				<span>Repository nicht in der Liste?</span>
				<input type="text" name="fullName" required placeholder="besitzer/name oder https://github.com/besitzer/name" />
				<small>
					Repositories von Organisationen erscheinen erst, wenn die Organisation Claudio freigegeben hat.
					{#if data.grantUrl}<a href={data.grantUrl} target="_blank" rel="noopener noreferrer">Freigabe bei GitHub verwalten</a>{/if}
				</small>
			</label>
			<button class="btn primary" type="submit">Hinzufügen</button>
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
