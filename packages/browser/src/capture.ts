import type { BrowserContext, Page, Request as PwRequest } from "playwright";

export type ConsoleEntry = {
  seq: number;
  ts: string;
  level: string;
  text: string;
  pageUrl: string;
  location?: string;
};

export type NetworkEntry = {
  seq: number;
  ts: string;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  ok?: boolean;
  failed?: string;
  durationMs?: number;
  requestBody?: string;
  responseBody?: string;
  pageUrl: string;
};

const BODY_LIMIT = 4_000;
const API_TYPES = new Set(["xhr", "fetch"]);

/**
 * Collects console messages and network traffic for every page of a browser
 * context, including pages opened later by Playwright MCP. Bodies are only
 * kept for XHR/fetch requests and truncated, so the buffer stays small.
 */
export class CaptureBuffer {
  readonly console: ConsoleEntry[] = [];
  readonly network: NetworkEntry[] = [];
  private seq = 0;
  private pending = new Map<PwRequest, NetworkEntry>();
  private attachedPages = new WeakSet<Page>();

  attach(context: BrowserContext): void {
    context.pages().forEach((p) => this.attachPage(p));
    context.on("page", (p) => this.attachPage(p));
  }

  private attachPage(page: Page): void {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);
    page.on("console", (msg) => {
      const loc = msg.location();
      this.console.push({
        seq: ++this.seq,
        ts: new Date().toISOString(),
        level: msg.type(),
        text: msg.text(),
        pageUrl: safeUrl(page),
        location: loc.url ? `${loc.url}:${loc.lineNumber}` : undefined,
      });
    });
    page.on("pageerror", (err) => {
      this.console.push({
        seq: ++this.seq,
        ts: new Date().toISOString(),
        level: "pageerror",
        text: err.message,
        pageUrl: safeUrl(page),
      });
    });
    page.on("request", (req) => {
      const entry: NetworkEntry = {
        seq: ++this.seq,
        ts: new Date().toISOString(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        pageUrl: safeUrl(page),
      };
      if (API_TYPES.has(req.resourceType())) {
        const body = req.postData();
        if (body) entry.requestBody = truncate(body, BODY_LIMIT);
      }
      this.pending.set(req, entry);
      this.network.push(entry);
    });
    page.on("response", async (res) => {
      const entry = this.pending.get(res.request());
      if (!entry) return;
      entry.status = res.status();
      entry.ok = res.ok();
      entry.durationMs = Date.now() - Date.parse(entry.ts);
      if (API_TYPES.has(entry.resourceType) || !res.ok()) {
        try {
          const ct = res.headers()["content-type"] ?? "";
          if (/json|text/.test(ct)) entry.responseBody = truncate(await res.text(), BODY_LIMIT);
        } catch {
          // body may be unavailable (redirect, aborted); keep status only
        }
      }
      this.pending.delete(res.request());
    });
    page.on("requestfailed", (req) => {
      const entry = this.pending.get(req);
      if (!entry) return;
      entry.failed = req.failure()?.errorText ?? "failed";
      entry.ok = false;
      this.pending.delete(req);
    });
  }

  queryConsole(opts: { level?: string; contains?: string; sinceSeq?: number; limit?: number } = {}): ConsoleEntry[] {
    const limit = opts.limit ?? 50;
    const minLevel = opts.level ?? "all";
    return this.console
      .filter((e) => (opts.sinceSeq ? e.seq > opts.sinceSeq : true))
      .filter((e) => matchesLevel(e.level, minLevel))
      .filter((e) => (opts.contains ? e.text.toLowerCase().includes(opts.contains.toLowerCase()) : true))
      .slice(-limit);
  }

  queryNetwork(opts: { urlContains?: string; onlyErrors?: boolean; onlyApi?: boolean; sinceSeq?: number; limit?: number } = {}): NetworkEntry[] {
    const limit = opts.limit ?? 50;
    return this.network
      .filter((e) => (opts.sinceSeq ? e.seq > opts.sinceSeq : true))
      .filter((e) => (opts.onlyApi ? API_TYPES.has(e.resourceType) || e.resourceType === "document" : true))
      .filter((e) => (opts.onlyErrors ? e.failed !== undefined || (e.status !== undefined && e.status >= 400) : true))
      .filter((e) => (opts.urlContains ? e.url.toLowerCase().includes(opts.urlContains.toLowerCase()) : true))
      .slice(-limit);
  }

  get lastSeq(): number {
    return this.seq;
  }

  snapshot(): { console: ConsoleEntry[]; network: NetworkEntry[] } {
    return { console: [...this.console], network: [...this.network] };
  }
}

function matchesLevel(level: string, min: string): boolean {
  if (min === "all") return true;
  const errorLike = new Set(["error", "pageerror", "assert"]);
  const warnLike = new Set(["warning", "warn"]);
  if (min === "error") return errorLike.has(level);
  if (min === "warning") return errorLike.has(level) || warnLike.has(level);
  return true;
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + `... [truncated ${text.length - max} chars]`;
}
