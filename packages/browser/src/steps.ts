import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { describeStep, hostAllowed, resolveCredentials, resolveStepTemplates, type RoleConfig, type Target, type TestStep } from "@claudio/core";
import type { BrowserAttachment } from "./driver.js";
import { loginWithRole } from "./login.js";
import type { RunStore } from "./run-store.js";

export type StepContext = {
  attachment: BrowserAttachment;
  instanceUrl: string;
  roles: Record<string, RoleConfig>;
  env: NodeJS.ProcessEnv;
  /** Short unique tag of this run, substituted for {{run}}. */
  runTag: string;
  store: RunStore;
  /** Hosts besides the instance the test may open (repo and test settings, e.g. an auth provider). */
  extraAllowedHosts?: string[];
  /** The test may navigate anywhere. */
  allowAnyHost?: boolean;
  /** Console/network sequence number at the start of the test, for expect_no_errors. */
  baselineSeq: number;
  actionTimeoutMs?: number;
  expectTimeoutMs?: number;
};

export type StepOutcome = {
  ok: boolean;
  error?: string;
  /** The failure is an assertion (the app behaves differently), not a missing element. */
  assertionFailed?: boolean;
  durationMs: number;
};

export function allowedHosts(ctx: Pick<StepContext, "instanceUrl" | "extraAllowedHosts">): string[] {
  return [new URL(ctx.instanceUrl).hostname, ...(ctx.extraAllowedHosts ?? [])];
}

/**
 * Blocks page navigations (links, redirects, form posts) to hosts the test may
 * not open, so a click cannot leave the instance either. Subresources such as
 * fonts or CDN scripts are not affected.
 */
export async function guardNavigation(ctx: StepContext, onBlocked: (url: string) => void): Promise<void> {
  if (ctx.allowAnyHost) return;
  const allowed = allowedHosts(ctx);
  await ctx.attachment.context.route("**/*", (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.frame().parentFrame() === null) {
      let host = "";
      try {
        host = new URL(req.url()).hostname;
      } catch {
        return route.continue();
      }
      if (host && !hostAllowed(host, allowed)) {
        onBlocked(req.url());
        return route.abort("blockedbyclient");
      }
    }
    return route.continue();
  });
}

/** The page the test drives: the newest open tab, or a fresh one. */
export async function testPage(attachment: BrowserAttachment): Promise<Page> {
  return attachment.activePage() ?? (await attachment.context.newPage());
}

export function locate(page: Page, t: Target): Locator {
  if ("role" in t) return page.getByRole(t.role as Parameters<Page["getByRole"]>[0], { name: t.name, exact: t.exact });
  if ("label" in t) return page.getByLabel(t.label, { exact: t.exact });
  if ("placeholder" in t) return page.getByPlaceholder(t.placeholder);
  if ("text" in t) return page.getByText(t.text, { exact: t.exact });
  if ("testId" in t) return page.getByTestId(t.testId);
  return page.locator(t.css);
}

/**
 * Executes one step with Playwright directly (no model). Recording and replay
 * both go through here, so a recorded step replays exactly as it ran.
 */
