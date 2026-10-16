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

<div class="page-title">
	<div>
		<p class="crumbs">
			<a href="/repos/{s.repo}">{s.repo}</a><span class="sep"></span><a href="/repos/{s.repo}?tab=tests">{i.t('test.allTests')}</a>
		</p>
		<h1>{s.name}</h1>
		<p class="lead kind">
			{#if s.determinism}
				<strong>{i.labels.determinism[s.determinism]}.</strong> <span class="muted">{i.labels.determinismHelp[s.determinism]}</span>
			{:else}
				<span class="muted">{i.t('test.notRecordedYet')}</span>
			{/if}
			{#if s.runInReviews}<span class="tag">{i.t('test.tagRunInReviews')}</span>{/if}
			{#if s.allowAnyHost}<span class="tag">{i.t('test.tagAnyHost')}</span>{:else if s.allowedHosts.length}<span class="tag">{i.t('test.tagAllowedHosts', { hosts: s.allowedHosts.join(', ') })}</span>{/if}
		</p>
	</div>
</div>

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
						<li class:assert={step.assertion}>
							<span class="mark" aria-hidden="true"></span>
							{step.text}
						</li>
					{/each}
				</ol>
				<form method="POST" action="?/reset" class="reset" use:enhance>
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
									<td class="pick">
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
	.page-title h1 {
		max-width: 46rem;
	}
	.kind strong {
		font-weight: 500;
		color: var(--ink);
	}
	.kind .tag {
		margin-left: 0.3rem;
	}
	/* Only the notice above the layout needs its own spacing; the forms space theirs. */
	.notice {
		margin-bottom: 1.25rem;
	}
	.run .notice,
	.fields .notice {
		margin-bottom: 0;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 16rem;
		gap: 2.5rem;
		align-items: start;
	}
	.main {
		display: grid;
		gap: 1.75rem;
		min-width: 0;
	}
	.block {
		display: grid;
		gap: 0.6rem;
	}
	.block h3 {
		margin-top: 0.4rem;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.pre {
		white-space: pre-wrap;
		max-width: 46rem;
		font-size: var(--text-md);
		line-height: 1.6;
	}

	/* Recorded steps: number, assertion dot, text */
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		counter-reset: step;
	}
	.steps li {
		display: grid;
		grid-template-columns: 1.5rem 0.5rem minmax(0, 1fr);
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		counter-increment: step;
		overflow-wrap: anywhere;
	}
	.steps li:last-child {
		border-bottom: 0;
	}
	.steps li::before {
		content: counter(step);
		text-align: right;
		font-size: var(--text-xs);
		line-height: 1.625;
		color: var(--ink-3);
	}
	.mark {
		align-self: start;
		width: 0.5rem;
		height: 0.5rem;
		margin-top: 0.35rem;
		border-radius: 50%;
	}
	/* Assertions were green before; a dot carries that now. */
	.assert {
		font-weight: 500;
	}
	.assert .mark {
		background: var(--pass);
	}
	.reset {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.btn.disabled {
		opacity: 0.5;
		pointer-events: none;
	}
	.pick {
		width: 1.5rem;
		padding-right: 0;
	}
	.pick input {
		display: block;
		margin: 0.15rem 0 0;
		accent-color: var(--accent);
	}
	table.list td > a {
		color: var(--ink);
		font-weight: 500;
	}
	table.list td > .faint {
		display: block;
	}

	/* Side column */
	.side {
		position: sticky;
		top: 1.5rem;
	}
	.run {
		padding: 1rem;
		display: grid;
		gap: 0.9rem;
	}

	.edit {
		margin-top: 1.75rem;
		max-width: 46rem;
	}
	.edit summary strong {
		font-weight: 500;
	}
	.fields {
		display: grid;
		gap: 0.9rem;
		padding: 1rem;
	}
	.danger {
		padding: 0 1rem 1rem;
	}
	fieldset {
		display: grid;
		gap: 0.4rem;
	}
	legend {
		margin-bottom: 0.4rem;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.25rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
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
