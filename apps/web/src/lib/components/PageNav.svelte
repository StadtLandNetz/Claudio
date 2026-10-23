<script module lang="ts">
	/** A part of the page the header links to: an element with this id. */
	export type Section = { id: string; label: string; count?: number | string; tone?: 'block' | 'major' | 'pass'; tip?: string };
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { i18n } from '#lib/i18n/index.js';
	import { tooltip } from '#lib/tooltip.js';

	/**
	 * The slim header that stays at the top while the page scrolls: the page's title
	 * once the big one has scrolled away, an optional heading, links to the page's
	 * sections with the one in view highlighted, and actions on the right.
	 */
	let {
		title,
		sections = [],
		heading,
		actions
	}: { title: string; sections?: Section[]; heading?: Snippet; actions?: Snippet } = $props();
	const i = i18n();

	let sentinel = $state<HTMLElement>();
	let bar = $state<HTMLElement>();
	let nav = $state<HTMLElement>();
	let stuck = $state(false);
	let active = $state<string | null>(null);
	// A section picked in the header stays highlighted until the person scrolls by themselves.
	let picked: string | null = null;

	// The header is stuck once the line just above it has left the viewport.
	$effect(() => {
		if (!sentinel) return;
		const io = new IntersectionObserver(([e]) => (stuck = !!e && !e.isIntersecting && e.boundingClientRect.top < 0));
		io.observe(sentinel);
		return () => io.disconnect();
	});

	// The current section is the last one whose top has passed that line; at the end of the page, the last one in view.
	$effect(() => {
		const ids = sections.map((s) => s.id);
		if (!ids.length) return;
		let raf = 0;
		const update = () => {
			raf = 0;
			if (picked) {
				active = picked;
				return;
			}
			// A section counts once its heading is in the upper quarter of the screen, below the header.
			const line = Math.max((bar?.getBoundingClientRect().bottom ?? 0) + 24, window.innerHeight * 0.25);
			let current: string | null = null;
			const tops = ids.map((id) => [id, document.getElementById(id)?.getBoundingClientRect().top] as const);
			for (const [id, top] of tops) if (top !== undefined && top <= line) current = id;
			const doc = document.documentElement;
			if (window.scrollY > 0 && window.scrollY + window.innerHeight >= doc.scrollHeight - 4) {
				const last = tops.findLast(([, top]) => top !== undefined && top < window.innerHeight);
				if (last) current = last[0];
			}
			active = current ?? ids[0]!;
		};
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(update);
		};
		const release = () => {
			if (!picked) return;
			picked = null;
			schedule();
		};
		const releaseKey = (e: KeyboardEvent) => {
			if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) release();
		};
		update();
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		window.addEventListener('wheel', release, { passive: true });
		window.addEventListener('touchstart', release, { passive: true });
		window.addEventListener('keydown', releaseKey);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			window.removeEventListener('wheel', release);
			window.removeEventListener('touchstart', release);
			window.removeEventListener('keydown', releaseKey);
		};
	});

	// Keep the highlighted link visible when the links scroll sideways (narrow screens).
	$effect(() => {
		const el = active && nav?.querySelector<HTMLElement>(`[data-id="${CSS.escape(active)}"]`);
		if (!nav || !el) return;
		const left = el.offsetLeft - nav.offsetLeft;
		if (left < nav.scrollLeft) nav.scrollLeft = left - 8;
		else if (left + el.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = left + el.offsetWidth - nav.clientWidth + 8;
	});

	const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

	function go(e: MouseEvent, id: string) {
		const el = document.getElementById(id);
		if (!el || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		picked = id;
		active = id;
		el.scrollIntoView({ behavior: smooth(), block: 'start' });
		try {
			replaceState(`${page.url.pathname}${page.url.search}#${id}`, page.state);
		} catch {
			// Before the router is ready the address simply keeps its old hash.
		}
	}
	function toTop() {
		picked = null;
		window.scrollTo({ top: 0, behavior: smooth() });
	}
</script>

<div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>
<div class="page-head" class:stuck class:plain={!heading && !sections.length && !actions} bind:this={bar}>
	<button type="button" class="ctx" tabindex={stuck ? 0 : -1} aria-hidden={!stuck} title={i.t('common.toTop')} onclick={toTop}>{title}</button>
	{#if heading}<div class="heading">{@render heading()}</div>{/if}
	{#if sections.length}
		<nav class="sections" aria-label={i.t('common.sectionsNav')} bind:this={nav}>
			{#each sections as s (s.id)}
				<a href="#{s.id}" data-id={s.id} aria-current={active === s.id ? 'location' : undefined} onclick={(e) => go(e, s.id)}>
					{s.label}
					{#if s.count !== undefined && s.count !== ''}<span class="count {s.tone ?? ''}" use:tooltip={s.tip}>{s.count}</span>{/if}
				</a>
			{/each}
		</nav>
	{/if}
	{#if actions}<div class="acts">{@render actions()}</div>{/if}
</div>

<style>
	.sentinel {
		height: 1px;
		margin-bottom: -1px;
	}
	/* Full width of the content panel, flush with its edges; the panel clips the part beyond */
	.page-head {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: var(--head-h);
		margin: 0 calc(-1 * var(--pad-x, 2rem)) 1.5rem;
		padding: 0 var(--pad-x, 2rem);
		background: color-mix(in srgb, var(--panel) 92%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--rule);
	}
	.page-head::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: -1px;
		left: 100%;
		width: 100vw;
		background: inherit;
		border-bottom: inherit;
	}
	/* Without heading, links or actions, the bar only appears once it is stuck */
	.page-head.plain:not(.stuck) {
		border-bottom-color: transparent;
		background: transparent;
		backdrop-filter: none;
	}
	.ctx {
		flex: none;
		max-width: 0;
		margin-right: -0.75rem;
		padding: 0;
		overflow: hidden;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		text-overflow: ellipsis;
		cursor: pointer;
		opacity: 0;
		transition:
			max-width 0.2s ease,
			opacity 0.15s ease,
			margin 0.2s ease;
	}
	.stuck .ctx {
		max-width: min(20rem, 32%);
		margin-right: 0;
		opacity: 1;
	}
	.ctx:hover {
		color: var(--accent);
	}
	.heading {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.heading :global(h2) {
		font-size: var(--text-md);
	}
	.stuck .heading::before {
		content: '/';
		color: var(--rule-strong);
	}
	.sections {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		margin: 0 -0.25rem;
		padding: 0.4rem 0.25rem;
		/* Links cut off at the right edge fade out instead of ending hard */
		mask-image: linear-gradient(to right, #000 calc(100% - 1.5rem), transparent);
	}
	.sections::-webkit-scrollbar {
		display: none;
	}
	.sections a {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		height: 1.625rem;
		padding: 0 0.55rem;
		border: 1px solid transparent;
		border-radius: var(--radius-s);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink-2);
		white-space: nowrap;
		text-decoration: none;
		transition:
			background-color 0.12s,
			color 0.12s;
	}
	.sections a:hover {
		background: var(--sunken);
		color: var(--ink);
	}
	.sections a[aria-current] {
		background: var(--sheet);
		border-color: var(--rule-strong);
		box-shadow: var(--shadow);
		color: var(--ink);
	}
	.count {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-3);
	}
	.count.block {
		color: var(--block);
	}
	.count.major {
		color: var(--major);
	}
	.count.pass {
		color: var(--pass);
	}
	.acts {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}
	@media (max-width: 560px) {
		.stuck .ctx {
			max-width: 0;
			margin-right: -0.75rem;
			opacity: 0;
		}
		.stuck .heading::before {
			content: none;
		}
	}
</style>
