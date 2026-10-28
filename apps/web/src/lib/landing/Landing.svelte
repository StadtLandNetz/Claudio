<script lang="ts">
	import { page } from '$app/state';
	import icon from '#lib/assets/claudio.jpg';
	import icon64 from '#lib/assets/claudio-64.png';
	import humanShot from '#lib/assets/landing/human-takeover.png';
	import knowledgeShot from '#lib/assets/landing/knowledge.png';
	import testShot from '#lib/assets/landing/test-run.png';
	import Lightbox from '#lib/components/Lightbox.svelte';
	import LocaleSwitch from '#lib/components/LocaleSwitch.svelte';
	import ThemeSwitch from '#lib/components/ThemeSwitch.svelte';
	import { i18n, type MessageKey } from '#lib/i18n/index.js';
	import FlowDemo from './FlowDemo.svelte';
	import HeroThread from './HeroThread.svelte';
	import ImpactDemo from './ImpactDemo.svelte';
	import VerdictDemo from './VerdictDemo.svelte';

	/** The public page at / for visitors who are not signed in: what Claudio does, shown with three working demos. */
	/** `demoLogin`: the offline demo's sign-in exists (dev server with CLAUDIO_DEV_FIXTURES=1); elsewhere the demo button explains how to run it. */
	let { demoLogin = false }: { demoLogin?: boolean } = $props();
	const i = i18n();
	const REPO = 'https://github.com/StadtLandNetz/Claudio';
	const DOCS = `${REPO}/blob/main/docs/DEPLOYMENT.md`;
	const DEMO_DOCS = `${REPO}#try-it-the-offline-demo`;

	const nav: { href: string; label: MessageKey }[] = [
		{ href: '#how', label: 'landing.navHow' },
		{ href: '#impact', label: 'landing.navImpact' },
		{ href: '#verdict', label: 'landing.navVerdict' },
		{ href: '#security', label: 'landing.navSecurity' }
	];
	const features: { title: MessageKey; text: MessageKey; shot: string }[] = [
		{ title: 'landing.knowledgeTitle', text: 'landing.knowledgeText', shot: knowledgeShot },
		{ title: 'landing.plainTestsTitle', text: 'landing.plainTestsText', shot: testShot },
		{ title: 'landing.humanTitle', text: 'landing.humanText', shot: humanShot }
	];
	const stats: { value: MessageKey; label: MessageKey }[] = [
		{ value: 'landing.stat1Value', label: 'landing.stat1Label' },
		{ value: 'landing.stat2Value', label: 'landing.stat2Label' },
		{ value: 'landing.stat3Value', label: 'landing.stat3Label' }
	];
	const security: MessageKey[] = ['landing.sec1', 'landing.sec2', 'landing.sec3', 'landing.sec4', 'landing.sec5'];

	let shot = $state<{ url: string; label: string } | null>(null);
	// The headline's answer, pinned by a click; hover and focus only show it.
	let stamped = $state(false);
</script>

<svelte:head>
	<title>{i.t('landing.pageTitle')}</title>
	<meta name="description" content={i.t('landing.metaDescription')} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={i.t('landing.heroTitle')} />
	<meta property="og:description" content={i.t('landing.metaDescription')} />
	<meta property="og:image" content={new URL(icon, page.url.origin).href} />
	<meta name="twitter:card" content="summary" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@500..800&display=swap" />
</svelte:head>

