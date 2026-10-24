<script lang="ts">
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	const runs = $derived([data.a, data.b]);
	const same = (x: { text: string } | null, y: { text: string } | null) => x?.text === y?.text;
</script>

<svelte:head><title>{i.t('test.comparePageTitle', { name: data.script.name })}</title></svelte:head>

<div class="page-title">
	<div>
		<p class="crumbs">
			<a href="/repos/{data.script.repoPath}">{data.script.repo}</a><span class="sep"></span><a href="/repos/{data.script.repoPath}?tab=tests">{i.t('test.tests')}</a><span class="sep"></span><a href="/tests/{data.script.id}">{data.script.name}</a>
		</p>
		<h1>{i.t('test.compareRuns')}</h1>
	</div>
</div>

<div class="sheet table">
	<table class="list cmp">
		<thead>
			<tr>
				<th></th>
				{#each runs as run (run.id)}
					<th><a href="/test-runs/{run.id}">{i.t('test.runFrom', { date: i.formatDate(run.createdAt) })}</a></th>
				{/each}
			</tr>
		</thead>
		<tbody>
			<tr>
				<th scope="row">{i.t('test.colResult')}</th>
				{#each runs as run (run.id)}<td><OutcomeBadge status={run.status} outcome={run.outcome} healed={run.healed} /></td>{/each}
			</tr>
			<tr>
				<th scope="row">{i.t('test.colKind')}</th>
				{#each runs as run (run.id)}<td>{run.mode ? i.labels.mode[run.mode] : '–'}{run.mode === 'replay' && run.stepsVersion ? i.t('test.fromVersion', { version: run.stepsVersion }) : ''}</td>{/each}
			</tr>
			<tr>
				<th scope="row">{i.t('test.durationCost')}</th>
				{#each runs as run (run.id)}<td>{run.durationMs !== null ? i.formatDuration(run.durationMs) : '–'}, {i.formatUsd(run.costUsd)}</td>{/each}
			</tr>
			<tr>
				<th scope="row">{i.t('test.judge')}</th>
				{#each runs as run (run.id)}
					<td>
						{#if run.judge}
							{run.judge.passed ? i.t('test.expectationMet') : i.t('test.expectationNotMetShort')} ({Math.round(run.judge.confidence * 100)} %)
							{#each run.judge.deviations as d, i (i)}<span class="dev">{d}</span>{/each}
						{:else}<span class="faint">{i.t('test.notNeeded')}</span>{/if}
					</td>
				{/each}
			</tr>
		</tbody>
	</table>
</div>

<h2 class="h">{i.t('test.steps')}</h2>
<div class="sheet table">
	<table class="list cmp steps">
		<thead><tr><th class="num">#</th><th>{i.t('test.runA')}</th><th>{i.t('test.runB')}</th></tr></thead>
		<tbody>
			{#each data.rows as row, i (i)}
				<tr class:diff={!same(row.a, row.b) || row.a?.ok !== row.b?.ok}>
					<td class="num faint">{i + 1}</td>
					{#each [row.a, row.b] as s, k (k)}
						<td>
							{#if s}
								<span class="mark"><span class="dot {s.ok ? 'pass' : 'block'}" aria-hidden="true"></span><span class="visually-hidden">{s.ok ? '✓' : '✗'}</span></span>
								{s.text}
								<span class="faint">{s.durationMs} ms</span>
								{#if s.error}<span class="dev">{s.error}</span>{/if}
							{:else}<span class="faint">–</span>{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2 class="h">{i.t('test.finalState')}</h2>
<div class="shots">
	{#each runs as run (run.id)}
		{#if run.finalShot}
			<a href={run.finalShot} target="_blank" rel="noopener noreferrer"><img src={run.finalShot} alt={i.t('test.finalStateAlt', { date: i.formatDate(run.createdAt) })} /></a>
		{:else}
			<p class="faint">{i.t('test.noScreenshot')}</p>
		{/if}
	{/each}
</div>

<style>
	.h {
		margin: 1.75rem 0 0.6rem;
	}
	.cmp thead a {
		color: var(--ink);
		font-weight: 500;
	}
	.cmp th[scope='row'] {
		padding: 0.55rem 0.75rem;
		vertical-align: top;
	}
	.cmp td {
		width: 45%;
	}
	.steps td.num {
		width: auto;
		padding-right: 0;
	}
	/* Rows that differ between the runs get a thin bar, not a tinted background. */
	tr.diff td:first-child {
		box-shadow: inset 2px 0 0 var(--major);
	}
	tr.diff td.num {
		color: var(--major);
		font-weight: 500;
	}
	.mark {
		display: inline-flex;
		align-items: center;
		height: 1em;
		vertical-align: -0.15em;
		margin-right: 0.35rem;
	}
	.steps .faint {
		white-space: nowrap;
	}
	.dev {
		display: block;
		color: var(--block);
		font-size: var(--text-xs);
		word-break: break-word;
	}
	.shots {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	.shots img {
		display: block;
		width: 100%;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
	}
	@media (max-width: 760px) {
		.shots {
			grid-template-columns: 1fr;
		}
	}
</style>
