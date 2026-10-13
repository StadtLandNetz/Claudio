<script lang="ts">
	import { STATUS_LABEL, VERDICT_LABEL } from '#lib/labels.js';
	import type { Verdict } from '@claudio/core';

	let { status, verdict = null }: { status: string; verdict?: string | null } = $props();

	const tone = $derived(
		status === 'running' || status === 'queued'
			? 'live'
			: status !== 'completed'
				? 'hint'
				: verdict === 'approve'
					? 'pass'
					: verdict === 'request_changes'
						? 'block'
						: 'hint'
	);
	const label = $derived(
		status === 'completed' && verdict ? VERDICT_LABEL[verdict as Verdict] : (STATUS_LABEL[status] ?? status)
	);
</script>

<span class="badge {tone}">
	{#if tone === 'live'}<span class="pulse" aria-hidden="true"></span>{/if}
	{label}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8125rem;
		font-weight: 600;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		white-space: nowrap;
		background: var(--hint-soft);
		color: var(--hint);
	}
	.pass {
		background: var(--pass-soft);
		color: var(--pass);
	}
	.block {
		background: var(--block-soft);
		color: var(--block);
	}
	.live {
		background: var(--petrol-soft);
		color: var(--petrol);
	}
	.pulse {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
</style>
