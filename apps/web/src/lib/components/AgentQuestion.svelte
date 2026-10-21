<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { i18n } from '#lib/i18n/index.js';

	/** A question of the agent that waits for a person: pick a suggested answer or write one. */
	let { requestId, question, context = null, options = [] }: { requestId: number; question: string; context?: string | null; options?: string[] } = $props();
	const i = i18n();
	let answer = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function send(status: 'resolved' | 'cancelled', text = answer) {
		busy = true;
		error = null;
		const res = await fetch(`/human/${requestId}/resolve`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(status === 'resolved' ? { status, answer: text.trim() } : { status })
		}).catch(() => null);
		busy = false;
		if (!res?.ok) {
			error = i.t('common.answerFailed');
			return;
		}
		await invalidateAll();
	}
</script>

<section class="question sheet" aria-live="polite">
	<header>
		<span class="dot major live" aria-hidden="true"></span>
		<h2>{i.t('common.agentAsks')}</h2>
		<span class="faint">{i.t('common.agentAsksHint')}</span>
	</header>
	<div class="body">
		<p class="q">{question}</p>
		{#if context}<p class="ctx">{context}</p>{/if}
		{#if options.length}
			<div class="opts">
				{#each options as o (o)}
					<button type="button" class="btn" disabled={busy} onclick={() => send('resolved', o)}>{o}</button>
				{/each}
			</div>
		{/if}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				if (answer.trim()) send('resolved');
			}}
		>
			<label class="field">
				<span>{i.t('common.ownAnswer')}</span>
				<textarea rows="2" bind:value={answer} placeholder={i.t('common.ownAnswerPlaceholder')}></textarea>
			</label>
			<div class="actions">
				<button class="btn primary" type="submit" disabled={busy || !answer.trim()}>{i.t('common.sendAnswer')}</button>
				<button class="btn ghost" type="button" disabled={busy} onclick={() => send('cancelled')}>{i.t('common.skipQuestion')}</button>
			</div>
		</form>
		{#if error}<p class="notice error" role="alert">{error}</p>{/if}
	</div>
</section>

<style>
	.question {
		border-color: color-mix(in srgb, var(--major) 45%, transparent);
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		background: var(--major-soft);
	}
	h2 {
		font-size: var(--text-sm);
	}
	.body {
		display: grid;
		gap: 0.75rem;
		padding: 0.75rem;
	}
	.q {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.ctx {
		color: var(--ink-2);
		white-space: pre-wrap;
	}
	.opts {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.opts .btn {
		height: auto;
		min-height: var(--control-h);
		padding-block: 0.3rem;
		white-space: normal;
		text-align: left;
	}
	form {
		display: grid;
		gap: 0.5rem;
	}
	.notice {
		margin: 0;
	}
</style>
