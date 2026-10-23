<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import EvidenceThumbs, { type ThumbEvidence } from '#lib/components/EvidenceThumbs.svelte';
	import Lightbox from '#lib/components/Lightbox.svelte';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import AgentQuestion from '#lib/components/AgentQuestion.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import PageNav, { type Section } from '#lib/components/PageNav.svelte';
	import Severity from '#lib/components/Severity.svelte';
	import TraceTimeline, { type Marker } from '#lib/components/TraceTimeline.svelte';
	import { page } from '$app/state';
	import { i18n } from '#lib/i18n/index.js';
	import { isActive } from '#lib/labels.js';
	import { tooltip } from '#lib/tooltip.js';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	let liveStatus = $state<string | null>(null);
	const run = $derived({ ...data.run, status: liveStatus ?? data.run.status });
	const r = $derived(data.report);
	const active = $derived(isActive(run.status));
	const tone = $derived(run.outcome === 'passed' ? 'approve' : run.outcome === 'failed' ? 'request_changes' : 'inconclusive');

	let lightbox: { url: string; label: string } | null = $state(null);
	const openEv = (ev: ThumbEvidence) => {
		if (ev.url) lightbox = { url: ev.url, label: `${ev.id} ${ev.label}` };
	};

	// ---- trace timeline
	let timeline = $state<ReturnType<typeof TraceTimeline>>();
	const hasTrace = $derived(Boolean(r?.timeline));
	const evidenceAt = $derived(new Map((r?.evidence ?? []).map((e) => [e.id, e.createdAt])));
	// A finding's first screenshot was taken when it was observed; its own time is when it was written up.
	const anchorOf = (ids: string[], fallback: string) => ids.map((id) => evidenceAt.get(id)).find((x): x is string => Boolean(x)) ?? fallback;
	const jumpEv = (ev: ThumbEvidence) => ev.createdAt && timeline?.jumpTo(ev.createdAt);
	const markers = $derived.by((): Marker[] =>
		r
			? [
					...r.evidence.map((e): Marker => ({ kind: 'evidence', id: e.id, label: e.label, at: e.createdAt, body: e.note, image: e.url ?? undefined })),
					...r.findings.map(
						(f): Marker => ({
							kind: 'finding',
							id: f.id,
							label: f.title,
							at: anchorOf(f.evidenceIds, f.createdAt),
							severity: f.severity,
							body: [f.description, f.expected && `${i.t('review.expected')}: ${f.expected}`, f.actual && `${i.t('review.observed')}: ${f.actual}`].filter(Boolean).join('\n')
						})
					)
				]
			: []
	);
	const openMarker = (m: Marker) => {
		if (m.image) lightbox = { url: m.image, label: `${m.id} ${m.label}` };
	};
	// Playwright's viewer runs a service worker, which browsers allow only on HTTPS or localhost.
	let secure = $state(false);
	$effect(() => {
		secure = window.isSecureContext;
	});
	const viewerHref = $derived(hasTrace && secure && data.viewerAvailable && r?.traceUrl ? `/trace-viewer/index.html?trace=${encodeURIComponent(new URL(r.traceUrl, page.url.origin).href)}` : null);

	// ---- steps: the first ones, all of them, or only those that failed or were repaired
	const STEP_PREVIEW = 20;
	let warningsOnly = $state(false);
	let stepsExpanded = $state(false);
	const steps = $derived(r?.steps ?? []);
	const warnSteps = $derived(steps.filter((s) => !s.ok || s.healed || s.error));
	const shownSteps = $derived(warningsOnly ? warnSteps : stepsExpanded ? steps : steps.slice(0, STEP_PREVIEW));
	function collapseSteps() {
		stepsExpanded = false;
		tick().then(() => {
			const el = document.getElementById('steps');
			if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
		});
	}

	// ---- the sections the sticky header links to, in page order
	const showLog = $derived(isActive(data.run.status) || data.eventCount > 0);
	const sections = $derived.by((): Section[] => {
		const out: Section[] = [];
		if (r?.timeline) out.push({ id: 'trace', label: i.t('review.sectionTrace') });
		if (active) out.push({ id: 'live', label: i.t('common.sectionLive') });
		if (showLog) out.push({ id: 'log', label: i.t('review.sectionLog') });
		if (!r) return out;
		if (r.judge) out.push({ id: 'judge', label: i.t('test.sectionJudge'), tone: r.judge.passed ? 'pass' : 'block', count: r.judge.passed ? '✓' : '✗' });
		const failed = steps.filter((s) => !s.ok).length;
		out.push({ id: 'steps', label: i.t('test.steps'), count: `${steps.length - failed}/${steps.length}`, tone: failed ? 'block' : warnSteps.length ? 'major' : 'pass' });
		if (r.findings.length) out.push({ id: 'findings', label: i.t('test.findings'), count: r.findings.length, tone: 'major' });
		if (r.evidence.length) out.push({ id: 'screenshots', label: i.t('test.screenshots'), count: r.evidence.length });
		if (r.errors.length) out.push({ id: 'problems', label: i.t('test.sectionProblems'), count: r.errors.length, tone: 'block' });
		return out;
	});
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

