#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { runReview } from "@claudio/agent";
import { BudgetTierSchema, DriverNameSchema, LanguageSchema, StrictnessSchema, VerbositySchema, blockingFindings, verdict } from "@claudio/core";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const program = new Command();
program.name("claudio").description("Agentic user review for web apps").version("0.1.0");

function enumParser(name: string, values: readonly string[]) {
  return (v: string) => {
    if (!values.includes(v)) throw new InvalidArgumentError(`${name} must be one of ${values.join(", ")}`);
    return v;
  };
}

program
  .command("review")
  .description("Review a pull request against a running instance of the app")
  .requiredOption("--repo <owner/name>", "GitHub repository")
  .requiredOption("--pr <number>", "Pull request number", (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("pr must be a positive integer");
    return n;
  })
  .requiredOption("--url <instanceUrl>", "Base URL of the deployed PR branch")
  .option("--role <name...>", "Role(s) to start with (must be configured in claudio.config.json)")
  .option("--driver <name>", "playwright (unattended) or chrome (live, Claude in Chrome)", enumParser("driver", DriverNameSchema.options), "playwright")
  .option("--budget <tier>", "quick | standard | thorough", enumParser("budget", BudgetTierSchema.options), "standard")
  .option("--verbosity <level>", "tldr | normal | detailed", enumParser("verbosity", VerbositySchema.options), "normal")
  .option("--strictness <level>", "lenient | normal | strict", enumParser("strictness", StrictnessSchema.options), "normal")
  .option("--lang <code>", "Report language: de | en", enumParser("lang", LanguageSchema.options), "de")
  .option("--headed", "Show the browser window (playwright driver)", false)
  .option("--comment", "Post a TL;DR comment to the pull request", false)
  .option("--no-clone", "Skip cloning the PR branch for code analysis")
  .option("--model <id>", "Override the orchestrator model")
  .option("--instructions <text>", "Extra instructions for this run")
  .option("--pr-context <path>", "Use a PullRequestContext JSON file instead of GitHub (offline runs)")
  .option("--repo-dir <path>", "Use an existing checkout instead of cloning the PR branch")
  .option("--config <path>", "Path to claudio.config.json", "claudio.config.json")
  .option("--runs <dir>", "Directory for run outputs", "runs")
  .action(async (opts) => {
    const abort = new AbortController();
    process.on("SIGINT", () => {
      console.error("\naborting run...");
      abort.abort();
    });
    const report = await runReview(
      {
        repo: opts.repo,
        pr: opts.pr,
        instanceUrl: opts.url,
        roles: opts.role ?? [],
        driver: opts.driver,
        budget: opts.budget,
        verbosity: opts.verbosity,
        strictness: opts.strictness,
        language: opts.lang,
        headed: opts.headed,
        postComment: opts.comment,
        cloneRepo: opts.clone,
        modelOverride: opts.model,
        extraInstructions: opts.instructions,
      },
      {
        runsRoot: resolve(opts.runs),
        configPath: opts.config,
        prContextFile: opts.prContext,
        repoDir: opts.repoDir,
        projectRoot: process.cwd(),
        abortController: abort,
        onProgress: (line) => console.error(`[claudio] ${line}`),
      },
    );
    const blocking = blockingFindings(report);
    console.log("");
    console.log(`Verdict: ${verdict(report)} (${report.status})`);
    console.log(`Acceptance criteria: ${report.acceptanceCriteria.filter((a) => a.status === "passed").length}/${report.acceptanceCriteria.length} passed`);
    console.log(`Findings: ${report.findings.length} (blocking: ${blocking.length})`);
    console.log(`Cost: ${report.cost.usd.toFixed(2)} USD, ${report.cost.turns} turns, ${report.cost.browserSteps} browser steps, ${Math.round(report.cost.durationMs / 1000)}s`);
    console.log(`Report: ${resolve(opts.runs)}/${report.runId}/report.md`);
    process.exitCode = report.status === "completed" ? 0 : 2;
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
