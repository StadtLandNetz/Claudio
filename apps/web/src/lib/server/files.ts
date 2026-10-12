import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Resolves a file inside one run directory. Returns null for anything that
 * would leave it: "..", absolute paths, odd run ids.
 */
export function resolveRunFile(runsRoot: string, runId: string, file: string): string | null {
	if (!/^[\w.-]+$/.test(runId) || runId === '.' || runId === '..') return null;
	if (!file || file.includes('\0') || isAbsolute(file)) return null;
	const runDir = resolve(runsRoot, runId);
	const target = resolve(runDir, file);
	const rel = relative(runDir, target);
	if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) return null;
	return target;
}

const TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	json: 'application/json; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	log: 'text/plain; charset=utf-8',
	yml: 'text/plain; charset=utf-8',
	jsonl: 'text/plain; charset=utf-8',
	zip: 'application/zip'
};

export function contentType(file: string): string {
	return TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
