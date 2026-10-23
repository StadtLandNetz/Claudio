<script lang="ts">
	import { flip } from 'svelte/animate';
	import { buildMatrix, type HistFinding, type HistReview, type MatrixRow } from '#lib/finding-history.js';
	import { i18n } from '#lib/i18n/index.js';
	import { tooltip } from '#lib/tooltip.js';
	import Icon from './Icon.svelte';

	/**
	 * The findings of a pull request across its reviews, as a table: a column per
	 * review ("Review 1 | This review (2) | Review 3"), a row per problem. The column
	 * heads carry a small bar of the open findings (red: blocking); click or drag
	 * along them to pick a review, whose findings then come first. Every mark explains
	 * itself on hover. `onopen` shows a finding of the current review on the page.
	 */
	let { reviews, currentId, onopen }: { reviews: HistReview[]; currentId: number; onopen?: (findingId: string) => void } = $props();
	const i = i18n();

	const matrix = $derived(buildMatrix(reviews));
	const currentIdx = $derived(Math.max(0, reviews.findIndex((r) => r.id === currentId)));
	// svelte-ignore state_referenced_locally
	let sel = $state(currentIdx);
	let showOthers = $state(false);

	const nameOf = (k: number) => (k === currentIdx ? i.t('review.histThis', { n: k + 1 }) : i.t('review.histNth', { n: k + 1 }));
	const shortDate = (iso: string) => new Intl.DateTimeFormat(i.locale === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short' }).format(new Date(iso));
	const statsOf = (r: HistReview) => {
		const open = r.findings.filter((f) => f.rating !== 'dismissed');
		return { open: open.length, blocking: open.filter((f) => f.blocking).length, dismissed: r.findings.length - open.length };
	};
	const maxOpen = $derived(Math.max(1, ...reviews.map((r) => statsOf(r).open)));
	function columnTip(k: number): string {
		const r = reviews[k]!;
		const s = statsOf(r);
		return [
			`${nameOf(k)} (#${r.id}), ${i.formatDate(r.at)}`,
			i.labels.verdict[r.verdict],
			i.t('review.histColCounts', { open: s.open, blocking: s.blocking, dismissed: s.dismissed }),
			r.followUpOf ? i.t('review.histFollowUp', { id: r.followUpOf }) : ''
		]
			.filter(Boolean)
			.join(' · ');
	}

	// The problems the picked review says something about come first; the others wait behind a toggle.
	const relevant = $derived(matrix.rows.filter((row) => row.cells[sel]!.state !== 'none'));
	const others = $derived(matrix.rows.filter((row) => row.cells[sel]!.state === 'none'));
	const shown = $derived(showOthers ? [...relevant, ...others] : relevant);

	const reported = (state: string) => state === 'open' || state === 'dismissed';
	// A row is named as in the picked review, else as last reported before it, else as first reported.
	function versionFor(row: MatrixRow): { f: HistFinding; k: number } {
		if (reported(row.cells[sel]!.state)) return { f: row.cells[sel]!.f!, k: sel };
		for (let k = sel - 1; k >= 0; k--) if (reported(row.cells[k]!.state)) return { f: row.cells[k]!.f!, k };
		const k = row.cells.findIndex((c) => reported(c.state));
		return { f: row.cells[k]!.f!, k };
	}
	function cellTip(row: MatrixRow, k: number): string {
		const c = row.cells[k]!;
		if (!c.f || c.state === 'none') return '';
		const where = nameOf(k);
		if (c.state === 'fixed') return i.t('review.histTipFixed', { review: where });
		if (c.state === 'gone') return i.t('review.histTipGone', { review: where });
		const parts = [`${where}: ${c.f.id} „${c.f.title}“`, i.labels.severity[c.f.severity]];
		if (c.state === 'dismissed') parts.push(i.t('review.histTipDismissed'));
		else if (c.f.blocking) parts.push(i.t('common.traceBlocking'));
		return parts.join(' · ');
	}
	const href = (k: number, findingId: string) => (reviews[k]!.id === currentId ? `#finding-${findingId}` : `/reviews/${reviews[k]!.id}#finding-${findingId}`);
	function open(e: MouseEvent, k: number, findingId: string) {
		if (reviews[k]!.id !== currentId || !onopen) return;
		e.preventDefault();
		onopen(findingId);
	}

	// What changed in the picked review against the one before.
	const summary = $derived.by(() => {
		const st = matrix.steps[sel]!;
		if (!st.prev) return i.t('review.histFirst', { review: nameOf(sel), n: st.rows.length });
		return i.t('review.histSummary', {
			review: nameOf(sel),
			prev: nameOf(sel - 1),
			new: st.rows.filter((r) => r.rel === 'new').length,
			kept: st.rows.filter((r) => r.rel !== 'new').length,
			fixed: st.gone.filter((g) => g.fixed).length,
			gone: st.gone.filter((g) => !g.fixed).length
		});
	});

	// Pick a column by clicking, dragging along the heads, or with the arrow keys.
	let head = $state<HTMLElement>();
	let scroller = $state<HTMLElement>();
	let dragging = false;
	function columnAt(e: PointerEvent): number | null {
		const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-col]');
		return el ? Number(el.dataset.col) : null;
	}
	function down(e: PointerEvent) {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		dragging = true;
		head?.setPointerCapture(e.pointerId);
		const k = columnAt(e);
		if (k !== null) sel = k;
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		const k = columnAt(e);
		if (k !== null) sel = k;
	}
	function up(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		head?.releasePointerCapture(e.pointerId);
	}
	function key(e: KeyboardEvent) {
		const next = e.key === 'ArrowLeft' ? sel - 1 : e.key === 'ArrowRight' ? sel + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? reviews.length - 1 : null;
		if (next === null) return;
		e.preventDefault();
		sel = Math.min(reviews.length - 1, Math.max(0, next));
		head?.querySelector<HTMLElement>(`[data-col="${sel}"]`)?.focus();
	}
	// Start with the current review in view, centred in the room right of the problem column.
	$effect(() => {
		const el = scroller?.querySelector<HTMLElement>(`[data-col="${currentIdx}"]`);
		const label = scroller?.querySelector<HTMLElement>('.head .label');
		if (!scroller || !el || !label) return;
		const room = scroller.clientWidth - label.offsetWidth;
		scroller.scrollLeft = Math.max(0, el.offsetLeft - label.offsetWidth - (room - el.offsetWidth) / 2);
	});
