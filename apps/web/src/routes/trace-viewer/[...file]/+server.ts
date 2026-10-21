import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { error } from '@sveltejs/kit';
import { traceViewerDir } from '#lib/server/trace.js';
import type { RequestHandler } from './$types';

// The viewer is a static bundle; these are the kinds of files in it.
const TYPES: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	svg: 'image/svg+xml',
	png: 'image/png',
	ttf: 'font/ttf',
	woff: 'font/woff',
	woff2: 'font/woff2',
	json: 'application/json',
	webmanifest: 'application/manifest+json',
	map: 'application/json'
};

/**
 * Playwright's own trace viewer, served from the installed playwright-core so it
 * can open a run's trace.zip from this origin (with the session cookie). Its service
 * worker registers under /trace-viewer/, so every file has to live below that path.
 */
export const GET: RequestHandler = async ({ params }) => {
	const base = traceViewerDir();
	if (!base) error(404);
	const file = params.file || 'index.html';
	if (file.includes('\0')) error(404);
	const target = resolve(base, file);
	if (!target.startsWith(base + sep)) error(404);
	let body: Buffer;
	try {
		body = await readFile(target);
	} catch {
		error(404);
	}
	const ext = file.split('.').pop()?.toLowerCase() ?? '';
	// Hashed assets never change; the entry points may with the next playwright-core.
	const hashed = /\.[A-Za-z0-9_-]{8,}\.(js|css)$/.test(file) || file.startsWith('assets/');
	return new Response(new Uint8Array(body), {
		headers: {
			'content-type': TYPES[ext] ?? 'application/octet-stream',
			'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
			'x-content-type-options': 'nosniff'
		}
	});
};
