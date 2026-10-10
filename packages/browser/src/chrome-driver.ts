import type { BrowserDriver, DriverSession, DriverStartOptions } from "./driver.js";

/**
 * Live driver: the Claude in Chrome extension drives the developer's visible
 * Chrome window through the Claude Code harness (`--chrome`). People can watch
 * and step in (log in, solve a CAPTCHA). Documented for the CLI and VS Code;
 * whether the Agent SDK forwards the flag is a Phase 0 spike item.
 *
 * Limitations compared to the Playwright driver: no shared browser handle, so
 * Claudio cannot capture console/network itself or run login recipes. The
 * agent uses the extension's own tools for screenshots and console reads and
 * registers evidence paths with Claudio.
 */
export class ChromeExtensionDriver implements BrowserDriver {
  readonly name = "chrome" as const;

  async start(opts: DriverStartOptions): Promise<DriverSession> {
    const promptPrefix = [
      "Browser driver: Claude in Chrome (live mode). A person is watching the browser window and can step in.",
      "Use the Chrome browser tools for navigation, reading pages, clicking, typing and screenshots.",
      "When a login page appears, stop and ask the person to log in (say which role), then continue. Never type credentials yourself.",
      "Save screenshots to disk and register each one with `mcp__claudio__capture_evidence` (pass the file path). Network traffic is not captured in this mode; say so in findings where it matters.",
      `Only navigate within ${opts.instanceUrl}.`,
    ].join("\n");

    return {
      name: "chrome",
      mcpServers: {},
      allowedTools: ["mcp__claudio__*", "mcp__claude-in-chrome__*", "mcp__chrome__*"],
      disallowedTools: [],
      extraArgs: { chrome: null },
      promptPrefix,
      attachment: null,
      close: async () => undefined,
    };
  }
}
