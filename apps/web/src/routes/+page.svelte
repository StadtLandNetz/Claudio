<script lang="ts">
	import ReviewTable from '#lib/components/ReviewTable.svelte';
	import { isActive } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const running = $derived(data.reviews.filter((r) => isActive(r.status)).length);
</script>

<svelte:head><title>Übersicht · Claudio</title></svelte:head>

<div class="head">
	<div>
		<h1>Reviews</h1>
		<p class="muted">
			{#if running > 0}
				{running === 1 ? 'Ein Review läuft gerade.' : `${running} Reviews laufen gerade.`}
			{:else}
				Alle Abnahmen, die Claudio durchgeführt hat, die neuesten zuerst.
			{/if}
		</p>
	</div>
	<a class="btn primary" href="/repos">Review starten</a>
</div>

{#each data.analyses as a (a.id)}
	<p class="notice analysis">
		Analyse von {a.repo} {a.status === 'queued' ? 'wartet auf den Worker' : 'läuft'}. <a href="/analyses/{a.id}">Verlauf ansehen</a>
	</p>
{/each}

{#if data.reviews.length > 0}
	<section class="sheet table">
		<ReviewTable reviews={data.reviews} />
	</section>
{:else}
	<section class="empty sheet">
		<h2>Noch keine Reviews</h2>
		{#if data.repoCount === 0}
			<p class="muted">Füge zuerst ein Repository hinzu. Danach kannst du für jeden offenen Pull Request einen Review starten.</p>
			<a class="btn primary" href="/repos">Repository hinzufügen</a>
		{:else}
			<p class="muted">Wähle ein Repository und einen offenen Pull Request, um den ersten Review zu starten.</p>
			<a class="btn primary" href="/repos">Repository wählen</a>
		{/if}
	</section>
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}
	.head h1 {
		margin-bottom: 0.25rem;
	}
	.analysis {
		margin-bottom: 1rem;
	}
	.table {
		padding: 0.25rem 0.5rem;
	}
	.empty {
		padding: 2rem;
		display: grid;
		gap: 0.75rem;
		justify-items: start;
		max-width: 36rem;
	}
</style>
