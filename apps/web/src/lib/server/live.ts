import { readFile, stat } from 'node:fs/promises';
import { runsRoot } from './env.js';
import { resolveRunFile } from './files.js';

const BOUNDARY = 'claudio-frame';
const ACTIVE = new Set(['queued', 'running']);

/**
 * MJPEG stream of a run's browser (runDir/live.jpg, written by the worker's
 * screencast). An <img> plays it like a video. Ends when the run is over.
 */
export function liveViewStream(request: Request, lookup: () => Promise<{ status: string; runId: string | null } | null>): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;
			request.signal.addEventListener('abort', () => (closed = true));
			let lastMtime = 0;
			let lastCheck = 0;
			let run = await lookup();
			try {
				while (!closed && run && ACTIVE.has(run.status)) {
					const file = run.runId ? resolveRunFile(runsRoot, run.runId, 'live.jpg') : null;
					if (file) {
						const info = await stat(file).catch(() => null);
						if (info && info.mtimeMs !== lastMtime) {
							const jpeg = await readFile(file).catch(() => null);
							if (jpeg && jpeg.length > 0) {
								lastMtime = info.mtimeMs;
								controller.enqueue(encoder.encode(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`));
								controller.enqueue(new Uint8Array(jpeg));
								controller.enqueue(encoder.encode('\r\n'));
							}
						}
					}
					await new Promise((r) => setTimeout(r, 250));
					if (Date.now() - lastCheck > 2000) {
						lastCheck = Date.now();
						run = await lookup();
					}
				}
			} catch {
				// client went away mid-write
			}
			try {
				controller.close();
			} catch {
				// already closed
			}
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	});
}
