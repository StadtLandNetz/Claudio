<script lang="ts">
	import CriteriaEditor from '#lib/components/CriteriaEditor.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = i18n();
	let submitting = $state(false);
	// A pull request that was reviewed before: by default only what changed is checked again.
	// svelte-ignore state_referenced_locally
	let followUp = $state(Boolean(data.previous));
</script>

<svelte:head><title>{i.t('review.start')} · Claudio</title></svelte:head>

<div class="page-title">
	<div>
		<p class="crumbs"><a href="/repos/{data.repo}?tab=pulls">{data.repo}</a></p>
		<h1>{i.t('review.start')}</h1>
		{#if data.pr}
			<p class="lead pr">
				<a href={data.pr.url} target="_blank" rel="noopener noreferrer">#{data.prNumber} {data.pr.title}</a>
				<span class="faint">{i.t('review.branch', { ref: data.pr.headRef })}</span>
			</p>
		{/if}
	</div>
</div>

{#if !data.pr}
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

	{#if data.previous}
		<label class="check followup">
			<input type="checkbox" name="followUp" bind:checked={followUp} />
			<span>
				{i.t('review.followUpOption', { id: data.previous.id })}
				<span class="faint">
					{i.t('review.followUpMeta', {
						date: i.formatDate(data.previous.createdAt),
						verdict: i.labels.verdict[data.previous.verdict],
						n: data.previous.openFindings
					})}
				</span>
				<span class="faint">{i.t('review.followUpHint')}</span>
			</span>
		</label>
	{/if}

	{#key followUp}
		<CriteriaEditor
			repo={data.repo}
			pr={data.prNumber}
			followUpOf={followUp ? (data.previous?.id ?? null) : null}
			initial={followUp ? (data.previous?.criteria ?? []) : []}
			language={i.locale}
		/>
	{/key}

	<div class="grid">
		<label class="field">
			<span>{i.t('review.budget')}</span>
			<select name="budget">
				{#each Object.entries(i.labels.budget) as [value, label] (value)}
					<option {value} selected={value === (followUp ? 'quick' : 'standard')}>{label}</option>
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
		display: flex;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		flex-wrap: wrap;
	}
	.pr a {
		color: var(--ink);
		font-weight: 500;
	}
	.notice {
		margin-bottom: 1rem;
	}
	.form {
		display: grid;
		gap: 0.9rem;
		padding: 1rem;
		max-width: 46rem;
	}
	.form .notice {
		margin: 0;
	}
	fieldset {
		display: grid;
		gap: 0.4rem;
	}
	legend {
		margin-bottom: 0.4rem;
	}
	fieldset small {
		color: var(--ink-3);
		font-size: var(--text-xs);
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.25rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.9rem;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.followup {
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: var(--radius-s);
		background: var(--accent-soft);
	}
	.followup .faint {
		display: block;
	}
	/* The role description follows the name inline */
	.options .faint {
		margin-left: 0.3rem;
	}
</style>
