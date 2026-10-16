<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import LocaleSwitch from '#lib/components/LocaleSwitch.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const i = i18n();
</script>

<svelte:head><title>{i.t('common.loginTitle')}</title></svelte:head>

<div class="wrap">
	<section class="card sheet">
		<div class="mark">
			<img src={favicon} alt="" width="36" height="36" />
			<span>Claudio</span>
			<span class="lang"><LocaleSwitch /></span>
		</div>
		<h1>{i.t('common.loginHeadline')}</h1>
		<p class="muted">
			{i.t('common.loginIntro')}
		</p>

		{#if data.error}
			<p class="notice error" role="alert">{data.error}</p>
		{/if}

		<a
			class="btn primary gh"
			href="/auth/github?next={encodeURIComponent(data.next)}"
			aria-disabled={!data.configured}
		>
			<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"
				><path
					fill="currentColor"
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/></svg
			>
			{i.t('common.signInGithub')}
		</a>
		{#if !data.configured}
			<p class="faint">
				{i.t('common.loginNotConfiguredBefore')}
				<code>.env</code> {i.t('common.loginNotConfiguredAfter')}
			</p>
		{/if}

		{#if data.devLogin}
			<form method="POST" action="/auth/dev" class="dev">
				<button class="btn" type="submit">{i.t('common.devLogin')}</button>
				<p class="faint">{i.t('common.devLoginHintBefore')} <code>CLAUDIO_DEV_FIXTURES=1</code>{i.t('common.devLoginHintAfter')}</p>
			</form>
		{/if}
	</section>
</div>

<style>
	.wrap {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 1.5rem 1rem;
	}
	.card {
		width: min(24rem, 100%);
		padding: 1.75rem;
		display: grid;
		gap: 1rem;
		box-shadow: var(--shadow);
	}
	.mark {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
		font-size: var(--text-sm);
	}
	.mark img {
		width: 22px;
		height: 22px;
		border-radius: 5px;
	}
	.lang {
		margin-left: auto;
	}
	h1 {
		font-size: 1.125rem;
		line-height: 1.3;
	}
	.gh {
		height: 2rem;
	}
	.dev {
		display: grid;
		gap: 0.4rem;
		padding-top: 1rem;
		border-top: 1px solid var(--rule);
	}
</style>
