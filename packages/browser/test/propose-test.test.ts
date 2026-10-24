import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RunStore } from "../src/run-store.js";
import { proposeTestTool } from "../src/tools/definitions.js";

const dir = mkdtempSync(join(tmpdir(), "claudio-proposals-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const proposal = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  startPath: "/trips/new",
  description: "Neue Fahrt öffnen, „Von“ und „Nach“ ausfüllen, „Speichern“ klicken.",
  expectation: "Die Meldung „Fahrt gespeichert“ erscheint.",
  roles: ["dispatcher"],
  priority: 1,
  rationale: "",
  ...over,
});

describe("propose_test", () => {
  it("stores proposals with ids and refuses duplicates of tests and earlier proposals", async () => {
    const store = new RunStore(join(dir, "a"));
    const tool = proposeTestTool(store, { existing: ["Fahrt anlegen"], max: 3 }, ["dispatcher", "admin"]);
    expect(await tool.handler(proposal("fahrt  anlegen!"))).toMatch(/exists or is proposed already/);
    expect(await tool.handler(proposal("Fahrt bearbeiten", { startPath: "trips/1/edit" }))).toMatch(/^P1 saved/);
    expect(await tool.handler(proposal("Fahrt Bearbeiten"))).toMatch(/exists or is proposed already/);
    expect(store.testProposals()).toMatchObject([{ id: "P1", name: "Fahrt bearbeiten", startPath: "/trips/1/edit", roles: ["dispatcher"] }]);
  });

  it("checks the roles and stops at the limit", async () => {
    const store = new RunStore(join(dir, "b"));
    const tool = proposeTestTool(store, { existing: [], max: 2 }, ["dispatcher"]);
    expect(await tool.handler(proposal("Tour planen", { roles: ["chef"] }))).toMatch(/Unknown role/);
    await tool.handler(proposal("Tour planen"));
    await tool.handler(proposal("Fahrer zuweisen"));
    expect(await tool.handler(proposal("Abrechnung"))).toMatch(/Limit of 2/);
    expect(store.testProposals().map((p) => p.id)).toEqual(["P1", "P2"]);
  });
});
