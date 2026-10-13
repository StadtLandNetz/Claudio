import { renameSync, rmSync, writeFileSync } from "node:fs";
import type { CDPSession, Page } from "playwright";
import type { BrowserAttachment } from "./driver.js";

export type LiveView = { stop(): Promise<void> };

export type LiveViewOptions = {
  /** Upper bound for writes to disk; Chromium only sends frames when the page changes. */
  maxFps?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Take a real screenshot when the screencast has sent nothing for this long (ms). */
  refreshMs?: number;
};

/**
 * Mirrors what the agent's browser shows into one JPEG file (Chromium screencast
 * over CDP). The file is replaced atomically, so a reader never sees half a frame.
 * Follows the active tab. Costs no model tokens.
 */
export function startLiveView(attachment: BrowserAttachment, file: string, opts: LiveViewOptions = {}): LiveView {
  const minInterval = 1000 / (opts.maxFps ?? 4);
  const tmp = `${file}.tmp`;
  let session: CDPSession | null = null;
  let page: Page | null = null;
  let lastWrite = 0;
  let stopped = false;

  const attach = async (next: Page) => {
    if (stopped || next === page) return;
    await detach();
    page = next;
    try {
      const s = await attachment.context.newCDPSession(next);
      session = s;
      s.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
        s.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
        const now = Date.now();
        if (now - lastWrite < minInterval) return;
        lastWrite = now;
        try {
          writeFileSync(tmp, Buffer.from(frame.data, "base64"));
          renameSync(tmp, file);
        } catch {
          // disk hiccup: skip this frame
        }
      });
      await s.send("Page.startScreencast", {
        format: "jpeg",
        quality: opts.quality ?? 60,
        maxWidth: opts.maxWidth ?? 1280,
        maxHeight: opts.maxHeight ?? 800,
        everyNthFrame: 1,
      });
    } catch {
      // page closed before the session was ready; the poll below picks the next one
      session = null;
      page = null;
    }
  };

  const detach = async () => {
    const s = session;
    session = null;
    page = null;
    if (!s) return;
    await s.send("Page.stopScreencast").catch(() => undefined);
    await s.detach().catch(() => undefined);
  };

  // The agent opens and closes tabs through its own CDP connection; follow the newest one.
  const poll = setInterval(() => {
    const active = attachment.activePage();
    if (active && active !== page) void attach(active);
  }, 1000);

  // The screencast misses changes inside cross-origin iframes (reCAPTCHA, payment widgets),
  // so a still page can show a stale frame. A real screenshot includes them; take one when
  // the screencast has been quiet for a moment.
  let shooting = false;
  const refresh = setInterval(() => {
    if (shooting || Date.now() - lastWrite < (opts.refreshMs ?? 700)) return;
    const current = attachment.activePage();
    if (!current || current.isClosed()) return;
    shooting = true;
    current
      .screenshot({ type: "jpeg", quality: opts.quality ?? 60, timeout: 3000, animations: "allow", caret: "initial" })
      .then((buf) => {
        lastWrite = Date.now();
        writeFileSync(tmp, buf);
        renameSync(tmp, file);
      })
      .catch(() => undefined)
      .finally(() => (shooting = false));
  }, 250);
  const first = attachment.activePage();
  if (first) void attach(first);

  return {
    async stop() {
      stopped = true;
      clearInterval(poll);
      clearInterval(refresh);
      await detach();
      rmSync(tmp, { force: true });
    },
  };
}
