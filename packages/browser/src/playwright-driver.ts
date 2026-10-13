import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { CaptureBuffer } from "./capture.js";
import type { BrowserAttachment, BrowserDriver, DriverSession, DriverStartOptions } from "./driver.js";

const require = createRequire(import.meta.url);

/**
 * Unattended driver. Claudio launches Chromium itself and lets Playwright MCP
 * attach over CDP, so both the agent (via MCP) and Claudio's own tools
 * (login, evidence, console/network capture) share one browser.
 */
export class PlaywrightDriver implements BrowserDriver {
  readonly name = "playwright" as const;

  async start(opts: DriverStartOptions): Promise<DriverSession> {
    const port = await freePort();
    const executablePath = opts.chromiumPath ?? process.env.CLAUDIO_CHROMIUM_PATH;
    let launched: Browser;
    try {
      launched = await chromium.launch({
        headless: !opts.headed,
        executablePath,
        args: [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (/Executable doesn't exist/i.test(msg)) {
        throw new Error(
          `Chromium not found${executablePath ? ` at ${executablePath}` : ""}. Run "pnpm exec playwright install chromium" or set CLAUDIO_CHROMIUM_PATH to a Chromium/Chrome binary.`,
        );
      }
      throw e;
    }
    const cdpEndpoint = `http://127.0.0.1:${port}`;

    const attached = await chromium.connectOverCDP(cdpEndpoint);
    const context = attached.contexts()[0] ?? (await attached.newContext());
    const capture = new CaptureBuffer();
    capture.attach(context);
    if (opts.viewport) {
      context.on("page", (p) => p.setViewportSize(opts.viewport!).catch(() => undefined));
    }

    let tracing = false;
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      tracing = true;
    } catch {
      // tracing is best effort over CDP
    }

    const attachment: BrowserAttachment = {
      browser: attached,
      context,
      capture,
      cdpEndpoint,
      activePage: () => {
        const pages = context.pages().filter((p) => !p.isClosed());
        return pages[pages.length - 1];
      },
    };

    const mcpOutputDir = join(opts.runDir, "mcp-output");
    mkdirSync(mcpOutputDir, { recursive: true });
    // The package exports only its index; the CLI sits next to it.
    const cliPath = join(dirname(require.resolve("@playwright/mcp")), "cli.js");
    const args = [
      cliPath,
      "--cdp-endpoint",
      cdpEndpoint,
      "--caps",
      "devtools",
      "--output-dir",
      mcpOutputDir,
      "--image-responses",
      "allow",
      "--timeout-action",
      "8000",
      "--timeout-settle",
      "800",
    ];
    if (opts.viewport) args.push("--viewport-size", `${opts.viewport.width}x${opts.viewport.height}`);

    const promptPrefix = [
      "Browser driver: Playwright MCP (headless, unattended).",
      "Use `mcp__playwright__browser_snapshot` to read the page (accessibility tree with element refs); take screenshots only when you need visual judgement or evidence.",
      "Use `mcp__claudio__capture_evidence` for every observation you will report, and `mcp__claudio__get_console` / `mcp__claudio__get_network` after each flow to check for errors.",
      `Only navigate within ${opts.instanceUrl}. Login is done with \`mcp__claudio__login_as\`, never by typing credentials yourself.`,
    ].join("\n");

    return {
      name: "playwright",
      mcpServers: {
        playwright: { type: "stdio", command: process.execPath, args, alwaysLoad: true },
      },
      allowedTools: ["mcp__playwright__*", "mcp__claudio__*"],
      disallowedTools: [
        "mcp__playwright__browser_run_code_unsafe",
        "mcp__playwright__browser_file_upload",
        "mcp__playwright__browser_start_recording",
        "mcp__playwright__browser_stop_recording",
      ],
      promptPrefix,
      attachment,
      close: async () => {
        const snap = capture.snapshot();
        writeFileSync(join(opts.runDir, "console.json"), JSON.stringify(snap.console, null, 2));
        writeFileSync(join(opts.runDir, "network.json"), JSON.stringify(snap.network, null, 2));
        if (tracing) {
          await context.tracing.stop({ path: join(opts.runDir, "trace.zip") }).catch(() => undefined);
        }
        await attached.close().catch(() => undefined);
        await launched.close().catch(() => undefined);
      },
    };
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
    srv.on("error", reject);
  });
}
