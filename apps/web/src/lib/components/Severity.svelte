<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import type { Severity } from '@claudio/core';

	let { severity }: { severity: Severity } = $props();
	const i = i18n();
</script>

<span class="sev {severity}">
	<span class="mark" aria-hidden="true"></span>
	{i.labels.severity[severity]}
</span>

<style>
	.sev {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1.3;
		padding: 0.1rem 0.4rem 0.1rem 0.3rem;
		border: 1px solid var(--rule-strong);
		border-radius: 3px;
		color: var(--ink-2);
		white-space: nowrap;
	}
	.mark {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--hint);
	}
	.blocker {
		color: var(--block);
		border-color: color-mix(in srgb, var(--block) 45%, transparent);
		background: var(--block-soft);
	}
	.blocker .mark {
		background: var(--block);
	}
	.major {
		color: var(--major);
	}
	.major .mark {
		background: var(--major);
	}
	.minor .mark {
		background: var(--minor);
	}
	.suggestion .mark {
		background: var(--hint);
	}
</style>
