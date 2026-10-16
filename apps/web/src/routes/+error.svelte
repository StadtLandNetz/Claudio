<script lang="ts">
	import { page } from '$app/state';
	import { i18n } from '#lib/i18n/index.js';

	const i = i18n();
</script>

<svelte:head><title>{page.status} · Claudio</title></svelte:head>

<section class="err">
	<h1>{page.status === 404 ? i.t('common.errorNotFound') : i.t('common.errorGeneric')}</h1>
	<p class="muted">{page.error?.message}</p>
	<a class="btn" href="/">{i.t('common.toOverview')}</a>
</section>

<style>
	.err {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		max-width: 36rem;
		padding: 1.5rem 0;
	}
	.err .btn {
		margin-top: 0.5rem;
	}
</style>
