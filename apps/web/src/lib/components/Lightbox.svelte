<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';

	/** A screenshot at full size. Set `item` to open, it clears itself on close. */
	let { item = $bindable(null) }: { item?: { url: string; label: string } | null } = $props();
	const i = i18n();
	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (item && !dialog.open) dialog.showModal();
		else if (!item && dialog.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} class="lightbox" onclose={() => (item = null)} onclick={(e) => e.target === dialog && dialog?.close()}>
	{#if item}
		<figure>
			<img src={item.url} alt={item.label} />
			<figcaption>
				{item.label}
				<a href={item.url} target="_blank" rel="noopener noreferrer">{i.t('common.openInNewTab')}</a>
				<button class="btn small" type="button" onclick={() => dialog?.close()}>{i.t('common.close')}</button>
			</figcaption>
		</figure>
	{/if}
</dialog>

<style>
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
	figure {
		margin: 0;
	}
	img {
		display: block;
		max-width: 100%;
		max-height: calc(92vh - 4rem);
	}
	figcaption {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		flex-wrap: wrap;
	}
	figcaption .btn {
		margin-left: auto;
	}
</style>
