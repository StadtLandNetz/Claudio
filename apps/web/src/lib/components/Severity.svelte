<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import type { Severity } from '@claudio/core';

	let { severity }: { severity: Severity } = $props();
	const i = i18n();
</script>

<span class="sev {severity}">{i.labels.severity[severity]}</span>

<style>
	.sev {
		display: inline-block;
		font-size: 0.8125rem;
		font-weight: 700;
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-s);
		white-space: nowrap;
	}
	.blocker {
		background: var(--block);
		color: var(--sheet);
	}
	.major {
		background: var(--major-soft);
		color: var(--major);
	}
	.minor {
		background: var(--minor-soft);
		color: var(--minor);
	}
	.suggestion {
		background: var(--hint-soft);
		color: var(--hint);
	}
</style>
