<script lang="ts">
	import { enhance } from '$app/forms';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import { invalidateAll } from '$app/navigation';
	import Severity from '#lib/components/Severity.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { isActive } from '#lib/labels.js';
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
	let showDismissed = $state(true);
	// Findings whose saved reason is open for editing; the others show it as a comment.
	let editing = $state(new Set<string>());
	function stopEditing(id: string) {
		const next = new Set(editing);
		next.delete(id);
		editing = next;
	}
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

	let lightbox: { url: string; label: string } | null = $state(null);
	let dialog: HTMLDialogElement | undefined = $state();
	function openEvidence(url: string, label: string) {
		lightbox = { url, label };
		dialog?.showModal();
	}
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
	{/if}
</div>

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
		{#if active && data.human}
			<HumanTakeover src="/reviews/{data.review.id}/live" requestId={data.human.id} reason={data.human.reason} url={review.instanceUrl} />
		{:else if active}
			<LiveView src="/reviews/{data.review.id}/live" url={review.instanceUrl} />
		{/if}

		{#if isActive(data.review.status) || data.events.length > 0}
			<LiveLog
				streamUrl="/reviews/{data.review.id}/events"
				events={data.events}
				active={isActive(data.review.status)}
				onstatus={(s) => (liveStatus = s)}
				online={(line) => /^Mensch (gebraucht|fertig):/.test(line) && invalidateAll()}
			/>
		{/if}

		{#if report}
			{#if report.summaryHtml}
				<section class="block">
					<h2>{i.t('review.summary')}</h2>
					<div class="prose">{@html report.summaryHtml}</div>
				</section>
			{/if}

			{#if data.tests.length}
				<section class="block">
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

			<section class="block">
				<h2>{i.t('review.acceptanceCriteria')}</h2>
				{#if report.acceptanceCriteria.length}
					<ul class="ac sheet">
						{#each report.acceptanceCriteria as ac, idx (idx)}
							<li class={ac.status}>
								<span class="ac-status">{i.labels.ac[ac.status]}</span>
								<div>
									<p class="criterion">{ac.criterion}</p>
									{#if ac.notes}<p class="faint">{ac.notes}</p>{/if}
									{#if ac.evidenceIds.length}
										<p class="ev-links">
											{#each ac.evidenceIds as eid (eid)}
												{@const ev = report.evidence[eid]}
												{#if ev?.url}
													<button type="button" class="linkish" onclick={() => openEvidence(ev.url!, ev.label)}>{eid} {ev.label}</button>
												{:else if ev?.expired}
													<span class="faint" title={i.t('review.screenshotsExpire')}>{eid} {ev.label} {i.t('review.deleted')}</span>
												{/if}
											{/each}
										</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted">{i.t('review.noAcRated')}</p>
				{/if}
			</section>

			<section class="block">
				<div class="block-head">
					<h2>{i.t('review.findings')}</h2>
					{#if counts.dismissed > 0}
						<label class="check small">
							<input type="checkbox" bind:checked={showDismissed} />
							<span>{i.t('review.showDismissed', { n: counts.dismissed })}</span>
						</label>
					{/if}
				</div>
				{#if report.findings.length === 0}
					<p class="muted">{i.t('review.noFindings')}</p>
				{/if}
				{#each report.findings as f (f.id)}
					{#if showDismissed || f.rating.status !== 'dismissed'}
						<article class="finding sheet {f.rating.status}" class:blocking={f.blocking}>
							<header>
								<Severity severity={f.severity} />
								<span class="cat">{i.labels.category[f.category] ?? f.category}</span>
								{#if f.blocking}<span class="blk">{i.t('review.blocksApproval')}</span>{/if}
								<span class="fid faint">{f.id}</span>
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
								<div class="thumbs">
									{#each f.evidenceIds as eid (eid)}
										{@const ev = report.evidence[eid]}
										{#if ev?.url && ev.kind === 'screenshot'}
											<button type="button" class="thumb" onclick={() => openEvidence(ev.url!, ev.label)}>
												<img src={ev.url} alt={ev.label} loading="lazy" />
												<span>{eid} {ev.label}</span>
											</button>
										{:else if ev?.expired}
											<div class="shot-expired" title={i.t('review.screenshotsExpire')}>
												<span>{i.t('review.screenshotDeleted')}</span>
												<span class="faint">{eid} {ev.label}</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							{#if f.rating.comment && f.rating.status !== 'proposed' && !editing.has(f.id)}
								<div class="note {f.rating.status}">
									<p class="note-head">
										<strong>{f.rating.by ?? i.t('review.unknownUser')}</strong>
										<span>{f.rating.status === 'confirmed' ? i.t('review.hasConfirmed') : i.t('review.hasDismissed')}</span>
										{#if f.rating.at}<span class="faint">· {i.formatDate(f.rating.at)}</span>{/if}
									</p>
									<p class="note-body">{f.rating.comment}</p>
								</div>
							{/if}

							<form
								method="POST"
								action="?/rate"
								class="rate"
								use:enhance={() =>
									async ({ result, update }) => {
										await update({ reset: false });
										if (result.type === 'success') stopEditing(f.id);
									}}
							>
								<input type="hidden" name="findingId" value={f.id} />
								{#if f.rating.comment && !editing.has(f.id)}
									<input type="hidden" name="comment" value={f.rating.comment} />
								{:else}
									<label class="comment">
										<span class="visually-hidden">{i.t('review.commentOn', { id: f.id })}</span>
										<textarea name="comment" rows="2" value={f.rating.comment} placeholder={i.t('review.reasonPlaceholder')}></textarea>
									</label>
								{/if}
								<div class="rate-buttons" role="group" aria-label={i.t('review.rating')}>
									<button class="btn small" class:on={f.rating.status === 'confirmed'} name="status" value="confirmed" aria-pressed={f.rating.status === 'confirmed'}>
										{i.t('review.confirm')}
									</button>
									<button class="btn small" class:on-dismiss={f.rating.status === 'dismissed'} name="status" value="dismissed" aria-pressed={f.rating.status === 'dismissed'}>
										{i.t('review.dismiss')}
									</button>
									{#if f.rating.status !== 'proposed'}
										<button class="btn small" name="status" value="proposed">{i.t('review.reset')}</button>
									{/if}
									{#if f.rating.comment && !editing.has(f.id)}
										<button type="button" class="btn small" onclick={() => (editing = new Set(editing).add(f.id))}>{i.t('review.editReason')}</button>
									{/if}
								</div>
								{#if f.rating.by && !(f.rating.comment && f.rating.status !== 'proposed')}
									<p class="faint rated">
										{i.t(f.rating.status === 'confirmed' ? 'review.confirmedBy' : f.rating.status === 'dismissed' ? 'review.dismissedBy' : 'review.resetBy', { user: f.rating.by })}{f.rating.at ? `, ${i.formatDate(f.rating.at)}` : ''}
									</p>
								{/if}
							</form>
						</article>
					{/if}
				{/each}
			</section>

			{#if !review.fixture && review.status !== 'queued' && review.status !== 'running'}
				<section class="block comment">
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
				<section class="block">
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
			</div>
		{/if}
	</aside>
</div>

<dialog bind:this={dialog} class="lightbox" onclose={() => (lightbox = null)} onclick={(e) => e.target === dialog && dialog?.close()}>
	{#if lightbox}
		<figure>
			<img src={lightbox.url} alt={lightbox.label} />
			<figcaption>
				{lightbox.label}
				<a href={lightbox.url} target="_blank" rel="noopener noreferrer">{i.t('review.openInNewTab')}</a>
				<button class="btn small" type="button" onclick={() => dialog?.close()}>{i.t('review.close')}</button>
			</figcaption>
		</figure>
	{/if}
</dialog>

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
	.ac-status {
		display: inline-flex;
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
	.criterion {
		font-weight: 500;
	}
	.ev-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		margin-top: 0.25rem;
	}
	.linkish {
		font: inherit;
		font-size: var(--text-xs);
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
	}
	.linkish:hover {
		text-decoration: underline;
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
	.finding.dismissed > :not(.note, .rate) {
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
	.thumbs {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.thumb {
		display: grid;
		gap: 0.25rem;
		width: 10rem;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: var(--sheet);
		cursor: zoom-in;
		font: inherit;
		font-size: var(--text-xs);
		color: var(--ink-2);
		text-align: left;
		overflow: hidden;
	}
	.thumb:hover {
		border-color: var(--rule-strong);
	}
	.thumb img {
		width: 100%;
		aspect-ratio: 16 / 10;
		object-fit: cover;
		object-position: top;
		display: block;
		border-bottom: 1px solid var(--rule);
	}
	.thumb span {
		padding: 0 0.45rem 0.35rem;
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
	.comment {
		flex: 1;
		min-width: 12rem;
	}
	.comment textarea {
		width: 100%;
		min-height: var(--control-h);
		max-height: 12rem;
		padding: 0.3rem 0.5rem;
		font: inherit;
		font-size: var(--text-sm);
		resize: vertical;
		field-sizing: content;
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
	.rated {
		width: 100%;
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
	.downloads {
		display: grid;
		gap: 0.3rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--rule);
	}

	.lightbox {
		border: 0;
		padding: 0;
		max-width: min(92vw, 1280px);
		max-height: 92vh;
		background: var(--raised);
		color: var(--ink);
		border-radius: var(--radius-l);
		box-shadow: var(--shadow-pop);
	}
	.lightbox::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}
	.lightbox figure {
		margin: 0;
	}
	.lightbox img {
		display: block;
		max-width: 100%;
		max-height: calc(92vh - 4rem);
	}
	.lightbox figcaption {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		flex-wrap: wrap;
	}
	.lightbox figcaption .btn {
		margin-left: auto;
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
