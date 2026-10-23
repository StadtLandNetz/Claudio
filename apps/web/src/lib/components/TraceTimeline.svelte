<script module lang="ts">
	/** A moment of the run worth marking: a finding, a screenshot, an acceptance criterion, a note of the agent. */
	export type Marker = {
		kind: 'finding' | 'evidence' | 'ac' | 'note';
		id: string;
		label: string;
		at: string;
		severity?: string;
		status?: string;
		/** A finding that blocks approval, or one a person has dismissed. */
		blocking?: boolean;
		dismissed?: boolean;
		/** The description, the criterion's notes, the note's text, what the screenshot shows. */
		body?: string;
		/** Where the item sits on the page. */
		href?: string;
		/** The screenshot itself. */
		image?: string;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import type { Severity as SeverityLevel, TraceIndex } from '@claudio/core';
	import { i18n } from '#lib/i18n/index.js';
	import Icon from './Icon.svelte';
	import { tooltip } from '#lib/tooltip.js';
	import Severity from './Severity.svelte';

	/**
	 * The run's Playwright trace as a timeline: the screen at any moment, the markers
	 * of what the review found, and every browser action and agent step in order. The
	 * list under the controls follows the playhead, the panel below it tells what was
	 * found there. `jumpTo(iso)` seeks to a report timestamp and scrolls the timeline
	 * into view; the screen is kept short enough that track and list fit with it.
	 */
	let {
		id,
		runId,
		markers,
		viewerUrl = null,
		downloadUrl = null,
		onopen
	}: { id?: string; runId: string; markers: Marker[]; viewerUrl?: string | null; downloadUrl?: string | null; onopen?: (m: Marker) => void } = $props();
	const i = i18n();

	let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');
	let index = $state<TraceIndex | null>(null);
	let t = $state(0);
	let playing = $state(false);
	let rate = $state<1 | 2 | 4>(1);
	let shownSrc = $state<string | null>(null);
	let flash = $state(false);
	let root = $state<HTMLElement>();
	let track = $state<HTMLElement>();
	let list = $state<HTMLElement>();
	// A jump requested before the index arrived, as wall-clock ms.
	let pendingWall: number | null = null;

	$effect(() => {
		const id = runId;
		const ctrl = new AbortController();
		status = 'loading';
		index = null;
		fetch(`/runs/${id}/trace/index.json`, { signal: ctrl.signal })
			.then(async (res) => {
				if (res.status === 404) {
					status = 'missing';
					return;
				}
				if (!res.ok) throw new Error(String(res.status));
				const data = (await res.json()) as TraceIndex;
				index = data;
				status = 'ready';
				if (pendingWall !== null) {
					seek(pendingWall - data.startWall, true);
					pendingWall = null;
				}
			})
			.catch((e: unknown) => {
				if ((e as { name?: string })?.name !== 'AbortError') status = 'error';
			});
		return () => ctrl.abort();
	});

	const duration = $derived(index?.durationMs ?? 0);
	const clampT = (ms: number) => Math.min(Math.max(ms, 0), duration);
	const pct = (ms: number) => (duration ? (clampT(ms) / duration) * 100 : 0);
	const fmt = (ms: number) => {
		const s = Math.max(0, ms) / 1000;
		return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
	};
	const toneOf = (m: Marker) => (m.kind === 'finding' ? (m.severity ?? '') : m.kind === 'ac' ? (m.status ?? '') : '');

	type Placed = Marker & { t: number };
	const markerTs = $derived.by((): Placed[] => {
		if (!index) return [];
		const start = index.startWall;
		return markers
			.map((m) => ({ ...m, t: Date.parse(m.at) - start }))
			.filter((m) => Number.isFinite(m.t))
			.map((m) => ({ ...m, t: clampT(m.t) }))
			.sort((a, b) => a.t - b.t);
	});
	const lane = (kind: Marker['kind']) => markerTs.filter((m) => m.kind === kind);
	// Tool calls that the markers already stand for are left out of the lanes and the list.
	const agentCalls = $derived((index?.toolCalls ?? []).filter((c) => c.tool !== 'evidence' && c.tool !== 'finding' && c.tool !== 'ac' && c.tool !== 'note'));

	// What was found at the playhead: the markers of the latest moment at or before it.
	const ORDER: Record<Marker['kind'], number> = { finding: 0, ac: 1, note: 2, evidence: 3 };
	const activeMarkers = $derived.by((): Placed[] => {
		let at: number | null = null;
		for (const m of markerTs) {
			if (m.t <= t) at = m.t;
			else break;
		}
		return at === null ? [] : markerTs.filter((m) => m.t === at).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
	});

	// The last frame at or before the playhead; before the first frame, the first one.
	const frameIdx = $derived.by(() => {
		const fr = index?.frames ?? [];
		let lo = 0;
		let hi = fr.length - 1;
		let ans = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (fr[mid]!.t <= t) {
				ans = mid;
				lo = mid + 1;
			} else hi = mid - 1;
		}
		return ans < 0 && fr.length ? 0 : ans;
	});
	const frameUrl = (file: string) => `/runs/${runId}/trace/frame/${encodeURIComponent(file)}`;
	const frameSrc = $derived(index && frameIdx >= 0 ? frameUrl(index.frames[frameIdx]!.file) : null);
	const urlAt = $derived.by(() => {
		let u = '';
		for (const n of index?.navigations ?? []) {
			if (n.t <= t) u = n.url;
			else break;
		}
		return u;
	});

	type Ev = { key: string; t: number; kind: string; label: string; tone?: string; blocking?: boolean; dismissed?: boolean };
	const kindLabel: Record<string, () => string> = {
		action: () => i.t('common.traceKindAction'),
		agent: () => i.t('common.traceKindAgent'),
		nav: () => i.t('common.traceKindNav'),
		console: () => i.t('common.traceKindConsole'),
		finding: () => i.t('common.traceKindFinding'),
		evidence: () => i.t('common.traceKindEvidence'),
		ac: () => i.t('common.traceKindAc'),
		note: () => i.t('common.traceKindNote')
	};
	const events = $derived.by((): Ev[] => {
		if (!index) return [];
		const out: Ev[] = [];
		index.actions.forEach((a, k) => out.push({ key: `a${k}`, t: a.t, kind: 'action', label: a.detail ? `${a.title} ${a.detail}` : a.title, tone: a.error ? 'block' : undefined }));
		agentCalls.forEach((c, k) => out.push({ key: `c${k}`, t: c.t, kind: 'agent', label: `${c.tool}: ${c.label}` }));
		index.navigations.forEach((n, k) => out.push({ key: `n${k}`, t: n.t, kind: 'nav', label: n.url }));
		index.console.forEach((c, k) => out.push({ key: `o${k}`, t: c.t, kind: 'console', label: c.text, tone: c.level === 'error' ? 'block' : 'major' }));
		markerTs.forEach((m) => out.push({ key: `m-${m.kind}-${m.id}`, t: m.t, kind: m.kind, label: m.kind === 'note' ? m.label : `${m.id} ${m.label}`, tone: toneOf(m), blocking: m.blocking, dismissed: m.dismissed }));
		return out.sort((a, b) => a.t - b.t);
	});
	const currentIdx = $derived.by(() => {
		let idx = -1;
		for (let k = 0; k < events.length; k++) {
			if (events[k]!.t <= t) idx = k;
			else break;
		}
		return idx;
	});

	// Swap the image only once the frame has loaded, and have the next one ready.
	let seq = 0;
	$effect(() => {
		const src = frameSrc;
		const next = index && frameIdx + 1 < index.frames.length ? frameUrl(index.frames[frameIdx + 1]!.file) : null;
		if (!src) {
			shownSrc = null;
			return;
		}
		const n = ++seq;
		const timer = setTimeout(() => {
			const img = new Image();
			img.onload = () => {
				if (n !== seq) return;
				shownSrc = src;
				if (next) new Image().src = next;
			};
			img.src = src;
		}, 30);
		return () => clearTimeout(timer);
	});

	// Playback advances the playhead at wall-clock speed times the rate.
	$effect(() => {
		if (!playing) return;
		const speed = rate;
		let last = performance.now();
		let raf = 0;
		const step = (now: number) => {
			const end = untrack(() => duration);
			const cur = untrack(() => t);
			t = Math.min(cur + (now - last) * speed, end);
			last = now;
			if (t >= end) {
				playing = false;
				return;
			}
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	// The list follows the playhead on seeks (not during playback).
	$effect(() => {
		const idx = currentIdx;
		const el = list?.children[idx] as HTMLElement | undefined;
		if (!list || !el || untrack(() => playing)) return;
		const top = el.offsetTop;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight;
	});

	function seek(ms: number, pause = false) {
		t = clampT(ms);
		if (pause) playing = false;
	}
	function reveal() {
		root?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		flash = true;
		setTimeout(() => (flash = false), 1200);
	}
	/** Seek to a report timestamp (ISO) and bring the timeline into view. */
	export function jumpTo(iso: string) {
		const wall = Date.parse(iso);
		if (!Number.isFinite(wall)) return;
		if (index) seek(wall - index.startWall, true);
		else pendingWall = wall;
		reveal();
	}
	function prevMarker() {
		const m = [...markerTs].reverse().find((x) => x.t < t - 1);
		seek(m ? m.t : 0, true);
	}
	function nextMarker() {
		const m = markerTs.find((x) => x.t > t + 1);
		seek(m ? m.t : duration, true);
	}
	function stepFrame(dir: 1 | -1) {
		const fr = index?.frames ?? [];
		const idx = Math.min(Math.max(frameIdx + dir, 0), fr.length - 1);
		if (fr[idx]) seek(fr[idx].t, true);
	}

	let dragging = false;
	function seekFromPointer(e: PointerEvent) {
		if (!track) return;
		const r = track.getBoundingClientRect();
		seek(((e.clientX - r.left) / r.width) * duration, true);
	}
	function onPointerDown(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('.mk')) return;
		dragging = true;
		track?.setPointerCapture(e.pointerId);
		seekFromPointer(e);
	}
	function onPointerMove(e: PointerEvent) {
		if (dragging) seekFromPointer(e);
	}
	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		track?.releasePointerCapture(e.pointerId);
	}
	function onKey(e: KeyboardEvent) {
		const big = e.shiftKey ? 10000 : 1000;
		switch (e.key) {
			case 'ArrowLeft':
				seek(t - big, true);
				break;
			case 'ArrowRight':
				seek(t + big, true);
				break;
			case 'Home':
				seek(0, true);
				break;
			case 'End':
				seek(duration, true);
				break;
			case ' ':
				playing = !playing;
				break;
			case '[':
				prevMarker();
				break;
			case ']':
				nextMarker();
				break;
			case ',':
				stepFrame(-1);
				break;
			case '.':
				stepFrame(1);
				break;
			default:
				return;
		}
		e.preventDefault();
	}
</script>

{#if status !== 'missing'}
	<section class="trace sheet" {id} class:flash bind:this={root} aria-label={i.t('common.trace')}>
		<header>
			<h2>{i.t('common.trace')}</h2>
			{#if urlAt}<span class="url faint" use:tooltip={urlAt}>{urlAt}</span>{/if}
			<span class="links">
				{#if viewerUrl}
					<a class="btn ghost small" href={viewerUrl} target="_blank" rel="noopener noreferrer">{i.t('common.traceOpenViewer')} <Icon name="external" size={12} /></a>
				{/if}
				{#if downloadUrl}<a class="btn ghost small" href={downloadUrl}>{i.t('common.traceDownload')}</a>{/if}
			</span>
		</header>
		{#if status === 'loading'}
			<p class="note faint">{i.t('common.traceLoading')}</p>
		{:else if status === 'error'}
			<p class="note faint">{i.t('common.traceFailed')}</p>
		{:else if index}
			<div class="screen">
				{#if shownSrc}<img src={shownSrc} alt={i.t('common.traceFrameAlt')} />{/if}
			</div>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="track"
				bind:this={track}
				role="slider"
				tabindex="0"
				aria-label={i.t('common.traceTimeline')}
				aria-valuemin="0"
				aria-valuemax={Math.round(duration)}
				aria-valuenow={Math.round(t)}
				aria-valuetext={fmt(t)}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
				onkeydown={onKey}
			>
				<div class="lane nav">
					{#each index.navigations as n, k (k)}<span class="tick nav" style:left="{pct(n.t)}%" use:tooltip={`${i.t('common.traceKindNav')} · ${fmt(n.t)} · ${n.url}`}></span>{/each}
				</div>
				{#each ['finding', 'ac', 'evidence', 'note'] as const as kind (kind)}
					<div class="lane {kind}">
						{#each lane(kind) as m (`${m.kind}-${m.id}`)}
							<button
								type="button"
								class="mk {m.kind} {toneOf(m)}"
								class:blocking={m.blocking}
								class:dismissed={m.dismissed}
								style:left="{pct(m.t)}%"
								use:tooltip={`${kindLabel[m.kind]?.() ?? ''} · ${fmt(m.t)} · ${m.kind === 'note' ? m.label : `${m.id} ${m.label}`}${m.blocking ? ` · ${i.t('common.traceBlocking')}` : ''}${m.dismissed ? ` · ${i.t('common.traceDismissed')}` : ''}`}
								aria-label={m.kind === 'note' ? m.label : `${m.id} ${m.label}`}
								tabindex="-1"
								onclick={() => seek(m.t, true)}
							></button>
						{/each}
					</div>
				{/each}
				<div class="lane agent">
					{#each agentCalls as c, k (k)}<span class="tick agent" style:left="{pct(c.t)}%" use:tooltip={`${i.t('common.traceKindAgent')} · ${fmt(c.t)} · ${c.tool}: ${c.label}`}></span>{/each}
				</div>
				<div class="lane console">
					{#each index.console as c, k (k)}<span class="tick console {c.level}" style:left="{pct(c.t)}%" use:tooltip={`${i.t('common.traceKindConsole')} · ${fmt(c.t)} · ${c.text}`}></span>{/each}
				</div>
				<div class="playhead" style:left="{pct(t)}%" aria-hidden="true"></div>
			</div>
			<div class="controls">
				<button type="button" class="btn ghost small" use:tooltip={i.t('common.tracePrevMarker')} aria-label={i.t('common.tracePrevMarker')} onclick={prevMarker}><Icon name="skip-back" size={12} /></button>
				<button type="button" class="btn ghost small" use:tooltip={playing ? i.t('common.tracePause') : i.t('common.tracePlay')} aria-label={playing ? i.t('common.tracePause') : i.t('common.tracePlay')} onclick={() => (playing = !playing)}>
					<Icon name={playing ? 'pause' : 'play'} size={12} />
				</button>
				<button type="button" class="btn ghost small" use:tooltip={i.t('common.traceNextMarker')} aria-label={i.t('common.traceNextMarker')} onclick={nextMarker}><Icon name="skip-forward" size={12} /></button>
				<span class="time">{fmt(t)} <span class="faint">/ {fmt(duration)}</span></span>
				<div class="seg" role="group" aria-label={i.t('common.traceSpeed')}>
					{#each [1, 2, 4] as const as r (r)}
						<button type="button" aria-pressed={rate === r} onclick={() => (rate = r)}>{r}×</button>
					{/each}
				</div>
				<ul class="legend" aria-hidden="true">
					<li><span class="mk finding major"></span>{i.t('common.traceKindFinding')}</li>
					<li><span class="mk finding major blocking"></span>{i.t('common.traceBlocking')}</li>
					<li><span class="mk ac passed"></span>{i.t('common.traceKindAc')}</li>
					<li><span class="mk evidence"></span>{i.t('common.traceKindEvidence')}</li>
					<li><span class="mk note"></span>{i.t('common.traceKindNote')}</li>
					<li><span class="tick agent"></span>{i.t('common.traceKindAgent')}</li>
					<li><span class="tick console error"></span>{i.t('common.traceKindConsole')}</li>
				</ul>
			</div>
			<ol class="events" bind:this={list} aria-label={i.t('common.traceEvents')}>
				{#each events as e, k (e.key)}
					<li class="{e.kind} {e.tone ?? ''}" class:current={k === currentIdx} class:dismissed={e.dismissed}>
						<button type="button" onclick={() => seek(e.t, true)}>
							<span class="at">{fmt(e.t)}</span>
							<span class="kind">{kindLabel[e.kind]?.() ?? e.kind}</span>
							<span class="label">{#if e.blocking}<span class="blk tagged">{i.t('common.traceBlocking')}</span>{/if}{e.label}</span>
						</button>
					</li>
				{/each}
			</ol>
			<!-- What the run found at this point: the story of the findings and notes as you scrub -->
			<div class="now" aria-live="polite">
				<p class="now-head faint">{i.t('common.traceNow')}{#if activeMarkers.length}, {fmt(activeMarkers[0]!.t)}{/if}</p>
				{#if activeMarkers.length === 0}
					<p class="faint">{i.t('common.traceNoMarkerYet')}</p>
				{:else}
					{#each activeMarkers as m (`${m.kind}-${m.id}`)}
						<article class="card {m.kind} {toneOf(m)}" class:blocking={m.blocking} class:dismissed={m.dismissed}>
							<header>
								<span class="kind">{kindLabel[m.kind]?.()}</span>
								{#if m.kind !== 'note'}<span class="mid">{m.id}</span>{/if}
								{#if m.kind === 'finding' && m.severity}<Severity severity={m.severity as SeverityLevel} />{/if}
								{#if m.blocking}<span class="blk">{i.t('common.traceBlocking')}</span>{/if}
								{#if m.dismissed}<span class="dis">{i.t('common.traceDismissed')}</span>{/if}
								{#if m.kind === 'ac' && m.status}<span class="st {m.status}">{i.labels.ac[m.status] ?? m.status}</span>{/if}
								{#if m.href}<a class="to" href={m.href}>{i.t('common.traceToReport')}</a>{/if}
							</header>
							{#if m.kind !== 'note'}<p class="title">{m.label}</p>{/if}
							{#if m.body}<p class="body">{m.body}</p>{/if}
							{#if m.image}
								<button type="button" class="shot" onclick={() => onopen?.(m)}><img src={m.image} alt={m.label} loading="lazy" /></button>
							{/if}
						</article>
					{/each}
				{/if}
			</div>
		{/if}
	</section>
{/if}

<style>
	.trace {
		overflow: hidden;
		scroll-margin-top: 1rem;
		transition: box-shadow 0.6s;
	}
	.trace.flash {
		box-shadow: 0 0 0 2px var(--accent);
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	h2 {
		font-size: var(--text-sm);
	}
	.url {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--mono);
	}
	.links {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
		flex: none;
	}
	.note {
		padding: 0.6rem 0.75rem;
	}
	/* Short enough that track, controls and list fit under it in one screen */
	.screen {
		position: relative;
		aspect-ratio: 16 / 10;
		max-height: max(12rem, calc(100dvh - 32rem));
		width: 100%;
		background: var(--sunken);
	}
	.screen img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	/* The timeline: lanes of ticks and markers over the whole run, the playhead on top */
	.track {
		position: relative;
		height: 5.5rem;
		background: var(--sunken);
		border-block: 1px solid var(--rule);
		cursor: pointer;
		user-select: none;
		touch-action: none;
	}
	.track:focus-visible {
		outline-offset: -2px;
	}
	.lane {
		position: absolute;
		left: 0;
		right: 0;
	}
	.lane.nav {
		top: 0;
		bottom: 0;
	}
	/* One row per kind of marker, so the moments of a finding, its criterion and its screenshot stay apart */
	.lane.finding {
		top: 0.45rem;
		height: 0.75rem;
	}
	.lane.ac {
		top: 1.4rem;
		height: 0.75rem;
	}
	.lane.evidence {
		top: 2.35rem;
		height: 0.5rem;
	}
	.lane.note {
		top: 3.15rem;
		height: 0.5rem;
	}
	.lane.agent {
		top: 3.95rem;
		height: 0.5rem;
	}
	.lane.console {
		top: 4.7rem;
		height: 0.5rem;
	}
	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--ink-3);
	}
	/* Easier to hover than the 1px line itself */
	.tick::before {
		content: '';
		position: absolute;
		inset: 0 -3px;
	}
	.tick.nav {
		background: var(--rule-strong);
	}
	.tick.console {
		width: 2px;
		background: var(--block);
	}
	.tick.console.warning {
		background: var(--major);
	}
	.mk {
		position: absolute;
		top: 0;
		width: 0.6rem;
		height: 0.6rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--hint);
		transform: translateX(-50%);
		cursor: pointer;
	}
	.mk:hover {
		transform: translateX(-50%) scale(1.35);
	}
	.mk.evidence {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 1px;
		background: var(--accent);
	}
	.mk.note {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 1px;
		background: var(--ink-3);
	}
	.mk.ac {
		border-radius: 1px;
		transform: translateX(-50%) rotate(45deg) scale(0.85);
	}
	.mk.ac:hover {
		transform: translateX(-50%) rotate(45deg) scale(1.2);
	}
	.mk.blocker,
	.mk.failed {
		background: var(--block);
	}
	.mk.major,
	.mk.blocked {
		background: var(--major);
	}
	.mk.minor {
		background: var(--minor);
	}
	.mk.passed {
		background: var(--pass);
	}
	/* A finding that blocks approval wears a ring; a dismissed one fades */
	.mk.finding.blocking {
		outline: 2px solid var(--block);
		outline-offset: 1.5px;
	}
	.mk.dismissed {
		opacity: 0.4;
	}
	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--accent);
		pointer-events: none;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--rule);
	}
	.time {
		margin: 0 0.5rem;
		font-family: var(--mono);
		font-size: var(--text-xs);
	}
	.legend {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin: 0 0 0 auto;
		padding: 0;
		list-style: none;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.legend .mk,
	.legend .tick {
		position: static;
		transform: none;
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		cursor: default;
	}
	.legend .tick {
		width: 2px;
	}
	.legend .mk.ac {
		transform: rotate(45deg) scale(0.85);
	}

	/* What was found at the playhead */
	.now {
		display: grid;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border-top: 1px solid var(--rule);
		background: color-mix(in srgb, var(--accent) 3%, var(--sheet));
	}
	.now-head {
		font-weight: 500;
	}
	.card {
		display: grid;
		gap: 0.3rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--rule);
		border-left: 3px solid var(--hint);
		border-radius: var(--radius-s);
		background: var(--sheet);
	}
	.card.finding.blocker,
	.card.finding.blocking,
	.card.ac.failed {
		border-left-color: var(--block);
	}
	.card.finding.major,
	.card.ac.blocked {
		border-left-color: var(--major);
	}
	.card.finding.minor {
		border-left-color: var(--minor);
	}
	.card.ac.passed {
		border-left-color: var(--pass);
	}
	.card.evidence {
		border-left-color: var(--accent);
	}
	.card.note {
		border-left-color: var(--ink-3);
	}
	.card.dismissed {
		opacity: 0.6;
	}
	.card header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0;
		border: 0;
		font-size: var(--text-xs);
	}
	.card .kind {
		font-weight: 500;
		color: var(--ink-2);
	}
	.card .mid {
		font-family: var(--mono);
		color: var(--ink-3);
	}
	.blk {
		color: var(--block);
		font-weight: 500;
	}
	.blk.tagged {
		margin-right: 0.4rem;
	}
	.dis {
		color: var(--ink-3);
		font-weight: 500;
	}
	.st {
		font-weight: 500;
		color: var(--ink-2);
	}
	.st.passed {
		color: var(--pass);
	}
	.st.failed {
		color: var(--block);
	}
	.st.blocked {
		color: var(--major);
	}
	.card .to {
		margin-left: auto;
	}
	.card .title {
		font-weight: 500;
	}
	.card .body {
		max-height: 9rem;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}
	.card .shot {
		justify-self: start;
		width: 10rem;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: none;
		cursor: zoom-in;
		overflow: hidden;
	}
	.card .shot img {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 10;
		object-fit: cover;
		object-position: top;
	}

	/* Every event in order; the row at the playhead is highlighted */
	.events {
		position: relative;
		max-height: 14rem;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow: auto;
		font-size: var(--text-xs);
	}
	.events li button {
		display: grid;
		grid-template-columns: 3.25rem 5.5rem minmax(0, 1fr);
		gap: 0.5rem;
		width: 100%;
		padding: 0.2rem 0.75rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-xs);
		color: var(--ink-2);
		text-align: left;
		cursor: pointer;
	}
	.events li button:hover {
		background: color-mix(in srgb, var(--ink) 4%, transparent);
	}
	.events li.current button {
		background: var(--accent-soft);
		color: var(--ink);
	}
	.events li.dismissed button {
		opacity: 0.55;
	}
	.events .at {
		font-family: var(--mono);
		color: var(--ink-3);
	}
	.events .kind {
		color: var(--ink-3);
	}
	.events .label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.events li.finding .kind,
	.events li.evidence .kind,
	.events li.ac .kind,
	.events li.note .kind {
		font-weight: 500;
		color: var(--ink-2);
	}
	.events li.block .label,
	.events li.blocker .label,
	.events li.failed .label {
		color: var(--block);
	}
	.events li.major .label,
	.events li.blocked .label {
		color: var(--major);
	}
	.events li.passed .label {
		color: var(--pass);
	}
	@media (max-width: 560px) {
		.legend {
			display: none;
		}
		.events li button {
			grid-template-columns: 3.25rem minmax(0, 1fr);
		}
		.events .kind {
			display: none;
		}
	}
</style>
