<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const nav = [
		{ href: '/', label: 'Übersicht', match: (p: string) => p === '/' || p.startsWith('/reviews') },
		{ href: '/repos', label: 'Repositories', match: (p: string) => p.startsWith('/repos') }
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
