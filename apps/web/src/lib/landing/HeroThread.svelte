<script lang="ts">
	import claudio from '#lib/assets/claudio-64.png';
	import { i18n } from '#lib/i18n/index.js';
	import { CRITERIA, FIRST_RUN_FINDINGS, PR, outcome } from './scenario.js';

	/** A pull request thread in which Claudio's review arrives: the result of the flow, before the page explains it. */
	const i = i18n();
	const result = $derived(outcome(i.locale, CRITERIA.map((c) => c.status), FIRST_RUN_FINDINGS, 'normal'));
</script>

<figure class="thread" aria-label={i.t('landing.threadLabel')}>
	<header>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" class="pr-icon">
			<path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.12v5.26a2.25 2.25 0 1 1-1.5 0V5.37A2.25 2.25 0 0 1 1.5 3.25Zm5.68-.53L9.94.06A.25.25 0 0 1 10.36.24V1.5h1.89A2.75 2.75 0 0 1 15 4.25v6.38a2.25 2.25 0 1 1-1.5 0V4.25c0-.69-.56-1.25-1.25-1.25h-1.89v1.26a.25.25 0 0 1-.42.18L7.18 3.08a.25.25 0 0 1 0-.36ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm10.5.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
		</svg>
		<div>
			<p class="title">{PR.title[i.locale]} <span class="pr-num">#{PR.number}</span></p>
			<p class="branch"><code>{PR.branch}</code> → <code>main</code></p>
		</div>
	</header>

	<ol>
		<li class="event" style="--d: 0.2s">
			<span class="avatar dev" aria-hidden="true">d</span>
			<p><b>dev</b> {i.t('landing.threadPushed')}</p>
		</li>
		<li class="event" style="--d: 0.9s">
			<span class="avatar deploy" aria-hidden="true">
				<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M8 1.5 14.5 8 8 14.5 1.5 8Z" /></svg>
			</span>
			<p>{i.t('landing.threadPreview')} <code>pr-{PR.number}.preview.example.com</code></p>
		</li>
		<li class="review" style="--d: 1.8s">
			<img class="avatar" src={claudio} alt="" width="28" height="28" />
			<div class="bubble">
				<p class="who">
					<b>Claudio</b>
					{i.t('landing.threadChanges')}
					<span class="verdict-tag block">{i.labels.verdict[result.verdict]}</span>
				</p>
				<p>{i.t('landing.threadSummary')}</p>
				<a href="#how">{i.t('landing.threadReport')} →</a>
			</div>
		</li>
	</ol>

	<footer style="--d: 2.6s">
		<span class="commit-icon" aria-hidden="true">
			<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
		</span>
		<b>Claudio</b>
		<span class="commit">{result.status}</span>
	</footer>
</figure>

<style>
	.thread {
		margin: 0;
		background: var(--sheet);
		color: var(--ink);
		border-radius: 14px;
		box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04), 0 24px 48px -20px rgba(9, 30, 26, 0.45);
		overflow: hidden;
		font-size: 0.875rem;
		text-align: left;
	}
	header {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 1rem 1.1rem 0.85rem;
		border-bottom: 1px solid var(--rule);
	}
	.pr-icon {
		flex: none;
		margin-top: 0.2rem;
		color: var(--pass);
	}
	.title {
		font-weight: 600;
		line-height: 1.35;
	}
	.pr-num {
		color: var(--ink-3);
		font-weight: 400;
	}
	.branch {
		margin-top: 0.25rem;
		color: var(--ink-3);
		font-size: 0.75rem;
	}
	code {
		font-family: var(--mono);
		font-size: 0.75rem;
		background: var(--sunken);
		padding: 0.05rem 0.3rem;
		border-radius: 4px;
		overflow-wrap: anywhere;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0.9rem 1.1rem;
		display: grid;
		gap: 0.8rem;
	}
	li,
	footer {
		animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) var(--d) both;
	}
	.event {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--ink-2);
	}
	.avatar {
		flex: none;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.dev {
		background: var(--sunken);
		color: var(--ink-2);
	}
	.deploy {
		background: var(--pass-soft);
		color: var(--pass);
	}
	.review {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
	}
	.bubble {
		flex: 1;
		min-width: 0;
		border: 1px solid color-mix(in srgb, var(--block) 40%, var(--rule));
		border-radius: 10px;
		padding: 0.7rem 0.8rem;
		display: grid;
		gap: 0.35rem;
		background: var(--block-soft);
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.verdict-tag.block {
		margin-left: auto;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--block);
		border: 1px solid color-mix(in srgb, var(--block) 45%, transparent);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		background: var(--sheet);
	}
	.bubble a {
		color: var(--brand-text);
		font-weight: 600;
		justify-self: start;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.1rem;
		border-top: 1px solid var(--rule);
		background: var(--sunken);
		font-size: 0.8125rem;
	}
	.commit-icon {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--block);
		color: #fff;
		flex: none;
	}
	.commit {
		color: var(--ink-2);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		li,
		footer {
			animation: none;
		}
	}
</style>
