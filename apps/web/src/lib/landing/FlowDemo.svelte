<script lang="ts">
	import Severity from '#lib/components/Severity.svelte';
	import { i18n, type MessageKey } from '#lib/i18n/index.js';
	import { APP_TEXT, BLOCKER, BROWSER_BEATS, CRITERIA, FIRST_RUN_FINDINGS, PR, TESTS, fileLabel, outcome, selectTests } from './scenario.js';

	/**
	 * The five steps of a review, played one after the other on the example pull
	 * request. Plays while it is on screen; a click on a step stops it there.
	 */
	const i = i18n();
	const STEPS: { title: MessageKey; text: MessageKey; ms: number }[] = [
		{ title: 'landing.step1Title', text: 'landing.step1Text', ms: 4500 },
		{ title: 'landing.step2Title', text: 'landing.step2Text', ms: 5500 },
		{ title: 'landing.step3Title', text: 'landing.step3Text', ms: 5500 },
		{ title: 'landing.step4Title', text: 'landing.step4Text', ms: 8800 },
		{ title: 'landing.step5Title', text: 'landing.step5Text', ms: 7000 }
	];

	let active = $state(0);
	let elapsed = $state(STEPS[0]!.ms);
	let playing = $state(false);
	let visible = $state(false);
	let root: HTMLElement | undefined = $state();
	const tabs: HTMLButtonElement[] = [];

	// How far the current step has played, 0 to 1; a step chosen by hand shows its end.
	const progress = $derived(Math.min(1, elapsed / STEPS[active]!.ms));
	const shown = (from: number) => progress >= from;

	$effect(() => {
		if (!root) return;
		if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
			playing = true;
			elapsed = 0;
		}
		const observer = new IntersectionObserver(([entry]) => (visible = entry!.isIntersecting), { threshold: 0.35 });
		observer.observe(root);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!playing || !visible) return;
		let last = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			elapsed += now - last;
			last = now;
			if (elapsed >= STEPS[active]!.ms + 600) {
				active = (active + 1) % STEPS.length;
				elapsed = 0;
			}
		}, 80);
		return () => clearInterval(timer);
	});

	function select(k: number, focus = false) {
		active = (k + STEPS.length) % STEPS.length;
		elapsed = STEPS[active]!.ms;
		playing = false;
		if (focus) tabs[active]?.focus();
	}
	function toggle() {
		if (!playing && elapsed >= STEPS[active]!.ms) {
			active = (active + 1) % STEPS.length;
			elapsed = 0;
		}
		playing = !playing;
	}
	function onKey(e: KeyboardEvent) {
		const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
		if (!delta) return;
		e.preventDefault();
		select(active + delta, true);
	}

	// Step 3: the example's impact, computed.
	const { impact, selection } = selectTests(PR.files.map((f) => f.path));
	const chosen = new Set(selection.selected.map((t) => t.id));

	// Step 4: the browser beat on screen; the typed text grows within its beat.
	const beat = $derived(Math.min(BROWSER_BEATS.length - 1, Math.floor(progress * BROWSER_BEATS.length)));
	const now = $derived(BROWSER_BEATS[beat]!);
	const withinBeat = $derived(progress * BROWSER_BEATS.length - beat);
	const typed = (text: string, k: number) => (beat > k ? text : beat === k ? text.slice(0, Math.ceil(text.length * Math.min(1, withinBeat * 1.6))) : '');
	const findingAt = BROWSER_BEATS.findIndex((b) => b.outcome === 'fail');

	const result = $derived(outcome(i.locale, CRITERIA.map((c) => c.status), FIRST_RUN_FINDINGS, 'normal'));
	const app = $derived(APP_TEXT[i.locale]);
</script>

