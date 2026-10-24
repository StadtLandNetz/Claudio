<script lang="ts">
	import { changeRef } from '@claudio/core';
	import { enhance } from '$app/forms';
	import EvidenceThumbs, { type ThumbEvidence } from '#lib/components/EvidenceThumbs.svelte';
	import FindingHistory from '#lib/components/FindingHistory.svelte';
	import Lightbox from '#lib/components/Lightbox.svelte';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import AgentQuestion from '#lib/components/AgentQuestion.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import PageNav, { type Section } from '#lib/components/PageNav.svelte';
	import Seg from '#lib/components/Seg.svelte';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import { invalidateAll } from '$app/navigation';
	import Severity from '#lib/components/Severity.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import TraceTimeline, { type Marker } from '#lib/components/TraceTimeline.svelte';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import { isActive } from '#lib/labels.js';
	import { tooltip } from '#lib/tooltip.js';
	import { parseNotes } from '#lib/notes.js';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = i18n();
	let posting = $state(false);
	const commentUrl = $derived((form && 'commented' in form ? form.commented : null) ?? data.review.commentUrl);
	const commentError = $derived(form && 'error' in form && form.form === 'comment' ? form.error : null);

	const report = $derived(data.report);
	// The stream reports status changes (queued → running) without reloading the page.
	let liveStatus = $state<string | null>(null);
	const review = $derived({ ...data.review, status: liveStatus ?? data.review.status });
	const active = $derived(isActive(review.status));

	// ---- findings
	// Filters: by rating (all, open, dismissed) and by type; both start fresh on every page.
	let findingStatus = $state<'all' | 'open' | 'dismissed'>('all');
	let findingType = $state('');
	const byStatus = $derived(
		(report?.findings ?? []).filter((f) => findingStatus === 'all' || (findingStatus === 'dismissed') === (f.rating.status === 'dismissed'))
	);
	const findingTypes = $derived.by(() => {
		const m = new Map<string, number>();
		for (const f of byStatus) m.set(f.category, (m.get(f.category) ?? 0) + 1);
		return [...m].sort((a, b) => b[1] - a[1]);
	});
	const shownFindings = $derived(findingType ? byStatus.filter((f) => f.category === findingType) : byStatus);
	// "Current" shows this review's findings; "per review" compares them across the reviews of the pull request.
	let findingsView = $state<'current' | 'history'>('current');
	function showFinding(id: string) {
		findingsView = 'current';
		findingType = '';
		findingStatus = 'all';
		tick().then(() => document.getElementById(`finding-${id}`)?.scrollIntoView({ block: 'start' }));
	}

	// The thread of a finding: one field, and comment, confirm and dismiss as equal actions on it.
	let drafts = $state<Record<string, string>>({});
	let sending = $state<string | null>(null);
	const verb: Record<string, () => string> = {
		comment: () => i.t('review.actComment'),
		confirmed: () => i.t('review.actConfirmed'),
		dismissed: () => i.t('review.actDismissed'),
		reset: () => i.t('review.actReset')
	};
	const statusTip = (f: ReportFinding) =>
		f.rating.by ? i.t('review.statusTip', { status: i.t(f.rating.status === 'confirmed' ? 'review.statusConfirmed' : 'review.statusDismissed'), user: f.rating.by, date: i.formatDate(f.rating.at) }) : '';
	const sendOnCmdEnter = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
		const form = (e.currentTarget as HTMLTextAreaElement).form;
		form?.requestSubmit(form.querySelector<HTMLButtonElement>('button[value="comment"]') ?? undefined);
	};
	type ReportFinding = NonNullable<PageProps['data']['report']>['findings'][number];

	// ---- acceptance criteria: the first few, all of them, or only those that need attention
	const AC_PREVIEW = 4;
	// Routes the change reaches (import graph); long lists fold away.
	const IMPACT_PREVIEW = 12;
	const impact = $derived(report?.impact && report.impact.framework !== 'unknown' ? report.impact : null);
	// Which regression tests the worker picked, and the affected route each one touches.
	const selection = $derived(report?.testSelection ?? null);
	const routeOfTest = $derived(new Map((selection?.selected ?? []).flatMap((t) => (t.route ? [[t.id, t.route] as const] : []))));
	const selectionText = $derived.by(() => {
		if (!selection) return '';
		const n = selection.selected.length + selection.skipped.length;
		if (selection.all === 'requested') return i.t('review.testsAllRequested', { n });
		if (selection.all === 'no_impact') return i.t('review.testsAllNoImpact', { n });
		if (selection.all === 'unknown_framework') return i.t('review.testsAllUnknownFramework', { n });
		if (selection.all === 'global_change') return i.t('review.testsAllGlobal', { n });
		const unknown = selection.selected.filter((t) => t.unknownPaths).length;
		return `${i.t('review.testsSelected', { n: selection.selected.length, total: n })}${unknown ? ` ${i.t('review.testsUnknownPaths', { n: unknown })}` : ''}`;
	});
	const kindLabel = (kind: 'page' | 'layout' | 'endpoint') =>
		i.t(kind === 'page' ? 'review.impactKindPage' : kind === 'layout' ? 'review.impactKindLayout' : 'review.impactKindEndpoint');
	let acFilter = $state<'all' | 'warnings'>('all');
	const acWarningsOnly = $derived(acFilter === 'warnings');
	let acExpanded = $state(false);
	const acRows = $derived((report?.acceptanceCriteria ?? []).map((ac, k) => ({ ac, n: k + 1 })));
	const acWarnings = $derived(acRows.filter((r) => r.ac.status !== 'passed'));
	const acShown = $derived(acWarningsOnly ? acWarnings : acExpanded ? acRows : acRows.slice(0, AC_PREVIEW));
	function collapseAc() {
		acExpanded = false;
		tick().then(() => {
			const el = document.getElementById('criteria');
			if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
		});
	}

	// Links from the timeline (or shared ones) may point at a criterion or finding that a filter hides: show it, then go there.
	async function revealHash() {
		const target = decodeURIComponent(location.hash.slice(1));
		if (!target || document.getElementById(target)) return;
		const fid = /^finding-(.+)$/.exec(target)?.[1];
		if (/^ac-\d+$/.test(target)) {
			acFilter = 'all';
			acExpanded = true;
		} else if (fid) {
			const f = report?.findings.find((x) => x.id === fid);
			if (!f) return;
			findingsView = 'current';
			findingType = '';
			findingStatus = 'all';
		} else return;
		await tick();
		document.getElementById(target)?.scrollIntoView({ block: 'start' });
	}
	$effect(() => {
		untrack(() => revealHash());
		window.addEventListener('hashchange', revealHash);
		return () => window.removeEventListener('hashchange', revealHash);
	});

	let includeNotes = $state(true);
	const preview = $derived(includeNotes && data.commentPreviewWithNotes ? data.commentPreviewWithNotes : data.commentPreview);
	const counts = $derived.by(() => {
		const f = report?.findings ?? [];
		return {
			open: f.filter((x) => x.rating.status !== 'dismissed').length,
			blocking: f.filter((x) => x.blocking).length,
			dismissed: f.filter((x) => x.rating.status === 'dismissed').length
		};
	});
	const acPassed = $derived(report?.acceptanceCriteria.filter((a) => a.status === 'passed').length ?? 0);

	// Regression tests run after the review; refresh until they are done.
	const testsActive = $derived(data.tests.some((t) => isActive(t.status)));
	const testsPassed = $derived(data.tests.filter((t) => t.outcome === 'passed').length);
	$effect(() => {
		if (!testsActive || isActive(data.review.status)) return;
		const t = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(t);
	});

	// ---- screenshots
	let lightbox: { url: string; label: string } | null = $state(null);
	const openEv = (ev: ThumbEvidence) => {
		if (ev.url) lightbox = { url: ev.url, label: `${ev.id} ${ev.label}` };
	};
	const evidenceOf = (ids: string[]) => ids.flatMap((id) => report?.evidence[id] ?? []);
	const evidenceNo = (id: string) => Number(id.replace(/\D+/g, '')) || 0;
	// Every screenshot of the run in capture order; criteria and findings only show the ones they cite.
	const gallery = $derived(
		Object.values(report?.evidence ?? {})
			.filter((e) => e.kind === 'screenshot')
			.sort((a, b) => evidenceNo(a.id) - evidenceNo(b.id))
	);

	// ---- trace timeline
	let timeline = $state<ReturnType<typeof TraceTimeline>>();
	const hasTrace = $derived(Boolean(report?.files.timeline && data.review.runId));
	// A finding's first screenshot was taken when it was observed; its own time is when the agent wrote it up.
	const anchorOf = (ids: string[], fallback: string) => ids.map((id) => report?.evidence[id]?.createdAt).find((x): x is string => Boolean(x)) ?? fallback;
	const jumpEv = (ev: ThumbEvidence) => ev.createdAt && timeline?.jumpTo(ev.createdAt);
	// Everything the timeline marks: screenshots, findings (with whether they block), criteria and the agent's notes.
	const markers = $derived.by((): Marker[] => {
		if (!report) return [];
		const evidence: Marker[] = gallery.map((e) => ({ kind: 'evidence', id: e.id, label: e.label, at: e.createdAt, body: e.note, image: e.url ?? undefined }));
		const findings: Marker[] = report.findings.map((f) => ({
			kind: 'finding',
			id: f.id,
			label: f.title,
			at: anchorOf(f.evidenceIds, f.createdAt),
			severity: f.severity,
			blocking: f.blocking,
			dismissed: f.rating.status === 'dismissed',
			body: [f.description, f.expected && `${i.t('review.expected')}: ${f.expected}`, f.actual && `${i.t('review.observed')}: ${f.actual}`].filter(Boolean).join('\n'),
			href: `#finding-${f.id}`
		}));
		const criteria: Marker[] = report.acceptanceCriteria.map((ac, idx) => ({
			kind: 'ac',
			id: `AC${idx + 1}`,
			label: ac.criterion,
			at: anchorOf(ac.evidenceIds, ac.createdAt),
			status: ac.status,
			body: ac.notes,
			href: `#ac-${idx + 1}`
		}));
		const notes: Marker[] = parseNotes(report.notes).map((n, k) => ({ kind: 'note', id: `N${k + 1}`, label: n.text.split('\n')[0]!, at: n.at, body: n.text }));
		return [...evidence, ...findings, ...criteria, ...notes];
	});
	const openMarker = (m: Marker) => {
		if (m.image) lightbox = { url: m.image, label: `${m.id} ${m.label}` };
	};
	// Playwright's viewer runs a service worker, which browsers allow only on HTTPS or localhost.
	let secure = $state(false);
	$effect(() => {
		secure = window.isSecureContext;
	});
	const viewerHref = $derived(
		hasTrace && secure && data.viewerAvailable && report?.files.trace ? `/trace-viewer/index.html?trace=${encodeURIComponent(new URL(report.files.trace, page.url.origin).href)}` : null
	);

	// ---- the sections the sticky header links to, in page order
	const showLog = $derived(isActive(data.review.status) || data.eventCount > 0);
	const showComment = $derived(Boolean(report) && !review.fixture && review.status !== 'queued' && review.status !== 'running');
	const sections = $derived.by((): Section[] => {
		const out: Section[] = [];
		if (hasTrace && report) out.push({ id: 'trace', label: i.t('review.sectionTrace') });
		if (active) out.push({ id: 'live', label: i.t('common.sectionLive') });
		if (showLog) out.push({ id: 'log', label: i.t('review.sectionLog') });
		if (!report) return out;
		if (report.followUp) out.push({ id: 'followup', label: i.t('review.sectionFollowUp') });
		if (report.summaryHtml) out.push({ id: 'summary', label: i.t('review.summary') });
		if (impact) out.push({ id: 'impact', label: i.t('review.sectionImpact'), count: impact.global.length ? undefined : impact.routes.length });
		if (data.tests.length || selection) {
			const failed = data.tests.some((t) => t.outcome === 'failed');
			out.push({
				id: 'tests',
				label: i.t('review.sectionTests'),
				count: data.tests.length ? `${testsPassed}/${data.tests.length}` : undefined,
				tone: failed ? 'block' : testsActive || !data.tests.length ? undefined : 'pass',
				tip: i.t('review.tipTests', { passed: testsPassed, total: data.tests.length })
			});
		}
		const acFailed = acRows.some((r) => r.ac.status === 'failed');
		out.push({
			id: 'criteria',
			label: i.t('review.sectionCriteria'),
			count: acRows.length ? `${acPassed}/${acRows.length}` : undefined,
			tone: acFailed ? 'block' : acWarnings.length ? 'major' : acRows.length ? 'pass' : undefined,
			tip: i.t('review.tipCriteria', { passed: acPassed, total: acRows.length })
		});
		out.push({
			id: 'findings',
			label: i.t('review.findings'),
			count: counts.open,
			tone: counts.blocking ? 'block' : undefined,
			tip: i.t('review.tipFindings', { open: counts.open, blocking: counts.blocking })
		});
		if (gallery.length) out.push({ id: 'screenshots', label: i.t('review.screenshots'), count: gallery.length });
		if (showComment) out.push({ id: 'comment', label: i.t('review.sectionComment') });
		if (report.errors.length) out.push({ id: 'problems', label: i.t('review.sectionProblems'), count: report.errors.length, tone: 'block' });
		return out;
	});
