<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	type Entry = { seq: number; line: string };

	let {
		streamUrl,
		events,
		active,
		onstatus,
		online
	}: {
		/** SSE endpoint of the run, e.g. /reviews/3/events */
		streamUrl: string;
		/** Log entries from the page load. */
		events: Entry[];
		/** Whether the run was queued or running when the page loaded. */
		active: boolean;
		/** Status changes from the stream (queued → running → finished). */
		onstatus?: (status: string | null) => void;
		/** Every new log line, e.g. to react to "Mensch gebraucht:". */
		online?: (line: string) => void;
	} = $props();

	let live = $state<Entry[]>([]);
	const log = $derived([...events, ...live.filter((l) => l.seq > (events.at(-1)?.seq ?? 0))]);
	let box: HTMLElement | undefined = $state();
	let follow = $state(true);
	let streaming = $state(false);

	// Depends only on the loaded data: status changes from the stream must not reopen it.
	$effect(() => {
		if (!active) return;
		let lastSeq = events.at(-1)?.seq ?? 0;
		const source = new EventSource(`${streamUrl}?after=${lastSeq}`);
		streaming = true;
		source.addEventListener('line', (e) => {
			const ev = e as MessageEvent;
			const seq = Number(ev.lastEventId);
			if (seq <= lastSeq) return;
			lastSeq = seq;
			const line = JSON.parse(ev.data);
			live.push({ seq, line });
			online?.(line);
		});
		const finish = (status: string) => {
			if (!streaming) return;
			source.close();
			streaming = false;
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
		return () => {
			source.close();
			streaming = false;
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

<details class="sheet logsheet" open={active}>
	<summary>
		<h2>Verlauf des Agenten</h2>
		<span class="faint">{log.length} Einträge{#if streaming}, live{/if}</span>
	</summary>
	<div class="log" bind:this={box} onscroll={() => box && (follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 24)}>
		{#each log as entry (entry.seq)}
			<p class={kind(entry.line)}>{entry.line}</p>
		{:else}
			<p class="sys">Noch keine Einträge.</p>
		{/each}
	</div>
</details>

<style>
	.logsheet summary {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.8rem 1rem;
		cursor: pointer;
	}
	.logsheet summary h2 {
		font-size: 1rem;
	}
	.log {
		max-height: 24rem;
		overflow-y: auto;
		border-top: 1px solid var(--rule);
		padding: 0.6rem 1rem;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8125rem;
		line-height: 1.55;
		background: var(--sunken);
		border-radius: 0 0 var(--radius-m) var(--radius-m);
	}
	.log p {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.tool {
		color: var(--petrol);
	}
	.thought {
		color: var(--ink);
	}
	.sys {
		color: var(--ink-3);
	}
	.err {
		color: var(--block);
	}
</style>
