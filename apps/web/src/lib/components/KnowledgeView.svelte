<script lang="ts">
	type Doc = { name: string; title: string; html: string; chars: number };

	let { docs }: { docs: Doc[] } = $props();
	let current = $state<string | null>(null);
	const shown = $derived(docs.find((d) => d.name === current) ?? docs[0]);
</script>

{#if shown}
	<div class="kv">
		<div class="doc-tabs" role="tablist" aria-label="Dokumente">
			{#each docs as doc (doc.name)}
				<button
					type="button"
					role="tab"
					aria-selected={doc.name === shown.name}
					class:on={doc.name === shown.name}
					onclick={() => (current = doc.name)}
				>
					{doc.title}
				</button>
			{/each}
		</div>
		<div class="sheet prose doc" role="tabpanel" aria-label={shown.title}>
			{@html shown.html}
		</div>
	</div>
{/if}

<style>
	.kv {
		display: grid;
		gap: 0.75rem;
	}
	.doc-tabs {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.doc-tabs button {
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		border: 1px solid var(--rule-strong);
		background: var(--sheet);
		color: var(--ink-2);
		cursor: pointer;
	}
	.doc-tabs button.on {
		background: var(--petrol);
		border-color: var(--petrol);
		color: var(--petrol-ink);
	}
	.doc {
		padding: 1.5rem clamp(1rem, 3vw, 2rem);
		overflow-x: auto;
	}
</style>
