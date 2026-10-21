import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore } from "../src/run-store.js";
import { askHumanTool } from "../src/tools/definitions.js";
import type { HumanBridge } from "../src/human.js";

describe("ask_human", () => {
  const store = () => new RunStore(mkdtempSync(join(tmpdir(), "claudio-ask-")));
  it("passes the answer on and notes question and answer", async () => {
    const s = store();
    const seen: unknown[] = [];
    const bridge: HumanBridge = { wait: async () => "resolved", ask: async (q, o) => (seen.push([q, o]), { outcome: "resolved", answer: "Ja, Pflicht." }) };
    const tool = askHumanTool(bridge, s);
    const out = await tool.handler({ question: "Ist das Fahrzeug Pflicht?", options: ["Ja", "Nein"] });
    expect(out).toMatch(/^Answer from a person: Ja, Pflicht\./);
    expect(seen).toEqual([["Ist das Fahrzeug Pflicht?", { context: undefined, options: ["Ja", "Nein"] }]]);
    expect(s.notes()).toContain("Frage an einen Menschen: Ist das Fahrzeug Pflicht? → Antwort: Ja, Pflicht.");
  });
  it("tells the agent to decide itself without an answer, and stops after three questions", async () => {
    const s = store();
    const bridge: HumanBridge = { wait: async () => "resolved", ask: async () => ({ outcome: "timeout", answer: null }) };
    const tool = askHumanTool(bridge, s);
    expect(await tool.handler({ question: "a" })).toMatch(/Nobody answered in time/);
    await tool.handler({ question: "b" });
    await tool.handler({ question: "c" });
    expect(await tool.handler({ question: "d" })).toMatch(/already asked 3 questions/);
  });
});
