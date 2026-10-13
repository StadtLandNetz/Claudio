<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import KnowledgeView from '#lib/components/KnowledgeView.svelte';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import Severity from '#lib/components/Severity.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { ANALYSIS_BUDGET_LABEL, CATEGORY_LABEL, formatDate, formatDuration, formatUsd, isActive } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let liveStatus = $state<string | null>(null);
	const a = $derived({ ...data.analysis, status: liveStatus ?? data.analysis.status });
	const active = $derived(isActive(a.status));
	const isUpdate = $derived(Boolean(a.previousCommitSha));
</script>

<svelte:head><title>Analyse {a.repo} · Claudio</title></svelte:head>

<p class="crumb"><a href="/repos/{a.repo}?tab=knowledge">Wissen</a></p>
<div class="title">
	<div>
		<h1>{isUpdate ? 'Wissensbasis aktualisieren' : 'Repository analysieren'}</h1>
		<p class="muted">
			{#if a.commitSha}
				Commit <code>{a.commitSha.slice(0, 7)}</code>{a.branch ? ` auf ${a.branch}` : ''}{#if isUpdate}, aufbauend auf <code>{a.previousCommitSha?.slice(0, 7)}</code>{/if}
			{:else}
				Instanz {a.instanceUrl}
			{/if}
		</p>
	</div>
	{#if active}
		<form method="POST" action="?/abort" use:enhance>
			<button class="btn danger" type="submit" disabled={a.abortRequested}>
				{a.abortRequested ? 'Wird abgebrochen …' : 'Analyse abbrechen'}
			</button>
		</form>
	{/if}
</div>

<div class="layout">
	<div class="main">
		{#if active}
			<p class="notice">
				{a.status === 'queued'
					? 'Wartet auf den Worker. Läuft kein Worker, starte ihn mit pnpm worker.'
					: 'Claudio liest den Code und geht die App Bildschirm für Bildschirm durch. Die Dokumente erscheinen, sobald die Analyse fertig ist.'}
			</p>
		{/if}

		{#if active && data.human}
			<HumanTakeover src="/analyses/{data.analysis.id}/live" requestId={data.human.id} reason={data.human.reason} url={a.instanceUrl} />
		{:else if active}
			<LiveView src="/analyses/{data.analysis.id}/live" url={a.instanceUrl} />
		{/if}

		{#if isActive(data.analysis.status) || data.events.length > 0}
			<LiveLog
				streamUrl="/analyses/{data.analysis.id}/events"
				events={data.events}
				active={isActive(data.analysis.status)}
				onstatus={(s) => (liveStatus = s)}
				online={(line) => /^Mensch (gebraucht|fertig):/.test(line) && invalidateAll()}
			/>
		{/if}

		{#if a.summaryHtml}
			<section class="block">
				<h2>Zusammenfassung</h2>
				<div class="prose">{@html a.summaryHtml}</div>
			</section>
		{/if}

		{#if data.docs.length}
			<section class="block">
				<h2>Wissensbasis aus diesem Lauf</h2>
				<KnowledgeView docs={data.docs} />
			</section>
		{:else if !active}
			<p class="notice error">Diese Analyse hat keine Dokumente geschrieben.</p>
		{/if}

		{#if data.findings.length}
			<section class="block">
				<h2>Nebenbei gefundene Fehler</h2>
				<p class="muted">Bei der Analyse aufgefallen. Sie sind kein Ergebnis eines Reviews und blockieren nichts.</p>
				<ul class="findings sheet">
					{#each data.findings as f (f.id)}
						<li>
							<Severity severity={f.severity} />
							<div>
								<strong>{f.title}</strong>
								<span class="faint">{CATEGORY_LABEL[f.category] ?? f.category}{f.url ? `, ${f.url}` : ''}</span>
								<p>{f.description}</p>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.evidence.length}
			<section class="block">
				<h2>Screenshots</h2>
				<div class="shots">
					{#each data.evidence as ev (ev.id)}
						{#if ev.url}
							<a class="shot" href={ev.url} target="_blank" rel="noopener noreferrer">
								<img src={ev.url} alt={ev.label} loading="lazy" />
								<span>{ev.id} {ev.label}</span>
							</a>
						{:else}
							<div class="shot-expired" title="Screenshots werden nach 14 Tagen gelöscht">
								<span>Screenshot gelöscht</span>
								<span class="faint">{ev.id} {ev.label}</span>
							</div>
						{/if}
					{/each}
				</div>
			</section>
		{/if}

		{#if a.errors.length}
			<section class="block">
				<h2>Probleme während des Runs</h2>
				<ul class="errors">
					{#each a.errors as err, i (i)}<li>{err}</li>{/each}
				</ul>
			</section>
		{/if}
	</div>

	<aside class="meta">
		<dl>
			<dt>Status</dt>
			<dd><StatusBadge status={a.status} /></dd>
			<dt>Instanz</dt>
			<dd class="break">{a.instanceUrl}</dd>
			<dt>Rollen</dt>
			<dd>{a.request.roles.join(', ') || 'alle konfigurierten'}</dd>
			<dt>Budget</dt>
			<dd>{ANALYSIS_BUDGET_LABEL[a.request.budget]}</dd>
			{#if a.cost}
				<dt>Kosten</dt>
				<dd>
					{formatUsd(a.cost.usd)}<br />
					<span class="faint">{a.cost.turns} Züge, {a.cost.browserSteps} Browser-Schritte, {formatDuration(a.cost.durationMs)}</span>
				</dd>
			{/if}
			<dt>Gestartet</dt>
			<dd>{formatDate(a.createdAt)}<br /><span class="faint">von {a.startedBy}</span></dd>
			{#if a.finishedAt}
				<dt>Beendet</dt>
				<dd>{formatDate(a.finishedAt)}</dd>
			{/if}
			{#if a.fixture}
				<dt>Quelle</dt>
				<dd>Demo-Checkout statt GitHub</dd>
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
		margin-bottom: 1.5rem;
	}
	.title p {
		margin-top: 0.25rem;
	}
	code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.875em;
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
		gap: 0.75rem;
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
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
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
