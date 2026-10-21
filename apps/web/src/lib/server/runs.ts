import { ViewportSchema, type TestRunRequest, type Viewport } from '@claudio/core';
import { budgetState, type createTestRuns, type Repo } from '@claudio/db';
import { botClient, createGithubClient } from '@claudio/github';
import type { I18n } from '#lib/i18n/index.js';
import { userToken, type SessionUser } from './auth.js';
import { db } from './db.js';

/** Viewports ticked in a form (`viewports` checkboxes); none ticked means desktop. */
export function viewportsOf(f: FormData): Viewport[] {
	const picked = f.getAll('viewports').flatMap((v) => {
		const p = ViewportSchema.safeParse(String(v));
		return p.success ? [p.data] : [];
	});
	return picked.length ? [...new Set(picked)] : ['desktop'];
}

type RunInput = Parameters<typeof createTestRuns>[1][number];

/** One test run per viewport of each script. */
export function runsPerViewport(
	runs: (Omit<RunInput, 'request'> & { request: Omit<TestRunRequest, 'viewport'> & { viewport?: Viewport }; viewports: readonly Viewport[] })[]
): RunInput[] {
	return runs.flatMap(({ viewports, ...run }) => (viewports.length ? viewports : (['desktop'] as const)).map((viewport) => ({ ...run, request: { ...run.request, viewport } })));
}

/** Why no new run may start in this repository, or null: the monthly budget is used up. */
export async function budgetBlocks(repo: Pick<Repo, 'id' | 'monthlyBudgetUsd'>, t: I18n['t']): Promise<string | null> {
	const state = await budgetState(db(), repo);
	return state.exhausted ? t('system.budgetExhausted', { spent: state.spent.toFixed(2), limit: state.limit!.toFixed(2) }) : null;
}

/**
 * Who Claudio writes to GitHub as: the GitHub App ("Claudio[bot]") when it is
 * installed on the repository, otherwise the signed-in person.
 */
export async function githubAs(repoFullName: string, user: SessionUser | null): Promise<{ client: ReturnType<typeof createGithubClient>; as: 'app' | 'user' } | null> {
	const bot = await botClient(repoFullName).catch(() => null);
	if (bot) return { client: bot, as: 'app' };
	const token = user ? await userToken(user) : null;
	return token ? { client: createGithubClient(token), as: 'user' } : null;
}
