<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	const monthName = (m: string) => new Intl.DateTimeFormat(i.locale === 'en' ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${m}-01T12:00:00`));
	const cell = (c: { runs: number; usd: number }) => (c.runs ? i.formatUsd(c.usd) : '–');
</script>

<svelte:head><title>{i.t('common.costsTitle')}</title></svelte:head>

<div class="page-title">
	<div>
		<h1>{i.t('common.costs')}</h1>
		<p class="lead">{i.t('common.costsIntro')}</p>
	</div>
</div>

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
	/* Amounts are emphasised by weight 500, never bold */
	strong {
		font-weight: 500;
	}
	.year {
		margin-bottom: 1.25rem;
		font-size: var(--text-md);
		color: var(--ink-2);
	}
	.year strong {
		color: var(--ink);
	}
	.month {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 1.75rem;
	}
	.month:last-of-type {
		margin-bottom: 0.75rem;
	}
	h2 {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.sum {
		font-weight: 500;
		color: var(--ink-2);
	}
	h2 .faint {
		font-weight: 400;
	}
	table a {
		color: var(--ink);
		font-weight: 500;
	}
	/* The run count next to an amount; a fixed width keeps the amounts aligned */
	.runs {
		display: inline-block;
		min-width: 1.6rem;
		margin-left: 0.35rem;
		font-size: var(--text-xs);
		color: var(--ink-3);
		text-align: left;
	}
</style>
