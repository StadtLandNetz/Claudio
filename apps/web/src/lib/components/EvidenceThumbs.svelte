<script module lang="ts">
	/** What a tile needs. Review evidence (with `kind` and `createdAt`) and test-run evidence both fit. */
	export type ThumbEvidence = { id: string; label: string; url: string | null; expired: boolean; kind?: string; createdAt?: string; viewport?: string };
</script>

<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import Icon from './Icon.svelte';
	import { tooltip } from '#lib/tooltip.js';

	/**
	 * Screenshot tiles. With `onopen` a tile opens the lightbox, otherwise a new tab.
	 * With `onjump` each tile carries a button that shows the moment in the trace timeline.
	 */
	let {
		items,
		onopen,
		onjump,
		layout = 'row'
	}: {
		items: ThumbEvidence[];
		onopen?: (ev: ThumbEvidence) => void;
		onjump?: (ev: ThumbEvidence) => void;
		/** row: fixed 10rem tiles that wrap; grid: the tiles fill the width (galleries). */
		layout?: 'row' | 'grid';
	} = $props();
	const i = i18n();
	const isShot = (ev: ThumbEvidence) => ev.kind === undefined || ev.kind === 'screenshot';
</script>

{#if items.length}
	<div class="thumbs {layout}">
		{#each items as ev (ev.id)}
			{#if ev.url && isShot(ev)}
				<div class="thumb">
					{#if onopen}
						<button type="button" class="open" onclick={() => onopen(ev)}>
							<img src={ev.url} alt={ev.label} loading="lazy" />
							<span>{ev.id} {ev.label}</span>
						</button>
						{#if ev.viewport === 'mobile'}<span class="vp">{i.t('review.viewportMobile')}</span>{/if}
					{:else}
						<a class="open" href={ev.url} target="_blank" rel="noopener noreferrer">
							<img src={ev.url} alt={ev.label} loading="lazy" />
							<span>{ev.id} {ev.label}</span>
						</a>
					{/if}
					{#if onjump && ev.createdAt}
						<button type="button" class="jump" use:tooltip={i.t('common.traceJump')} aria-label="{i.t('common.traceJump')}: {ev.id}" onclick={() => onjump(ev)}>
							<Icon name="play" size={12} />
						</button>
					{/if}
				</div>
			{:else if ev.url}
				<a class="chip" href={ev.url} target="_blank" rel="noopener noreferrer">{ev.id} {ev.label}</a>
			{:else if ev.expired}
				<div class="shot-expired" title={i.t('common.screenshotsExpire')}>
					<span>{i.t('common.screenshotDeleted')}</span>
					<span class="faint">{ev.id} {ev.label}</span>
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.thumbs {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.thumbs.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
	}
	.thumb {
		position: relative;
		width: 10rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: var(--sheet);
		overflow: hidden;
	}
	.grid .thumb {
		width: auto;
	}
	.thumb:hover {
		border-color: var(--rule-strong);
	}
	.open {
		display: grid;
		gap: 0.25rem;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-xs);
		color: var(--ink-2);
		text-align: left;
		cursor: zoom-in;
		text-decoration: none;
	}
	.open:hover {
		text-decoration: none;
	}
	.open img {
		width: 100%;
		aspect-ratio: 16 / 10;
		object-fit: cover;
		object-position: top;
		display: block;
		border-bottom: 1px solid var(--rule);
	}
	.open span {
		padding: 0 0.45rem 0.35rem;
		overflow-wrap: anywhere;
	}
	.jump {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		display: inline-grid;
		place-items: center;
		width: 1.375rem;
		height: 1.375rem;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: var(--raised);
		color: var(--ink-2);
		cursor: pointer;
		box-shadow: var(--shadow);
	}
	.jump:hover {
		color: var(--ink);
		border-color: var(--rule-strong);
	}
	.vp {
		position: absolute;
		top: 0.3rem;
		left: 0.3rem;
		padding: 0 0.3rem;
		border-radius: 3px;
		background: var(--raised);
		box-shadow: var(--shadow);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.chip {
		font-size: var(--text-xs);
	}
	.grid :global(.shot-expired) {
		width: auto;
	}
</style>
