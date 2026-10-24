<script lang="ts">
	import { changeRef, forgeLinks, type Provider } from '@claudio/core';
	import type { OverviewData } from '#lib/server/overview.js';
	import type { PullState } from '#lib/overview.js';
	import { level } from '#lib/heat.js';
	import { i18n } from '#lib/i18n/index.js';
	import { tooltip } from '#lib/tooltip.js';

	/**
	 * The start page of a repository: the numbers of the last 90 days, open pull
	 * requests with the state of their reviews, active branches without one, the
	 * review history per week and commits per contributor. Every number and mark
	 * explains itself on hover.
	 */
	let { data, repo, canStart }: { data: OverviewData; repo: { path: string; provider: Provider; webUrl: string }; canStart: boolean } = $props();
	const links = $derived(forgeLinks(repo.provider, repo.webUrl));
	const i = i18n();

	const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);
	const num = (v: number | null, digits = 1) => (v === null ? '–' : i.formatNumber(Math.round(v * 10 ** digits) / 10 ** digits));
	const s = $derived(data.stats);
	const tiles = $derived([
		{ label: i.t('repo.ovReviews'), value: String(s.reviews), sub: i.t('repo.ovReviewsSub', { n: s.pulls }), tip: i.t('repo.ovReviewsTip') },
		{ label: i.t('repo.ovApproval'), value: pct(s.approvalRate), sub: i.t('repo.ovApprovalSub'), tip: i.t('repo.ovApprovalTip') },
		{
			label: i.t('repo.ovFindings'),
			value: num(s.findingsPerReview),
			sub: s.topCategory ? i.t('repo.ovFindingsSub', { category: i.labels.category[s.topCategory.category] ?? s.topCategory.category, pct: Math.round(s.topCategory.share * 100) }) : i.t('repo.ovNone'),
			tip: i.t('repo.ovFindingsTip')
		},
		{ label: i.t('repo.ovFixRate'), value: pct(s.fixRate), sub: i.t('repo.ovFixRateSub', { fixed: s.fixed, total: s.rechecked }), tip: i.t('repo.ovFixRateTip') },
		{ label: i.t('repo.ovDismissRate'), value: pct(s.dismissRate), sub: i.t('repo.ovDismissRateSub', { dismissed: s.dismissed, total: s.rated }), tip: i.t('repo.ovDismissRateTip') },
		{ label: i.t('repo.ovCost'), value: s.avgCostUsd === null ? '–' : i.formatUsd(s.avgCostUsd), sub: i.t('repo.ovCostSub', { total: i.formatUsd(s.totalCostUsd) }), tip: i.t('repo.ovCostTip') },
		{ label: i.t('repo.ovDuration'), value: s.avgDurationMs === null ? '–' : i.formatDuration(s.avgDurationMs), sub: i.t('repo.ovDurationSub'), tip: i.t('repo.ovDurationTip') },
		{
			label: i.t('repo.ovCommits'),
			value: s.commits4w === null ? '–' : String(s.commits4w),
			sub: s.activeContributors4w === null ? i.t('repo.ovNoGithub') : i.t('repo.ovCommitsSub', { n: s.activeContributors4w }),
			tip: i.t('repo.ovCommitsTip')
		}
	]);

	// ---- open pull requests: what needs attention first
	const ORDER: Record<PullState, number> = { unreviewed: 0, outdated: 1, request_changes: 2, running: 3, inconclusive: 4, approve: 5 };
	const pulls = $derived([...data.pulls].sort((a, b) => ORDER[a.state] - ORDER[b.state]));
	const stateLabel = (st: PullState) => i.t(`repo.ovState_${st}`);
	const stateTip = (p: (typeof data.pulls)[number]) =>
		p.review && p.state === 'outdated'
			? i.t('repo.ovStateTipOutdated', { id: p.review.id, date: i.formatDate(p.review.at) })
			: p.review
			? i.t('repo.ovStateTipReviewed', { state: stateLabel(p.state), id: p.review.id, date: i.formatDate(p.review.at), findings: p.review.findings, blocking: p.review.blocking })
			: i.t('repo.ovStateTipNone');
	const attention = $derived({ unreviewed: s.unreviewed, outdated: s.outdated });

	// ---- review history: findings per week (blocking, other, dismissed) and what re-reviews found fixed
	const weeks = $derived(data.history);
	const peak = $derived(Math.max(1, ...weeks.map((w) => Math.max(w.findings, w.fixed))));
	const h = (n: number) => `${(n / peak) * 100}%`;
	const monthOf = (iso: string) => new Intl.DateTimeFormat(i.locale === 'en' ? 'en-GB' : 'de-DE', { month: 'short' }).format(new Date(iso));
	const dayOf = (iso: string) => new Intl.DateTimeFormat(i.locale === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short' }).format(new Date(iso));
	// A month name where a month begins, at least three columns from the one before (the first column only if its month lasts).
	function monthLabels(list: string[]): string[] {
		let lastAt = -10;
		return list.map((iso, k) => {
			const starts = k === 0 || new Date(iso).getUTCMonth() !== new Date(list[k - 1]!).getUTCMonth();
			const lasts = k > 0 || list.slice(1, 3).every((x) => new Date(x).getUTCMonth() === new Date(iso).getUTCMonth());
			if (!starts || !lasts || k - lastAt < 3 || k > list.length - 2) return '';
			lastAt = k;
			return monthOf(iso);
		});
	}
	const weekTip = (w: (typeof weeks)[number]) =>
		i.t('repo.ovWeekTip', {
			week: dayOf(w.start),
			reviews: w.reviews,
			findings: w.findings,
			blocking: w.blocking,
			dismissed: w.dismissed,
			fixed: w.fixed,
			approvals: w.approvals
		});
	const historyEmpty = $derived(weeks.every((w) => w.reviews === 0));
	const weekLabels = $derived(monthLabels(weeks.map((w) => w.start)));

	// ---- commits per contributor and week, like GitHub's contribution graph
	const heat = $derived(data.heatmap);
	const weekIsos = $derived(heat.weekStarts.map((w) => new Date(w * 1000).toISOString()));
	const heatLabels = $derived(monthLabels(weekIsos));
	const rowMax = $derived(Math.max(1, ...heat.rows.flatMap((r) => r.counts)));
	const allMax = $derived(Math.max(1, ...heat.all.counts));
	const cellTip = (who: string, k: number, c: number) => i.t('repo.ovCellTip', { who, week: dayOf(weekIsos[k]!), n: c });
</script>

<div class="overview">
	<!-- The numbers -->
	<section id="ov-stats" class="tiles" aria-label={i.t('repo.ovStats')}>
		{#each tiles as tile (tile.label)}
			<div class="tile sheet" use:tooltip={tile.tip}>
				<span class="t-label">{tile.label}</span>
				<span class="t-value">{tile.value}</span>
				<span class="t-sub faint">{tile.sub}</span>
			</div>
		{/each}
	</section>
	<p class="period faint">{i.t('repo.ovPeriod')}</p>

	<div class="widgets">
		<!-- Open pull requests and the state of their reviews -->
		<section id="ov-pulls" class="widget">
			<div class="w-head">
				<h3>{i.t('repo.ovPulls')} <span class="faint">{data.pulls.length}</span></h3>
				{#if attention.unreviewed || attention.outdated}
					<span class="faint">
						{[attention.unreviewed ? i.t('repo.ovUnreviewedCount', { n: attention.unreviewed }) : '', attention.outdated ? i.t('repo.ovOutdatedCount', { n: attention.outdated }) : ''].filter(Boolean).join(' · ')}
					</span>
				{/if}
			</div>
			{#if data.pullsError}
				<p class="notice error">{data.pullsError}</p>
			{:else if pulls.length === 0}
				<p class="muted empty">{i.t('repo.noPulls')}</p>
			{:else}
				<ul class="list sheet">
					{#each pulls as p (p.number)}
						<li>
							<span class="pill {p.state}" use:tooltip={stateTip(p)}>{stateLabel(p.state)}</span>
							<div class="main">
								<a class="title" href={p.review ? `/reviews/${p.review.id}` : p.url} target={p.review ? undefined : '_blank'} rel={p.review ? undefined : 'noopener noreferrer'}>{changeRef(repo.provider, p.number)} {p.title}</a>
								<span class="faint meta">
									<span class="mono">{p.headRef}</span>{p.author ? ` · ${p.author}` : ''} · <span use:tooltip={i.formatDate(p.updatedAt)}>{i.t('repo.ovUpdated', { date: dayOf(p.updatedAt) })}</span>
									{#if p.review}· {i.t('repo.ovReviewFindings', { n: p.review.findings, blocking: p.review.blocking })}{/if}
									{#if p.draft}<span class="tag">{i.t('repo.draft')}</span>{/if}
								</span>
							</div>
							{#if canStart && p.state !== 'running'}
								<a class="btn small {p.state === 'unreviewed' ? 'primary' : ''}" href="/reviews/new?repo={encodeURIComponent(repo.path)}&pr={p.number}">
									{p.state === 'unreviewed' ? i.t('repo.startReview') : i.t('repo.ovReviewAgain')}
								</a>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Branches with recent commits but no pull request -->
		<section id="ov-branches" class="widget">
			<div class="w-head">
				<h3>{i.t('repo.ovBranches')} <span class="faint">{data.branches.length}</span></h3>
				{#if data.demo}<span class="tag" use:tooltip={i.t('repo.ovDemoTip')}>{i.t('repo.ovDemo')}</span>{/if}
			</div>
			{#if data.branchesError}
				<p class="notice error">{data.branchesError}</p>
			{:else if data.branches.length === 0}
				<p class="muted empty">{i.t('repo.ovNoBranches')}</p>
			{:else}
				<ul class="list sheet">
					{#each data.branches as b (b.name)}
						<li>
							<span class="pill unreviewed" use:tooltip={i.t('repo.ovNoPullTip')}>{i.t('repo.ovNoPull')}</span>
							<div class="main">
								{#if data.demo}
									<span class="title mono">{b.name}</span>
								{:else}
									<a class="title mono" href={links.branch(b.name)} target="_blank" rel="noopener noreferrer">{b.name}</a>
								{/if}
								<span class="faint meta">
									{#if b.committedAt}<span use:tooltip={i.formatDate(b.committedAt)}>{i.t('repo.ovLastCommit', { date: dayOf(b.committedAt) })}</span>{/if}{b.author ? ` · ${b.author}` : ''}
								</span>
							</div>
							{#if !data.demo}
								<a class="btn small" href={links.newChange(b.name)} target="_blank" rel="noopener noreferrer" use:tooltip={i.t('repo.ovOpenPullTip')}>{i.t('repo.ovOpenPull')}</a>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<!-- Review history per week -->
	<section id="ov-history" class="block">
		<div class="w-head">
			<h3>{i.t('repo.ovHistory')}</h3>
			<span class="legend faint">
				<span><i class="sw blocking"></i>{i.t('repo.ovLegendBlocking')}</span>
				<span><i class="sw other"></i>{i.t('repo.ovLegendOther')}</span>
				<span><i class="sw dismissed"></i>{i.t('repo.ovLegendDismissed')}</span>
				<span><i class="sw fixed"></i>{i.t('repo.ovLegendFixed')}</span>
			</span>
		</div>
		{#if historyEmpty}
			<p class="muted empty">{i.t('repo.ovNoHistory')}</p>
		{:else}
			<div class="chart sheet" style:--n={weeks.length}>
				<span class="axis top faint">{peak}</span>
				<span class="axis mid faint">{Math.round(peak / 2)}</span>
				<div class="cols">
					{#each weeks as w, k (w.start)}
						<div class="col" use:tooltip={weekTip(w)}>
							<span class="rv faint">{w.reviews || ''}</span>
							<div class="bars">
								<span class="stack" style:height={h(w.findings)}>
									<span class="seg dismissed" style:flex-grow={w.dismissed}></span>
									<span class="seg other" style:flex-grow={Math.max(0, w.findings - w.blocking - w.dismissed)}></span>
									<span class="seg blocking" style:flex-grow={w.blocking}></span>
								</span>
								<span class="fixedbar" style:height={h(w.fixed)}></span>
							</div>
							<span class="x faint">{weekLabels[k]}</span>
						</div>
					{/each}
				</div>
			</div>
			<p class="faint">{i.t('repo.ovHistoryHint')}</p>
		{/if}
	</section>

	<!-- Commits per contributor -->
	<section id="ov-commits" class="block">
		<div class="w-head">
			<h3>{i.t('repo.ovCommitsTitle')}</h3>
			{#if data.demo}<span class="tag" use:tooltip={i.t('repo.ovDemoTip')}>{i.t('repo.ovDemo')}</span>{/if}
		</div>
		{#if heat.error}
			<p class="notice error">{heat.error}</p>
		{:else if heat.pending}
			<p class="muted empty">{i.t('repo.ovStatsPending')}</p>
		{:else if heat.all.total === 0}
			<p class="muted empty">{i.t('repo.ovNoCommits')}</p>
		{:else}
			<div class="heat sheet">
				<div class="grid" style:--n={heat.weekStarts.length}>
					<span></span>
					{#each weekIsos as iso, k (iso)}
						<span class="month faint">{heatLabels[k]}</span>
					{/each}
					<span class="total faint">{i.t('repo.ovCommitsCol')}</span>

					{#each [{ row: heat.all, all: true }, ...heat.rows.map((row) => ({ row, all: false }))] as { row, all } (all ? '*' : row.login)}
						{@const who = all ? i.t('repo.ovEveryone') : row.login}
						<span class="who" class:all>
							{#if row.avatarUrl}<img src={row.avatarUrl} alt="" width="16" height="16" loading="lazy" />{:else}<span class="ava" aria-hidden="true">{all ? '∑' : row.login[0]?.toUpperCase()}</span>{/if}
							<span class="name">{who}</span>
						</span>
						{#each row.counts as c, k (k)}
							<span class="cell l{level(c, all ? allMax : rowMax)}" use:tooltip={cellTip(who, k, c)}></span>
						{/each}
						<span class="total" use:tooltip={i.t('repo.ovLinesTip', { add: i.formatNumber(row.additions), del: i.formatNumber(row.deletions) })}>{row.total}</span>
					{/each}
				</div>
			</div>
			<p class="heat-foot faint">
				<span>{heat.hidden ? i.t('repo.ovHiddenContributors', { n: heat.hidden }) : ''}</span>
				<span class="scale">{i.t('repo.ovLess')} {#each [0, 1, 2, 3, 4] as l (l)}<i class="cell l{l}"></i>{/each} {i.t('repo.ovMore')}</span>
			</p>
		{/if}
	</section>
</div>

<style>
	.overview {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.75rem;
	}
	h3 {
		font-size: var(--text-md);
	}
	.w-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.6rem;
	}
	.w-head h3 .faint {
		font-weight: 500;
	}
	.empty {
		padding: 0.25rem 0;
	}
	.mono {
		font-family: var(--mono);
		font-size: 0.95em;
	}

	/* Tiles */
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.tile {
		display: grid;
		gap: 0.15rem;
		padding: 0.7rem 0.85rem;
		cursor: default;
		transition: border-color 0.12s;
	}
	.tile:hover {
		border-color: var(--rule-strong);
	}
	.t-label {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-2);
	}
	.t-value {
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.25;
	}
	.period {
		margin-top: -1.25rem;
	}

	/* Widgets: open pull requests and branches */
	.widgets {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		gap: 1.5rem;
		align-items: start;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list li {
		display: grid;
		grid-template-columns: 6.75rem minmax(0, 1fr) auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.list li:last-child {
		border-bottom: 0;
	}
	.main {
		display: grid;
		gap: 0.05rem;
		min-width: 0;
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		color: var(--ink);
	}
	.meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pill {
		justify-self: start;
		padding: 0 0.45rem;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1.55;
		color: var(--ink-2);
		white-space: nowrap;
		cursor: default;
	}
	.pill.unreviewed {
		border-color: color-mix(in srgb, var(--major) 45%, transparent);
		color: var(--major);
	}
	.pill.running {
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pill.approve {
		border-color: color-mix(in srgb, var(--pass) 45%, transparent);
		background: var(--pass-soft);
		color: var(--pass);
	}
	.pill.request_changes {
		border-color: color-mix(in srgb, var(--block) 45%, transparent);
		background: var(--block-soft);
		color: var(--block);
	}

	/* Review history: a column per week */
	.legend {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.9rem;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.sw {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 2px;
	}
	.chart {
		position: relative;
		padding: 0.75rem 0.75rem 0.4rem 2.25rem;
	}
	.axis {
		position: absolute;
		left: 0.6rem;
		font-size: 0.6875rem;
		line-height: 1;
	}
	/* Grid lines at the top and the middle of the bar area (8rem, starting below the review counts) */
	.axis.top {
		top: calc(0.75rem + 1.1rem - 0.35rem);
	}
	.axis.mid {
		top: calc(0.75rem + 1.1rem + 4rem - 0.35rem);
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		background:
			linear-gradient(var(--rule), var(--rule)) 0 1.1rem / 100% 1px no-repeat,
			linear-gradient(var(--rule), var(--rule)) 0 calc(1.1rem + 4rem) / 100% 1px no-repeat;
	}
	.col {
		display: grid;
		grid-template-rows: 1.1rem 8rem 1.1rem;
		justify-items: center;
		border-radius: var(--radius-s);
		cursor: default;
	}
	.col:hover {
		background: color-mix(in srgb, var(--ink) 4%, transparent);
	}
	.rv {
		align-self: end;
		font-size: 0.6875rem;
		line-height: 1;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 1px;
		height: 100%;
		border-bottom: 1px solid var(--rule-strong);
		width: 100%;
		justify-content: center;
	}
	.stack {
		display: flex;
		flex-direction: column;
		width: min(0.7rem, 40%);
		border-radius: 2px 2px 0 0;
		overflow: hidden;
	}
	.seg {
		flex-basis: 0;
	}
	.fixedbar {
		width: min(0.45rem, 25%);
		border-radius: 2px 2px 0 0;
		background: var(--pass);
	}
	.sw.blocking,
	.seg.blocking {
		background: var(--block);
	}
	.sw.other,
	.seg.other {
		background: color-mix(in srgb, var(--ink-3) 60%, transparent);
	}
	.sw.dismissed,
	.seg.dismissed {
		background: color-mix(in srgb, var(--ink-3) 25%, transparent);
	}
	.sw.fixed {
		background: var(--pass);
	}
	.x {
		font-size: 0.6875rem;
		line-height: 1.1rem;
		white-space: nowrap;
	}

	/* Commit heatmap: rows per contributor, a square per week */
	.heat {
		padding: 0.75rem;
		overflow-x: auto;
	}
	.grid {
		display: grid;
		grid-template-columns: 8.5rem repeat(var(--n), minmax(0.5rem, 1fr)) 3rem;
		gap: 3px;
		align-items: center;
		min-width: 36rem;
	}
	.month {
		font-size: 0.6875rem;
		white-space: nowrap;
		overflow: visible;
		width: 0;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		padding-right: 0.4rem;
		font-size: var(--text-xs);
	}
	.who img,
	.ava {
		flex: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
	}
	.ava {
		display: inline-grid;
		place-items: center;
		background: var(--sunken);
		color: var(--ink-2);
		font-size: 0.625rem;
		font-weight: 600;
	}
	.who.all .name {
		font-weight: 600;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell {
		display: block;
		aspect-ratio: 1;
		border-radius: 2px;
		background: var(--sunken);
	}
	.cell.l1 {
		background: color-mix(in srgb, var(--pass) 30%, var(--sunken));
	}
	.cell.l2 {
		background: color-mix(in srgb, var(--pass) 55%, var(--sunken));
	}
	.cell.l3 {
		background: color-mix(in srgb, var(--pass) 78%, var(--sunken));
	}
	.cell.l4 {
		background: var(--pass);
	}
	.total {
		text-align: right;
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		cursor: default;
	}
	.heat-foot {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}
	.scale {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.scale .cell {
		width: 0.65rem;
		height: 0.65rem;
	}

	@media (max-width: 980px) {
		.widgets {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 760px) {
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 560px) {
		.list li {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.list .pill {
			grid-column: 1 / -1;
		}
	}
</style>
