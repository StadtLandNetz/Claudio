/**
 * Integration test for the Playwright driver against a throwaway local app.
 * Runs only when CLAUDIO_INTEGRATION=1 (needs a Chromium: bundled or CLAUDIO_CHROMIUM_PATH).
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightDriver } from "../src/playwright-driver.js";
import { RunStore } from "../src/run-store.js";
import { createClaudioTools, type ClaudioTool } from "../src/tools/definitions.js";
import type { DriverSession } from "../src/driver.js";

const enabled = process.env.CLAUDIO_INTEGRATION === "1";

describe.skipIf(!enabled)("PlaywrightDriver (integration)", () => {
  let server: Server;
  let instanceUrl: string;
  let session: DriverSession;
  let runDir: string;
  let tools: Record<string, ClaudioTool<any>>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/login" && req.method === "GET") {
        res.setHeader("content-type", "text/html");
        res.end(`<form method="post" action="/login"><input name="email" type="email"><input name="password" type="password"><button type="submit">Login</button></form>`);
      } else if (url.pathname === "/login" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const p = new URLSearchParams(body);
          if (p.get("email") === "u@test" && p.get("password") === "p") {
            res.statusCode = 302;
            res.setHeader("location", "/dashboard");
            res.end();
          } else {
            res.setHeader("content-type", "text/html");
            res.end(`<div role="alert">Falsche Zugangsdaten</div><form method="post"><input name="email" type="email"><input name="password" type="password"><button>Login</button></form>`);
          }
        });
      } else if (url.pathname === "/dashboard") {
        res.setHeader("content-type", "text/html");
        res.end(`<h1>Dashboard</h1><script>fetch('/api/broken'); console.error('boom');</script>`);
      } else if (url.pathname === "/api/broken") {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "kaputt" }));
      } else {
        res.statusCode = 404;
        res.end("nope");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    instanceUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    runDir = mkdtempSync(join(tmpdir(), "claudio-it-"));
    session = await new PlaywrightDriver().start({ runDir, instanceUrl, headed: false });
    process.env.IT_USER = "u@test";
    process.env.IT_PASS = "p";
    process.env.IT_BAD = "nope";
    const store = new RunStore(runDir);
    tools = Object.fromEntries(
      createClaudioTools({
        runDir,
        store,
        attachment: session.attachment,
        instanceUrl,
        driver: "playwright",
        roles: {
          admin: { usernameEnv: "IT_USER", passwordEnv: "IT_PASS", loginPath: "/login", successUrlContains: "/dashboard" },
          wrong: { usernameEnv: "IT_USER", passwordEnv: "IT_BAD", loginPath: "/login" },
        },
      }).map((t) => [t.name, t]),
    );
  }, 60_000);

  afterAll(async () => {
    await session?.close();
    server?.close();
  });

  it("logs in with the adaptive heuristic and captures evidence, console and network", async () => {
    expect(await tools.login_as!.handler({ role: "admin" })).toMatch(/Logged in as "admin"/);
    await new Promise((r) => setTimeout(r, 800));
    expect(await tools.capture_evidence!.handler({ label: "Dashboard" })).toMatch(/Evidence E1 captured/);
    expect(await tools.get_console!.handler({ level: "error", limit: 10 })).toMatch(/boom/);
    expect(await tools.get_network!.handler({ onlyErrors: true, onlyApi: true, limit: 10, includeBodies: true })).toMatch(/api\/broken → 500/);
  }, 60_000);

  it("reports a failed login without leaking credentials", async () => {
    const msg = await tools.login_as!.handler({ role: "wrong" });
    expect(msg).toMatch(/failed/);
    expect(msg).toMatch(/Falsche Zugangsdaten/);
    expect(msg).not.toContain("nope");
  }, 60_000);

  it("writes console, network and trace files on close", async () => {
    await session.close();
    expect(existsSync(join(runDir, "console.json"))).toBe(true);
    expect(existsSync(join(runDir, "network.json"))).toBe(true);
    expect(existsSync(join(runDir, "trace.zip"))).toBe(true);
  }, 60_000);
});
