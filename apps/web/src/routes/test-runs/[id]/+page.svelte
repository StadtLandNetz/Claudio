<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import Severity from '#lib/components/Severity.svelte';
	import {
		CATEGORY_LABEL,
		DETERMINISM_LABEL,
		MODE_LABEL,
		OUTCOME_LABEL,
		STATUS_LABEL,
		TEST_BUDGET_LABEL,
		formatDate,
		formatDuration,
		formatUsd,
		isActive
	} from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let liveStatus = $state<string | null>(null);
	const run = $derived({ ...data.run, status: liveStatus ?? data.run.status });
	const r = $derived(data.report);
	const active = $derived(isActive(run.status));
	const tone = $derived(run.outcome === 'passed' ? 'approve' : run.outcome === 'failed' ? 'request_changes' : 'inconclusive');
</script>

<svelte:head><title>{run.scriptName} · Testlauf · Claudio</title></svelte:head>

<p class="crumb"><a href="/repos/{run.repo}?tab=tests">Tests</a> / <a href="/tests/{run.scriptId}">{run.scriptName}</a></p>
<div class="title">
	<h1>Testlauf: {run.scriptName}</h1>
	{#if active}
		<form method="POST" action="?/abort" use:enhance>
			<button class="btn danger" type="submit" disabled={run.abortRequested}>{run.abortRequested ? 'Wird abgebrochen …' : 'Abbrechen'}</button>
		</form>
	{/if}
</div>

{#if r && !active}
	<section class="stamp {tone}" aria-label="Ergebnis">
		<p class="word">{run.outcome ? OUTCOME_LABEL[run.outcome] : STATUS_LABEL[run.status]}</p>
		<p class="why">
			{MODE_LABEL[r.mode]}{r.mode === 'replay' && run.stepsVersion ? ` von Version ${run.stepsVersion}` : ''},
			{r.steps.filter((s) => s.ok).length} von {r.steps.length} Schritten ausgeführt, {formatDuration(r.cost.durationMs)},
			{r.cost.usd > 0 ? formatUsd(r.cost.usd) : 'ohne Modell'}.
		</p>
		{#if r.summary}<p class="sum">{r.summary}</p>{/if}
	</section>
{:else if !active}
	<p class="notice error">{run.error ?? 'Dieser Lauf hat kein Ergebnis erzeugt.'}</p>
{/if}

<div class="layout">
	<div class="main">
		{#if active && data.human}
			<HumanTakeover src="/test-runs/{data.run.id}/live" requestId={data.human.id} reason={data.human.reason} url={run.instanceUrl} />
		{:else if active}
			<LiveView src="/test-runs/{data.run.id}/live" url={run.instanceUrl} />
		{/if}
		{#if isActive(data.run.status) || data.events.length > 0}
			<LiveLog
				streamUrl="/test-runs/{data.run.id}/events"
				events={data.events}
				active={isActive(data.run.status)}
				onstatus={(s) => (liveStatus = s)}
				online={(line) => /^Mensch (gebraucht|fertig):/.test(line) && invalidateAll()}
			/>
		{/if}

		{#if r}
			{#if r.healedAt !== null}
				<p class="notice">
					Schritt {r.healedAt + 1} ließ sich nicht mehr ausführen. Claudio hat den Ablauf ab dort repariert{r.savedSteps ? ' und als neue Version gespeichert' : ''}. Prüfe unten das Finding: Ein umbenanntes oder verschobenes Element kann gewollt sein oder eine Regression.
				</p>
			{:else if r.mode === 'record' && r.savedSteps}
				<p class="notice ok">
					{r.savedSteps} Schritte aufgezeichnet{r.determinismProposal ? `, eingestuft als ${DETERMINISM_LABEL[r.determinismProposal].toLowerCase()}` : ''}. Folgeläufe spielen sie ohne Modell ab.
				</p>
			{/if}

			{#if r.judge}
				<section class="block">
					<h2>Bewertung durch den Prüf-Agenten</h2>
					<div class="sheet judge">
						<p>
							<strong>{r.judge.passed ? 'Erwartung erfüllt' : 'Erwartung nicht erfüllt'}</strong>
							<span class="faint">Konfidenz {Math.round(r.judge.confidence * 100)} %</span>
						</p>
						{#if r.judge.deviations.length}
							<ul>
								{#each r.judge.deviations as d, i (i)}<li>{d}</li>{/each}
							</ul>
						{/if}
						<p class="muted">{r.judge.reasoning}</p>
					</div>
				</section>
			{/if}

			<section class="block">
				<h2>Schritte</h2>
				<ol class="steps sheet">
					{#each r.steps as step (step.index)}
						<li class:fail={!step.ok} class:assert={step.assertion}>
							<span class="mark" aria-label={step.ok ? 'ausgeführt' : 'fehlgeschlagen'}>{step.ok ? '✓' : '✗'}</span>
							<span class="txt">
								{step.text}
								{#if step.healed}<span class="tag">repariert</span>{/if}
								{#if step.error}<span class="err">{step.error}</span>{/if}
							</span>
							<span class="ms faint">{step.durationMs} ms</span>
						</li>
					{/each}
				</ol>
				{#if r.mode === 'record'}
					<p class="faint">Beim Aufzeichnen verworfene Versuche (✗) werden nicht gespeichert.</p>
				{/if}
			</section>

			{#if r.findings.length}
				<section class="block">
					<h2>Findings</h2>
					<ul class="findings sheet">
						{#each r.findings as f (f.id)}
							<li>
								<Severity severity={f.severity} />
								<div>
									<strong>{f.title}</strong>
									<span class="faint">{CATEGORY_LABEL[f.category] ?? f.category}</span>
									<p>{f.description}</p>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if r.evidence.length}
				<section class="block">
					<h2>Screenshots</h2>
					<div class="shots">
						{#each r.evidence as ev (ev.id)}
							<a class="shot" href={ev.url} target="_blank" rel="noopener noreferrer">
								<img src={ev.url} alt={ev.label} loading="lazy" />
								<span>{ev.label}</span>
							</a>
						{/each}
					</div>
				</section>
			{/if}

			{#if r.errors.length}
				<section class="block">
					<h2>Probleme während des Laufs</h2>
					<ul class="errors">{#each r.errors as e, i (i)}<li>{e}</li>{/each}</ul>
				</section>
			{/if}
		{/if}
	</div>

	<aside class="meta">
		<dl>
			<dt>Status</dt>
			<dd><OutcomeBadge status={run.status} outcome={run.outcome} healed={run.healed} /></dd>
			<dt>Instanz</dt>
			<dd class="break">{run.instanceUrl}</dd>
			<dt>Budget</dt>
			<dd>{TEST_BUDGET_LABEL[run.budget]}</dd>
			{#if run.reviewId}
				<dt>Teil von</dt>
				<dd><a href="/reviews/{run.reviewId}">Review #{run.reviewId}</a></dd>
			{/if}
			<dt>Gestartet</dt>
			<dd>{formatDate(run.createdAt)}<br /><span class="faint">von {run.startedBy}</span></dd>
			{#if r?.finalUrl}
				<dt>Endseite</dt>
				<dd class="break">{r.finalUrl}</dd>
			{/if}
		</dl>
	</aside>
</div>

<style>
	.crumb {
		font-size: 0.875rem;
		margin-bottom: 0.25rem;
	}
	.title {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}
	.stamp {
		--tone: var(--hint);
		--tone-soft: var(--hint-soft);
		display: grid;
		gap: 0.35rem;
		padding: 1.1rem 1.5rem;
		border: 2px solid var(--tone);
		border-left-width: 10px;
		border-radius: var(--radius-m);
		background: var(--tone-soft);
		margin-bottom: 2rem;
	}
	.stamp.approve {
		--tone: var(--pass);
		--tone-soft: var(--pass-soft);
	}
	.stamp.request_changes {
		--tone: var(--block);
		--tone-soft: var(--block-soft);
	}
	.word {
		font-size: clamp(1.6rem, 3.5vw, 2.25rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1.05;
		color: var(--tone);
	}
	.sum {
		max-width: 52rem;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 15rem;
		gap: 2.5rem;
		align-items: start;
	}
	.main {
		display: grid;
		gap: 2rem;
		min-width: 0;
	}
	.block {
		display: grid;
		gap: 0.6rem;
	}
	.judge {
		padding: 1rem 1.25rem;
		display: grid;
		gap: 0.5rem;
	}
	.judge ul {
		margin: 0;
		padding-left: 1.25rem;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0.4rem 0;
	}
	.steps li {
		display: grid;
		grid-template-columns: 1.5rem minmax(0, 1fr) auto;
		gap: 0.5rem;
		padding: 0.4rem 1rem;
		font-size: 0.9375rem;
	}
	.steps li + li {
		border-top: 1px solid var(--rule);
	}
	.mark {
		font-weight: 800;
		color: var(--pass);
	}
	.fail .mark {
		color: var(--block);
	}
	.assert .txt {
		font-weight: 600;
	}
	.err {
		display: block;
		color: var(--block);
		font-size: 0.8125rem;
		font-weight: 400;
		word-break: break-word;
	}
	.tag {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--major);
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0 0.4rem;
		margin-left: 0.3rem;
	}
	.ms {
		white-space: nowrap;
	}
	.findings {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.findings li {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--rule);
	}
	.findings li:last-child {
		border-bottom: 0;
	}
	.findings li div {
		display: grid;
		gap: 0.15rem;
	}
	.shots {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.75rem;
	}
	.shot {
		display: grid;
		gap: 0.3rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: var(--sheet);
		color: var(--ink-2);
		font-size: 0.8125rem;
		text-decoration: none;
		overflow: hidden;
	}
	.shot img {
		width: 100%;
		aspect-ratio: 16 / 10;
		object-fit: cover;
		object-position: top;
		border-bottom: 1px solid var(--rule);
	}
	.shot span {
		padding: 0 0.5rem 0.4rem;
	}
	.errors {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--block);
	}
	.meta {
		position: sticky;
		top: 1.5rem;
		font-size: 0.9375rem;
	}
	.meta dl {
		margin: 0;
		display: grid;
		gap: 0.2rem;
	}
	.meta dt {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--ink-3);
		margin-top: 0.6rem;
	}
	.meta dt:first-child {
		margin-top: 0;
	}
	.meta dd {
		margin: 0;
	}
	.break {
		word-break: break-all;
	}
	@media (max-width: 980px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.meta {
			position: static;
		}
	}
</style>
