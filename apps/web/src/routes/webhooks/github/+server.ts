import { json } from '@sveltejs/kit';
import { getRepo, webhookSecret } from '@claudio/db';
import { verifyWebhookSignature } from '@claudio/github';
import { handleGithubEvent } from '#lib/server/automation.js';
import { db } from '#lib/server/db.js';
import { publicBaseUrl } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

/**
 * GitHub webhook. Public, so the repo's secret (HMAC signature) is the only
 * authentication: unsigned or wrongly signed requests are rejected before
 * anything is parsed further.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const raw = await request.text();
	let payload: Record<string, any>;
	try {
		payload = JSON.parse(raw);
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400 });
	}
	const fullName = payload.repository?.full_name;
	const repo = typeof fullName === 'string' ? await getRepo(db(), fullName) : undefined;
	const secret = repo ? webhookSecret(repo) : null;
	if (!repo || !secret || !verifyWebhookSignature(secret, raw, request.headers.get('x-hub-signature-256'))) {
		return json({ error: 'unknown repository or invalid signature' }, { status: 401 });
	}
	const event = request.headers.get('x-github-event') ?? '';
	try {
		const result = await handleGithubEvent(repo, event, payload, publicBaseUrl(url));
		console.log(`[webhook] ${repo.fullName} ${event}${payload.action ? `.${payload.action}` : ''}: ${result.action} (${result.reason})`);
		return json(result, { status: result.action === 'ignored' ? 200 : 202 });
	} catch (e) {
		console.error(`[webhook] ${repo.fullName} ${event} failed`, e);
		return json({ error: (e as Error).message }, { status: 500 });
	}
};
