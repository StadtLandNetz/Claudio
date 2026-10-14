<script lang="ts">
	import { BUDGET_LABEL, STRICTNESS_LABEL, VERBOSITY_LABEL } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Review starten · Claudio</title></svelte:head>

<h1>Review starten</h1>

{#if data.pr}
	<p class="pr">
		<a href={data.pr.url} target="_blank" rel="noopener noreferrer">#{data.prNumber} {data.pr.title}</a>
		<span class="faint">Branch {data.pr.headRef}</span>
	</p>
{:else}
	<p class="notice error">{data.prError ?? `Pull Request #${data.prNumber} wurde nicht gefunden.`}</p>
{/if}

<form method="POST" class="sheet form" onsubmit={() => (submitting = true)}>
	{#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}

	<label class="field">
		<span>Adresse der Instanz</span>
		<input type="url" name="instanceUrl" required value={data.defaultInstanceUrl} placeholder="https://pr-{data.prNumber}.preview.example.de" />
		<small>
			Wo der Branch dieses Pull Requests läuft. Der Browser bleibt auf diesem Host.
			{#if data.instanceSource}Vorgeschlagen {data.instanceSource}.{/if}
			{#if data.instanceNote}{data.instanceNote}{/if}
		</small>
	</label>

	<fieldset>
		<legend>Anmelden als</legend>
		<div class="options">
			{#each data.roles as role, i (role.name)}
				<label class="check">
					<input type="checkbox" name="roles" value={role.name} checked={i === 0} />
					<span>{role.name}{#if role.description}<span class="faint"> {role.description}</span>{/if}</span>
				</label>
			{/each}
		</div>
		<small>Claudio startet mit diesen Rollen und darf bei Bedarf zu den anderen wechseln.</small>
	</fieldset>

	<div class="grid">
		<label class="field">
			<span>Budget</span>
			<select name="budget">
				{#each Object.entries(BUDGET_LABEL) as [value, label] (value)}
					<option {value} selected={value === 'standard'}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>Strenge</span>
			<select name="strictness">
				{#each Object.entries(STRICTNESS_LABEL) as [value, label] (value)}
					<option {value} selected={value === 'normal'}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>Ausführlichkeit des Berichts</span>
			<select name="verbosity">
				{#each Object.entries(VERBOSITY_LABEL) as [value, label] (value)}
					<option {value} selected={value === 'normal'}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>Sprache des Berichts</span>
			<select name="language">
				<option value="de" selected>Deutsch</option>
				<option value="en">Englisch</option>
			</select>
		</label>
	</div>

	<label class="field">
		<span>Zusätzliche Anweisungen (optional)</span>
		<textarea name="extraInstructions" rows="3" placeholder="z. B. Besonders auf die Druckansicht achten."></textarea>
	</label>

	{#if data.reviewTests.length}
		<label class="check">
			<input type="checkbox" name="runTests" checked />
			<span>
				{data.reviewTests.length === 1 ? 'Regressionstest' : `${data.reviewTests.length} Regressionstests`} mitlaufen lassen
				<span class="faint">{data.reviewTests.join(', ')}</span>
			</span>
		</label>
	{/if}

	<label class="check">
		<input type="checkbox" name="postComment" />
		<span>Kurzfassung als Kommentar in den Pull Request schreiben</span>
	</label>

	<div class="actions">
		<button class="btn primary" type="submit" disabled={!data.pr || submitting}>
			{submitting ? 'Wird eingereiht …' : 'Review starten'}
		</button>
		<span class="faint">Strenge und Ausführlichkeit lassen sich nach dem Review noch ändern.</span>
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
