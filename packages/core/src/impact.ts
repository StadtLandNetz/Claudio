import { z } from "zod";
import type { TestStep } from "./testing.js";

/**
 * Impact of a change, computed from the import graph of the checkout: which
 * routes a changed file reaches through its importers. The model only ranks
 * these candidates by risk; the same result picks the regression tests.
 */
export const ImpactRouteKindSchema = z.enum(["page", "layout", "endpoint"]);
export type ImpactRouteKind = z.infer<typeof ImpactRouteKindSchema>;

export const ImpactRouteSchema = z.object({
  /** URL pattern in the framework's notation, e.g. /trips/[id]. */
  pattern: z.string(),
  /** A layout covers every route below its pattern. */
  kind: ImpactRouteKindSchema,
  /** The route file itself changed. */
  direct: z.boolean(),
  /** Shortest import chain from the changed file to the route file. */
  via: z.array(z.string()),
});
export type ImpactRoute = z.infer<typeof ImpactRouteSchema>;

export const ImpactSchema = z.object({
  framework: z.enum(["sveltekit", "unknown"]),
  routes: z.array(ImpactRouteSchema),
  /** Changes that affect every route (hooks, config, dependencies, database), with the chain that led there. */
  global: z.array(z.object({ file: z.string(), via: z.array(z.string()) })),
  /** Changed files that reach no route and are not docs or tests: the graph cannot say what they affect. */
  unmapped: z.array(z.string()),
  stats: z.object({ files: z.number(), imports: z.number(), ignored: z.number(), ms: z.number() }),
});
export type Impact = z.infer<typeof ImpactSchema>;

const ROUTE_FILE = /^\+(page|layout|server|error)(@[^.]*)?\.[\w.]+$/;

/** The SvelteKit route a file implements, or null. Works for apps in a subdirectory (monorepos) too. */
export function sveltekitRouteOf(file: string): { pattern: string; kind: ImpactRouteKind } | null {
  const m = /(?:^|\/)src\/routes\/(.*)$/.exec(file.replace(/\\/g, "/"));
  if (!m) return null;
  const parts = m[1]!.split("/");
  const base = parts.pop()!;
  const kind = ROUTE_FILE.exec(base)?.[1];
  if (!kind) return null;
  const segments = parts.filter((p) => p && !/^\(.*\)$/.test(p));
  const pattern = `/${segments.join("/")}`;
  if (kind === "server") return { pattern, kind: "endpoint" };
  // An error page shows for every route below it, like a layout.
  return { pattern, kind: kind === "page" ? "page" : "layout" };
}

export const isSvelteKitRouteFile = (file: string) => sveltekitRouteOf(file) !== null;

const GLOBAL_FILES = [
  /(?:^|\/)src\/hooks(?:\.server|\.client)?\.[cm]?[jt]s$/,
  /(?:^|\/)src\/app\.html$/,
  /(?:^|\/)src\/params\//,
  /(?:^|\/)(?:svelte|vite|tailwind|postcss)\.config\.[cm]?[jt]s$/,
  /(?:^|\/)package\.json$/,
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/,
  // Database schema and migrations change what every screen reads.
  /(?:^|\/)(?:migrations?|drizzle|prisma)\//,
  /\.sql$/,
];

/** A change that affects every route of the app. */
export const isGlobalChange = (file: string) => GLOBAL_FILES.some((r) => r.test(file));

const INERT_FILES = [
  /\.(?:md|mdx|txt|rst)$/i,
  // Type declarations change nothing at runtime.
  /\.d\.ts$/,
  /(?:^|\/)(?:LICENSE|CODEOWNERS|\.gitignore|\.gitattributes|\.editorconfig|\.npmrc|\.nvmrc|\.gitlab-ci\.yml)$/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)(?:\.prettierrc[^/]*|\.eslintrc[^/]*|(?:eslint|prettier|playwright|vitest)\.config\.[cm]?[jt]s)$/,
];
const TOOLING_DIRS = new Set([".github", ".gitlab", ".vscode", ".idea", ".husky", "__tests__"]);
/** Only outside the app's `src/`: a route may well be called /docs or /test. */
const TOP_LEVEL_DIRS = new Set(["doc", "docs", "e2e", "test", "tests"]);

