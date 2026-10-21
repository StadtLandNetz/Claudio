/**
 * The compact index of a run's Playwright trace that the worker (or the web app)
 * builds from trace.zip and the timeline renders in the browser. Times are
 * milliseconds since the browser context started; `startWall` turns an ISO
 * timestamp of the report into one: `Date.parse(iso) - startWall`.
 */
export type TraceFrame = { t: number; file: string; w: number; h: number; page: string };
export type TraceAction = { t: number; end: number; method: string; title: string; detail?: string; error?: string };
export type TraceNavigation = { t: number; url: string };
export type TraceConsole = { t: number; level: "error" | "warning"; text: string };
export type ToolKind = "navigate" | "click" | "fill" | "login" | "evidence" | "finding" | "ac" | "note" | "other";
export type TraceToolCall = { t: number; tool: ToolKind; label: string; agent?: string };
export type TraceIndex = {
  startWall: number;
  durationMs: number;
  /** Screencast frames (JPEG), sorted by time. */
  frames: TraceFrame[];
  /** Claudio's own browser calls (login, test steps), without the live-view noise. */
  actions: TraceAction[];
  /** The main frame's URL changes. */
  navigations: TraceNavigation[];
  /** Console errors and warnings of the page. */
  console: TraceConsole[];
  /** What the agent asked its tools to do, from log.jsonl. */
  toolCalls: TraceToolCall[];
};
