/**
 * Integration test for the paths a test run touches, against a throwaway local app.
 * Runs only when CLAUDIO_INTEGRATION=1 (needs a Chromium: bundled or CLAUDIO_CHROMIUM_PATH).
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { trackTouchedPaths } from "../src/touched-paths.js";

const enabled = process.env.CLAUDIO_INTEGRATION === "1";

describe.skipIf(!enabled)("trackTouchedPaths (integration)", () => {
  let server: Server;
  let instanceUrl: string;
  let browser: Browser;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/trips/") {
        res.setHeader("content-type", "text/html");
        // A client-side navigation, a data request and a built asset, as a SvelteKit page does them.
        res.end(
          `<h1>Fahrten</h1><script src="/_app/immutable/entry.js"></script><script>fetch('/trips/42/__data.json?x-sveltekit-invalidated=01').then(() => history.pushState({}, '', '/trips/42'));</script>`,
        );
      } else if (url.pathname === "/_app/immutable/entry.js") {
        res.setHeader("content-type", "text/javascript");
        res.end("");
      } else {
        res.setHeader("content-type", "application/json");
        res.end("{}");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    instanceUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch({ executablePath: process.env.CLAUDIO_CHROMIUM_PATH });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("records page loads, client-side navigation and data requests, without assets", async () => {
    const context = await browser.newContext();
    const touched = trackTouchedPaths(context, instanceUrl);
    const page = await context.newPage();
    await page.goto(`${instanceUrl}/trips/`);
    await page.waitForURL(`${instanceUrl}/trips/42`);
    touched.stop();
    expect(touched.paths().sort()).toEqual(["/trips", "/trips/42"]);
    await context.close();
  });
});
