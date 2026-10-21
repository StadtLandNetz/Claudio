import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { analyses, repos, reviews, testRuns, type Repo } from "./schema.js";

/** Share of the monthly budget at which the repository is warned once. */
export const BUDGET_WARN_AT = 0.8;

export type BudgetState = {
  /** Monthly cap in USD, null when the repository has none. */
  limit: number | null;
  /** Spent in the current calendar month (finished runs; running ones count when they finish). */
  spent: number;
  remaining: number | null;
  /** spent / limit, 0 without a limit. */
  ratio: number;
  /** The cap is reached: no new run starts. */
  exhausted: boolean;
  /** YYYY-MM of the month the numbers are for. */
  month: string;
};

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export const parseBudget = (v: string | null | undefined): number | null => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** What a repository spent on model calls in the current calendar month. */
export async function monthSpend(db: Db, repoId: number, now = new Date()): Promise<number> {
  const since = monthStart(now);
  const [rows] = (await db.execute(sql`
    SELECT COALESCE(SUM(CAST(x.cost_usd AS DECIMAL(14,4))), 0) AS usd FROM (
      SELECT cost_usd FROM ${reviews} WHERE repo_id = ${repoId} AND created_at >= ${since}
      UNION ALL SELECT cost_usd FROM ${analyses} WHERE repo_id = ${repoId} AND created_at >= ${since}
      UNION ALL SELECT cost_usd FROM ${testRuns} WHERE repo_id = ${repoId} AND created_at >= ${since}
    ) x
  `)) as unknown as [{ usd: number | string }[]];
  return Number(rows[0]?.usd ?? 0);
}

export async function budgetState(db: Db, repo: Pick<Repo, "id" | "monthlyBudgetUsd">, now = new Date()): Promise<BudgetState> {
  const limit = parseBudget(repo.monthlyBudgetUsd);
  const spent = await monthSpend(db, repo.id, now);
  return {
    limit,
    spent,
    remaining: limit === null ? null : Math.max(0, limit - spent),
    ratio: limit ? spent / limit : 0,
    exhausted: limit !== null && spent >= limit,
    month: monthOf(now),
  };
}

export async function setMonthlyBudget(db: Db, repoId: number, usd: number | null): Promise<void> {
  await db.update(repos).set({ monthlyBudgetUsd: usd === null ? null : usd.toFixed(2) }).where(eq(repos.id, repoId));
}

/** True exactly once per repository and month: whoever gets it sends the warning. */
export async function claimBudgetWarning(db: Db, repoId: number, month: string): Promise<boolean> {
  const [res] = await db
    .update(repos)
    .set({ budgetWarnedMonth: month })
    .where(and(eq(repos.id, repoId), or(isNull(repos.budgetWarnedMonth), ne(repos.budgetWarnedMonth, month))));
  return res.affectedRows === 1;
}
