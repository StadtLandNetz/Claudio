<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';

	/** Desktop and/or phone, as `viewports` checkboxes. Nothing ticked is stored as desktop. */
	let { selected = ['desktop'], hint = true }: { selected?: readonly string[]; hint?: boolean } = $props();
	const i = i18n();
</script>

<fieldset>
	<legend>{i.t('review.viewports')}</legend>
	<div class="options">
		<label class="check"><input type="checkbox" name="viewports" value="desktop" checked={selected.includes('desktop')} /> <span>{i.t('review.viewportDesktop')}</span></label>
		<label class="check"><input type="checkbox" name="viewports" value="mobile" checked={selected.includes('mobile')} /> <span>{i.t('review.viewportMobile')}</span></label>
	</div>
	{#if hint}<small>{i.t('review.viewportsHint')}</small>{/if}
</fieldset>
