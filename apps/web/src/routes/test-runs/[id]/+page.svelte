<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import Severity from '#lib/components/Severity.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import { isActive } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	let liveStatus = $state<string | null>(null);
	const run = $derived({ ...data.run, status: liveStatus ?? data.run.status });
	const r = $derived(data.report);
	const active = $derived(isActive(run.status));
	const tone = $derived(run.outcome === 'passed' ? 'approve' : run.outcome === 'failed' ? 'request_changes' : 'inconclusive');
</script>

<svelte:head><title>{i.t('test.runPageTitle', { name: run.scriptName })}</title></svelte:head>

<div class="page-title">
	<div>
		<p class="crumbs">
			<a href="/repos/{run.repo}">{run.repo}</a><span class="sep"></span><a href="/repos/{run.repo}?tab=tests">{i.t('test.tests')}</a><span class="sep"></span><a href="/tests/{run.scriptId}">{run.scriptName}</a>
		</p>
		<h1>{i.t('test.runHeading', { name: run.scriptName })}</h1>
	</div>
	{#if active}
		<form method="POST" action="?/abort" use:enhance>
			<button class="btn danger" type="submit" disabled={run.abortRequested}>{run.abortRequested ? i.t('test.aborting') : i.t('test.abort')}</button>
		</form>
	{/if}
</div>

{#if r && !active}
	<!-- The outcome: the one loud element on the page. -->
	<section class="stamp {tone}" aria-label={i.t('test.result')}>
		<span class="glyph" aria-hidden="true">
			{#if tone === 'approve'}<Icon name="check" size={12} />{:else if tone === 'request_changes'}<Icon name="x" size={12} />{/if}
		</span>
		<div class="verdict">
			<p class="word">{run.outcome ? i.labels.outcome[run.outcome] : i.labels.status[run.status]}</p>
			<p class="why">
				{i.labels.mode[r.mode]}{r.mode === 'replay' && run.stepsVersion ? i.t('test.fromVersion', { version: run.stepsVersion }) : ''},
				{i.t('test.stepsRun', { ok: r.steps.filter((s) => s.ok).length, total: r.steps.length })}, {i.formatDuration(r.cost.durationMs)},
				{r.cost.usd > 0 ? i.formatUsd(r.cost.usd) : i.t('test.withoutModel')}.
			</p>
			{#if r.summary}<p class="sum">{r.summary}</p>{/if}
		</div>
	</section>
{:else if !active}
	<p class="notice error">{run.error ?? i.t('test.noResult')}</p>
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
					{i.t('test.healedNotice', { step: r.healedAt + 1, saved: r.savedSteps })}
				</p>
			{:else if r.mode === 'record' && r.savedSteps}
				<p class="notice ok">
					{i.t('test.recordedNotice', { n: r.savedSteps, kind: r.determinismProposal ? i.labels.determinism[r.determinismProposal]!.toLowerCase() : '' })}
				</p>
			{/if}

			{#if r.judge}
				<section class="block">
					<h2>{i.t('test.judgeHeading')}</h2>
					<div class="sheet judge">
						<p>
							<strong>{r.judge.passed ? i.t('test.expectationMet') : i.t('test.expectationNotMet')}</strong>
							<span class="faint">{i.t('test.confidence', { percent: Math.round(r.judge.confidence * 100) })}</span>
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
				<h2>{i.t('test.steps')}</h2>
				<ol class="steps sheet">
					{#each r.steps as step (step.index)}
						<li class:fail={!step.ok} class:assert={step.assertion}>
							<span class="mark" aria-label={step.ok ? i.t('test.stepOk') : i.t('test.stepFailed')}><span class="dot {step.ok ? 'pass' : 'block'}" aria-hidden="true"></span></span>
							<span class="txt">
								{step.text}
								{#if step.healed}<span class="tag">{i.t('test.healed')}</span>{/if}
								{#if step.error}<span class="err">{step.error}</span>{/if}
							</span>
							<span class="ms faint">{step.durationMs} ms</span>
						</li>
					{/each}
				</ol>
				{#if r.mode === 'record'}
					<p class="faint">{i.t('test.discardedAttempts')}</p>
				{/if}
			</section>

			{#if r.findings.length}
				<section class="block">
					<h2>{i.t('test.findings')}</h2>
					<ul class="findings sheet">
						{#each r.findings as f (f.id)}
							<li>
								<Severity severity={f.severity} />
								<div>
									<strong>{f.title}</strong>
									<span class="faint">{i.labels.category[f.category] ?? f.category}</span>
									<p>{f.description}</p>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if r.evidence.length}
				<section class="block">
					<h2>{i.t('test.screenshots')}</h2>
					<div class="shots">
						{#each r.evidence as ev (ev.id)}
							{#if ev.url}
							<a class="shot" href={ev.url} target="_blank" rel="noopener noreferrer">
								<img src={ev.url} alt={ev.label} loading="lazy" />
								<span>{ev.label}</span>
							</a>
						{:else}
							<div class="shot-expired" title={i.t('test.screenshotsExpire')}>
								<span>{i.t('test.screenshotDeleted')}</span>
								<span class="faint">{ev.label}</span>
							</div>
						{/if}
						{/each}
					</div>
				</section>
			{/if}

			{#if r.errors.length}
				<section class="block">
					<h2>{i.t('test.runProblems')}</h2>
					<ul class="errors">{#each r.errors as e, i (i)}<li>{e}</li>{/each}</ul>
				</section>
			{/if}
		{/if}
	</div>

	<aside class="meta">
		<dl>
			<dt>{i.t('test.status')}</dt>
			<dd><OutcomeBadge status={run.status} outcome={run.outcome} healed={run.healed} /></dd>
			<dt>{i.t('test.instance')}</dt>
			<dd class="break">{run.instanceUrl}</dd>
			<dt>{i.t('test.budget')}</dt>
			<dd>{i.labels.testBudget[run.budget]}</dd>
			{#if run.reviewId}
				<dt>{i.t('test.partOf')}</dt>
				<dd><a href="/reviews/{run.reviewId}">{i.t('test.reviewNumber', { id: run.reviewId })}</a></dd>
			{/if}
			<dt>{i.t('test.colStarted')}</dt>
			<dd>{i.formatDate(run.createdAt)}<br /><span class="faint">{i.t('test.byUser', { login: run.startedBy ?? '' })}</span></dd>
			{#if r?.finalUrl}
				<dt>{i.t('test.finalPage')}</dt>
				<dd class="break">{r.finalUrl}</dd>
			{/if}
		</dl>
	</aside>
</div>

<style>
	.page-title h1 {
		max-width: 46rem;
	}

	/* Outcome: the one loud element on the page */
	.stamp {
		--tone: var(--hint);
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
		border-radius: var(--radius-m);
		background: color-mix(in srgb, var(--tone) 6%, var(--sheet));
		margin-bottom: 1.5rem;
	}
	.stamp.approve {
		--tone: var(--pass);
	}
	.stamp.request_changes {
		--tone: var(--block);
	}
	.glyph {
		display: inline-grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--tone);
		color: #fff;
		flex: none;
	}
	.verdict {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.15rem;
	}
	.word {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.3;
		color: var(--tone);
	}
	.why {
		color: var(--ink-2);
	}
	.sum {
		max-width: 46rem;
	}
	/* Only the notice above the layout needs its own spacing; the grid spaces the others. */
	.notice {
		margin-bottom: 1.25rem;
	}
	.main .notice {
		margin-bottom: 0;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 16rem;
		gap: 2.5rem;
		align-items: start;
	}
	.main {
		display: grid;
		gap: 1.75rem;
		min-width: 0;
	}
	.block {
		display: grid;
		gap: 0.6rem;
	}

	.judge {
		padding: 0.875rem 1rem;
		display: grid;
		gap: 0.4rem;
	}
	.judge strong {
		font-weight: 500;
	}
	.judge ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	/* Executed steps: number, status dot, text, duration */
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		counter-reset: step;
	}
	.steps li {
		display: grid;
		grid-template-columns: 1.5rem 0.5rem minmax(0, 1fr) auto;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		counter-increment: step;
	}
	.steps li:last-child {
		border-bottom: 0;
	}
	.steps li::before {
		content: counter(step);
		text-align: right;
		font-size: var(--text-xs);
		line-height: 1.625;
		color: var(--ink-3);
	}
	.mark {
		display: flex;
		align-items: center;
		height: 1.5em;
	}
	.txt {
		overflow-wrap: anywhere;
	}
	.assert .txt {
		font-weight: 500;
	}
	.err {
		display: block;
		color: var(--block);
		font-size: var(--text-xs);
		font-weight: 400;
		word-break: break-word;
	}
	.tag {
		margin-left: 0.3rem;
		color: var(--major);
		border-color: color-mix(in srgb, var(--major) 40%, transparent);
	}
	.ms {
		white-space: nowrap;
		padding-top: 0.1rem;
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
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.findings li:last-child {
		border-bottom: 0;
	}
	.findings li div {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.findings strong {
		font-weight: 500;
	}

	.shots {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.shot {
		display: grid;
		gap: 0.25rem;
		width: 10rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: var(--sheet);
		color: var(--ink-2);
		font-size: var(--text-xs);
		text-decoration: none;
		overflow: hidden;
	}
	.shot:hover {
		border-color: var(--rule-strong);
		text-decoration: none;
	}
	.shot img {
		width: 100%;
		aspect-ratio: 16 / 10;
		object-fit: cover;
		object-position: top;
		display: block;
		border-bottom: 1px solid var(--rule);
	}
	.shot span {
		padding: 0 0.45rem 0.35rem;
	}
	.errors {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--block);
	}

	/* Meta column */
	.meta {
		position: sticky;
		top: 1.5rem;
	}
	.meta dl {
		margin: 0;
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		gap: 0.5rem 0.75rem;
		align-items: start;
	}
	.meta dt {
		font-size: var(--text-xs);
		color: var(--ink-3);
		padding-top: 0.1rem;
	}
	.meta dd {
		margin: 0;
		min-width: 0;
	}
	.break {
		word-break: break-all;
		font-family: var(--mono);
		font-size: var(--text-xs);
	}

	@media (max-width: 980px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.meta {
			position: static;
		}
		.meta dl {
			grid-template-columns: 7rem minmax(0, 1fr);
		}
	}
</style>
