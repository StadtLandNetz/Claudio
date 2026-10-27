<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/claudio-64.png';
	import { navigating, page } from '$app/state';
	import Icon from '#lib/components/Icon.svelte';
	import LocaleSwitch from '#lib/components/LocaleSwitch.svelte';
	import ThemeSwitch from '#lib/components/ThemeSwitch.svelte';
	import { forgeName, splitRepo } from '@claudio/core';
	import { provideI18n, type MessageKey } from '#lib/i18n/index.js';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	// Texts name the GitHub or GitLab of the repository on screen; elsewhere the person's only account, else GitHub.
	const i = provideI18n(
		() => data.locale,
		() => repos.find((r) => r.path === currentRepo)?.provider ?? (data.user?.providers.length === 1 ? data.user.providers[0]! : 'github')
	);
	const repos = $derived(data.repos ?? []);
	// With GitHub and GitLab connected, each repository says where it lives.
	const both = $derived((data.user?.providers.length ?? 0) > 1);

	// The repository the current page belongs to (its path below /repos), whatever kind of page it is.
	const currentRepo = $derived.by((): string | null => {
		if (page.params.path) return page.params.path;
		const d = page.data as Record<string, any>;
		const path = d.review?.repoPath ?? d.analysis?.repoPath ?? d.script?.repoPath ?? d.run?.repoPath ?? d.repoPath ?? d.repo?.path;
		if (typeof path === 'string') return path;
		const name = d.review?.repo ?? d.analysis?.repo ?? d.script?.repo ?? d.run?.repo ?? (typeof d.repo === 'string' ? d.repo : d.repo?.fullName);
		return typeof name === 'string' ? (repos.find((r) => r.fullName === name)?.path ?? null) : null;
	});

	const nav = [
		{ href: '/', icon: 'overview', label: 'common.navOverview', match: (p: string) => p === '/' },
		{ href: '/kosten', icon: 'costs', label: 'common.navCosts', match: (p: string) => p === '/kosten' }
	] as const;

	// The repository's own menu, shown under it in the sidebar on every page that belongs to it.
	const REPO_TABS = ['overview', 'pulls', 'reviews', 'tests', 'knowledge', 'settings'] as const;
	type RepoTab = (typeof REPO_TABS)[number];
	const subItems: { id: RepoTab; label: MessageKey }[] = [
		{ id: 'overview', label: 'repo.tabOverview' },
		{ id: 'pulls', label: 'repo.tabPulls' },
		{ id: 'reviews', label: 'repo.tabReviews' },
		{ id: 'tests', label: 'repo.tabTests' },
		{ id: 'knowledge', label: 'repo.tabKnowledge' },
		{ id: 'settings', label: 'repo.tabSettings' }
	];
	const activeTab = $derived.by((): RepoTab | null => {
		const p = page.url.pathname;
		if (page.params.path) {
			const t = page.url.searchParams.get('tab') ?? '';
			return (REPO_TABS as readonly string[]).includes(t) ? (t as RepoTab) : 'overview';
		}
		if (p.startsWith('/tests/') || p.startsWith('/test-runs/')) return 'tests';
		if (p === '/reviews/new') return 'pulls';
		if (p.startsWith('/reviews/')) return 'reviews';
		if (p.startsWith('/analyses/')) return 'knowledge';
		return null;
	});

	// A thin bar at the top while a navigation takes longer than a moment; it fills up and fades when the page is there.
	let bar = $state<'idle' | 'busy' | 'done'>('idle');
	$effect(() => {
		if (!navigating.to) return;
		const start = setTimeout(() => (bar = 'busy'), 150);
		return () => {
			clearTimeout(start);
			if (bar !== 'busy') return;
			bar = 'done';
			setTimeout(() => (bar = 'idle'), 450);
		};
	});

	// The list folds away, the current repository stays. Remembered per browser.
	const LIST_KEY = 'claudio_repo_list';
	let reposOpen = $state(true);
	$effect(() => {
		try {
			if (localStorage.getItem(LIST_KEY) === 'collapsed') reposOpen = false;
		} catch {}
	});
	function toggleRepos() {
		reposOpen = !reposOpen;
		try {
			localStorage.setItem(LIST_KEY, reposOpen ? 'open' : 'collapsed');
		} catch {}
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<title>Claudio</title>
</svelte:head>

{#if bar !== 'idle'}
	<div class="progress {bar}" role="progressbar" aria-label={i.t('common.loading')} aria-busy={bar === 'busy'}></div>
{/if}

{#if data.user}
	<div class="shell">
		<header class="side">
			<a class="mark" href="/" aria-label={i.t('common.homeLabel')}>
				<img src={favicon} alt="" width="20" height="20" />
				<span>Claudio</span>
			</a>
			<nav aria-label={i.t('common.mainNav')}>
				{#each nav as item (item.href)}
					<a href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}>
						<Icon name={item.icon} />
						{i.t(item.label)}
					</a>
				{/each}
			</nav>
			<section class="repos" aria-label={i.t('common.setUpRepos')}>
				<div class="section">
					{#if repos.length}
						<button type="button" class="toggle" aria-expanded={reposOpen} aria-controls="repo-list" aria-label={i.t('common.toggleRepos')} title={i.t('common.toggleRepos')} onclick={toggleRepos}>
							<Icon name="chevron" size={12} />
						</button>
					{/if}
					<a class="all" href="/repos" aria-current={page.url.pathname === '/repos' ? 'page' : undefined}>{i.t('common.navRepos')}</a>
					<a class="plus" href="/repos#hinzufuegen" title={i.t('common.addRepo')} aria-label={i.t('common.addRepo')}><Icon name="plus" size={14} /></a>
				</div>
				{#if repos.length}
					<ul class="repo-list" id="repo-list" class:collapsed={!reposOpen}>
						{#each repos as repo (repo.path)}
							{@const { namespace, name } = splitRepo(repo.fullName)}
							{@const current = currentRepo === repo.path}
							<li class:current>
								<a href="/repos/{repo.path}" class="repo" class:current title={repo.fullName}>
									<span class="avatar" aria-hidden="true">{name?.[0]?.toUpperCase() ?? '?'}</span>
									<span class="label"><span class="owner">{namespace}/</span>{name}</span>
									{#if both}<span class="forge" title={forgeName(repo.provider)}>{repo.provider === 'gitlab' ? 'GL' : 'GH'}</span>{/if}
								</a>
								{#if current}
									<ul class="sub" aria-label={i.t('repo.tabsLabel')}>
										{#each subItems.filter((it) => it.id !== 'settings' || repo.level === 'admin') as it (it.id)}
											<li>
												<a href="/repos/{repo.path}{it.id === 'overview' ? '' : `?tab=${it.id}`}" aria-current={activeTab === it.id ? 'page' : undefined}>
													{i.t(it.label)}
													{#if it.id === 'reviews' && repo.reviewCount}<span class="count">{repo.reviewCount}</span>{/if}
													{#if it.id === 'tests' && repo.testCount}<span class="count">{repo.testCount}</span>{/if}
													{#if it.id === 'settings' && repo.setupIncomplete}<span class="dot major" title={i.t('repo.setupIncomplete')}></span>{/if}
												</a>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
			<div class="foot">
				<div class="prefs">
					<LocaleSwitch />
					<ThemeSwitch />
				</div>
				<div class="me">
					{#if data.user.avatarUrl}
						<img src={data.user.avatarUrl} alt="" width="20" height="20" />
					{:else}
						<span class="avatar" aria-hidden="true">{data.user.login[0]?.toUpperCase()}</span>
					{/if}
					<span class="who" title={data.user.name ?? data.user.login}>{data.user.login}</span>
					<form method="POST" action="/auth/logout">
						<button class="logout" type="submit">{i.t('common.signOut')}</button>
					</form>
				</div>
			</div>
		</header>
		<main>
			<div class="content">
				{#each data.authExpired ?? [] as provider (provider)}
					<div class="notice error expired" role="alert">
						{i.with(provider).t('common.authExpired')}
						<a class="btn small" href="/auth/{provider}?next={encodeURIComponent(page.url.pathname + page.url.search)}" data-sveltekit-reload>
							{i.with(provider).t('common.reconnect')}
						</a>
					</div>
				{/each}
				{#each (data.waiting ?? []).filter((w) => w.href !== page.url.pathname) as w (w.id)}
					<a class="waiting" href={w.href}>
						<span class="dot major live" aria-hidden="true"></span>
						<span><strong>{i.t('common.waitingForYou')}</strong> {w.reason} <span class="faint">({w.repo})</span></span>
						<span class="go">{i.t('common.open')}</span>
					</a>
				{/each}
				<!-- A new page starts fresh: filters, "show all" and open forms do not carry over from the last one -->
				{#key page.url.pathname}{@render children()}{/key}
			</div>
		</main>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	/* Navigation progress: 2px at the very top, grows while loading, fills and fades when done */
	.progress {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 100;
		height: 2px;
		width: 30%;
		background: var(--accent-fill);
		box-shadow: 0 0 6px color-mix(in srgb, var(--accent-fill) 60%, transparent);
		pointer-events: none;
	}
	.progress.busy {
		animation: progress-grow 8s cubic-bezier(0.1, 0.7, 0.2, 1) forwards;
	}
	.progress.done {
		width: 100%;
		opacity: 0;
		transition:
			width 0.15s ease-out,
			opacity 0.3s ease-out 0.15s;
	}
	@keyframes progress-grow {
		from {
			width: 0;
		}
		to {
			width: 90%;
		}
	}
	.shell {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		min-height: 100dvh;
	}
	.side {
		position: sticky;
		top: 0;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.75rem 0.625rem;
		overflow-y: auto;
	}
	.mark {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 1.75rem;
		padding: 0 0.5rem;
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--ink);
		text-decoration: none;
	}
	.mark:hover {
		text-decoration: none;
	}
	.mark img {
		border-radius: 50%;
	}
	nav,
	.repo-list {
		display: grid;
		gap: 1px;
	}
	nav a,
	.repo-list a {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 1.75rem;
		padding: 0 0.5rem;
		border-radius: var(--radius-s);
		color: var(--ink-2);
		font-weight: 500;
		font-size: var(--text-sm);
		text-decoration: none;
		min-width: 0;
	}
	nav a :global(svg) {
		color: var(--ink-3);
	}
	nav a:hover,
	.repo-list a:hover {
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		color: var(--ink);
		text-decoration: none;
	}
	nav a[aria-current='page'],
	.repo-list a[aria-current='page'] {
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		color: var(--ink);
	}
	nav a[aria-current='page'] :global(svg) {
		color: var(--ink);
	}
	.repos {
		display: grid;
		gap: 0.25rem;
		align-content: start;
		min-height: 0;
	}
	.section {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		height: 1.5rem;
		padding: 0 0.25rem;
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-3);
	}
	.section > .all {
		flex: 1;
		color: inherit;
	}
	.section > .all:hover,
	.section > .all[aria-current='page'] {
		color: var(--ink);
		text-decoration: none;
	}
	.toggle {
		display: inline-grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: none;
		color: var(--ink-3);
		cursor: pointer;
	}
	.toggle:hover {
		color: var(--ink);
		background: color-mix(in srgb, var(--ink) 6%, transparent);
	}
	.toggle :global(svg) {
		transition: transform 0.12s;
	}
	.toggle[aria-expanded='true'] :global(svg) {
		transform: rotate(90deg);
	}
	/* Folded: only the current repository (with its menu) stays visible */
	.repo-list.collapsed > li:not(.current) {
		display: none;
	}
	.repo-list a.repo.current {
		color: var(--ink);
		font-weight: 600;
	}
	.sub {
		list-style: none;
		margin: 0.125rem 0 0.35rem;
		padding: 0;
		display: grid;
		gap: 1px;
	}
	.sub a {
		height: 1.625rem;
		padding-left: 2rem;
		font-weight: 400;
	}
	.sub a[aria-current='page'] {
		font-weight: 500;
	}
	.count {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}
	.sub .dot {
		width: 0.4rem;
		height: 0.4rem;
		margin-left: auto;
	}
	.plus {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 3px;
		color: var(--ink-3);
	}
	.plus:hover {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		color: var(--ink);
		text-decoration: none;
	}
	.repo-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.forge {
		flex: none;
		margin-left: auto;
		padding: 0 0.25rem;
		border-radius: 3px;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink-3);
		background: color-mix(in srgb, var(--ink) 6%, transparent);
	}
	.repo-list .label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.owner {
		color: var(--ink-3);
		font-weight: 400;
	}
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1rem;
		height: 1rem;
		border-radius: 3px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1;
	}
	.foot {
		margin-top: auto;
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--rule);
	}
	.prefs {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0 0.25rem;
	}
	.me {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 1.75rem;
		padding: 0 0.5rem;
		font-size: var(--text-sm);
	}
	.me img {
		border-radius: 50%;
	}
	.who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}
	.logout {
		font: inherit;
		font-size: var(--text-xs);
		background: none;
		border: 0;
		color: var(--ink-3);
		cursor: pointer;
		padding: 0.2rem 0.25rem;
		border-radius: 3px;
	}
	.logout:hover {
		color: var(--ink);
		background: color-mix(in srgb, var(--ink) 6%, transparent);
	}

	/* The content area: a raised panel inset from the sidebar */
	/* Clips the sticky page header's extension to the panel; vertical overflow stays visible, so sticky still works */
	main {
		min-width: 0;
		overflow-x: clip;
		margin: 0.5rem 0.5rem 0.5rem 0;
		background: var(--panel);
		border: 1px solid var(--rule);
		border-radius: var(--radius-l);
		box-shadow: var(--shadow);
	}
	.content {
		--pad-x: 2rem;
		max-width: 72rem;
		padding: 1.5rem var(--pad-x) 4rem;
	}
	.expired {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.waiting {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.75rem;
		margin-bottom: 1rem;
		border: 1px solid color-mix(in srgb, var(--major) 40%, transparent);
		border-radius: var(--radius-m);
		background: var(--major-soft);
		color: var(--ink);
		text-decoration: none;
	}
	.waiting:hover {
		text-decoration: none;
		border-color: var(--major);
	}
	.waiting .go {
		margin-left: auto;
		font-weight: 500;
		color: var(--major);
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
			gap: 0.5rem 0.75rem;
			padding: 0.5rem 0.75rem;
		}
		nav {
			display: flex;
			order: 3;
			width: 100%;
		}
		.repos {
			order: 4;
			width: 100%;
		}
		.repo-list {
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem;
		}
		/* On phones the list is always a wrapping row; the menu becomes a row of its own below it */
		.toggle {
			display: none;
		}
		.repo-list > li,
		.repo-list.collapsed > li:not(.current) {
			display: contents;
		}
		.sub {
			order: 99;
			flex-basis: 100%;
			display: flex;
			gap: 0.125rem;
			margin: 0.25rem 0 0;
			padding-bottom: 0.25rem;
			overflow-x: auto;
		}
		.sub a {
			padding-left: 0.5rem;
			white-space: nowrap;
		}
		.foot {
			order: 2;
			margin: 0 0 0 auto;
			padding: 0;
			border: 0;
			display: flex;
			align-items: center;
		}
		.who {
			display: none;
		}
		main {
			margin: 0 0.5rem 0.5rem;
		}
		.content {
			--pad-x: 1rem;
			padding: 1rem var(--pad-x) 3rem;
		}
	}
</style>
