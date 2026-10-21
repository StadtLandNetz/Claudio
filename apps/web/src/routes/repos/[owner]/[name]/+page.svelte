<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Icon from '#lib/components/Icon.svelte';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import KnowledgeView from '#lib/components/KnowledgeView.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import ReviewTable from '#lib/components/ReviewTable.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { i18n } from '#lib/i18n/index.js';
	import { DEFAULT_TEST_BUDGET, isActive } from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = i18n();

	const tabs = [
		{ id: 'pulls', label: 'repo.tabPulls' },
		{ id: 'reviews', label: 'repo.tabReviews' },
		{ id: 'tests', label: 'repo.tabTests' },
		{ id: 'knowledge', label: 'repo.tabKnowledge' },
		{ id: 'settings', label: 'repo.tabSettings' }
	] as const;

	const hasKey = $derived(Boolean(data.anthropicKey) || data.keyOptional);
	const ready = $derived(data.repo.dataConfirmed && data.roles.length > 0 && hasKey);
	// What the user may do here follows their permission on GitHub.
	const canWrite = $derived(data.level === 'write' || data.level === 'admin');
	const isAdmin = $derived(data.level === 'admin');
	const saved = $derived(form && 'saved' in form ? form.saved : null);
	const runningAnalysis = $derived(data.analyses.find((a) => isActive(a.status)));
	let analyzing = $state(false);
	let runningTests = $state(false);

	// Suite progress refreshes itself while runs are pending.
	const batchActive = $derived(data.batch?.some((r) => isActive(r.status)) ?? false);
	$effect(() => {
		if (!batchActive) return;
		const t = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(t);
	});
	const formError = (name: string) => (form && 'error' in form && form.form === name ? form.error : null);

	// The "new test" dialog: open after a failed native POST too, so the error is not lost.
	let createOpen = $state(!!formError('createTest'));
	let createError = $state<string | null>(formError('createTest'));
	let creating = $state(false);
</script>

<svelte:head><title>{data.repo.fullName} · Claudio</title></svelte:head>

