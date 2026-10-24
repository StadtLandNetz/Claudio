import { ViewportSchema, type Viewport } from '@claudio/core';
import { budgetState, type Repo } from '@claudio/db';
import type { I18n } from '#lib/i18n/index.js';
import { db } from './db.js';

/** Viewports ticked in a form (`viewports` checkboxes); none ticked means desktop. */
export function viewportsOf(f: FormData): Viewport[] {
	const picked = f.getAll('viewports').flatMap((v) => {
		const p = ViewportSchema.safeParse(String(v));
		return p.success ? [p.data] : [];
	});
	return picked.length ? [...new Set(picked)] : ['desktop'];
}


/** Why no new run may start in this repository, or null: the monthly budget is used up. */
export async function budgetBlocks(repo: Pick<Repo, 'id' | 'monthlyBudgetUsd'>, t: I18n['t']): Promise<string | null> {
	const state = await budgetState(db(), repo);
	return state.exhausted ? t('system.budgetExhausted', { spent: state.spent.toFixed(2), limit: state.limit!.toFixed(2) }) : null;
}