export async function executeStep(recorded: TestStep, ctx: StepContext): Promise<StepOutcome> {
  const started = Date.now();
  const actionTimeout = ctx.actionTimeoutMs ?? 8_000;
  const expectTimeout = ctx.expectTimeoutMs ?? 5_000;
  // Templates ({{run}}, {{date:…}}) may appear in values, texts and target names.
  const step = resolveStepTemplates(recorded, { runTag: ctx.runTag });
  const done = (ok: boolean, error?: string, assertionFailed = false): StepOutcome => ({ ok, error, assertionFailed, durationMs: Date.now() - started });

  try {
    const page = await testPage(ctx.attachment);
    switch (step.action) {
      case "login": {
        const role = ctx.roles[step.role];
        if (!role) return done(false, `Unknown role "${step.role}". Configured: ${Object.keys(ctx.roles).join(", ") || "none"}.`);
        const creds = resolveCredentials(role, ctx.env);
        if (!creds) return done(false, `Credentials for role "${step.role}" are missing.`);
        await ctx.attachment.context.clearCookies().catch(() => undefined);
        const r = await loginWithRole(ctx.attachment.context, ctx.instanceUrl, role, creds);
        return r.ok ? done(true) : done(false, `Login failed: ${r.error}`);
      }
      case "goto": {
        const url = new URL(step.path, ctx.instanceUrl);
        const allowed = allowedHosts(ctx);
        if (!ctx.allowAnyHost && !hostAllowed(url.hostname, allowed)) {
          return done(false, `${url.host} is not allowed for this test (allowed: ${allowed.join(", ")}). More hosts can be allowed in the test or repository settings.`);
        }
        await page.goto(url.toString(), { timeout: actionTimeout * 2 });
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        return done(true);
      }
      case "click":
        await locate(page, step.target).click({ timeout: actionTimeout });
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        return done(true);
      case "fill":
        await locate(page, step.target).fill(step.value, { timeout: actionTimeout });
        return done(true);
      case "select":
        await locate(page, step.target).selectOption({ label: step.value }, { timeout: actionTimeout }).catch(async () => {
          await locate(page, step.target).selectOption(step.value, { timeout: actionTimeout });
        });
        return done(true);
      case "check":
        await locate(page, step.target).check({ timeout: actionTimeout });
        return done(true);
      case "uncheck":
        await locate(page, step.target).uncheck({ timeout: actionTimeout });
        return done(true);
      case "press":
        if (step.target) await locate(page, step.target).press(step.key, { timeout: actionTimeout });
        else await page.keyboard.press(step.key);
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        return done(true);
      case "expect_visible":
        try {
          await locate(page, step.target).first().waitFor({ state: "visible", timeout: expectTimeout });
          return done(true);
        } catch {
          return done(false, `Not visible: ${describeStep(step)}`, true);
        }
      case "expect_hidden":
        try {
          await locate(page, step.target).first().waitFor({ state: "hidden", timeout: expectTimeout });
          return done(true);
        } catch {
          return done(false, `Still visible: ${describeStep(step)}`, true);
        }
      case "expect_text": {
        const text = step.text;
        const scope = step.target ? locate(page, step.target).first() : page.locator("body");
        const deadline = Date.now() + expectTimeout;
        let seen = "";
        while (Date.now() < deadline) {
          seen = (await scope.innerText({ timeout: expectTimeout }).catch(() => "")) ?? "";
          if (seen.includes(text)) return done(true);
          await page.waitForTimeout(250);
        }
        return done(false, `Text "${text}" not found${step.target ? " in the target" : " on the page"}. Visible text starts with: ${seen.replace(/\s+/g, " ").slice(0, 200)}`, true);
      }
      case "expect_url": {
        const want = step.contains;
        const deadline = Date.now() + expectTimeout;
        while (Date.now() < deadline) {
          if (page.url().includes(want)) return done(true);
          await page.waitForTimeout(200);
        }
        return done(false, `URL ${page.url()} does not contain "${want}".`, true);
      }
      case "expect_no_errors": {
        const capture = ctx.attachment.capture;
        const consoleErrors = capture.queryConsole({ level: "error", sinceSeq: ctx.baselineSeq, limit: 5 });
        const networkErrors = capture.queryNetwork({ onlyErrors: true, onlyApi: true, sinceSeq: ctx.baselineSeq, limit: 5 });
        if (consoleErrors.length === 0 && networkErrors.length === 0) return done(true);
        const parts = [
          ...consoleErrors.map((e) => `console: ${e.text.slice(0, 160)}`),
          ...networkErrors.map((e) => `${e.method} ${e.url} → ${e.failed ?? e.status}`),
        ];
        return done(false, `Errors during the test: ${parts.join("; ")}`, true);
      }
      case "screenshot": {
        const id = ctx.store.nextEvidenceId();
        const safe = step.label.replace(/[^\w.-]+/g, "_").slice(0, 60);
        const file = join(ctx.store.evidenceDir, `${id}-${safe}.png`);
        await page.screenshot({ path: file });
        ctx.store.addEvidence({ id, kind: "screenshot", label: step.label, path: `evidence/${id}-${safe}.png`, pageUrl: page.url() });
        return done(true);
      }
    }
  } catch (e) {
    return done(false, cleanError((e as Error).message));
  }
}

/** Playwright errors carry call logs; keep the first lines, which say what went wrong. */
function cleanError(message: string): string {
  return message.split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ").slice(0, 400);
}

/** Accessibility tree of the current page (roles and names), for choosing step targets. */
export async function ariaSnapshot(attachment: BrowserAttachment, maxChars = 15_000): Promise<string> {
  const page = await testPage(attachment);
  const tree = await page.locator("body").ariaSnapshot({ timeout: 5_000 }).catch((e: Error) => `(snapshot failed: ${e.message})`);
  const head = `URL: ${page.url()}\nTitle: ${await page.title().catch(() => "")}\n\n`;
  return head + (tree.length > maxChars ? tree.slice(0, maxChars) + "\n… (truncated)" : tree);
}
