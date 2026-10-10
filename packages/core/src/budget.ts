import type { BudgetTier } from "./schemas.js";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type BudgetProfile = {
  orchestratorModel: string;
  workerModel: string;
  effort: EffortLevel;
  maxTurns: number;
  maxBudgetUsd: number;
  maxBrowserSteps: number;
};

/**
 * Budget tiers map one user-facing option onto every cost lever at once.
 * Numbers are starting points for the Phase 0 spike and are meant to be tuned
 * from measured runs.
 */
export const BUDGET_TIERS: Record<BudgetTier, BudgetProfile> = {
  quick: {
    orchestratorModel: "claude-sonnet-5-5",
    workerModel: "claude-haiku-5-5",
    effort: "medium",
    maxTurns: 60,
    maxBudgetUsd: 2,
    maxBrowserSteps: 80,
  },
  standard: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "high",
    maxTurns: 150,
    maxBudgetUsd: 8,
    maxBrowserSteps: 250,
  },
  thorough: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "xhigh",
    maxTurns: 400,
    maxBudgetUsd: 25,
    maxBrowserSteps: 700,
  },
};

export function budgetProfile(tier: BudgetTier, modelOverride?: string): BudgetProfile {
  const base = BUDGET_TIERS[tier];
  return modelOverride ? { ...base, orchestratorModel: modelOverride } : base;
}
