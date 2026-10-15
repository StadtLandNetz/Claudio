<script lang="ts">
	import { page } from '$app/state';
	import { LOCALES, LOCALE_NAME, i18n } from '#lib/i18n/index.js';

	const i = i18n();
</script>

<!-- A plain form (no enhance): the page reloads in the new language, server texts included. -->
<form method="POST" action="/locale" class="switch" aria-label={i.t('common.language')}>
	<input type="hidden" name="redirectTo" value={page.url.pathname + page.url.search} />
	{#each LOCALES as locale (locale)}
		<button type="submit" name="locale" value={locale} lang={locale} aria-pressed={i.locale === locale} title={LOCALE_NAME[locale]}>
			{locale.toUpperCase()}
		</button>
	{/each}
</form>

<style>
	.switch {
		display: inline-flex;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		overflow: hidden;
	}
	button {
		font: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.15rem 0.55rem;
		border: 0;
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		background: var(--petrol);
		color: var(--petrol-ink);
	}
	button:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: -3px;
	}
</style>
