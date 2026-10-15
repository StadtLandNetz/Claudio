<script lang="ts">
	import StatusBadge from './StatusBadge.svelte';
	import { isActive } from '#lib/labels.js';
	import { i18n } from '#lib/i18n/index.js';
	import type { ReviewSummary } from '#lib/types.js';

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
							<span class="title">#{r.prNumber} {r.prTitle ?? ''}</span>
						</a>
					</td>
					<td><StatusBadge status={r.status} verdict={r.verdict} /></td>
					<td class="num">{r.acTotal ? `${r.acPassed} / ${r.acTotal}` : '–'}</td>
					<td class="num">
						{#if r.status === 'completed' || r.findings > 0}
							{r.findings}{#if r.blocking > 0}, <span class="blocking">{i.t('review.nBlocking', { n: r.blocking })}</span>{/if}
						{:else}–{/if}
					</td>
					<td class="num">{r.testsTotal ? `${r.testsPassed} / ${r.testsTotal}` : '–'}</td>
					<td class="num">{i.formatUsd(r.costUsd)}</td>
					<td class="when">
						{i.formatDate(r.createdAt)}
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
	}
	.pr a {
		display: grid;
		text-decoration: none;
		color: var(--ink);
	}
	.pr a:hover .title {
		text-decoration: underline;
	}
	.repo {
		font-size: 0.8125rem;
		color: var(--ink-3);
	}
	.title {
		font-weight: 600;
		max-width: 28rem;
	}
	.blocking {
		color: var(--block);
		font-weight: 600;
	}
	.when {
		white-space: nowrap;
		display: grid;
	}
	tr.active td {
		background: color-mix(in srgb, var(--petrol-soft) 45%, transparent);
	}
</style>
