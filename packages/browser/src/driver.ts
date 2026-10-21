import type { Viewport } from "@claudio/core";
import type { ViewportEmulation } from "./viewport.js";
import type { Browser, BrowserContext, Page } from "playwright";
import type { DriverName } from "@claudio/core";
import type { CaptureBuffer } from "./capture.js";

/** Structurally compatible with the Agent SDK's McpStdioServerConfig. */
export type StdioServerSpec = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  alwaysLoad?: boolean;
};

/** Claudio's own handle on the browser that the agent drives. */
export type BrowserAttachment = {
  browser: Browser;
  context: BrowserContext;
  capture: CaptureBuffer;
  cdpEndpoint: string;
  /** The page the agent most recently interacted with (best effort: last page in the context). */
  activePage(): Page | undefined;
  /** Desktop or phone emulation of all pages. */
  viewport?: ViewportEmulation;
};

export type DriverSession = {
  name: DriverName;
  mcpServers: Record<string, StdioServerSpec>;
  /** Tool patterns the agent may call without a permission prompt. */
  allowedTools: string[];
  /** Tools removed from the agent entirely. */
  disallowedTools: string[];
  /** Extra CLI flags for the Claude Code harness (e.g. `--chrome`). */
  extraArgs?: Record<string, string | null>;
  /** Driver-specific instructions prepended to the task prompt. */
  promptPrefix: string;
  attachment: BrowserAttachment | null;
  close(): Promise<void>;
};

export type DriverStartOptions = {
  runDir: string;
  instanceUrl: string;
  headed: boolean;
  /** Explicit Chromium binary; defaults to Playwright's bundled browser or CLAUDIO_CHROMIUM_PATH. */
  chromiumPath?: string;
  /** @deprecated use `device`; kept for callers that set a custom desktop size. */
  viewport?: { width: number; height: number };
  /** Desktop (default) or phone emulation. */
  device?: Viewport;
  language?: "de" | "en";
};

export interface BrowserDriver {
  readonly name: DriverName;
  start(opts: DriverStartOptions): Promise<DriverSession>;
}
