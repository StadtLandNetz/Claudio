<script lang="ts">
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = i18n();
	let submitting = $state(false);
</script>

<svelte:head><title>{i.t('review.start')} · Claudio</title></svelte:head>

<h1>{i.t('review.start')}</h1>

{#if data.pr}
	<p class="pr">
		<a href={data.pr.url} target="_blank" rel="noopener noreferrer">#{data.prNumber} {data.pr.title}</a>
		<span class="faint">{i.t('review.branch', { ref: data.pr.headRef })}</span>
	</p>
{:else}
	<p class="notice error">{data.prError ?? i.t('review.prNotFound', { n: data.prNumber })}</p>
{/if}

<form method="POST" class="sheet form" onsubmit={() => (submitting = true)}>
	{#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}

	<label class="field">
		<span>{i.t('review.instanceUrl')}</span>
		<input type="url" name="instanceUrl" required value={data.defaultInstanceUrl} placeholder="https://pr-{data.prNumber}.preview.example.de" />
		<small>
			{i.t('review.instanceUrlHelp')}
			{#if data.instanceSource}{i.t('review.suggested', { source: data.instanceSource })}{/if}
			{#if data.instanceNote}{data.instanceNote}{/if}
		</small>
	</label>

	<fieldset>
		<legend>{i.t('review.signInAs')}</legend>
		<div class="options">
			{#each data.roles as role, n (role.name)}
				<label class="check">
					<input type="checkbox" name="roles" value={role.name} checked={n === 0} />
					<span>{role.name}{#if role.description}<span class="faint"> {role.description}</span>{/if}</span>
				</label>
			{/each}
		</div>
		<small>{i.t('review.rolesHelp')}</small>
	</fieldset>

	<div class="grid">
		<label class="field">
			<span>{i.t('review.budget')}</span>
			<select name="budget">
				{#each Object.entries(i.labels.budget) as [value, label] (value)}
					<option {value} selected={value === 'standard'}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>{i.t('review.strictness')}</span>
			<select name="strictness">
				{#each Object.entries(i.labels.strictness) as [value, label] (value)}
					<option {value} selected={value === 'normal'}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>{i.t('review.verbosity')}</span>
			<select name="verbosity">
				{#each Object.entries(i.labels.verbosity) as [value, label] (value)}
					<option {value} selected={value === 'normal'}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>{i.t('review.reportLanguage')}</span>
			<select name="language">
				{#each Object.entries(i.labels.reportLanguage) as [value, label] (value)}
					<option {value} selected={value === i.locale}>{label}</option>
				{/each}
			</select>
		</label>
	</div>

	<label class="field">
		<span>{i.t('review.extraInstructions')}</span>
		<textarea name="extraInstructions" rows="3" placeholder={i.t('review.extraInstructionsPlaceholder')}></textarea>
	</label>

	{#if data.reviewTests.length}
		<label class="check">
			<input type="checkbox" name="runTests" checked />
			<span>
				{i.t('review.runTests', { n: data.reviewTests.length })}
				<span class="faint">{data.reviewTests.join(', ')}</span>
			</span>
		</label>
	{/if}

	<label class="check">
		<input type="checkbox" name="postComment" />
		<span>{i.t('review.postComment')}</span>
	</label>

	<div class="actions">
		<button class="btn primary" type="submit" disabled={!data.pr || submitting}>
			{submitting ? i.t('review.queueing') : i.t('review.start')}
		</button>
		<span class="faint">{i.t('review.changeLater')}</span>
	</div>
</form>

<style>
	.pr {
		margin: 0.5rem 0 1.5rem;
		display: grid;
	}
	.pr a {
		font-weight: 700;
		font-size: 1.0625rem;
		color: var(--ink);
	}
	.form {
		padding: 1.5rem;
		display: grid;
		gap: 1.25rem;
		max-width: 46rem;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	legend {
		font-weight: 600;
		font-size: 0.9375rem;
		margin-bottom: 0.4rem;
		padding: 0;
	}
	fieldset small {
		color: var(--ink-3);
		font-size: 0.8125rem;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 1rem;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
</style>
