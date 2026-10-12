<script lang="ts">
	let { src, url }: { src: string; url: string } = $props();
	let hasFrame = $state(false);
	let failed = $state(false);
</script>

<section class="live sheet" aria-label="Live-Ansicht des Browsers">
	<header>
		<span class="dot" aria-hidden="true"></span>
		<h2>Live-Ansicht</h2>
		<span class="url faint">{url}</span>
	</header>
	<div class="screen">
		<img
			{src}
			alt="Aktueller Bildschirm des Browsers, den Claudio steuert"
			class:show={hasFrame}
			onload={() => (hasFrame = true)}
			onerror={() => (failed = true)}
		/>
		{#if !hasFrame}
			<p class="wait faint">
				{failed ? 'Die Live-Ansicht ist gerade nicht erreichbar.' : 'Wartet auf das erste Bild, sobald der Browser startet …'}
			</p>
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
