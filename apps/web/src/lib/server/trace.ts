import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { indexFromZip, readZipDirectory, readZipEntry, type ZipDirectory } from '@claudio/browser/trace';
import type { TraceIndex } from '@claudio/core';
import { getArtifact } from '@claudio/db';
import { db } from './db.js';
import { runsRoot } from './env.js';
import { resolveRunFile } from './files.js';

/** Where the worker stores a run's trace for the timeline (run_artifacts paths). */
export const TRACE_INDEX_PATH = 'trace/index.json';
export const traceFramePath = (file: string) => `trace/frames/${file}`;

export type RunTrace = {
	index(): Promise<TraceIndex>;
	/** One screencast frame (JPEG) by its file name under screencast/. */
	frame(file: string): Promise<Buffer | null>;
};

type Cached = { key: string; dir: ZipDirectory | null; index: Promise<TraceIndex> | null };
const CACHE_MAX = 8;
/** runId → entry; insertion order doubles as least-recently-used order. */
const cache = new Map<string, Cached>();

function remember(runId: string, entry: Cached): Cached {
	cache.delete(runId);
	cache.set(runId, entry);
	while (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
	return entry;
}

/**
 * The trace of a run: from trace.zip while the run directory exists (every frame),
 * otherwise the worker's copy in the database (the index and a selection of frames,
 * kept for the retention period like the screenshots). Null when there is neither.
 */
export async function openRunTrace(runId: string): Promise<RunTrace | null> {
	const path = resolveRunFile(runsRoot, runId, 'trace.zip');
	const st = path ? await stat(path).catch(() => null) : null;
	if (path && st) {
		const key = `zip:${st.size}:${st.mtimeMs}`;
		const hit = cache.get(runId);
		const entry = hit?.key === key ? remember(runId, hit) : remember(runId, { key, dir: await readZipDirectory(path), index: null });
		const dir = entry.dir!;
		const logPath = resolveRunFile(runsRoot, runId, 'log.jsonl');
		return {
			index() {
				if (!entry.index) {
					entry.index = indexFromZip(dir, logPath).catch((err) => {
						entry.index = null;
						throw err;
					});
				}
				return entry.index;
			},
			frame: (file) => readZipEntry(dir, `screencast/${file}`)
		};
	}
	const hit = cache.get(runId);
	let entry = hit?.key === 'db' ? remember(runId, hit) : null;
	if (!entry) {
		const stored = await getArtifact(db(), runId, TRACE_INDEX_PATH);
		if (!stored) return null;
		entry = remember(runId, { key: 'db', dir: null, index: Promise.resolve(JSON.parse(stored.data.toString('utf8')) as TraceIndex) });
	}
	const e = entry;
	return {
		index: () => e.index!,
		frame: async (file) => (await getArtifact(db(), runId, traceFramePath(file)))?.data ?? null
	};
}

// ---------------------------------------------------------------- the official viewer

let viewerDir: string | null | undefined;

/** Playwright's own trace viewer, bundled with playwright-core; null when the package is not installed. */
export function traceViewerDir(): string | null {
	if (viewerDir !== undefined) return viewerDir;
	try {
		const require = createRequire(import.meta.url);
		const dir = resolve(dirname(require.resolve('playwright-core/package.json')), 'lib/vite/traceViewer');
		viewerDir = existsSync(resolve(dir, 'index.html')) ? dir : null;
	} catch {
		viewerDir = null;
	}
	return viewerDir;
}

export const viewerAvailable = (): boolean => traceViewerDir() !== null;
