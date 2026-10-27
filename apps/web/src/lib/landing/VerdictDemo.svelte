<script lang="ts">
	import claudio from '#lib/assets/claudio-64.png';
	import Seg from '#lib/components/Seg.svelte';
	import Severity from '#lib/components/Severity.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import type { Strictness } from '@claudio/core';
	import { CRITERIA, RECHECK_FINDINGS, outcome } from './scenario.js';

	/** The re-review's findings: strictness and each rating change the verdict, worked out by verdict() itself. */
	const i = i18n();
	type Rating = 'proposed' | 'confirmed' | 'dismissed';

	let strictness = $state<Strictness>('normal');
	let ratings = $state<Record<string, Rating>>(Object.fromEntries(RECHECK_FINDINGS.map((f) => [f.id, 'proposed'])));
	const dismissed = $derived(RECHECK_FINDINGS.filter((f) => ratings[f.id] === 'dismissed').map((f) => f.id));
	const allMet = CRITERIA.map(() => 'passed' as const);
	const result = $derived(outcome(i.locale, allMet, RECHECK_FINDINGS, strictness, dismissed));
	const approve = $derived(result.verdict === 'approve');

	const strictOptions = $derived(
		(['lenient', 'normal', 'strict'] as const).map((value) => ({
			value,
			label: i.t(value === 'lenient' ? 'landing.strictLenient' : value === 'normal' ? 'landing.strictNormal' : 'landing.strictStrict'),
			tip: i.labels.strictness[value]
		}))
	);
	const ratingOptions = $derived([
		{ value: 'confirmed' as Rating, label: i.t('landing.confirm') },
		{ value: 'dismissed' as Rating, label: i.t('landing.dismiss') }
	]);
</script>

<div class="verdict-demo">
	<div class="card findings-card">
		<div class="toolbar">
			<span class="label">{i.t('landing.strictness')}</span>
			<Seg bind:value={strictness} options={strictOptions} label={i.t('landing.strictness')} />
		</div>
		<ul class="findings">
			{#each RECHECK_FINDINGS as f (f.id)}
				{@const blocking = result.blocking.includes(f.id)}
				{@const gone = ratings[f.id] === 'dismissed'}
				<li class:blocking class:gone>
					<div class="meta">
						<Severity severity={f.severity} />
						{#if blocking}<span class="flag block">{i.t('landing.blocks')}</span>{/if}
						{#if gone}<span class="flag">{i.t('landing.dismissed')}</span>{/if}
					</div>
					<p class="title">{f.title[i.locale]}</p>
					<p class="detail">{f.detail[i.locale]}</p>
					<div class="rate">
						<Seg bind:value={() => ratings[f.id] ?? 'proposed', (v) => (ratings[f.id] = v)} options={ratingOptions} label={i.t('landing.findingActions', { title: f.title[i.locale] })} />
					</div>
				</li>
			{/each}
		</ul>
	</div>

	<aside class="card pr" class:approve aria-live="polite">
		<p class="label">{i.t('landing.onThePr')}</p>
		{#key result.verdict}
			<div class="review">
				<img src={claudio} alt="" width="36" height="36" />
				<p><b>Claudio</b> {approve ? i.t('landing.reviewApproved') : i.t('landing.reviewChanges')}</p>
			</div>
			<p class="stamp">{i.labels.verdict[result.verdict]}</p>
		{/key}
		<p class="commit">
			<span class="commit-dot" aria-hidden="true"></span>
			<code>Claudio — {result.status}</code>
		</p>
		<p class="lesson">{i.t('landing.lessonNote')}</p>
	</aside>
</div>

<style>
	.verdict-demo {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}
	.card {
		background: var(--sheet);
		border: 1px solid var(--rule);
		border-radius: 16px;
		box-shadow: var(--shadow);
		padding: 1.25rem;
		min-width: 0;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--rule);
	}
	.label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-3);
	}
	.findings {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.findings li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'meta rate' 'title rate' 'detail rate';
		column-gap: 1rem;
		row-gap: 0.2rem;
		padding: 0.9rem 0.25rem;
		border-bottom: 1px solid var(--rule);
		transition: opacity 0.25s;
	}
	.findings li:last-child {
		border-bottom: 0;
		padding-bottom: 0.25rem;
	}
	.meta {
		grid-area: meta;
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.title {
		grid-area: title;
		font-weight: 600;
	}
	.detail {
		grid-area: detail;
		font-size: 0.875rem;
		color: var(--ink-2);
	}
	.rate {
		grid-area: rate;
		align-self: center;
	}
	.gone .title,
	.gone .detail {
		text-decoration: line-through;
		text-decoration-color: var(--ink-3);
		color: var(--ink-3);
	}
	.flag {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--ink-3);
		border: 1px dashed var(--rule-strong);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}
	.flag.block {
		color: var(--block);
		border: 1px solid color-mix(in srgb, var(--block) 45%, transparent);
		background: var(--block-soft);
	}

	.pr {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.85rem;
		position: sticky;
		top: 5rem;
		border-top: 4px solid var(--block);
		transition: border-color 0.3s;
	}
	.pr.approve {
		border-top-color: var(--pass);
	}
	.review {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		animation: pop 0.35s cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	.review img {
		border-radius: 50%;
	}
	.stamp {
		justify-self: start;
		font-family: var(--display);
		font-size: 1.5rem;
		font-weight: 800;
		line-height: 1.2;
		color: var(--block);
		border: 2.5px solid currentColor;
		border-radius: 10px;
		padding: 0.2rem 0.8rem;
		transform: rotate(-2deg);
		background: var(--block-soft);
		animation: stamp 0.4s cubic-bezier(0.3, 1.6, 0.5, 1) both;
	}
	.approve .stamp {
		color: var(--pass);
		background: var(--pass-soft);
	}
	.commit {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		font-size: 0.8125rem;
		color: var(--ink-2);
	}
	.commit code {
		min-width: 0;
		font-family: var(--mono);
		overflow-wrap: anywhere;
	}
	.commit-dot {
		flex: none;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--block);
		transform: translateY(0.05rem);
	}
	.approve .commit-dot {
		background: var(--pass);
	}
	.lesson {
		font-size: 0.875rem;
		color: var(--ink-2);
		padding-top: 0.85rem;
		border-top: 1px solid var(--rule);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	@keyframes stamp {
		from {
			opacity: 0;
			transform: rotate(-2deg) scale(1.3);
		}
	}

	@media (max-width: 960px) {
		.verdict-demo {
			grid-template-columns: minmax(0, 1fr);
		}
		/* Above the list on narrow screens, so the verdict stays in view while rating the first findings. */
		.pr {
			position: static;
			order: -1;
		}
	}
	@media (max-width: 560px) {
		.card {
			padding: 1rem;
		}
		.findings li {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas: 'meta' 'title' 'detail' 'rate';
		}
		.rate {
			justify-self: start;
			margin-top: 0.4rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.review,
		.stamp {
			animation: none;
		}
	}
</style>
