<script lang="ts">
	import type { Snippet } from 'svelte';
	import { i18n } from '#lib/i18n/index.js';
	import Icon from './Icon.svelte';

	/**
	 * A modal dialog on the native <dialog>. The content is mounted only while it is
	 * open, so a form inside always starts from fresh data. While `locked`, Escape and
	 * clicks on the backdrop do nothing (a submission is in flight).
	 */
	let {
		open = $bindable(false),
		title,
		width = 'm',
		locked = false,
		children,
		footer,
		onclose
	}: {
		open?: boolean;
		title: string;
		width?: 's' | 'm' | 'l';
		locked?: boolean;
		children: Snippet;
		footer?: Snippet;
		onclose?: () => void;
	} = $props();

	const i = i18n();
	const id = $props.id();
	let dialog: HTMLDialogElement | undefined = $state();
	let downOnBackdrop = false;

	// Mirror `open` into the element. The content renders before this runs, so the first field can take focus.
	$effect(() => {
		if (!dialog) return;
		if (open) {
			if (!dialog.open) dialog.showModal();
			dialog.querySelector<HTMLElement>('.body input, .body textarea, .body select, .body button')?.focus();
		} else if (dialog.open) {
			dialog.close();
		}
	});

	function closed() {
		if (dialog?.open) return;
		open = false;
		onclose?.();
	}
</script>

<dialog
	bind:this={dialog}
	class="modal {width}"
	aria-labelledby="{id}-title"
	oncancel={(e) => {
		if (locked) e.preventDefault();
	}}
	onclose={closed}
	onpointerdown={(e) => (downOnBackdrop = e.target === dialog)}
	onclick={(e) => {
		if (!locked && downOnBackdrop && e.target === dialog) dialog?.close();
	}}
>
	{#if open}
		<div class="frame">
			<header class="head">
				<h2 id="{id}-title">{title}</h2>
				<button type="button" class="btn ghost small x" aria-label={i.t('common.close')} title={i.t('common.close')} onclick={() => dialog?.close()}>
					<Icon name="x" size={14} />
				</button>
			</header>
			<div class="body">{@render children()}</div>
			{#if footer}
				<footer class="foot">{@render footer()}</footer>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	.modal {
		padding: 0;
		border: 0;
		width: min(92vw, var(--w));
		max-width: none;
		background: var(--raised);
		color: var(--ink);
		border-radius: var(--radius-l);
		box-shadow: var(--shadow-pop);
	}
	.modal.s {
		--w: 24rem;
	}
	.modal.m {
		--w: 32rem;
	}
	.modal.l {
		--w: 46rem;
	}
	.modal::backdrop {
		background: rgba(0, 0, 0, 0.5);
	}
	.frame {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		max-height: min(90dvh, 52rem);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--rule);
	}
	.head h2 {
		font-size: var(--text-lg);
	}
	.x {
		margin-right: -0.25rem;
	}
	.body {
		overflow: auto;
		padding: 1rem;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--rule);
	}
	.foot :global(.spacer) {
		flex: 1;
	}
	@media (max-width: 560px) {
		.modal {
			width: 100vw;
			max-width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			margin: 0;
			border-radius: 0;
		}
		.frame {
			height: 100dvh;
			max-height: 100dvh;
		}
	}
</style>
