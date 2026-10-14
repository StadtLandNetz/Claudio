<script lang="ts">
	import { enhance } from '$app/forms';
	import LiveLog from '#lib/components/LiveLog.svelte';
	import HumanTakeover from '#lib/components/HumanTakeover.svelte';
	import LiveView from '#lib/components/LiveView.svelte';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import { invalidateAll } from '$app/navigation';
	import Severity from '#lib/components/Severity.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import {
		AC_LABEL,
		BUDGET_LABEL,
		CATEGORY_LABEL,
		STATUS_LABEL,
		STRICTNESS_LABEL,
		VERDICT_LABEL,
		formatDate,
		formatDuration,
		formatUsd,
		isActive
	} from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
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

<p class="crumb"><a href="/repos/{review.repo}?tab=reviews">Alle Reviews</a></p>
<div class="title">
	<h1>#{review.prNumber} {review.prTitle ?? ''}</h1>
	{#if active}
		<form method="POST" action="?/abort" use:enhance>
			<button class="btn danger" type="submit" disabled={review.abortRequested}>
				{review.abortRequested ? 'Wird abgebrochen …' : 'Review abbrechen'}
			</button>
		</form>
	{/if}
</div>

{#if report}
	<!-- The verdict: the one loud element on the page. -->
	<section class="stamp {report.verdict}" aria-label="Urteil">
		<div class="verdict">
			<p class="word">{VERDICT_LABEL[report.verdict]}</p>
			<p class="why">
				{acPassed} von {report.acceptanceCriteria.length} Akzeptanzkriterien erfüllt,
				{counts.blocking === 0 ? 'kein blockierendes Finding' : counts.blocking === 1 ? 'ein blockierendes Finding' : `${counts.blocking} blockierende Findings`}{#if data.tests.length},
					{testsActive ? `Regressionstests laufen (${testsPassed} von ${data.tests.length} bestanden)` : `${testsPassed} von ${data.tests.length} Regressionstests bestanden`}{/if}{#if review.status !== 'completed'}, Run: {STATUS_LABEL[review.status]}{/if}.
			</p>
		</div>
		<form class="strict" method="GET">
			<label>
				<span>Strenge</span>
				<select name="strictness" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
					{#each Object.entries(STRICTNESS_LABEL) as [value, label] (value)}
						<option {value} selected={value === data.strictness}>{label}</option>
					{/each}
				</select>
			</label>
			<noscript><button class="btn small" type="submit">Anwenden</button></noscript>
		</form>
	</section>
{:else}
	<section class="pending">
		<StatusBadge status={review.status} />
		<p class="muted">
			{#if review.status === 'queued'}
				Wartet auf den Worker. Läuft kein Worker, starte ihn mit <code>pnpm worker</code>.
			{:else if review.status === 'running'}
				Claudio prüft gerade {review.instanceUrl}.
			{:else}
				Dieser Review hat keinen Bericht erzeugt.
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
					<h2>Zusammenfassung</h2>
					<div class="prose">{@html report.summaryHtml}</div>
				</section>
			{/if}

			{#if data.tests.length}
				<section class="block">
					<h2>Regressionstests</h2>
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
				<h2>Akzeptanzkriterien</h2>
				{#if report.acceptanceCriteria.length}
					<ul class="ac sheet">
						{#each report.acceptanceCriteria as ac, i (i)}
							<li class={ac.status}>
								<span class="ac-status">{AC_LABEL[ac.status]}</span>
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
													<span class="faint" title="Screenshots werden nach 14 Tagen gelöscht">{eid} {ev.label} (gelöscht)</span>
												{/if}
											{/each}
										</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted">Claudio hat keine Akzeptanzkriterien bewertet.</p>
				{/if}
			</section>

			<section class="block">
				<div class="block-head">
					<h2>Findings</h2>
					{#if counts.dismissed > 0}
						<label class="check small">
							<input type="checkbox" bind:checked={showDismissed} />
							<span>Verworfene zeigen ({counts.dismissed})</span>
						</label>
					{/if}
				</div>
				{#if report.findings.length === 0}
					<p class="muted">Keine Findings.</p>
				{/if}
				{#each report.findings as f (f.id)}
					{#if showDismissed || f.rating.status !== 'dismissed'}
						<article class="finding sheet {f.rating.status}" class:blocking={f.blocking}>
							<header>
								<Severity severity={f.severity} />
								<span class="cat">{CATEGORY_LABEL[f.category] ?? f.category}</span>
								{#if f.blocking}<span class="blk">blockiert die Abnahme</span>{/if}
								<span class="fid faint">{f.id}</span>
							</header>
							<h3>{f.title}</h3>
							<p class="desc">{f.description}</p>
							{#if f.steps.length}
								<ol class="steps">
									{#each f.steps as step, i (i)}<li>{step}</li>{/each}
								</ol>
							{/if}
							{#if f.expected || f.actual}
								<dl class="ea">
									{#if f.expected}<dt>Erwartet</dt><dd>{f.expected}</dd>{/if}
									{#if f.actual}<dt>Beobachtet</dt><dd>{f.actual}</dd>{/if}
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
											<div class="shot-expired" title="Screenshots werden nach 14 Tagen gelöscht">
												<span>Screenshot gelöscht</span>
												<span class="faint">{eid} {ev.label}</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							<form method="POST" action="?/rate" class="rate" use:enhance={() => ({ update }) => update({ reset: false })}>
								<input type="hidden" name="findingId" value={f.id} />
								<label class="comment">
									<span class="visually-hidden">Kommentar zu {f.id}</span>
									<input type="text" name="comment" value={f.rating.comment} placeholder="Begründung (beim Verwerfen merkt sich Claudio sie)" />
								</label>
								<div class="rate-buttons" role="group" aria-label="Bewertung">
									<button class="btn small" class:on={f.rating.status === 'confirmed'} name="status" value="confirmed" aria-pressed={f.rating.status === 'confirmed'}>
										Bestätigen
									</button>
									<button class="btn small" class:on-dismiss={f.rating.status === 'dismissed'} name="status" value="dismissed" aria-pressed={f.rating.status === 'dismissed'}>
										Verwerfen
									</button>
									{#if f.rating.status !== 'proposed'}
										<button class="btn small" name="status" value="proposed">Zurücksetzen</button>
									{/if}
								</div>
								{#if f.rating.by}
									<p class="faint rated">
										{f.rating.status === 'confirmed' ? 'Bestätigt' : f.rating.status === 'dismissed' ? 'Verworfen' : 'Zurückgesetzt'} von {f.rating.by}{f.rating.at ? `, ${formatDate(f.rating.at)}` : ''}
									</p>
								{/if}
							</form>
						</article>
					{/if}
				{/each}
			</section>

			{#if !review.fixture && review.status !== 'queued' && review.status !== 'running'}
				<section class="block comment">
					<h2>Kommentar im Pull Request</h2>
					{#if commentUrl}
						<p class="notice ok">Kurzfassung gepostet. <a href={commentUrl} target="_blank" rel="noopener noreferrer">Kommentar auf GitHub öffnen</a></p>
					{:else}
						<p class="muted">
							Bewerte die Findings zuerst. Der Kommentar übernimmt die Strenge von oben und lässt verworfene Findings weg.
						</p>
					{/if}
					{#if commentError}<p class="notice error" role="alert">{commentError}</p>{/if}
					<details class="sheet preview">
						<summary>Vorschau</summary>
						<div class="prose">{@html data.commentPreview}</div>
					</details>
					<form method="POST" action="?/comment" use:enhance={() => { posting = true; return async ({ update }) => { await update({ reset: false }); posting = false; }; }}>
						<input type="hidden" name="strictness" value={data.strictness} />
						<button class="btn {commentUrl ? '' : 'primary'}" type="submit" disabled={posting}>
							{posting ? 'Wird gepostet …' : commentUrl ? 'Aktualisierte Kurzfassung erneut posten' : 'Kurzfassung in den PR posten'}
						</button>
					</form>
				</section>
			{/if}

			{#if report.errors.length}
				<section class="block">
					<h2>Probleme während des Runs</h2>
					<ul class="errors">
						{#each report.errors as err, i (i)}<li>{err}</li>{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</div>

	<aside class="meta">
		<dl>
			<dt>Status</dt>
			<dd><StatusBadge status={review.status} verdict={report?.verdict ?? null} /></dd>
			{#if report}
				<dt>Pull Request</dt>
				<dd><a href={report.pr.url} target="_blank" rel="noopener noreferrer">#{report.pr.number}</a> {report.pr.headRef} nach {report.pr.baseRef}</dd>
				{#if report.issues.length}
					<dt>Tickets</dt>
					<dd>
						{#each report.issues as issue (issue.number)}
							<a href={issue.url} target="_blank" rel="noopener noreferrer">#{issue.number} {issue.title}</a><br />
						{/each}
					</dd>
				{/if}
			{/if}
			<dt>Instanz</dt>
			<dd class="break">{review.instanceUrl}</dd>
			<dt>Rollen</dt>
			<dd>{review.request.roles.join(', ') || 'keine'}</dd>
			<dt>Budget</dt>
			<dd>{BUDGET_LABEL[review.request.budget]}</dd>
			{#if report}
				<dt>Kosten</dt>
				<dd>
					{formatUsd(report.cost.usd)}<br />
					<span class="faint">
						{report.cost.turns} Züge, {report.cost.browserSteps} Browser-Schritte, {formatDuration(report.cost.durationMs)}
					</span>
				</dd>
			{/if}
			<dt>Gestartet</dt>
			<dd>
				{formatDate(review.createdAt)}<br />
				<span class="faint">
					{review.trigger === 'comment' ? `per Kommentar /claudio review, im Namen von ${review.startedBy}` : review.trigger === 'label' ? `per Label claudio-review, im Namen von ${review.startedBy}` : review.trigger === 'push' ? `automatisch nach Push, im Namen von ${review.startedBy}` : review.trigger === 'deployment' ? `automatisch nach Bereitstellung der Instanz, im Namen von ${review.startedBy}` : `von ${review.startedBy}`}
				</span>
			</dd>
			{#if review.finishedAt}
				<dt>Beendet</dt>
				<dd>{formatDate(review.finishedAt)}</dd>
			{/if}
			{#if commentUrl}
				<dt>PR-Kommentar</dt>
				<dd><a href={commentUrl} target="_blank" rel="noopener noreferrer">auf GitHub</a></dd>
			{/if}
			{#if review.fixture}
				<dt>Quelle</dt>
				<dd>Demo-Fixture statt GitHub</dd>
			{/if}
		</dl>
		{#if report}
			<div class="downloads">
				<span class="faint">Bericht herunterladen</span>
				<a href="/reviews/{review.id}/report.md?verbosity=tldr&strictness={data.strictness}">Kurzfassung (Markdown)</a>
				<a href="/reviews/{review.id}/report.md?verbosity=normal&strictness={data.strictness}">Normal (Markdown)</a>
				<a href="/reviews/{review.id}/report.md?verbosity=detailed&strictness={data.strictness}">Ausführlich (Markdown)</a>
				{#if report.files.trace}<a href={report.files.trace}>Playwright-Trace</a>{/if}
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
				<a href={lightbox.url} target="_blank" rel="noopener noreferrer">In neuem Tab öffnen</a>
				<button class="btn small" type="button" onclick={() => dialog?.close()}>Schließen</button>
			</figcaption>
		</figure>
	{/if}
</dialog>

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
		margin-bottom: 1.25rem;
	}
	.title h1 {
		max-width: 46rem;
	}

	/* Verdict stamp */
	.stamp {
		--tone: var(--hint);
		--tone-soft: var(--hint-soft);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem 2rem;
		flex-wrap: wrap;
		padding: 1.25rem 1.5rem;
		border: 2px solid var(--tone);
		border-left-width: 10px;
		border-radius: var(--radius-m);
		background: var(--tone-soft);
		margin-bottom: 2rem;
	}
	.stamp.approve {
		--tone: var(--pass);
		--tone-soft: var(--pass-soft);
	}
	.stamp.request_changes {
		--tone: var(--block);
		--tone-soft: var(--block-soft);
	}
	.word {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1.05;
		color: var(--tone);
	}
	.why {
		margin-top: 0.35rem;
		color: var(--ink);
	}
	.strict label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--ink-2);
	}
	.strict select {
		width: auto;
		background: var(--sheet);
	}
	.pending {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 17rem;
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
	.block-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.check.small {
		font-size: 0.875rem;
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
		padding: 0.7rem 1rem;
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
		grid-template-columns: 7.5rem minmax(0, 1fr);
		gap: 1rem;
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--rule);
	}
	.ac li:last-child {
		border-bottom: 0;
	}
	.ac-status {
		font-weight: 700;
		font-size: 0.875rem;
		color: var(--hint);
	}
	.ac .passed .ac-status {
		color: var(--pass);
	}
	.ac .failed .ac-status {
		color: var(--block);
	}
	.ac .blocked .ac-status {
		color: var(--major);
	}
	.criterion {
		font-weight: 600;
	}
	.ev-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		margin-top: 0.25rem;
	}
	.linkish {
		font: inherit;
		font-size: 0.875rem;
		background: none;
		border: 0;
		padding: 0;
		color: var(--petrol);
		text-decoration: underline;
		text-underline-offset: 0.18em;
		cursor: pointer;
	}

	/* Findings */
	.finding {
		padding: 1.1rem 1.25rem;
		display: grid;
		gap: 0.6rem;
	}
	.finding.blocking {
		border-left: 4px solid var(--block);
	}
	.finding.dismissed {
		opacity: 0.6;
	}
	.finding.dismissed h3 {
		text-decoration: line-through;
	}
	.finding header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.cat {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-2);
	}
	.blk {
		font-size: 0.8125rem;
		color: var(--block);
		font-weight: 600;
	}
	.fid {
		margin-left: auto;
	}
	.desc {
		max-width: 46rem;
	}
	.steps {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.9375rem;
	}
	.ea {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.25rem 1rem;
		margin: 0;
		font-size: 0.9375rem;
	}
	.ea dt {
		font-weight: 600;
		color: var(--ink-2);
	}
	.ea dd {
		margin: 0;
	}
	.url {
		word-break: break-all;
	}
	.thumbs {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.thumb {
		display: grid;
		gap: 0.3rem;
		width: 11rem;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-s);
		background: var(--sheet);
		cursor: zoom-in;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--ink-2);
		text-align: left;
		overflow: hidden;
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
		padding: 0 0.5rem 0.4rem;
	}
	.rate {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		padding-top: 0.75rem;
		margin-top: 0.25rem;
		border-top: 1px dashed var(--rule);
	}
	.comment {
		flex: 1;
		min-width: 12rem;
	}
	.comment input {
		padding: 0.35rem 0.55rem;
		font-size: 0.875rem;
	}
	.rate-buttons {
		display: flex;
		gap: 0.4rem;
	}
	.btn.on {
		background: var(--pass-soft);
		border-color: var(--pass);
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
	}
	.preview summary {
		padding: 0.6rem 1rem;
		cursor: pointer;
		font-weight: 600;
	}
	.preview .prose {
		padding: 0.25rem 1rem 1rem;
		font-size: 0.9375rem;
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
		font-size: 0.9375rem;
		display: grid;
		gap: 1.25rem;
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
	.downloads {
		display: grid;
		gap: 0.35rem;
		padding-top: 1rem;
		border-top: 1px solid var(--rule);
	}

	.lightbox {
		border: 0;
		padding: 0;
		max-width: min(92vw, 1280px);
		max-height: 92vh;
		background: var(--sheet);
		color: var(--ink);
		border-radius: var(--radius-m);
	}
	.lightbox::backdrop {
		background: rgba(10, 16, 15, 0.7);
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
		padding: 0.6rem 1rem;
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
	}
	@media (max-width: 560px) {
		.ac li {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
