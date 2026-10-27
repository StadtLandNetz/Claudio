<script lang="ts">
	import { sveltekitRouteOf, type ImpactRoute } from '@claudio/core';
	import { i18n, type MessageKey } from '#lib/i18n/index.js';
	import { FILES, TESTS, fileLabel, selectTests, type Tier } from './scenario.js';

	/**
	 * The import graph of the example app. Files marked as changed light up the
	 * chain to the routes they reach, and the test list follows, both computed by
	 * Claudio's own rules.
	 */
	const i = i18n();
	const COLUMNS: { tier: Tier; label: MessageKey }[] = [
		{ tier: 'lib', label: 'landing.colLib' },
		{ tier: 'components', label: 'landing.colComponents' },
		{ tier: 'routes', label: 'landing.colRoutes' }
	];
	const STAGGER = 0.2;

	let changed = $state<string[]>(['src/lib/components/TripTable.svelte']);
	const result = $derived(selectTests(changed));
	const impact = $derived(result.impact);
	const selection = $derived(result.selection);
	const chosen = $derived(new Map(selection.selected.map((t) => [t.id, t])));
	const isGlobal = $derived(impact.global.length > 0);
	const onlyInert = $derived(changed.length > 0 && !isGlobal && impact.routes.length === 0 && impact.unmapped.length === 0);

	// How many imports away from a changed file each reached file is, for the order in which they light up.
	const depth = $derived.by(() => {
		const m = new Map<string, number>();
		for (const r of impact.routes) r.via.forEach((f, k) => m.set(f, Math.min(m.get(f) ?? k, k)));
		if (isGlobal) for (const f of FILES) if (f.tier === 'routes' && !m.has(f.path)) m.set(f.path, 1);
		return m;
	});
	const litEdges = $derived(new Set(impact.routes.flatMap((r) => r.via.slice(1).map((to, k) => `${r.via[k]}>${to}`))));

	function toggle(path: string) {
		changed = changed.includes(path) ? changed.filter((p) => p !== path) : [...changed, path];
	}
	function kindLabel(r: ImpactRoute): string {
		const kind = r.kind === 'layout' ? i.t('landing.routeLayout') : r.kind === 'endpoint' ? i.t('landing.routeEndpoint') : null;
		return [kind, r.direct ? i.t('landing.routeDirect') : i.t('landing.routeShared')].filter(Boolean).join(' · ');
	}

	// Edges are drawn between the measured boxes, so they follow the layout: columns on wide screens, rows on phones.
	let wrap: HTMLDivElement | undefined = $state();
	const nodes: Record<string, HTMLElement> = {};
	let geo = $state<{ w: number; h: number; edges: { key: string; from: string; d: string }[] }>({ w: 0, h: 0, edges: [] });

	function measure() {
		if (!wrap) return;
		const base = wrap.getBoundingClientRect();
		const edges: { key: string; from: string; d: string }[] = [];
		for (const f of FILES) {
			for (const dep of f.imports) {
				const a = nodes[dep]?.getBoundingClientRect();
				const b = nodes[f.path]?.getBoundingClientRect();
				if (!a || !b) continue;
				let d: string;
				if (b.left >= a.right - 1) {
					const [x1, y1, x2, y2] = [a.right - base.left, a.top + a.height / 2 - base.top, b.left - base.left, b.top + b.height / 2 - base.top];
					const mx = (x1 + x2) / 2;
					d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
				} else {
					const [x1, y1, x2, y2] = [a.left + a.width / 2 - base.left, a.bottom - base.top, b.left + b.width / 2 - base.left, b.top - base.top];
					const my = (y1 + y2) / 2;
					d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
				}
				edges.push({ key: `${dep}>${f.path}`, from: dep, d });
			}
		}
		geo = { w: base.width, h: base.height, edges };
	}

	$effect(() => {
		if (!wrap) return;
		const observer = new ResizeObserver(measure);
		observer.observe(wrap);
		document.fonts?.ready.then(measure);
		return () => observer.disconnect();
	});
</script>

