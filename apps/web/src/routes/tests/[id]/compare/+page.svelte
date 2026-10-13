<script lang="ts">
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import { MODE_LABEL, formatDate, formatDuration, formatUsd } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const runs = $derived([data.a, data.b]);
	const same = (x: { text: string } | null, y: { text: string } | null) => x?.text === y?.text;
</script>

<svelte:head><title>Vergleich · {data.script.name} · Claudio</title></svelte:head>

<p class="crumb"><a href="/repos/{data.script.repo}?tab=tests">Tests</a> / <a href="/tests/{data.script.id}">{data.script.name}</a></p>
<h1>Läufe vergleichen</h1>

<div class="sheet table">
	<table class="list cmp">
		<thead>
			<tr>
				<th></th>
				{#each runs as run (run.id)}
					<th><a href="/test-runs/{run.id}">Lauf vom {formatDate(run.createdAt)}</a></th>
				{/each}
			</tr>
		</thead>
		<tbody>
			<tr>
				<th scope="row">Ergebnis</th>
				{#each runs as run (run.id)}<td><OutcomeBadge status={run.status} outcome={run.outcome} healed={run.healed} /></td>{/each}
			</tr>
			<tr>
				<th scope="row">Art</th>
				{#each runs as run (run.id)}<td>{run.mode ? MODE_LABEL[run.mode] : '–'}{run.mode === 'replay' && run.stepsVersion ? ` von Version ${run.stepsVersion}` : ''}</td>{/each}
			</tr>
			<tr>
				<th scope="row">Dauer, Kosten</th>
				{#each runs as run (run.id)}<td>{run.durationMs !== null ? formatDuration(run.durationMs) : '–'}, {formatUsd(run.costUsd)}</td>{/each}
			</tr>
			<tr>
				<th scope="row">Prüf-Agent</th>
				{#each runs as run (run.id)}
					<td>
						{#if run.judge}
							{run.judge.passed ? 'Erwartung erfüllt' : 'Nicht erfüllt'} ({Math.round(run.judge.confidence * 100)} %)
							{#each run.judge.deviations as d, i (i)}<span class="dev">{d}</span>{/each}
						{:else}<span class="faint">nicht nötig</span>{/if}
					</td>
				{/each}
			</tr>
		</tbody>
	</table>
</div>

<h2 class="h">Schritte</h2>
<div class="sheet table">
	<table class="list cmp steps">
		<thead><tr><th class="num">#</th><th>Lauf A</th><th>Lauf B</th></tr></thead>
		<tbody>
			{#each data.rows as row, i (i)}
				<tr class:diff={!same(row.a, row.b) || row.a?.ok !== row.b?.ok}>
					<td class="num faint">{i + 1}</td>
					{#each [row.a, row.b] as s, k (k)}
						<td>
							{#if s}
								<span class="mark" class:fail={!s.ok}>{s.ok ? '✓' : '✗'}</span>
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

<h2 class="h">Endzustand</h2>
<div class="shots">
	{#each runs as run (run.id)}
		{#if run.finalShot}
			<a href={run.finalShot} target="_blank" rel="noopener noreferrer"><img src={run.finalShot} alt="Endzustand des Laufs vom {formatDate(run.createdAt)}" /></a>
		{:else}
			<p class="faint">Kein Screenshot.</p>
		{/if}
	{/each}
</div>

<style>
	.crumb {
		font-size: 0.875rem;
		margin-bottom: 0.25rem;
	}
	h1 {
		margin-bottom: 1.5rem;
	}
	.h {
		margin: 2rem 0 0.75rem;
	}
	.table {
		padding: 0.25rem 0.5rem;
		overflow-x: auto;
	}
	.cmp th[scope='row'] {
		white-space: nowrap;
		color: var(--ink-2);
		font-weight: 600;
	}
	.cmp td {
		width: 45%;
	}
	.steps td {
		font-size: 0.9375rem;
	}
	tr.diff td {
		background: color-mix(in srgb, var(--major-soft) 60%, transparent);
	}
	.mark {
		font-weight: 800;
		color: var(--pass);
		margin-right: 0.3rem;
	}
	.mark.fail {
		color: var(--block);
	}
	.dev {
		display: block;
		color: var(--block);
		font-size: 0.8125rem;
	}
	.shots {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	.shots img {
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
