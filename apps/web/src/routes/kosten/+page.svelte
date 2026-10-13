<script lang="ts">
	import { formatUsd } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const monthName = (m: string) => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${m}-01T12:00:00`));
	const cell = (c: { runs: number; usd: number }) => (c.runs ? formatUsd(c.usd) : '–');
</script>

<svelte:head><title>Kosten · Claudio</title></svelte:head>

<h1>Kosten</h1>
<p class="muted lead">
	Modellkosten der letzten zwölf Monate, wie das Agent SDK sie meldet: Schätzungen zum Listenpreis, keine Rechnung. Reine Testwiedergaben ohne Modell kosten nichts.
</p>

{#if data.months.length === 0}
	<p class="muted">Noch keine Läufe.</p>
{:else}
	<p class="year">Zwölf Monate gesamt: <strong>{formatUsd(data.yearTotal)}</strong></p>
	{#each data.months as m (m.month)}
		<section class="month">
			<h2>{monthName(m.month)} <span class="sum">{formatUsd(m.total)}</span> <span class="faint">{m.runs} Läufe</span></h2>
			<div class="sheet table">
				<table class="list">
					<thead>
						<tr><th>Repository</th><th class="num">Reviews</th><th class="num">Analysen</th><th class="num">Tests</th><th class="num">Summe</th></tr>
					</thead>
					<tbody>
						{#each m.repos as r (r.repo)}
							<tr>
								<td><a href="/repos/{r.repo}">{r.repo}</a></td>
								<td class="num">{cell(r.review)}<span class="runs">{r.review.runs || ''}</span></td>
								<td class="num">{cell(r.analysis)}<span class="runs">{r.analysis.runs || ''}</span></td>
								<td class="num">{cell(r.test)}<span class="runs">{r.test.runs || ''}</span></td>
								<td class="num"><strong>{formatUsd(r.total)}</strong></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/each}
	<p class="faint">Die kleine Zahl neben einem Betrag ist die Anzahl der Läufe.</p>
{/if}

<style>
	.lead {
		margin: 0.25rem 0 1.5rem;
		max-width: 46rem;
	}
	.year {
		margin-bottom: 1.5rem;
		font-size: 1.0625rem;
	}
	.month {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 2rem;
	}
	h2 {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.sum {
		font-weight: 800;
	}
	.table {
		padding: 0.25rem 0.5rem;
		overflow-x: auto;
	}
	.runs {
		display: inline-block;
		min-width: 1.6rem;
		margin-left: 0.35rem;
		font-size: 0.75rem;
		color: var(--ink-3);
		text-align: left;
	}
</style>