<div class="landing">
	<header class="top">
		<div class="inner bar">
			<a class="brand" href="/">
				<img src={icon64} alt="" width="32" height="32" />
				<span>Claudio</span>
			</a>
			<nav aria-label={i.t('landing.pageNav')}>
				{#each nav as item (item.href)}
					<a href={item.href}>{i.t(item.label)}</a>
				{/each}
			</nav>
			<div class="tools">
				<LocaleSwitch />
				<span class="theme"><ThemeSwitch /></span>
				<a class="cta primary small" href="/login">{i.t('landing.signIn')}</a>
			</div>
		</div>
	</header>

	<main>
		<section class="hero band">
			<div class="inner hero-grid">
				<div class="hero-copy">
					<img class="mascot" src={icon} alt="" width="168" height="168" />
					<p class="kicker">{i.t('landing.heroKicker')}</p>
					<h1>
						{i.t('landing.heroLead1')}<br />
						<span class="question"
							><button type="button" class="who" aria-pressed={stamped} title={i.t('landing.heroStampHint')} onclick={() => (stamped = !stamped)}
								>{i.t('landing.heroWho')}<span class="stamp" aria-hidden="true">Claudio</span></button
							>
							<span class="rest">{i.t('landing.heroRest')}<span class="q">?</span><span class="period">.</span></span></span
						>
					</h1>
					<p class="lead">{i.t('landing.heroLead')}</p>
					<div class="ctas">
						<a class="cta primary" href="/login">{i.t('landing.signIn')}</a>
						<a class="cta ghost" href="#how">{i.t('landing.ctaHow')}</a>
						<a class="cta ghost" href="#self-host">{i.t('landing.ctaSelfHost')}</a>
					</div>
					<ul class="facts">
						<li>{i.t('landing.factForgesBoth')}</li>
						<li>{i.t('landing.factLanguages')}</li>
						<li>{i.t('landing.factViewports')}</li>
					</ul>
				</div>
				<div class="hero-visual">
					<HeroThread />
				</div>
			</div>
		</section>

		<section id="how" class="sec">
			<div class="inner">
				<header class="sec-head">
					<p class="kicker">{i.t('landing.howKicker')}</p>
					<h2>{i.t('landing.howTitle')}</h2>
					<p class="lead">{i.t('landing.howLead')}</p>
				</header>
				<FlowDemo />
			</div>
		</section>

		<section id="impact" class="sec tinted">
			<div class="inner">
				<header class="sec-head">
					<p class="kicker">{i.t('landing.impactKicker')}</p>
					<h2>{i.t('landing.impactTitle')}</h2>
					<p class="lead">{i.t('landing.impactLead')}</p>
				</header>
				<ImpactDemo />
			</div>
		</section>

		<section id="verdict" class="sec">
			<div class="inner">
				<header class="sec-head">
					<p class="kicker">{i.t('landing.verdictKicker')}</p>
					<h2>{i.t('landing.verdictTitle')}</h2>
					<p class="lead">{i.t('landing.verdictLead')}</p>
				</header>
				<VerdictDemo />
			</div>
		</section>

		<section class="sec tinted">
			<div class="inner">
				<header class="sec-head">
					<p class="kicker">{i.t('landing.moreKicker')}</p>
					<h2>{i.t('landing.moreTitle')}</h2>
				</header>
				<div class="features">
					{#each features as f (f.title)}
						<article class="feature">
							<button type="button" class="shot" aria-label={i.t('landing.enlarge', { label: i.t(f.title) })} onclick={() => (shot = { url: f.shot, label: i.t(f.title) })}>
								<img src={f.shot} alt="" loading="lazy" width="1200" height="900" />
							</button>
							<h3>{i.t(f.title)}</h3>
							<p>{i.t(f.text)}</p>
						</article>
					{/each}
				</div>
				<dl class="stats">
					{#each stats as s (s.value)}
						<div>
							<dt>{i.t(s.label)}</dt>
							<dd>{i.t(s.value)}</dd>
						</div>
					{/each}
				</dl>
				<p class="source">{i.t('landing.statsSource')}</p>
			</div>
		</section>

		<section id="security" class="sec">
			<div class="inner split">
				<div>
					<header class="sec-head">
						<p class="kicker">{i.t('landing.securityKicker')}</p>
						<h2>{i.t('landing.securityTitle')}</h2>
					</header>
					<ul class="checks">
						{#each security as s (s)}
							<li>
								<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
								{i.t(s)}
							</li>
						{/each}
					</ul>
				</div>
				<div id="self-host" class="self">
					<h2>{i.t('landing.selfTitle')}</h2>
					<p>{i.t('landing.selfText')}</p>
					<p class="reqs"><code>{i.t('landing.selfReqs')}</code></p>
					<div class="ctas">
						<a class="cta primary" href={REPO} rel="noopener">{i.t('landing.selfRepoGithub')}</a>
						<a class="cta ghost" href={DOCS} rel="noopener">{i.t('landing.selfDocs')}</a>
					</div>
				</div>
			</div>
		</section>

		<section class="closing band">
			<div class="inner closing-grid">
				<img class="mascot" src={icon} alt="" width="168" height="168" loading="lazy" />
				<div class="closing-copy">
					<h2>{i.t('landing.ctaTitle')}</h2>
					<p class="lead">{i.t('landing.ctaLead')}</p>
					<div class="ctas">
						<a class="cta primary" href="/login">{i.t('landing.signIn')}</a>
						{#if demoLogin}
							<form method="POST" action="/auth/dev">
								<button class="cta ghost" type="submit">{i.t('landing.ctaDemo')}</button>
							</form>
						{:else}
							<a class="cta ghost" href={DEMO_DOCS} rel="noopener">{i.t('landing.ctaDemoLocal')}</a>
						{/if}
					</div>
					<p class="hint">{demoLogin ? i.t('landing.ctaDemoHint') : i.t('landing.ctaDemoLocalHint')}</p>
				</div>
			</div>
		</section>
	</main>

	<footer class="foot">
		<div class="inner foot-bar">
			<span class="brand small">
				<img src={icon64} alt="" width="24" height="24" />
				<span>Claudio</span>
			</span>
			<span class="by">{i.t('landing.builtBy')}</span>
			<a href={REPO} rel="noopener">GitHub</a>
			<a href="/login">{i.t('landing.signIn')}</a>
			<span class="foot-tools"><LocaleSwitch /><ThemeSwitch /></span>
		</div>
	</footer>
</div>

<Lightbox bind:item={shot} />

<style>
	.landing {
		/* The icon's colours: the app's turquoise accent, laurel gold, dark brown ink. */
		--brand: var(--accent-fill);
		--brand-ink: var(--accent-ink);
		--brand-text: var(--accent);
		--brand-line: light-dark(#00a68a, #2ee8c6);
		--brand-soft: var(--accent-soft);
		--gold: #fec82f;
		--gold-ink: light-dark(#7a5300, #ffd75e);
		--gold-soft: light-dark(#fff5d6, #382c0b);
		--hero-bg: light-dark(#01e5bd, #072b25);
		--hero-ink: light-dark(#1f0f08, #ecfffa);
		--display: 'Funnel Display', var(--font);

		font-size: 1rem;
		line-height: 1.6;
		background: var(--paper);
		color: var(--ink);
		overflow-x: clip;
	}
	.inner {
		max-width: 72rem;
		margin-inline: auto;
		padding-inline: clamp(1rem, 4vw, 2rem);
	}
	.landing :global(h1),
	.landing :global(h2),
	.landing :global(h3) {
		font-family: var(--display);
		text-wrap: balance;
	}

	/* Header */
	.top {
		position: sticky;
		top: 0;
		z-index: 20;
		background: color-mix(in srgb, var(--paper) 82%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--rule);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		height: 4rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--display);
		font-weight: 800;
		font-size: 1.2rem;
		color: var(--ink);
		text-decoration: none;
	}
	.brand img {
		border-radius: 50%;
	}
	.brand.small {
		font-size: 1rem;
	}
	nav {
		display: flex;
		gap: 1.25rem;
		font-size: 0.9375rem;
	}
	nav a {
		color: var(--ink-2);
	}
	nav a:hover {
		color: var(--ink);
	}
	.tools {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	/* Buttons */
	.cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 1.25rem;
		border-radius: 999px;
		font-weight: 700;
		font-size: 0.9375rem;
		text-decoration: none;
		border: 2px solid transparent;
		transition:
			transform 0.15s ease,
			background 0.15s ease;
		white-space: nowrap;
	}
	.cta:hover {
		text-decoration: none;
		transform: translateY(-1px);
	}
	.cta:focus-visible {
		outline: 2px solid var(--brand-text);
		outline-offset: 3px;
	}
	.cta.primary {
		background: var(--brand);
		color: var(--brand-ink);
	}
	.cta.small {
		min-height: 2.25rem;
		padding: 0 1rem;
		font-size: 0.875rem;
	}
	.cta.ghost {
		color: var(--ink);
		background: transparent;
		border-color: var(--rule-strong);
	}
	button.cta {
		font: inherit;
		font-weight: 700;
		font-size: 0.9375rem;
		cursor: pointer;
	}
	.ctas form {
		display: contents;
	}
	.cta.ghost:hover {
		border-color: var(--ink-3);
	}

	/* The turquoise bands at the top and the bottom of the page */
	.band {
		--band-radius: clamp(1.5rem, 4vw, 3rem);
		background:
			radial-gradient(60rem 30rem at 85% -10%, color-mix(in srgb, #ffffff 28%, transparent), transparent 70%),
			var(--hero-bg);
		color: var(--hero-ink);
		padding-block: clamp(2.5rem, 7vw, 5.5rem);
	}
	.band .lead {
		font-size: clamp(1.05rem, 1.6vw, 1.2rem);
		max-width: 36rem;
		color: var(--hero-ink);
		opacity: 0.88;
	}
	.band .cta.primary {
		background: var(--hero-ink);
		color: var(--hero-bg);
	}
	.band .cta.ghost {
		color: var(--hero-ink);
		border-color: color-mix(in srgb, var(--hero-ink) 35%, transparent);
	}
	.band .cta.ghost:hover {
		border-color: var(--hero-ink);
	}

	/* Hero */
	.hero {
		border-bottom-left-radius: var(--band-radius);
		border-bottom-right-radius: var(--band-radius);
	}
	.hero-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
		gap: clamp(2rem, 5vw, 4rem);
		align-items: center;
	}
	.hero-copy {
		display: grid;
		gap: 1.1rem;
		justify-items: start;
	}
	.mascot {
		width: clamp(5.5rem, 16vw, 10.5rem);
		height: auto;
		aspect-ratio: 1;
		border-radius: 50%;
		box-shadow: 0 18px 40px -18px rgba(31, 15, 8, 0.55);
	}
	.hero .kicker {
		color: var(--hero-ink);
		opacity: 0.8;
	}
	.hero .kicker::before {
		background: var(--gold);
	}
	h1 {
		font-size: clamp(2.25rem, 5.6vw, 4rem);
		line-height: 1.04;
		font-weight: 800;
		letter-spacing: -0.025em;
		max-width: 14ch;
	}
	/* "Who checks it?" stays on one line, so the stamp always lands at its start. */
	.question {
		white-space: nowrap;
	}
	.who {
		position: relative;
		display: inline-block;
		font: inherit;
		letter-spacing: inherit;
		color: inherit;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
		text-decoration-thickness: 0.08em;
		text-underline-offset: 0.1em;
		text-decoration-color: var(--hero-ink);
		transition: text-decoration-color 0.15s ease;
	}
	.who:hover {
		text-decoration-color: var(--gold);
	}
	.who:focus-visible {
		outline: 2px solid var(--hero-ink);
		outline-offset: 4px;
		border-radius: 4px;
	}
	/* Over the word, not beside it: nothing on the line moves, and the stamp never takes the hover. */
	.stamp {
		/* Centred on the word; on phones from its start, so it does not run into the page margin. */
		--stamp-left: 50%;
		--stamp-x: -50%;
		position: absolute;
		left: var(--stamp-left);
		top: 50%;
		z-index: 1;
		padding: 0.08em 0.28em 0.12em;
		font-size: 0.6em;
		line-height: 1.1;
		letter-spacing: -0.01em;
		white-space: nowrap;
		color: var(--brand-ink);
		background: var(--gold);
		border: 0.08em solid var(--brand-ink);
		border-radius: 0.2em;
		box-shadow: 0 0.12em 0 rgba(31, 15, 8, 0.25);
		/* Hidden, not just transparent: the heading's text then reads "Who checks it?" until the stamp is down. */
		visibility: hidden;
		opacity: 0;
		transform: translate(var(--stamp-x), -50%) rotate(-9deg);
		pointer-events: none;
	}
	/* The end state is the style itself, so with reduced motion (no animation) the stamp still shows. */
	.who:is(:hover, :focus-visible, [aria-pressed='true']) .stamp {
		visibility: visible;
		opacity: 1;
		animation: stamp-in 0.32s cubic-bezier(0.3, 1.6, 0.5, 1);
	}
	@keyframes stamp-in {
		from {
			opacity: 0;
			transform: translate(var(--stamp-x), -50%) rotate(-18deg) scale(2.2);
		}
	}
	.rest .period,
	.who:is(:hover, :focus-visible, [aria-pressed='true']) + .rest .q {
		display: none;
	}
	.who:is(:hover, :focus-visible, [aria-pressed='true']) + .rest .period {
		display: inline;
	}
	.ctas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.facts {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.1rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.facts li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.facts li::before {
		content: '';
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--gold);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--hero-ink) 25%, transparent);
	}
	.hero-visual {
		min-width: 0;
	}

	/* Sections */
	.sec {
		padding-block: clamp(3.5rem, 8vw, 6rem);
		scroll-margin-top: 4rem;
	}
	.sec.tinted {
		background: var(--sunken);
	}
	.sec-head {
		display: grid;
		gap: 0.6rem;
		max-width: 46rem;
		margin-bottom: clamp(1.5rem, 3vw, 2.25rem);
	}
	.kicker {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--brand-text);
	}
	.kicker::before {
		content: '';
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--brand);
	}
	h2 {
		font-size: clamp(1.75rem, 3.6vw, 2.6rem);
		line-height: 1.12;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.lead {
		font-size: 1.0625rem;
		color: var(--ink-2);
	}

	/* More than reviews */
	.features {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1.25rem;
	}
	.feature {
		display: grid;
		gap: 0.5rem;
		align-content: start;
	}
	.feature h3 {
		font-size: 1.2rem;
		font-weight: 700;
		margin-top: 0.4rem;
	}
	.feature p {
		color: var(--ink-2);
		font-size: 0.9375rem;
	}
	.shot {
		display: block;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: 12px;
		overflow: hidden;
		background: var(--sheet);
		cursor: zoom-in;
		box-shadow: var(--shadow);
		transition: transform 0.2s ease;
	}
	.shot:hover {
		transform: translateY(-2px);
	}
	.shot:focus-visible {
		outline: 2px solid var(--brand-text);
		outline-offset: 3px;
	}
	.shot img {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		object-position: top left;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1.25rem;
		margin: clamp(2rem, 5vw, 3rem) 0 0;
		padding-top: 1.5rem;
		border-top: 1px solid var(--rule-strong);
	}
	.stats div {
		display: flex;
		flex-direction: column-reverse;
		gap: 0.2rem;
	}
	.stats dd {
		margin: 0;
		font-family: var(--display);
		font-weight: 800;
		font-size: clamp(1.8rem, 3.6vw, 2.6rem);
		line-height: 1.1;
		color: var(--ink);
	}
	.stats dt {
		color: var(--ink-2);
		font-size: 0.9375rem;
	}
	.source {
		margin-top: 0.9rem;
		font-size: 0.8125rem;
		color: var(--ink-3);
	}

	/* Security and self-hosting */
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
		gap: clamp(2rem, 5vw, 4rem);
		align-items: start;
	}
	.checks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.85rem;
	}
	.checks li {
		display: grid;
		grid-template-columns: 1.5rem minmax(0, 1fr);
		gap: 0.6rem;
		align-items: start;
	}
	.checks svg {
		color: var(--brand-ink);
		background: var(--brand);
		border-radius: 50%;
		padding: 2px;
		width: 1.4rem;
		height: 1.4rem;
		margin-top: 0.1rem;
	}
	.self {
		display: grid;
		gap: 0.9rem;
		background: var(--sheet);
		border: 1px solid var(--rule);
		border-top: 6px solid var(--brand);
		border-radius: 16px;
		padding: clamp(1.25rem, 3vw, 2rem);
		box-shadow: var(--shadow);
		scroll-margin-top: 5rem;
	}
	.self h2 {
		font-size: clamp(1.5rem, 2.6vw, 2rem);
	}
	.self p {
		color: var(--ink-2);
	}
	.reqs code {
		font-family: var(--mono);
		font-size: 0.8125rem;
		background: var(--sunken);
		border-radius: 6px;
		padding: 0.2rem 0.5rem;
	}

	/* Closing call to action */
	.closing {
		border-top-left-radius: var(--band-radius);
		border-top-right-radius: var(--band-radius);
	}
	.closing-grid {
		display: grid;
		grid-template-columns: auto minmax(0, 40rem);
		justify-content: center;
		gap: clamp(1.5rem, 4vw, 3rem);
		align-items: center;
	}
	.closing-copy {
		display: grid;
		gap: 1rem;
		justify-items: start;
	}
	.closing h2 {
		font-size: clamp(1.9rem, 4.2vw, 3rem);
		line-height: 1.08;
		max-width: 20ch;
	}
	.hint {
		font-size: 0.875rem;
		opacity: 0.8;
	}

	/* Footer */
	.foot {
		border-top: 1px solid var(--rule);
		padding-block: 1.75rem;
		font-size: 0.875rem;
	}
	.foot-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1.25rem;
	}
	.foot a {
		color: var(--ink-2);
	}
	.by {
		color: var(--ink-2);
	}
	.foot-tools {
		margin-left: auto;
		display: inline-flex;
		gap: 0.5rem;
	}

	@media (max-width: 960px) {
		.hero-grid,
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
		.features {
			grid-template-columns: minmax(0, 1fr);
			max-width: 36rem;
		}
	}
	@media (max-width: 860px) {
		nav {
			display: none;
		}
	}
	@media (max-width: 640px) {
		.stamp {
			--stamp-left: 0;
			--stamp-x: -0.06em;
		}
		.closing-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.theme {
			display: none;
		}
		.stats {
			grid-template-columns: minmax(0, 1fr);
		}
		.foot-tools {
			margin-left: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cta,
		.shot {
			transition: none;
		}
	}
</style>
