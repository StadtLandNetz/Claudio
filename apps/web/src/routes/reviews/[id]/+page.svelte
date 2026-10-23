<script lang="ts">
	import { enhance } from '$app/forms';
	import EvidenceThumbs, { type ThumbEvidence } from '#lib/components/EvidenceThumbs.svelte';
	import FindingHistory from '#lib/components/FindingHistory.svelte';
	import Lightbox from '#lib/components/Lightbox.svelte';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import AgentQuestion from '#lib/components/AgentQuestion.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import PageNav, { type Section } from '#lib/components/PageNav.svelte';
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
	type ReportFinding = NonNullable<PageProps['data']['report']>['findings'][number];
	let showDismissed = $state(true);
	// Filter by type (category); counts follow the "show dismissed" switch.
	let findingType = $state<string | null>(null);
	const visibleFindings = $derived((report?.findings ?? []).filter((f) => showDismissed || f.rating.status !== 'dismissed'));
	const findingTypes = $derived.by(() => {
		const m = new Map<string, number>();
		for (const f of visibleFindings) m.set(f.category, (m.get(f.category) ?? 0) + 1);
		return [...m].sort((a, b) => b[1] - a[1]);
	});
	const shownFindings = $derived(findingType ? visibleFindings.filter((f) => f.category === findingType) : visibleFindings);
	// "Current" shows this review's findings; "per review" compares them across the reviews of the pull request.
	let findingsView = $state<'current' | 'history'>('current');
	function showFinding(id: string) {
		findingsView = 'current';
		findingType = null;
		showDismissed = true;
		tick().then(() => document.getElementById(`finding-${id}`)?.scrollIntoView({ block: 'start' }));
	}

	// Confirming and dismissing each ask for their own reason in a dialog; the comment for the developers is separate.
	type RateDraft = { id: string; title: string; status: 'confirmed' | 'dismissed'; comment: string };
	let rateDraft = $state<RateDraft | null>(null);
	let rateOpen = $state(false);
	let rateBusy = $state(false);
	let rateError = $state<string | null>(null);
	function openRate(f: ReportFinding, status: RateDraft['status']) {
		rateDraft = { id: f.id, title: f.title, status, comment: f.rating.status === status ? f.rating.comment : '' };
		rateError = null;
		rateOpen = true;
	}
	// The finding whose comment for the developers is open for editing.
	let noting = $state<string | null>(null);
	const submitOnCmdEnter = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
	};

	// ---- acceptance criteria: the first few, all of them, or only those that need attention
	const AC_PREVIEW = 4;
	let acWarningsOnly = $state(false);
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
			acWarningsOnly = false;
			acExpanded = true;
		} else if (fid) {
			const f = report?.findings.find((x) => x.id === fid);
			if (!f) return;
			findingsView = 'current';
			findingType = null;
			if (f.rating.status === 'dismissed') showDismissed = true;
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
		if (data.tests.length) {
			const failed = data.tests.some((t) => t.outcome === 'failed');
			out.push({ id: 'tests', label: i.t('review.sectionTests'), count: `${testsPassed}/${data.tests.length}`, tone: failed ? 'block' : testsActive ? undefined : 'pass' });
		}
		const acFailed = acRows.some((r) => r.ac.status === 'failed');
		out.push({
			id: 'criteria',
			label: i.t('review.sectionCriteria'),
			count: acRows.length ? `${acPassed}/${acRows.length}` : undefined,
			tone: acFailed ? 'block' : acWarnings.length ? 'major' : acRows.length ? 'pass' : undefined
		});
		out.push({ id: 'findings', label: i.t('review.findings'), count: counts.open, tone: counts.blocking ? 'block' : undefined });
		if (gallery.length) out.push({ id: 'screenshots', label: i.t('review.screenshots'), count: gallery.length });
		if (showComment) out.push({ id: 'comment', label: i.t('review.sectionComment') });
		if (report.errors.length) out.push({ id: 'problems', label: i.t('review.sectionProblems'), count: report.errors.length, tone: 'block' });
		return out;
	});
</script>

<svelte:head><title>#{review.prNumber} {review.prTitle ?? ''} · Claudio</title></svelte:head>

<div class="page-title">
	<div>
		<p class="crumbs">
			<a href="/repos/{review.repo}">{review.repo}</a><span class="sep"></span><a href="/repos/{review.repo}?tab=reviews">{i.t('review.allReviews')}</a>
		</p>
		<h1>#{review.prNumber} {review.prTitle ?? ''}</h1>
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

