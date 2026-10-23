<script lang="ts" generics="T extends string">
	import { tooltip } from '#lib/tooltip.js';

	/**
	 * The one control for switching a view or filtering a list: a segmented row of
	 * options, each with an optional count and an explanation on hover.
	 */
	let {
		value = $bindable(),
		options,
		label
	}: { value: T; options: { value: T; label: string; count?: number; tip?: string }[]; label: string } = $props();
</script>

<div class="seg" role="group" aria-label={label}>
	{#each options as o (o.value)}
		<button type="button" aria-pressed={value === o.value} use:tooltip={o.tip} onclick={() => (value = o.value)}>
			{o.label}
			{#if o.count !== undefined}<span class="n">{o.count}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.n {
		font-weight: 400;
		color: var(--ink-3);
	}
</style>
