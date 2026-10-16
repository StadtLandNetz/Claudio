<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import Icon from './Icon.svelte';

	type Theme = 'system' | 'light' | 'dark';
	// app.html reads the same key before the first paint.
	const KEY = 'claudio_theme';
	const i = i18n();

	let theme = $state<Theme>('system');
	$effect(() => {
		try {
			const saved = localStorage.getItem(KEY);
			if (saved === 'light' || saved === 'dark') theme = saved;
		} catch {}
	});

	function choose(next: Theme) {
		theme = next;
		const root = document.documentElement;
		try {
			if (next === 'system') {
				delete root.dataset.theme;
				localStorage.removeItem(KEY);
			} else {
				root.dataset.theme = next;
				localStorage.setItem(KEY, next);
			}
		} catch {}
	}

	const options = [
		{ id: 'system', icon: 'monitor', label: 'common.themeSystem' },
		{ id: 'light', icon: 'sun', label: 'common.themeLight' },
		{ id: 'dark', icon: 'moon', label: 'common.themeDark' }
	] as const;
</script>

<div class="seg" role="group" aria-label={i.t('common.theme')}>
	{#each options as o (o.id)}
		<button type="button" aria-pressed={theme === o.id} aria-label={i.t(o.label)} title={i.t(o.label)} onclick={() => choose(o.id)}>
			<Icon name={o.icon} size={14} />
		</button>
	{/each}
</div>
