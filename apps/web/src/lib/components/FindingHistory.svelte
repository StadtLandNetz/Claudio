<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import type { Severity as SeverityLevel } from '@claudio/core';
	import { buildHistory, type HistReview, type Relation } from '#lib/finding-history.js';
	import { i18n } from '#lib/i18n/index.js';
	import { tooltip } from '#lib/tooltip.js';
	import Severity from './Severity.svelte';

	/**
	 * The findings of a pull request across its reviews: a stylised timeline with one
	 * column per review (bar: its findings by severity, dot: its verdict). Drag along
	 * it, click a column or use the arrow keys; below, the findings of that review
	 * compared with the one before. `onopen` shows a finding of the current review.
	 */
	let { reviews, currentId, onopen }: { reviews: HistReview[]; currentId: number; onopen?: (findingId: string) => void } = $props();
	const i = i18n();

	const steps = $derived(buildHistory(reviews));
	const currentIdx = $derived(Math.max(0, reviews.findIndex((r) => r.id === currentId)));
	// svelte-ignore state_referenced_locally
	let idx = $state(currentIdx);
	const step = $derived(steps[Math.min(idx, steps.length - 1)]!);

	const SEVERITIES: SeverityLevel[] = ['blocker', 'major', 'minor', 'suggestion'];
	const maxCount = $derived(Math.max(1, ...reviews.map((r) => r.findings.length)));
	const bySeverity = (r: HistReview) => SEVERITIES.map((s) => ({ s, n: r.findings.filter((f) => f.severity === s).length }));

	// Labels under every column only when there is room; otherwise first, last, current and selected.
	let trackWidth = $state(0);
	const roomy = $derived(trackWidth / Math.max(1, reviews.length) >= 34);
	const labelled = (k: number) => roomy || k === idx || ((k === 0 || k === reviews.length - 1 || k === currentIdx) && Math.abs(k - idx) > 1);

	let track = $state<HTMLElement>();
	let dragging = false;
	function pick(e: PointerEvent) {
		if (!track) return;
		const r = track.getBoundingClientRect();
		idx = Math.min(reviews.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * reviews.length)));
	}
	function down(e: PointerEvent) {
		dragging = true;
		track?.setPointerCapture(e.pointerId);
		pick(e);
	}
	function move(e: PointerEvent) {
		if (dragging) pick(e);
	}
	function up(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		track?.releasePointerCapture(e.pointerId);
	}
	function key(e: KeyboardEvent) {
		const next = e.key === 'ArrowLeft' ? idx - 1 : e.key === 'ArrowRight' ? idx + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? reviews.length - 1 : null;
		if (next === null) return;
		e.preventDefault();
		idx = Math.min(reviews.length - 1, Math.max(0, next));
	}

	const relLabel: Record<Relation, () => string> = {
		new: () => i.t('review.histNew'),
		again: () => i.t('review.histAgain'),
		still_open: () => i.t('review.histStillOpen'),
		back: () => i.t('review.histBack')
	};
	const counts = $derived({
		new: step.rows.filter((r) => r.rel === 'new').length,
		again: step.rows.filter((r) => r.rel === 'again' || r.rel === 'still_open').length,
		back: step.rows.filter((r) => r.rel === 'back').length,
		fixed: step.gone.filter((g) => g.fixed).length,
		gone: step.gone.filter((g) => !g.fixed).length
	});
	const shortDate = (iso: string) => new Intl.DateTimeFormat(i.locale === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short' }).format(new Date(iso));
	const isCurrent = $derived(step.review.id === currentId);
	const findingHref = (reviewId: number, findingId: string) => (reviewId === currentId ? `#finding-${findingId}` : `/reviews/${reviewId}#finding-${findingId}`);
	function open(e: MouseEvent, reviewId: number, findingId: string) {
		if (reviewId !== currentId || !onopen) return;
		e.preventDefault();
		onopen(findingId);
	}
</script>

<div class="hist">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="track"
		bind:this={track}
		bind:clientWidth={trackWidth}
		style:--n={reviews.length}
		role="slider"
		tabindex="0"
		aria-label={i.t('review.histTimeline')}
		aria-valuemin={0}
		aria-valuemax={reviews.length - 1}
		aria-valuenow={idx}
		aria-valuetext="#{step.review.id}, {i.formatDate(step.review.at)}"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onkeydown={key}
	>
		<div class="line" aria-hidden="true"></div>
		{#each reviews as r, k (r.id)}
			<div class="col" class:sel={k === idx} class:current={r.id === currentId} aria-hidden="true">
				<span class="bar" title="#{r.id}: {i.t('review.histCount', { n: r.findings.length })}">
					{#each bySeverity(r) as seg (seg.s)}
						{#if seg.n}<span class="seg {seg.s}" style:height="{(seg.n / maxCount) * 100}%"></span>{/if}
					{/each}
				</span>
				<span class="node {r.verdict}"></span>
				<span class="lbl">{#if labelled(k)}#{r.id}{/if}</span>
			</div>
		{/each}
	</div>
	<p class="hint faint">
		{i.t('review.histDragHint')} ·
		<span class="match" use:tooltip={i.t('review.histMatchHint')}>{i.t('review.histMatchShort')}</span>
	</p>

	<header class="head">
		<div class="what">
			<strong>{i.t('review.histReview', { id: step.review.id })}</strong>
			<span class="faint">{i.formatDate(step.review.at)}</span>
			<span class="verdict {step.review.verdict}">{i.labels.verdict[step.review.verdict]}</span>
			{#if isCurrent}<span class="tag">{i.t('review.histCurrent')}</span>{/if}
			{#if step.review.followUpOf}<span class="tag">{i.t('review.histFollowUp', { id: step.review.followUpOf })}</span>{/if}
		</div>
		{#if !isCurrent}<a class="go" href="/reviews/{step.review.id}">{i.t('review.histOpen')}</a>{/if}
	</header>
	<p class="sum muted">
		{#if step.prev}
			{i.t('review.histSummary', { new: counts.new, again: counts.again, back: counts.back, fixed: counts.fixed, gone: counts.gone, id: step.prev.id })}
		{:else}
			{i.t('review.histFirst', { n: step.rows.length })}
		{/if}
	</p>

	{#if step.rows.length === 0 && step.gone.length === 0}
		<p class="muted">{i.t('review.histNone')}</p>
	{:else}
		<ul class="rows sheet">
			{#each step.rows as row (row.key)}
				<li class="row {row.rel}" class:dismissed={row.f.rating === 'dismissed'} animate:flip={{ duration: 180 }} in:fade={{ duration: 140 }}>
					<Severity severity={row.f.severity} />
					<div class="main">
						<a class="title" href={findingHref(step.review.id, row.f.id)} onclick={(e) => open(e, step.review.id, row.f.id)}>{row.f.title}</a>
						<span class="meta faint">
							{i.labels.category[row.f.category] ?? row.f.category} · {row.f.id}
							{#if row.was && row.rel !== 'new'} · <a href={findingHref(row.was.reviewId, row.was.findingId)}>{i.t('review.histWas', { fid: row.was.findingId, id: row.was.reviewId })}</a>{/if}
							{#if row.f.rating === 'dismissed'} · {i.t('common.traceDismissed')}{/if}
							{#if row.f.blocking && row.f.rating !== 'dismissed'} · <span class="blk">{i.t('common.traceBlocking')}</span>{/if}
						</span>
					</div>
					<span class="rel {row.rel}">{relLabel[row.rel]()}</span>
					<span class="seen" aria-label={i.t('review.histSeen')} role="img">
						{#each row.seen as on, k (k)}<span class="sq" class:on class:sel={k === idx}></span>{/each}
					</span>
				</li>
			{/each}
			{#if step.gone.length}
				<li class="gone-head faint">{i.t('review.histGoneHead', { id: step.prev?.id ?? '' })}</li>
				{#each step.gone as g (`g-${g.key}`)}
					<li class="row gone" class:fixed={g.fixed} animate:flip={{ duration: 180 }} in:fade={{ duration: 140 }}>
						<Severity severity={g.f.severity} />
						<div class="main">
							<a class="title" href={findingHref(step.prev!.id, g.f.id)}>{g.f.title}</a>
							<span class="meta faint">{i.labels.category[g.f.category] ?? g.f.category} · {g.f.id} · #{step.prev?.id}</span>
						</div>
						<span class="rel {g.fixed ? 'fixed' : 'gone'}">{g.fixed ? i.t('review.histFixed') : i.t('review.histGoneLabel')}</span>
						<span class="seen" aria-label={i.t('review.histSeen')} role="img">
							{#each g.seen as on, k (k)}<span class="sq" class:on class:sel={k === idx}></span>{/each}
						</span>
					</li>
				{/each}
			{/if}
		</ul>
	{/if}
</div>

<style>
	.hist {
		display: grid;
		gap: 0.6rem;
	}

	/* The timeline: one column per review, bars above the line, verdict dots on it */
	.track {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		height: 6.25rem;
		padding: 0.5rem 0.25rem 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-m);
		background: var(--sheet);
		cursor: pointer;
		user-select: none;
		touch-action: none;
	}
	.track:focus-visible {
		outline-offset: 2px;
	}
	.line {
		position: absolute;
		left: 0.75rem;
		right: 0.75rem;
		top: 4.05rem;
		height: 1px;
		background: var(--rule-strong);
	}
	.col {
		position: relative;
		display: grid;
		grid-template-rows: 3.1rem 1.1rem auto;
		justify-items: center;
		align-items: end;
		gap: 0.15rem;
		border-radius: var(--radius-s);
		transition: background-color 0.12s;
	}
	.col:hover {
		background: color-mix(in srgb, var(--ink) 3%, transparent);
	}
	.col.sel {
		background: var(--accent-soft);
	}
	.bar {
		display: flex;
		flex-direction: column-reverse;
		justify-content: flex-start;
		width: min(1rem, 55%);
		height: 100%;
		gap: 1px;
	}
	.seg {
		display: block;
		width: 100%;
		min-height: 2px;
		border-radius: 1px;
		background: var(--hint);
	}
	.seg.blocker {
		background: var(--block);
	}
	.seg.major {
		background: var(--major);
	}
	.seg.minor {
		background: var(--minor);
	}
	.col:not(.sel) .seg {
		opacity: 0.55;
	}
	.node {
		position: relative;
		z-index: 1;
		align-self: center;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		border: 2px solid var(--sheet);
		background: var(--hint);
		box-shadow: 0 0 0 1px var(--rule-strong);
		transition: transform 0.12s;
	}
	.node.approve {
		background: var(--pass);
	}
	.node.request_changes {
		background: var(--block);
	}
	.col.sel .node {
		transform: scale(1.45);
		box-shadow: 0 0 0 1.5px var(--accent);
	}
	.lbl {
		align-self: start;
		min-height: 1rem;
		font-size: var(--text-xs);
		font-family: var(--mono);
		color: var(--ink-3);
		white-space: nowrap;
	}
	.col.sel .lbl {
		color: var(--ink);
		font-weight: 500;
	}
	.col.current .lbl {
		color: var(--accent);
	}
	.hint {
		margin-top: -0.25rem;
	}
	.match {
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
		cursor: help;
	}

	/* The selected review */
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}
	.what {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.what strong {
		font-weight: 600;
	}
	.verdict {
		font-weight: 500;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}
	.verdict.approve {
		color: var(--pass);
	}
	.verdict.request_changes {
		color: var(--block);
	}
	.go {
		font-size: var(--text-sm);
	}

	/* The findings of that review, compared with the one before */
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
	.row {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr) auto auto;
		gap: 0.75rem;
		align-items: start;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		background: var(--sheet);
	}
	.row:last-child {
		border-bottom: 0;
	}
	.row :global(.sev) {
		justify-self: start;
	}
	.main {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}
	.title {
		color: var(--ink);
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.row.dismissed .title,
	.row.gone .title {
		color: var(--ink-3);
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--ink-3) 60%, transparent);
	}
	.row.gone.fixed .title {
		text-decoration: none;
		color: var(--ink-2);
	}
	.meta a {
		color: inherit;
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
	}
	.blk {
		color: var(--block);
	}
	.rel {
		align-self: center;
		padding: 0 0.4rem;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1.5;
		color: var(--ink-2);
		white-space: nowrap;
	}
	.rel.new {
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.rel.still_open,
	.rel.back {
		border-color: color-mix(in srgb, var(--major) 45%, transparent);
		color: var(--major);
	}
	.rel.fixed {
		border-color: color-mix(in srgb, var(--pass) 45%, transparent);
		background: var(--pass-soft);
		color: var(--pass);
	}
	.rel.gone {
		color: var(--ink-3);
	}
	.gone-head {
		padding: 0.45rem 0.75rem 0.3rem;
		border-bottom: 1px solid var(--rule);
		background: var(--sunken);
		font-weight: 500;
	}

	/* In which reviews the problem was reported: one square per review */
	.seen {
		display: flex;
		align-self: center;
		gap: 2px;
		max-width: 12rem;
	}
	.sq {
		flex: 1 1 0;
		width: 6px;
		min-width: 3px;
		height: 6px;
		border-radius: 1px;
		background: var(--rule);
	}
	.sq.on {
		background: var(--ink-3);
	}
	.sq.sel {
		box-shadow: 0 0 0 1px var(--accent);
	}
	.sq.sel.on {
		background: var(--accent);
	}
	@media (max-width: 640px) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.row :global(.sev) {
			grid-column: 1 / -1;
		}
		.seen {
			display: none;
		}
	}
</style>
