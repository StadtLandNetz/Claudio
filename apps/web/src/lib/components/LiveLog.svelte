<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { i18n } from '#lib/i18n/index.js';

	type Entry = { seq: number; line: string };

	/**
	 * The run's log. The lines come over the run's event stream: at once while the
	 * run is active, on demand (when the log is opened) once it has finished, so a
	 * page never has to carry thousands of lines it may not show.
	 */
	let {
		streamUrl,
		count,
		active,
		onstatus,
		online
	}: {
		/** SSE endpoint of the run, e.g. /reviews/3/events */
		streamUrl: string;
		/** How many lines the run has (from the page load). */
		count: number;
		/** Whether the run was queued or running when the page loaded. */
		active: boolean;
		/** Status changes from the stream (queued → running → finished). */
		onstatus?: (status: string | null) => void;
		/** Every new log line, e.g. to react to "Mensch gebraucht:". */
		online?: (line: string) => void;
	} = $props();
	const i = i18n();

	let log = $state<Entry[]>([]);
	// Open from the start while the run is active; afterwards the person opens it.
	// svelte-ignore state_referenced_locally
	let open = $state(active);
	let box: HTMLElement | undefined = $state();
	let follow = $state(true);
	let streaming = $state(false);
	let loading = $state(false);
	const shown = $derived(Math.max(count, log.length));

	// Depends on `open` (and `active`): status changes from the stream must not reopen it.
	$effect(() => {
		if (!open && !active) return;
		const wasActive = active;
		let lastSeq = untrack(() => log.at(-1)?.seq ?? 0);
		const source = new EventSource(`${streamUrl}?after=${lastSeq}`);
		streaming = true;
		loading = lastSeq === 0;
		source.addEventListener('line', (e) => {
			const ev = e as MessageEvent;
			const seq = Number(ev.lastEventId);
			if (seq <= lastSeq) return;
			lastSeq = seq;
			const line = JSON.parse(ev.data);
			log.push({ seq, line });
			loading = false;
			online?.(line);
		});
		const finish = (status: string) => {
			if (!streaming) return;
			source.close();
			streaming = false;
			loading = false;
			if (!wasActive) return;
			invalidateAll().then(() => onstatus?.(null));
			onstatus?.(status);
		};
		source.addEventListener('status', (e) => {
			const status = JSON.parse((e as MessageEvent).data);
			// A finished status ends the stream here too, in case `done` never arrives.
			if (status === 'queued' || status === 'running') onstatus?.(status);
			else finish(status);
		});
		source.addEventListener('done', (e) => finish(JSON.parse((e as MessageEvent).data)));
		source.addEventListener('error', () => (loading = false));
		return () => {
			source.close();
			streaming = false;
			loading = false;
		};
	});

	$effect(() => {
		void log.length;
		if (follow && box) box.scrollTop = box.scrollHeight;
	});

	function kind(line: string): string {
		if (line.startsWith('→')) return 'tool';
		if (line.startsWith('·')) return 'thought';
		if (/^(Fehler|agent error|clone failed)/i.test(line)) return 'err';
		return 'sys';
	}
</script>

<details class="sheet logsheet" bind:open>
	<summary>
		<h2>{i.t('common.agentLog')}</h2>
		<span class="faint">{i.t('common.entryCount', { n: shown })}{#if streaming && active}{i.t('common.live')}{/if}</span>
	</summary>
	<div class="log" bind:this={box} onscroll={() => box && (follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 24)}>
		{#each log as entry (entry.seq)}
			<p class={kind(entry.line)}>{entry.line}</p>
		{:else}
			<p class="sys">{loading ? i.t('common.loadingEntries') : i.t('common.noEntries')}</p>
		{/each}
	</div>
</details>

<style>
	.logsheet summary {
		align-items: baseline;
		gap: 0.6rem;
	}
	.logsheet summary h2 {
		font-size: var(--text-sm);
	}
	.log {
		max-height: 24rem;
		overflow-y: auto;
		border-top: 1px solid var(--rule);
		padding: 0.5rem 0.75rem;
		font-family: var(--mono);
		font-size: var(--text-xs);
		line-height: 1.6;
		background: var(--sunken);
		border-radius: 0 0 var(--radius-m) var(--radius-m);
	}
	.log p {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.tool {
		color: var(--ink);
	}
	.thought {
		color: var(--ink-2);
	}
	.sys {
		color: var(--ink-3);
	}
	.err {
		color: var(--block);
	}
</style>
