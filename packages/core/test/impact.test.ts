import { describe, expect, it } from "vitest";
import { isGlobalChange, isInertFile, knownTestPaths, matchRoute, normalizePath, selectReviewTests, sveltekitRouteOf, type Impact } from "../src/index.js";

describe("sveltekitRouteOf", () => {
  it("maps route files to patterns without groups", () => {
    expect(sveltekitRouteOf("src/routes/(app)/trips/[id]/+page.svelte")).toEqual({ pattern: "/trips/[id]", kind: "page" });
    expect(sveltekitRouteOf("src/routes/trips/+page.server.ts")).toEqual({ pattern: "/trips", kind: "page" });
    expect(sveltekitRouteOf("src/routes/+layout.svelte")).toEqual({ pattern: "/", kind: "layout" });
    expect(sveltekitRouteOf("src/routes/(admin)/admin/+layout.server.ts")).toEqual({ pattern: "/admin", kind: "layout" });
    expect(sveltekitRouteOf("src/routes/api/trips/[[page]]/+server.ts")).toEqual({ pattern: "/api/trips/[[page]]", kind: "endpoint" });
    expect(sveltekitRouteOf("src/routes/trips/+error.svelte")).toEqual({ pattern: "/trips", kind: "layout" });
    expect(sveltekitRouteOf("src/routes/print/+page@.svelte")).toEqual({ pattern: "/print", kind: "page" });
  });
  it("finds apps in a subdirectory", () => {
    expect(sveltekitRouteOf("apps/web/src/routes/login/+page.svelte")).toEqual({ pattern: "/login", kind: "page" });
  });
  it("ignores files that are not route files", () => {
    expect(sveltekitRouteOf("src/routes/trips/TripRow.svelte")).toBeNull();
    expect(sveltekitRouteOf("src/lib/trips.ts")).toBeNull();
  });
});

describe("matchRoute", () => {
  it("matches parameters, optional and rest segments", () => {
    expect(matchRoute({ pattern: "/trips/[id]", kind: "page" }, "/trips/42")).toBe(true);
    expect(matchRoute({ pattern: "/trips/[id]", kind: "page" }, "/trips/42/edit")).toBe(false);
    expect(matchRoute({ pattern: "/trips/[id=integer]/edit", kind: "page" }, "/trips/7/edit/")).toBe(true);
    expect(matchRoute({ pattern: "/list/[[page]]", kind: "page" }, "/list")).toBe(true);
    expect(matchRoute({ pattern: "/list/[[page]]", kind: "page" }, "/list/3")).toBe(true);
    expect(matchRoute({ pattern: "/docs/[...rest]", kind: "page" }, "/docs/a/b/c")).toBe(true);
    expect(matchRoute({ pattern: "/files/report-[id].pdf", kind: "endpoint" }, "/files/report-9.pdf")).toBe(true);
  });
  it("treats a layout as a prefix", () => {
    expect(matchRoute({ pattern: "/trips", kind: "layout" }, "/trips/42/edit")).toBe(true);
    expect(matchRoute({ pattern: "/trips", kind: "layout" }, "/tripsx")).toBe(false);
    expect(matchRoute({ pattern: "/", kind: "layout" }, "/anything")).toBe(true);
    expect(matchRoute({ pattern: "/", kind: "page" }, "/")).toBe(true);
    expect(matchRoute({ pattern: "/", kind: "page" }, "/trips")).toBe(false);
  });
  it("normalises data requests, form actions and full URLs", () => {
    expect(normalizePath("https://pr-1.example.test/trips/42/__data.json?x-sveltekit-invalidated=01")).toBe("/trips/42");
    expect(normalizePath("/trips/new?/create")).toBe("/trips/new");
    expect(normalizePath("trips/")).toBe("/trips");
    expect(matchRoute({ pattern: "/trips/new", kind: "page" }, "/trips/new?/create")).toBe(true);
  });
});

