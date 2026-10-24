import type { BrowserContext, Frame, Page, Request } from "playwright";
import { normalizePath } from "@claudio/core";

/** Built assets: they say nothing about which screen or endpoint a test used. */
const STATIC = /\.(?:m?js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|txt|xml|webmanifest)$|^\/_app\/immutable\//i;

/**
 * Records which paths of the instance a run opens or calls: page loads,
 * client-side navigation and fetch/XHR requests. Reviews pick a regression
 * test when one of its paths falls under a route the change reaches.
 */
export function trackTouchedPaths(context: BrowserContext, instanceUrl: string, limit = 200): { paths(): string[]; stop(): void } {
  const host = new URL(instanceUrl).host;
  const seen = new Set<string>();
  const add = (url: string) => {
    if (seen.size >= limit) return;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.host !== host || STATIC.test(u.pathname)) return;
    seen.add(normalizePath(u.pathname));
  };
  const onRequest = (req: Request) => {
    const type = req.resourceType();
    if (type === "document" || type === "fetch" || type === "xhr") add(req.url());
  };
  // Client-side navigation (history API) loads no document, but moves the main frame.
  const onNavigated = (frame: Frame) => {
    if (!frame.parentFrame()) add(frame.url());
  };
  const watch = (page: Page) => page.on("framenavigated", onNavigated);
  context.pages().forEach(watch);
  context.on("page", watch);
  context.on("request", onRequest);
  return {
    paths: () => [...seen],
    stop() {
      context.off("page", watch);
      context.off("request", onRequest);
      for (const page of context.pages()) page.off("framenavigated", onNavigated);
    },
  };
}
