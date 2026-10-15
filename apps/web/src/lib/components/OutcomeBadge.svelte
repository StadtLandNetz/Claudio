<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';

	const i = i18n();

	let { status, outcome = null, healed = false }: { status: string; outcome?: string | null; healed?: boolean } = $props();
	const live = $derived(status === 'queued' || status === 'running');
	const tone = $derived(live ? 'live' : outcome === 'passed' ? 'pass' : outcome === 'failed' ? 'block' : 'hint');
	const label = $derived(live || !outcome ? (i.labels.status[status] ?? status) : i.labels.outcome[outcome]);
</script>

<span class="badge {tone}">
	{#if live}<span class="pulse" aria-hidden="true"></span>{/if}
	{label}{#if healed && !live}<span class="healed" title={i.t('test.healedTitle')}>{i.t('test.healedSuffix')}</span>{/if}
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
	.healed {
		font-weight: 500;
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
