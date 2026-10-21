import { json } from '@sveltejs/kit';
import { getRepo, webhookSecret } from '@claudio/db';
import { githubAppWebhookSecret, verifyWebhookSignature } from '@claudio/github';
import { handleGithubEvent } from '#lib/server/automation.js';
import { db } from '#lib/server/db.js';
import { publicBaseUrl } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

/**
 * GitHub webhook. Public, so the HMAC signature is the only authentication:
 * either the repository's own webhook secret, or the GitHub App's (its webhook
 * delivers the events of every repository it is installed on). Unsigned or
 * wrongly signed requests are rejected before anything is parsed further, and
 * only repositories set up in Claudio are acted on.
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
	const signature = request.headers.get('x-hub-signature-256');
	const secrets = [repo ? webhookSecret(repo) : null, githubAppWebhookSecret()].filter((s): s is string => Boolean(s));
	if (!repo || !secrets.some((s) => verifyWebhookSignature(s, raw, signature))) {
		return json({ error: 'unknown repository or invalid signature' }, { status: 401 });
	}
	const event = request.headers.get('x-github-event') ?? '';
	// The app's webhook also sends installation events; nothing to do for them.
	if (event === 'installation' || event === 'installation_repositories' || event === 'ping') return json({ action: 'ignored', reason: event });
	try {
		const result = await handleGithubEvent(repo, event, payload, publicBaseUrl(url));
		console.log(`[webhook] ${repo.fullName} ${event}${payload.action ? `.${payload.action}` : ''}: ${result.action} (${result.reason})`);
		return json(result, { status: result.action === 'ignored' ? 200 : 202 });
	} catch (e) {
		console.error(`[webhook] ${repo.fullName} ${event} failed`, e);
		return json({ error: (e as Error).message }, { status: 500 });
	}
};
