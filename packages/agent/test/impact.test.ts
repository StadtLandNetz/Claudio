import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeImpact, importSpecifiers } from "../src/impact.js";

/** A small SvelteKit app: two pages share a component, an admin area has its own layout. */
const APP: Record<string, string> = {
  "package.json": JSON.stringify({ imports: { "#lib": "./src/lib/index.js", "#lib/*": "./src/lib/*" }, devDependencies: { "@sveltejs/kit": "^2.0.0" } }),
  "src/lib/index.ts": "export const version = 1;",
  "src/lib/clock.ts": "export const now = () => new Date();",
  "src/routes/about/+page.ts": "import { now } from '#lib/clock.js';\nimport { version } from '#lib';\nexport const load = () => ({ now, version });",
  "tsconfig.json": `{
    // comments and trailing commas, as tsconfig allows
    "compilerOptions": { "paths": { "@ui/*": ["./src/lib/ui/*"], }, },
  }`,
  "svelte.config.js": "export default { kit: { alias: { $server: 'src/lib/server' } } };",
  "src/hooks.server.ts": "import { session } from '$server/session';\nexport const handle = session;",
  "src/lib/server/session.ts": "export const session = () => null;",
  "src/lib/format.ts": "export const money = (n: number) => `${n} €`;",
  "src/lib/ui/Badge.svelte": "<script lang=\"ts\">\n  import { money } from '$lib/format';\n</script>",
  "src/lib/trips.ts": "import { money } from './format.js';\nexport const label = money;",
  "src/routes/+layout.svelte": "<slot />",
  "src/routes/trips/+page.svelte": "<script>\n  import Badge from '@ui/Badge.svelte';\n  import { label } from '$lib/trips';\n</script>",
  "src/routes/trips/[id]/+page.server.ts": "import { label } from '$lib/trips';\nexport const load = () => ({ label });",
  "src/routes/trips/[id]/+page.svelte": "<p>Fahrt</p>",
  "src/routes/(admin)/admin/+layout.svelte": "<script>\n  import Nav from './Nav.svelte';\n</script>",
  "src/routes/(admin)/admin/Nav.svelte": "<script>\n  import { old } from '$lib/legacy';\n</script>",
  "src/routes/api/trips/+server.ts": "import { label } from '$lib/trips';\nexport const GET = () => new Response(label(1));",
  "src/lib/trips.test.ts": "import { label } from './trips';",
  "README.md": "# app",
};

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "claudio-impact-"));
  for (const [file, content] of Object.entries(APP)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const changed = (filename: string, status = "modified", previousFilename?: string) => ({ filename, status, previousFilename });

describe("importSpecifiers", () => {
  it("finds static, side-effect, dynamic and require imports", () => {
    const src = `import a from "./a";\nimport { b,\n  c } from '$lib/b';\nimport "./style.css";\nexport * from "./d.js";\nconst e = await import("./e");\nconst f = require('f');`;
    expect(importSpecifiers(src).sort()).toEqual(["$lib/b", "./a", "./d.js", "./e", "./style.css", "f"]);
  });
  it("skips type-only imports", () => {
    const src = `import type { Session } from "./auth";\nimport type Db from '$lib/db';\nexport type { X } from "./x";\nimport { type Y, z } from "./z";`;
    expect(importSpecifiers(src)).toEqual(["./z"]);
  });
});

describe("computeImpact", () => {
  it("follows a shared module to every route that imports it", () => {
    const impact = computeImpact(dir, [changed("src/lib/format.ts")]);
    expect(impact.framework).toBe("sveltekit");
    expect(impact.global).toEqual([]);
    expect(impact.routes.map((r) => `${r.kind} ${r.pattern}`).sort()).toEqual(["endpoint /api/trips", "page /trips", "page /trips/[id]"]);
    const trips = impact.routes.find((r) => r.pattern === "/trips")!;
    expect(trips.direct).toBe(false);
    expect(trips.via[0]).toBe("src/lib/format.ts");
    expect(trips.via.at(-1)).toBe("src/routes/trips/+page.svelte");
    // The shortest chain wins: format → Badge (alias @ui) or format → trips → page are both two hops.
    expect(trips.via).toHaveLength(3);
  });

  it("resolves Node subpath imports from package.json", () => {
    expect(computeImpact(dir, [changed("src/lib/clock.ts")]).routes.map((r) => r.pattern)).toEqual(["/about"]);
    expect(computeImpact(dir, [changed("src/lib/index.ts")]).routes.map((r) => r.pattern)).toEqual(["/about"]);
  });

  it("marks a changed route file as direct", () => {
    const impact = computeImpact(dir, [changed("src/routes/trips/[id]/+page.svelte")]);
    expect(impact.routes).toEqual([{ pattern: "/trips/[id]", kind: "page", direct: true, via: ["src/routes/trips/[id]/+page.svelte"] }]);
  });

  it("treats modules behind the server hooks as global, through svelte.config aliases", () => {
    const impact = computeImpact(dir, [changed("src/lib/server/session.ts")]);
    expect(impact.global).toEqual([{ file: "src/lib/server/session.ts", via: ["src/lib/server/session.ts", "src/hooks.server.ts"] }]);
  });

  it("finds the old importers of a deleted file", () => {
    const impact = computeImpact(dir, [changed("src/lib/legacy.ts", "removed")]);
    expect(impact.routes).toEqual([
      { pattern: "/admin", kind: "layout", direct: false, via: ["src/lib/legacy.ts", "src/routes/(admin)/admin/Nav.svelte", "src/routes/(admin)/admin/+layout.svelte"] },
    ]);
  });

  it("follows the old name of a renamed file", () => {
    const impact = computeImpact(dir, [changed("src/lib/legacy2.ts", "renamed", "src/lib/legacy.ts")]);
    expect(impact.routes.map((r) => r.pattern)).toEqual(["/admin"]);
  });

  it("ignores docs and tests and reports code that reaches no route", () => {
    writeFileSync(join(dir, "src/lib/unused.ts"), "export const x = 1;");
    const impact = computeImpact(dir, [changed("README.md"), changed("src/lib/trips.test.ts"), changed("src/lib/unused.ts")]);
    expect(impact.routes).toEqual([]);
    expect(impact.unmapped).toEqual(["src/lib/unused.ts"]);
    expect(impact.stats.ignored).toBe(2);
  });

  it("knows no routes outside SvelteKit", () => {
    const plain = mkdtempSync(join(tmpdir(), "claudio-impact-plain-"));
    writeFileSync(join(plain, "server.mjs"), "import http from 'node:http';");
    try {
      const impact = computeImpact(plain, [changed("server.mjs")]);
      expect(impact.framework).toBe("unknown");
      expect(impact.routes).toEqual([]);
      expect(impact.unmapped).toEqual(["server.mjs"]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
