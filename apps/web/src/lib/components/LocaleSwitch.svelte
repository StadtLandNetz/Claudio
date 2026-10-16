<script lang="ts">
	import { page } from '$app/state';
	import { LOCALES, LOCALE_NAME, i18n } from '#lib/i18n/index.js';

	const i = i18n();
</script>

<!-- A plain form (no enhance): the page reloads in the new language, server texts included. Styled by .seg in app.css. -->
<form method="POST" action="/locale" class="seg" aria-label={i.t('common.language')}>
	<input type="hidden" name="redirectTo" value={page.url.pathname + page.url.search} />
	{#each LOCALES as locale (locale)}
		<button type="submit" name="locale" value={locale} lang={locale} aria-pressed={i.locale === locale} title={LOCALE_NAME[locale]}>
			{locale.toUpperCase()}
		</button>
	{/each}
</form>
