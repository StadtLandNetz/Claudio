import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { getArtifact } from '@claudio/db';
import { db } from '#lib/server/db.js';
import { runsRoot } from '#lib/server/env.js';
import { contentType, resolveRunFile } from '#lib/server/files.js';
import { verifyEvidenceSignature } from '#lib/server/signed.js';
import type { RequestHandler } from './$types';

/** One screenshot of a run behind a signed link (no sign-in), e.g. for a GitHub issue. */
export const GET: RequestHandler = async ({ params, url }) => {
	const path = resolveRunFile(runsRoot, params.runId, params.file);
	if (!path || !verifyEvidenceSignature(params.runId, params.file, url.searchParams.get('sig'))) error(404);
	const stored = await getArtifact(db(), params.runId, params.file);
	const body = stored?.data ?? (await readFile(path).catch(() => null));
	if (!body) error(404);
	return new Response(new Uint8Array(body), {
		headers: {
			'content-type': stored?.contentType ?? contentType(path),
			'cache-control': 'public, max-age=86400',
			'x-content-type-options': 'nosniff'
		}
	});
};
