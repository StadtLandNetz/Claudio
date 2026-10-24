import { json } from '@sveltejs/kit';
import { getRepo, getRepoByExternalId, webhookSecret } from '@claudio/db';
import { verifyGitlabToken } from '@claudio/forge';
import { handleWebhookEvent, type EventResult } from '#lib/server/automation.js';
import { db } from '#lib/server/db.js';
import { publicBaseUrl } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

/** GitLab waits 10 s for an answer and switches hooks off that keep failing. */
const ANSWER_WITHIN_MS = 8_000;

/**
 * GitLab project webhook. Public, so the secret token GitLab sends back in
 * X-Gitlab-Token is the only authentication. The project is found by its id
 * (renames do not break it), else by its path; only repositories set up in
 * Claudio are acted on.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	let payload: Record<string, any>;
	try {
		payload = JSON.parse(await request.text());
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400 });
	}
	const projectId = payload.project?.id ?? payload.project_id;
	const path = payload.project?.path_with_namespace;
	const repo =
		(typeof projectId === 'number' ? await getRepoByExternalId(db(), 'gitlab', projectId) : undefined) ??
		(typeof path === 'string' ? await getRepo(db(), 'gitlab', path) : undefined);
	const secret = repo ? webhookSecret(repo) : null;
	if (!repo || !secret || !verifyGitlabToken(secret, request.headers.get('x-gitlab-token'))) {
		return json({ error: 'unknown repository or invalid token' }, { status: 401 });
	}
	const event = request.headers.get('x-gitlab-event') ?? '';
	const what = `${repo.fullName} ${payload.object_kind ?? event}${payload.object_attributes?.action ? `.${payload.object_attributes.action}` : ''}`;
	const work = handleWebhookEvent(repo, event, payload, publicBaseUrl(url)).then(
		(result) => {
			console.log(`[webhook] ${what}: ${result.action} (${result.reason})`);
			return result;
		},
		(e) => {
			console.error(`[webhook] ${what} failed`, e);
			return null;
		}
	);
	// Answer with the result when it is quick; otherwise accept and keep working after the answer.
	const result = await Promise.race([work, new Promise<'later'>((r) => setTimeout(() => r('later'), ANSWER_WITHIN_MS))]);
	if (result === 'later') return json({ action: 'accepted' }, { status: 202 });
	if (!result) return json({ error: 'event failed' }, { status: 500 });
	return json(result satisfies EventResult, { status: result.action === 'ignored' ? 200 : 202 });
};
