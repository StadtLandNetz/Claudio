import { readFileSync } from 'node:fs';
import { EvidenceSchema, FindingSchema, type Evidence, type Finding } from '@claudio/core';
import { z } from 'zod';
import { runsRoot } from './env.js';
import { resolveRunFile } from './files.js';

function readJson<T>(runId: string, file: string, schema: z.ZodType<T>): T[] {
	const path = resolveRunFile(runsRoot, runId, file);
	if (!path) return [];
	try {
		return z.array(schema).parse(JSON.parse(readFileSync(path, 'utf8')));
	} catch {
		return [];
	}
}

/** URL under which the web app serves a file of a run. */
export const runFileUrl = (runId: string, path: string) => `/runs/${runId}/${path.split('/').map(encodeURIComponent).join('/')}`;

export const runEvidence = (runId: string): (Evidence & { url: string | null })[] =>
	readJson(runId, 'evidence.json', EvidenceSchema).map((e) => ({ ...e, url: e.path ? runFileUrl(runId, e.path) : null }));

export const runFindings = (runId: string): Finding[] => readJson(runId, 'findings.json', FindingSchema);
