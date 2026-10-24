import { existsSync, readFileSync } from 'node:fs';
import { error } from '@sveltejs/kit';
import { EvidenceSchema, FindingSchema, type Evidence, type Finding } from '@claudio/core';
import { artifactPaths, repoIdOfRun } from '@claudio/db';
import { z } from 'zod';
import { serverI18n } from '#lib/i18n/index.js';
import { requireRepo } from './access.js';
import { db } from './db.js';
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

/** Files belong to a run, the run to a repository: the same access rule as the run's page. 404 for unknown runs. */
export async function requireRunAccess(locals: App.Locals, runId: string): Promise<number> {
	const { t } = serverI18n(locals.locale, locals.user?.provider);
	const repoId = await repoIdOfRun(db(), runId);
	if (repoId === null) error(404, t('common.fileNotFound'));
	await requireRepo(locals.user, repoId, 'read');
	return repoId;
}

/** URL under which the web app serves a file of a run. */
export const runFileUrl = (runId: string, path: string) => `/runs/${runId}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Fallback for analyses stored before their report carried evidence and findings. */
export const runEvidenceFromDisk = (runId: string): Evidence[] => readJson(runId, 'evidence.json', EvidenceSchema);
export const runFindingsFromDisk = (runId: string): Finding[] => readJson(runId, 'findings.json', FindingSchema);

/**
 * Whether a run file can still be served: screenshots live in the database for the
 * retention period; while a run is in progress (or locally) they are also on disk.
 */
export async function fileAvailability(runId: string | null | undefined): Promise<(path: string) => boolean> {
	if (!runId) return () => false;
	const stored = await artifactPaths(db(), runId);
	return (path) => {
		if (stored.has(path)) return true;
		const file = resolveRunFile(runsRoot, runId, path);
		return Boolean(file && existsSync(file));
	};
}

export type ShownEvidence = Evidence & { url: string | null; expired: boolean };

/** Evidence with a URL when the image is still available, otherwise marked as expired. */
export async function withAvailability(runId: string | null | undefined, evidence: Evidence[]): Promise<ShownEvidence[]> {
	const available = await fileAvailability(runId);
	return evidence.map((e) => {
		const ok = Boolean(runId && e.path && available(e.path));
		return { ...e, url: ok ? runFileUrl(runId!, e.path!) : null, expired: Boolean(e.path) && !ok };
	});
}
