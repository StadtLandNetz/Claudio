<script lang="ts">
	import { changeRef } from '@claudio/core';
	import StatusBadge from './StatusBadge.svelte';
	import { isActive } from '#lib/labels.js';
	import { i18n } from '#lib/i18n/index.js';
	import type { ReviewSummary } from '#lib/types.js';

	/** Reviews as a table; in a narrow container every review becomes a small card. */
	let { reviews, showRepo = true }: { reviews: ReviewSummary[]; showRepo?: boolean } = $props();
	const i = i18n();
</script>

<div class="scroll">
	<table class="list">
		<thead>
			<tr>
				<th>{i.t('review.pullRequest')}</th>
				<th>{i.t('review.colResult')}</th>
				<th class="num">{i.t('review.colCriteria')}</th>
				<th class="num">{i.t('review.colFindings')}</th>
				<th class="num">{i.t('review.colTests')}</th>
				<th class="num">{i.t('review.costs')}</th>
				<th>{i.t('review.started')}</th>
			</tr>
		</thead>
		<tbody>
			{#each reviews as r (r.id)}
				<tr class:active={isActive(r.status)}>
					<td class="pr">
						<a href="/reviews/{r.id}">
							{#if showRepo}<span class="repo">{r.repo}</span>{/if}
							<span class="title">{changeRef(r.provider, r.prNumber)} {r.prTitle ?? ''}</span>
						</a>
					</td>
					<td class="result"><StatusBadge status={r.status} verdict={r.verdict} /></td>
					<td class="num criteria" data-label={i.t('review.colCriteria')}>{r.acTotal ? `${r.acPassed} / ${r.acTotal}` : '–'}</td>
					<td class="num findings" data-label={i.t('review.colFindings')}>
						{#if r.status === 'completed' || r.findings > 0}
							{r.findings}{#if r.blocking > 0}, <span class="blocking">{i.t('review.nBlocking', { n: r.blocking })}</span>{/if}
						{:else}–{/if}
					</td>
					<td class="num tests" data-label={i.t('review.colTests')}>{r.testsTotal ? `${r.testsPassed} / ${r.testsTotal}` : '–'}</td>
					<td class="num costs" data-label={i.t('review.costs')}>{i.formatUsd(r.costUsd)}</td>
					<td class="when">
						<span>{i.formatDate(r.createdAt)}</span>
						<span class="faint">{i.t('review.byUser', { user: r.startedBy })}</span>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
		container-type: inline-size;
	}
	.pr a {
		display: grid;
		text-decoration: none;
		color: var(--ink);
	}
	.pr a:hover .title {
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	.repo {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}
	.title {
		font-weight: 500;
		max-width: 28rem;
	}
	.blocking {
		color: var(--block);
		font-weight: 500;
	}
	.when {
		white-space: nowrap;
		display: grid;
		color: var(--ink-2);
	}
	tr.active td {
		background: color-mix(in srgb, var(--accent-soft) 50%, transparent);
	}

	/* Narrower: the date may wrap and the cells sit closer, so the seven columns still fit without scrolling */
	@container (max-width: 60rem) {
		.when {
			white-space: normal;
		}
		.title {
			max-width: none;
		}
		table :global(th),
		table :global(td) {
			padding-inline: 0.5rem;
		}
	}

	/* Narrow: one card per review. Title and result on top, the numbers as a labelled row, the date below. */
	@container (max-width: 42rem) {
		thead {
			display: none;
		}
		table,
		tbody {
			display: block;
		}
		tr {
			display: grid;
			/* the numbers pack to the left at their own width; the costs take what is left */
			grid-template-columns: auto auto auto minmax(0, 1fr) auto;
			grid-template-areas:
				'pr pr pr pr result'
				'criteria findings tests costs costs'
				'when when when when when';
			gap: 0.3rem 0.9rem;
			padding: 0.6rem 0.75rem;
			border-bottom: 1px solid var(--rule);
		}
		tbody tr:last-child {
			border-bottom: 0;
		}
		table :global(td) {
			display: block;
			padding: 0;
			border: 0;
		}
		table :global(tbody tr:hover td) {
			background: transparent;
		}
		tbody tr:hover {
			background: var(--sunken);
		}
		tr.active {
			background: color-mix(in srgb, var(--accent-soft) 50%, transparent);
		}
		tr.active td {
			background: transparent;
		}
		.pr {
			grid-area: pr;
		}
		.result {
			grid-area: result;
			justify-self: end;
		}
		.criteria {
			grid-area: criteria;
		}
		.findings {
			grid-area: findings;
		}
		.tests {
			grid-area: tests;
		}
		.costs {
			grid-area: costs;
		}
		.num {
			text-align: left;
			justify-self: start;
			font-size: var(--text-xs);
			color: var(--ink-2);
		}
		.num::before {
			content: attr(data-label) ' ';
			color: var(--ink-3);
		}
		.when {
			grid-area: when;
			display: flex;
			gap: 0.4rem;
			flex-wrap: wrap;
			align-items: baseline;
			font-size: var(--text-xs);
		}
	}
</style>
