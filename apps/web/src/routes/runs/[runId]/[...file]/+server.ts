import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { getArtifact, repoIdOfRun } from '@claudio/db';
import { requireRepo } from '#lib/server/access.js';
import { db } from '#lib/server/db.js';
import { runsRoot } from '#lib/server/env.js';
import { contentType, resolveRunFile } from '#lib/server/files.js';
import type { RequestHandler } from './$types';

/**
 * Files of a run. Screenshots come from the database (kept for the retention period);
 * everything else, and screenshots of a run still in progress, from the run directory.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const path = resolveRunFile(runsRoot, params.runId, params.file);
	if (!path) error(404, 'Datei nicht gefunden');
	// Files belong to a run, the run to a repository: same access rule as the run's page.
	const repoId = await repoIdOfRun(db(), params.runId);
	if (repoId === null) error(404, 'Datei nicht gefunden');
	await requireRepo(locals.user, repoId, 'read');

	const stored = await getArtifact(db(), params.runId, params.file);
	let body: Buffer;
	let type: string;
	if (stored) {
		body = stored.data;
		type = stored.contentType;
	} else {
		try {
			body = await readFile(path);
		} catch {
			error(404, 'Datei nicht gefunden (Screenshots werden nach 14 Tagen gelöscht)');
		}
		type = contentType(path);
	}
	return new Response(new Uint8Array(body), {
		headers: {
			'content-type': type,
			'cache-control': 'private, max-age=3600',
			'x-content-type-options': 'nosniff',
			...(type.startsWith('image/') ? {} : { 'content-disposition': `attachment; filename="${path.split('/').pop()}"` })
		}
	});
};
