<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · Claudio</title></svelte:head>

<section class="err">
	<h1>{page.status === 404 ? 'Nicht gefunden' : 'Etwas ist schiefgelaufen'}</h1>
	<p class="muted">{page.error?.message}</p>
	<a class="btn" href="/">Zur Übersicht</a>
</section>

<style>
	.err {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
		max-width: 36rem;
		padding: 2rem 1rem;
	}
</style>
