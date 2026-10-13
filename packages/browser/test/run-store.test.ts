import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore } from "../src/run-store.js";
import { createClaudioTools } from "../src/tools/definitions.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "claudio-test-"));
}

describe("RunStore", () => {
  it("persists findings, evidence, AC results and todos", () => {
    const dir = tmp();
    const s = new RunStore(dir);
    s.addFinding({ category: "ux", severity: "minor", title: "t", description: "d", steps: [], evidenceIds: [] });
    s.addEvidence({ id: s.nextEvidenceId(), kind: "note", label: "l" });
    s.recordAcResult({ criterion: "c", status: "passed", notes: "", evidenceIds: [] });
    s.recordAcResult({ criterion: "c", status: "failed", notes: "later", evidenceIds: [] });
    s.todoAdd(["a", "b"]);
    expect(s.todoNext()?.text).toBe("a");
    s.todoDone(1, "ok");
    expect(s.todoNext()?.text).toBe("b");

    const reopened = new RunStore(dir);
    expect(reopened.findings()).toHaveLength(1);
    expect(reopened.evidence()[0]!.id).toBe("E1");
    expect(reopened.acResults()).toEqual([expect.objectContaining({ criterion: "c", status: "failed" })]);
    expect(reopened.addFinding({ category: "ui", severity: "minor", title: "t2", description: "d", steps: [], evidenceIds: [] }).id).toBe("F2");
  });
});

describe("claudio tools without a browser attachment", () => {
  it("handles login, evidence and todo flows", async () => {
    const dir = tmp();
    const store = new RunStore(dir);
    const tools = createClaudioTools({
      runDir: dir,
      store,
      attachment: null,
      instanceUrl: "https://app.test",
      roles: { admin: { usernameEnv: "U", passwordEnv: "P", loginPath: "/login" } },
      driver: "chrome",
    });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(await byName.login_as!.handler({ role: "nope" })).toMatch(/Unknown role/);
    expect(await byName.login_as!.handler({ role: "admin" })).toMatch(/Live mode/);
    expect(await byName.capture_evidence!.handler({ label: "x" })).toMatch(/E1 recorded as a note/);
    expect(await byName.get_console!.handler({ level: "error", limit: 10 })).toMatch(/not available/);
    expect(await byName.todo_add!.handler({ items: ["eins", "zwei"] })).toMatch(/Added 2/);
    expect(await byName.todo_done!.handler({ id: 1, result: "r", status: "done" })).toMatch(/Next: #2/);
    expect(await byName.report_finding!.handler({ category: "ux", severity: "major", title: "T", description: "D", steps: [], evidenceIds: ["E1"] })).toMatch(/F1 recorded/);
    expect(store.findings()[0]!.evidenceIds).toEqual(["E1"]);
  });
});
