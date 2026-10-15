<script lang="ts">
	import ReviewTable from '#lib/components/ReviewTable.svelte';
	import { isActive } from '#lib/labels.js';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	const running = $derived(data.reviews.filter((r) => isActive(r.status)).length);
</script>

<svelte:head><title>{i.t('common.overviewTitle')}</title></svelte:head>

<div class="head">
	<div>
		<h1>{i.t('common.reviews')}</h1>
		<p class="muted">
			{#if running > 0}
				{i.t('common.reviewsRunning', { n: running })}
			{:else}
				{i.t('common.reviewsIntro')}
			{/if}
		</p>
	</div>
	<a class="btn primary" href="/repos">{i.t('common.startReview')}</a>
</div>

{#each data.analyses as a (a.id)}
	<p class="notice analysis">
		{a.status === 'queued' ? i.t('common.analysisQueued', { repo: a.repo }) : i.t('common.analysisRunning', { repo: a.repo })} <a href="/analyses/{a.id}">{i.t('common.viewLog')}</a>
	</p>
{/each}

{#if data.reviews.length > 0}
	<section class="sheet table">
		<ReviewTable reviews={data.reviews} />
	</section>
{:else}
	<section class="empty sheet">
		<h2>{i.t('common.noReviews')}</h2>
		{#if data.repoCount === 0}
			<p class="muted">{i.t('common.noReposHint')}</p>
			<a class="btn primary" href="/repos">{i.t('common.addRepo')}</a>
		{:else}
			<p class="muted">{i.t('common.pickRepoHint')}</p>
			<a class="btn primary" href="/repos">{i.t('common.pickRepo')}</a>
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