<div class="page-title">
	<h1>{data.repo.fullName}</h1>
	{#if data.repos.find((r) => r.fullName === data.repo.fullName)?.onGithub}
		<a class="btn ghost small gh" href="https://github.com/{data.repo.fullName}" target="_blank" rel="noopener noreferrer">
			{i.t('common.onGithub')}
			<Icon name="external" size={12} />
		</a>
	{/if}
</div>

<div class="tab-head">
	<h2>{i.t(tabs.find((t) => t.id === data.tab)?.label ?? 'repo.tabPulls')}</h2>
	{#if data.tab === 'tests' && canWrite}
		<button type="button" class="btn primary small" onclick={() => (createOpen = true)}>{i.t('repo.newTest')}</button>
	{/if}
</div>

{#if data.tab === 'pulls'}
	{#if !canWrite}
		<p class="notice">{i.t('repo.readOnly')}</p>
	{:else if !ready}
		<p class="notice">
			{i.t('repo.missingIntro')}
			{[!hasKey && i.t('repo.missingKey'), !data.repo.dataConfirmed && i.t('repo.missingDataConfirmed'), data.roles.length === 0 && i.t('repo.missingRole')].filter(Boolean).join(', ')}.
			{#if isAdmin}<a href="?tab=settings">{i.t('repo.openSettings')}</a>{:else}{i.t('repo.adminCanSetUp')}{/if}
		</p>
	{/if}
	{#if data.pullsError}
		<p class="notice error">{data.pullsError}</p>
	{:else if data.pulls.length === 0}
		<p class="muted">{i.t('repo.noPulls')}</p>
	{:else}
		<ul class="pulls sheet">
			{#each data.pulls as pr (pr.number)}
				<li>
					<div class="pr">
						<a href={pr.url} target="_blank" rel="noopener noreferrer" class="title">#{pr.number} {pr.title}</a>
						<span class="faint">
							{pr.headRef}{pr.author ? i.t('repo.prBy', { author: pr.author }) : ''}{i.t('repo.prUpdated', { date: i.formatDate(pr.updatedAt) })}
							{#if pr.draft}<span class="tag">{i.t('repo.draft')}</span>{/if}
							{#if pr.fixture}<span class="tag">{i.t('repo.demoFixture')}</span>{/if}
						</span>
					</div>
					{#if ready && canWrite}
						<a class="btn small primary" href="/reviews/new?repo={encodeURIComponent(data.repo.fullName)}&pr={pr.number}">{i.t('repo.startReview')}</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{:else if data.tab === 'tests'}
	{#if data.batch}
		{@const done = data.batch.filter((r) => !isActive(r.status)).length}
		<section class="batch">
			<h2>{i.t('repo.suiteRun')}</h2>
			<p class="muted">
				{i.t('repo.batchDone', { done, total: data.batch.length })}{#if done === data.batch.length}{i.t('repo.batchResult', {
						passed: data.batch.filter((r) => r.outcome === 'passed').length,
						failed: data.batch.filter((r) => r.outcome === 'failed').length
					})}{/if}.
			</p>
			<div class="sheet table">
				<table class="list">
					<thead><tr><th>{i.t('repo.colTest')}</th><th>{i.t('repo.colResult')}</th><th>{i.t('repo.colKind')}</th><th class="num">{i.t('repo.colCost')}</th></tr></thead>
					<tbody>
						{#each data.batch as run (run.id)}
							<tr>
								<td><a href="/test-runs/{run.id}">{run.scriptName}</a></td>
								<td><OutcomeBadge status={run.status} outcome={run.outcome} healed={run.healed} /></td>
								<td>{run.mode ? i.labels.mode[run.mode] : '–'}</td>
								<td class="num">{i.formatUsd(run.costUsd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if data.tests.length}
		<div class="sheet table">
			<table class="list">
				<thead>
					<tr><th>{i.t('repo.colTest')}</th><th>{i.t('repo.colKind')}</th><th class="num">{i.t('repo.colSteps')}</th><th>{i.t('repo.colLastRun')}</th><th>{i.t('repo.colInReviews')}</th></tr>
				</thead>
				<tbody>
					{#each data.tests as test (test.id)}
						<tr>
							<td><a href="/tests/{test.id}">{test.name}</a></td>
							<td>{test.determinism ? i.labels.determinism[test.determinism] : i.t('repo.notRecorded')}</td>
							<td class="num">{test.stepCount || '–'}</td>
							<td>
								{#if test.lastStatus}
									<OutcomeBadge status={test.lastStatus} outcome={test.lastOutcome} healed={test.lastHealed} />
									<span class="faint">{i.formatDate(test.lastRunAt)}</span>
								{:else}–{/if}
							</td>
							<td>{test.runInReviews ? i.t('repo.yes') : i.t('repo.no')}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<section class="empty-kb">
			<h2>{i.t('repo.noTests')}</h2>
			<p class="muted">{i.t('repo.noTestsText')}</p>
			{#if canWrite}
				<div><button type="button" class="btn primary" onclick={() => (createOpen = true)}>{i.t('repo.newTest')}</button></div>
			{/if}
		</section>
	{/if}

	{#if data.tests.length && !data.activeTestRuns && canWrite}
		<details class="sheet analyze" open={!!formError('runTests')}>
			<summary><strong>{i.t('repo.runAllTests')}</strong></summary>
			<form method="POST" action="?tab=tests&/runTests" class="fields" onsubmit={() => (runningTests = true)}>
				{#if formError('runTests')}<p class="notice error" role="alert">{formError('runTests')}</p>{/if}
				<label class="field">
					<span>{i.t('repo.instanceUrl')}</span>
					<input type="url" name="instanceUrl" required value={data.repo.defaultInstanceUrl} placeholder="https://staging.example.de" />
				</label>
				<label class="field">
					<span>{i.t('repo.budgetPerTest')}</span>
					<select name="budget">
						{#each Object.entries(i.labels.testBudget) as [value, label] (value)}
							<option {value} selected={value === DEFAULT_TEST_BUDGET}>{label}</option>
						{/each}
					</select>
					<small>{i.t('repo.budgetPerTestHint')}</small>
				</label>
				<div class="actions">
					<button class="btn primary" type="submit" disabled={runningTests}>{runningTests ? i.t('repo.queuing') : i.t('repo.runTestsCount', { n: data.tests.length })}</button>
				</div>
			</form>
		</details>
	{:else if data.activeTestRuns}
		<p class="notice">{i.t('repo.activeTestRuns', { n: data.activeTestRuns })}</p>
	{/if}

	{#if canWrite}
		<Modal bind:open={createOpen} title={i.t('repo.newTest')} width="l" locked={creating} onclose={() => (createError = null)}>
			<form
				id="create-test"
				method="POST"
				action="?tab=tests&/createTest"
				class="fields"
				use:enhance={() => {
					creating = true;
					return async ({ result, update }) => {
						creating = false;
						if (result.type === 'failure') {
							// Stay open with the message; `update()` would replace the page's form data.
							createError = typeof result.data?.error === 'string' ? result.data.error : i.t('repo.checkInput');
							return;
						}
						await update();
					};
				}}
			>
				{#if createError}<p class="notice error" role="alert">{createError}</p>{/if}
				<label class="field">
					<span>{i.t('repo.name')}</span>
					<input type="text" name="name" required placeholder={i.t('repo.testNamePlaceholder')} />
				</label>
				<label class="field">
					<span>{i.t('repo.flow')}</span>
					<textarea name="description" rows="3" required placeholder={i.t('repo.flowPlaceholder')}></textarea>
					<small>{i.t('repo.flowHint')}</small>
				</label>
				<label class="field">
					<span>{i.t('repo.expectation')}</span>
					<textarea name="expectation" rows="2" required placeholder={i.t('repo.expectationPlaceholder')}></textarea>
				</label>
				<fieldset>
					<legend>{i.t('repo.roles')}</legend>
					<div class="options">
						{#each data.roles as role (role.name)}
							<label class="check"><input type="checkbox" name="roles" value={role.name} /> <span>{role.name}</span></label>
						{/each}
					</div>
				</fieldset>
				<fieldset>
					<legend>{i.t('repo.otherSites')}</legend>
					<label class="field">
						<span>{i.t('repo.extraHosts')}</span>
						<input type="text" name="allowedHosts" placeholder="google.com, login.example.de" />
						<small>{i.t('repo.testHostsHint')}</small>
					</label>
					<label class="check">
						<input type="checkbox" name="allowAnyHost" />
						<span>{i.t('repo.allowAnyHost')} <span class="faint">{i.t('repo.allowAnyHostHint')}</span></span>
					</label>
				</fieldset>
				<label class="check">
					<input type="checkbox" name="runInReviews" checked />
					<span>{i.t('repo.runInReviews')}</span>
				</label>
			</form>
			{#snippet footer()}
				<span class="spacer"></span>
				<button type="button" class="btn" onclick={() => (createOpen = false)}>{i.t('common.cancel')}</button>
				<button type="submit" class="btn primary" form="create-test" disabled={creating}>{i.t('repo.createTest')}</button>
			{/snippet}
		</Modal>
	{/if}
{:else if data.tab === 'knowledge'}
	{#if runningAnalysis}
		<p class="notice">
			{runningAnalysis.status === 'queued' ? i.t('repo.analysisQueued') : i.t('repo.analysisRunning')}
			<a href="/analyses/{runningAnalysis.id}">{i.t('repo.viewProgress')}</a>
		</p>
	{/if}

	{#if data.knowledge}
		<div class="kb-head">
			<p>
				{i.t('repo.kbAsOf')} <code>{data.knowledge.commitSha.slice(0, 7)}</code>{data.knowledge.branch ? i.t('repo.kbOnBranch', { branch: data.knowledge.branch }) : ''},
				{i.t('repo.kbAnalyzed', { date: i.formatDate(data.knowledge.analyzedAt), by: data.knowledge.startedBy ?? '' })}
				<a href="/analyses/{data.knowledge.analysisId}">{i.t('repo.viewRun')}</a>
			</p>
			{#if data.knowledge.stale}
				<p class="notice">
					{i.t('repo.staleChanged', { branch: data.knowledge.branch ?? '' })} <code>{data.knowledge.headSha?.slice(0, 7)}</code>{i.t('repo.staleUpdate')}
				</p>
			{/if}
			{#if !data.knowledge.complete}
				<p class="notice">{i.t('repo.kbIncomplete')}</p>
			{/if}
		</div>
		<KnowledgeView docs={data.knowledge.docs} />
		<p class="faint kb-use">{i.t('repo.kbUse')}</p>
	{:else if !runningAnalysis}
		<section class="empty-kb">
			<h2>{i.t('repo.noKb')}</h2>
			<p class="muted">{i.t('repo.noKbText')}</p>
		</section>
	{/if}

	{#if !runningAnalysis && canWrite}
		{#if !ready}
			<p class="notice">
				{i.t('repo.analysisNeedsSetup')} <a href="?tab=settings">{i.t('repo.openSettings')}</a>
			</p>
		{:else}
			<details class="sheet analyze" open={!data.knowledge || !!formError('analyze')}>
				<summary><strong>{data.knowledge ? i.t('repo.updateKb') : i.t('repo.startAnalysis')}</strong></summary>
				<form method="POST" action="?tab=knowledge&/analyze" class="fields" onsubmit={() => (analyzing = true)}>
					{#if formError('analyze')}<p class="notice error" role="alert">{formError('analyze')}</p>{/if}
					<label class="field">
						<span>{i.t('repo.runningInstanceUrl')}</span>
						<input type="url" name="instanceUrl" required value={data.repo.defaultInstanceUrl} placeholder="https://staging.example.de" />
						<small>{i.t('repo.runningInstanceHint')}</small>
					</label>
					<fieldset>
						<legend>{i.t('repo.roles')}</legend>
						<div class="options">
							{#each data.roles as role (role.name)}
								<label class="check"><input type="checkbox" name="roles" value={role.name} checked /> <span>{role.name}</span></label>
							{/each}
						</div>
						<small>{i.t('repo.rolesAnalyzeHint')}</small>
					</fieldset>
					<div class="grid">
						<label class="field">
							<span>{i.t('repo.budget')}</span>
							<select name="budget">
								{#each Object.entries(i.labels.analysisBudget) as [value, label] (value)}
									<option {value} selected={value === (data.knowledge ? 'quick' : 'standard')}>{label}</option>
								{/each}
							</select>
						</label>
					</div>
					<label class="field">
						<span>{i.t('repo.extraInstructions')}</span>
						<textarea name="extraInstructions" rows="2" placeholder={i.t('repo.extraInstructionsPlaceholder')}></textarea>
					</label>
					<div class="actions">
						<button class="btn primary" type="submit" disabled={analyzing}>
							{analyzing ? i.t('repo.queuing') : data.knowledge ? i.t('repo.updateKb') : i.t('repo.startAnalysis')}
						</button>
					</div>
				</form>
			</details>
		{/if}
	{/if}

	{#if data.analyses.length}
		<section class="history">
			<h2>{i.t('repo.pastAnalyses')}</h2>
			<div class="sheet table">
				<table class="list">
					<thead>
						<tr><th>{i.t('repo.colStarted')}</th><th>{i.t('repo.colStatus')}</th><th>{i.t('repo.colCommit')}</th><th class="num">{i.t('repo.colDocs')}</th><th class="num">{i.t('repo.colCost')}</th></tr>
					</thead>
					<tbody>
						{#each data.analyses as an (an.id)}
							<tr>
								<td><a href="/analyses/{an.id}">{i.formatDate(an.createdAt)}</a> <span class="faint">{i.t('repo.byUser', { user: an.startedBy ?? '' })}</span></td>
								<td><StatusBadge status={an.status} /></td>
								<td>{#if an.commitSha}<code>{an.commitSha.slice(0, 7)}</code>{:else}–{/if}</td>
								<td class="num">{an.docCount || '–'}</td>
								<td class="num">{i.formatUsd(an.costUsd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
{:else if data.tab === 'reviews'}
	{#if data.reviews.length}
		<section class="sheet table"><ReviewTable reviews={data.reviews} showRepo={false} /></section>
	{:else}
		<p class="muted">{i.t('repo.noReviews')}</p>
	{/if}
{:else if !isAdmin}
	<p class="notice">{i.t('repo.adminOnly')}</p>
{:else}
	{#if data.isNew}
		<p class="notice ok">
			{data.keySources.length ? i.t('repo.addedNextOrCopy') : i.t('repo.addedNext')}
		</p>
	{/if}

	<section class="part" id="anthropic">
		<div class="intro">
			<h2>{i.t('repo.keyTitle')}</h2>
			<p class="muted">{i.t('repo.keyIntro')}</p>
		</div>
		<div class="sheet fields keybox">
			{#if formError('key')}<p class="notice error" role="alert">{formError('key')}</p>{/if}
			{#if data.anthropicKey}
				<p>
					<span class="dot-ok"></span>
					{i.t('repo.keyStored')} <code>…{data.anthropicKey.hint}</code>{#if data.anthropicKey.by}{i.t('repo.keySetBy', { by: data.anthropicKey.by })}{/if}{#if data.anthropicKey.at}, {i.formatDate(data.anthropicKey.at)}{/if}.
					{#if saved === 'key'}<span class="ok" role="status">{i.t('repo.saved')}</span>{/if}
				</p>
			{:else if data.keyOptional}
				<p class="muted">{i.t('repo.keyDemo')}</p>
			{:else}
				<p class="notice">{i.t('repo.keyMissing')}</p>
			{/if}

			{#if data.keySources.length}
				<form method="POST" action="?tab=settings&/setKey" use:enhance={() => ({ update }) => update({ reset: false })} class="row-form">
					<label class="field">
						<span>{i.t('repo.keyCopyFrom')}</span>
						<select name="source">
							{#each data.keySources as src (src.fullName)}
								<option value={src.fullName}>{src.fullName} (…{src.hint})</option>
							{/each}
						</select>
						<small>{i.t('repo.keyCopyHint')}</small>
					</label>
					<button class="btn {data.anthropicKey ? '' : 'primary'}" type="submit">{i.t('repo.keyCopy')}</button>
				</form>
			{/if}

			<form method="POST" action="?tab=settings&/setKey" use:enhance class="row-form">
				<label class="field">
					<span>{data.anthropicKey ? i.t('repo.keyNew') : i.t('repo.keyEnter')}</span>
					<input type="password" name="key" autocomplete="off" placeholder="sk-ant-…" />
					<small>{i.t('repo.keyHint')}</small>
				</label>
				{#if form && 'unverified' in form && form.unverified}
					<label class="check"><input type="checkbox" name="force" /> <span>{i.t('repo.saveAnyway')}</span></label>
				{/if}
				<button class="btn {data.anthropicKey || data.keySources.length ? '' : 'primary'}" type="submit">{i.t('repo.save')}</button>
			</form>

			{#if data.anthropicKey}
				<form method="POST" action="?tab=settings&/removeKey" use:enhance onsubmit={(e) => { if (!confirm(i.t('repo.removeKeyConfirm'))) e.preventDefault(); }}>
					<button class="btn small danger" type="submit">{i.t('repo.removeKey')}</button>
				</form>
			{/if}
		</div>
	</section>

	<section class="part">
		<div class="intro">
			<h2>{i.t('repo.generalTitle')}</h2>
			<p class="muted">{i.t('repo.generalIntro')}</p>
		</div>
		<form method="POST" action="?tab=settings&/settings" use:enhance={() => ({ update }) => update({ reset: false })} class="sheet fields">
			{#if formError('settings')}<p class="notice error" role="alert">{formError('settings')}</p>{/if}
			<label class="field">
				<span>{i.t('repo.appNotes')}</span>
				<textarea name="notes" rows="4" placeholder={i.t('repo.appNotesPlaceholder')}>{data.repo.notes}</textarea>
				<small>{i.t('repo.appNotesHint')}</small>
			</label>
			<label class="field">
				<span>{i.t('repo.defaultUrl')}</span>
				<input type="url" name="defaultInstanceUrl" value={data.repo.defaultInstanceUrl} placeholder="https://pr-123.preview.example.de" />
				<small>{i.t('repo.defaultUrlHint')}</small>
			</label>
			<label class="field">
				<span>{i.t('repo.extraHosts')}</span>
				<input type="text" name="extraAllowedHosts" value={data.repo.extraAllowedHosts.join(', ')} placeholder="auth.example.de, login.example.com" />
				<small>{i.t('repo.extraHostsHint')}</small>
			</label>
			<label class="check">
				<input type="checkbox" name="dataConfirmed" checked={data.repo.dataConfirmed} />
				<span>
					{i.t('repo.dataConfirmed')}
					<span class="faint">{i.t('repo.dataConfirmedHint')}</span>
				</span>
			</label>
			<div class="actions">
				<button class="btn primary" type="submit">{i.t('repo.saveSettings')}</button>
				{#if saved === 'settings'}<span class="ok" role="status">{i.t('repo.saved')}</span>{/if}
			</div>
		</form>
	</section>

	<section class="part">
		<div class="intro">
			<h2>{i.t('repo.automationTitle')}</h2>
			<p class="muted">{i.t('repo.automationIntro')}</p>
		</div>
		<div class="fields">
			<form method="POST" action="?tab=settings&/automation" use:enhance={() => ({ update }) => update({ reset: false })} class="sheet fields">
				{#if formError('automation')}<p class="notice error" role="alert">{formError('automation')}</p>{/if}
				<label class="field">
					<span>{i.t('repo.envLabel')}</span>
					<input type="text" name="deploymentEnvironment" value={data.automation.deploymentEnvironment ?? ''} list="environments" placeholder={data.suggestedEnvironment ?? 'Preview'} />
					<datalist id="environments">
						{#each data.environments as env (env)}<option value={env}></option>{/each}
					</datalist>
					<small>
						{i.t('repo.envHint')}
						{#if data.suggestedEnvironment}<strong>{i.t('repo.envSuggestion', { env: data.suggestedEnvironment })}</strong>{i.t('repo.envSuggestionTail')}{/if}
						{#if data.environments.length}{i.t('repo.envList', { list: data.environments.join(', ') })}{/if}
						{#if data.suggestedEnvironment && data.automation.deploymentEnvironment && data.automation.deploymentEnvironment.toLowerCase() !== data.suggestedEnvironment.toLowerCase()}
							<span class="warn">{i.t('repo.envMismatch', { set: data.automation.deploymentEnvironment, suggested: data.suggestedEnvironment })}</span>
						{/if}
					</small>
				</label>
				<label class="field">
					<span>{i.t('repo.templateLabel')}</span>
					<input type="text" name="instanceUrlTemplate" value={data.automation.instanceUrlTemplate} placeholder="https://pr-{'{pr}'}.preview.example.de" />
					<small>{i.t('repo.templateHint')}</small>
				</label>
				<fieldset>
					<legend>{i.t('repo.startReviewOn')}</legend>
					<label class="check"><input type="checkbox" name="onComment" checked={data.automation.onComment} /> <span>{i.t('repo.onCommentBefore')} <code>/claudio review</code> {i.t('repo.onCommentAfter')} <span class="faint">{i.t('repo.onCommentHint')}</span></span></label>
					<label class="check"><input type="checkbox" name="onLabel" checked={data.automation.onLabel} /> <span>{i.t('repo.onLabelBefore')} <code>claudio-review</code> {i.t('repo.onLabelAfter')}</span></label>
					<label class="check"><input type="checkbox" name="onPush" checked={data.automation.onPush} /> <span>{i.t('repo.onPush')} <span class="faint">{i.t('repo.onPushHint')}</span></span></label>
				</fieldset>
				<label class="check"><input type="checkbox" name="commitStatus" checked={data.automation.commitStatus} /> <span>{i.t('repo.commitStatus')} <span class="faint">{i.t('repo.commitStatusHint')}</span></span></label>
				<label class="check"><input type="checkbox" name="analyzeOnMerge" checked={data.automation.analyzeOnMerge} /> <span>{i.t('repo.analyzeOnMerge', { branch: data.repo.defaultBranch ?? i.t('repo.mainBranch') })} <span class="faint">{i.t('repo.analyzeOnMergeHint')}</span></span></label>
				<fieldset>
					<legend>{i.t('repo.autoReviews')}</legend>
					<div class="options">
						{#each data.roles as role (role.name)}
							<label class="check"><input type="checkbox" name="autoRoles" value={role.name} checked={data.autoReview.roles.includes(role.name)} /> <span>{role.name}</span></label>
						{/each}
					</div>
					<div class="grid">
						<label class="field">
							<span>{i.t('repo.budget')}</span>
							<select name="autoBudget">
								{#each Object.entries(i.labels.budget) as [value, label] (value)}<option {value} selected={data.autoReview.budget === value}>{label}</option>{/each}
							</select>
						</label>
						<label class="field">
							<span>{i.t('repo.strictness')}</span>
							<select name="autoStrictness">
								{#each Object.entries(i.labels.strictness) as [value, label] (value)}<option {value} selected={data.autoReview.strictness === value}>{label}</option>{/each}
							</select>
						</label>
					</div>
					<label class="check"><input type="checkbox" name="autoComment" checked={data.autoReview.postComment} /> <span>{i.t('repo.autoComment')}</span></label>
					<label class="check"><input type="checkbox" name="autoTests" checked={data.autoReview.runTests} /> <span>{i.t('repo.autoTests')}</span></label>
					<label class="check"><input type="checkbox" name="autoFollowUp" checked={data.autoReview.followUp !== false} /> <span>{i.t('repo.autoFollowUp')} <span class="faint">{i.t('repo.autoFollowUpHint')}</span></span></label>
				</fieldset>
				<div class="actions">
					<button class="btn primary" type="submit">{i.t('repo.saveAutomation')}</button>
					{#if saved === 'automation'}<span class="ok" role="status">{i.t('repo.saved')}</span>{/if}
				</div>
			</form>

			<div class="sheet fields hook">
				<h3>Webhook</h3>
				{#if formError('webhook')}<p class="notice error" role="alert">{formError('webhook')}</p>{/if}
				{#if data.webhook}
					<p>
						<span class="dot-ok" class:bad={data.webhook.ok === false}></span>
						{data.webhook.by ? i.t('repo.webhookInstalledBy', { by: data.webhook.by }) : i.t('repo.webhookInstalled')} <span class="faint">{data.webhook.status}</span>
					</p>
				{:else}
					<p class="muted">{i.t('repo.webhookNone')}</p>
				{/if}
				{#if data.localBaseUrl}
					<p class="notice">
						{i.t('repo.localhostBefore')} <code>localhost</code>{i.t('repo.localhostMiddle')} <code>PUBLIC_BASE_URL</code> {i.t('repo.localhostAfter')}
					</p>
				{/if}

				<details class="howto">
					<summary>{i.t('repo.howTo')}</summary>
					<div class="howto-body">
						<p><strong>{i.t('repo.howWhatTitle')}</strong> {i.t('repo.howWhat')} <code>{data.webhookUrl}</code>{i.t('repo.howWhatAfter')}</p>
						<p><strong>{i.t('repo.howPrereqTitle')}</strong></p>
						<ul>
							<li>{i.t('repo.howPrereqAdmin')}</li>
							<li>{i.t('repo.howPrereqPublicBefore')}<code>PUBLIC_BASE_URL</code>{i.t('repo.howPrereqPublicAfter')}</li>
							<li>{i.t('repo.howPrereqTemplate')}</li>
						</ul>
						<p><strong>{i.t('repo.howAfterTitle')}</strong> {i.t('repo.howAfterA')} <code>/claudio review</code> {i.t('repo.howAfterB')} <code>claudio-review</code> {i.t('repo.howAfterC')}</p>
						<p><strong>{i.t('repo.howWhoTitle')}</strong> {i.t('repo.howWho')}</p>
						<p><strong>{i.t('repo.howCheckTitle')}</strong> {i.t('repo.howCheck')}</p>
						<ol>
							<li>{i.t('repo.howCheckStep1')}</li>
							<li>{i.t('repo.howCheckStep2', { branch: data.repo.defaultBranch ?? i.t('repo.mainBranch') })}</li>
							<li>{i.t('repo.howCheckStep3')}</li>
						</ol>
						<p><strong>{i.t('repo.howRemoveTitle')}</strong> {i.t('repo.howRemove')}</p>
					</div>
				</details>

				<div class="actions">
					<form method="POST" action="?tab=settings&/installWebhook" use:enhance>
						<button class="btn {data.webhook ? '' : 'primary'}" type="submit">{data.webhook ? i.t('repo.webhookReinstall') : i.t('repo.webhookInstall')}</button>
					</form>
					{#if data.webhook}
						<form method="POST" action="?tab=settings&/removeWebhook" use:enhance>
							<button class="btn danger" type="submit">{i.t('repo.remove')}</button>
						</form>
					{/if}
				</div>
			</div>
		</div>
	</section>

	{#if data.slack}
		{@const n = data.slack.notifications}
		<section class="part" id="slack">
			<div class="intro">
				<h2>{i.t('repo.slackTitle')}</h2>
				<p class="muted">{i.t('repo.slackIntro')}</p>
			</div>
			<div class="fields">
				<form method="POST" action="?tab=settings&/slack" use:enhance={() => ({ update }) => update({ reset: false })} class="sheet fields">
					{#if formError('slack')}<p class="notice error" role="alert">{formError('slack')}</p>{/if}
					<label class="field">
						<span>{i.t('repo.slackWebhook')}</span>
						<input type="password" name="webhookUrl" autocomplete="off" placeholder={data.slack.hint ? i.t('repo.slackStored', { hint: data.slack.hint }) : 'https://hooks.slack.com/services/…'} />
						<small>{i.t('repo.slackWebhookHint')}</small>
					</label>
					{#if data.slack.hint}
						<label class="check"><input type="checkbox" name="removeWebhook" /> <span>{i.t('repo.slackRemove')}</span></label>
					{/if}
					<fieldset>
						<legend>{i.t('repo.slackWhat')}</legend>
						<label class="check"><input type="checkbox" name="takeover" checked={n.takeover} /> <span>{i.t('repo.slackTakeover')} <span class="faint">{i.t('repo.slackTakeoverHint')}</span></span></label>
						<label class="field inline">
							<span>{i.t('repo.slackReviews')}</span>
							<select name="reviews">
								<option value="all" selected={n.reviews === 'all'}>{i.t('repo.slackReviewsAll')}</option>
								<option value="changes" selected={n.reviews === 'changes'}>{i.t('repo.slackReviewsChanges')}</option>
								<option value="off" selected={n.reviews === 'off'}>{i.t('repo.slackOff')}</option>
							</select>
						</label>
						<label class="check"><input type="checkbox" name="automationEvents" checked={n.automation} /> <span>{i.t('repo.slackAutomation')} <span class="faint">{i.t('repo.slackAutomationHint')}</span></span></label>
						<label class="field inline">
							<span>{i.t('repo.slackTests')}</span>
							<select name="tests">
								<option value="failed" selected={n.tests === 'failed'}>{i.t('repo.slackTestsFailed')}</option>
								<option value="all" selected={n.tests === 'all'}>{i.t('repo.slackTestsAll')}</option>
								<option value="off" selected={n.tests === 'off'}>{i.t('repo.slackOff')}</option>
							</select>
						</label>
						<label class="check"><input type="checkbox" name="analyses" checked={n.analyses} /> <span>{i.t('repo.slackAnalyses')}</span></label>
					</fieldset>
					<label class="field">
						<span>{i.t('repo.slackMention')}</span>
						<input type="text" name="mention" value={n.mention} placeholder="<!here>" />
						<small>{i.t('repo.slackMentionHint')}</small>
					</label>
					<div class="actions">
						<button class="btn primary" type="submit">{i.t('repo.save')}</button>
						{#if data.slack.hint}
							<button class="btn" type="submit" formaction="?tab=settings&/slackTest">{i.t('repo.slackTest')}</button>
						{/if}
						{#if saved === 'slack'}<span class="ok" role="status">{i.t('repo.saved')}</span>{/if}
						{#if saved === 'slackTest'}<span class="ok" role="status">{i.t('repo.slackTestSent')}</span>{/if}
					</div>
				</form>
			</div>
		</section>
	{/if}

	<section class="part">
		<div class="intro">
			<h2>{i.t('repo.roles')}</h2>
			<p class="muted">{i.t('repo.rolesIntro')}</p>
		</div>
		<div class="roles">
			{#if formError('role')}<p class="notice error" role="alert">{formError('role')}</p>{/if}
			{#each data.roles as role (role.name)}
				<details class="sheet role">
					<summary>
						<strong>{role.name}</strong>
						<span class="faint">{role.description || i.t('repo.noDescription')}, {role.username}</span>
						{#if saved === `role:${role.name}`}<span class="ok" role="status">{i.t('repo.saved')}</span>{/if}
					</summary>
					{@render roleForm(role)}
					<form method="POST" action="?tab=settings&/deleteRole" class="delete">
						<input type="hidden" name="name" value={role.name} />
						<button class="btn small danger" type="submit">{i.t('repo.deleteRole')}</button>
					</form>
				</details>
			{/each}
			<details class="sheet role" open={data.roles.length === 0}>
				<summary><strong>{i.t('repo.newRole')}</strong></summary>
				{@render roleForm(null)}
			</details>
		</div>
	</section>

	<section class="part" id="erfahrungen">
		<div class="intro">
			<h2>{i.t('repo.learningsTitle')}</h2>
			<p class="muted">{i.t('repo.learningsIntro', { n: data.learningsInPrompt })}</p>
		</div>
		<div>
			{#if data.learnings.length}
				<ul class="lessons sheet">
					{#each data.learnings as learning (learning.id)}
						<li>
							<div>
								<p>{learning.text}</p>
								<span class="faint"><a href={learning.href}>{learning.source}</a>, {i.formatDate(learning.at)}</span>
							</div>
							<form method="POST" action="?tab=settings&/removeLearning" use:enhance>
								<input type="hidden" name="id" value={learning.id} />
								<button class="btn small" type="submit">{i.t('repo.delete')}</button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">{i.t('repo.noneYet')}</p>
			{/if}
		</div>
	</section>

	<section class="part">
		<div class="intro">
			<h2>{i.t('repo.lessonsTitle')}</h2>
			<p class="muted">{i.t('repo.lessonsIntro')}</p>
		</div>
		<div>
			{#if data.lessons.length}
				<ul class="lessons sheet">
					{#each data.lessons as lesson (lesson.reviewId + lesson.findingId)}
						<li>
							<div>
								<p>{lesson.text}</p>
								<span class="faint"><a href="/reviews/{lesson.reviewId}">{i.t('repo.reviewRef', { id: lesson.reviewId })}</a>, {lesson.by}, {i.formatDate(lesson.at)}</span>
							</div>
							<form method="POST" action="?tab=settings&/removeLesson" use:enhance>
								<input type="hidden" name="reviewId" value={lesson.reviewId} />
								<input type="hidden" name="findingId" value={lesson.findingId} />
								<button class="btn small" type="submit">{i.t('repo.forget')}</button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">{i.t('repo.noneYet')}</p>
			{/if}
		</div>
	</section>

	<section class="part">
		<div class="intro">
			<h2>{i.t('repo.removeTitle')}</h2>
			<p class="muted">{i.t('repo.removeIntro')}</p>
		</div>
		<form method="POST" action="?tab=settings&/remove" class="fields">
			{#if formError('remove')}<p class="notice error" role="alert">{formError('remove')}</p>{/if}
			<div><button class="btn danger" type="submit">{i.t('repo.removeRepo')}</button></div>
		</form>
	</section>
{/if}

{#snippet roleForm(role: (typeof data.roles)[number] | null)}
	<form method="POST" action="?tab=settings&/role" use:enhance={() => ({ update }) => update({ reset: !role })} class="fields">
		<div class="grid">
			<label class="field">
				<span>{i.t('repo.name')}</span>
				<input type="text" name="name" value={role?.name ?? ''} readonly={!!role} required placeholder="dispatcher" />
			</label>
			<label class="field">
				<span>{i.t('repo.description')}</span>
				<input type="text" name="description" value={role?.description ?? ''} placeholder={i.t('repo.descriptionPlaceholder')} />
			</label>
			<label class="field">
				<span>{i.t('repo.username')}</span>
				<input type="text" name="username" value={role?.username ?? ''} autocomplete="off" required={!role} />
			</label>
			<label class="field">
				<span>{i.t('repo.password')}</span>
				<input
					type="password"
					name="password"
					autocomplete="new-password"
					required={!role}
					placeholder={role ? i.t('repo.passwordUnchanged') : ''}
				/>
			</label>
			<label class="field">
				<span>{i.t('repo.loginPath')}</span>
				<input type="text" name="loginPath" value={role?.loginPath ?? '/login'} />
			</label>
			<label class="field">
				<span>{i.t('repo.successUrl')}</span>
				<input type="text" name="successUrlContains" value={role?.successUrlContains ?? ''} placeholder="/dashboard" />
			</label>
		</div>
		<label class="field">
			<span>{i.t('repo.recipe')}</span>
			<textarea name="recipe" rows="3" class="code" placeholder={'[{ "action": "goto", "url": "/login" }, …]'}>{role?.recipe ?? ''}</textarea>
			<small>{i.t('repo.recipeHint')}</small>
		</label>
		<div class="actions"><button class="btn primary" type="submit">{role ? i.t('repo.saveRole') : i.t('repo.createRole')}</button></div>
	</form>
{/snippet}

<style>
	h1 {
		word-break: break-word;
	}
	.page-title {
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.tab-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		flex-wrap: wrap;
		margin: 0 0 1rem;
		padding-bottom: 0.6rem;
		border-bottom: 1px solid var(--rule);
	}
	.notice {
		margin-bottom: 1rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.pulls li {
		display: flex;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		flex-wrap: wrap;
	}
	.pulls li:last-child {
		border-bottom: 0;
	}
	.pulls li:hover {
		background: var(--sunken);
	}
	.pr {
		flex: 1;
		min-width: 14rem;
		display: grid;
		gap: 0.1rem;
	}
	.pr .title {
		font-weight: 500;
		color: var(--ink);
	}
	.tag {
		margin-left: 0.3rem;
	}
	table.list td a {
		color: var(--ink);
		font-weight: 500;
	}
	.part {
		display: grid;
		grid-template-columns: minmax(0, 14rem) minmax(0, 1fr);
		gap: 1rem 2.5rem;
		padding: 1.5rem 0;
		border-top: 1px solid var(--rule);
	}
	.part:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
	.intro p {
		margin-top: 0.3rem;
		color: var(--ink-2);
	}
	form.sheet,
	.sheet.hook {
		padding: 1rem;
	}
	.hook > p,
	.hook .notice {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.9rem;
	}
	.ok {
		color: var(--pass);
		font-weight: 500;
		font-size: var(--text-xs);
	}
	.roles {
		display: grid;
		gap: 0.5rem;
		align-content: start;
	}
	.role summary {
		cursor: pointer;
		padding: 0.6rem 0.75rem;
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.role summary strong {
		font-weight: 500;
	}
	.role[open] summary {
		border-bottom: 1px solid var(--rule);
	}
	.role > form {
		padding: 0.875rem 0.75rem;
	}
	.role .delete {
		padding-top: 0;
	}
	.code {
		font-family: var(--mono);
		font-size: var(--text-xs);
	}
	.keybox > p {
		margin: 0;
	}
	.row-form {
		display: flex;
		align-items: flex-end;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.row-form .field {
		flex: 1;
		min-width: 16rem;
	}
	.sheet.keybox {
		padding: 1rem;
	}
	.hook h3 {
		font-size: var(--text-sm);
	}
	.dot-ok {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--pass);
		margin-right: 0.3rem;
	}
	.dot-ok.bad {
		background: var(--block);
	}
	.howto summary {
		cursor: pointer;
		font-weight: 500;
		color: var(--accent);
	}
	.howto-body {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.6rem;
		max-width: 46rem;
		color: var(--ink-2);
	}
	.howto-body ul,
	.howto-body ol {
		margin: 0;
		padding-left: 1.25rem;
	}
	.howto-body ul {
		list-style: disc;
	}
	.lessons {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lessons li {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		justify-content: space-between;
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid var(--rule);
	}
	.lessons li:last-child {
		border-bottom: 0;
	}
	.kb-head {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 0.9rem;
		color: var(--ink-2);
	}
	.kb-head .notice {
		margin: 0;
	}
	.kb-use {
		margin-top: 0.6rem;
	}
	.empty-kb {
		display: grid;
		gap: 0.4rem;
		max-width: 46rem;
		margin-bottom: 1rem;
	}
	.analyze {
		margin-top: 1.25rem;
		max-width: 46rem;
	}
	.analyze summary {
		padding: 0.6rem 0.75rem;
		cursor: pointer;
	}
	.analyze summary strong {
		font-weight: 500;
	}
	.analyze[open] summary {
		border-bottom: 1px solid var(--rule);
	}
	.analyze form {
		padding: 1rem 0.75rem;
	}
	.batch {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1.75rem;
	}
	.history {
		margin-top: 1.75rem;
		display: grid;
		gap: 0.6rem;
	}
	.field.inline {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}
	.field.inline > span {
		font-weight: 400;
	}
	.field.inline select {
		width: auto;
	}
	.warn {
		display: block;
		margin-top: 0.3rem;
		color: var(--major);
		font-weight: 500;
	}
	@media (max-width: 760px) {
		.part {
			grid-template-columns: 1fr;
		}
	}
</style>