/** Docs, tests and tooling: changing them cannot change what a user sees. */
export function isInertFile(file: string): boolean {
  if (isSvelteKitRouteFile(file)) return false;
  if (INERT_FILES.some((r) => r.test(file))) return true;
  const dirs = file.split("/").slice(0, -1);
  const src = dirs.indexOf("src");
  return dirs.some((d, k) => TOOLING_DIRS.has(d) || (TOP_LEVEL_DIRS.has(d) && (src < 0 || k < src)));
}

/**
 * The path part of a URL as a test sees it: no origin, query or hash, no
 * SvelteKit data suffix, no trailing slash. Form actions (`?/save`) post to
 * the page's own path.
 */
export function normalizePath(urlOrPath: string): string {
  let p = urlOrPath.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    // Not a URL after all: treat it as a path.
  }
  p = p.replace(/[?#].*$/, "").replace(/\/__data\.json$/, "");
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex for a route pattern: a page or endpoint matches its own path, a layout everything below. */
export function routeRegex(pattern: string, kind: ImpactRouteKind): RegExp {
  let body = "";
  for (const seg of pattern.split("/").filter(Boolean)) {
    if (/^\[\.\.\.[^\]]+\]$/.test(seg)) body += "(?:/.*)?";
    else if (/^\[\[[^\]]+\]\]$/.test(seg)) body += "(?:/[^/]+)?";
    else body += "/" + seg.split(/(\[[^\]]+\])/).map((part) => (/^\[[^\]]+\]$/.test(part) ? "[^/]+" : escapeRegex(part))).join("");
  }
  const tail = kind === "layout" ? "(?:/.*)?" : "/?";
  return new RegExp(`^${body}${tail}$`);
}

export function matchRoute(route: { pattern: string; kind: ImpactRouteKind }, path: string): boolean {
  return routeRegex(route.pattern, route.kind).test(normalizePath(path));
}

/** A regression test as the selection sees it. */
export type SelectableTest = { id: number; name: string; touchedPaths: string[] | null; steps: TestStep[] | null };

export const TestSelectionSchema = z.object({
  /** What the review asked for. */
  mode: z.enum(["affected", "all"]),
  /** Set when every test runs: asked for, or the impact could not narrow it down. */
  all: z.enum(["requested", "no_impact", "unknown_framework", "global_change"]).optional(),
  /** Each selected test with the affected route it touches, or `unknownPaths` when it has not run yet. */
  selected: z.array(z.object({ id: z.number(), name: z.string(), route: z.string().optional(), unknownPaths: z.boolean().optional() })),
  skipped: z.array(z.object({ id: z.number(), name: z.string() })),
});
export type TestSelection = z.infer<typeof TestSelectionSchema>;

/**
 * Paths a test is known to visit: recorded from its runs, else the `goto` steps
 * of its script. A full URL in a step may point to another host, so it does not count.
 */
export function knownTestPaths(t: Pick<SelectableTest, "touchedPaths" | "steps">): string[] {
  if (t.touchedPaths?.length) return t.touchedPaths;
  return (t.steps ?? []).flatMap((s) => (s.action === "goto" && !s.path.includes("{{") && !/^[a-z][a-z0-9+.-]*:/i.test(s.path) ? [normalizePath(s.path)] : []));
}

/**
 * Which regression tests a review runs. Every test runs when the impact is
 * unknown or affects the whole app; a test whose paths are unknown runs to be
 * safe; otherwise a test runs when one of its paths falls under an affected route.
 */
export function selectReviewTests(mode: "affected" | "all", impact: Impact | null, tests: SelectableTest[]): TestSelection {
  const everything = (all: NonNullable<TestSelection["all"]>): TestSelection => ({ mode, all, selected: tests.map((t) => ({ id: t.id, name: t.name })), skipped: [] });
  if (mode === "all") return everything("requested");
  if (!impact) return everything("no_impact");
  if (impact.framework === "unknown") return everything("unknown_framework");
  if (impact.global.length) return everything("global_change");

  const routes = impact.routes.map((r) => ({ pattern: r.pattern, regex: routeRegex(r.pattern, r.kind) }));
  const selection: TestSelection = { mode, selected: [], skipped: [] };
  for (const t of tests) {
    const paths = knownTestPaths(t).map(normalizePath);
    if (!paths.length) {
      selection.selected.push({ id: t.id, name: t.name, unknownPaths: true });
      continue;
    }
    const hit = routes.find((r) => paths.some((p) => r.regex.test(p)));
    if (hit) selection.selected.push({ id: t.id, name: t.name, route: hit.pattern });
    else selection.skipped.push({ id: t.id, name: t.name });
  }
  return selection;
}
