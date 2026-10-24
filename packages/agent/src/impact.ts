import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { posix, join } from "node:path";
import { isGlobalChange, isInertFile, isSvelteKitRouteFile, sveltekitRouteOf, type Impact, type ImpactRoute } from "@claudio/core";
import type { ChangedFile } from "@claudio/forge";

const CODE_EXT = /\.(?:[cm]?[jt]sx?|svelte|vue)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", ".svelte-kit", "build", "dist", ".output", ".vercel", ".netlify", ".next", ".turbo", "coverage"]);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1_000_000;
/** Tried in this order when an import names a file without its extension. */
const RESOLVE_EXT = [".ts", ".js", ".svelte", ".tsx", ".jsx", ".mts", ".mjs", ".cts", ".cjs", ".vue", ".svelte.ts", ".svelte.js", ".json"];

const IMPORT_PATTERNS = [
  /\bfrom\s*["']([^"'\n]+)["']/g,
  /\bimport\s*["']([^"'\n]+)["']/g,
  /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
];

/** `import type … from` and `export type … from`: types only, nothing changes at runtime. */
const TYPE_ONLY = /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|[\w$*\s,]+?)\s*from\s*["'][^"'\n]+["']/g;

/** Import specifiers in a source file. Comments and strings may add a few false edges; that only widens the impact. */
export function importSpecifiers(source: string): string[] {
  const out = new Set<string>();
  const code = source.replace(TYPE_ONLY, "");
  for (const re of IMPORT_PATTERNS) for (const m of code.matchAll(re)) out.add(m[1]!);
  return [...out];
}

type Alias = { from: string; to: string; prefix: boolean };

/**
 * Computes which routes a change reaches: walks the checkout, builds the
 * import graph and follows the importers of every changed file up to the
 * route files. Bare package imports are ignored.
 */
export function computeImpact(repoDir: string, changed: Pick<ChangedFile, "filename" | "status" | "previousFilename">[]): Impact {
  const started = Date.now();
  const files = walk(repoDir);
  const exists = cachedExists(repoDir);
  const aliasesOf = cachedAliases(repoDir, exists);

  // importer → resolved targets, kept reversed; imports that resolve to nothing are kept too, so a deleted file finds its old importers.
  const importers = new Map<string, Set<string>>();
  let imports = 0;
  for (const file of files) {
    let source: string;
    try {
      if (statSync(join(repoDir, file)).size > MAX_FILE_BYTES) continue;
      source = readFileSync(join(repoDir, file), "utf8");
    } catch {
      continue;
    }
    for (const spec of importSpecifiers(source)) {
      const target = resolveImport(file, spec, aliasesOf(file), exists);
      if (!target) continue;
      imports++;
      for (const key of [target, stripExt(target)]) {
        if (!importers.has(key)) importers.set(key, new Set());
        importers.get(key)!.add(file);
      }
    }
  }

  const framework = files.some(isSvelteKitRouteFile) ? "sveltekit" : "unknown";
  const routes = new Map<string, ImpactRoute>();
  const global: Impact["global"] = [];
  const unmapped: string[] = [];
  let ignored = 0;

  const addRoute = (file: string, via: string[], direct: boolean) => {
    const r = sveltekitRouteOf(file)!;
    const key = `${r.kind} ${r.pattern}`;
    const known = routes.get(key);
    if (!known || (direct && !known.direct) || (direct === known.direct && via.length < known.via.length)) routes.set(key, { ...r, direct: direct || Boolean(known?.direct), via });
  };

  const sources = [...new Set(changed.flatMap((f) => [f.filename, ...(f.previousFilename ? [f.previousFilename] : [])]))];
  for (const source of sources) {
    if (isGlobalChange(source)) {
      global.push({ file: source, via: [source] });
      continue;
    }
    if (isSvelteKitRouteFile(source)) addRoute(source, [source], true);
    else if (isInertFile(source)) {
      ignored++;
      continue;
    }

    // Breadth-first over the importers: the first path to a route is the shortest.
    let reached = isSvelteKitRouteFile(source);
    const seen = new Set([source]);
    const queue: string[][] = [[source]];
    while (queue.length) {
      const chain = queue.shift()!;
      const at = chain.at(-1)!;
      const next = new Set([...(importers.get(at) ?? []), ...(importers.get(stripExt(at)) ?? [])]);
      for (const importer of next) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        const via = [...chain, importer];
        if (isGlobalChange(importer)) {
          global.push({ file: source, via });
          reached = true;
        } else if (isSvelteKitRouteFile(importer)) {
          addRoute(importer, via, false);
          reached = true;
        } else if (!isInertFile(importer)) {
          queue.push(via);
        }
      }
    }
    if (!reached) unmapped.push(source);
  }

  return {
    framework,
    routes: [...routes.values()].sort((a, b) => Number(b.direct) - Number(a.direct) || a.pattern.localeCompare(b.pattern) || a.kind.localeCompare(b.kind)),
    global,
    unmapped,
    stats: { files: files.length, imports, ignored, ms: Date.now() - started },
  };
}

/** Code files of the checkout, relative with forward slashes. */
function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) visit(rel);
      } else if (e.isFile() && CODE_EXT.test(e.name)) {
        out.push(rel);
      }
    }
  };
  visit("");
  return out;
}