describe("file classes", () => {
  it("knows changes that affect the whole app", () => {
    expect(isGlobalChange("src/hooks.server.ts")).toBe(true);
    expect(isGlobalChange("apps/web/svelte.config.js")).toBe(true);
    expect(isGlobalChange("pnpm-lock.yaml")).toBe(true);
    expect(isGlobalChange("drizzle/0003_trips.sql")).toBe(true);
    expect(isGlobalChange("src/lib/trips.ts")).toBe(false);
  });
  it("ignores docs and tests but not routes with such names", () => {
    expect(isInertFile("README.md")).toBe(true);
    expect(isInertFile("docs/setup.ts")).toBe(true);
    expect(isInertFile("src/lib/trips.test.ts")).toBe(true);
    expect(isInertFile(".github/workflows/ci.yml")).toBe(true);
    expect(isInertFile("src/app.d.ts")).toBe(true);
    expect(isInertFile("src/routes/docs/+page.svelte")).toBe(false);
    expect(isInertFile("src/lib/test/helpers.ts")).toBe(false);
    expect(isInertFile("src/routes/blog/+page.md")).toBe(false);
  });
});

describe("selectReviewTests", () => {
  const impact = (over: Partial<Impact> = {}): Impact => ({
    framework: "sveltekit",
    routes: [
      { pattern: "/trips/[id]", kind: "page", direct: true, via: ["src/routes/trips/[id]/+page.svelte"] },
      { pattern: "/admin", kind: "layout", direct: false, via: ["src/lib/nav.ts", "src/routes/admin/+layout.svelte"] },
    ],
    global: [],
    unmapped: [],
    stats: { files: 10, imports: 20, ignored: 0, ms: 1 },
    ...over,
  });
  const tests = [
    { id: 1, name: "Fahrt bearbeiten", touchedPaths: ["/login", "/trips", "/trips/42"], steps: null },
    { id: 2, name: "Dashboard", touchedPaths: ["/login", "/dashboard"], steps: null },
    { id: 3, name: "Nutzer anlegen", touchedPaths: null, steps: [{ action: "goto" as const, path: "/admin/users/new" }] },
    { id: 4, name: "Neu", touchedPaths: null, steps: null },
  ];

  it("runs the tests whose paths fall under an affected route, and tests with unknown paths", () => {
    const s = selectReviewTests("affected", impact(), tests);
    expect(s.all).toBeUndefined();
    expect(s.selected).toEqual([
      { id: 1, name: "Fahrt bearbeiten", route: "/trips/[id]" },
      { id: 3, name: "Nutzer anlegen", route: "/admin" },
      { id: 4, name: "Neu", unknownPaths: true },
    ]);
    expect(s.skipped).toEqual([{ id: 2, name: "Dashboard" }]);
  });
  it("runs everything when asked, without impact, for other frameworks and for global changes", () => {
    expect(selectReviewTests("all", impact(), tests).all).toBe("requested");
    expect(selectReviewTests("affected", null, tests).all).toBe("no_impact");
    expect(selectReviewTests("affected", impact({ framework: "unknown" }), tests).all).toBe("unknown_framework");
    const global = selectReviewTests("affected", impact({ global: [{ file: "src/hooks.server.ts", via: ["src/hooks.server.ts"] }] }), tests);
    expect(global.all).toBe("global_change");
    expect(global.selected).toHaveLength(4);
    expect(global.skipped).toEqual([]);
  });
  it("skips every test with known paths when no route is reached", () => {
    const s = selectReviewTests("affected", impact({ routes: [] }), tests);
    expect(s.selected.map((t) => t.id)).toEqual([4]);
  });
  it("reads goto steps when a test has not recorded its paths", () => {
    expect(knownTestPaths({ touchedPaths: null, steps: [{ action: "login", role: "admin" }, { action: "goto", path: "/trips/" }, { action: "goto", path: "/x/{{run}}" }] })).toEqual(["/trips"]);
  });
});