<PageNav title="#{review.prNumber} {review.prTitle ?? ''}" {sections} />

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

			{#if data.tests.length}
				<section class="block" id="tests">
					<h2>{i.t('review.regressionTests')}</h2>
					<ul class="tests sheet">
						{#each data.tests as t (t.id)}
							<li>
								<OutcomeBadge status={t.status} outcome={t.outcome} healed={t.healed} />
								<div>
									<a href="/test-runs/{t.id}">{t.name}</a>
									{#if t.summary && t.outcome !== 'passed'}<p class="faint">{t.summary}</p>{/if}
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="block" id="criteria">
				<div class="block-head">
					<h2>{i.t('review.acceptanceCriteria')}</h2>
					{#if acRows.length > AC_PREVIEW || acWarnings.length}
						<div class="chips" role="group" aria-label={i.t('review.acceptanceCriteria')}>
							<button type="button" class="chip-btn" aria-pressed={!acWarningsOnly} onclick={() => (acWarningsOnly = false)}>
								{i.t('common.filterAll')} <span class="n">{acRows.length}</span>
							</button>
							<button type="button" class="chip-btn" aria-pressed={acWarningsOnly} use:tooltip={i.t('review.acWarningsHelp')} onclick={() => (acWarningsOnly = true)}>
								{i.t('common.onlyWarnings')} <span class="n">{acWarnings.length}</span>
							</button>
						</div>
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
							<div class="seg" role="group" aria-label={i.t('review.findingsView')}>
								<button type="button" aria-pressed={findingsView === 'current'} onclick={() => (findingsView = 'current')}>{i.t('review.findingsViewCurrent')}</button>
								<button type="button" aria-pressed={findingsView === 'history'} use:tooltip={i.t('review.findingsViewHistoryHelp')} onclick={() => (findingsView = 'history')}>
									{i.t('review.findingsViewHistory')} <span class="faint">{data.history.length}</span>
								</button>
							</div>
						{/if}
					</div>
					<div class="head-tools" hidden={findingsView === 'history'}>
						{#if findingTypes.length > 1 || findingType}
							<div class="chips" role="group" aria-label={i.t('review.findingsByType')}>
								<button type="button" class="chip-btn" aria-pressed={findingType === null} onclick={() => (findingType = null)}>
									{i.t('common.filterAll')} <span class="n">{visibleFindings.length}</span>
								</button>
								{#each findingTypes as [cat, n] (cat)}
									<button type="button" class="chip-btn" aria-pressed={findingType === cat} onclick={() => (findingType = findingType === cat ? null : cat)}>
										{i.labels.category[cat] ?? cat} <span class="n">{n}</span>
									</button>
								{/each}
							</div>
						{/if}
						{#if counts.dismissed > 0}
							<label class="check small">
								<input type="checkbox" bind:checked={showDismissed} />
								<span>{i.t('review.showDismissed', { n: counts.dismissed })}</span>
							</label>
						{/if}
					</div>
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

						<!-- The rating with its reason -->
						{#if f.rating.status !== 'proposed' && f.rating.comment}
							<div class="note {f.rating.status}">
								<p class="note-head">
									<strong>{f.rating.by ?? i.t('review.unknownUser')}</strong>
									<span>{f.rating.status === 'confirmed' ? i.t('review.hasConfirmed') : i.t('review.hasDismissed')}</span>
									{#if f.rating.at}<span class="faint">· {i.formatDate(f.rating.at)}</span>{/if}
									{#if data.canWrite}
										<button type="button" class="linkish" onclick={() => openRate(f, f.rating.status === 'confirmed' ? 'confirmed' : 'dismissed')}>{i.t('review.editReason')}</button>
									{/if}
								</p>
								<p class="note-body">{f.rating.comment}</p>
							</div>
						{/if}

						<!-- The comment for the developers, independent of the rating -->
						{#if noting === f.id}
							<form
								method="POST"
								action="?/note"
								class="dev-form"
								use:enhance={() =>
									async ({ result, update }) => {
										await update({ reset: false });
										if (result.type === 'success') noting = null;
									}}
							>
								<input type="hidden" name="findingId" value={f.id} />
								<label class="field">
									<span>{i.t('review.devNote')}</span>
									<!-- svelte-ignore a11y_autofocus -->
									<textarea name="note" rows="3" value={f.rating.note} placeholder={i.t('review.devNotePlaceholder')} autofocus onkeydown={submitOnCmdEnter}></textarea>
									<small>{i.t('review.devNoteHelp')}</small>
								</label>
								<div class="actions">
									<button class="btn primary small" type="submit">{i.t('review.devNoteSave')}</button>
									<button class="btn ghost small" type="button" onclick={() => (noting = null)}>{i.t('common.cancel')}</button>
									{#if f.rating.note}<button class="btn ghost danger small" type="submit" name="clearNote" value="1">{i.t('review.devNoteRemove')}</button>{/if}
								</div>
							</form>
						{:else if f.rating.note}
							<div class="note dev">
								<p class="note-head">
									<Icon name="comment" size={12} />
									<strong>{f.rating.noteBy ?? i.t('review.unknownUser')}</strong>
									<span>{i.t('review.devNote')}</span>
									{#if f.rating.noteAt}<span class="faint">· {i.formatDate(f.rating.noteAt)}</span>{/if}
									{#if data.canWrite}<button type="button" class="linkish" onclick={() => (noting = f.id)}>{i.t('review.devNoteEdit')}</button>{/if}
								</p>
								<p class="note-body">{f.rating.note}</p>
							</div>
						{/if}

						{#if data.canWrite}
							<div class="rate">
								{#if noting !== f.id && !f.rating.note}
									<button type="button" class="btn ghost small" use:tooltip={i.t('review.devNoteHelp')} onclick={() => (noting = f.id)}>
										<Icon name="comment" size={12} />
										{i.t('review.devNoteAdd')}
									</button>
								{/if}
								{#if f.rating.by && !(f.rating.status !== 'proposed' && f.rating.comment)}
									<span class="faint rated">
										{i.t(f.rating.status === 'confirmed' ? 'review.confirmedBy' : f.rating.status === 'dismissed' ? 'review.dismissedBy' : 'review.resetBy', { user: f.rating.by })}{f.rating.at ? `, ${i.formatDate(f.rating.at)}` : ''}
									</span>
								{/if}
								<div class="rate-buttons" role="group" aria-label={i.t('review.rating')}>
									<button type="button" class="btn small" class:on={f.rating.status === 'confirmed'} aria-pressed={f.rating.status === 'confirmed'} use:tooltip={i.t('review.confirmHelp')} onclick={() => openRate(f, 'confirmed')}>
										{i.t('review.confirm')}
									</button>
									<button type="button" class="btn small" class:on-dismiss={f.rating.status === 'dismissed'} aria-pressed={f.rating.status === 'dismissed'} use:tooltip={i.t('review.dismissHelp')} onclick={() => openRate(f, 'dismissed')}>
										{i.t('review.dismiss')}
									</button>
									{#if f.rating.status !== 'proposed'}
										<form method="POST" action="?/rate" use:enhance={() => async ({ update }) => update({ reset: false })}>
											<input type="hidden" name="findingId" value={f.id} />
											<button class="btn ghost small" name="status" value="proposed" use:tooltip={i.t('review.resetHelp')}>{i.t('review.reset')}</button>
										</form>
									{/if}
								</div>
							</div>
						{:else if f.rating.by && f.rating.status !== 'proposed' && !f.rating.comment}
							<p class="faint rated">
								{i.t(f.rating.status === 'confirmed' ? 'review.confirmedBy' : 'review.dismissedBy', { user: f.rating.by })}{f.rating.at ? `, ${i.formatDate(f.rating.at)}` : ''}
							</p>
						{/if}
						{#if f.rating.status === 'confirmed' && data.canWrite && !review.fixture}
							{@const issueError = form && 'error' in form && form.form === `issue:${f.id}` ? form.error : null}
							<div class="issue-row">
								{#if f.rating.issueUrl}
									<a href={f.rating.issueUrl} target="_blank" rel="noopener noreferrer">{i.t('review.issueOpen', { n: f.rating.issueUrl.split('/').pop() ?? '' })} <Icon name="external" size={12} /></a>
								{:else}
									<form method="POST" action="?/issue" use:enhance={() => async ({ update }) => update({ reset: false })}>
										<input type="hidden" name="findingId" value={f.id} />
										<button class="btn small" type="submit">{i.t('review.issueCreate')}</button>
									</form>
								{/if}
								{#if issueError}<span class="notice error" role="alert">{issueError}</span>{/if}
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
				<dd><a href={report.pr.url} target="_blank" rel="noopener noreferrer">#{report.pr.number}</a> {i.t('review.refs', { head: report.pr.headRef, base: report.pr.baseRef })}</dd>
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

<Modal
	bind:open={rateOpen}
	title={rateDraft ? i.t(rateDraft.status === 'confirmed' ? 'review.confirmTitle' : 'review.dismissTitle', { id: rateDraft.id }) : ''}
	locked={rateBusy}
>
	{#if rateDraft}
		<form
			id="rate-form"
			method="POST"
			action="?/rate"
			class="fields"
			use:enhance={() => {
				rateBusy = true;
				return async ({ result, update }) => {
					rateBusy = false;
					if (result.type === 'failure') {
						rateError = String(result.data?.error ?? '');
						return;
					}
					await update({ reset: false });
					rateOpen = false;
				};
			}}
		>
			<input type="hidden" name="findingId" value={rateDraft.id} />
			<input type="hidden" name="status" value={rateDraft.status} />
			<div class="rate-what">
				<p class="rate-title">{rateDraft.title}</p>
				<p class="muted">{rateDraft.status === 'confirmed' ? i.t('review.confirmHelp') : i.t('review.dismissHelp')}</p>
			</div>
			{#if rateError}<p class="notice error" role="alert">{rateError}</p>{/if}
			<label class="field">
				<span>{rateDraft.status === 'confirmed' ? i.t('review.confirmReason') : i.t('review.dismissReason')}</span>
				<textarea
					name="comment"
					rows="4"
					value={rateDraft.comment}
					placeholder={rateDraft.status === 'confirmed' ? i.t('review.confirmReasonPlaceholder') : i.t('review.dismissReasonPlaceholder')}
					onkeydown={submitOnCmdEnter}
				></textarea>
				<small>{rateDraft.status === 'confirmed' ? i.t('review.confirmReasonHint') : i.t('review.dismissReasonHint')}</small>
			</label>
		</form>
	{/if}
	{#snippet footer()}
		<span class="spacer"></span>
		<button type="button" class="btn ghost" onclick={() => (rateOpen = false)}>{i.t('common.cancel')}</button>
		<button type="submit" form="rate-form" class="btn primary" disabled={rateBusy}>
			{rateDraft?.status === 'dismissed' ? i.t('review.dismiss') : i.t('review.confirm')}
		</button>
	{/snippet}
</Modal>

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
	.head-tools[hidden] {
		display: none;
	}
	.head-tools {
		display: flex;
		align-items: center;
		gap: 0.5rem 1rem;
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
	.finding.dismissed > :not(.note, .rate, .dev-form) {
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
	.rate {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		padding-top: 0.6rem;
		margin-top: 0.15rem;
		border-top: 1px solid var(--rule);
	}
	.dev-form {
		display: grid;
		gap: 0.5rem;
	}
	.dev-form textarea {
		min-height: 4.5rem;
		max-height: 14rem;
		field-sizing: content;
	}
	.linkish {
		margin-left: auto;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-xs);
		color: var(--ink-3);
		cursor: pointer;
	}
	.linkish:hover {
		color: var(--accent);
	}
	.rate-what {
		display: grid;
		gap: 0.25rem;
	}
	.rate-title {
		font-weight: 500;
	}
	.note {
		display: grid;
		gap: 0.2rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--rule);
		border-left: 2px solid var(--ink-3);
		border-radius: var(--radius-s);
		background: var(--sunken);
	}
	.note.confirmed {
		border-left-color: var(--pass);
	}
	.note.dev {
		border-left-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 4%, var(--sheet));
	}
	.note-head :global(svg) {
		align-self: center;
		color: var(--accent);
	}
	.note p {
		margin: 0;
	}
	.note-head {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.note-head strong {
		color: var(--ink);
		font-weight: 500;
	}
	.note-body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.rate-buttons {
		display: flex;
		gap: 0.35rem;
		margin-left: auto;
	}
	.btn.on {
		background: var(--pass-soft);
		border-color: color-mix(in srgb, var(--pass) 50%, transparent);
		color: var(--pass);
	}
	.btn.on-dismiss {
		background: var(--sunken);
		border-color: var(--ink-3);
	}
	.issue-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: var(--text-sm);
	}
	.issue-row .notice {
		margin: 0;
	}
	.rated {
		min-width: 0;
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