{#snippet node(path: string, tier: Tier)}
	{@const route = sveltekitRouteOf(path)}
	{@const reached = depth.has(path)}
	<button
		bind:this={nodes[path]}
		type="button"
		class="node {tier}"
		class:changed={changed.includes(path)}
		class:reached
		aria-pressed={changed.includes(path)}
		title={i.t('landing.markChanged', { file: path })}
		style="--delay: {reached ? (depth.get(path) ?? 0) * STAGGER : 0}s"
		onclick={() => toggle(path)}
	>
		{#if route && tier === 'routes'}
			<span class="pattern">{route.pattern}</span>
		{/if}
		<code>{fileLabel(path)}</code>
	</button>
{/snippet}

<div class="impact">
	<div class="graph-side">
		<div class="graph" bind:this={wrap} role="group" aria-label={i.t('landing.graphLabel')}>
			<svg class="edges" width={geo.w} height={geo.h} viewBox="0 0 {geo.w} {geo.h}" aria-hidden="true">
				{#each geo.edges as e (e.key)}
					<path class="base" d={e.d} />
					<path class="lit" class:on={litEdges.has(e.key)} d={e.d} pathLength="1" style="--delay: {(depth.get(e.from) ?? 0) * STAGGER}s" />
				{/each}
			</svg>
			{#each COLUMNS as col (col.tier)}
				<div class="col">
					<p class="label">{i.t(col.label)}</p>
					<div class="stack">
						{#each FILES.filter((f) => f.tier === col.tier) as f (f.path)}
							{@render node(f.path, f.tier)}
						{/each}
					</div>
				</div>
			{/each}
		</div>
		<div class="special">
			<p class="label">{i.t('landing.colSpecial')}</p>
			{#each FILES.filter((f) => f.tier === 'special') as f (f.path)}
				{@render node(f.path, f.tier)}
			{/each}
		</div>
	</div>

	<div class="result" aria-live="polite">
		<div class="result-head">
			<p class="count">
				{changed.length ? i.t('landing.testsRun', { n: selection.selected.length, total: TESTS.length }) : i.t('landing.pickHint')}
			</p>
			{#if changed.length}
				<button type="button" class="reset" onclick={() => (changed = [])}>{i.t('landing.reset')}</button>
			{/if}
		</div>
		{#if isGlobal}
			<p class="note global">{i.t('landing.globalChange')}</p>
		{:else if onlyInert}
			<p class="note">{i.t('landing.inertChange')}</p>
		{/if}
		<ul class="tests">
			{#each TESTS as t (t.id)}
				{@const hit = chosen.get(t.id)}
				<li class:on={hit}>
					<span class="tick" aria-hidden="true">{hit ? '✓' : '–'}</span>
					<span class="name">{t.title[i.locale]}</span>
					<span class="why">{hit ? (hit.route ? i.t('landing.testVia', { route: hit.route }) : i.t('landing.testAll')) : i.t('landing.testSkipped')}</span>
					<code class="paths">{t.touchedPaths?.join('  ')}</code>
				</li>
			{/each}
		</ul>
		{#if impact.routes.length}
			<div class="route-list">
				<p class="label">{i.t('landing.affectedRoutes')}</p>
				<ul>
					{#each impact.routes as r (`${r.kind} ${r.pattern}`)}
						<li>
							<code class="pattern">{r.pattern}</code>
							<span class="kind">{kindLabel(r)}</span>
							<code class="via">{r.via.map(fileLabel).join(' → ')}</code>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</div>
<p class="caption">{i.t('landing.impactCaption')}</p>

<style>
	.impact {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}
	.graph-side,
	.result {
		background: var(--sheet);
		border: 1px solid var(--rule);
		border-radius: 16px;
		box-shadow: var(--shadow);
		padding: 1.25rem;
		min-width: 0;
	}
	.graph {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1.25fr);
		column-gap: 2rem;
	}
	.edges {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.edges path {
		fill: none;
	}
	.base {
		stroke: var(--rule-strong);
		stroke-width: 1.5;
	}
	.lit {
		stroke: var(--brand-line);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		transition: stroke-dashoffset 0.35s ease;
	}
	.lit.on {
		stroke-dashoffset: 0;
		transition: stroke-dashoffset 0.35s ease var(--delay);
	}
	.col {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.stack {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.6rem;
	}
	.label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-3);
		margin-bottom: 0.6rem;
	}
	.node {
		position: relative;
		z-index: 1;
		display: grid;
		gap: 0.1rem;
		text-align: left;
		font: inherit;
		color: var(--ink);
		background: var(--sheet);
		border: 1.5px solid var(--rule-strong);
		border-radius: 10px;
		padding: 0.45rem 0.6rem;
		cursor: pointer;
		min-width: 0;
		transition:
			background 0.25s ease,
			border-color 0.25s ease,
			color 0.25s ease;
	}
	.node.reached {
		transition-delay: var(--delay);
	}
	.node:hover {
		border-color: var(--ink-3);
	}
	.node:focus-visible {
		outline: 2px solid var(--brand-text);
		outline-offset: 2px;
	}
	.node code {
		font-family: var(--mono);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
	.pattern {
		font-weight: 700;
		font-size: 0.875rem;
	}
	.node.routes code {
		color: var(--ink-3);
		font-size: 0.6875rem;
	}
	.node.reached {
		background: var(--brand-soft);
		border-color: var(--brand-line);
	}
	.node.routes.reached {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--brand-ink);
	}
	.node.routes.reached code {
		color: var(--brand-ink);
		opacity: 0.75;
	}
	.node.changed {
		background: var(--gold-soft);
		border-color: var(--gold);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--gold) 30%, transparent);
		transition-delay: 0s;
	}
	.node.changed::after {
		content: '';
		position: absolute;
		top: -4px;
		right: -4px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--gold);
		border: 2px solid var(--sheet);
	}
	.special {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--rule-strong);
	}
	.special .label {
		margin: 0 0.25rem 0 0;
	}

	.result {
		display: grid;
		gap: 0.85rem;
	}
	.result-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.count {
		font-family: var(--display);
		font-size: 1.35rem;
		font-weight: 700;
		line-height: 1.2;
	}
	.reset {
		font: inherit;
		font-size: 0.8125rem;
		color: var(--ink-2);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		white-space: nowrap;
	}
	.note {
		font-size: 0.875rem;
		border-radius: 10px;
		padding: 0.6rem 0.75rem;
		background: var(--sunken);
	}
	.note.global {
		background: var(--gold-soft);
		color: var(--gold-ink);
	}
	.tests {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.15rem;
	}
	.tests li {
		display: grid;
		grid-template-columns: 1.1rem minmax(0, 1fr) auto;
		column-gap: 0.5rem;
		padding: 0.45rem 0.5rem;
		border-radius: 8px;
		color: var(--ink-3);
		transition:
			background 0.25s,
			color 0.25s;
	}
	.tests li.on {
		color: var(--ink);
		background: var(--brand-soft);
	}
	.tick {
		font-weight: 700;
	}
	.on .tick {
		color: var(--brand-text);
	}
	.name {
		font-weight: 600;
	}
	.why {
		font-size: 0.8125rem;
		text-align: right;
	}
	.on .why {
		color: var(--brand-text);
		font-weight: 600;
	}
	.paths {
		grid-column: 2 / -1;
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--ink-3);
	}
	.route-list ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.route-list li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 0.6rem;
		font-size: 0.8125rem;
	}
	.route-list .pattern {
		font-family: var(--mono);
		font-size: 0.8125rem;
	}
	.kind {
		color: var(--ink-2);
	}
	.via {
		grid-column: 1 / -1;
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--ink-3);
		overflow-wrap: anywhere;
	}
	.caption {
		margin-top: 0.9rem;
		font-size: 0.875rem;
		color: var(--ink-2);
	}

	@media (max-width: 960px) {
		.impact {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 640px) {
		.graph-side,
		.result {
			padding: 1rem;
		}
		.graph {
			grid-template-columns: minmax(0, 1fr);
			row-gap: 1.75rem;
		}
		.stack {
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: center;
		}
		.col .label {
			text-align: center;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.lit,
		.lit.on,
		.node,
		.node.reached {
			transition: none;
		}
	}
</style>
