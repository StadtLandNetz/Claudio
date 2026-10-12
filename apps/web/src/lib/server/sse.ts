import { eventsSince, type EventTarget } from '@claudio/db';
import { db } from './db.js';

const ACTIVE = new Set(['queued', 'running']);

/**
 * Server-sent events for a run's live log: `line` per log entry, `status` on
 * status changes, `done` once the run has finished.
 */
export function runEventStream(request: Request, url: URL, target: EventTarget, currentStatus: () => Promise<string | null>): Response {
	// On reconnect the browser sends Last-Event-ID; it is newer than the ?after of the original URL.
	let after = Number(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? 0) || 0;
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
			let closed = false;
			let lastStatus = '';
			request.signal.addEventListener('abort', () => (closed = true));
			try {
				while (!closed) {
					const events = await eventsSince(db(), target, after);
					for (const e of events) {
						send(`id: ${e.seq}\nevent: line\ndata: ${JSON.stringify(e.line)}\n\n`);
						after = e.seq;
					}
					if (events.length > 0) continue;
					const status = (await currentStatus()) ?? 'failed';
					if (status !== lastStatus) {
						lastStatus = status;
						send(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
					}
					if (!ACTIVE.has(status)) {
						send(`event: done\ndata: ${JSON.stringify(status)}\n\n`);
						break;
					}
					send(': keep-alive\n\n');
					await new Promise((r) => setTimeout(r, 1000));
				}
			} catch (e) {
				if (!closed) send(`event: failure\ndata: ${JSON.stringify((e as Error).message)}\n\n`);
			}
			try {
				controller.close();
			} catch {
				// client already gone
			}
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }
	});
}
