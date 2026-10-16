<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';

	type Doc = { name: string; title: string; html: string; chars: number };

	let { docs }: { docs: Doc[] } = $props();
	const i = i18n();
	let current = $state<string | null>(null);
	const shown = $derived(docs.find((d) => d.name === current) ?? docs[0]);
	const title = (doc: Doc) => i.labels.knowledgeDoc[doc.name] ?? doc.title;
</script>

{#if shown}
	<div class="kv">
		<div class="seg" role="tablist" aria-label={i.t('analysis.documents')}>
			{#each docs as doc (doc.name)}
				<button type="button" role="tab" aria-selected={doc.name === shown.name} onclick={() => (current = doc.name)}>
					{title(doc)}
				</button>
			{/each}
		</div>
		<div class="sheet prose doc" role="tabpanel" aria-label={title(shown)}>
			{@html shown.html}
		</div>
	</div>
{/if}

<style>
	.kv {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	.seg {
		flex-wrap: wrap;
	}
	.doc {
		justify-self: stretch;
		max-width: none;
		padding: 1.25rem clamp(1rem, 3vw, 1.75rem);
		overflow-x: auto;
	}
</style>