function cachedExists(root: string): (rel: string) => boolean {
  const cache = new Map<string, boolean>();
  return (rel) => {
    let hit = cache.get(rel);
    if (hit === undefined) {
      try {
        hit = statSync(join(root, rel)).isFile();
      } catch {
        hit = false;
      }
      cache.set(rel, hit);
    }
    return hit;
  };
}

const stripExt = (file: string) => file.replace(/(?:\.svelte)?\.(?:[cm]?[jt]sx?|svelte|vue|json)$/, "");

/** The file an import names, or null for packages. An unresolved relative or aliased import yields its would-be path. */
export function resolveImport(importer: string, spec: string, aliases: Alias[], exists: (rel: string) => boolean): string | null {
  let base: string | null = null;
  if (spec.startsWith("./") || spec.startsWith("../")) base = posix.join(posix.dirname(importer), spec);
  else if (spec.startsWith("/")) return null;
  else {
    for (const a of aliases) {
      if (a.prefix ? spec.startsWith(a.from) : spec === a.from) {
        base = posix.normalize(a.prefix ? a.to + spec.slice(a.from.length) : a.to);
        break;
      }
    }
  }
  if (base === null || base.startsWith("..")) return null;
  base = base.replace(/\?.*$/, "");

  const candidates = [base];
  // TypeScript ESM: "./x.js" names x.ts.
  const swapped = base.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts").replace(/\.jsx$/, ".tsx");
  if (swapped !== base) candidates.push(swapped);
  for (const ext of RESOLVE_EXT) candidates.push(base + ext);
  for (const ext of RESOLVE_EXT) candidates.push(`${base}/index${ext}`);
  return candidates.find(exists) ?? base;
}

/**
 * Path aliases of the project a file belongs to (nearest package.json):
 * SvelteKit's `$lib`, `kit.alias` from svelte.config and `compilerOptions.paths`
 * from tsconfig/jsconfig.
 */
function cachedAliases(root: string, exists: (rel: string) => boolean): (file: string) => Alias[] {
  const byProject = new Map<string, Alias[]>();
  const projectOf = (file: string): string => {
    let dir = posix.dirname(file);
    while (dir !== "." && dir !== "/" && !exists(`${dir}/package.json`)) dir = posix.dirname(dir);
    return dir === "/" ? "." : dir;
  };
  return (file) => {
    const project = projectOf(file);
    let aliases = byProject.get(project);
    if (!aliases) {
      aliases = projectAliases(root, project);
      byProject.set(project, aliases);
    }
    return aliases;
  };
}

function projectAliases(root: string, project: string): Alias[] {
  const at = (rel: string) => (project === "." ? rel : `${project}/${rel}`);
  const aliases: Alias[] = [];
  const add = (from: string, to: string) => {
    const target = posix.normalize(at(to.replace(/^\.\//, "")));
    if (from.endsWith("/*")) aliases.push({ from: from.slice(0, -1), to: target.replace(/\*$/, ""), prefix: true });
    else {
      aliases.push({ from, to: target, prefix: false });
      // An alias for a directory also covers the files in it; one for a file does not.
      if (!/\.\w+$/.test(target)) aliases.push({ from: `${from}/`, to: `${target}/`, prefix: true });
    }
  };

  // Node subpath imports: "imports": { "#lib/*": "./src/lib/*" }, a target may be a map of conditions.
  try {
    const pkg = JSON.parse(readFileSync(join(root, at("package.json")), "utf8")) as { imports?: Record<string, unknown> };
    for (const [from, target] of Object.entries(pkg.imports ?? {})) {
      const to = subpathTarget(target);
      if (to) add(from, to);
    }
  } catch {
    // No package.json, or one the graph cannot read.
  }

  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const path = join(root, at(name));
    if (!existsSync(path)) continue;
    try {
      const options = parseJsonc(readFileSync(path, "utf8"))?.compilerOptions as { baseUrl?: string; paths?: Record<string, string[]> } | undefined;
      const baseUrl = (options?.baseUrl ?? ".").replace(/^\.\/?/, "");
      for (const [from, targets] of Object.entries(options?.paths ?? {})) {
        const to = targets[0];
        if (to) add(from, baseUrl ? `${baseUrl}/${to.replace(/^\.\//, "")}` : to);
      }
    } catch {
      // A config the graph cannot read: fall back to the defaults below.
    }
  }

  for (const name of ["svelte.config.js", "svelte.config.mjs", "svelte.config.ts"]) {
    const path = join(root, at(name));
    if (!existsSync(path)) continue;
    const block = /\balias\s*:\s*\{([^}]*)\}/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
    for (const m of block.matchAll(/["']?([$@\w/*.-]+)["']?\s*:\s*["']([^"']+)["']/g)) add(m[1]!, m[2]!);
  }

  // SvelteKit's built-in alias; a configured one above wins because it comes first.
  add("$lib", "src/lib");
  return aliases.sort((a, b) => b.from.length - a.from.length);
}

/** The file a subpath import points to: the string itself, or the first string among its conditions. */
function subpathTarget(target: unknown): string | null {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  const conditions = target as Record<string, unknown>;
  for (const key of ["svelte", "import", "default", "node", ...Object.keys(conditions)]) {
    const hit = subpathTarget(conditions[key]);
    if (hit) return hit;
  }
  return null;
}

/** JSON with comments and trailing commas, as tsconfig allows. */
function parseJsonc(text: string): Record<string, unknown> | null {
  const stripped = text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string | undefined) => str ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as Record<string, unknown>;
}