</script>

<svelte:head><title>{changeRef(i.provider, review.prNumber)} {review.prTitle ?? ''} · Claudio</title></svelte:head>

<div class="page-title">
	<div>
		<p class="crumbs">
			<a href="/repos/{review.repoPath}">{review.repo}</a><span class="sep"></span><a href="/repos/{review.repoPath}?tab=reviews">{i.t('review.allReviews')}</a>
		</p>
		<h1>{changeRef(i.provider, review.prNumber)} {review.prTitle ?? ''}</h1>
	</div>
	{#if active}
		<form method="POST" action="?/abort" use:enhance>
			<button class="btn danger" type="submit" disabled={review.abortRequested}>
				{review.abortRequested ? i.t('review.aborting') : i.t('review.abort')}
			</button>
		</form>
	{:else if report && data.canWrite}
		<a class="btn small" href="/reviews/new?repo={encodeURIComponent(review.repo)}&pr={review.prNumber}">{i.t('review.reReview')}</a>
	{/if}
</div>

<PageNav title="{changeRef(i.provider, review.prNumber)} {review.prTitle ?? ''}" {sections} />

{#if report}
	<!-- The verdict: the one loud element on the page. -->
	<section class="stamp {report.verdict}" aria-label={i.t('review.verdict')}>
		<span class="glyph" aria-hidden="true">
			{#if report.verdict === 'approve'}<Icon name="check" size={12} />{:else if report.verdict === 'request_changes'}<Icon name="x" size={12} />{/if}
		</span>
		<div class="verdict">
			<p class="word">{i.labels.verdict[report.verdict]}</p>
			<p class="why">
				{i.t('review.whyAc', { passed: acPassed, total: report.acceptanceCriteria.length })}
				{i.t('review.whyBlocking', { n: counts.blocking })}{#if data.tests.length},
					{testsActive ? i.t('review.whyTestsRunning', { passed: testsPassed, total: data.tests.length }) : i.t('review.whyTestsDone', { passed: testsPassed, total: data.tests.length })}{/if}{#if review.status !== 'completed'}, {i.t('review.whyRun', { status: i.labels.status[review.status] ?? review.status })}{/if}.
			</p>
		</div>
		<form class="strict" method="GET">
			<label>
				<span>{i.t('review.strictness')}</span>
				<select name="strictness" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
					{#each Object.entries(i.labels.strictness) as [value, label] (value)}
						<option {value} selected={value === data.strictness}>{label}</option>
					{/each}
				</select>
			</label>
			<noscript><button class="btn small" type="submit">{i.t('review.apply')}</button></noscript>
		</form>
	</section>
{:else}
	<section class="pending">
		<StatusBadge status={review.status} />
		<p class="muted">
			{#if review.status === 'queued'}
				{i.t('review.queuedHelp')} <code>pnpm worker</code>.
			{:else if review.status === 'running'}
				{i.t('review.runningHelp', { url: review.instanceUrl })}
			{:else}
				{i.t('review.noReportGenerated')}
			{/if}
		</p>
	</section>
{/if}

{#if review.error && !report}
	<p class="notice error">{review.error}</p>
{/if}

<div class="layout">
	<div class="main">
		{#if hasTrace && report && data.review.runId}
			<TraceTimeline bind:this={timeline} id="trace" runId={data.review.runId} {markers} viewerUrl={viewerHref} downloadUrl={report.files.trace} onopen={openMarker} />
		{/if}

		{#if active}
			<div class="stack" id="live">
				{#if data.human?.kind === 'question'}
					<AgentQuestion requestId={data.human.id} question={data.human.reason} context={data.human.context} options={data.human.options} />
					<LiveView src="/reviews/{data.review.id}/live" url={review.instanceUrl} />
				{:else if data.human}
					<HumanTakeover src="/reviews/{data.review.id}/live" requestId={data.human.id} reason={data.human.reason} url={review.instanceUrl} />
				{:else}
					<LiveView src="/reviews/{data.review.id}/live" url={review.instanceUrl} />
				{/if}
			</div>
		{/if}

		{#if showLog}
			<div id="log">
			<LiveLog
				streamUrl="/reviews/{data.review.id}/events"
				count={data.eventCount}
				active={isActive(data.review.status)}
				onstatus={(s) => (liveStatus = s)}
				online={(line) => /^Mensch (gebraucht|fertig):/.test(line) && invalidateAll()}
			/>
			</div>
		{/if}

		{#if report}
			{#if report.followUp}
				{@const fu = report.followUp}
				{@const fixed = fu.rechecks.filter((r) => r.status === 'fixed')}
				{@const open = fu.rechecks.filter((r) => r.status !== 'fixed')}
				<section class="block followup" id="followup">
					<div class="block-head">
						<h2>{i.t('review.followUpOf', { id: fu.reviewId })}</h2>
						<a class="faint" href="/reviews/{fu.reviewId}">{i.t('review.followUpOpen', { id: fu.reviewId })}</a>
					</div>
					<p class="muted">
						{i.t('review.followUpCounts', { fixed: fixed.length, open: open.length })}
						{#if fu.headSha && fu.changedFiles}{i.t('review.followUpSince', { sha: fu.headSha.slice(0, 7), n: fu.changedFiles.length })}{/if}
					</p>
					{#if fu.rechecks.length}
						<ul class="rechecks sheet">
							{#each [...fixed, ...open] as r (r.findingId)}
								<li class={r.status}>
									<span class="rc-status">{i.labels.recheck[r.status]}</span>
									<div>
										<p><a href="/reviews/{fu.reviewId}#finding-{r.findingId}">{r.findingId}</a> {r.title}</p>
										{#if r.notes}<p class="faint">{r.notes}</p>{/if}
										{#if r.evidenceIds.length}
											<div class="ac-ev"><EvidenceThumbs items={evidenceOf(r.evidenceIds)} onopen={openEv} onjump={hasTrace ? jumpEv : undefined} /></div>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}

			{#if report.summaryHtml}
				<section class="block" id="summary">
					<h2>{i.t('review.summary')}</h2>
					<div class="prose">{@html report.summaryHtml}</div>
				</section>
			{/if}

			{#if impact}
				<section class="block" id="impact">
					<h2>{i.t('review.impactTitle')}</h2>
					<p class="faint">{i.t('review.impactHelp')}</p>
					{#snippet routeRow(r: (typeof impact.routes)[number])}
						<li title={r.via.join(' → ')}>
							<code>{r.kind === 'layout' && r.pattern !== '/' ? `${r.pattern}/…` : r.pattern}</code>
							<span class="faint">{kindLabel(r.kind)} · {r.direct ? i.t('review.impactDirect') : i.t('review.impactIndirect')}</span>
						</li>
					{/snippet}
					{#if impact.global.length || impact.routes.length}
						<ul class="impact sheet">
							{#each impact.global as g (g.file)}
								<li title={g.via.join(' → ')}>
									<code>{g.file}</code>
									<span class="global">{i.t('review.impactGlobal')}</span>
								</li>
							{/each}
							{#each impact.routes.slice(0, IMPACT_PREVIEW) as r (r.kind + r.pattern)}
								{@render routeRow(r)}
							{/each}
						</ul>
					{:else}
						<p>{i.t('review.impactNone')}</p>
					{/if}
					{#if impact.routes.length > IMPACT_PREVIEW}
						<details>
							<summary>{i.t('review.impactMore', { n: impact.routes.length - IMPACT_PREVIEW })}</summary>
							<ul class="impact sheet">
								{#each impact.routes.slice(IMPACT_PREVIEW) as r (r.kind + r.pattern)}
									{@render routeRow(r)}
								{/each}
							</ul>
						</details>
					{/if}
					{#if impact.unmapped.length}
						<details>
							<summary class="faint">{i.t('review.impactUnmapped', { n: impact.unmapped.length })}</summary>
							<ul class="impact sheet">
								{#each impact.unmapped as f (f)}<li><code>{f}</code></li>{/each}
							</ul>
						</details>
					{/if}
				</section>
			{/if}

			{#if data.tests.length || selection}
				<section class="block" id="tests">
					<h2>{i.t('review.regressionTests')}</h2>
					{#if selectionText}<p class="faint">{selectionText}</p>{/if}
					{#if data.tests.length}
						<ul class="tests sheet">
							{#each data.tests as t (t.id)}
								<li>
									<OutcomeBadge status={t.status} outcome={t.outcome} healed={t.healed} />
									<div>
										<span>
											<a href="/test-runs/{t.id}">{t.name}</a>
											{#if routeOfTest.get(t.scriptId)}<code class="faint">{routeOfTest.get(t.scriptId)}</code>{/if}
										</span>
										{#if t.summary && t.outcome !== 'passed'}<p class="faint">{t.summary}</p>{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
					{#if selection?.skipped.length}
						<details class="skipped">
							<summary class="faint">{i.t('review.testsSkipped', { n: selection.skipped.length })}</summary>
							<ul class="tests sheet">
								{#each selection.skipped as s (s.id)}<li><a href="/tests/{s.id}">{s.name}</a></li>{/each}
							</ul>
						</details>
					{/if}
				</section>
			{/if}

			<section class="block" id="criteria">
				<div class="block-head">
					<h2>{i.t('review.acceptanceCriteria')}</h2>
					{#if acRows.length > AC_PREVIEW || acWarnings.length}
						<Seg
							bind:value={acFilter}
							label={i.t('review.acceptanceCriteria')}
							options={[
								{ value: 'all', label: i.t('common.filterAll'), count: acRows.length },
								{ value: 'warnings', label: i.t('common.onlyWarnings'), count: acWarnings.length, tip: i.t('review.acWarningsHelp') }
							]}
						/>
					{/if}
				</div>
				{#if !acRows.length}
					<p class="muted">{i.t('review.noAcRated')}</p>
				{:else if !acShown.length}
					<p class="muted">{i.t('review.noAcWarnings')}</p>
				{:else}
					<div class="sheet">
						<ul class="ac">
							{#each acShown as { ac, n } (n)}
								<li class={ac.status} id="ac-{n}">
									<span class="ac-status">
										{i.labels.ac[ac.status]}
										{#if ac.carriedFrom}<span class="carried" use:tooltip={i.t('review.carriedHint')}>{i.t('review.carriedFrom', { id: ac.carriedFrom })}</span>{/if}
									</span>
									<div>
										<div class="crit-row">
											<p class="criterion">{ac.criterion}</p>
											{#if hasTrace}
												<button type="button" class="btn ghost small jump" use:tooltip={i.t('common.traceJump')} aria-label="{i.t('common.traceJump')}: AC{n}" onclick={() => timeline?.jumpTo(anchorOf(ac.evidenceIds, ac.createdAt))}>
													<Icon name="play" size={12} />
												</button>
											{/if}
										</div>
										{#if ac.notes}<p class="faint">{ac.notes}</p>{/if}
										{#if ac.evidenceIds.length}
											<div class="ac-ev"><EvidenceThumbs items={evidenceOf(ac.evidenceIds)} onopen={openEv} onjump={hasTrace ? jumpEv : undefined} /></div>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
						{#if !acWarningsOnly && acRows.length > AC_PREVIEW}
							<div class="more-row">
								<button type="button" aria-expanded={acExpanded} onclick={() => (acExpanded ? collapseAc() : (acExpanded = true))}>
									{acExpanded ? i.t('common.showLess') : i.t('common.showAll', { n: acRows.length })}
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</section>

			<section class="block" id="findings">
				<div class="block-head">
					<div class="title-row">
						<h2>{i.t('review.findings')}</h2>
						{#if data.history.length > 1}
							<Seg
								bind:value={findingsView}
								label={i.t('review.findingsView')}
								options={[
									{ value: 'current', label: i.t('review.findingsViewCurrent'), tip: i.t('review.findingsViewCurrentHelp') },
									{ value: 'history', label: i.t('review.findingsViewHistory'), count: data.history.length, tip: i.t('review.findingsViewHistoryHelp') }
								]}
							/>
						{/if}
					</div>
					{#if findingsView === 'current' && report.findings.length}
						<div class="list-tools">
							{#if counts.dismissed > 0}
								<Seg
									bind:value={findingStatus}
									label={i.t('review.findingsStatusLabel')}
									options={[
										{ value: 'all', label: i.t('common.filterAll'), count: report.findings.length },
										{ value: 'open', label: i.t('review.statusOpen'), count: counts.open, tip: i.t('review.statusOpenHelp') },
										{ value: 'dismissed', label: i.t('review.statusDismissed'), count: counts.dismissed, tip: i.t('review.statusDismissedHelp') }
									]}
								/>
							{/if}
							{#if findingTypes.length > 1 || findingType}
								<select class="mini-select" bind:value={findingType} aria-label={i.t('review.findingsByType')}>
									<option value="">{i.t('review.typeAll')}</option>
									{#each findingTypes as [cat, n] (cat)}<option value={cat}>{i.labels.category[cat] ?? cat} ({n})</option>{/each}
								</select>
							{/if}
						</div>
					{/if}
				</div>
				{#if findingsView === 'history'}
					<FindingHistory reviews={data.history} currentId={review.id} onopen={showFinding} />
				{:else if report.findings.length === 0}
					<p class="muted">{i.t('review.noFindings')}</p>
				{:else if shownFindings.length === 0}
					<p class="muted">{i.t('review.noFindingsOfType')}</p>
				{/if}
				{#each findingsView === 'current' ? shownFindings : [] as f (f.id)}
					<article class="finding sheet {f.rating.status}" class:blocking={f.blocking} id="finding-{f.id}">
						<header>
							<Severity severity={f.severity} />
							<span class="cat">{i.labels.category[f.category] ?? f.category}</span>
							{#if f.blocking}<span class="blk">{i.t('review.blocksApproval')}</span>{/if}
							{#if f.rating.status !== 'proposed'}
								<span class="state {f.rating.status}" use:tooltip={statusTip(f)}>
									<Icon name={f.rating.status === 'confirmed' ? 'check' : 'x'} size={10} />
									{f.rating.status === 'confirmed' ? i.t('review.statusConfirmed') : i.t('review.statusDismissed')}
								</span>
							{/if}
							{#if f.previous}
								<a class="prev {f.previous.status}" href="/reviews/{f.previous.reviewId}#finding-{f.previous.findingId}">
									{f.previous.status === 'still_open' ? i.t('review.stillOpenFrom', { id: f.previous.reviewId, fid: f.previous.findingId }) : i.t('review.notRecheckedFrom', { id: f.previous.reviewId, fid: f.previous.findingId })}
								</a>
							{/if}
							<span class="fid faint">{f.id}</span>
							{#if hasTrace}
								<button type="button" class="btn ghost small jump" use:tooltip={i.t('common.traceJump')} aria-label="{i.t('common.traceJump')}: {f.id}" onclick={() => timeline?.jumpTo(anchorOf(f.evidenceIds, f.createdAt))}>
									<Icon name="play" size={12} />
								</button>
							{/if}
						</header>
						<h3>{f.title}</h3>
						<p class="desc">{f.description}</p>
						{#if f.steps.length}
							<ol class="steps">
								{#each f.steps as step, idx (idx)}<li>{step}</li>{/each}
							</ol>
						{/if}
						{#if f.expected || f.actual}
							<dl class="ea">
								{#if f.expected}<dt>{i.t('review.expected')}</dt><dd>{f.expected}</dd>{/if}
								{#if f.actual}<dt>{i.t('review.observed')}</dt><dd>{f.actual}</dd>{/if}
							</dl>
						{/if}
						{#if f.url}<p class="faint url">{f.url}</p>{/if}
						{#if f.evidenceIds.length}
							<EvidenceThumbs items={evidenceOf(f.evidenceIds)} onopen={openEv} onjump={hasTrace ? jumpEv : undefined} />
						{/if}

						<!-- The thread: ratings and comments as equal entries, then one field for all three actions -->
						{#if f.activity.length || data.canWrite}
							<div class="thread">
								{#if f.activity.length}
									<ol class="entries" aria-label={i.t('review.activityLabel', { id: f.id })}>
										{#each f.activity as a (a.id)}
											<li class="entry {a.kind}">
												<span class="badge {a.kind}" aria-hidden="true">
													<Icon name={a.kind === 'confirmed' ? 'check' : a.kind === 'dismissed' ? 'x' : a.kind === 'reset' ? 'skip-back' : 'comment'} size={10} />
												</span>
												<div class="entry-main">
													<div class="entry-head">
														<strong>{a.by}</strong>
														<span>{verb[a.kind]?.()}</span>
														<span class="faint">{i.formatDate(a.at)}</span>
														{#if a.mine && a.kind === 'comment' && data.canWrite}
															<form method="POST" action="?/deleteComment" class="del" use:enhance={() => async ({ update }) => update({ reset: false })}>
																<input type="hidden" name="id" value={a.id} />
																<button type="submit" class="linkish">{i.t('review.deleteComment')}</button>
															</form>
														{/if}
													</div>
													{#if a.body}<p class="entry-body">{a.body}</p>{/if}
												</div>
											</li>
										{/each}
									</ol>
								{/if}
								{#if data.canWrite}
									{@const activityError = form && 'error' in form && form.form === `activity:${f.id}` ? form.error : null}
									<form
										method="POST"
										action="?/activity"
										class="composer"
										use:enhance={() => {
											sending = f.id;
											return async ({ result, update }) => {
												await update({ reset: false });
												sending = null;
												if (result.type === 'success') drafts[f.id] = '';
											};
										}}
									>
										<input type="hidden" name="findingId" value={f.id} />
										<label class="visually-hidden" for="composer-{f.id}">{i.t('review.composerLabel', { id: f.id })}</label>
										<textarea
											id="composer-{f.id}"
											name="body"
											rows="1"
											placeholder={i.t('review.composerPlaceholder')}
											value={drafts[f.id] ?? ''}
											oninput={(e) => (drafts[f.id] = e.currentTarget.value)}
											onkeydown={sendOnCmdEnter}
										></textarea>
										{#if activityError}<p class="notice error" role="alert">{activityError}</p>{/if}
										<div class="composer-actions">
											{#if f.rating.status === 'confirmed' && !review.fixture}
												{#if f.rating.issueUrl}
													<a class="btn ghost small" href={f.rating.issueUrl} target="_blank" rel="noopener noreferrer">{i.t('review.issueOpen', { n: f.rating.issueUrl.split('/').pop() ?? '' })} <Icon name="external" size={12} /></a>
												{:else}
													<button type="submit" class="btn ghost small" form="issue-{f.id}" use:tooltip={i.t('review.issueHelp')}>{i.t('review.issueCreate')}</button>
												{/if}
											{/if}
											<span class="spacer"></span>
											<button type="submit" class="btn small" name="kind" value="comment" disabled={sending === f.id || !drafts[f.id]?.trim()} use:tooltip={i.t('review.commentBtnHelp')}>
												<Icon name="comment" size={12} />
												{i.t('review.doComment')}
											</button>
											<button type="submit" class="btn small" name="kind" value="confirmed" disabled={sending === f.id} aria-pressed={f.rating.status === 'confirmed'} use:tooltip={i.t('review.confirmHelp')}>
												<Icon name="check" size={12} />
												{i.t('review.confirm')}
											</button>
											<button type="submit" class="btn small" name="kind" value="dismissed" disabled={sending === f.id} aria-pressed={f.rating.status === 'dismissed'} use:tooltip={i.t('review.dismissHelp')}>
												<Icon name="x" size={12} />
												{i.t('review.dismiss')}
											</button>
											{#if f.rating.status !== 'proposed'}
												<button type="submit" class="btn ghost small" name="kind" value="reset" disabled={sending === f.id} use:tooltip={i.t('review.resetHelp')}>{i.t('review.reset')}</button>
											{/if}
										</div>
									</form>
									{#if f.rating.status === 'confirmed' && !review.fixture && !f.rating.issueUrl}
										{@const issueError = form && 'error' in form && form.form === `issue:${f.id}` ? form.error : null}
										<form id="issue-{f.id}" method="POST" action="?/issue" hidden use:enhance={() => async ({ update }) => update({ reset: false })}>
											<input type="hidden" name="findingId" value={f.id} />
										</form>
										{#if issueError}<p class="notice error" role="alert">{issueError}</p>{/if}
									{/if}
								{/if}
							</div>
						{/if}
					</article>
				{/each}
			</section>

			{#if gallery.length}
				<section class="block" id="screenshots">
					<div class="block-head">
						<h2>{i.t('review.screenshots')}</h2>
						<span class="faint">{i.t('common.screenshotsExpire')}</span>
					</div>
					<EvidenceThumbs items={gallery} layout="grid" onopen={openEv} onjump={hasTrace ? jumpEv : undefined} />
				</section>
			{/if}

			{#if showComment}
				<section class="block comment" id="comment">
					<h2>{i.t('review.prComment')}</h2>
					{#if commentUrl}
						<p class="notice ok">{i.t('review.commentPosted')} <a href={commentUrl} target="_blank" rel="noopener noreferrer">{i.t('review.openComment')}</a></p>
					{:else}
						<p class="muted">
							{i.t('review.commentHelp')}
						</p>
					{/if}
					{#if commentError}<p class="notice error" role="alert">{commentError}</p>{/if}
					<details class="sheet preview">
						<summary>{i.t('review.preview')}</summary>
						<div class="prose">{@html preview}</div>
					</details>
					<form method="POST" action="?/comment" use:enhance={() => { posting = true; return async ({ update }) => { await update({ reset: false }); posting = false; }; }}>
						<input type="hidden" name="strictness" value={data.strictness} />
						{#if data.noteCount > 0}
							<label class="check small">
								<input type="checkbox" name="includeNotes" value="1" bind:checked={includeNotes} />
								<span>{i.t('review.includeNotes', { n: data.noteCount })}</span>
							</label>
						{/if}
						<button class="btn {commentUrl ? '' : 'primary'}" type="submit" disabled={posting}>
							{posting ? i.t('review.posting') : commentUrl ? i.t('review.repost') : i.t('review.post')}
						</button>
					</form>
				</section>
			{/if}

			{#if report.errors.length}
				<section class="block" id="problems">
					<h2>{i.t('review.runProblems')}</h2>
					<ul class="errors">
						{#each report.errors as err, idx (idx)}<li>{err}</li>{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</div>

	<aside class="meta">
		<dl>
			<dt>{i.t('review.status')}</dt>
			<dd><StatusBadge status={review.status} verdict={report?.verdict ?? null} /></dd>
			{#if report}
				<dt>{i.t('review.pullRequest')}</dt>
				<dd><a href={report.pr.url} target="_blank" rel="noopener noreferrer">{changeRef(i.provider, report.pr.number)}</a> {i.t('review.refs', { head: report.pr.headRef, base: report.pr.baseRef })}</dd>
				{#if report.issues.length}
					<dt>{i.t('review.tickets')}</dt>
					<dd>
						{#each report.issues as issue (issue.number)}
							<a href={issue.url} target="_blank" rel="noopener noreferrer">#{issue.number} {issue.title}</a><br />
						{/each}
					</dd>
				{/if}
			{/if}
			<dt>{i.t('review.instance')}</dt>
			<dd class="break">{review.instanceUrl}</dd>
			<dt>{i.t('review.roles')}</dt>
			<dd>{review.request.roles.join(', ') || i.t('review.noRoles')}</dd>
			<dt>{i.t('review.budget')}</dt>
			<dd>{i.labels.budget[review.request.budget]}</dd>
			{#if report}
				<dt>{i.t('review.costs')}</dt>
				<dd>
					{i.formatUsd(report.cost.usd)}<br />
					<span class="faint">
						{i.t('review.costDetail', { turns: report.cost.turns, steps: report.cost.browserSteps, duration: i.formatDuration(report.cost.durationMs) })}
					</span>
				</dd>
			{/if}
			<dt>{i.t('review.started')}</dt>
			<dd>
				{i.formatDate(review.createdAt)}<br />
				<span class="faint">
					{i.t(review.trigger === 'comment' ? 'review.byComment' : review.trigger === 'label' ? 'review.byLabel' : review.trigger === 'push' ? 'review.byPush' : review.trigger === 'deployment' ? 'review.byDeployment' : 'review.byUser', { user: review.startedBy })}
				</span>
			</dd>
			{#if review.finishedAt}
				<dt>{i.t('review.finished')}</dt>
				<dd>{i.formatDate(review.finishedAt)}</dd>
			{/if}
			{#if commentUrl}
				<dt>{i.t('review.prCommentMeta')}</dt>
				<dd><a href={commentUrl} target="_blank" rel="noopener noreferrer">{i.t('review.onGithub')}</a></dd>
			{/if}
			{#if review.fixture}
				<dt>{i.t('review.source')}</dt>
				<dd>{i.t('review.demoSource')}</dd>
			{/if}
		</dl>
		{#if report}
			<div class="downloads">
				<span class="faint">{i.t('review.downloadReport')}</span>
				<a href="/reviews/{review.id}/report.md?verbosity=tldr&strictness={data.strictness}">{i.t('review.downloadTldr')}</a>
				<a href="/reviews/{review.id}/report.md?verbosity=normal&strictness={data.strictness}">{i.t('review.downloadNormal')}</a>
				<a href="/reviews/{review.id}/report.md?verbosity=detailed&strictness={data.strictness}">{i.t('review.downloadDetailed')}</a>
				{#if report.files.trace}<a href={report.files.trace}>{i.t('review.trace')}</a>{/if}
				{#if viewerHref}<a href={viewerHref} target="_blank" rel="noopener noreferrer">{i.t('common.traceOpenViewer')}</a>{/if}
			</div>
		{/if}
	</aside>
</div>

<Lightbox bind:item={lightbox} />


<style>
	.page-title h1 {
		max-width: 46rem;
	}

	/* Verdict: the one loud element on the page */
	.stamp {
		--tone: var(--hint);
		display: flex;
		align-items: center;
		gap: 0.75rem 1.5rem;
		flex-wrap: wrap;
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
		min-width: 14rem;
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
	.strict label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}
	.strict select {
		width: auto;
	}
	.pending {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
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
		gap: 1rem;
		flex-wrap: wrap;
	}
	.check.small {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.impact {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
	}
	.impact li {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		flex-wrap: wrap;
		padding: 0.4rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.impact li:last-child {
		border-bottom: 0;
	}
	.impact code {
		overflow-wrap: anywhere;
	}
	.impact .global {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--major);
	}
	#impact details,
	.skipped {
		margin-top: 0.5rem;
	}

	.tests {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.tests li {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.tests li:last-child {
		border-bottom: 0;
	}
	.tests li div {
		display: grid;
		gap: 0.1rem;
	}

	/* Acceptance criteria */
	.ac {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ac li {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.ac li:last-child {
		border-bottom: 0;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.stack {
		display: grid;
		gap: 1rem;
	}
	.carried {
		display: block;
		font-weight: 400;
		color: var(--ink-3);
	}
	.prev {
		font-weight: 500;
		color: var(--major);
	}
	.prev.not_rechecked {
		color: var(--ink-3);
	}
	/* Re-review: what became of the earlier findings */
	.rechecks {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rechecks li {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.rechecks li:last-child {
		border-bottom: 0;
	}
	.rc-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 500;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.rc-status::before {
		content: '';
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--hint);
	}
	.rechecks .fixed .rc-status::before {
		background: var(--pass);
	}
	.rechecks .still_open .rc-status::before {
		background: var(--block);
	}
	.ac-status {
		display: inline-flex;
		flex-wrap: wrap;
		align-self: start;
		padding-top: 0.1rem;
		align-items: center;
		gap: 0.4rem;
		font-weight: 500;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.ac-status::before {
		content: '';
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--hint);
	}
	.ac .passed .ac-status::before {
		background: var(--pass);
	}
	.ac .failed .ac-status::before {
		background: var(--block);
	}
	.ac .blocked .ac-status::before {
		background: var(--major);
	}
	.crit-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.criterion {
		font-weight: 500;
	}
	.jump {
		flex: none;
	}
	.ac-ev {
		margin-top: 0.4rem;
	}

	/* Findings */
	.finding {
		padding: 0.875rem 1rem;
		display: grid;
		gap: 0.55rem;
	}
	.finding.blocking {
		border-left: 2px solid var(--block);
	}
	.finding.dismissed > :not(.thread, header) {
		opacity: 0.55;
	}
	.finding.dismissed h3 {
		text-decoration: line-through;
	}
	.finding header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: var(--text-xs);
	}
	.cat {
		font-weight: 500;
		color: var(--ink-2);
	}
	.blk {
		color: var(--block);
		font-weight: 500;
	}
	.fid {
		margin-left: auto;
		font-family: var(--mono);
	}
	.finding h3 {
		font-size: var(--text-md);
	}
	.desc {
		max-width: 46rem;
	}
	.steps {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--ink-2);
	}
	.ea {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.25rem 1rem;
		margin: 0;
	}
	.ea dt {
		font-weight: 500;
		color: var(--ink-3);
	}
	.ea dd {
		margin: 0;
	}
	.url {
		word-break: break-all;
		font-family: var(--mono);
	}
	/* The thread under a finding: entries in order, then one field for comment, confirm and dismiss */
	.thread {
		display: grid;
		gap: 0.6rem;
		padding-top: 0.7rem;
		margin-top: 0.15rem;
		border-top: 1px solid var(--rule);
	}
	.entries {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.entry {
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr);
		gap: 0.5rem;
	}
	.badge {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--sunken);
		color: var(--ink-2);
	}
	.badge.confirmed {
		background: var(--pass-soft);
		color: var(--pass);
	}
	.badge.comment {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.entry-main {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.entry-head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		flex-wrap: wrap;
		font-size: var(--text-xs);
		color: var(--ink-2);
		line-height: 1.25rem;
	}
	.entry-head strong {
		font-weight: 500;
		color: var(--ink);
	}
	.entry-body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.del {
		margin-left: auto;
	}
	.linkish {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-xs);
		color: var(--ink-3);
		cursor: pointer;
	}
	.linkish:hover {
		color: var(--block);
	}
	.composer {
		display: grid;
		gap: 0.5rem;
	}
	.composer textarea {
		min-height: var(--control-h);
		max-height: 14rem;
		padding: 0.3rem 0.5rem;
		resize: none;
		field-sizing: content;
	}
	.composer-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.composer-actions .spacer {
		flex: 1;
	}
	/* The rating in force: the same subdued "pressed" look for confirm and dismiss */
	.composer-actions .btn[aria-pressed='true'] {
		background: var(--sunken);
		border-color: var(--ink-3);
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		font-weight: 500;
		line-height: 1.5;
		background: var(--sunken);
		color: var(--ink-2);
		cursor: default;
	}
	.state.confirmed {
		background: var(--pass-soft);
		color: var(--pass);
	}
	.thread .notice {
		margin: 0;
	}
	.comment form {
		justify-self: start;
		display: grid;
		gap: 0.6rem;
		justify-items: start;
	}
	.preview summary {
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		font-weight: 500;
	}
	.preview .prose {
		padding: 0.25rem 0.75rem 0.75rem;
		font-size: var(--text-sm);
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
	.downloads {
		display: grid;
		gap: 0.3rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--rule);
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
	@media (max-width: 560px) {
		.ac li {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
