<script lang="ts">
	import ReviewTable from '#lib/components/ReviewTable.svelte';
	import Landing from '#lib/landing/Landing.svelte';
	import { isActive } from '#lib/labels.js';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
	const running = $derived(data.reviews.filter((r) => isActive(r.status)).length);
</script>

<svelte:head>
	{#if data.user}<title>{i.t('common.overviewTitle')}</title>{/if}
</svelte:head>

{#if data.user}
	<div class="page-title">
		<div>
			<h1>{i.t('common.reviews')}</h1>
			<p class="lead">
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
{:else}
	<Landing demoLogin={data.demoLogin ?? false} />
{/if}

<style>
	.analysis {
		margin-bottom: 1rem;
	}
	.empty {
		padding: 1.5rem;
		display: grid;
		gap: 0.6rem;
		justify-items: start;
		max-width: 36rem;
	}
</style>
