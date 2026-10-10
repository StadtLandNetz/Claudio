/**
 * Stand-alone MCP server exposing the Claudio tools over stdio.
 * Used by the Claude Code CLI live mode (see .mcp.json). Configuration comes
 * from environment variables so the same server works for any run:
 *
 *   CLAUDIO_RUN_DIR       directory for findings/evidence/notes (required)
 *   CLAUDIO_INSTANCE_URL  base URL of the app under test (required)
 *   CLAUDIO_CONFIG        path to claudio.config.json (optional)
 *   CLAUDIO_DRIVER        playwright | chrome (default chrome)
 *   CLAUDIO_CDP_ENDPOINT  attach to a running Chromium for screenshots/capture (optional)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium } from "playwright";
import { z } from "zod";
import { loadRepoConfig } from "@claudio/core";
import { CaptureBuffer } from "../capture.js";
import type { BrowserAttachment } from "../driver.js";
import { RunStore } from "../run-store.js";
import { createClaudioTools, type ToolContext } from "./definitions.js";

async function main(): Promise<void> {
  const runDir = process.env.CLAUDIO_RUN_DIR;
  const instanceUrl = process.env.CLAUDIO_INSTANCE_URL;
  if (!runDir || !instanceUrl) {
    console.error("CLAUDIO_RUN_DIR and CLAUDIO_INSTANCE_URL must be set");
    process.exit(2);
  }
  const config = loadRepoConfig(process.env.CLAUDIO_CONFIG);
  const driver = process.env.CLAUDIO_DRIVER === "playwright" ? "playwright" : "chrome";

  let attachment: BrowserAttachment | null = null;
  if (process.env.CLAUDIO_CDP_ENDPOINT) {
    const browser = await chromium.connectOverCDP(process.env.CLAUDIO_CDP_ENDPOINT);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const capture = new CaptureBuffer();
    capture.attach(context);
    attachment = {
      browser,
      context,
      capture,
      cdpEndpoint: process.env.CLAUDIO_CDP_ENDPOINT,
      activePage: () => context.pages().filter((p) => !p.isClosed()).at(-1),
    };
  }

  const ctx: ToolContext = {
    runDir,
    store: new RunStore(runDir),
    attachment,
    instanceUrl,
    roles: config?.roles ?? {},
    driver,
  };

  const server = new McpServer({ name: "claudio", version: "0.1.0" });
  for (const t of createClaudioTools(ctx)) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: z.object(t.schema).shape, annotations: { readOnlyHint: t.readOnly ?? false } },
      async (args: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: await t.handler(args as never) }] }),
    );
  }
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
