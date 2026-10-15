<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	const monthName = (m: string) => new Intl.DateTimeFormat(i.locale === 'en' ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${m}-01T12:00:00`));
	const cell = (c: { runs: number; usd: number }) => (c.runs ? i.formatUsd(c.usd) : '–');
</script>

<svelte:head><title>{i.t('common.costsTitle')}</title></svelte:head>

<h1>{i.t('common.costs')}</h1>
<p class="muted lead">
	{i.t('common.costsIntro')}
</p>

{#if data.months.length === 0}
	<p class="muted">{i.t('common.noRuns')}</p>
{:else}
	<p class="year">{i.t('common.yearTotal')} <strong>{i.formatUsd(data.yearTotal)}</strong></p>
	{#each data.months as m (m.month)}
		<section class="month">
			<h2>{monthName(m.month)} <span class="sum">{i.formatUsd(m.total)}</span> <span class="faint">{i.t('common.runCount', { n: m.runs })}</span></h2>
			<div class="sheet table">
				<table class="list">
					<thead>
						<tr><th>{i.t('common.colRepository')}</th><th class="num">{i.t('common.colReviews')}</th><th class="num">{i.t('common.colAnalyses')}</th><th class="num">{i.t('common.colTests')}</th><th class="num">{i.t('common.colTotal')}</th></tr>
					</thead>
					<tbody>
						{#each m.repos as r (r.repo)}
							<tr>
								<td><a href="/repos/{r.repo}">{r.repo}</a></td>
								<td class="num">{cell(r.review)}<span class="runs">{r.review.runs || ''}</span></td>
								<td class="num">{cell(r.analysis)}<span class="runs">{r.analysis.runs || ''}</span></td>
								<td class="num">{cell(r.test)}<span class="runs">{r.test.runs || ''}</span></td>
								<td class="num"><strong>{i.formatUsd(r.total)}</strong></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/each}
	<p class="faint">{i.t('common.runsHint')}</p>
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