<PageNav title={i.t('test.runHeading', { name: run.scriptName })} {sections} />

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
		{#if r?.timeline}
			<TraceTimeline bind:this={timeline} id="trace" runId={r.runId} {markers} viewerUrl={viewerHref} downloadUrl={r.traceUrl} onopen={openMarker} />
		{/if}

		{#if active}
			<div class="stack" id="live">
				{#if data.human?.kind === 'question'}
					<AgentQuestion requestId={data.human.id} question={data.human.reason} context={data.human.context} options={data.human.options} />
					<LiveView src="/test-runs/{data.run.id}/live" url={run.instanceUrl} />
				{:else if data.human}
					<HumanTakeover src="/test-runs/{data.run.id}/live" requestId={data.human.id} reason={data.human.reason} url={run.instanceUrl} />
				{:else}
					<LiveView src="/test-runs/{data.run.id}/live" url={run.instanceUrl} />
				{/if}
			</div>
		{/if}
		{#if showLog}
			<div id="log">
				<LiveLog
					streamUrl="/test-runs/{data.run.id}/events"
					count={data.eventCount}
					active={isActive(data.run.status)}
					onstatus={(s) => (liveStatus = s)}
					online={(line) => /^Mensch (gebraucht|fertig):/.test(line) && invalidateAll()}
				/>
			</div>
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
				<section class="block" id="judge">
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

			<section class="block" id="steps">
				<div class="block-head">
					<h2>{i.t('test.steps')}</h2>
					{#if steps.length > STEP_PREVIEW || warnSteps.length}
						<div class="chips" role="group" aria-label={i.t('test.steps')}>
							<button type="button" class="chip-btn" aria-pressed={!warningsOnly} onclick={() => (warningsOnly = false)}>
								{i.t('common.filterAll')} <span class="n">{steps.length}</span>
							</button>
							<button type="button" class="chip-btn" aria-pressed={warningsOnly} use:tooltip={i.t('test.stepsWarningsHelp')} onclick={() => (warningsOnly = true)}>
								{i.t('common.onlyWarnings')} <span class="n">{warnSteps.length}</span>
							</button>
						</div>
					{/if}
				</div>
				{#if shownSteps.length}
					<div class="sheet">
						<ol class="steps">
							{#each shownSteps as step (step.index)}
								<li class:fail={!step.ok} class:assert={step.assertion}>
									<span class="no">{step.index + 1}</span>
									<span class="mark" aria-label={step.ok ? i.t('test.stepOk') : i.t('test.stepFailed')}><span class="dot {step.ok ? 'pass' : 'block'}" aria-hidden="true"></span></span>
									<span class="txt">
										{step.text}
										<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
										{#if step.healed}<span class="tag healed" tabindex="0" use:tooltip={i.t('test.healedHelp')}>{i.t('test.healed')}</span>{/if}
										{#if step.error}<span class="err">{step.error}</span>{/if}
									</span>
									<span class="ms faint">{step.durationMs} ms</span>
								</li>
							{/each}
						</ol>
						{#if !warningsOnly && steps.length > STEP_PREVIEW}
							<div class="more-row">
								<button type="button" aria-expanded={stepsExpanded} onclick={() => (stepsExpanded ? collapseSteps() : (stepsExpanded = true))}>
									{stepsExpanded ? i.t('common.showLess') : i.t('common.showAll', { n: steps.length })}
								</button>
							</div>
						{/if}
					</div>
				{:else}
					<p class="muted">{i.t('test.noWarnings')}</p>
				{/if}
				{#if r.mode === 'record'}
					<p class="faint">{i.t('test.discardedAttempts')}</p>
				{/if}
			</section>

			{#if r.findings.length}
				<section class="block" id="findings">
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
								{#if hasTrace}
									<button type="button" class="btn ghost small jump" use:tooltip={i.t('common.traceJump')} aria-label="{i.t('common.traceJump')}: {f.id}" onclick={() => timeline?.jumpTo(anchorOf(f.evidenceIds, f.createdAt))}>
										<Icon name="play" size={12} />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if r.evidence.length}
				<section class="block" id="screenshots">
					<h2>{i.t('test.screenshots')}</h2>
					<EvidenceThumbs items={r.evidence} layout="grid" onopen={openEv} onjump={hasTrace ? jumpEv : undefined} />
				</section>
			{/if}

			{#if r.errors.length}
				<section class="block" id="problems">
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
			<dt>{i.t('review.viewports')}</dt>
			<dd>{run.viewport === 'mobile' ? i.t('review.viewportMobile') : i.t('review.viewportDesktop')}</dd>
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

<Lightbox bind:item={lightbox} />

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
	.block-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem 1rem;
		flex-wrap: wrap;
	}
	.stack {
		display: grid;
		gap: 1rem;
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
	}
	.steps li {
		display: grid;
		grid-template-columns: 1.5rem 0.5rem minmax(0, 1fr) auto;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.steps li:last-child {
		border-bottom: 0;
	}
	.no {
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
	.tag.healed {
		cursor: help;
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
	.findings li div {
		flex: 1;
	}
	.findings strong {
		font-weight: 500;
	}
	.findings .jump {
		flex: none;
	}

	.errors {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--block);
	}

	/* Meta column */
	.meta {
		position: sticky;
		top: calc(var(--head-h) + 1.5rem);
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
