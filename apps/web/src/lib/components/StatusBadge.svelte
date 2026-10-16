<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import type { Verdict } from '@claudio/core';

	let { status, verdict = null }: { status: string; verdict?: string | null } = $props();
	const i = i18n();

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
		status === 'completed' && verdict ? i.labels.verdict[verdict as Verdict] : (i.labels.status[status] ?? status)
	);
</script>

<!-- Styled by .status and .dot in app.css -->
<span class="status">
	<span class="dot {tone}" aria-hidden="true"></span>
	{label}
</span>
