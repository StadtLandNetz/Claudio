import type { BrowserContext, CDPSession, Page } from "playwright";
import type { Viewport } from "@claudio/core";

export type { Viewport };

export const VIEWPORT_SIZES: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

/** A current iPhone Safari: servers that pick a layout by user agent serve the phone one. */
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * Puts every page of a context (also pages opened later, by Playwright MCP too)
 * into the desktop or the phone viewport. The phone is emulated over CDP:
 * device metrics with the mobile flag, touch events and a mobile user agent.
 */
export class ViewportEmulation {
  private sessions = new WeakMap<Page, CDPSession>();
  private kind: Viewport;

  constructor(
    private readonly context: BrowserContext,
    initial: Viewport,
  ) {
    this.kind = initial;
    context.on("page", (p) => void this.apply(p));
    for (const p of context.pages()) void this.apply(p);
  }

  current(): Viewport {
    return this.kind;
  }

  /** Switches all open pages; reload a page afterwards if its server picks the layout by user agent. */
  async set(kind: Viewport): Promise<void> {
    this.kind = kind;
    await Promise.all(this.context.pages().filter((p) => !p.isClosed()).map((p) => this.apply(p)));
  }

  private async apply(page: Page): Promise<void> {
    try {
      if (this.kind === "desktop") {
        const s = this.sessions.get(page);
        if (s) {
          await s.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
          await s.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => undefined);
          await s.send("Emulation.setUserAgentOverride", { userAgent: "" }).catch(() => undefined);
        }
        await page.setViewportSize(VIEWPORT_SIZES.desktop);
        return;
      }
      let s = this.sessions.get(page);
      if (!s) {
        s = await this.context.newCDPSession(page);
        this.sessions.set(page, s);
      }
      const { width, height } = VIEWPORT_SIZES.mobile;
      await s.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true, screenWidth: width, screenHeight: height });
      await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await s.send("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA, platform: "iPhone" });
    } catch {
      // closed pages and pages that are not ready yet are skipped; the next navigation keeps the override
    }
  }
}
