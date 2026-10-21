<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import KnowledgeView from '#lib/components/KnowledgeView.svelte';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import Severity from '#lib/components/Severity.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { isActive } from '#lib/labels.js';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();

	let liveStatus = $state<string | null>(null);
	const a = $derived({ ...data.analysis, status: liveStatus ?? data.analysis.status });
	const active = $derived(isActive(a.status));
	const isUpdate = $derived(Boolean(a.previousCommitSha));
</script>

<svelte:head><title>{i.t('analysis.pageTitle', { repo: a.repo })}</title></svelte:head>

<div class="page-title">
	<div>
		<p class="crumbs">
			<a href="/repos/{a.repo}">{a.repo}</a><span class="sep"></span><a href="/repos/{a.repo}?tab=knowledge">{i.t('analysis.crumbKnowledge')}</a>
		</p>
		<h1>{isUpdate ? i.t('analysis.titleUpdate') : i.t('analysis.titleAnalyse')}</h1>
		<p class="lead">
			{#if a.commitSha}
				{i.t('analysis.commit')} <code>{a.commitSha.slice(0, 7)}</code>{a.branch ? i.t('analysis.onBranch', { branch: a.branch }) : ''}{#if isUpdate}{i.t('analysis.buildingOn')} <code>{a.previousCommitSha?.slice(0, 7)}</code>{/if}
			{:else}
				{i.t('analysis.instance', { url: a.instanceUrl })}
			{/if}
		</p>
	</div>
	{#if active}
		<form method="POST" action="?/abort" use:enhance>
			<button class="btn danger" type="submit" disabled={a.abortRequested}>
				{a.abortRequested ? i.t('analysis.aborting') : i.t('analysis.abort')}
			</button>
		</form>
	{/if}
</div>

<div class="layout">
	<div class="main">
		{#if active}
			<p class="notice">
				{a.status === 'queued'
					? i.t('analysis.queuedNotice')
					: i.t('analysis.runningNotice')}
			</p>
		{/if}

		{#if active && data.human}
			<HumanTakeover src="/analyses/{data.analysis.id}/live" requestId={data.human.id} reason={data.human.reason} url={a.instanceUrl} />
		{:else if active}
			<LiveView src="/analyses/{data.analysis.id}/live" url={a.instanceUrl} />
		{/if}

		{#if isActive(data.analysis.status) || data.eventCount > 0}
			<LiveLog
				streamUrl="/analyses/{data.analysis.id}/events"
				count={data.eventCount}
				active={isActive(data.analysis.status)}
				onstatus={(s) => (liveStatus = s)}
				online={(line) => /^Mensch (gebraucht|fertig):/.test(line) && invalidateAll()}
			/>
		{/if}

		{#if a.summaryHtml}
			<section class="block">
				<h2>{i.t('analysis.summary')}</h2>
				<div class="prose">{@html a.summaryHtml}</div>
			</section>
		{/if}

		{#if data.docs.length}
			<section class="block">
				<h2>{i.t('analysis.docsFromRun')}</h2>
				<KnowledgeView docs={data.docs} />
			</section>
		{:else if !active}
			<p class="notice error">{i.t('analysis.noDocs')}</p>
		{/if}

		{#if data.findings.length}
			<section class="block">
				<h2>{i.t('analysis.findings')}</h2>
				<p class="muted">{i.t('analysis.findingsHint')}</p>
				<ul class="findings sheet">
					{#each data.findings as f (f.id)}
						<li>
							<Severity severity={f.severity} />
							<div>
								<strong>{f.title}</strong>
								<span class="faint">{i.labels.category[f.category] ?? f.category}{f.url ? `, ${f.url}` : ''}</span>
								<p>{f.description}</p>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.evidence.length}
			<section class="block">
				<h2>{i.t('analysis.screenshots')}</h2>
				<div class="shots">
					{#each data.evidence as ev (ev.id)}
						{#if ev.url}
							<a class="shot" href={ev.url} target="_blank" rel="noopener noreferrer">
								<img src={ev.url} alt={ev.label} loading="lazy" />
								<span>{ev.id} {ev.label}</span>
							</a>
						{:else}
							<div class="shot-expired" title={i.t('analysis.screenshotExpiredTitle')}>
								<span>{i.t('analysis.screenshotDeleted')}</span>
								<span class="faint">{ev.id} {ev.label}</span>
							</div>
						{/if}
					{/each}
				</div>
			</section>
		{/if}

		{#if a.errors.length}
			<section class="block">
				<h2>{i.t('analysis.runProblems')}</h2>
				<ul class="errors">
					{#each a.errors as err, n (n)}<li>{err}</li>{/each}
				</ul>
			</section>
		{/if}
	</div>

	<aside class="meta">
		<dl>
			<dt>{i.t('analysis.metaStatus')}</dt>
			<dd><StatusBadge status={a.status} /></dd>
			<dt>{i.t('analysis.metaInstance')}</dt>
			<dd class="break">{a.instanceUrl}</dd>
			<dt>{i.t('analysis.metaRoles')}</dt>
			<dd>{a.request.roles.join(', ') || i.t('analysis.allRoles')}</dd>
			<dt>{i.t('analysis.metaBudget')}</dt>
			<dd>{i.labels.analysisBudget[a.request.budget]}</dd>
			{#if a.cost}
				<dt>{i.t('analysis.metaCost')}</dt>
				<dd>
					{i.formatUsd(a.cost.usd)}<br />
					<span class="faint">{i.t('analysis.costDetail', { turns: a.cost.turns, steps: a.cost.browserSteps, duration: i.formatDuration(a.cost.durationMs) })}</span>
				</dd>
			{/if}
			<dt>{i.t('analysis.metaStarted')}</dt>
			<dd>{i.formatDate(a.createdAt)}<br /><span class="faint">{i.t('analysis.startedBy', { login: a.startedBy })}</span></dd>
			{#if a.finishedAt}
				<dt>{i.t('analysis.metaFinished')}</dt>
				<dd>{i.formatDate(a.finishedAt)}</dd>
			{/if}
			{#if a.fixture}
				<dt>{i.t('analysis.metaSource')}</dt>
				<dd>{i.t('analysis.sourceFixture')}</dd>
			{/if}
		</dl>
	</aside>
</div>

<style>
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

	/* Findings noticed on the side: a plain list, nothing to rate */
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
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 0.5rem;
	}
	.shot {
		display: grid;
		gap: 0.25rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: var(--sheet);
		color: var(--ink-2);
		font-size: var(--text-xs);
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
		display: grid;
		gap: 1rem;
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
