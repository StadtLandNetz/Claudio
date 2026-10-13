<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	const repos = $derived(data.repos ?? []);

	// The repository the current page belongs to, whatever kind of page it is.
	const currentRepo = $derived.by((): string | null => {
		if (page.params.owner && page.params.name) return `${page.params.owner}/${page.params.name}`;
		const d = page.data as Record<string, any>;
		const candidate = d.review?.repo ?? d.analysis?.repo ?? d.script?.repo ?? d.run?.repo ?? (typeof d.repo === 'string' ? d.repo : null);
		return typeof candidate === 'string' ? candidate : null;
	});

	const nav = [
		{ href: '/', label: 'Übersicht', match: (p: string) => p === '/' || p.startsWith('/reviews') },
		{ href: '/repos', label: 'Repositories', match: (p: string) => p === '/repos' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Claudio</title>
</svelte:head>

{#if data.user}
	<div class="shell">
		<header class="side">
			<a class="mark" href="/" aria-label="Claudio, zur Übersicht">
				<img src={favicon} alt="" width="26" height="26" />
				<span>Claudio</span>
			</a>
			<nav aria-label="Hauptnavigation">
				{#each nav as item (item.href)}
					<a href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}>{item.label}</a>
				{/each}
			</nav>
			{#if repos.length}
				<ul class="repo-list" aria-label="Eingerichtete Repositories">
					{#each repos as repo (repo.fullName)}
						{@const [owner, name] = repo.fullName.split('/')}
						<li>
							<a href="/repos/{repo.fullName}" aria-current={currentRepo === repo.fullName ? 'page' : undefined} title={repo.fullName}>
								<span class="owner">{owner}/</span>{name}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
			<a class="btn add" href="/repos#hinzufuegen">Repository hinzufügen</a>
			<div class="me">
				{#if data.user.avatarUrl}
					<img src={data.user.avatarUrl} alt="" width="28" height="28" />
				{/if}
				<span class="who" title={data.user.name ?? data.user.login}>{data.user.login}</span>
				<form method="POST" action="/auth/logout">
					<button class="logout" type="submit">Abmelden</button>
				</form>
			</div>
		</header>
		<main>
			{#each (data.waiting ?? []).filter((w) => w.href !== page.url.pathname) as w (w.id)}
				<a class="waiting" href={w.href}>
					<span class="pulse" aria-hidden="true"></span>
					<span><strong>Claudio wartet auf dich:</strong> {w.reason} <span class="faint">({w.repo})</span></span>
					<span class="go">Öffnen</span>
				</a>
			{/each}
			{#if currentRepo}
				{@const info = repos.find((r) => r.fullName === currentRepo)}
				{@const onRepoPage = Boolean(page.params.owner)}
				<!-- On the repo page the heading already names the repo; the bar then only carries the GitHub link. -->
				{#if !onRepoPage || info?.onGithub}
				<div class="repobar">
					{#if !onRepoPage}<a class="repo-name" href="/repos/{currentRepo}">{currentRepo}</a>{/if}
					{#if info?.onGithub}
						<a class="btn small" href="https://github.com/{currentRepo}" target="_blank" rel="noopener noreferrer">Auf GitHub</a>
					{/if}
				</div>
				{/if}
			{/if}
			{@render children()}
		</main>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.shell {
		display: grid;
		grid-template-columns: 13.5rem minmax(0, 1fr);
		min-height: 100dvh;
	}
	.side {
		position: sticky;
		top: 0;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
		padding: 1.25rem 1rem;
		border-right: 1px solid var(--rule);
		background: var(--sheet);
	}
	.mark {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 800;
		font-size: 1.125rem;
		color: var(--ink);
		text-decoration: none;
		padding: 0 0.5rem;
	}
	nav {
		display: grid;
		gap: 0.15rem;
	}
	nav a {
		color: var(--ink-2);
		text-decoration: none;
		font-weight: 600;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-s);
	}
	nav a:hover {
		background: var(--sunken);
		color: var(--ink);
	}
	nav a[aria-current='page'] {
		background: var(--petrol-soft);
		color: var(--petrol);
	}
	.add {
		justify-content: center;
		font-size: 0.875rem;
	}
	.repo-list {
		list-style: none;
		margin: -1.25rem 0 0;
		padding: 0 0 0 0.6rem;
		display: grid;
		gap: 0.1rem;
		max-height: 40vh;
		overflow-y: auto;
		border-left: 1px solid var(--rule);
		margin-left: 0.6rem;
	}
	.repo-list a {
		display: block;
		padding: 0.3rem 0.5rem;
		border-radius: var(--radius-s);
		color: var(--ink-2);
		text-decoration: none;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repo-list a:hover {
		background: var(--sunken);
		color: var(--ink);
	}
	.repo-list a[aria-current='page'] {
		background: var(--petrol-soft);
		color: var(--petrol);
		font-weight: 600;
	}
	.owner {
		color: var(--ink-3);
		font-weight: 400;
	}
	.waiting {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 1rem;
		margin-bottom: 1rem;
		border: 1px solid var(--major);
		border-left-width: 6px;
		border-radius: var(--radius-s);
		background: var(--major-soft);
		color: var(--ink);
		text-decoration: none;
	}
	.waiting .go {
		margin-left: auto;
		font-weight: 600;
		color: var(--major);
	}
	.waiting .pulse {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--major);
		flex: none;
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	.repobar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	.repo-name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--ink-2);
		text-decoration: none;
	}
	.repo-name:hover {
		color: var(--petrol);
		text-decoration: underline;
	}
	.me {
		margin-top: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		padding: 0 0.5rem;
	}
	.me img {
		border-radius: 50%;
	}
	.who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
	}
	.logout {
		font: inherit;
		font-size: 0.8125rem;
		background: none;
		border: 0;
		color: var(--ink-3);
		cursor: pointer;
		padding: 0.2rem;
	}
	.logout:hover {
		color: var(--ink);
		text-decoration: underline;
	}
	main {
		padding: 2rem clamp(1rem, 4vw, 3rem) 4rem;
		max-width: 72rem;
		width: 100%;
	}

	@media (max-width: 760px) {
		.shell {
			grid-template-columns: 1fr;
		}
		.side {
			position: static;
			height: auto;
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.75rem 1rem;
			padding: 0.75rem 1rem;
			border-right: 0;
			border-bottom: 1px solid var(--rule);
		}
		nav {
			display: flex;
			order: 3;
			width: 100%;
		}
		.add {
			order: 5;
		}
		.repo-list {
			order: 4;
			width: 100%;
			max-height: none;
			margin: 0;
			border-left: 0;
			padding: 0;
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem;
		}
		.me {
			margin: 0 0 0 auto;
		}
		.who {
			display: none;
		}
		main {
			padding: 1.25rem 1rem 3rem;
		}
	}
</style>
