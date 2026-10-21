import type { BudgetTier } from "./schemas.js";
import type { TestBudgetTier } from "./testing.js";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type BudgetProfile = {
  orchestratorModel: string;
  workerModel: string;
  effort: EffortLevel;
  maxTurns: number;
  maxBudgetUsd: number;
  maxBrowserSteps: number;
  /** Delegate AC verification, regression checks and UX review to separate subagents (reviews only). */
  delegateChecks: boolean;
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
    delegateChecks: false,
  },
  standard: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "high",
    maxTurns: 150,
    maxBudgetUsd: 8,
    maxBrowserSteps: 250,
    delegateChecks: true,
  },
  thorough: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "xhigh",
    maxTurns: 400,
    maxBudgetUsd: 25,
    maxBrowserSteps: 700,
    delegateChecks: true,
  },
};

/**
 * Repository analysis reads the whole code base and walks through every screen,
 * so it gets more turns and browser steps than a review of the same tier.
 */
export const ANALYSIS_TIERS: Record<BudgetTier, BudgetProfile> = {
  quick: {
    orchestratorModel: "claude-sonnet-5-5",
    workerModel: "claude-haiku-5-5",
    effort: "medium",
    maxTurns: 120,
    maxBudgetUsd: 4,
    maxBrowserSteps: 150,
    delegateChecks: false,
  },
  standard: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "high",
    maxTurns: 300,
    maxBudgetUsd: 15,
    maxBrowserSteps: 400,
    delegateChecks: false,
  },
  thorough: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "xhigh",
    maxTurns: 600,
    maxBudgetUsd: 40,
    maxBrowserSteps: 900,
    delegateChecks: false,
  },
};

export function analysisProfile(tier: BudgetTier): BudgetProfile {
  return ANALYSIS_TIERS[tier];
}

/**
 * Test scripts: one flow per run. Only recording, exploring and healing use the
 * model; a deterministic replay costs nothing.
 */
export const TEST_TIERS: Record<TestBudgetTier, BudgetProfile> = {
  // Repairs of small UI changes and simple flows (also the tier of tests that run with PR reviews).
  quick: {
    orchestratorModel: "claude-haiku-5-5",
    workerModel: "claude-haiku-5-5",
    effort: "medium",
    maxTurns: 50,
    maxBudgetUsd: 1,
    maxBrowserSteps: 60,
    delegateChecks: false,
  },
  // Default for recordings.
  standard: {
    orchestratorModel: "claude-sonnet-5-5",
    workerModel: "claude-haiku-5-5",
    effort: "high",
    maxTurns: 90,
    maxBudgetUsd: 3,
    maxBrowserSteps: 120,
    delegateChecks: false,
  },
  thorough: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "high",
    maxTurns: 120,
    maxBudgetUsd: 5,
    maxBrowserSteps: 180,
    delegateChecks: false,
  },
  extra: {
    orchestratorModel: "claude-opus-5-5",
    workerModel: "claude-sonnet-5-5",
    effort: "xhigh",
    maxTurns: 160,
    maxBudgetUsd: 8,
    maxBrowserSteps: 250,
    delegateChecks: false,
  },
};

export function testProfile(tier: TestBudgetTier): BudgetProfile {
  return TEST_TIERS[tier];
}

/** The profile with its cost cap lowered to what is left of the repository's monthly budget. */
export function capBudget<P extends { maxBudgetUsd: number }>(profile: P, remainingUsd?: number | null): P {
  if (remainingUsd === undefined || remainingUsd === null) return profile;
  return { ...profile, maxBudgetUsd: Math.max(0.05, Math.min(profile.maxBudgetUsd, remainingUsd)) };
}

export function budgetProfile(tier: BudgetTier, modelOverride?: string): BudgetProfile {
  const base = BUDGET_TIERS[tier];
  return modelOverride ? { ...base, orchestratorModel: modelOverride } : base;
}
