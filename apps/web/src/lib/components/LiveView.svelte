<script lang="ts">
	import { liveFrames } from '#lib/live-frames.svelte.js';
	import { i18n } from '#lib/i18n/index.js';

	let { src, url }: { src: string; url: string } = $props();
	const i = i18n();
	const frames = liveFrames(() => src);
</script>

<section class="live sheet" aria-label={i.t('common.liveViewLabel')}>
	<header>
		<span class="dot" aria-hidden="true"></span>
		<h2>{i.t('common.liveView')}</h2>
		<span class="url faint">{url}</span>
	</header>
	<div class="screen">
		{#if frames.url}
			<img src={frames.url} alt={i.t('common.liveImageAlt')} class="show" />
		{:else}
			<p class="wait faint">{i.t('common.waitingFirstFrame')}</p>
		{/if}
	</div>
</section>

<style>
	.live {
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.65rem 1rem;
		border-bottom: 1px solid var(--rule);
	}
	h2 {
		font-size: 1rem;
	}
	.url {
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--block);
		animation: pulse 1.6s ease-in-out infinite;
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
	}
	img.show {
		opacity: 1;
	}
	.wait {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		text-align: center;
	}
</style>
