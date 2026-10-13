import type { BrowserContext, Page } from "playwright";
import type { Credentials, RoleConfig } from "@claudio/core";

export type LoginResult = { ok: true; finalUrl: string; page: Page } | { ok: false; error: string; finalUrl?: string };

/**
 * Logs a role in. Uses the explicit recipe when the config has one, otherwise
 * an adaptive heuristic that works for most username/password forms.
 * Credentials never appear in returned messages.
 */
export async function loginWithRole(
  context: BrowserContext,
  instanceUrl: string,
  role: RoleConfig,
  creds: Credentials,
): Promise<LoginResult> {
  const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
  try {
    if (role.recipe && role.recipe.length > 0) {
      await runRecipe(page, instanceUrl, role, creds);
    } else {
      await autoLogin(page, instanceUrl, role, creds);
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    const finalUrl = page.url();
    if (role.successUrlContains && !finalUrl.includes(role.successUrlContains)) {
      return { ok: false, error: `Login did not reach a URL containing "${role.successUrlContains}"`, finalUrl };
    }
    if (looksLikeLoginPage(finalUrl, role)) {
      const err = await visibleErrorText(page);
      return { ok: false, error: `Still on the login page after submitting${err ? `: ${err}` : ""}`, finalUrl };
    }
    return { ok: true, finalUrl, page };
  } catch (e) {
    return { ok: false, error: scrub((e as Error).message, creds), finalUrl: safeUrl(page) };
  }
}

async function runRecipe(page: Page, instanceUrl: string, role: RoleConfig, creds: Credentials): Promise<void> {
  const subst = (v: string) => v.replace(/\$USER\b/g, creds.username).replace(/\$PASSWORD\b/g, creds.password);
  for (const step of role.recipe ?? []) {
    switch (step.action) {
      case "goto":
        await page.goto(new URL(step.url, instanceUrl).toString(), { waitUntil: "domcontentloaded" });
        break;
      case "fill":
        await page.locator(step.selector).first().fill(subst(step.value));
        break;
      case "click":
        await page.locator(step.selector).first().click();
        break;
      case "press":
        await page.keyboard.press(step.key);
        break;
      case "waitForUrl":
        await page.waitForURL((u) => u.toString().includes(step.pattern), { timeout: 20_000 });
        break;
      case "waitForSelector":
        await page.locator(step.selector).first().waitFor({ timeout: 20_000 });
        break;
    }
  }
}

async function autoLogin(page: Page, instanceUrl: string, role: RoleConfig, creds: Credentials): Promise<void> {
  await page.goto(new URL(role.loginPath, instanceUrl).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

  const password = page.locator('input[type="password"]').first();
  await password.waitFor({ timeout: 15_000 });

  const userCandidates = [
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[name*="user" i]',
    'input[name*="mail" i]',
    'input[name*="login" i]',
    'input[type="text"]',
  ];
  let filledUser = false;
  for (const sel of userCandidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      await loc.fill(creds.username);
      filledUser = true;
      break;
    }
  }
  if (!filledUser) throw new Error("Could not find a username/email field on the login page");
  await password.fill(creds.password);

  const submit = page.locator('button[type="submit"], input[type="submit"], form button').first();
  const startUrl = page.url();
  if ((await submit.count()) > 0) {
    await submit.click();
  } else {
    await password.press("Enter");
  }
  await Promise.race([
    page.waitForURL((u) => u.toString() !== startUrl, { timeout: 20_000 }),
    page.waitForLoadState("networkidle", { timeout: 20_000 }),
  ]).catch(() => undefined);
}

function looksLikeLoginPage(url: string, role: RoleConfig): boolean {
  const loginPath = role.loginPath.replace(/\/+$/, "");
  return loginPath.length > 1 && new URL(url).pathname.replace(/\/+$/, "") === loginPath;
}

async function visibleErrorText(page: Page): Promise<string> {
  const candidates = page.locator('[role="alert"], .error, .alert, [class*="error" i], [data-testid*="error" i]');
  const n = Math.min(await candidates.count(), 3);
  const texts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (await candidates.nth(i).innerText().catch(() => "")).trim();
    if (t) texts.push(t.slice(0, 200));
  }
  return texts.join(" | ");
}

function scrub(text: string, creds: Credentials): string {
  return text.split(creds.password).join("***").split(creds.username).join("<user>");
}

function safeUrl(page: Page): string | undefined {
  try {
    return page.url();
  } catch {
    return undefined;
  }
}
