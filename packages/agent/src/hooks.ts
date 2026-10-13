import type { HookCallback, HookCallbackMatcher, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { detectCaptcha, type BrowserAttachment } from "@claudio/browser";

export type BrowserGuardOptions = {
  allowedHosts: string[];
  maxBrowserSteps: number;
  onStep?: (count: number, toolName: string) => void;
};

export type BrowserGuard = {
  hooks: HookCallbackMatcher[];
  steps(): number;
};

const NAVIGATION_TOOLS = new Set(["mcp__playwright__browser_navigate", "mcp__claude-in-chrome__navigate"]);

/**
 * PreToolUse guard for browser tools: keeps navigation on the allowed hosts,
 * blocks javascript: URLs and enforces the budget's browser step limit.
 */
export function createBrowserGuard(opts: BrowserGuardOptions): BrowserGuard {
  let steps = 0;
  const allowed = opts.allowedHosts.map((h) => h.toLowerCase());

  const guard: HookCallback = async (input) => {
    const i = input as PreToolUseHookInput;
    if (i.hook_event_name !== "PreToolUse") return {};
    const name = i.tool_name;
    if (!name.startsWith("mcp__playwright__") && !name.includes("chrome")) return {};
    if (name.startsWith("mcp__claudio__")) return {};

    steps += 1;
    opts.onStep?.(steps, name);
    if (steps > opts.maxBrowserSteps) {
      return deny(`Browser step budget of ${opts.maxBrowserSteps} exhausted. Stop testing, record what you have with report_finding / record_ac_result, and write the final summary now.`);
    }

    if (NAVIGATION_TOOLS.has(name)) {
      const url = String((i.tool_input as { url?: string })?.url ?? "");
      const verdictMsg = checkUrl(url, allowed);
      if (verdictMsg) return deny(verdictMsg);
    }
    return {};
  };

  return {
    hooks: [{ matcher: "^mcp__", hooks: [guard] }],
    steps: () => steps,
  };
}

function checkUrl(url: string, allowedHosts: string[]): string | null {
  if (!url) return null;
  if (/^javascript:/i.test(url)) return "javascript: URLs are not allowed.";
  if (/^(about:blank|data:)/i.test(url)) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Relative URLs resolve against the current page, which is already on an allowed host.
    return null;
  }
  const ok = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? null : `Navigation to ${host} is outside the instance under test (allowed: ${allowedHosts.join(", ")}). Stay on the app.`;
}

function deny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
    },
  };
}

/**
 * After every browser action, checks the page for a CAPTCHA or bot check and
 * tells the agent to hand over to a person instead of trying to solve it.
 */
export function createCaptchaHook(page: BrowserAttachment["activePage"], humanAvailable: boolean): HookCallbackMatcher {
  const hook: HookCallback = async () => {
    const captcha = await detectCaptcha(page());
    if (!captcha) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: humanAvailable
          ? `A ${captcha} is on the page. Do not try to solve it. Call request_human_help and continue after the person is done.`
          : `A ${captcha} is on the page. Do not try to solve it. Record the affected checks as blocked and continue with what you can test.`,
      },
    };
  };
  return { matcher: "^mcp__playwright__browser_", hooks: [hook] };
}

/**
 * Soft stop: once the signal fires, every further tool call is denied with an
 * instruction to finish. The agent ends its turn and the SDK still reports the
 * run's real cost, which a hard abort would lose.
 */
export function createStopHook(signal: AbortSignal | undefined): HookCallbackMatcher[] {
  if (!signal) return [];
  const hook: HookCallback = async () => {
    if (!signal.aborted) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "The run was cancelled by a person. Do not call any more tools. Reply with one short sentence and end your turn now.",
      },
    };
  };
  return [{ matcher: ".*", hooks: [hook] }];
}
