<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { liveFrames } from '#lib/live-frames.svelte.js';
	import { i18n } from '#lib/i18n/index.js';

	let { src, requestId, reason, url }: { src: string; requestId: number; reason: string; url: string } = $props();
	const i = i18n();

	const frames = liveFrames(() => src);
	let img: HTMLImageElement | undefined = $state();
	let text = $state('');
	let busy = $state(false);
	let lastClick = $state<{ x: number; y: number } | null>(null);
	let error = $state<string | null>(null);

	async function send(input: Record<string, unknown>) {
		error = null;
		const res = await fetch(`/human/${requestId}/input`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) error = res.status === 409 ? i.t('common.takeoverAlreadyDone') : i.t('common.inputRejected');
	}

	/** Maps a click on the (letterboxed) image to relative page coordinates. */
	function click(e: MouseEvent) {
		if (!img || !img.naturalWidth) return;
		const rect = img.getBoundingClientRect();
		const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
		const w = img.naturalWidth * scale;
		const h = img.naturalHeight * scale;
		const x = (e.clientX - rect.left - (rect.width - w) / 2) / w;
		const y = (e.clientY - rect.top - (rect.height - h) / 2) / h;
		if (x < 0 || x > 1 || y < 0 || y > 1) return;
		lastClick = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		setTimeout(() => (lastClick = null), 600);
		send({ type: 'click', x, y });
	}

	async function typeText(e: SubmitEvent) {
		e.preventDefault();
		if (!text) return;
		await send({ type: 'type', text });
		text = '';
	}

	async function finish(status: 'resolved' | 'cancelled') {
		busy = true;
		await fetch(`/human/${requestId}/resolve`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status })
		});
		await invalidateAll();
		busy = false;
	}
</script>

<section class="takeover" aria-label={i.t('common.needsYou')}>
	<header>
		<span class="dot" aria-hidden="true"></span>
		<div>
			<h2>{i.t('common.needsYou')}</h2>
			<p>{i.t('common.takeoverHint', { reason })}</p>
		</div>
	</header>

	<div class="screen">
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		{#if frames.url}
			<img bind:this={img} src={frames.url} alt={i.t('common.takeoverImageAlt')} class="show" onclick={click} />
		{:else}
			<p class="wait faint">{i.t('common.connecting')}</p>
		{/if}
		{#if lastClick}<span class="ripple" style="left:{lastClick.x}px;top:{lastClick.y}px"></span>{/if}
	</div>

	<div class="controls">
		<form onsubmit={typeText} class="type">
			<label class="visually-hidden" for="human-text">{i.t('common.typeTextLabel')}</label>
			<input id="human-text" type="text" bind:value={text} placeholder={i.t('common.typeTextPlaceholder')} autocomplete="off" />
			<button class="btn small" type="submit" disabled={!text}>{i.t('common.type')}</button>
		</form>
		<div class="keys" role="group" aria-label={i.t('common.keys')}>
			{#each ['Enter', 'Tab', 'Backspace', 'Escape'] as key (key)}
				<button class="btn small" type="button" onclick={() => send({ type: 'key', key })}>{key === 'Escape' ? 'Esc' : key}</button>
			{/each}
			<button class="btn small" type="button" onclick={() => send({ type: 'scroll', dy: -400 })} aria-label={i.t('common.scrollUpLabel')}>{i.t('common.scrollUp')}</button>
			<button class="btn small" type="button" onclick={() => send({ type: 'scroll', dy: 400 })} aria-label={i.t('common.scrollDownLabel')}>{i.t('common.scrollDown')}</button>
		</div>
		{#if error}<p class="err" role="alert">{error}</p>{/if}
		<div class="finish">
			<button class="btn primary" type="button" disabled={busy} onclick={() => finish('resolved')}>{i.t('common.doneContinue')}</button>
			<button class="btn" type="button" disabled={busy} onclick={() => finish('cancelled')}>{i.t('common.cannotSolve')}</button>
			<span class="faint">{url}</span>
		</div>
	</div>
</section>

<style>
	.takeover {
		border: 1px solid color-mix(in srgb, var(--major) 55%, transparent);
		border-radius: var(--radius-m);
		background: var(--sheet);
		overflow: hidden;
	}
	header {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.6rem 0.75rem;
		background: var(--major-soft);
		border-bottom: 1px solid color-mix(in srgb, var(--major) 35%, transparent);
	}
	h2 {
		font-size: var(--text-sm);
		color: var(--major);
	}
	header p {
		margin-top: 0.1rem;
		color: var(--ink-2);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		margin-top: 0.35rem;
		border-radius: 50%;
		background: var(--major);
		animation: pulse 1.2s ease-in-out infinite;
		flex: none;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	.screen {
		position: relative;
		aspect-ratio: 16 / 10;
		background: var(--sunken);
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
		cursor: crosshair;
	}
	img.show {
		opacity: 1;
	}
	.ripple {
		position: absolute;
		width: 26px;
		height: 26px;
		margin: -13px 0 0 -13px;
		border-radius: 50%;
		border: 2px solid var(--major);
		pointer-events: none;
		animation: ripple 0.6s ease-out forwards;
	}
	@keyframes ripple {
		to {
			transform: scale(1.8);
			opacity: 0;
		}
	}
	.wait {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}
	.controls {
		display: grid;
		gap: 0.6rem;
		padding: 0.75rem;
		border-top: 1px solid var(--rule);
	}
	.type {
		display: flex;
		gap: 0.4rem;
	}
	.keys,
	.finish {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.finish .faint {
		margin-left: auto;
		word-break: break-all;
		font-family: var(--mono);
	}
	.err {
		color: var(--block);
	}
</style>