<div class="flow" bind:this={root}>
	<div class="rail">
		<div class="steps" role="tablist" aria-label={i.t('landing.stepsLabel')} tabindex="-1" onkeydown={onKey}>
			{#each STEPS as step, k (k)}
				<button
					bind:this={tabs[k]}
					type="button"
					role="tab"
					id="flow-tab-{k}"
					aria-selected={active === k}
					aria-controls="flow-stage"
					tabindex={active === k ? 0 : -1}
					class:done={k < active}
					onclick={() => select(k)}
				>
					<span class="n" aria-hidden="true">{k + 1}</span>
					<span class="copy">
						<span class="t">{i.t(step.title)}</span>
						<span class="d">{i.t(step.text)}</span>
					</span>
					{#if active === k}<span class="bar" style="--p: {progress}" aria-hidden="true"></span>{/if}
				</button>
			{/each}
		</div>
		<button type="button" class="play" onclick={toggle} aria-pressed={playing}>
			{#if playing}
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
				{i.t('landing.pause')}
			{:else}
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 2.5v11l9-5.5z" /></svg>
				{i.t('landing.play')}
			{/if}
		</button>
	</div>

	<div class="stage" id="flow-stage" role="tabpanel" aria-labelledby="flow-tab-{active}">
		{#if active === 0}
			<div class="pane pr">
				<p class="head">
					<b>{PR.title[i.locale]}</b> <span class="faint">#{PR.number}</span>
				</p>
				<p class="faint small"><code>{PR.branch}</code> → <code>main</code></p>
				<div class="box">
					<p class="label">{i.t('landing.changedFiles')}</p>
					<ul class="files">
						{#each PR.files as f, k (f.path)}
							<li class:in={shown(0.12 + k * 0.14)}>
								<code>{f.path}</code>
								<span class="diff"><span class="add">+{f.additions}</span> <span class="del">−{f.deletions}</span></span>
							</li>
						{/each}
					</ul>
				</div>
				<div class="box issue" class:in={shown(0.6)}>
					<p class="label">{i.t('landing.linkedIssue')} <span class="faint">#{PR.issue.number}</span></p>
					<p><b>{PR.issue.title[i.locale]}</b></p>
					<p class="muted">{PR.issue.body[i.locale]}</p>
				</div>
			</div>
		{:else if active === 1}
			<div class="pane">
				<p class="head">
					<b>{i.t('landing.criteria')}</b>
					<span class="chip">{i.t('landing.criteriaEditable')}</span>
				</p>
				<ol class="criteria">
					{#each CRITERIA as c, k (k)}
						<li class:in={shown(0.08 + k * 0.12)}>
							<span class="box-mark" aria-hidden="true"></span>
							<span>{c.text[i.locale]}</span>
						</li>
					{/each}
				</ol>
			</div>
		{:else if active === 2}
			<div class="pane impact">
				<div class="cols">
					<div>
						<p class="label">{i.t('landing.changedFiles')}</p>
						<ul class="chips">
							{#each PR.files as f (f.path)}
								<li class="file"><code>{fileLabel(f.path)}</code></li>
							{/each}
						</ul>
					</div>
					<span class="arrow" class:in={shown(0.2)} aria-hidden="true">→</span>
					<div class:in={shown(0.25)} class="fade">
						<p class="label">{i.t('landing.affectedRoutes')}</p>
						<ul class="chips">
							{#each impact.routes as r (r.pattern)}
								<li class="route">
									<code>{r.pattern}</code>
									<span class="faint small">{r.kind === 'endpoint' ? i.t('landing.routeEndpoint') : r.direct ? i.t('landing.routeDirect') : i.t('landing.routeShared')}</span>
								</li>
							{/each}
						</ul>
					</div>
				</div>
				<div class="box tests fade" class:in={shown(0.5)}>
					<p class="label">
						{i.t('landing.regressionTests')} · {i.t('landing.testsChosen', { n: chosen.size, total: TESTS.length })}
					</p>
					<ul>
						{#each TESTS as t (t.id)}
							<li class:off={!chosen.has(t.id)}>
								<span class="tick" aria-hidden="true">{chosen.has(t.id) ? '✓' : '–'}</span>
								{t.title[i.locale]}
							</li>
						{/each}
					</ul>
					<a href="#impact" class="more">{i.t('landing.tryIt')} ↓</a>
				</div>
			</div>
		{:else if active === 3}
			<div class="pane browser-pane">
				<div class="browser">
					<div class="chrome">
						<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
						<span class="url">pr-17.preview.example.com{now.url}</span>
						<span class="live">{i.t('landing.liveView')}</span>
					</div>
					<div class="viewport" aria-hidden="true">
						<div class="screen">
							<div class="appbar"><b>{app.app}</b><span>{app.overview}</span><span>{app.tasks}</span><span class="me">{now.screen === 'login' ? '' : app.user}</span></div>
							{#if now.screen === 'login'}
								<p class="h" style="top: 17%">{app.signIn}</p>
								<span class="input-x" style="top: 31%">{app.email}</span>
								<span class="input-x" style="top: 43%">••••••••</span>
								<span class="btn-x" style="top: 57%; width: 18%">{app.signIn}</span>
							{:else if now.screen === 'form'}
								<p class="h" style="top: 17%">{app.newTask}</p>
								<span class="input-x" style="top: 30%">{typed(app.newTitle, 2)}<i class="caret" class:on={beat === 2}></i></span>
								<span class="input-x faint-x" style="top: 42%">{app.date}</span>
								<span class="input-x faint-x" style="top: 54%">{app.priority}</span>
								<span class="btn-x" style="top: 70%; width: 14%">{app.send}</span>
							{:else if now.screen === 'error'}
								<div class="error">
									<b>{app.error}</b>
									<span>Cannot read properties of null (reading 'toLowerCase')</span>
									<span class="code">HTTP 500</span>
								</div>
							{:else}
								<p class="h" style="top: 17%">{app.tasks}</p>
								<span class="btn-x" style="top: 16%; left: 75%; width: 20%">{app.newTask}</span>
								{#if now.screen === 'saved'}
									<span class="ok" style="top: 28%">{app.created}</span>
								{/if}
								<span class="input-x" style="top: {now.screen === 'saved' ? 40 : 30}%">{now.screen === 'search' ? typed(app.search, 5) : ''}<i class="caret" class:on={beat === 5}></i></span>
								{#each app.rows as row, k (row.title)}
									<span class="row" style="top: {(now.screen === 'saved' ? 54 : 46) + k * 10}%"><b>{row.title}</b><span>{row.who}</span></span>
								{/each}
								{#if now.screen === 'saved'}
									<span class="row new" style="top: 74%"><b>{app.newTitle}</b><span>–</span></span>
								{/if}
							{/if}
							<svg class="cursor" style="left: {now.cursor[0]}%; top: {now.cursor[1]}%" viewBox="0 0 16 20" width="16" height="20">
								<path d="M1 1l13 10-6 1 3.5 6.5-2.5 1.3L5.5 13 1 17z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" />
							</svg>
							{#if beat === BROWSER_BEATS.length - 1 && withinBeat < 0.5 && playing}<span class="flash"></span>{/if}
						</div>
					</div>
					<div class="timeline" aria-hidden="true">
						{#each BROWSER_BEATS as _, k (k)}
							<span class:on={k <= beat} class:fail={k === findingAt}></span>
						{/each}
					</div>
				</div>
				<ol class="log" aria-label={i.t('landing.agentLog')}>
					{#each BROWSER_BEATS.slice(0, beat + 1) as b, k (k)}
						<li class:current={k === beat} class:fail={b.outcome === 'fail'}>
							<span class="mark" aria-hidden="true">{b.outcome === 'fail' ? '✕' : '✓'}</span>
							<code>{b.tool}</code>
							<span>{b.text[i.locale]}</span>
						</li>
					{/each}
				</ol>
			</div>
		{:else}
			<div class="pane report">
				<div class="verdict" class:in={shown(0.55)}>
					<span class="stamp">{i.labels.verdict[result.verdict]}</span>
					<code class="commit">{result.status}</code>
				</div>
				<div class="report-cols">
					<ol class="criteria results">
						{#each CRITERIA as c, k (k)}
							<li class="in" class:fail={c.status === 'failed'}>
								<span class="res" aria-hidden="true">{c.status === 'passed' ? '✓' : '✕'}</span>
								<span>{c.text[i.locale]}</span>
							</li>
						{/each}
					</ol>
					<article class="finding fade" class:in={shown(0.2)}>
						<Severity severity="blocker" />
						<p><b>{BLOCKER.title[i.locale]}</b></p>
						<p class="label">{i.t('landing.steps')}</p>
						<ol class="mini">
							{#each BLOCKER.steps as s, k (k)}<li>{s[i.locale]}</li>{/each}
						</ol>
						<dl>
							<dt>{i.t('landing.expected')}</dt>
							<dd>{BLOCKER.expected[i.locale]}</dd>
							<dt>{i.t('landing.observed')}</dt>
							<dd class="bad">{BLOCKER.observed[i.locale]}</dd>
						</dl>
					</article>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.flow {
		display: grid;
		grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}
	.rail {
		display: grid;
		gap: 0.75rem;
	}
	.steps {
		display: grid;
		gap: 0.25rem;
	}
	.steps button {
		position: relative;
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		text-align: left;
		font: inherit;
		color: var(--ink-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 12px;
		padding: 0.7rem 0.8rem;
		cursor: pointer;
		overflow: hidden;
	}
	.steps button:hover {
		background: var(--sunken);
	}
	.steps button[aria-selected='true'] {
		background: var(--sheet);
		border-color: var(--rule);
		color: var(--ink);
		box-shadow: var(--shadow);
	}
	.steps button:focus-visible {
		outline: 2px solid var(--brand-text);
		outline-offset: 2px;
	}
	.n {
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 0.85rem;
		background: var(--sunken);
		color: var(--ink-2);
		transition: background 0.2s;
	}
	.done .n {
		background: var(--brand-soft);
		color: var(--brand-text);
	}
	[aria-selected='true'] .n {
		background: var(--brand);
		color: var(--brand-ink);
	}
	.copy {
		display: grid;
		gap: 0.2rem;
	}
	.t {
		font-weight: 600;
	}
	.d {
		display: none;
		font-size: 0.875rem;
		color: var(--ink-2);
		line-height: 1.5;
	}
	[aria-selected='true'] .d {
		display: block;
	}
	.bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		width: calc(var(--p) * 100%);
		background: var(--brand);
	}
	.play {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-2);
		background: transparent;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		padding: 0.35rem 0.9rem;
		cursor: pointer;
		margin-left: 0.8rem;
	}
	.play:hover {
		color: var(--ink);
		border-color: var(--ink-3);
	}

	.stage {
		background: var(--sheet);
		border: 1px solid var(--rule);
		border-radius: 16px;
		box-shadow: var(--shadow);
		padding: 1.25rem;
		min-height: 27rem;
		min-width: 0;
	}
	.pane {
		display: grid;
		gap: 0.9rem;
		align-content: start;
		animation: enter 0.35s ease both;
	}
	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
	}
	.label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-3);
		margin-bottom: 0.4rem;
	}
	.small {
		font-size: 0.8125rem;
	}
	code {
		font-family: var(--mono);
		font-size: 0.8125rem;
		overflow-wrap: anywhere;
	}
	.chip {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--gold-ink);
		background: var(--gold-soft);
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
	}
	.box {
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 0.85rem 1rem;
		background: var(--paper);
	}
	.files {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.files li,
	.criteria li,
	.fade,
	.issue,
	.arrow {
		opacity: 0;
		transform: translateY(4px);
		transition:
			opacity 0.35s ease,
			transform 0.35s ease;
	}
	.files li.in,
	.criteria li.in,
	.fade.in,
	.issue.in,
	.arrow.in {
		opacity: 1;
		transform: none;
	}
	.files li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.diff {
		font-family: var(--mono);
		font-size: 0.8125rem;
		white-space: nowrap;
	}
	.add {
		color: var(--pass);
	}
	.del {
		color: var(--block);
	}
	.issue {
		display: grid;
		gap: 0.3rem;
	}

	.criteria {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.55rem;
		counter-reset: ac;
	}
	.criteria li {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		line-height: 1.45;
	}
	.box-mark {
		flex: none;
		width: 1.05rem;
		height: 1.05rem;
		margin-top: 0.15rem;
		border: 1.5px solid var(--rule-strong);
		border-radius: 4px;
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		gap: 1rem;
		align-items: center;
	}
	.arrow {
		font-size: 1.5rem;
		color: var(--brand-text);
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}
	.chips li {
		border-radius: 10px;
		padding: 0.45rem 0.7rem;
		display: grid;
		gap: 0.1rem;
	}
	.file {
		border: 1.5px solid var(--gold);
		background: var(--gold-soft);
	}
	.route {
		background: var(--brand-soft);
		border: 1.5px solid color-mix(in srgb, var(--brand) 60%, transparent);
	}
	.tests ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem 1rem;
	}
	.tests li {
		display: flex;
		gap: 0.5rem;
	}
	.tests li.off {
		color: var(--ink-3);
	}
	.tick {
		width: 1rem;
		color: var(--brand-text);
		font-weight: 700;
	}
	.off .tick {
		color: var(--ink-3);
	}
	.more {
		display: inline-block;
		margin-top: 0.6rem;
		font-weight: 600;
		color: var(--brand-text);
	}

	.browser-pane {
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		align-items: start;
	}
	.browser {
		border: 1px solid var(--rule-strong);
		border-radius: 10px;
		overflow: hidden;
		background: #fff;
	}
	.chrome {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.6rem;
		background: var(--sunken);
		border-bottom: 1px solid var(--rule);
		font-size: 0.75rem;
	}
	.dots {
		display: inline-flex;
		gap: 0.25rem;
	}
	.dots i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--rule-strong);
	}
	.url {
		flex: 1;
		min-width: 0;
		font-family: var(--mono);
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--ink-2);
		white-space: nowrap;
	}
	.live::before {
		content: '';
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--block);
	}
	.viewport {
		position: relative;
		aspect-ratio: 16 / 10;
		container-type: inline-size;
		background: #f4f6f8;
		overflow: hidden;
	}
	/* Inside the container, so cqw scales text and positions with the mini browser. */
	.screen {
		position: absolute;
		inset: 0;
		font-size: 2.3cqw;
		line-height: 1.3;
		color: #1c2533;
		font-family: system-ui, sans-serif;
	}
	.appbar {
		position: absolute;
		inset: 0 0 auto 0;
		height: 10%;
		display: flex;
		align-items: center;
		gap: 3%;
		padding: 0 4%;
		background: #1b2f4e;
		color: #fff;
	}
	.appbar span {
		text-decoration: underline;
		opacity: 0.9;
	}
	.appbar .me {
		margin-left: auto;
		text-decoration: none;
	}
	.viewport .h {
		position: absolute;
		left: 5%;
		font-size: 1.5em;
		font-weight: 700;
	}
	.input-x,
	.btn-x,
	.row,
	.ok {
		position: absolute;
		left: 5%;
		display: flex;
		align-items: center;
	}
	.input-x {
		width: 40%;
		height: 8%;
		padding: 0 1.5%;
		background: #fff;
		border: 1px solid #b8c0cc;
		border-radius: 0.3em;
	}
	.faint-x {
		color: #9aa3af;
	}
	.caret {
		display: none;
		width: 1px;
		height: 60%;
		background: #1c2533;
		margin-left: 1px;
	}
	.caret.on {
		display: inline-block;
		animation: blink 0.8s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	.btn-x {
		height: 8%;
		justify-content: center;
		background: #1b2f4e;
		color: #fff;
		border-radius: 0.3em;
		font-weight: 600;
	}
	.row {
		width: 90%;
		height: 9%;
		justify-content: space-between;
		gap: 1em;
		padding: 0 1.5%;
		border-bottom: 1px solid #dfe3e8;
	}
	.row.new {
		background: #eafaf5;
	}
	.ok {
		width: 40%;
		height: 8%;
		padding: 0 1.5%;
		background: #e3f5ea;
		color: #1f7a4d;
		border-radius: 0.3em;
		font-weight: 600;
	}
	.error {
		position: absolute;
		inset: 22% 8% auto 8%;
		display: grid;
		gap: 0.6em;
		padding: 4%;
		background: #fdecec;
		border: 1px solid #e5a3a5;
		border-radius: 0.5em;
		color: #9f1d22;
	}
	.error b {
		font-size: 1.5em;
	}
	.error .code {
		font-family: var(--mono);
		font-weight: 700;
	}
	.cursor {
		position: absolute;
		width: 4.5cqw;
		height: auto;
		transform: translate(-15%, -10%);
		transition:
			left 0.6s cubic-bezier(0.4, 0, 0.2, 1),
			top 0.6s cubic-bezier(0.4, 0, 0.2, 1);
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
	}
	.flash {
		position: absolute;
		inset: 0;
		background: #fff;
		animation: flash 0.5s ease-out both;
	}
	@keyframes flash {
		from {
			opacity: 0.9;
		}
		to {
			opacity: 0;
		}
	}
	.timeline {
		display: flex;
		gap: 3px;
		padding: 0.45rem 0.6rem;
		background: var(--sunken);
		border-top: 1px solid var(--rule);
	}
	.timeline span {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: var(--rule-strong);
		transition: background 0.3s;
	}
	.timeline span.on {
		background: var(--brand);
	}
	.timeline span.on.fail {
		background: var(--block);
	}
	.log {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
		font-size: 0.8125rem;
		align-content: start;
	}
	.log li {
		display: grid;
		grid-template-columns: 1rem auto;
		column-gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		color: var(--ink-2);
		animation: enter 0.3s ease both;
	}
	.log li span:last-child {
		grid-column: 2;
	}
	.log li.current {
		background: var(--sunken);
		color: var(--ink);
	}
	.log .mark {
		color: var(--brand-text);
		font-weight: 700;
	}
	.log li.fail .mark {
		color: var(--block);
	}
	.log code {
		font-size: 0.75rem;
		color: var(--ink-3);
	}

	.verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		opacity: 0;
		transform: scale(1.15);
		transition:
			opacity 0.3s ease,
			transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
	}
	.verdict.in {
		opacity: 1;
		transform: none;
	}
	.stamp {
		font-family: var(--display);
		font-weight: 800;
		font-size: 1.25rem;
		color: var(--block);
		border: 2.5px solid var(--block);
		border-radius: 8px;
		padding: 0.15rem 0.7rem;
		transform: rotate(-2.5deg);
		background: var(--block-soft);
	}
	.commit {
		color: var(--ink-2);
	}
	.report-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}
	.results .res {
		flex: none;
		width: 1.1rem;
		font-weight: 700;
		color: var(--pass);
	}
	.results li.fail .res {
		color: var(--block);
	}
	.results li {
		font-size: 0.875rem;
	}
	.finding {
		display: grid;
		gap: 0.45rem;
		justify-items: start;
		border: 1px solid color-mix(in srgb, var(--block) 35%, var(--rule));
		border-radius: 12px;
		padding: 0.85rem 1rem;
		font-size: 0.875rem;
	}
	.finding .label {
		margin: 0.2rem 0 0;
	}
	.mini {
		margin: 0;
		padding-left: 1.1rem;
		display: grid;
		gap: 0.15rem;
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.25rem 0.75rem;
	}
	dt {
		color: var(--ink-3);
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	dd.bad {
		color: var(--block);
	}

	@media (max-width: 860px) {
		.flow {
			grid-template-columns: minmax(0, 1fr);
		}
		.steps {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.steps button {
			flex-direction: column;
			align-items: center;
			text-align: center;
			padding: 0.5rem 0.25rem;
			gap: 0.35rem;
		}
		.t {
			font-size: 0.75rem;
			line-height: 1.25;
		}
		.d,
		[aria-selected='true'] .d {
			display: none;
		}
		.play {
			margin-left: 0;
		}
		.stage {
			min-height: 0;
			padding: 1rem;
		}
		.browser-pane,
		.report-cols {
			grid-template-columns: minmax(0, 1fr);
		}
		.log li:not(:nth-last-child(-n + 3)) {
			display: none;
		}
	}
	@media (max-width: 520px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
		.arrow {
			transform: rotate(90deg);
			justify-self: center;
		}
		.arrow.in {
			transform: rotate(90deg);
		}
		.tests ul {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pane,
		.log li {
			animation: none;
		}
		.cursor,
		.files li,
		.criteria li,
		.fade,
		.issue,
		.arrow,
		.verdict {
			transition: none;
		}
	}
</style>
