<script lang="ts">
	import PageNav, { type Section } from '#lib/components/PageNav.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	const monthName = (m: string) => new Intl.DateTimeFormat(i.locale === 'en' ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${m}-01T12:00:00`));
	const cell = (c: { runs: number; usd: number }) => (c.runs ? i.formatUsd(c.usd) : '–');
	const sections = $derived<Section[]>([
		...(data.budgets.length ? [{ id: 'budgets', label: i.t('common.budgetsTitle') }] : []),
		...data.months.map((m) => ({ id: `m-${m.month}`, label: monthName(m.month), count: i.formatUsd(m.total) }))
	]);
</script>

<svelte:head><title>{i.t('common.costsTitle')}</title></svelte:head>

<div class="page-title">
	<div>
		<h1>{i.t('common.costs')}</h1>
		<p class="lead">{i.t('common.costsIntro')}</p>
	</div>
</div>

{#if data.months.length}<PageNav title={i.t('common.costs')} {sections} />{/if}

{#if data.months.length === 0}
	<p class="muted">{i.t('common.noRuns')}</p>
{:else}
	<p class="year">{i.t('common.yearTotal')} <strong>{i.formatUsd(data.yearTotal)}</strong></p>
	{#if data.budgets.length}
		<section class="budgets" id="budgets">
			<h2>{i.t('common.budgetsTitle')}</h2>
			<ul class="sheet">
				{#each data.budgets as b (b.path)}
					<li class:warn={b.ratio >= 0.8} class:over={b.exhausted}>
						<a href="/repos/{b.path}?tab=settings#budget">{b.repo}</a>
						<span class="bar" aria-hidden="true"><span style:width="{Math.min(100, Math.round(b.ratio * 100))}%"></span></span>
						<span class="num">{i.formatUsd(b.spent)} / {i.formatUsd(b.limit)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	{#each data.months as m (m.month)}
		<section class="month" id="m-{m.month}">
			<h2>{monthName(m.month)} <span class="sum">{i.formatUsd(m.total)}</span> <span class="faint">{i.t('common.runCount', { n: m.runs })}</span></h2>
			<div class="sheet table">
				<table class="list">
					<thead>
						<tr><th>{i.t('common.colRepository')}</th><th class="num">{i.t('common.colReviews')}</th><th class="num">{i.t('common.colAnalyses')}</th><th class="num">{i.t('common.colTests')}</th><th class="num">{i.t('common.colTotal')}</th></tr>
					</thead>
					<tbody>
						{#each m.repos as r (r.path)}
							<tr>
								<td><a href="/repos/{r.path}">{r.repo}</a></td>
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
	.budgets {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1.75rem;
		max-width: 46rem;
	}
	.budgets ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.budgets li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 10rem auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.budgets li:last-child {
		border-bottom: 0;
	}
	.bar {
		height: 0.4rem;
		border-radius: 99px;
		background: var(--sunken);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--pass);
	}
	.warn .bar span {
		background: var(--major);
	}
	.over .bar span {
		background: var(--block);
	}
	.over .num {
		color: var(--block);
		font-weight: 500;
	}
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
