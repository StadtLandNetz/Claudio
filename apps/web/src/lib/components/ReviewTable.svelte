<script lang="ts">
	import StatusBadge from './StatusBadge.svelte';
	import { formatDate, formatUsd, isActive } from '#lib/labels.js';
	import type { ReviewSummary } from '#lib/types.js';

	let { reviews, showRepo = true }: { reviews: ReviewSummary[]; showRepo?: boolean } = $props();
</script>

<div class="scroll">
	<table class="list">
		<thead>
			<tr>
				<th>Pull Request</th>
				<th>Ergebnis</th>
				<th class="num">Kriterien</th>
				<th class="num">Findings</th>
				<th class="num">Tests</th>
				<th class="num">Kosten</th>
				<th>Gestartet</th>
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
							{r.findings}{#if r.blocking > 0}, <span class="blocking">{r.blocking} blockierend</span>{/if}
						{:else}–{/if}
					</td>
					<td class="num">{r.testsTotal ? `${r.testsPassed} / ${r.testsTotal}` : '–'}</td>
					<td class="num">{formatUsd(r.costUsd)}</td>
					<td class="when">
						{formatDate(r.createdAt)}
						<span class="faint">von {r.startedBy}</span>
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
