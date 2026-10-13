import { readFile } from 'node:fs/promises';
import { runsRoot } from './env.js';
import { resolveRunFile } from './files.js';

/**
 * The newest frame of a run's browser (runDir/live.jpg, written by the worker's
 * screencast). The page polls it a few times per second; 204 while there is none.
 */
export async function liveFrame(lookup: () => Promise<{ status: string; runId: string | null } | null>): Promise<Response> {
	const run = await lookup();
	const file = run?.runId ? resolveRunFile(runsRoot, run.runId, 'live.jpg') : null;
	const jpeg = file ? await readFile(file).catch(() => null) : null;
	if (!jpeg || jpeg.length === 0) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
	return new Response(new Uint8Array(jpeg), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	});
}