</script>

<div class="hist" style:--n={reviews.length}>
	<p class="summary muted">{summary}</p>
	<div class="box sheet">
	<div class="scroller" bind:this={scroller}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="line head"
			bind:this={head}
			role="group"
			aria-label={i.t('review.histTimeline')}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onkeydown={key}
		>
			<span class="label">{i.t('review.histProblems', { n: matrix.rows.length })}</span>
			{#each reviews as r, k (r.id)}
				{@const s = statsOf(r)}
				<button
					type="button"
					class="col-head"
					class:sel={k === sel}
					class:current={k === currentIdx}
					data-col={k}
					aria-pressed={k === sel}
					tabindex={k === sel ? 0 : -1}
					use:tooltip={columnTip(k)}
					onclick={() => (sel = k)}
				>
					<span class="pic" aria-hidden="true">
						<span class="count">{s.open}</span>
						<span class="bar" style:height="{(s.open / maxOpen) * 2}rem"><span class="blocking" style:height="{s.open ? (s.blocking / s.open) * 100 : 0}%"></span></span>
					</span>
					<span class="name">{nameOf(k)}</span>
					<span class="date faint">{shortDate(r.at)}</span>
				</button>
			{/each}
		</div>
		{#each shown as row (row.key)}
			{@const v = versionFor(row)}
			<div class="line row" class:other={row.cells[sel]!.state === 'none'} animate:flip={{ duration: 160 }}>
				<span class="label">
					<span class="sev {v.f.severity}" use:tooltip={i.labels.severity[v.f.severity]}></span>
					<a href={href(v.k, v.f.id)} onclick={(e) => open(e, v.k, v.f.id)} use:tooltip={`${v.f.id} · ${nameOf(v.k)}: ${v.f.title}`}>{v.f.title}</a>
				</span>
				{#each row.cells as c, k (k)}
					<span class="cell" class:sel={k === sel}>
						{#if c.f && reported(c.state)}
							<a
								class="mark {c.state} {c.f.severity}"
								class:blocking={c.f.blocking && c.state === 'open'}
								href={href(k, c.f.id)}
								onclick={(e) => open(e, k, c.f!.id)}
								aria-label={cellTip(row, k)}
								use:tooltip={cellTip(row, k)}
							></a>
						{:else if c.state === 'fixed'}
							<span class="mark fixed" use:tooltip={cellTip(row, k)}><Icon name="check" size={12} /></span>
						{:else if c.state === 'gone'}
							<span class="mark gone" use:tooltip={cellTip(row, k)}></span>
						{/if}
					</span>
				{/each}
			</div>
		{/each}
	</div>
	{#if others.length}
		<div class="more-row">
			<button type="button" aria-expanded={showOthers} onclick={() => (showOthers = !showOthers)}>
				{showOthers ? i.t('common.showLess') : i.t('review.histOthers', { n: others.length })}
			</button>
		</div>
	{/if}
	</div>
	<p class="legend faint">
		<span><span class="mark open major" aria-hidden="true"></span>{i.t('review.histLegendOpen')}</span>
		<span><span class="mark open major blocking" aria-hidden="true"></span>{i.t('common.traceBlocking')}</span>
		<span><span class="mark dismissed" aria-hidden="true"></span>{i.t('review.histLegendDismissed')}</span>
		<span><span class="mark fixed" aria-hidden="true"><Icon name="check" size={10} /></span>{i.t('review.histLegendFixed')}</span>
		<span><span class="mark gone" aria-hidden="true"></span>{i.t('review.histLegendGone')}</span>
		<span class="how" use:tooltip={i.t('review.histMatchHint')}>{i.t('review.histMatchShort')}</span>
	</p>
</div>

<style>
	.hist {
		--col-w: 6.5rem;
		--label-min: 12rem;
		display: grid;
		gap: 0.5rem;
	}
	.box {
		overflow: hidden;
	}
	.scroller {
		position: relative;
		overflow-x: auto;
	}
	/* Every line shares the same columns, so the marks line up under their review */
	.line {
		display: grid;
		grid-template-columns: minmax(var(--label-min), 1fr) repeat(var(--n), var(--col-w));
		min-width: calc(var(--label-min) + var(--n) * var(--col-w));
		border-bottom: 1px solid var(--rule);
	}
	.label {
		position: sticky;
		left: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.4rem 0.75rem;
		background: var(--sheet);
		border-right: 1px solid var(--rule);
		/* Columns scrolled under it disappear behind a soft edge */
		box-shadow: 6px 0 8px -6px color-mix(in srgb, var(--ink) 18%, transparent);
	}
	.head .label {
		align-items: flex-end;
		padding-bottom: 0.5rem;
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-3);
	}

	/* Column heads: a bar of the open findings (red part: blocking), the name, the date */
	.head {
		user-select: none;
	}
	.col-head {
		min-width: 0;
		overflow: hidden;
		display: grid;
		justify-items: center;
		align-content: end;
		gap: 0.1rem;
		padding: 0.5rem 0.25rem 0.45rem;
		border: 0;
		background: none;
		font: inherit;
		color: var(--ink-2);
		cursor: pointer;
	}
	.col-head:hover {
		background: color-mix(in srgb, var(--ink) 3%, transparent);
	}
	.col-head:focus-visible {
		outline-offset: -2px;
	}
	.pic {
		display: grid;
		grid-template-rows: auto 2rem;
		justify-items: center;
		align-items: end;
		gap: 0.15rem;
	}
	.count {
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1;
	}
	.bar {
		display: flex;
		align-items: flex-end;
		width: 0.75rem;
		min-height: 2px;
		border-radius: 2px;
		overflow: hidden;
		background: color-mix(in srgb, var(--ink-3) 45%, transparent);
	}
	.blocking {
		display: block;
		width: 100%;
		background: var(--block);
	}
	.name {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--text-xs);
		font-weight: 500;
		white-space: nowrap;
	}
	.date {
		line-height: 1.2;
	}
	.col-head.current .name {
		color: var(--accent);
	}
	.col-head.sel,
	.cell.sel {
		background: var(--accent-soft);
	}

	/* Rows: the problem, then one mark per review */
	.row .label a {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}
	.row.other .label a {
		color: var(--ink-3);
	}
	.sev {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--hint);
	}
	.cell {
		display: grid;
		place-items: center;
		min-height: 2.25rem;
	}
	.mark {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--hint);
		text-decoration: none;
	}
	.mark.dismissed {
		background: none;
		border: 1.5px solid var(--ink-3);
	}
	.mark.open.blocking {
		box-shadow:
			0 0 0 2px var(--sheet),
			0 0 0 3.5px var(--block);
	}
	.mark.fixed {
		background: none;
		color: var(--pass);
	}
	.mark.gone {
		width: 0.7rem;
		height: 2px;
		border-radius: 1px;
		background: var(--ink-3);
	}
	.sev.blocker,
	.mark.open.blocker {
		background: var(--block);
	}
	.sev.major,
	.mark.open.major {
		background: var(--major);
	}
	.sev.minor,
	.mark.open.minor {
		background: var(--minor);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1rem;
	}
	.legend > span {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.legend .mark {
		width: 0.6rem;
		height: 0.6rem;
	}
	.legend .mark.gone {
		height: 2px;
	}
	@media (max-width: 640px) {
		.hist {
			--col-w: 5.5rem;
			--label-min: 8.5rem;
		}
	}
	.how {
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
		cursor: help;
	}
</style>
