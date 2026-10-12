import { error, fail, redirect } from '@sveltejs/kit';
import { ReviewRequestSchema } from '@claudio/core';
import { createReview, createTestRuns, getRepo, listRoles, listTestScripts } from '@claudio/db';
import { userToken } from '#lib/server/auth.js';
import { db } from '#lib/server/db.js';
import { DEMO_FIXTURE, DEMO_REPO, demoPullRequest } from '#lib/server/demo.js';
import { devFixtures } from '#lib/server/env.js';
import { getPull, githubErrorMessage } from '#lib/server/github.js';
import type { Actions, PageServerLoad } from './$types';

async function context(url: URL, user: App.Locals['user']) {
	const fullName = url.searchParams.get('repo') ?? '';
	const prNumber = Number(url.searchParams.get('pr'));
	const repo = await getRepo(db(), fullName);
	if (!repo) error(404, 'Dieses Repository ist in Claudio nicht eingerichtet.');
	if (!Number.isInteger(prNumber) || prNumber <= 0) error(400, 'Pull-Request-Nummer fehlt.');
	const roles = await listRoles(db(), repo.id);
	if (!repo.dataConfirmed || roles.length === 0) redirect(303, `/repos/${repo.fullName}?tab=settings`);

	const fixture = repo.fullName === DEMO_REPO && devFixtures() ? DEMO_FIXTURE : null;
	let pr: { title: string; headRef: string; url: string } | null = null;
	let prError: string | null = null;
	if (fixture) {
		const p = demoPullRequest();
		if (p.number === prNumber) pr = { title: p.title, headRef: p.headRef, url: p.url };
	} else {
		const token = await userToken(user!);
		if (!token) prError = 'Ohne GitHub-Anmeldung kann Claudio den Pull Request nicht laden.';
		else
			try {
				pr = await getPull(token, repo.fullName, prNumber);
			} catch (e) {
				prError = githubErrorMessage(e);
			}
	}
	return { repo, roles, prNumber, pr, prError, fixture };
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const { repo, roles, prNumber, pr, prError } = await context(url, locals.user);
	const tests = (await listTestScripts(db(), repo.id)).filter((t) => t.runInReviews);
	return {
		reviewTests: tests.map((t) => t.name),
		repo: repo.fullName,
		prNumber,
		pr,
		prError,
		roles: roles.map((r) => ({ name: r.name, description: r.description })),
		defaultInstanceUrl: repo.defaultInstanceUrl ?? ''
	};
};

export const actions: Actions = {
	default: async ({ url, request, locals }) => {
		const { repo, prNumber, pr, fixture } = await context(url, locals.user);
		if (!pr) return fail(400, { error: 'Der Pull Request konnte nicht geladen werden.' });
		const f = await request.formData();
		const parsed = ReviewRequestSchema.safeParse({
			repo: repo.fullName,
			pr: prNumber,
			instanceUrl: String(f.get('instanceUrl') ?? '').trim(),
			roles: f.getAll('roles').map(String),
			driver: 'playwright',
			budget: f.get('budget'),
			verbosity: f.get('verbosity'),
			strictness: f.get('strictness'),
			language: f.get('language'),
			postComment: f.get('postComment') === 'on' && !fixture,
			cloneRepo: !fixture,
			extraInstructions: String(f.get('extraInstructions') ?? '').trim() || undefined
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const message = issue?.path[0] === 'instanceUrl' ? 'Gib die vollständige Adresse der Instanz an, z. B. https://pr-17.preview.example.de.' : (issue?.message ?? 'Eingaben prüfen.');
			return fail(400, { error: message });
		}
		const id = await createReview(db(), {
			repoId: repo.id,
			prNumber,
			prTitle: pr.title,
			request: parsed.data,
			fixture,
			startedBy: locals.user!.id
		});
		// Regression tests of the repo run against the same instance, after the review (worker order).
		if (f.get('runTests') === 'on') {
			const tests = (await listTestScripts(db(), repo.id)).filter((t) => t.runInReviews);
			await createTestRuns(
				db(),
				tests.map((t) => ({
					scriptId: t.id,
					repoId: repo.id,
					reviewId: id,
					request: { repo: repo.fullName, instanceUrl: parsed.data.instanceUrl, budget: 'quick' as const, language: parsed.data.language, headed: false, rerecord: false },
					startedBy: locals.user!.id
				}))
			);
		}
		redirect(303, `/reviews/${id}`);
	}
};
