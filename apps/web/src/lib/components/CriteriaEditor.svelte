<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import Icon from './Icon.svelte';

	/**
	 * The acceptance criteria of a review, edited before it starts. Claudio can
	 * propose them from the ticket; each one goes into the form as a `criteria` field.
	 * Empty means the agent derives them itself, as before.
	 */
	let {
		initial = [],
		repo,
		pr,
		followUpOf = null,
		language
	}: { initial?: string[]; repo: string; pr: number; followUpOf?: number | null; language: string } = $props();
	const i = i18n();

	// The list starts from `initial` once; afterwards it is the person's (the page re-creates the editor to reset it).
	// svelte-ignore state_referenced_locally
	let items = $state(initial.map((text, k) => ({ key: k, text })));
	// svelte-ignore state_referenced_locally
	let next = initial.length;
	let busy = $state(false);
	let remarks = $state('');
	let error = $state<string | null>(null);
	let list = $state<HTMLElement>();

	function add(text = '', focus = true) {
		items.push({ key: next++, text });
		if (focus) requestAnimationFrame(() => (list?.querySelector<HTMLTextAreaElement>('li:last-child textarea'))?.focus());
	}
	function remove(key: number) {
		items = items.filter((it) => it.key !== key);
	}
	function move(k: number, dir: -1 | 1) {
		const j = k + dir;
		if (j < 0 || j >= items.length) return;
		[items[k], items[j]] = [items[j]!, items[k]!];
	}

	async function propose() {
		if (items.some((it) => it.text.trim()) && !confirm(i.t('review.criteriaReplace'))) return;
		busy = true;
		error = null;
		remarks = '';
		try {
			const res = await fetch('/reviews/new/criteria', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ repo, pr, followUpOf, language })
			});
			const data = (await res.json().catch(() => ({}))) as { criteria?: string[]; remarks?: string; error?: string; message?: string };
			if (!res.ok || !data.criteria) throw new Error(data.error ?? data.message ?? String(res.status));
			items = data.criteria.map((text) => ({ key: next++, text }));
			remarks = data.remarks ?? '';
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	// Grow with the text, so a criterion is readable at once.
	function autosize(el: HTMLTextAreaElement) {
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight + 2}px`;
		};
		fit();
		el.addEventListener('input', fit);
		return { destroy: () => el.removeEventListener('input', fit) };
	}
</script>

<fieldset class="criteria">
	<legend>{i.t('review.criteria')}</legend>
	<p class="hint">{items.length ? i.t('review.criteriaHintSet') : i.t('review.criteriaHintEmpty')}</p>

	{#if items.length}
		<ol bind:this={list}>
			{#each items as it, k (it.key)}
				<li>
					<span class="n" aria-hidden="true">{k + 1}</span>
					<textarea name="criteria" rows="1" bind:value={it.text} use:autosize aria-label={i.t('review.criterionN', { n: k + 1 })}></textarea>
					<span class="tools">
						<button type="button" class="btn ghost small" title={i.t('review.moveUp')} aria-label={i.t('review.moveUp')} disabled={k === 0} onclick={() => move(k, -1)}>↑</button>
						<button type="button" class="btn ghost small" title={i.t('review.moveDown')} aria-label={i.t('review.moveDown')} disabled={k === items.length - 1} onclick={() => move(k, 1)}>↓</button>
						<button type="button" class="btn ghost small" title={i.t('review.removeCriterion')} aria-label={i.t('review.removeCriterion')} onclick={() => remove(it.key)}><Icon name="x" size={12} /></button>
					</span>
				</li>
			{/each}
		</ol>
	{/if}

	{#if remarks}<p class="notice">{remarks}</p>{/if}
	{#if error}<p class="notice error" role="alert">{error}</p>{/if}

	<div class="actions">
		<button type="button" class="btn small" onclick={propose} disabled={busy}>{busy ? i.t('review.criteriaProposing') : i.t('review.criteriaPropose')}</button>
		<button type="button" class="btn ghost small" onclick={() => add()}><Icon name="plus" size={12} /> {i.t('review.addCriterion')}</button>
		{#if items.length}<button type="button" class="btn ghost small" onclick={() => (items = [])}>{i.t('review.clearCriteria')}</button>{/if}
	</div>
</fieldset>

<style>
	.hint {
		color: var(--ink-3);
		font-size: var(--text-xs);
	}
	ol {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr) auto;
		gap: 0.4rem;
		align-items: start;
	}
	.n {
		padding-top: 0.35rem;
		text-align: right;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}
	textarea {
		min-height: var(--control-h);
		resize: none;
		overflow: hidden;
	}
	.tools {
		display: flex;
		gap: 0.1rem;
		padding-top: 0.1rem;
	}
	.notice {
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
</style>
