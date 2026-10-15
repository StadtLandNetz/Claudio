<script lang="ts">
	import { enhance } from '$app/forms';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import { DEFAULT_TEST_BUDGET } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = i18n();
	const s = $derived(data.script);
	let starting = $state(false);
	let compare = $state<number[]>([]);
	const formError = (name: string) => (form && 'error' in form && form.form === name ? form.error : null);

	function toggleCompare(id: number, on: boolean) {
		compare = on ? [...compare.filter((x) => x !== id), id].slice(-2) : compare.filter((x) => x !== id);
	}
</script>

<svelte:head><title>{i.t('test.pageTitle', { name: s.name })}</title></svelte:head>

<p class="crumb"><a href="/repos/{s.repo}?tab=tests">{i.t('test.allTests')}</a></p>
<h1>{s.name}</h1>
<p class="kind">
	{#if s.determinism}
		<strong>{i.labels.determinism[s.determinism]}.</strong> <span class="muted">{i.labels.determinismHelp[s.determinism]}</span>
	{:else}
		<span class="muted">{i.t('test.notRecordedYet')}</span>
	{/if}
	{#if s.runInReviews}<span class="tag">{i.t('test.tagRunInReviews')}</span>{/if}
	{#if s.allowAnyHost}<span class="tag">{i.t('test.tagAnyHost')}</span>{:else if s.allowedHosts.length}<span class="tag">{i.t('test.tagAllowedHosts', { hosts: s.allowedHosts.join(', ') })}</span>{/if}
</p>

{#if data.isNew}
	<p class="notice ok">{i.t('test.created')}</p>
{/if}

<div class="layout">
	<div class="main">
		<section class="block">
			<h2>{i.t('test.flow')}</h2>
			<p class="pre">{s.description}</p>
			<h3>{i.t('test.expectedResult')}</h3>
			<p class="pre">{s.expectation}</p>
		</section>

		<section class="block">
			<div class="row">
				<h2>{i.t('test.recordedSteps')}</h2>
				{#if s.steps.length}
					<span class="faint">{i.t('test.stepsVersion', { version: s.stepsVersion, date: i.formatDate(s.stepsUpdatedAt) })}</span>
				{/if}
			</div>
			{#if s.steps.length}
				<ol class="steps sheet">
					{#each s.steps as step, i (i)}
						<li class:assert={step.assertion}>{step.text}</li>
					{/each}
				</ol>
				<form method="POST" action="?/reset" use:enhance>
					<button class="btn small" type="submit">{i.t('test.discardRecording')}</button>
					<span class="faint">{i.t('test.discardRecordingHint')}</span>
				</form>
			{:else}
				<p class="muted">{i.t('test.noStepsYet')}</p>
			{/if}
		</section>

		<section class="block">
			<div class="row">
				<h2>{i.t('test.runs')}</h2>
				{#if data.runs.length > 1}
					<a
						class="btn small"
						class:disabled={compare.length !== 2}
						aria-disabled={compare.length !== 2}
						href={compare.length === 2 ? `/tests/${s.id}/compare?a=${Math.min(...compare)}&b=${Math.max(...compare)}` : undefined}
					>
						{i.t('test.compareSelected')}
					</a>
				{/if}
			</div>
			{#if data.runs.length}
				<div class="sheet table">
					<table class="list">
						<thead>
							<tr>
								<th><span class="visually-hidden">{i.t('test.colCompare')}</span></th>
								<th>{i.t('test.colStarted')}</th>
								<th>{i.t('test.colResult')}</th>
								<th>{i.t('test.colKind')}</th>
								<th class="num">{i.t('test.colDuration')}</th>
								<th class="num">{i.t('test.colCost')}</th>
							</tr>
						</thead>
						<tbody>
							{#each data.runs as run (run.id)}
								<tr>
									<td>
										<input
											type="checkbox"
											aria-label={i.t('test.compareRunLabel', { date: i.formatDate(run.createdAt) })}
											checked={compare.includes(run.id)}
											onchange={(e) => toggleCompare(run.id, e.currentTarget.checked)}
										/>
									</td>
									<td>
										<a href="/test-runs/{run.id}">{i.formatDate(run.createdAt)}</a>
										<span class="faint">{run.reviewId ? i.t('test.inReview', { id: run.reviewId }) : i.t('test.byUser', { login: run.startedBy ?? '' })}</span>
									</td>
									<td><OutcomeBadge status={run.status} outcome={run.outcome} healed={run.healed} /></td>
									<td>{run.mode ? i.labels.mode[run.mode] : '–'}{run.mode === 'replay' && run.stepsVersion ? ` v${run.stepsVersion}` : ''}</td>
									<td class="num">{run.durationMs !== null ? i.formatDuration(run.durationMs) : '–'}</td>
									<td class="num">{i.formatUsd(run.costUsd)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="muted">{i.t('test.noRunsYet')}</p>
			{/if}
		</section>
	</div>

	<aside class="side">
		<form method="POST" action="?/run" class="sheet run" onsubmit={() => (starting = true)}>
			<h2>{i.t('test.runTest')}</h2>
			{#if formError('run')}<p class="notice error" role="alert">{formError('run')}</p>{/if}
			<label class="field">
				<span>{i.t('test.instanceUrl')}</span>
				<input type="url" name="instanceUrl" required value={data.defaultInstanceUrl} placeholder="https://staging.example.de" />
			</label>
			<label class="field">
				<span>{i.t('test.budget')}</span>
				<select name="budget">
					{#each Object.entries(i.labels.testBudget) as [value, label] (value)}
						<option {value} selected={value === DEFAULT_TEST_BUDGET}>{label}</option>
					{/each}
				</select>
			</label>
			{#if s.steps.length}
				<label class="check">
					<input type="checkbox" name="rerecord" />
					<span>{i.t('test.rerecord')}</span>
				</label>
			{/if}
			<button class="btn primary" type="submit" disabled={starting}>
				{starting ? i.t('test.queueing') : s.steps.length ? i.t('test.run') : i.t('test.startFirstRun')}
			</button>
		</form>
	</aside>
</div>

<details class="sheet edit" open={!!formError('update')}>
	<summary><strong>{i.t('test.editTest')}</strong></summary>
	<form method="POST" action="?/update" class="fields" use:enhance={() => ({ update }) => update({ reset: false })}>
		{#if formError('update')}<p class="notice error" role="alert">{formError('update')}</p>{/if}
		<label class="field"><span>{i.t('test.name')}</span><input type="text" name="name" value={s.name} required /></label>
		<label class="field"><span>{i.t('test.flow')}</span><textarea name="description" rows="3" required>{s.description}</textarea></label>
		<label class="field"><span>{i.t('test.expectedResult')}</span><textarea name="expectation" rows="2" required>{s.expectation}</textarea></label>
		<fieldset>
			<legend>{i.t('test.roles')}</legend>
			<div class="options">
				{#each data.roles as role (role)}
					<label class="check"><input type="checkbox" name="roles" value={role} checked={s.roles.includes(role)} /> <span>{role}</span></label>
				{/each}
			</div>
		</fieldset>
		<label class="field">
			<span>{i.t('test.testKind')}</span>
			<select name="determinism">
				<option value="" selected={!s.determinism}>{i.t('test.suggestOnFirstRun')}</option>
				{#each Object.entries(i.labels.determinism) as [value, label] (value)}
					<option {value} selected={s.determinism === value}>{label}</option>
				{/each}
			</select>
			<small>{i.t('test.testKindHint')}</small>
		</label>
		<fieldset>
			<legend>{i.t('test.otherWebsites')}</legend>
			<label class="field">
				<span>{i.t('test.allowedHosts')}</span>
				<input type="text" name="allowedHosts" value={s.allowedHosts.join(', ')} placeholder="google.com, login.example.de" />
				<small>{i.t('test.allowedHostsHint')}</small>
			</label>
			<label class="check">
				<input type="checkbox" name="allowAnyHost" checked={s.allowAnyHost} />
				<span>{i.t('test.allowAnyHost')} <span class="faint">{i.t('test.allowAnyHostHint')}</span></span>
			</label>
		</fieldset>
		<label class="check">
			<input type="checkbox" name="runInReviews" checked={s.runInReviews} />
			<span>{i.t('test.runInReviews')}</span>
		</label>
		<div class="actions"><button class="btn primary" type="submit">{i.t('test.save')}</button></div>
	</form>
	<form method="POST" action="?/delete" class="danger" onsubmit={(e) => { if (!confirm(i.t('test.confirmDelete'))) e.preventDefault(); }}>
		<button class="btn danger small" type="submit">{i.t('test.deleteTest')}</button>
	</form>
</details>

<style>
	.crumb {
		font-size: 0.875rem;
		margin-bottom: 0.25rem;
	}
	.kind {
		margin: 0.4rem 0 1.5rem;
		max-width: 52rem;
	}
	.tag {
		font-size: 0.8125rem;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		margin-left: 0.4rem;
		white-space: nowrap;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 18rem;
		gap: 2.5rem;
		align-items: start;
	}
	.main {
		display: grid;
		gap: 2rem;
		min-width: 0;
	}
	.block {
		display: grid;
		gap: 0.6rem;
	}
	.block h3 {
		margin-top: 0.4rem;
	}
	.pre {
		white-space: pre-wrap;
		max-width: 46rem;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.steps {
		margin: 0;
		padding: 0.75rem 1rem 0.75rem 2.5rem;
		display: grid;
		gap: 0.3rem;
		font-size: 0.9375rem;
	}
	.steps li.assert {
		color: var(--pass);
		font-weight: 600;
	}
	.btn.disabled {
		opacity: 0.5;
		pointer-events: none;
	}
	.table {
		padding: 0.25rem 0.5rem;
		overflow-x: auto;
	}
	.side {
		position: sticky;
		top: 1.5rem;
	}
	.run {
		padding: 1.25rem;
		display: grid;
		gap: 0.9rem;
	}
	.run h2 {
		font-size: 1.0625rem;
	}
	.edit {
		margin-top: 2.5rem;
		max-width: 46rem;
	}
	.edit summary {
		padding: 0.8rem 1rem;
		cursor: pointer;
	}
	.edit[open] summary {
		border-bottom: 1px solid var(--rule);
	}
	.fields {
		display: grid;
		gap: 1rem;
		padding: 1.25rem;
	}
	.danger {
		padding: 0 1.25rem 1.25rem;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	legend {
		font-weight: 600;
		font-size: 0.9375rem;
		margin-bottom: 0.4rem;
		padding: 0;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
	}
	@media (max-width: 980px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.side {
			position: static;
			order: -1;
		}
	}
</style>
