<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import { tooltip } from '#lib/tooltip.js';

	const i = i18n();

	let { status, outcome = null, healed = false }: { status: string; outcome?: string | null; healed?: boolean } = $props();
	const live = $derived(status === 'queued' || status === 'running');
	const tone = $derived(live ? 'live' : outcome === 'passed' ? 'pass' : outcome === 'failed' ? 'block' : 'hint');
	const label = $derived(live || !outcome ? (i.labels.status[status] ?? status) : i.labels.outcome[outcome]);
</script>

<!-- Styled by .status and .dot in app.css -->
<span class="status">
	<span class="dot {tone}" aria-hidden="true"></span>
	{label}{#if healed && !live}<span class="healed" use:tooltip={i.t('test.healedHelp')}>{i.t('test.healedSuffix')}</span>{/if}
</span>

<style>
	.healed {
		font-weight: 400;
		color: var(--ink-3);
		cursor: help;
		text-decoration: underline dotted color-mix(in srgb, var(--ink-3) 60%, transparent);
		text-underline-offset: 0.2em;
	}
</style>
